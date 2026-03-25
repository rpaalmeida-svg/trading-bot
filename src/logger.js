const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../logs/trading.log');

// Criar pasta logs se não existir
if (!fs.existsSync(path.join(__dirname, '../logs'))) {
  fs.mkdirSync(path.join(__dirname, '../logs'));
}

function log(type, message, data = null) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    type,
    message,
    data
  };

  const line = JSON.stringify(entry);
  
  // Mostrar no terminal
  console.log(`[${timestamp}] [${type}] ${message}`, data ? data : '');
  
  // Guardar em ficheiro
  fs.appendFileSync(logFile, line + '\n');
}

module.exports = {
  info: (msg, data) => log('INFO', msg, data),
  warn: (msg, data) => log('WARN', msg, data),
  error: (msg, data) => log('ERROR', msg, data),
  trade: (msg, data) => log('TRADE', msg, data),
};