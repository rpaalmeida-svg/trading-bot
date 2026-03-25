const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const { updateDashboard } = require('./dashboard');
const logger = require('./logger');
const strategy = require('./strategy');
const risk = require('./risk');
const telegram = require('./telegram');
const { getFearGreedIndex, getEmoji } = require('./sentiment');
const { PAIRS, calcScore, allocateCapital, getReason } = require('./portfolio');
const { recordBuy, recordSell, getStats } = require('./history');

const BASE_URL = 'https://testnet.binance.vision/api';
const API_KEY = process.env.BINANCE_API_KEY;
const SECRET_KEY = process.env.BINANCE_SECRET_KEY;

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

function sign(queryString) {
  return crypto
    .createHmac('sha256', SECRET_KEY)
    .update(queryString)
    .digest('hex');
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
  const res = await axios.get(`${BASE_URL}/v3/ticker/price`, {
    params: { symbol }
  });
  return parseFloat(res.data.price);
}

async function getPriceHistory(symbol) {
  const res = await axios.get(`${BASE_URL}/v3/klines`, {
    params: { symbol, interval: '15m', limit: 50 }
  });
  return res.data.map(k => parseFloat(k[4]));
}

async function getVolume(symbol) {
  const res = await axios.get(`${BASE_URL}/v3/ticker/24hr`, {
    params: { symbol }
  });
  return parseFloat(res.data.quoteVolume);
}

async function placeOrder(symbol, side, quantity) {
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
}

async function analyzePair(symbol, sentiment) {
  try {
    const prices = await getPriceHistory(symbol);
    const currentPrice = await getPrice(symbol);
    const volume = await getVolume(symbol);
    const analysis = strategy.analyzeMarket(prices);
    const avgVolume = volume / 24;
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
    const score = analysis.rsi ? calcScore(analysis.rsi, sentiment.value, volumeRatio) : 0;

    logger.info(`Análise ${symbol}`, {
      price: currentPrice,
      rsi: analysis.rsi ? analysis.rsi.toFixed(2) : 'N/A',
      signal: analysis.signal,
      score
    });

    return { symbol, currentPrice, prices, analysis, score, signal: analysis.signal, rsi: analysis.rsi, smaFast: analysis.smaFast, smaSlow: analysis.smaSlow, volume };
  } catch (err) {
    logger.error(`Erro ao analisar ${symbol}`, { message: err.message });
    return null;
  }
}

