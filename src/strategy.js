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

// --- BOLLINGER BANDS ---
// Retorna: upper, middle (SMA20), lower, bandwidth, %B
// %B = 0 → preço na banda inferior (sobrevendido)
// %B = 1 → preço na banda superior (sobrecomprado)
// %B < 0 → preço abaixo da banda inferior (muito sobrevendido — oportunidade)
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;

  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;

  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);

  const upper = sma + stdDev * std;
  const lower = sma - stdDev * std;
  const bandwidth = (upper - lower) / sma;
  const currentPrice = prices[prices.length - 1];
  const percentB = (currentPrice - lower) / (upper - lower);

  return { upper, middle: sma, lower, bandwidth, percentB, std };
}

// --- ATR (Average True Range) ---
// Mede a volatilidade real do mercado
// Usado para: position sizing dinâmico e stop-loss adaptativo
// candles = array de { high, low, close }
// NOTA: sanitização de wicks impossíveis (problema comum na Binance Testnet)
function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    // Sanidade: ignorar velas com wicks impossíveis (> 15% do preço)
    // A Binance Testnet gera dados sintéticos com ranges absurdos
    const rangeRatio = (high - low) / prevClose;
    if (rangeRatio > 0.15) continue;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  const slice = trueRanges.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / slice.length;
  const currentPrice = candles[candles.length - 1].close;
  const atrPct = (atr / currentPrice) * 100;

  // Cap de segurança — ATR nunca deve exceder 8% em dados válidos
  const atrPctFinal = Math.min(atrPct, 8.0);

  return { atr, atrPct: atrPctFinal };
}

// --- POSITION SIZING DINÂMICO ---
// Quanto mais volátil o mercado, menos capital arriscamos
// atrPct < 1% → volatilidade baixa → alocar 100% do capital planeado
// atrPct 1-2% → volatilidade média → alocar 75%
// atrPct 2-3% → volatilidade alta → alocar 50%
// atrPct > 3% → volatilidade extrema → alocar 25% ou não entrar
function getDynamicAllocation(baseCapital, atrPct) {
  if (!atrPct) return baseCapital;

  if (atrPct < 1.0) return baseCapital * 1.00;
  if (atrPct < 2.0) return baseCapital * 0.75;
  if (atrPct < 3.0) return baseCapital * 0.50;
  return baseCapital * 0.25;
}

// --- STOP-LOSS ADAPTATIVO ---
// Em vez de stop fixo de 2.5%, usar 2x ATR
// Mercado calmo → stop mais apertado
// Mercado volátil → stop mais largo (evita ser parado por ruído)
function getAdaptiveStopLoss(entryPrice, atr, multiplier = 2.0) {
  if (!atr) return entryPrice * 0.975; // fallback: 2.5% fixo
  return entryPrice - (atr * multiplier);
}

// --- TENDÊNCIA DE 4H ---
function getTrend4h(prices4h) {
  if (!prices4h || prices4h.length < 50) return 'NEUTRAL';

  const sma20 = calculateSMA(prices4h, 20);
  const sma50 = calculateSMA(prices4h, 50);
  const rsi4h = calculateRSI(prices4h, 14);
  const currentPrice = prices4h[prices4h.length - 1];

  if (!sma20 || !sma50 || !rsi4h) return 'NEUTRAL';

  if (currentPrice > sma20 && sma20 > sma50 && rsi4h < 70) return 'BULLISH';
  if (currentPrice < sma20 && sma20 < sma50) return 'BEARISH';
  return 'NEUTRAL';
}

