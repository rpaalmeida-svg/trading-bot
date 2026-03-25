const logger = require('./logger');

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

// Configuração específica por par — baseada no backtest
const PAIR_CONFIG = {
  BTCUSDT: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  ETHUSDT: { interval: '30m', rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  BNBUSDT: { interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
};

const MIN_SCORE_TO_BUY = 55;
const MIN_SCORE_SECOND = 65;

function calcScore(rsi, fearGreed, volumeRatio, rsiBuy) {
  const rsiScore = rsi <= rsiBuy ? 100 : rsi <= rsiBuy + 10 ? 70 : rsi <= rsiBuy + 20 ? 40 : 10;
  const fgScore = fearGreed <= 25 ? 100 : fearGreed <= 45 ? 70 : fearGreed <= 55 ? 40 : 10;
  const volScore = volumeRatio >= 1.5 ? 100 : volumeRatio >= 1.0 ? 60 : 30;
  const score = (rsiScore * 0.40) + (fgScore * 0.30) + (volScore * 0.30);
  return Math.round(score);
}

function allocateCapital(signals, totalCapital) {
  const candidates = signals
    .filter(s => (s.signal === 'BUY' || s.score >= 85) && s.score >= MIN_SCORE_TO_BUY)
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

function getReason(score, rsi, fearGreed) {
  const reasons = [];
  if (rsi <= 35) reasons.push(`RSI sobrevendido (${parseFloat(rsi).toFixed(2)})`);
  if (fearGreed <= 25) reasons.push(`Medo extremo (${fearGreed})`);
  if (score >= 80) reasons.push('Score excelente');
  else if (score >= 65) reasons.push('Score bom');
  else reasons.push('Score aceitável');
  return reasons.join(' + ');
}

module.exports = {
  PAIRS,
  PAIR_CONFIG,
  calcScore,
  allocateCapital,
  getReason,
  MIN_SCORE_TO_BUY
};