require('dotenv').config();
const { start } = require('./src/bot');
const { startDashboard } = require('./src/dashboard');

console.log('🤖 Trading Bot a arrancar...');
console.log(`📊 Par: ${process.env.SYMBOL}`);
console.log(`🔄 Intervalo: 15 minutos`);
console.log('─────────────────────────────');

startDashboard(process.env.PORT || 3000);

start().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});