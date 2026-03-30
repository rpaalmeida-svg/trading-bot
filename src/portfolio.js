const logger = require('./logger');

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

const PAIR_CONFIG = {
  BTCUSDT: { interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
  ETHUSDT: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  BNBUSDT: { interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
};

const MIN_SCORE_TO_BUY = 75;
const MIN_SCORE_SECOND = 80;

// Score técnico — indicadores do par
function calcScore(rsi, fearGreed, volumeRatio, rsiBuy) {
  const rsiScore = rsi <= rsiBuy ? 100
    : rsi <= rsiBuy + 5  ? 85
    : rsi <= rsiBuy + 10 ? 65
    : rsi <= rsiBuy + 20 ? 35
    : 10;

  const fgScore = fearGreed <= 15 ? 100
    : fearGreed <= 25 ? 90
    : fearGreed <= 35 ? 70
    : fearGreed <= 45 ? 50
    : fearGreed <= 55 ? 30
    : 10;

  const volScore = volumeRatio >= 2.0 ? 100
    : volumeRatio >= 1.5 ? 80
    : volumeRatio >= 1.0 ? 55
    : 25;

  // Pesos: RSI 45% | Fear&Greed 35% | Volume 20%
  const score = (rsiScore * 0.45) + (fgScore * 0.35) + (volScore * 0.20);
  return Math.round(score);
}

// Score macro — estado do mundo
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

// Score composto — técnico + macro
function calcCompositeScore(technicalScore, macroScore) {
  return Math.round(technicalScore * 0.60 + macroScore * 0.40);
}

function allocateCapital(signals, totalCapital) {
  const candidates = signals
    .filter(s => s.score >= MIN_SCORE_TO_BUY)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    logger.info('Nenhum par com score suficiente para comprar');
    return [];
  }

  if (candidates.length === 1) {
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
  calcScore,
  calcMacroScore,
  calcCompositeScore,
  allocateCapital,
  getReason,
  MIN_SCORE_TO_BUY
};