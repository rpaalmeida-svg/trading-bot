const logger = require('./logger');

// --- INDICADORES TÉCNICOS ---

function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const slice = prices.slice(-period - 1);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
  if (prices.length < 35) return null;
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;

  // Signal line = EMA9 do MACD
  const macdValues = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i), 12);
    const e26 = calculateEMA(prices.slice(0, i), 26);
    if (e12 && e26) macdValues.push(e12 - e26);
  }
  const signalLine = calculateEMA(macdValues, 9);
  const histogram = macdLine - (signalLine || 0);

  return { macdLine, signalLine, histogram };
}

// --- TENDÊNCIA DE 4H ---
// Retorna: 'BULLISH', 'BEARISH', ou 'NEUTRAL'
function getTrend4h(prices4h) {
  if (!prices4h || prices4h.length < 50) return 'NEUTRAL';

  const sma20 = calculateSMA(prices4h, 20);
  const sma50 = calculateSMA(prices4h, 50);
  const rsi4h = calculateRSI(prices4h, 14);
  const currentPrice = prices4h[prices4h.length - 1];

  if (!sma20 || !sma50 || !rsi4h) return 'NEUTRAL';

  // Bullish: preço acima das médias E médias em ordem crescente E RSI não sobrecomprado
  if (currentPrice > sma20 && sma20 > sma50 && rsi4h < 70) {
    return 'BULLISH';
  }

  // Bearish: preço abaixo das médias E médias em ordem decrescente
  if (currentPrice < sma20 && sma20 < sma50) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}

// --- DECISÃO DE TRADING ---
function analyzeMarket(prices, prices4h = null, rsiBuy = 35, rsiSell = 65) {
  const rsi = calculateRSI(prices, 14);
  const smaFast = calculateSMA(prices, 9);
  const smaSlow = calculateSMA(prices, 21);
  const macd = calculateMACD(prices);
  const currentPrice = prices[prices.length - 1];
  const trend4h = getTrend4h(prices4h);

  if (!rsi || !smaFast || !smaSlow) {
    return { signal: 'WAIT', rsi, smaFast, smaSlow, currentPrice, trend4h };
  }

  // Bloquear compra se tendência de 4h é BEARISH
  if (trend4h === 'BEARISH') {
    logger.info('Tendência 4h BEARISH — compra bloqueada', { trend4h });
    return { signal: 'WAIT', rsi, smaFast, smaSlow, macd, currentPrice, trend4h, blockedBy: '4h_bearish' };
  }

  // MACD confirma momentum positivo?
  const macdConfirma = macd ? macd.histogram > 0 || macd.macdLine > macd.signalLine : true;

  // SINAL DE COMPRA
  // RSI baixo + SMA cruzamento + MACD confirma + tendência não bearish
  if (rsi < rsiBuy && smaFast > smaSlow && macdConfirma) {
    logger.info('SINAL: COMPRAR', {
      rsi: rsi.toFixed(2),
      trend4h,
      macdHistogram: macd?.histogram?.toFixed(4)
    });
    return { signal: 'BUY', rsi, smaFast, smaSlow, macd, currentPrice, trend4h };
  }

  // SINAL DE VENDA
  if (rsi > rsiSell && smaFast < smaSlow) {
    logger.info('SINAL: VENDER', { rsi: rsi.toFixed(2) });
    return { signal: 'SELL', rsi, smaFast, smaSlow, macd, currentPrice, trend4h };
  }

  return { signal: 'WAIT', rsi, smaFast, smaSlow, macd, currentPrice, trend4h };
}

module.exports = {
  analyzeMarket,
  calculateRSI,
  calculateSMA,
  calculateEMA,
  calculateMACD,
  getTrend4h,
};