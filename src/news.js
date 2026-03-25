const axios = require('axios');
const logger = require('./logger');

async function getNewsSentiment() {
  try {
    // CoinGecko trending — gratuito sem token
    const res = await axios.get('https://api.coingecko.com/api/v3/search/trending');
    
    const coins = res.data?.coins || [];
    
    // Verificar se BTC ETH BNB estão em trending (sinal positivo)
    const trendingSymbols = coins.map(c => c.item?.symbol?.toUpperCase());
    const ourPairs = ['BTC', 'ETH', 'BNB'];
    const trending = ourPairs.filter(p => trendingSymbols.includes(p));
    
    // Buscar também o market sentiment via Fear & Greed como proxy
    const fgRes = await axios.get('https://api.alternative.me/fng/?limit=7');
    const fgData = fgRes.data?.data || [];
    
    // Calcular tendência dos últimos 7 dias
    const values = fgData.map(d => parseInt(d.value));
    const recent = values.slice(0, 3);
    const older = values.slice(3, 7);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    // Se sentimento está a melhorar → positivo
    const trend = recentAvg - olderAvg;
    const currentFG = values[0];
    
    let sentimentScore = 0;
    if (trend > 5) sentimentScore = 30;
    else if (trend < -5) sentimentScore = -30;
    
    if (trending.length > 0) sentimentScore += 20;
    
    const signal = sentimentScore > 15 ? 'POSITIVE' 
                 : sentimentScore < -15 ? 'NEGATIVE' 
                 : 'NEUTRAL';

    const recentTitles = [
      `Fear & Greed: ${currentFG} (${fgData[0]?.value_classification})`,
      `Tendência 7 dias: ${trend > 0 ? '+' : ''}${trend.toFixed(1)} pontos`,
      trending.length > 0 ? `Em trending: ${trending.join(', ')}` : 'Sem pares em trending'
    ];

    logger.info('News Sentiment', { sentimentScore, signal, trend: trend.toFixed(1), trending });

    return { sentimentScore, signal, recentTitles };

  } catch (err) {
    logger.error('Erro ao obter notícias', { message: err.message });
    return { sentimentScore: 0, signal: 'NEUTRAL', recentTitles: [] };
  }
}

module.exports = { getNewsSentiment };