async function runCycle() {
  try {
    const balance = await getBalance();
    const sentiment = await getFearGreedIndex();

    logger.info(`Ciclo iniciado`, { balance: balance.toFixed(2), fearGreed: sentiment.value });

    const shouldStop = risk.checkDailyLoss(balance);
    if (shouldStop) {
      await telegram.sendMessage(telegram.formatAlert('🛑 Limite de perda diária atingido — bot pausado!'));
      return;
    }

    const analyses = await Promise.all(PAIRS.map(symbol => analyzePair(symbol, sentiment)));
    const validAnalyses = analyses.filter(a => a !== null);

    // Gerir posições abertas
    for (const data of validAnalyses) {
      const pos = positions[data.symbol];
      if (!pos.inPosition) continue;

      const { currentPrice, symbol, analysis } = data;

      // Actualizar Trailing Stop-Loss
      pos.stopLoss = risk.updateTrailingStop(currentPrice, pos.stopLoss);

      if (currentPrice <= pos.stopLoss) {
        await placeOrder(symbol, 'SELL', pos.quantity);
        const trade = recordSell(symbol, currentPrice, 'STOP_LOSS');
        const profit = trade ? trade.profit : 0;
        await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
        await telegram.sendMessage(telegram.formatAlert(`🛑 Stop-Loss activado em ${symbol}!\nResultado: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`));
        pos.inPosition = false; pos.entryPrice = null;
        continue;
      }

      if (currentPrice >= pos.takeProfit) {
        await placeOrder(symbol, 'SELL', pos.quantity);
        const trade = recordSell(symbol, currentPrice, 'TAKE_PROFIT');
        const profit = trade ? trade.profit : 0;
        await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
        await telegram.sendMessage(telegram.formatAlert(`🎯 Take-Profit atingido em ${symbol}!\nResultado: +$${profit.toFixed(2)}`));
        pos.inPosition = false; pos.entryPrice = null;
        continue;
      }

      if (analysis.signal === 'SELL' && sentiment.signal === 'SELL') {
        await placeOrder(symbol, 'SELL', pos.quantity);
        const trade = recordSell(symbol, currentPrice, 'SIGNAL');
        const profit = trade ? trade.profit : 0;
        await telegram.sendMessage(telegram.formatTrade('SELL', { symbol, price: currentPrice.toFixed(2), quantity: pos.quantity, profit: profit.toFixed(2) }));
        await telegram.sendMessage(telegram.formatAlert(`⚠️ Venda antecipada em ${symbol}\nResultado: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`));
        pos.inPosition = false; pos.entryPrice = null;
      }
    }

    // Novas compras
    const availableCapital = balance;
    const openCount = PAIRS.filter(p => positions[p].inPosition).length;

    if (openCount < PAIRS.length && availableCapital > 10) {
      const maxCapital = parseFloat(process.env.MAX_CAPITAL) || availableCapital;
      const capitalToUse = Math.min(availableCapital, maxCapital);
      const allocations = allocateCapital(validAnalyses, capitalToUse);

      for (const alloc of allocations) {
        const pos = positions[alloc.symbol];
        if (pos.inPosition) continue;

        const qty = risk.calculatePositionSize(alloc.allocation, alloc.currentPrice, alloc.symbol);
        if (qty <= 0) continue;

        await placeOrder(alloc.symbol, 'BUY', qty);
        pos.inPosition = true;
        pos.entryPrice = alloc.currentPrice;
        pos.stopLoss = risk.calculateStopLoss(alloc.currentPrice);
        pos.takeProfit = risk.calculateTakeProfit(alloc.currentPrice);
        pos.quantity = qty;

        recordBuy(alloc.symbol, alloc.currentPrice, qty, pos.stopLoss, pos.takeProfit);

        const reason = getReason(alloc.score, alloc.rsi, sentiment.value);
        await telegram.sendMessage(telegram.formatTrade('BUY', { symbol: alloc.symbol, price: alloc.currentPrice.toFixed(2), quantity: qty, stopLoss: pos.stopLoss.toFixed(2), takeProfit: pos.takeProfit.toFixed(2) }));
        await telegram.sendMessage(telegram.formatAlert(`🟢 Compra ${alloc.symbol}\nScore: ${alloc.score}/100\nRazão: ${reason}\nCapital: $${alloc.allocation.toFixed(2)}`));
      }
    }

    // Stats para dashboard
    const stats = getStats();

    // Actualizar dashboard
    const btcData = validAnalyses.find(a => a.symbol === 'BTCUSDT');
    if (btcData) {
      updateDashboard({
        balance: balance.toFixed(2),
        price: btcData.currentPrice.toFixed(2),
        rsi: btcData.rsi ? btcData.rsi.toFixed(2) : 'N/A',
        smaFast: btcData.smaFast ? btcData.smaFast.toFixed(2) : 'N/A',
        smaSlow: btcData.smaSlow ? btcData.smaSlow.toFixed(2) : 'N/A',
        signal: btcData.signal,
        fearGreed: sentiment.value,
        fearGreedLabel: sentiment.classification,
        fearGreedEmoji: getEmoji(sentiment.value),
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
          currentPrice: validAnalyses.find(a => a.symbol === p)?.currentPrice || 0
        }))
      });
    }

    await telegram.sendMessage(telegram.formatStatus({
      balance: balance.toFixed(2),
      fearGreed: sentiment.value,
      fearGreedLabel: sentiment.classification,
      fearGreedEmoji: getEmoji(sentiment.value),
      inPosition: openCount > 0,
      totalProfit: stats.totalProfit,
      winRate: stats.winRate,
      totalTrades: stats.totalTrades,
      pairs: PAIRS.map(p => ({
        symbol: p,
        inPosition: positions[p].inPosition,
        score: validAnalyses.find(a => a.symbol === p)?.score || 0,
        rsi: validAnalyses.find(a => a.symbol === p)?.rsi?.toFixed(2) || 'N/A',
        signal: validAnalyses.find(a => a.symbol === p)?.signal || 'WAIT'
      }))
    }));

  } catch (err) {
    logger.error('Erro no ciclo', { message: err.message });
    await telegram.sendMessage(telegram.formatAlert(`Erro no bot: ${err.message}`));
  }
}

async function start() {
  logger.info('Bot multi-par arrancado', { pairs: PAIRS });
  await telegram.sendMessage(`🚀 <b>Trading Bot Multi-Par arrancou!</b>\nA monitorizar: ${PAIRS.join(', ')} de 15 em 15 minutos.`);
  const balance = await getBalance();
  risk.setDailyStartBalance(balance);
  runCycle();
  setInterval(runCycle, 15 * 60 * 1000);
}

module.exports = { start };