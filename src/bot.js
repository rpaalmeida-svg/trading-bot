const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { updateDashboard } = require('./dashboard');
const logger = require('./logger');
const strategy = require('./strategy');
const risk = require('./risk');
const telegram = require('./telegram');
const { getFearGreedIndex, getEmoji } = require('./sentiment');
const { PAIRS, PAIR_CONFIG, calcScore, allocateCapital, getReason } = require('./portfolio');
const { recordBuy, recordSell, getStats } = require('./history');
const { getNewsSentiment } = require('./news');

const BASE_URL = 'https://testnet.binance.vision/api';
const API_KEY = process.env.BINANCE_API_KEY;
const SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const POSITIONS_FILE = path.join(__dirname, '../logs/positions.json');
const STATE_FILE = path.join(__dirname, '../logs/state.json');

let initialBalance = null;

const positions = {};
PAIRS.forEach(p => {
  positions[p] = {
    inPosition: false,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    quantity: null
  };
});

function savePositions() {
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
}

function loadPositions() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
      PAIRS.forEach(p => {
        if (data[p]) positions[p] = data[p];
      });
      logger.info('Posições carregadas', { positions });
    }
  } catch (err) {
    logger.error('Erro ao carregar posições', { message: err.message });
  }
}

function saveState(balance) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ initialBalance: balance }, null, 2));
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return data.initialBalance || null;
    }
  } catch (err) {
    logger.error('Erro ao carregar estado', { message: err.message });
  }
  return null;
}

function sign(queryString) {
  return crypto.createHmac('sha256', SECRET_KEY).update(queryString).digest('hex');
}

async function getBalance() {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = sign(query);
  const res = await axios.get(`${BASE_URL}/v3/account`, {
    headers: { 'X-MBX-APIKEY': API_KEY },
    params: { timestamp, signature }
  });
  const usdt = res.data.balances.find(b => b.asset === 'USDT');
  return parseFloat(usdt?.free || 0);
}

async function getPrice(symbol) {
  const res = await axios.get(`${BASE_URL}/v3/ticker/price`, { params: { symbol } });
  return parseFloat(res.data.price);
}

