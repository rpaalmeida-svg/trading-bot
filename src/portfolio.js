const logger = require('./logger');

const PAIRS = [
  'BTCUSDC', 'ETHUSDC', 'BNBUSDC',
  'SOLUSDC', 'XRPUSDC', 'LINKUSDC',
  'ADAUSDC', 'DOGEUSDC', 'SUIUSDC'
];

const PAIR_CONFIG = {
  // ─── Originais (mantidos) ───
  BTCUSDC: { interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
  ETHUSDC: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  BNBUSDC: { interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },

  // ─── Novos — configs conservadoras ───
  SOLUSDC: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.030, takeProfit: 0.06 },
  XRPUSDC: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  LINKUSDC: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.030, takeProfit: 0.06 },
  ADAUSDC: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  DOGEUSDC: { interval: '1h', rsiBuy: 35, rsiSell: 65, stopLoss: 0.035, takeProfit: 0.07 },
  SUIUSDC: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.030, takeProfit: 0.06 },
};

const MIN_SCORE_TO_BUY = 75;
const MIN_SCORE_SECOND = 80;

// Máximo de posições simultâneas
const MAX_POSITIONS = 3;

// Mínimo por trade
const MIN_TRADE_AMOUNT = 5;

// ─────────────────────────────────────────────────────
// SCORE TÉCNICO — 100% indicadores individuais do par
//
// ANTES: Fear&Greed estava aqui (35%) → todos os pares iguais
// AGORA: só indicadores por par → cada par tem score diferente
//
// Pesos:
//   RSI posição ........... 30%
//   Volume relativo ....... 15%
//   MACD momentum ......... 15%
//   Bollinger %B .......... 15%
//   Tendência 4h .......... 15%
//   Padrão de velas ....... 10%
// ─────────────────────────────────────────────────────
function calcTechnicalScore(indicators) {
  const {
    rsi, rsiBuy, volumeRatio,
    macd, bb, trend4h, candlePattern
  } = indicators;

  // RSI — quão sobrevendido está (30%)
  const rsiScore = rsi <= rsiBuy ? 100
    : rsi <= rsiBuy + 5  ? 85
    : rsi <= rsiBuy + 10 ? 65
    : rsi <= rsiBuy + 20 ? 35
    : 10;

  // Volume relativo — última vela vs média das anteriores (15%)
  const volScore = volumeRatio >= 2.0 ? 100
    : volumeRatio >= 1.5 ? 80
    : volumeRatio >= 1.0 ? 55
    : volumeRatio >= 0.5 ? 30
    : 15;

  // MACD momentum — escala-independente (15%)
  let macdScore = 50;
  if (macd) {
    const histPositive = macd.histogram > 0;
    const macdAboveSignal = macd.macdLine > macd.signalLine;
    if (histPositive && macdAboveSignal) macdScore = 100;
    else if (histPositive || macdAboveSignal) macdScore = 70;
    else if (!histPositive && !macdAboveSignal) macdScore = 10;
    else macdScore = 35;
  }

  // Bollinger %B — posição dentro das bandas (15%)
  let bbScore = 50;
  if (bb && bb.percentB != null) {
    bbScore = bb.percentB <= 0.05 ? 100
      : bb.percentB <= 0.15 ? 90
      : bb.percentB <= 0.30 ? 70
      : bb.percentB <= 0.50 ? 50
      : bb.percentB <= 0.80 ? 25
      : 10;
  }

  // Tendência 4h — confirmação macro do par (15%)
  const trendScore = trend4h === 'BULLISH' ? 90
    : trend4h === 'NEUTRAL' ? 50
    : 10; // BEARISH

  // Padrão de velas — confirmação price action (10%)
  let patternScore = 50;
  if (candlePattern === 'HAMMER') patternScore = 90;
  else if (candlePattern === 'BULLISH_ENGULFING') patternScore = 85;
  else if (candlePattern === 'BEARISH_ENGULFING') patternScore = 15;
  else if (candlePattern === 'SHOOTING_STAR') patternScore = 20;
  else if (candlePattern === 'NONE') patternScore = 50;

  const score = (rsiScore * 0.30) +
    (volScore * 0.15) +
    (macdScore * 0.15) +
    (bbScore * 0.15) +
    (trendScore * 0.15) +
    (patternScore * 0.10);

  return Math.round(score);
}

