const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const { updateDashboard } = require('./dashboard');
const logger = require('./logger');
const strategy = require('./strategy');
const risk = require('./risk');
const telegram = require('./telegram');
const { getFearGreedIndex, getEmoji } = require('./sentiment');

const BASE_URL = 'https://testnet.binance.vision/api';
const API_KEY = process.env.BINANCE_API_KEY;
const SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const SYMBOL = process.env.SYMBOL || 'BTCUSDT';

let prices = [];
let inPosition = false;
let entryPrice = null;
let stopLoss = null;
let takeProfit = null;

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

async function getPrice() {
  const res = await axios.get(`${BASE_URL}/v3/ticker/price`, {
    params: { symbol: SYMBOL }
  });
  return parseFloat(res.data.price);
}

async function getPriceHistory() {
  const res = await axios.get(`${BASE_URL}/v3/klines`, {
    params: { symbol: SYMBOL, interval: '15m', limit: 50 }
  });
  return res.data.map(k => parseFloat(k[4]));
}

async function placeOrder(side, quantity) {
  const timestamp = Date.now();
  const params = {
    symbol: SYMBOL,
    side,
    type: 'MARKET',
    quantity,
    timestamp
  };

  const query = new URLSearchParams(params).toString();
  const signature = sign(query);

  const res = await axios.post(
    `${BASE_URL}/v3/order`,
    null,
    {
      headers: { 'X-MBX-APIKEY': API_KEY },
      params: { ...params, signature }
    }
  );

  logger.trade(`Ordem executada: ${side}`, {
    symbol: SYMBOL,
    quantity,
    orderId: res.data.orderId
  });

  return res.data;
}

