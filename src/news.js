const axios = require('axios');
const logger = require('./logger');

// Cache para não sobrecarregar APIs gratuitas
let macroCache = null;
let macroCacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos

async function getMacroData() {
  try {
    // Global crypto market data — CoinGecko gratuito
    const globalRes = await axios.get('https://api.coingecko.com/api/v3/global');
    const global = globalRes.data?.data || {};

    const btcDominance = global.market_cap_percentage?.btc || 0;
    const totalMarketCapChange = global.market_cap_change_percentage_24h_usd || 0;
    const totalVolume = global.total_volume?.usd || 0;

    return { btcDominance, totalMarketCapChange, totalVolume };
  } catch (err) {
    logger.error('Erro macro global', { message: err.message });
    return { btcDominance: 50, totalMarketCapChange: 0, totalVolume: 0 };
  }
}

async function getEtfFlows() {
  try {
    // SoSoValue — ETF flows gratuito
    const res = await axios.get('https://sosovalue.com/api/etf/btc-us-total', {
      timeout: 5000
    });
    const data = res.data;
    if (data && data.netInflow !== undefined) {
      return {
        netInflow: parseFloat(data.netInflow) || 0,
        available: true
      };
    }
    return { netInflow: 0, available: false };
  } catch (err) {
    return { netInflow: 0, available: false };
  }
}

async function getBtcOnChain() {
  try {
    // CoinGecko — métricas BTC
    const res = await axios.get('https://api.coingecko.com/api/v3/coins/bitcoin', {
      params: {
        localization: false,
        tickers: false,
        community_data: false,
        developer_data: false,
        sparkline: false
      },
      timeout: 5000
    });

    const data = res.data;
    const priceChange7d = data?.market_data?.price_change_percentage_7d || 0;
    const priceChange30d = data?.market_data?.price_change_percentage_30d || 0;
    const volumeChange = data?.market_data?.total_volume?.usd || 0;
    const ath = data?.market_data?.ath?.usd || 0;
    const currentPrice = data?.market_data?.current_price?.usd || 0;
    const distanceFromAth = ath > 0 ? ((currentPrice - ath) / ath) * 100 : 0;

    return { priceChange7d, priceChange30d, volumeChange, distanceFromAth };
  } catch (err) {
    logger.error('Erro on-chain BTC', { message: err.message });
    return { priceChange7d: 0, priceChange30d: 0, volumeChange: 0, distanceFromAth: 0 };
  }
}

