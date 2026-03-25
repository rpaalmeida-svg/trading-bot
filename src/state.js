const axios = require('axios');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

const POSITIONS_FILE = path.join(__dirname, '../logs/positions.json');
const STATE_FILE = path.join(__dirname, '../logs/state.json');

// Garante que a pasta logs existe
if (!fs.existsSync(path.join(__dirname, '../logs'))) {
  fs.mkdirSync(path.join(__dirname, '../logs'));
}

function savePositions(positions) {
  try {
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
  } catch (err) {
    logger.error('Erro ao guardar posições', { message: err.message });
  }
}

function loadPositions(PAIRS) {
  const empty = {};
  PAIRS.forEach(p => {
    empty[p] = { inPosition: false, entryPrice: null, stopLoss: null, takeProfit: null, quantity: null };
  });

  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
      // Validar que os dados fazem sentido
      let valid = true;
      PAIRS.forEach(p => {
        if (!data[p]) valid = false;
      });
      if (valid) {
        logger.info('Posições carregadas', { data });
        return data;
      }
    }
  } catch (err) {
    logger.error('Erro ao carregar posições', { message: err.message });
  }
  return empty;
}

function saveInitialBalance(balance) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ initialBalance: balance }, null, 2));
  } catch (err) {
    logger.error('Erro ao guardar saldo', { message: err.message });
  }
}

function loadInitialBalance() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return data.initialBalance || null;
    }
  } catch (err) {
    logger.error('Erro ao carregar saldo', { message: err.message });
  }
  return null;
}

module.exports = { savePositions, loadPositions, saveInitialBalance, loadInitialBalance };