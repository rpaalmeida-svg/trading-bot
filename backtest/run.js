const axios = require('axios');
require('dotenv').config();

const CAPITAL_INICIAL = 1000;

const CONFIGS = [
  // ETH variações RSI
  { name: 'ETH 30min RSI35/65 SL2.5 TP5', symbol: 'ETHUSDT', interval: '30m', rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'ETH 30min RSI40/60 SL2.5 TP5', symbol: 'ETHUSDT', interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'ETH 30min RSI30/70 SL2.5 TP5', symbol: 'ETHUSDT', interval: '30m', rsiBuy: 30, rsiSell: 70, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'ETH 30min RSI40/60 SL2.0 TP4', symbol: 'ETHUSDT', interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.020, takeProfit: 0.04 },
  { name: 'ETH 30min RSI40/60 SL3.0 TP6', symbol: 'ETHUSDT', interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.030, takeProfit: 0.06 },
  { name: 'ETH 1h RSI40/60 SL2.5 TP5',   symbol: 'ETHUSDT', interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },

  // BTC variações RSI
  { name: 'BTC 1h RSI35/65 SL2.5 TP5',   symbol: 'BTCUSDT', interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'BTC 1h RSI40/60 SL2.5 TP5',   symbol: 'BTCUSDT', interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'BTC 30min RSI40/60 SL2.5 TP5', symbol: 'BTCUSDT', interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },

  // BNB — substituto do SOL
  { name: 'BNB 30min RSI35/65 SL2.5 TP5', symbol: 'BNBUSDT', interval: '30m', rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'BNB 30min RSI40/60 SL2.5 TP5', symbol: 'BNBUSDT', interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'BNB 1h RSI35/65 SL2.5 TP5',   symbol: 'BNBUSDT', interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'BNB 1h RSI40/60 SL2.5 TP5',   symbol: 'BNBUSDT', interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },

  // XRP — alternativa
  { name: 'XRP 30min RSI35/65 SL2.5 TP5', symbol: 'XRPUSDT', interval: '30m', rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'XRP 30min RSI40/60 SL2.5 TP5', symbol: 'XRPUSDT', interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
  { name: 'XRP 1h RSI40/60 SL2.5 TP5',   symbol: 'XRPUSDT', interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 },
];

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
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

async function getHistoricalData(symbol, interval, months = 6) {
  const endTime = Date.now();
  const startTime = endTime - (months * 30 * 24 * 60 * 60 * 1000);
  let allCandles = [];
  let currentStart = startTime;

  while (currentStart < endTime) {
    try {
      const res = await axios.get('https://api.binance.com/api/v3/klines', {
        params: { symbol, interval, startTime: currentStart, endTime, limit: 1000 }
      });
      const candles = res.data;
      if (candles.length === 0) break;
      allCandles = allCandles.concat(candles);
      currentStart = candles[candles.length - 1][0] + 1;
      if (candles.length < 1000) break;
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`Erro ${symbol} ${interval}:`, err.message);
      break;
    }
  }

  return allCandles.map(c => ({
    time: c[0],
    close: parseFloat(c[4]),
  }));
}