// Score macro — estado do mundo (igual para todos os pares)
function calcMacroScore(macroData) {
  if (!macroData || !macroData.raw) return 50;

  const { fearGreed, fgTrend, btcDominance, marketCapChange, btc7d, distanceFromAth } = macroData.raw;
  let score = 50;

  if (fearGreed <= 20) score += 20;
  else if (fearGreed <= 35) score += 10;
  else if (fearGreed >= 75) score -= 20;
  else if (fearGreed >= 60) score -= 10;

  if (fgTrend > 8) score += 15;
  else if (fgTrend < -8) score -= 15;

  if (marketCapChange > 3) score += 15;
  else if (marketCapChange > 1) score += 5;
  else if (marketCapChange < -3) score -= 20;
  else if (marketCapChange < -1) score -= 10;

  if (btc7d > 5) score += 10;
  else if (btc7d < -10) score -= 20;
  else if (btc7d < -5) score -= 10;

  if (distanceFromAth < -50) score += 15;
  else if (distanceFromAth < -30) score += 8;
  else if (distanceFromAth > -5) score -= 10;

  if (btcDominance > 60) score -= 8;
  else if (btcDominance < 45) score += 8;

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─────────────────────────────────────────────────────
// SCORE COMPOSTO — técnico (75%) + macro (25%)
//
// ANTES: 60/40 → macro dominava, todos os pares ~71
// AGORA: 75/25 → técnico individual domina, pares diferenciam-se
// ─────────────────────────────────────────────────────
function calcCompositeScore(technicalScore, macroScore) {
  return Math.round(technicalScore * 0.75 + macroScore * 0.25);
}

// Alocação de capital
function allocateCapital(signals, totalCapital, maxSlots = MAX_POSITIONS) {
  const candidates = signals
    .filter(s => s.score >= MIN_SCORE_TO_BUY)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    logger.info('Nenhum par com score suficiente para comprar');
    return [];
  }

  const slotsAvailable = Math.min(candidates.length, maxSlots);

  // Conta pequena (<$50): concentrar no melhor par
  if (totalCapital < 50) {
    const selected = candidates.slice(0, Math.min(slotsAvailable, 1));
    return selected.map(s => ({
      ...s,
      allocation: totalCapital * 0.95
    }));
  }

  if (slotsAvailable === 1) {
    return [{ ...candidates[0], allocation: totalCapital * 0.95 }];
  }

  const selected = [candidates[0]];
  if (candidates[1] && candidates[1].score >= MIN_SCORE_SECOND) {
    selected.push(candidates[1]);
  }

  const totalScore = selected.reduce((sum, s) => sum + s.score, 0);
  return selected.map(s => ({
    ...s,
    allocation: (s.score / totalScore) * totalCapital * 0.95
  }));
}

function getReason(score, rsi, fearGreed, macroData) {
  const reasons = [];
  if (rsi <= 35) reasons.push(`RSI sobrevendido (${parseFloat(rsi).toFixed(2)})`);
  if (fearGreed <= 20) reasons.push(`Medo extremo (${fearGreed})`);
  if (macroData?.raw?.marketCapChange > 2) reasons.push(`Mercado a subir +${macroData.raw.marketCapChange.toFixed(1)}%`);
  if (macroData?.raw?.btc7d > 5) reasons.push(`BTC forte na semana`);
  if (macroData?.raw?.distanceFromAth < -40) reasons.push(`Zona de valor histórico`);
  if (score >= 85) reasons.push('Score excelente');
  else if (score >= 75) reasons.push('Score bom');
  else reasons.push('Score aceitável');
  return reasons.join(' + ');
}

module.exports = {
  PAIRS,
  PAIR_CONFIG,
  calcTechnicalScore,
  calcMacroScore,
  calcCompositeScore,
  allocateCapital,
  getReason,
  MIN_SCORE_TO_BUY,
  MAX_POSITIONS,
  MIN_TRADE_AMOUNT
};