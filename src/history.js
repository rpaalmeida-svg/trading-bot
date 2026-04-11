const { saveState, loadState } = require('./database');

const HISTORY_KEY = 'trades_history';

async function loadHistory() {
  try {
    const data = await loadState(HISTORY_KEY);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveHistory(trades) {
  await saveState(HISTORY_KEY, trades);
}

async function recordBuy(symbol, price, quantity, stopLoss, takeProfit) {
  const trades = await loadHistory();
  const trade = {
    id: Date.now(),
    symbol,
    side: 'BUY',
    price,
    quantity,
    stopLoss,
    takeProfit,
    timestamp: new Date().toISOString(),
    closed: false,
    profit: null,
    profitPercent: null,
    closePrice: null,
    closeTimestamp: null,
    closeReason: null,
    durationMinutes: null
  };
  trades.push(trade);
  await saveHistory(trades);
  return trade;
}

async function recordSell(symbol, closePrice, reason = 'TAKE_PROFIT') {
  const trades = await loadHistory();
  const openTrade = trades
    .filter(t => t.symbol === symbol && !t.closed)
    .sort((a, b) => b.id - a.id)[0];

  if (!openTrade) return null;

  const profit = (closePrice - openTrade.price) * openTrade.quantity;
  const profitPercent = ((closePrice - openTrade.price) / openTrade.price) * 100;

  // Duração do trade
  const openTime = new Date(openTrade.timestamp).getTime();
  const closeTime = Date.now();
  const durationMinutes = Math.round((closeTime - openTime) / 60000);

  openTrade.closed = true;
  openTrade.closePrice = closePrice;
  openTrade.closeTimestamp = new Date().toISOString();
  openTrade.closeReason = reason;
  openTrade.profit = parseFloat(profit.toFixed(2));
  openTrade.profitPercent = parseFloat(profitPercent.toFixed(2));
  openTrade.durationMinutes = durationMinutes;

  await saveHistory(trades);
  return openTrade;
}

// Formatar duração legível
function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

async function getStats() {
  const trades = await loadHistory();
  const closed = trades.filter(t => t.closed);

  if (closed.length === 0) {
    return {
      totalTrades: 0,
      winners: 0,
      losers: 0,
      winRate: 0,
      totalProfit: 0,
      avgDuration: '—',
      bestTrade: null,
      worstTrade: null,
      openTrades: trades.filter(t => !t.closed).length
    };
  }

  const winners = closed.filter(t => t.profit > 0);
  const losers = closed.filter(t => t.profit <= 0);
  const totalProfit = closed.reduce((sum, t) => sum + t.profit, 0);
  const bestTrade = closed.reduce((best, t) => t.profit > (best?.profit || -Infinity) ? t : best, null);
  const worstTrade = closed.reduce((worst, t) => t.profit < (worst?.profit || Infinity) ? t : worst, null);

  // Duração média
  const durations = closed.filter(t => t.durationMinutes != null).map(t => t.durationMinutes);
  const avgDurationMin = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return {
    totalTrades: closed.length,
    winners: winners.length,
    losers: losers.length,
    winRate: ((winners.length / closed.length) * 100).toFixed(1),
    totalProfit: parseFloat(totalProfit.toFixed(2)),
    avgDuration: formatDuration(avgDurationMin),
    bestTrade,
    worstTrade,
    openTrades: trades.filter(t => !t.closed).length,
    recentTrades: closed.slice(-10).reverse()
  };
}

module.exports = { recordBuy, recordSell, getStats, loadHistory, formatDuration };