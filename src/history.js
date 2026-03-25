const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../logs/trades.json');

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveHistory(trades) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trades, null, 2));
}

function recordBuy(symbol, price, quantity, stopLoss, takeProfit) {
  const trades = loadHistory();
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
    closeReason: null
  };
  trades.push(trade);
  saveHistory(trades);
  return trade;
}

function recordSell(symbol, closePrice, reason = 'TAKE_PROFIT') {
  const trades = loadHistory();
  const openTrade = trades
    .filter(t => t.symbol === symbol && !t.closed)
    .sort((a, b) => b.id - a.id)[0];

  if (!openTrade) return null;

  const profit = (closePrice - openTrade.price) * openTrade.quantity;
  const profitPercent = ((closePrice - openTrade.price) / openTrade.price) * 100;

  openTrade.closed = true;
  openTrade.closePrice = closePrice;
  openTrade.closeTimestamp = new Date().toISOString();
  openTrade.closeReason = reason;
  openTrade.profit = parseFloat(profit.toFixed(2));
  openTrade.profitPercent = parseFloat(profitPercent.toFixed(2));

  saveHistory(trades);
  return openTrade;
}

function getStats() {
  const trades = loadHistory();
  const closed = trades.filter(t => t.closed);

  if (closed.length === 0) {
    return {
      totalTrades: 0,
      winners: 0,
      losers: 0,
      winRate: 0,
      totalProfit: 0,
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

  return {
    totalTrades: closed.length,
    winners: winners.length,
    losers: losers.length,
    winRate: ((winners.length / closed.length) * 100).toFixed(1),
    totalProfit: parseFloat(totalProfit.toFixed(2)),
    bestTrade,
    worstTrade,
    openTrades: trades.filter(t => !t.closed).length,
    recentTrades: closed.slice(-10).reverse()
  };
}

module.exports = { recordBuy, recordSell, getStats, loadHistory };