// --- PADRÕES DE VELAS ---
// Detecta padrões básicos de reversão
function detectCandlePattern(candles) {
  if (!candles || candles.length < 3) return 'NONE';

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const body = Math.abs(last.close - last.open);
  const totalRange = last.high - last.low;
  const lowerShadow = Math.min(last.open, last.close) - last.low;
  const upperShadow = last.high - Math.max(last.open, last.close);

  // Hammer — padrão de reversão bullish
  // Corpo pequeno no topo, sombra inferior longa (≥2x o corpo)
  if (
    body > 0 &&
    lowerShadow >= body * 2 &&
    upperShadow <= body * 0.5 &&
    last.close > prev.close
  ) return 'HAMMER';

  // Doji — indecisão — corpo muito pequeno
  if (body <= totalRange * 0.1 && totalRange > 0) return 'DOJI';

  // Engulfing Bullish — vela verde que engloba a vela vermelha anterior
  if (
    prev.close < prev.open &&
    last.close > last.open &&
    last.open < prev.close &&
    last.close > prev.open
  ) return 'BULLISH_ENGULFING';

  // Engulfing Bearish
  if (
    prev.close > prev.open &&
    last.close < last.open &&
    last.open > prev.close &&
    last.close < prev.open
  ) return 'BEARISH_ENGULFING';

  return 'NONE';
}

// --- DECISÃO DE TRADING COMPLETA ---
function analyzeMarket(prices, prices4h = null, rsiBuy = 35, rsiSell = 65, candles = null) {
  const rsi = calculateRSI(prices, 14);
  const smaFast = calculateSMA(prices, 9);
  const smaSlow = calculateSMA(prices, 21);
  const macd = calculateMACD(prices);
  const bb = calculateBollingerBands(prices, 20, 2);
  const atrData = calculateATR(candles, 14);
  const currentPrice = prices[prices.length - 1];
  const trend4h = getTrend4h(prices4h);
  const candlePattern = detectCandlePattern(candles);

  if (!rsi || !smaFast || !smaSlow) {
    return { signal: 'WAIT', rsi, smaFast, smaSlow, currentPrice, trend4h };
  }

  // Bloquear compra se tendência 4h é BEARISH
  if (trend4h === 'BEARISH') {
    logger.info('Tendência 4h BEARISH — compra bloqueada');
    return { signal: 'WAIT', rsi, smaFast, smaSlow, macd, bb, atrData, currentPrice, trend4h, candlePattern, blockedBy: '4h_bearish' };
  }

  // Volatilidade extrema — não entrar
  if (atrData && atrData.atrPct > 4.0) {
    logger.info('Volatilidade extrema — compra bloqueada', { atrPct: atrData.atrPct.toFixed(2) });
    return { signal: 'WAIT', rsi, smaFast, smaSlow, macd, bb, atrData, currentPrice, trend4h, candlePattern, blockedBy: 'extreme_volatility' };
  }

  // MACD confirma momentum positivo
  const macdConfirma = macd ? macd.histogram > 0 || macd.macdLine > macd.signalLine : true;

  // Bollinger Bands confirma sobrevendido
  // percentB < 0.2 = preço próximo ou abaixo da banda inferior
  const bbConfirma = bb ? bb.percentB < 0.2 : true;

  // Padrão de vela confirma reversão
  const patternConfirma = ['HAMMER', 'BULLISH_ENGULFING'].includes(candlePattern) || candlePattern === 'NONE';

  // SINAL DE COMPRA — todos os filtros têm de concordar
  if (
    rsi < rsiBuy &&
    smaFast > smaSlow &&
    macdConfirma &&
    bbConfirma &&
    patternConfirma
  ) {
    logger.info('SINAL: COMPRAR', {
      rsi: rsi.toFixed(2),
      trend4h,
      macdHistogram: macd?.histogram?.toFixed(4),
      bbPercentB: bb?.percentB?.toFixed(3),
      atrPct: atrData?.atrPct?.toFixed(2),
      candlePattern
    });
    return { signal: 'BUY', rsi, smaFast, smaSlow, macd, bb, atrData, currentPrice, trend4h, candlePattern };
  }

  // SINAL DE VENDA
  if (rsi > rsiSell && smaFast < smaSlow) {
    return { signal: 'SELL', rsi, smaFast, smaSlow, macd, bb, atrData, currentPrice, trend4h, candlePattern };
  }

  return { signal: 'WAIT', rsi, smaFast, smaSlow, macd, bb, atrData, currentPrice, trend4h, candlePattern };
}

module.exports = {
  analyzeMarket,
  calculateRSI,
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  getDynamicAllocation,
  getAdaptiveStopLoss,
  getTrend4h,
  detectCandlePattern,
};