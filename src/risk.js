const logger = require('./logger');

const RISK_CONFIG = {
  maxPositionSize: 0.95,      // Usa no máximo 95% do saldo disponível
  stopLossPercent: 0.015,     // Corta perda se cair 1.5%
  takeProfitPercent: 0.03,    // Fecha lucro ao atingir 3%
  maxDailyLoss: 0.05,         // Para o bot se perder 5% no dia
  maxOpenTrades: 1,           // Só 1 trade aberto de cada vez (começo seguro)
};

let dailyStartBalance = null;
let currentDailyLoss = 0;

function setDailyStartBalance(balance) {
  dailyStartBalance = balance;
  logger.info('Saldo inicial do dia definido', { balance });
}

function checkDailyLoss(currentBalance) {
  if (!dailyStartBalance) return false;
  
  const loss = (dailyStartBalance - currentBalance) / dailyStartBalance;
  
  if (loss >= RISK_CONFIG.maxDailyLoss) {
    logger.warn('LIMITE DE PERDA DIÁRIA ATINGIDO — bot pausado', {
      dailyStartBalance,
      currentBalance,
      lossPercent: (loss * 100).toFixed(2) + '%'
    });
    return true; // true = parar o bot
  }
  
  return false;
}

function calculateStopLoss(entryPrice) {
  return entryPrice * (1 - RISK_CONFIG.stopLossPercent);
}

function calculateTakeProfit(entryPrice) {
  return entryPrice * (1 + RISK_CONFIG.takeProfitPercent);
}

function calculatePositionSize(balance, price, symbol = '') {
  const maxCapital = parseFloat(process.env.MAX_CAPITAL) || balance;
  const available = Math.min(balance, maxCapital) * RISK_CONFIG.maxPositionSize;
  const quantity = available / price;

  let result;
  if (symbol.includes('BTC')) result = Math.floor(quantity * 100000) / 100000;
  else if (symbol.includes('ETH')) result = Math.floor(quantity * 10000) / 10000;
  else if (symbol.includes('SOL')) result = Math.floor(quantity * 100) / 100;
  else result = Math.floor(quantity * 1000) / 1000;

  // Quantidades mínimas Binance
  if (symbol.includes('BTC') && result < 0.00001) return 0;
  if (symbol.includes('ETH') && result < 0.0001) return 0;
  if (symbol.includes('SOL') && result < 0.01) return 0;

  return result;
}

module.exports = {
  RISK_CONFIG,
  setDailyStartBalance,
  checkDailyLoss,
  calculateStopLoss,
  calculateTakeProfit,
  calculatePositionSize,
};