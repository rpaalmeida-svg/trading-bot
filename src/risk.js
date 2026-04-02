const logger = require('./logger');

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
  dailyStartBalance = balance;
  logger.info('Saldo inicial do dia definido', { balance: dailyStartBalance });
}

function checkDailyLoss(currentBalance) {
  if (!dailyStartBalance) return false;
  const loss = (dailyStartBalance - currentBalance) / dailyStartBalance;
  if (loss >= RISK_CONFIG.maxDailyLoss) {
    logger.warn('LIMITE DE PERDA DIÁRIA ATINGIDO — novas compras pausadas', {
      dailyStartBalance: dailyStartBalance.toFixed(2),
      currentBalance: currentBalance.toFixed(2),
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

// ─────────────────────────────────────────────────────
// POSITION SIZE — calcula quantidade a comprar
// `allocatedCapital` já vem calculado do bot.js/portfolio.js
// NÃO recalcular — usar directamente
//
// Lot sizes mínimos Binance (Spot):
//   BTC:  0.00001 (stepSize 0.00001)
//   ETH:  0.0001  (stepSize 0.0001)
//   BNB:  0.01    (stepSize 0.01)
//   SOL:  0.01    (stepSize 0.01)
//   DOGE: 1       (stepSize 1)
//   LINK: 0.01    (stepSize 0.01)
//   AVAX: 0.01    (stepSize 0.01)
//   DOT:  0.01    (stepSize 0.01)
//   ADA:  0.1     (stepSize 0.1)
//   MATIC:0.1     (stepSize 0.1)
//   ATOM: 0.01    (stepSize 0.01)
//   NEAR: 0.1     (stepSize 0.1)
//   UNI:  0.01    (stepSize 0.01)
//
// Notional mínimo: $5 para a maioria dos pares USDC
// ─────────────────────────────────────────────────────
function calculatePositionSize(allocatedCapital, price, symbol = '') {
  // Usar 95% do capital alocado (margem de segurança para fees)
  const available = allocatedCapital * RISK_CONFIG.maxPositionSize;
  const quantity = available / price;

  // Arredondar para o stepSize correcto de cada par
  let result;
  if (symbol.includes('BTC')) {
    result = Math.floor(quantity * 100000) / 100000;  // stepSize 0.00001
  } else if (symbol.includes('ETH')) {
    result = Math.floor(quantity * 10000) / 10000;    // stepSize 0.0001
  } else if (symbol.includes('DOGE')) {
    result = Math.floor(quantity);                     // stepSize 1
  } else if (symbol.includes('ADA') || symbol.includes('MATIC') || symbol.includes('NEAR')) {
    result = Math.floor(quantity * 10) / 10;           // stepSize 0.1
  } else {
    // BNB, SOL, LINK, AVAX, DOT, ATOM, UNI e outros
    result = Math.floor(quantity * 100) / 100;         // stepSize 0.01
  }

  // Verificar mínimos
  const notionalValue = result * price;
  if (notionalValue < 5) {
    logger.warn(`Notional abaixo do mínimo para ${symbol}`, {
      quantidade: result,
      notional: notionalValue.toFixed(2),
      minimo: 5
    });
    return 0;
  }

  // Log para debug
  logger.info(`Position size calculado para ${symbol}`, {
    capitalAlocado: allocatedCapital.toFixed(2),
    precoActual: price.toFixed(2),
    quantidade: result,
    notional: notionalValue.toFixed(2)
  });

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