async function getNewsSentiment() {
  const now = Date.now();

  // Usar cache se recente
  if (macroCache && (now - macroCacheTime) < CACHE_TTL) {
    return macroCache;
  }

  try {
    // 1. Fear & Greed 7 dias
    const fgRes = await axios.get('https://api.alternative.me/fng/?limit=14');
    const fgData = fgRes.data?.data || [];
    const fgValues = fgData.map(d => parseInt(d.value));
    const currentFG = fgValues[0] || 50;
    const recent3 = fgValues.slice(0, 3);
    const older4 = fgValues.slice(3, 7);
    const older7to14 = fgValues.slice(7, 14);
    const recentAvg = recent3.reduce((a, b) => a + b, 0) / recent3.length;
    const olderAvg = older4.reduce((a, b) => a + b, 0) / older4.length;
    const weekAvg = older7to14.reduce((a, b) => a + b, 0) / older7to14.length;
    const fgTrend = recentAvg - olderAvg;
    const fgMomentum = olderAvg - weekAvg;

    // 2. CoinGecko trending
    const trendRes = await axios.get('https://api.coingecko.com/api/v3/search/trending');
    const coins = trendRes.data?.coins || [];
    const trendingSymbols = coins.map(c => c.item?.symbol?.toUpperCase());
    const ourPairs = ['BTC', 'ETH', 'BNB'];
    const trending = ourPairs.filter(p => trendingSymbols.includes(p));

    // 3. Global macro
    const macro = await getMacroData();

    // 4. BTC on-chain
    const onChain = await getBtcOnChain();

    // 5. ETF Flows
    const etfFlows = await getEtfFlows();

    // ─── CÁLCULO DO SCORE MACRO ───────────────────────────────

    let macroScore = 0;
    const signals = [];

    // Fear & Greed actual
    if (currentFG <= 20) {
      macroScore += 25;
      signals.push(`Medo extremo (${currentFG}) → zona de compra histórica`);
    } else if (currentFG <= 35) {
      macroScore += 15;
      signals.push(`Medo (${currentFG}) → favorável`);
    } else if (currentFG >= 80) {
      macroScore -= 25;
      signals.push(`Ganância extrema (${currentFG}) → cuidado`);
    } else if (currentFG >= 65) {
      macroScore -= 15;
      signals.push(`Ganância (${currentFG}) → precaução`);
    }

    // Tendência Fear & Greed (está a melhorar ou piorar?)
    if (fgTrend > 8) {
      macroScore += 15;
      signals.push(`Sentimento a melhorar +${fgTrend.toFixed(0)}pts/3dias`);
    } else if (fgTrend < -8) {
      macroScore -= 15;
      signals.push(`Sentimento a deteriorar ${fgTrend.toFixed(0)}pts/3dias`);
    }

    // Momentum de 2 semanas
    if (fgMomentum > 5) {
      macroScore += 10;
      signals.push(`Momentum 2 semanas positivo`);
    } else if (fgMomentum < -5) {
      macroScore -= 10;
      signals.push(`Momentum 2 semanas negativo`);
    }

    // BTC dominance — sobe = altcoins fracas, desce = altcoins fortes
    if (macro.btcDominance > 60) {
      macroScore -= 10;
      signals.push(`BTC dominance alta (${macro.btcDominance.toFixed(1)}%) → ETH/BNB fraco`);
    } else if (macro.btcDominance < 45) {
      macroScore += 10;
      signals.push(`BTC dominance baixa (${macro.btcDominance.toFixed(1)}%) → altcoins fortes`);
    }

    // Market cap change 24h
    if (macro.totalMarketCapChange > 3) {
      macroScore += 15;
      signals.push(`Mercado total +${macro.totalMarketCapChange.toFixed(1)}% 24h`);
    } else if (macro.totalMarketCapChange < -3) {
      macroScore -= 20;
      signals.push(`Mercado total ${macro.totalMarketCapChange.toFixed(1)}% 24h → queda`);
    } else if (macro.totalMarketCapChange < -1) {
      macroScore -= 10;
      signals.push(`Mercado ligeiramente negativo ${macro.totalMarketCapChange.toFixed(1)}%`);
    }

    // BTC performance 7 dias
    if (onChain.priceChange7d > 5) {
      macroScore += 10;
      signals.push(`BTC +${onChain.priceChange7d.toFixed(1)}% semana`);
    } else if (onChain.priceChange7d < -10) {
      macroScore -= 20;
      signals.push(`BTC ${onChain.priceChange7d.toFixed(1)}% semana → tendência baixista`);
    } else if (onChain.priceChange7d < -5) {
      macroScore -= 10;
      signals.push(`BTC ${onChain.priceChange7d.toFixed(1)}% semana → fraco`);
    }

    // Distância do ATH — quão longe estamos dos máximos
    if (onChain.distanceFromAth < -50) {
      macroScore += 20;
      signals.push(`BTC ${onChain.distanceFromAth.toFixed(0)}% do ATH → zona de valor`);
    } else if (onChain.distanceFromAth < -30) {
      macroScore += 10;
      signals.push(`BTC ${onChain.distanceFromAth.toFixed(0)}% do ATH → desconto`);
    } else if (onChain.distanceFromAth > -5) {
      macroScore -= 10;
      signals.push(`BTC perto do ATH → sobrecomprado macro`);
    }

    // Trending — os nossos pares em destaque
    if (trending.length >= 2) {
      macroScore += 15;
      signals.push(`Em trending: ${trending.join(', ')}`);
    } else if (trending.length === 1) {
      macroScore += 8;
      signals.push(`Em trending: ${trending.join(', ')}`);
    }

    // ETF Flows — quando disponível
    if (etfFlows.available) {
      if (etfFlows.netInflow > 200000000) {
        macroScore += 20;
        signals.push(`ETF inflows +$${(etfFlows.netInflow / 1e6).toFixed(0)}M → institucional a comprar`);
      } else if (etfFlows.netInflow < -200000000) {
        macroScore -= 25;
        signals.push(`ETF outflows -$${Math.abs(etfFlows.netInflow / 1e6).toFixed(0)}M → institucional a vender`);
      }
    }

    // ─── SINAL FINAL ────────────────────────────────────────────

    const signal = macroScore >= 25 ? 'POSITIVE'
                 : macroScore <= -25 ? 'NEGATIVE'
                 : 'NEUTRAL';

    // Bloquear compras em colapso de mercado extremo
    const blockBuying = macro.totalMarketCapChange < -5 ||
                        (onChain.priceChange7d < -15 && currentFG < 20 && fgTrend < -10);

    const recentTitles = signals.slice(0, 5);

    logger.info('Macro Sentiment', {
      macroScore,
      signal,
      currentFG,
      fgTrend: fgTrend.toFixed(1),
      btcDominance: macro.btcDominance.toFixed(1),
      marketCapChange: macro.totalMarketCapChange.toFixed(1),
      btc7d: onChain.priceChange7d.toFixed(1),
      distanceATH: onChain.distanceFromAth.toFixed(1),
      trending,
      blockBuying
    });

    const result = {
      sentimentScore: macroScore,
      signal,
      recentTitles,
      blockBuying,
      raw: {
        fearGreed: currentFG,
        fgTrend,
        btcDominance: macro.btcDominance,
        marketCapChange: macro.totalMarketCapChange,
        btc7d: onChain.priceChange7d,
        btc30d: onChain.priceChange30d,
        distanceFromAth: onChain.distanceFromAth,
        trending,
        etfInflow: etfFlows.netInflow
      }
    };

    macroCache = result;
    macroCacheTime = now;

    return result;

  } catch (err) {
    logger.error('Erro ao obter macro sentiment', { message: err.message });
    return {
      sentimentScore: 0,
      signal: 'NEUTRAL',
      recentTitles: ['Dados macro indisponíveis'],
      blockBuying: false,
      raw: {}
    };
  }
}

module.exports = { getNewsSentiment };