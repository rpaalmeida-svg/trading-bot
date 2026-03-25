const axios = require('axios');
const logger = require('./logger');

const TOKEN = process.env.CRYPTOPANIC_TOKEN;

async function getNewsSentiment() {
  try {
    const res = await axios.get('https://cryptopanic.com/api/v1/posts/', {
      params: {
        auth_token: TOKEN,
        currencies: 'BTC,ETH,SOL',
        filter: 'hot',
        public: true
      }
    });

    const posts = res.data.results || [];
    let positive = 0;
    let negative = 0;
    let neutral = 0;

    posts.forEach(post => {
      const votes = post.votes || {};
      positive += votes.positive || 0;
      negative += votes.negative || 0;
      neutral += votes.neutral || 0;
    });

    const total = positive + negative + neutral || 1;
    const sentimentScore = ((positive - negative) / total) * 100;

    const signal = sentimentScore > 10 ? 'POSITIVE'
                 : sentimentScore < -10 ? 'NEGATIVE'
                 : 'NEUTRAL';

    const recentTitles = posts.slice(0, 3).map(p => p.title);

    logger.info('News Sentiment', {
      positive, negative, neutral,
      sentimentScore: sentimentScore.toFixed(2),
      signal
    });

    return { sentimentScore: parseFloat(sentimentScore.toFixed(2)), signal, recentTitles };

  } catch (err) {
    logger.error('Erro ao obter notícias', { message: err.message });
    return { sentimentScore: 0, signal: 'NEUTRAL', recentTitles: [] };
  }
}

module.exports = { getNewsSentiment };