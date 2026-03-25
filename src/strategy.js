const logger = require('./logger');

// --- INDICADORES TÉCNICOS ---

function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
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

// --- DECISÃO DE TRADING ---

function analyzeMarket(prices) {
  const rsi = calculateRSI(prices, 14);
  const smaFast = calculateSMA(prices, 9);   // Média rápida
  const smaSlow = calculateSMA(prices, 21);  // Média lenta
  const currentPrice = prices[prices.length - 1];

  if (!rsi || !smaFast || !smaSlow) {
    logger.info('Dados insuficientes para análise');
    return { signal: 'WAIT', rsi, smaFast, smaSlow, currentPrice };
  }

  logger.info('Análise de mercado', {
    currentPrice,
    rsi: rsi.toFixed(2),
    smaFast: smaFast.toFixed(2),
    smaSlow: smaSlow.toFixed(2),
  });

  // SINAL DE COMPRA — RSI baixo + média rápida a cruzar para cima
  if (rsi < 35 && smaFast > smaSlow) {
    logger.info('SINAL: COMPRAR', { rsi: rsi.toFixed(2) });
    return { signal: 'BUY', rsi, smaFast, smaSlow, currentPrice };
  }

  // SINAL DE VENDA — RSI alto + média rápida a cruzar para baixo
  if (rsi > 65 && smaFast < smaSlow) {
    logger.info('SINAL: VENDER', { rsi: rsi.toFixed(2) });
    return { signal: 'SELL', rsi, smaFast, smaSlow, currentPrice };
  }

  // Sem sinal claro — aguardar
  return { signal: 'WAIT', rsi, smaFast, smaSlow, currentPrice };
}

module.exports = {
  analyzeMarket,
  calculateRSI,
  calculateSMA,
};