const axios = require('axios');
const logger = require('./logger');
const telegram = require('./telegram');
const strategy = require('./strategy');
const { saveState, loadState } = require('./database');

const BASE_URL = 'https://testnet.binance.vision/api';
const SCAN_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Top pares por volume e liquidez — testados na Binance
const CANDIDATES = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
  'LINKUSDT', 'UNIUSDT', 'ATOMUSDT', 'LTCUSDT', 'NEARUSDT'
];

const CURRENT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

async function getHistoricalData(symbol, interval, days = 30) {
  try {
    const limit = interval === '1h' ? days * 24 : days * 48;
    const res = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit: Math.min(limit, 1000) }
    });
    return res.data.map(k => parseFloat(k[4]));
  } catch (err) {
    return null;
  }
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const slice = prices.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function simulateReturn(prices, rsiBuy = 35, rsiSell = 65, stopLoss = 0.025, takeProfit = 0.05) {
  let capital = 1000;
  let inPosition = false;
  let entryPrice = null;
  let stopLossPrice = null;
  let takeProfitPrice = null;
  let trades = 0;
  let wins = 0;

  for (let i = 20; i < prices.length; i++) {
    const slice = prices.slice(Math.max(0, i - 30), i + 1);
    const rsi = calculateRSI(slice, 14);
    const current = prices[i];

    if (!rsi) continue;

    if (inPosition) {
      if (current <= stopLossPrice) {
        capital = capital * (1 - stopLoss);
        inPosition = false;
        trades++;
        continue;
      }
      if (current >= takeProfitPrice) {
        capital = capital * (1 + takeProfit);
        inPosition = false;
        trades++;
        wins++;
        continue;
      }
      if (rsi > rsiSell) {
        const ret = (current - entryPrice) / entryPrice;
        capital = capital * (1 + ret);
        if (ret > 0) wins++;
        inPosition = false;
        trades++;
      }
    } else {
      if (rsi < rsiBuy) {
        entryPrice = current;
        stopLossPrice = current * (1 - stopLoss);
        takeProfitPrice = current * (1 + takeProfit);
        inPosition = true;
      }
    }
  }

  const returnPct = ((capital - 1000) / 1000) * 100;
  const winRate = trades > 0 ? (wins / trades * 100) : 0;
  return { returnPct, winRate, trades, capital };
}

async function scanBestPairs() {
  try {
    logger.info('Scanner mensal iniciado — a analisar top pares...');
    const results = [];

    for (const symbol of CANDIDATES) {
      const prices1h = await getHistoricalData(symbol, '1h', 30);
      if (!prices1h || prices1h.length < 50) continue;

      const result = simulateReturn(prices1h, 35, 65, 0.025, 0.05);
      results.push({ symbol, ...result });

      await new Promise(r => setTimeout(r, 300));
    }

    // Ordenar por retorno
    results.sort((a, b) => b.returnPct - a.returnPct);

    const top5 = results.slice(0, 5);
    const current = results.filter(r => CURRENT_PAIRS.includes(r.symbol));
    const newCandidates = top5.filter(r => !CURRENT_PAIRS.includes(r.symbol));

    logger.info('Scanner concluído', { top5: top5.map(r => r.symbol) });

    // Construir mensagem Telegram
    let msg = `📊 <b>Relatório Mensal — Melhores Pares</b>\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `🏆 <b>Top 5 este mês (30 dias):</b>\n\n`;

    top5.forEach((r, i) => {
      const isCurrent = CURRENT_PAIRS.includes(r.symbol);
      const emoji = r.returnPct > 0 ? '✅' : '❌';
      const currentTag = isCurrent ? ' ← actual' : '';
      msg += `${i + 1}. ${emoji} ${r.symbol.replace('USDT', '')}\n`;
      msg += `   Retorno: ${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(1)}% | Win: ${r.winRate.toFixed(0)}% | Trades: ${r.trades}${currentTag}\n\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 <b>Pares actuais:</b>\n`;
    current.forEach(r => {
      const rank = results.findIndex(x => x.symbol === r.symbol) + 1;
      msg += `• ${r.symbol.replace('USDT', '')} — posição #${rank} | ${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(1)}%\n`;
    });

    if (newCandidates.length > 0) {
      msg += `\n⚡️ <b>Candidatos a substituição:</b>\n`;
      newCandidates.slice(0, 2).forEach(r => {
        msg += `• ${r.symbol.replace('USDT', '')} — ${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(1)}% este mês\n`;
      });
      msg += `\n💡 Se quiseres substituir algum par actual, diz-me e actualizamos o bot.`;
    } else {
      msg += `\n✅ Os pares actuais estão entre os melhores. Manter configuração.`;
    }

    msg += `\n\n⏰ Próxima análise: daqui a 30 dias`;

    await telegram.sendMessage(msg);
    await saveState('lastScan', Date.now());

    logger.info('Relatório mensal enviado para Telegram');

  } catch (err) {
    logger.error('Erro no scanner mensal', { message: err.message });
  }
}

async function checkAndRunScan() {
  try {
    const lastScan = await loadState('lastScan');
    const now = Date.now();

    if (!lastScan) {
      await saveState('lastScan', now);
      logger.info('Scanner mensal iniciado pela primeira vez');
      return;
    }

    const elapsed = now - lastScan;
    if (elapsed >= SCAN_INTERVAL_MS) {
      await scanBestPairs();
    } else {
      const diasRestantes = Math.round((SCAN_INTERVAL_MS - elapsed) / (24 * 60 * 60 * 1000));
      logger.info('Próxima análise mensal', { diasRestantes });
    }
  } catch (err) {
    logger.error('Erro no check scanner', { message: err.message });
  }
}

module.exports = { checkAndRunScan, scanBestPairs };