const axios = require('axios');
const logger = require('./logger');

async function getNewsSentiment() {
  try {
    // CryptoCompare — notícias gratuitas sem token
    const res = await axios.get('https://min-api.cryptocompare.com/data/v2/news/', {
      params: {
        categories: 'BTC,ETH,BNB',
        lang: 'EN',
        limit: 10
      }
    });

    const articles = res.data.Data || [];
    if (articles.length === 0) {
      return { sentimentScore: 0, signal: 'NEUTRAL', recentTitles: [] };
    }

    // Palavras positivas e negativas
    const positiveWords = ['surge', 'rally', 'bull', 'gain', 'rise', 'high', 'adoption', 'growth', 'record', 'up'];
    const negativeWords = ['crash', 'bear', 'drop', 'fall', 'low', 'ban', 'hack', 'fear', 'sell', 'down', 'risk'];

    let positive = 0;
    let negative = 0;

    articles.forEach(article => {
      const text = (article.title + ' ' + article.body).toLowerCase();
      positiveWords.forEach(w => { if (text.includes(w)) positive++; });
      negativeWords.forEach(w => { if (text.includes(w)) negative++; });
    });

    const total = positive + negative || 1;
    const sentimentScore = parseFloat(((positive - negative) / total * 100).toFixed(2));
    const signal = sentimentScore > 15 ? 'POSITIVE' : sentimentScore < -15 ? 'NEGATIVE' : 'NEUTRAL';
    const recentTitles = articles.slice(0, 3).map(a => a.title);

    logger.info('News Sentiment', { positive, negative, sentimentScore, signal });

    return { sentimentScore, signal, recentTitles };

  } catch (err) {
    logger.error('Erro ao obter notícias', { message: err.message });
    return { sentimentScore: 0, signal: 'NEUTRAL', recentTitles: [] };
  }
}

module.exports = { getNewsSentiment };