async function getPriceHistory(symbol) {
  const config = PAIR_CONFIG[symbol];
  const res = await axios.get(`${BASE_URL}/v3/klines`, {
    params: { symbol, interval: config.interval, limit: 50 }
  });
  return res.data.map(k => parseFloat(k[4]));
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

async function analyzePair(symbol, sentiment) {
  try {
    const prices = await getPriceHistory(symbol);
    const currentPrice = await getPrice(symbol);
    const volume = await getVolume(symbol);
    const pairConfig = PAIR_CONFIG[symbol];

    const rsi = strategy.calculateRSI(prices, 14);
    const smaFast = strategy.calculateSMA(prices, 9);
    const smaSlow = strategy.calculateSMA(prices, 21);

    let signal = 'WAIT';
    if (rsi && smaFast && smaSlow) {
      if (rsi < pairConfig.rsiBuy && smaFast > smaSlow) signal = 'BUY';
      else if (rsi > pairConfig.rsiSell && smaFast < smaSlow) signal = 'SELL';
    }

    const avgVolume = volume / 24;
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
    const score = rsi ? calcScore(rsi, sentiment.value, volumeRatio, pairConfig.rsiBuy) : 0;

    logger.info(`Análise ${symbol}`, {
      interval: pairConfig.interval,
      price: currentPrice,
      rsi: rsi ? rsi.toFixed(2) : 'N/A',
      signal,
      score
    });

    return { symbol, currentPrice, analysis: { rsi, smaFast, smaSlow, signal }, score, signal, rsi, smaFast, smaSlow, volume };
  } catch (err) {
    logger.error(`Erro ao analisar ${symbol}`, { message: err.message });
    return null;
  }
}

function sendDashboardUpdate(balance, validAnalyses, sentiment, news, stats) {
  try {
    const balanceChange = initialBalance ? (balance - initialBalance).toFixed(2) : 0;
    const balanceChangePct = initialBalance ? (((balance - initialBalance) / initialBalance) * 100).toFixed(2) : 0;
    const btcData = validAnalyses.find(a => a.symbol === 'BTCUSDT');

    updateDashboard({
      balance: balance.toFixed(2),
      initialBalance: initialBalance ? initialBalance.toFixed(2) : balance.toFixed(2),
      balanceChange,
      balanceChangePct,
      price: btcData ? btcData.currentPrice.toFixed(2) : '0',
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
      pairs: PAIRS.map(p => ({
        symbol: p,
        inPosition: positions[p].inPosition,
        entryPrice: positions[p].entryPrice,
        stopLoss: positions[p].stopLoss,
        takeProfit: positions[p].takeProfit,
        score: validAnalyses.find(a => a.symbol === p)?.score || 0,
        rsi: validAnalyses.find(a => a.symbol === p)?.rsi?.toFixed(2) || 'N/A',
        signal: validAnalyses.find(a => a.symbol === p)?.signal || 'WAIT',
        currentPrice: validAnalyses.find(a => a.symbol === p)?.currentPrice || 0,
        interval: PAIR_CONFIG[p].interval
      }))
    });
  } catch (err) {
    logger.error('Erro ao actualizar dashboard', { message: err.message });
  }
}

async function runCycle() {
  let balance = 0;
  let sentiment = { value: 50, classification: 'Neutral', signal: 'NEUTRAL' };
  let news = { signal: 'NEUTRAL', sentimentScore: 0, recentTitles: [] };
  let validAnalyses = [];

  try {
    balance = await getBalance();
    sentiment = await getFearGreedIndex();
    news = await getNewsSentiment();

    logger.info(`Ciclo iniciado`, { balance: balance.toFixed(2), fearGreed: sentiment.value, newsSignal: news.signal });

    const shouldStop = risk.checkDailyLoss(balance);
    if (shouldStop) {
      await telegram.sendMessage(telegram.formatAlert('🛑 Limite de perda diária atingido — bot pausado!'));
      sendDashboardUpdate(balance, [], sentiment, news, getStats());
      return;
    }

    const analyses = await Promise.all(PAIRS.map(symbol => analyzePair(symbol, sentiment)));
    validAnalyses = analyses.filter(a => a !== null);

    // Actualizar dashboard logo após análise — mesmo antes de comprar/vender
    sendDashboardUpdate(balance, validAnalyses, sentiment, news, getStats());

    // Gerir posições abertas
    for (const data of validAnalyses) {
      const pos = positions[data.symbol];
      if (!pos.inPosition) continue;

      const { currentPrice, symbol } = data;

      pos.stopLoss = risk.updateTrailingStop(currentPrice, pos.stopLoss);
      savePositions();

      if (currentPrice <= pos.stopLoss) {
        try {
          await placeOrder(symbol, 'SELL', pos.quantity);
          const trade = recordSell(symbol, currentPrice, 'STOP_LOSS');
          const profit = trade ? trade.profit : 0;
          await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
          await telegram.sendMessage(telegram.formatAlert(`🛑 Stop-Loss activado em ${symbol}!\nResultado: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`));
        } catch (e) { logger.error(`Erro venda stop-loss ${symbol}`, { message: e.message }); }
        pos.inPosition = false; pos.entryPrice = null; pos.quantity = null;
        savePositions();
        continue;
      }

      if (currentPrice >= pos.takeProfit) {
        try {
          await placeOrder(symbol, 'SELL', pos.quantity);
          const trade = recordSell(symbol, currentPrice, 'TAKE_PROFIT');
          const profit = trade ? trade.profit : 0;
          await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
          await telegram.sendMessage(telegram.formatAlert(`🎯 Take-Profit atingido em ${symbol}!\nResultado: +$${profit.toFixed(2)}`));
        } catch (e) { logger.error(`Erro venda take-profit ${symbol}`, { message: e.message }); }
        pos.inPosition = false; pos.entryPrice = null; pos.quantity = null;
        savePositions();
        continue;
      }

      if (data.signal === 'SELL' && sentiment.signal === 'SELL' && news.signal === 'NEGATIVE') {
        try {
          await placeOrder(symbol, 'SELL', pos.quantity);
          const trade = recordSell(symbol, currentPrice, 'SIGNAL');
          const profit = trade ? trade.profit : 0;
          await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
          await telegram.sendMessage(telegram.formatAlert(`⚠️ Venda antecipada em ${symbol}\nResultado: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`));
        } catch (e) { logger.error(`Erro venda signal ${symbol}`, { message: e.message }); }
        pos.inPosition = false; pos.entryPrice = null; pos.quantity = null;
        savePositions();
      }
    }

    // Novas compras
    const openCount = PAIRS.filter(p => positions[p].inPosition).length;
    const maxCapital = parseFloat(process.env.MAX_CAPITAL) || balance;
    const capitalPerPair = maxCapital / PAIRS.length;

    if (capitalPerPair < 10) {
      logger.warn('Capital insuficiente por par', { capitalPerPair });
    } else if (openCount < PAIRS.length && balance > 10) {
      if (news.signal === 'NEGATIVE') {
        logger.warn('Notícias negativas — compras pausadas', { score: news.sentimentScore });
        await telegram.sendMessage(telegram.formatAlert(`📰 Notícias negativas (score: ${news.sentimentScore})\nCompras pausadas neste ciclo.`));
      } else {
        const pairsWithoutPosition = validAnalyses.filter(a => !positions[a.symbol].inPosition);
        const allocations = allocateCapital(pairsWithoutPosition, capitalPerPair * pairsWithoutPosition.length);

        for (const alloc of allocations) {
          const pos = positions[alloc.symbol];
          if (pos.inPosition) continue;

          const pairConfig = PAIR_CONFIG[alloc.symbol];
          const safeAllocation = Math.min(alloc.allocation, capitalPerPair);

          if (safeAllocation < 10) {
            logger.warn(`Capital insuficiente para ${alloc.symbol}`, { safeAllocation });
            continue;
          }

          const qty = risk.calculatePositionSize(safeAllocation, alloc.currentPrice, alloc.symbol);
          if (qty <= 0) {
            logger.warn(`Quantidade inválida para ${alloc.symbol}`, { qty, safeAllocation, price: alloc.currentPrice });
            continue;
          }

          try {
            await placeOrder(alloc.symbol, 'BUY', qty);
            pos.inPosition = true;
            pos.entryPrice = alloc.currentPrice;
            pos.stopLoss = alloc.currentPrice * (1 - pairConfig.stopLoss);
            pos.takeProfit = alloc.currentPrice * (1 + pairConfig.takeProfit);
            pos.quantity = qty;
            savePositions();

            recordBuy(alloc.symbol, alloc.currentPrice, qty, pos.stopLoss, pos.takeProfit);

            const reason = getReason(alloc.score, alloc.rsi, sentiment.value);
            await telegram.sendMessage(telegram.formatTrade('BUY', {
              symbol: alloc.symbol,
              price: alloc.currentPrice.toFixed(2),
              quantity: qty,
              stopLoss: pos.stopLoss.toFixed(2),
              takeProfit: pos.takeProfit.toFixed(2)
            }));
            await telegram.sendMessage(telegram.formatAlert(
              `🟢 Compra ${alloc.symbol}\nScore: ${alloc.score}/100\nTimeframe: ${pairConfig.interval}\nRSI Buy: ${pairConfig.rsiBuy}\nRazão: ${reason}\nNotícias: ${news.signal}\nCapital: $${safeAllocation.toFixed(2)}`
            ));
          } catch (e) {
            logger.error(`Erro ao comprar ${alloc.symbol}`, { message: e.message });
          }
        }
      }
    }

    // Actualizar dashboard final com posições actualizadas
    sendDashboardUpdate(balance, validAnalyses, sentiment, news, getStats());

    const stats = getStats();
    const balanceChange = initialBalance ? (balance - initialBalance).toFixed(2) : 0;
    const balanceChangePct = initialBalance ? (((balance - initialBalance) / initialBalance) * 100).toFixed(2) : 0;

    await telegram.sendMessage(telegram.formatStatus({
      balance: balance.toFixed(2),
      balanceChange,
      balanceChangePct,
      fearGreed: sentiment.value,
      fearGreedLabel: sentiment.classification,
      fearGreedEmoji: getEmoji(sentiment.value),
      inPosition: openCount > 0,
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
        interval: PAIR_CONFIG[p].interval
      }))
    }));

  } catch (err) {
    logger.error('Erro no ciclo', { message: err.message });
    await telegram.sendMessage(telegram.formatAlert(`Erro no bot: ${err.message}`));
    // Mesmo com erro — actualizar dashboard com o que temos
    if (balance > 0) {
      sendDashboardUpdate(balance, validAnalyses, sentiment, news, getStats());
    }
  }
}

async function start() {
  logger.info('Bot multi-par arrancado', { pairs: PAIRS });

  loadPositions();
  const savedInitialBalance = loadState();
  const balance = await getBalance();

  if (savedInitialBalance) {
    initialBalance = savedInitialBalance;
    logger.info('Saldo inicial recuperado', { initialBalance });
  } else {
    initialBalance = balance;
    saveState(balance);
  }

  risk.setDailyStartBalance(balance);

  await telegram.sendMessage(`🚀 <b>Trading Bot arrancou!</b>
Pares: ${PAIRS.join(', ')}
BTC → 1h | RSI 35/65
ETH → 30min | RSI 35/65
BNB → 1h | RSI 40/60
Stop-Loss: 2.5% | Take-Profit: 5%
Posições em memória: ${PAIRS.filter(p => positions[p].inPosition).join(', ') || 'nenhuma'}`);

  runCycle();
  setInterval(runCycle, 30 * 60 * 1000);
}

module.exports = { start };