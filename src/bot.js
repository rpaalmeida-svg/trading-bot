const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const { updateDashboard } = require('./dashboard');
const logger = require('./logger');
const strategy = require('./strategy');
const risk = require('./risk');
const telegram = require('./telegram');
const { getFearGreedIndex, getEmoji } = require('./sentiment');
const { PAIRS, PAIR_CONFIG, calcScore, calcMacroScore, calcCompositeScore, allocateCapital, getReason, MIN_SCORE_TO_BUY, MAX_POSITIONS, MIN_TRADE_AMOUNT } = require('./portfolio');
const { recordBuy, recordSell, getStats } = require('./history');
const { getNewsSentiment } = require('./news');
const { initDB, saveState, loadState } = require('./database');
const { checkAndRunScan } = require('./scanner');

const BASE_URL = 'https://api.binance.com/api';
const API_KEY = process.env.BINANCE_API_KEY;
const SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const SEMESTRE_MS = 6 * 30 * 24 * 60 * 60 * 1000;
const CYCLE_INTERVAL_MS = 30 * 60 * 1000;
const CYCLE_LOCK_MS = 2 * 60 * 1000;

let initialBalance = null;
let dailyLossAlertSent = false;

const lastKnownPrices = {};

const positions = {};
PAIRS.forEach(p => {
  positions[p] = {
    inPosition: false,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    quantity: null,
    lastStopLoss: null,
    highestPrice: null
  };
});

async function persistPositions() {
  await saveState('positions', positions);
}

async function restorePositions() {
  const saved = await loadState('positions');
  if (saved) {
    PAIRS.forEach(p => {
      if (saved[p]) positions[p] = saved[p];
    });
    logger.info('Posições restauradas da BD', {
      emPosicao: PAIRS.filter(p => positions[p].inPosition)
    });
  }
}

function sign(queryString) {
  return crypto.createHmac('sha256', SECRET_KEY).update(queryString).digest('hex');
}

async function getBalance() {
  const timestamp = Date.now();
  const recvWindow = 60000;
  const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = sign(query);
  const res = await axios.get(`${BASE_URL}/v3/account`, {
    headers: { 'X-MBX-APIKEY': API_KEY },
    params: { timestamp, recvWindow, signature }
  });
  const usdc = res.data.balances.find(b => b.asset === 'USDC');
  return parseFloat(usdc?.free || 0);
}

// ─────────────────────────────────────────────────────
// SALDO REAL = USDC livre + valor de mercado das posições abertas
// ─────────────────────────────────────────────────────
async function getRealBalance(usdcBalance) {
  let totalPositionValue = 0;

  for (const symbol of PAIRS) {
    const pos = positions[symbol];
    if (!pos.inPosition || !pos.quantity) continue;

    try {
      const currentPrice = await getPrice(symbol);
      const positionValue = pos.quantity * currentPrice;
      totalPositionValue += positionValue;
      logger.info(`Valor posição ${symbol}`, {
        quantidade: pos.quantity,
        precoActual: currentPrice.toFixed(2),
        valor: positionValue.toFixed(2)
      });
    } catch (err) {
      if (pos.entryPrice && pos.quantity) {
        const fallbackValue = pos.quantity * pos.entryPrice;
        totalPositionValue += fallbackValue;
        logger.warn(`Fallback valor posição ${symbol}`, {
          precoEntrada: pos.entryPrice,
          valor: fallbackValue.toFixed(2)
        });
      }
    }
  }

  const realBalance = usdcBalance + totalPositionValue;
  logger.info('Saldo real calculado', {
    usdc: usdcBalance.toFixed(2),
    posicoes: totalPositionValue.toFixed(2),
    total: realBalance.toFixed(2)
  });

  return realBalance;
}

async function getPrice(symbol) {
  const res = await axios.get(`${BASE_URL}/v3/ticker/price`, { params: { symbol } });
  return parseFloat(res.data.price);
}