async function runCycle() {
  try {
    const balance = await getBalance();
    const currentPrice = await getPrice();
    prices = await getPriceHistory();

    const analysis = strategy.analyzeMarket(prices);
    const sentiment = await getFearGreedIndex();

    logger.info(`Saldo: $${balance.toFixed(2)} | Preço BTC: $${currentPrice.toFixed(2)} | Fear&Greed: ${sentiment.value} (${sentiment.classification})`);

    // Actualizar dashboard
    updateDashboard({
      balance: balance.toFixed(2),
      price: currentPrice.toFixed(2),
      rsi: analysis.rsi ? analysis.rsi.toFixed(2) : 'N/A',
      smaFast: analysis.smaFast ? analysis.smaFast.toFixed(2) : 'N/A',
      smaSlow: analysis.smaSlow ? analysis.smaSlow.toFixed(2) : 'N/A',
      signal: analysis.signal,
      fearGreed: sentiment.value,
      fearGreedLabel: sentiment.classification,
      fearGreedEmoji: getEmoji(sentiment.value),
      inPosition,
      entryPrice: entryPrice ? entryPrice.toFixed(2) : null,
      stopLoss: stopLoss ? stopLoss.toFixed(2) : null,
      takeProfit: takeProfit ? takeProfit.toFixed(2) : null,
    });

    // Enviar ponto de situação ao Telegram
    await telegram.sendMessage(telegram.formatStatus({
      balance: balance.toFixed(2),
      price: currentPrice.toFixed(2),
      rsi: analysis.rsi ? analysis.rsi.toFixed(2) : 'N/A',
      smaFast: analysis.smaFast ? analysis.smaFast.toFixed(2) : 'N/A',
      smaSlow: analysis.smaSlow ? analysis.smaSlow.toFixed(2) : 'N/A',
      fearGreed: sentiment.value,
      fearGreedLabel: sentiment.classification,
      fearGreedEmoji: getEmoji(sentiment.value),
      inPosition,
      entryPrice: entryPrice ? entryPrice.toFixed(2) : null,
      stopLoss: stopLoss ? stopLoss.toFixed(2) : null,
      takeProfit: takeProfit ? takeProfit.toFixed(2) : null,
    }));

    // Verificar limite de perda diária
    const shouldStop = risk.checkDailyLoss(balance);
    if (shouldStop) {
      await telegram.sendMessage(telegram.formatAlert('🛑 Limite de perda diária atingido — bot pausado!'));
      return;
    }

    // Lógica de decisão combinada — técnica + sentimento
    const techBuy = analysis.signal === 'BUY';
    const techSell = analysis.signal === 'SELL';
    const sentimentBuy = sentiment.signal === 'BUY' || sentiment.signal === 'NEUTRAL';
    const sentimentSell = sentiment.signal === 'SELL';

    // Se estiver em posição — verificar stop-loss e take-profit
    if (inPosition) {
      if (currentPrice <= stopLoss) {
        const qty = risk.calculatePositionSize(balance, currentPrice);
        await placeOrder('SELL', qty);
        await telegram.sendMessage(telegram.formatTrade('SELL', {
          symbol: SYMBOL,
          price: currentPrice.toFixed(2),
          quantity: qty,
          profit: (currentPrice - entryPrice).toFixed(2)
        }));
        await telegram.sendMessage(telegram.formatAlert('🛑 Stop-Loss activado!'));
        inPosition = false;
        entryPrice = null;
        return;
      }

      if (currentPrice >= takeProfit) {
        const qty = risk.calculatePositionSize(balance, currentPrice);
        await placeOrder('SELL', qty);
        await telegram.sendMessage(telegram.formatTrade('SELL', {
          symbol: SYMBOL,
          price: currentPrice.toFixed(2),
          quantity: qty,
          profit: (currentPrice - entryPrice).toFixed(2)
        }));
        inPosition = false;
        entryPrice = null;
        return;
      }

      // Venda antecipada se sentimento muito negativo
      if (techSell && sentimentSell) {
        const qty = risk.calculatePositionSize(balance, currentPrice);
        await placeOrder('SELL', qty);
        await telegram.sendMessage(telegram.formatTrade('SELL', {
          symbol: SYMBOL,
          price: currentPrice.toFixed(2),
          quantity: qty,
          profit: (currentPrice - entryPrice).toFixed(2)
        }));
        await telegram.sendMessage(telegram.formatAlert(`⚠️ Venda antecipada — RSI alto + Fear&Greed: ${sentiment.value} (${sentiment.classification})`));
        inPosition = false;
        entryPrice = null;
        return;
      }

      return;
    }

    // Comprar apenas se técnica E sentimento concordam
    if (techBuy && sentimentBuy && balance > 10) {
      const qty = risk.calculatePositionSize(balance, currentPrice);
      await placeOrder('BUY', qty);
      inPosition = true;
      entryPrice = currentPrice;
      stopLoss = risk.calculateStopLoss(currentPrice);
      takeProfit = risk.calculateTakeProfit(currentPrice);

      await telegram.sendMessage(telegram.formatTrade('BUY', {
        symbol: SYMBOL,
        price: currentPrice.toFixed(2),
        quantity: qty,
        stopLoss: stopLoss.toFixed(2),
        takeProfit: takeProfit.toFixed(2)
      }));

      await telegram.sendMessage(telegram.formatAlert(`🟢 Compra confirmada!\nRSI: ${analysis.rsi.toFixed(2)} + Fear&Greed: ${sentiment.value} (${sentiment.classification})`));
    }

  } catch (err) {
    logger.error('Erro no ciclo', { message: err.message });
    await telegram.sendMessage(telegram.formatAlert(`Erro no bot: ${err.message}`));
  }
}

async function start() {
  logger.info('Bot arrancado', { symbol: SYMBOL });
  await telegram.sendMessage('🚀 <b>Trading Bot arrancou!</b>\nA monitorizar ' + SYMBOL + ' de 15 em 15 minutos.');

  const balance = await getBalance();
  risk.setDailyStartBalance(balance);

  runCycle();
  setInterval(runCycle, 15 * 60 * 1000);
}

module.exports = { start };