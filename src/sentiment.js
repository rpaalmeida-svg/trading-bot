const axios = require('axios');
const logger = require('./logger');

async function getFearGreedIndex() {
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=1');
    const data = res.data.data[0];
    const value = parseInt(data.value);
    const classification = data.value_classification;

    logger.info('Fear & Greed Index', { value, classification });

    return {
      value,
      classification,
      signal: getSignal(value)
    };
  } catch (err) {
    logger.error('Erro ao obter Fear & Greed', { message: err.message });
    return { value: 50, classification: 'Neutral', signal: 'NEUTRAL' };
  }
}

function getSignal(value) {
  if (value <= 25) return 'BUY';      // Medo extremo — oportunidade
  if (value >= 75) return 'SELL';     // Ganância extrema — cuidado
  return 'NEUTRAL';
}

function getEmoji(value) {
  if (value <= 25) return '🟢';       // Medo extremo
  if (value <= 45) return '🟡';       // Medo
  if (value <= 55) return '⚪️';       // Neutro
  if (value <= 75) return '🟠';       // Ganância
  return '🔴';                         // Ganância extrema
}

module.exports = { getFearGreedIndex, getEmoji };