async function getCandles(symbol, interval, limit = 100) {
  const res = await axios.get(`${BASE_URL}/v3/klines`, {
    params: { symbol, interval, limit }
  });
  return res.data.map(k => ({
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}

async function getPriceHistory4h(symbol) {
  try {
    const res = await axios.get(`${BASE_URL}/v3/klines`, {
      params: { symbol, interval: '4h', limit: 100 }
    });
    return res.data.map(k => parseFloat(k[4]));
  } catch (err) {
    logger.error(`Erro ao buscar 4h para ${symbol}`, { message: err.message });
    return null;
  }
}

async function getVolume(symbol) {
  const res = await axios.get(`${BASE_URL}/v3/ticker/24hr`, { params: { symbol } });
  return parseFloat(res.data.quoteVolume);
}

async function placeOrder(symbol, side, quantity) {
  try {
    const timestamp = Date.now();
    const params = { symbol, side, type: 'MARKET', quantity, timestamp };
    const query = new URLSearchParams(params).toString();
    const signature = sign(query);
    const res = await axios.post(`${BASE_URL}/v3/order`, null, {
      headers: { 'X-MBX-APIKEY': API_KEY },
      params: { ...params, signature }
    });
    logger.trade(`Ordem executada: ${side} ${symbol}`, { symbol, quantity, orderId: res.data.orderId });
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`Erro ao executar ordem ${side} ${symbol}`, { quantity, detail });
    throw err;
  }
}

async function analyzePair(symbol, sentiment, macroData) {
  try {
    const pairConfig = PAIR_CONFIG[symbol];
    const candles = await getCandles(symbol, pairConfig.interval, 100);
    const candles4h = await getPriceHistory4h(symbol);
    const prices = candles.map(c => c.close);
    const currentPrice = candles[candles.length - 1].close;
    const volume = await getVolume(symbol);

    const rsi = strategy.calculateRSI(prices, 14);
    const smaFast = strategy.calculateSMA(prices, 9);
    const smaSlow = strategy.calculateSMA(prices, 21);
    const macd = strategy.calculateMACD(prices);
    const bb = strategy.calculateBollingerBands(prices, 20, 2);
    const atrData = strategy.calculateATR(candles, 14);
    const trend4h = strategy.getTrend4h(candles4h);
    const candlePattern = strategy.detectCandlePattern(candles);

    const macdConfirma = macd ? macd.histogram > 0 || macd.macdLine > macd.signalLine : true;
    const bbConfirma = bb ? bb.percentB < 0.2 : true;
    const patternConfirma = ['HAMMER', 'BULLISH_ENGULFING'].includes(candlePattern) || candlePattern === 'NONE';
    const volatilityOk = atrData ? atrData.atrPct < 4.0 : true;

    let signal = 'WAIT';
    if (rsi && smaFast && smaSlow) {
      if (
        rsi < pairConfig.rsiBuy &&
        smaFast > smaSlow &&
        macdConfirma &&
        bbConfirma &&
        patternConfirma &&
        volatilityOk &&
        trend4h !== 'BEARISH'
      ) {
        signal = 'BUY';
      } else if (rsi > pairConfig.rsiSell && smaFast < smaSlow) {
        signal = 'SELL';
      }
    }

    const avgVolume = volume / 24;
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;

    const technicalScore = rsi ? calcScore(rsi, sentiment.value, volumeRatio, pairConfig.rsiBuy) : 0;
    const macroScore = calcMacroScore(macroData);
    const score = calcCompositeScore(technicalScore, macroScore);

    logger.info(`Análise ${symbol}`, {
      interval: pairConfig.interval,
      price: currentPrice,
      rsi: rsi ? rsi.toFixed(2) : 'N/A',
      macdHistogram: macd ? macd.histogram.toFixed(4) : 'N/A',
      bbPercentB: bb ? bb.percentB.toFixed(3) : 'N/A',
      atrPct: atrData ? atrData.atrPct.toFixed(2) + '%' : 'N/A',
      trend4h,
      candlePattern,
      signal,
      technicalScore,
      macroScore,
      compositeScore: score
    });

    return {
      symbol, currentPrice, score, technicalScore, macroScore, signal,
      rsi, smaFast, smaSlow, macd, bb, atrData, trend4h, candlePattern,
      volume, candles,
      analysis: { rsi, smaFast, smaSlow, signal }
    };
  } catch (err) {
    logger.error(`Erro ao analisar ${symbol}`, { message: err.message });
    return null;
  }
}

function sendDashboardUpdate(balance, realBalance, validAnalyses, sentiment, news, stats) {
  try {
    const displayBalance = realBalance || balance;
    const balanceChange = initialBalance ? (displayBalance - initialBalance).toFixed(2) : 0;
    const balanceChangePct = initialBalance ? (((displayBalance - initialBalance) / initialBalance) * 100).toFixed(2) : 0;

    const btcData = validAnalyses.find(a => a.symbol === 'BTCUSDC');

    updateDashboard({
      balance: displayBalance.toFixed(2),
      initialBalance: initialBalance ? initialBalance.toFixed(2) : displayBalance.toFixed(2),
      balanceChange,
      balanceChangePct,
      price: btcData ? btcData.currentPrice.toFixed(2) : (lastKnownPrices['BTCUSDC'] ? lastKnownPrices['BTCUSDC'].toFixed(2) : '0'),
      rsi: btcData && btcData.rsi ? btcData.rsi.toFixed(2) : 'N/A',
      smaFast: btcData && btcData.smaFast ? btcData.smaFast.toFixed(2) : 'N/A',
      smaSlow: btcData && btcData.smaSlow ? btcData.smaSlow.toFixed(2) : 'N/A',
      signal: btcData ? btcData.signal : 'WAIT',
      fearGreed: sentiment.value,
      fearGreedLabel: sentiment.classification,
      fearGreedEmoji: getEmoji(sentiment.value),
      news: news.signal,
      newsScore: news.sentimentScore,
      newsTitles: news.recentTitles,
      stats,
      pairs: PAIRS.map(p => {
        const analysis = validAnalyses.find(a => a.symbol === p);

        if (analysis && analysis.currentPrice) {
          lastKnownPrices[p] = analysis.currentPrice;
        }
        const displayPrice = lastKnownPrices[p] || 0;

        return {
          symbol: p,
          inPosition: positions[p].inPosition,
          entryPrice: positions[p].entryPrice,
          stopLoss: positions[p].stopLoss,
          takeProfit: positions[p].takeProfit,
          score: analysis?.score || 0,
          technicalScore: analysis?.technicalScore || 0,
          macroScore: analysis?.macroScore || 0,
          rsi: analysis?.rsi?.toFixed(2) || 'N/A',
          signal: analysis?.signal || 'WAIT',
          currentPrice: displayPrice,
          interval: PAIR_CONFIG[p].interval,
          trend4h: analysis?.trend4h || 'N/A',
          atrPct: analysis?.atrData?.atrPct?.toFixed(2) || 'N/A',
          bbPercentB: analysis?.bb?.percentB?.toFixed(3) || 'N/A',
          candlePattern: analysis?.candlePattern || 'NONE',
          highestPrice: positions[p].highestPrice,
          cooldownRestante: positions[p].lastStopLoss
            ? Math.max(0, Math.round((COOLDOWN_MS - (Date.now() - positions[p].lastStopLoss)) / 60000))
            : 0
        };
      })
    });
  } catch (err) {
    logger.error('Erro ao actualizar dashboard', { message: err.message });
  }
}

async function checkSemestralWithdrawal(balance) {
  try {
    const lastWithdrawal = await loadState('lastWithdrawal');
    const semestralCapital = await loadState('semestralCapital');
    const now = Date.now();

    if (!lastWithdrawal || !semestralCapital) {
      await saveState('lastWithdrawal', now);
      await saveState('semestralCapital', balance);
      logger.info('Referência semestral iniciada', { balance });
      return;
    }

    const elapsed = now - lastWithdrawal;
    if (elapsed < SEMESTRE_MS) {
      const diasRestantes = Math.round((SEMESTRE_MS - elapsed) / (24 * 60 * 60 * 1000));
      logger.info('Próximo levantamento semestral', { diasRestantes });
      return;
    }

    const lucroTotal = balance - semestralCapital;

    if (lucroTotal <= 0) {
      await telegram.sendMessage(telegram.formatAlert(
        `📊 Revisão Semestral\n\nSaldo actual: $${balance.toFixed(2)}\nSaldo há 6 meses: $${semestralCapital.toFixed(2)}\n\nResultado: $${lucroTotal.toFixed(2)}\n\nSemestre negativo — não levantar. A reiniciar contagem.`
      ));
    } else {
      const aLevantar = lucroTotal * 0.50;
      const aFicar = lucroTotal * 0.50;
      const irs28 = aLevantar * 0.28;
      const liquido = aLevantar - irs28;

      await telegram.sendMessage(telegram.formatAlert(
        `🎯 <b>Alerta de Levantamento Semestral!</b>\n\n` +
        `💰 Saldo actual: $${balance.toFixed(2)}\n` +
        `📅 Saldo há 6 meses: $${semestralCapital.toFixed(2)}\n` +
        `📈 Lucro total: +$${lucroTotal.toFixed(2)}\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🏦 <b>A levantar (50%):</b> $${aLevantar.toFixed(2)}\n` +
        `🏦 IRS estimado (28%): -$${irs28.toFixed(2)}\n` +
        `✅ <b>Líquido para conta:</b> $${liquido.toFixed(2)}\n\n` +
        `♻️ Fica a compor (50%): $${aFicar.toFixed(2)}\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `📱 Como levantar:\n` +
        `1. Abre a app Binance\n` +
        `2. Converte USDC → EUR\n` +
        `3. Levanta para o teu IBAN\n\n` +
        `⏰ Próxima revisão: daqui a 6 meses`
      ));
    }

    await saveState('lastWithdrawal', now);
    await saveState('semestralCapital', balance);
    logger.info('Referência semestral actualizada', { balance });

  } catch (err) {
    logger.error('Erro no check semestral', { message: err.message });
  }
}

async function runCycle() {
  // Lock na BD
  try {
    const lastCycleStart = await loadState('lastCycleStart');
    const now = Date.now();
    if (lastCycleStart && (now - lastCycleStart) < CYCLE_LOCK_MS) {
      logger.warn('Ciclo recente detectado na BD — processo duplicado bloqueado', {
        minutosAtras: Math.round((now - lastCycleStart) / 60000)
      });
      return;
    }
    await saveState('lastCycleStart', now);
  } catch (err) {
    logger.warn('Erro ao verificar lock de ciclo — a continuar', { message: err.message });
  }

  let balance = 0;
  let realBalance = 0;
  let sentiment = { value: 50, classification: 'Neutral', signal: 'NEUTRAL' };
  let news = { signal: 'NEUTRAL', sentimentScore: 0, recentTitles: [], blockBuying: false, raw: {} };
  let validAnalyses = [];

  try {
    balance = await getBalance();
    sentiment = await getFearGreedIndex();
    news = await getNewsSentiment();
    realBalance = await getRealBalance(balance);

    logger.info(`Ciclo iniciado`, {
      usdcBalance: balance.toFixed(2),
      realBalance: realBalance.toFixed(2),
      fearGreed: sentiment.value,
      newsSignal: news.signal,
      macroScore: news.sentimentScore,
      blockBuying: news.blockBuying
    });

    await checkSemestralWithdrawal(realBalance);
    await checkAndRunScan();

    // ─── PASSO 1: ANÁLISE DE MERCADO ───
    const analyses = await Promise.all(PAIRS.map(symbol => analyzePair(symbol, sentiment, news)));
    validAnalyses = analyses.filter(a => a !== null);

    // ─── PASSO 2: GERIR POSIÇÕES ABERTAS (SEMPRE — mesmo com daily loss) ───
    for (const data of validAnalyses) {
      const pos = positions[data.symbol];
      if (!pos.inPosition) continue;

      const { currentPrice, symbol, atrData } = data;

      if (!pos.highestPrice || currentPrice > pos.highestPrice) {
        pos.highestPrice = currentPrice;
        await persistPositions();
      }

      // Trailing Stop-Loss adaptativo
      const trailingPct = atrData && atrData.atrPct > 0
        ? Math.min(Math.max(atrData.atrPct * 1.5, 1.5), 4.0) / 100
        : 0.025;
      const newStop = currentPrice * (1 - trailingPct);
      if (newStop > pos.stopLoss) {
        pos.stopLoss = newStop;
        await persistPositions();
      }

      // Trailing Take-Profit
      const gainFromEntry = pos.entryPrice ? (pos.highestPrice - pos.entryPrice) / pos.entryPrice : 0;
      const trailingTPActive = gainFromEntry >= 0.03;
      const trailingTPStop = pos.highestPrice * 0.96;

      if (trailingTPActive && currentPrice <= trailingTPStop) {
        try {
          await placeOrder(symbol, 'SELL', pos.quantity);
          const trade = await recordSell(symbol, currentPrice, 'TRAILING_TP');
          const profit = trade ? trade.profit : 0;
          const maxGainPct = (gainFromEntry * 100).toFixed(2);
          await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
          await telegram.sendMessage(telegram.formatAlert(
            `🎯 Trailing Take-Profit em ${symbol}!\n` +
            `Máximo atingido: $${pos.highestPrice.toFixed(2)} (+${maxGainPct}%)\n` +
            `Vendido a: $${currentPrice.toFixed(2)}\n` +
            `Resultado: +$${profit.toFixed(2)}`
          ));
        } catch (e) { logger.error(`Erro trailing TP ${symbol}`, { message: e.message }); }
        pos.inPosition = false; pos.entryPrice = null; pos.quantity = null;
        pos.highestPrice = null; pos.lastStopLoss = null;
        await persistPositions();
        continue;
      }

      // Stop-Loss
      if (currentPrice <= pos.stopLoss) {
        try {
          await placeOrder(symbol, 'SELL', pos.quantity);
          const trade = await recordSell(symbol, currentPrice, 'STOP_LOSS');
          const profit = trade ? trade.profit : 0;
          await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
          await telegram.sendMessage(telegram.formatAlert(`🛑 Stop-Loss activado em ${symbol}!\nResultado: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}\n⏳ Cooldown de 2h activo.`));
        } catch (e) { logger.error(`Erro venda stop-loss ${symbol}`, { message: e.message }); }
        pos.inPosition = false; pos.entryPrice = null; pos.quantity = null;
        pos.highestPrice = null; pos.lastStopLoss = Date.now();
        await persistPositions();
        continue;
      }

      // Take-Profit fixo
      if (currentPrice >= pos.takeProfit) {
        try {
          await placeOrder(symbol, 'SELL', pos.quantity);
          const trade = await recordSell(symbol, currentPrice, 'TAKE_PROFIT');
          const profit = trade ? trade.profit : 0;
          await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
          await telegram.sendMessage(telegram.formatAlert(`🎯 Take-Profit atingido em ${symbol}!\nResultado: +$${profit.toFixed(2)}`));
        } catch (e) { logger.error(`Erro venda take-profit ${symbol}`, { message: e.message }); }
        pos.inPosition = false; pos.entryPrice = null; pos.quantity = null;
        pos.highestPrice = null; pos.lastStopLoss = null;
        await persistPositions();
        continue;
      }

      // Venda por sinal técnico + macro negativo
      if (data.signal === 'SELL' && news.signal === 'NEGATIVE') {
        try {
          await placeOrder(symbol, 'SELL', pos.quantity);
          const trade = await recordSell(symbol, currentPrice, 'SIGNAL');
          const profit = trade ? trade.profit : 0;
          await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
          await telegram.sendMessage(telegram.formatAlert(`⚠️ Venda antecipada em ${symbol}\nSinal técnico + macro negativo\nResultado: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`));
        } catch (e) { logger.error(`Erro venda signal ${symbol}`, { message: e.message }); }
        pos.inPosition = false; pos.entryPrice = null; pos.quantity = null;
        pos.highestPrice = null; pos.lastStopLoss = Date.now();
        await persistPositions();
      }
    }

    // ─── PASSO 3: DAILY LOSS CHECK (usa saldo REAL, só bloqueia novas compras) ───
    const shouldStop = risk.checkDailyLoss(realBalance);
    if (shouldStop) {
      if (!dailyLossAlertSent) {
        await telegram.sendMessage(telegram.formatAlert(
          `🛑 Limite de perda diária atingido — novas compras pausadas!\n` +
          `Saldo real: $${realBalance.toFixed(2)} (USDC: $${balance.toFixed(2)} + posições)\n` +
          `Posições abertas continuam a ser monitorizadas.`
        ));
        dailyLossAlertSent = true;
      }
      logger.warn('Daily loss limit — novas compras bloqueadas', {
        realBalance: realBalance.toFixed(2),
        usdcBalance: balance.toFixed(2)
      });
    } else {
      dailyLossAlertSent = false;
    }

    const statsFirst = await getStats();
    sendDashboardUpdate(balance, realBalance, validAnalyses, sentiment, news, statsFirst);

    if (news.blockBuying) {
      logger.warn('Macro bloqueou todas as compras', { score: news.sentimentScore });
    }

    // ─── PASSO 4: NOVAS COMPRAS (só se daily loss não activo) ───
    if (!shouldStop) {
      const openCount = PAIRS.filter(p => positions[p].inPosition).length;
      const maxCapital = parseFloat(process.env.MAX_CAPITAL) || realBalance;
      const slotsAvailable = MAX_POSITIONS - openCount;
      const now = Date.now();

      const availableCapital = Math.min(balance, maxCapital);

      if (availableCapital < MIN_TRADE_AMOUNT) {
        logger.warn('Capital insuficiente para qualquer trade', { availableCapital: availableCapital.toFixed(2), minimo: MIN_TRADE_AMOUNT });
      } else if (slotsAvailable > 0 && balance > MIN_TRADE_AMOUNT && !news.blockBuying) {
        if (news.signal === 'NEGATIVE') {
          logger.warn('Macro negativo — compras pausadas', { score: news.sentimentScore });
        } else {
          const pairsWithoutPosition = validAnalyses.filter(a => {
            if (positions[a.symbol].inPosition) return false;

            if (positions[a.symbol].lastStopLoss) {
              const elapsed = now - positions[a.symbol].lastStopLoss;
              if (elapsed < COOLDOWN_MS) {
                const minutosRestantes = Math.round((COOLDOWN_MS - elapsed) / 60000);
                logger.info(`Cooldown activo para ${a.symbol}`, { minutosRestantes });
                return false;
              }
            }

            if (a.score < MIN_SCORE_TO_BUY) {
              logger.info(`Score insuficiente para ${a.symbol}`, {
                compositeScore: a.score,
                technicalScore: a.technicalScore,
                macroScore: a.macroScore,
                minimo: MIN_SCORE_TO_BUY
              });
              return false;
            }

            if (a.trend4h === 'BEARISH') {
              logger.info(`Tendência 4h BEARISH — bloqueado para ${a.symbol}`);
              return false;
            }

            if (a.atrData && a.atrData.atrPct > 4.0) {
              logger.info(`Volatilidade extrema — bloqueado para ${a.symbol}`, { atrPct: a.atrData.atrPct.toFixed(2) });
              return false;
            }

            return true;
          });

          const allocations = allocateCapital(pairsWithoutPosition, availableCapital, slotsAvailable);

          logger.info('Alocação de capital', {
            availableCapital: availableCapital.toFixed(2),
            slotsAvailable,
            candidatos: pairsWithoutPosition.length,
            alocados: allocations.length,
            alocacoes: allocations.map(a => `${a.symbol}: $${a.allocation.toFixed(2)} (score ${a.score})`)
          });

          for (const alloc of allocations) {
            const pos = positions[alloc.symbol];
            if (pos.inPosition) continue;

            const pairConfig = PAIR_CONFIG[alloc.symbol];
            const dynamicAllocation = strategy.getDynamicAllocation(alloc.allocation, alloc.atrData?.atrPct);

            if (dynamicAllocation < MIN_TRADE_AMOUNT) {
              logger.info(`Alocação abaixo do mínimo para ${alloc.symbol}`, {
                alocacao: dynamicAllocation.toFixed(2),
                minimo: MIN_TRADE_AMOUNT
              });
              continue;
            }

            const qty = risk.calculatePositionSize(dynamicAllocation, alloc.currentPrice, alloc.symbol);
            if (qty <= 0) continue;

            const adaptiveStop = strategy.getAdaptiveStopLoss(alloc.currentPrice, alloc.atrData?.atr, 2.0);
            const takeProfit = alloc.currentPrice * (1 + pairConfig.takeProfit);

            try {
              await placeOrder(alloc.symbol, 'BUY', qty);
              pos.inPosition = true;
              pos.entryPrice = alloc.currentPrice;
              pos.stopLoss = adaptiveStop;
              pos.takeProfit = takeProfit;
              pos.quantity = qty;
              pos.lastStopLoss = null;
              pos.highestPrice = alloc.currentPrice;
              await persistPositions();

              await recordBuy(alloc.symbol, alloc.currentPrice, qty, pos.stopLoss, pos.takeProfit);

              const reason = getReason(alloc.score, alloc.rsi, sentiment.value, news);
              const atrPctStr = alloc.atrData ? alloc.atrData.atrPct.toFixed(2) + '%' : 'N/A';
              const allocPct = alloc.atrData ? Math.round(strategy.getDynamicAllocation(100, alloc.atrData.atrPct)) + '%' : '100%';

              await telegram.sendMessage(telegram.formatTrade('BUY', {
                symbol: alloc.symbol,
                price: alloc.currentPrice.toFixed(2),
                quantity: qty,
                stopLoss: pos.stopLoss.toFixed(2),
                takeProfit: pos.takeProfit.toFixed(2)
              }));
              await telegram.sendMessage(telegram.formatAlert(
                `🟢 Compra ${alloc.symbol}\n` +
                `Score: ${alloc.score}/100 (T:${alloc.technicalScore} M:${alloc.macroScore})\n` +
                `Tendência 4h: ${alloc.trend4h}\n` +
                `MACD: ${alloc.macd ? (alloc.macd.histogram > 0 ? '📈 Positivo' : '📉 Negativo') : 'N/A'}\n` +
                `BB %B: ${alloc.bb ? alloc.bb.percentB.toFixed(3) : 'N/A'}\n` +
                `ATR: ${atrPctStr} (alocação: ${allocPct})\n` +
                `Padrão: ${alloc.candlePattern}\n` +
                `Macro: ${news.signal} (${news.sentimentScore})\n` +
                `Razão: ${reason}\n` +
                `Capital: $${dynamicAllocation.toFixed(2)}`
              ));
            } catch (e) {
              logger.error(`Erro ao comprar ${alloc.symbol}`, { message: e.message });
            }
          }
        }
      }
    }

    const stats = await getStats();
    sendDashboardUpdate(balance, realBalance, validAnalyses, sentiment, news, stats);

    const balanceChange = initialBalance ? (realBalance - initialBalance).toFixed(2) : 0;
    const balanceChangePct = initialBalance ? (((realBalance - initialBalance) / initialBalance) * 100).toFixed(2) : 0;

    await telegram.sendMessage(telegram.formatStatus({
      balance: realBalance.toFixed(2),
      balanceChange,
      balanceChangePct,
      fearGreed: sentiment.value,
      fearGreedLabel: sentiment.classification,
      fearGreedEmoji: getEmoji(sentiment.value),
      inPosition: PAIRS.filter(p => positions[p].inPosition).length > 0,
      totalProfit: stats.totalProfit,
      winRate: stats.winRate,
      totalTrades: stats.totalTrades,
      news: news.signal,
      newsScore: news.sentimentScore,
      newsTitles: news.recentTitles,
      pairs: PAIRS.map(p => ({
        symbol: p,
        inPosition: positions[p].inPosition,
        score: validAnalyses.find(a => a.symbol === p)?.score || 0,
        rsi: validAnalyses.find(a => a.symbol === p)?.rsi?.toFixed(2) || 'N/A',
        signal: validAnalyses.find(a => a.symbol === p)?.signal || 'WAIT',
        trend4h: validAnalyses.find(a => a.symbol === p)?.trend4h || 'N/A',
        interval: PAIR_CONFIG[p].interval
      }))
    }));

  } catch (err) {
    logger.error('Erro no ciclo', { message: err.message });
    await telegram.sendMessage(telegram.formatAlert(`Erro no bot: ${err.message}`));
    if (balance > 0) {
      const statsErr = await getStats();
      sendDashboardUpdate(balance, realBalance, validAnalyses, sentiment, news, statsErr);
    }
  }
}

async function start() {
  logger.info('Bot multi-par arrancado', { pairs: PAIRS });
  try { const ipRes = await axios.get('https://api.ipify.org'); logger.info('Railway IP', { ip: ipRes.data }); } catch(e) {}

  await initDB();
  await restorePositions();

  // ─────────────────────────────────────────────────────
  // VALIDAÇÃO DE POSIÇÕES — compara BD com Binance real
  // Se a BD diz "em posição" mas a Binance não tem o asset,
  // limpa a posição fantasma
  // ─────────────────────────────────────────────────────
  try {
    const timestamp = Date.now();
    const recvWindow = 60000;
    const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
    const signature = sign(query);
    const res = await axios.get(`${BASE_URL}/v3/account`, {
      headers: { 'X-MBX-APIKEY': API_KEY },
      params: { timestamp, recvWindow, signature }
    });
    const balances = res.data.balances;

    let positionsFixed = false;
    for (const symbol of PAIRS) {
      const pos = positions[symbol];
      if (!pos.inPosition) continue;

      const asset = symbol.replace('USDC', '');
      const binanceBalance = balances.find(b => b.asset === asset);
      const actualQuantity = binanceBalance ? parseFloat(binanceBalance.free) + parseFloat(binanceBalance.locked) : 0;

      if (actualQuantity < (pos.quantity * 0.5)) {
        logger.warn(`POSIÇÃO FANTASMA detectada: ${symbol}`, {
          esperado: pos.quantity,
          real: actualQuantity,
          accao: 'a limpar'
        });
        pos.inPosition = false;
        pos.entryPrice = null;
        pos.stopLoss = null;
        pos.takeProfit = null;
        pos.quantity = null;
        pos.highestPrice = null;
        pos.lastStopLoss = null;
        positionsFixed = true;

        await telegram.sendMessage(telegram.formatAlert(
          `⚠️ Posição fantasma detectada em ${symbol}\n` +
          `BD dizia: em posição\n` +
          `Binance real: ${actualQuantity} unidades\n` +
          `Posição limpa automaticamente.`
        ));
      } else {
        logger.info(`Posição validada: ${symbol}`, {
          esperado: pos.quantity,
          real: actualQuantity
        });
      }
    }

    if (positionsFixed) {
      await persistPositions();
      logger.info('Posições fantasma limpas e persistidas');
    }
  } catch (err) {
    logger.warn('Erro na validação de posições — a continuar com BD', { message: err.message });
  }

  const savedBalance = await loadState('initialBalance');
  let balance;
  try {
    balance = await getBalance();
    logger.info('Saldo obtido com sucesso', { balance });
  } catch (err) {
    logger.error('Erro ao obter saldo inicial', {
      message: err.message,
      detail: err.response?.data
    });
    throw err;
  }

  if (savedBalance) {
    initialBalance = savedBalance;
    logger.info('Saldo inicial recuperado', { initialBalance });
  } else {
    initialBalance = balance;
    await saveState('initialBalance', balance);
  }

  const realBal = await getRealBalance(balance);
  risk.setDailyStartBalance(realBal);

  await telegram.sendMessage(`🚀 <b>Trading Bot arrancou!</b>
Pares: ${PAIRS.join(', ')}
BTC → 30min | RSI 40/60
ETH → 1h | RSI 35/65
BNB → 1h | RSI 40/60
Score mínimo: ${MIN_SCORE_TO_BUY}/100
Max posições: ${MAX_POSITIONS}
Min trade: $${MIN_TRADE_AMOUNT}
Cooldown após SL: 2 horas
Indicadores: RSI + SMA + MACD + BB + ATR
Confirmação: Tendência 4h + Padrões de velas
Stop-Loss: Adaptativo (2x ATR)
Trailing Take-Profit: activo após +3%
Position Sizing: Dinâmico por volatilidade
Macro Overlay: Fear&Greed + Market Cap + BTC7d + ATH + ETF Flows
Alerta semestral: 50% lucros activo
Posições em memória: ${PAIRS.filter(p => positions[p].inPosition).join(', ') || 'nenhuma'}`);

  async function loop() {
    try {
      await runCycle();
    } catch(e) {
      logger.error('Erro no loop', { message: e.message });
    } finally {
      setTimeout(loop, CYCLE_INTERVAL_MS);
    }
  }
  loop();
}

module.exports = { start };