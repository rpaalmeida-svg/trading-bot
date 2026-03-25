const logger = require('./logger');

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const MIN_SCORE_TO_BUY = 55;
const MIN_SCORE_SECOND = 65;

function calcScore(rsi, fearGreed, volumeRatio) {
  const rsiScore = rsi <= 35 ? 100 : rsi <= 45 ? 70 : rsi <= 55 ? 40 : 10;
  const fgScore = fearGreed <= 25 ? 100 : fearGreed <= 45 ? 70 : fearGreed <= 55 ? 40 : 10;
  const volScore = volumeRatio >= 1.5 ? 100 : volumeRatio >= 1.0 ? 60 : 30;

  const score = (rsiScore * 0.40) + (fgScore * 0.30) + (volScore * 0.30);

  logger.info(`Score calculado`, {
    rsiScore, fgScore, volScore,
    score: score.toFixed(2)
  });

  return Math.round(score);
}

function allocateCapital(signals, totalCapital) {
  // Filtrar só sinais de compra com score mínimo
  const candidates = signals
    .filter(s => s.signal === 'BUY' && s.score >= MIN_SCORE_TO_BUY)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    logger.info('Nenhum par com score suficiente para comprar');
    return [];
  }

  // Se só 1 candidato — investe tudo
  if (candidates.length === 1) {
    return [{
      ...candidates[0],
      allocation: totalCapital * 0.95
    }];
  }

  // Se 2+ candidatos — o segundo só entra se tiver score >= MIN_SCORE_SECOND
  const selected = [candidates[0]];
  if (candidates[1].score >= MIN_SCORE_SECOND) {
    selected.push(candidates[1]);
  }

  // Distribuir capital proporcionalmente ao score
  const totalScore = selected.reduce((sum, s) => sum + s.score, 0);
  return selected.map(s => ({
    ...s,
    allocation: (s.score / totalScore) * totalCapital * 0.95
  }));
}

function getReason(score, rsi, fearGreed) {
  const reasons = [];
  if (rsi <= 35) reasons.push(`RSI sobrevendido (${rsi})`);
  if (fearGreed <= 25) reasons.push(`Medo extremo (${fearGreed})`);
  if (score >= 80) reasons.push('Score excelente');
  else if (score >= 65) reasons.push('Score bom');
  else reasons.push('Score aceitável');
  return reasons.join(' + ');
}

module.exports = {
  PAIRS,
  calcScore,
  allocateCapital,
  getReason,
  MIN_SCORE_TO_BUY
};