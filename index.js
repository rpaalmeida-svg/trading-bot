require('dotenv').config();
const { start } = require('./src/bot');

console.log('🤖 Trading Bot a arrancar...');
console.log(`📊 Par: ${process.env.SYMBOL}`);
console.log(`🔄 Intervalo: 15 minutos`);
console.log('─────────────────────────────');

start().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});