function simulate(candles, config) {
  const { rsiBuy, rsiSell, stopLoss, takeProfit } = config;
  let capital = CAPITAL_INICIAL;
  let inPosition = false;
  let entryPrice = null;
  let stopLossPrice = null;
  let takeProfitPrice = null;
  let quantity = 0;
  let maxCapital = CAPITAL_INICIAL;
  let minCapital = CAPITAL_INICIAL;
  const trades = [];

  for (let i = 30; i < candles.length; i++) {
    const prices = candles.slice(Math.max(0, i - 50), i + 1).map(c => c.close);
    const currentPrice = candles[i].close;
    const rsi = calculateRSI(prices, 14);
    const smaFast = calculateSMA(prices, 9);
    const smaSlow = calculateSMA(prices, 21);

    if (!rsi || !smaFast || !smaSlow) continue;

    if (inPosition) {
      if (currentPrice <= stopLossPrice) {
        const profit = (currentPrice - entryPrice) * quantity;
        capital += currentPrice * quantity;
        trades.push({ reason: 'STOP_LOSS', profit, profitPct: ((currentPrice - entryPrice) / entryPrice) * 100 });
        inPosition = false;
        if (capital < minCapital) minCapital = capital;
        continue;
      }
      if (currentPrice >= takeProfitPrice) {
        const profit = (currentPrice - entryPrice) * quantity;
        capital += currentPrice * quantity;
        trades.push({ reason: 'TAKE_PROFIT', profit, profitPct: ((currentPrice - entryPrice) / entryPrice) * 100 });
        inPosition = false;
        if (capital > maxCapital) maxCapital = capital;
        continue;
      }
      if (rsi > rsiSell && smaFast < smaSlow) {
        const profit = (currentPrice - entryPrice) * quantity;
        capital += currentPrice * quantity;
        trades.push({ reason: 'SIGNAL', profit, profitPct: ((currentPrice - entryPrice) / entryPrice) * 100 });
        inPosition = false;
        continue;
      }
    } else {
      if (rsi < rsiBuy && smaFast > smaSlow && capital > 10) {
        quantity = (capital * 0.95) / currentPrice;
        capital -= quantity * currentPrice;
        entryPrice = currentPrice;
        stopLossPrice = currentPrice * (1 - stopLoss);
        takeProfitPrice = currentPrice * (1 + takeProfit);
        inPosition = true;
      }
    }
  }

  if (inPosition) {
    const lastPrice = candles[candles.length - 1].close;
    const profit = (lastPrice - entryPrice) * quantity;
    capital += lastPrice * quantity;
    trades.push({ reason: 'END', profit, profitPct: ((lastPrice - entryPrice) / entryPrice) * 100 });
  }

  const winners = trades.filter(t => t.profit > 0);
  const losers = trades.filter(t => t.profit <= 0);
  const totalProfit = capital - CAPITAL_INICIAL;
  const winRate = trades.length > 0 ? (winners.length / trades.length) * 100 : 0;
  const maxDrawdown = maxCapital > 0 ? ((maxCapital - minCapital) / maxCapital) * 100 : 0;
  const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.profitPct, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.profitPct, 0) / losers.length : 0;

  return {
    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    winRate: winRate.toFixed(1),
    totalProfit: totalProfit.toFixed(2),
    totalProfitPct: ((totalProfit / CAPITAL_INICIAL) * 100).toFixed(1),
    finalCapital: capital.toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(1),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    stopLosses: trades.filter(t => t.reason === 'STOP_LOSS').length,
    takeProfits: trades.filter(t => t.reason === 'TAKE_PROFIT').length,
  };
}

async function run() {
  console.log('\n🔍 BACKTEST AVANÇADO — 6 meses de dados históricos reais');
  console.log('Capital inicial: $' + CAPITAL_INICIAL);
  console.log('Testando: ETH, BTC, BNB, XRP | RSI 30/35/40 | 30min/1h');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = [];
  const cache = {};

  for (const config of CONFIGS) {
    const cacheKey = `${config.symbol}_${config.interval}`;
    if (!cache[cacheKey]) {
      process.stdout.write(`A carregar dados ${config.symbol} ${config.interval}... `);
      cache[cacheKey] = await getHistoricalData(config.symbol, config.interval);
      console.log(`${cache[cacheKey].length} velas`);
      await new Promise(r => setTimeout(r, 500));
    }

    const candles = cache[cacheKey];
    if (candles.length < 50) continue;

    const result = simulate(candles, config);
    results.push({ config, result });

    const emoji = parseFloat(result.totalProfit) >= 0 ? '✅' : '❌';
    console.log(`${emoji} ${config.name} | Win: ${result.winRate}% | P&L: $${result.totalProfit} (${result.totalProfitPct}%) | Drawdown: ${result.maxDrawdown}%`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🏆 TOP 5 CONFIGURAÇÕES\n');

  results
    .sort((a, b) => parseFloat(b.result.totalProfit) - parseFloat(a.result.totalProfit))
    .slice(0, 5)
    .forEach((r, i) => {
      const { config, result } = r;
      const emoji = parseFloat(result.totalProfit) >= 0 ? '✅' : '❌';
      console.log(`${i + 1}. ${emoji} ${config.name}`);
      console.log(`   Trades: ${result.totalTrades} | Win Rate: ${result.winRate}% | Avg Ganho: +${result.avgWin}% | Avg Perda: ${result.avgLoss}%`);
      console.log(`   Stop-Loss: ${result.stopLosses}x | Take-Profit: ${result.takeProfits}x`);
      console.log(`   P&L: $${result.totalProfit} (${result.totalProfitPct}%) | Drawdown: ${result.maxDrawdown}%\n`);
    });

  const best = results.sort((a, b) => parseFloat(b.result.totalProfit) - parseFloat(a.result.totalProfit))[0];
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🎯 CONFIGURAÇÃO RECOMENDADA: ${best.config.name}`);
  console.log(`   RSI Buy: ${best.config.rsiBuy} | RSI Sell: ${best.config.rsiSell}`);
  console.log(`   Stop-Loss: ${best.config.stopLoss * 100}% | Take-Profit: ${best.config.takeProfit * 100}%`);
  console.log(`   Timeframe: ${best.config.interval}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

run().catch(console.error);