const logger = require('./logger');

const PAIRS_COUNT = 3;

const RISK_CONFIG = {
  maxPositionSize: 0.95,
  stopLossPercent: 0.015,
  takeProfitPercent: 0.03,
  trailingStopPercent: 0.012,
  maxDailyLoss: 0.05,
  maxOpenTrades: 3,
};

let dailyStartBalance = null;

function setDailyStartBalance(balance) {
  const maxCapital = parseFloat(process.env.MAX_CAPITAL) || balance;
  dailyStartBalance = Math.min(balance, maxCapital);
  logger.info('Saldo inicial do dia definido', { balance: dailyStartBalance });
}

function checkDailyLoss(currentBalance) {
  if (!dailyStartBalance) return false;
  const maxCapital = parseFloat(process.env.MAX_CAPITAL) || currentBalance;
  const referenceBalance = Math.min(currentBalance, maxCapital);
  const loss = (dailyStartBalance - referenceBalance) / dailyStartBalance;
  if (loss >= RISK_CONFIG.maxDailyLoss) {
    logger.warn('LIMITE DE PERDA DIÁRIA ATINGIDO — bot pausado', {
      dailyStartBalance,
      currentBalance,
      lossPercent: (loss * 100).toFixed(2) + '%'
    });
    return true;
  }
  return false;
}

function calculateStopLoss(entryPrice) {
  return entryPrice * (1 - RISK_CONFIG.stopLossPercent);
}

function calculateTakeProfit(entryPrice) {
  return entryPrice * (1 + RISK_CONFIG.takeProfitPercent);
}

function updateTrailingStop(currentPrice, currentStopLoss) {
  const newStop = currentPrice * (1 - RISK_CONFIG.trailingStopPercent);
  if (newStop > currentStopLoss) {
    logger.info('Trailing Stop-Loss actualizado', {
      oldStop: currentStopLoss.toFixed(2),
      newStop: newStop.toFixed(2),
      currentPrice: currentPrice.toFixed(2)
    });
    return newStop;
  }
  return currentStopLoss;
}

function calculatePositionSize(balance, price, symbol = '') {
  const maxCapital = parseFloat(process.env.MAX_CAPITAL) || balance;
  const capitalPerPair = maxCapital / PAIRS_COUNT;
  const available = Math.min(balance, capitalPerPair) * RISK_CONFIG.maxPositionSize;
  const quantity = available / price;

  let result;
  if (symbol.includes('BTC')) result = Math.floor(quantity * 100000) / 100000;
  else if (symbol.includes('ETH')) result = Math.floor(quantity * 10000) / 10000;
  else if (symbol.includes('SOL')) result = Math.floor(quantity * 100) / 100;
  else result = Math.floor(quantity * 1000) / 1000;

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
  updateTrailingStop,
  calculatePositionSize,
};