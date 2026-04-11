const axios = require('axios');
require('dotenv').config();

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;

async function sendMessage(message) {
  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('Erro Telegram:', err.message);
  }
}

function formatStatus(data) {
  const pairsInfo = data.pairs ? data.pairs.map(p => {
    const sym = p.symbol.replace('USDC', '');
    const statusIcon = p.inPosition ? '🔵 Em posição' : 'Aguardar';
    const trendIcon = p.trend4h === 'BULLISH' ? '▲' : p.trend4h === 'BEARISH' ? '▼' : '—';
    return `\n  <b>${sym}USDC</b> — RSI: ${p.rsi} | Score: ${p.score}/100 | ${trendIcon} ${p.trend4h || '—'} | ${statusIcon}`;
  }).join('') : '';

  const newsEmoji = data.news === 'POSITIVE' ? '📈' : data.news === 'NEGATIVE' ? '📉' : '📰';
  const newsTitlesText = data.newsTitles && data.newsTitles.length > 0
    ? '\n' + data.newsTitles.map(t => `• ${t.substring(0, 60)}...`).join('\n')
    : '';

  const change = parseFloat(data.balanceChange || 0);
  const changePct = parseFloat(data.balanceChangePct || 0);
  const changeEmoji = change >= 0 ? '📈' : '📉';

  return `
🤖 <b>Trading Bot — Ponto de Situação</b>
─────────────────────
💰 Saldo: <b>$${data.balance}</b>
${changeEmoji} Variação: <b>${change >= 0 ? '+' : ''}$${change} (${changePct}%)</b>
${data.fearGreedEmoji} Fear &amp; Greed: <b>${data.fearGreed} — ${data.fearGreedLabel}</b>
${newsEmoji} Notícias: <b>${data.news}</b> (score: ${data.newsScore})${newsTitlesText}
─────────────────────
📊 <b>Pares</b>${pairsInfo}
─────────────────────
📈 <b>Performance</b>
✅ Trades: <b>${data.totalTrades}</b>
🎯 Win Rate: <b>${data.winRate}%</b>
💵 P&amp;L Total: <b>${data.totalProfit >= 0 ? '+' : ''}$${data.totalProfit}</b>
─────────────────────
🕐 ${new Date().toLocaleString('pt-PT')}
  `;
}

function formatTrade(type, data) {
  const emoji = type === 'BUY' ? '🟢 COMPRA' : '🔴 VENDA';
  const sym = data.symbol.replace('USDC', '/USDC');

  if (type === 'BUY') {
    return `
${emoji} <b>Ordem Executada!</b>
─────────────────────
📊 Par: <b>${sym}</b>
💵 Preço: <b>$${data.price}</b>
📦 Quantidade: <b>${data.quantity}</b>
🛑 Stop-Loss: $${data.stopLoss}
🎯 Take-Profit: $${data.takeProfit}
─────────────────────
🕐 ${new Date().toLocaleString('pt-PT')}
    `;
  }

  // VENDA — com P&L %, duração se disponível
  const profitSign = parseFloat(data.profit) >= 0 ? '+' : '';
  const profitEmoji = parseFloat(data.profit) >= 0 ? '✅' : '❌';
  const pctText = data.profitPercent != null ? ` (${parseFloat(data.profitPercent) >= 0 ? '+' : ''}${data.profitPercent}%)` : '';
  const durationText = data.duration ? `\n⏱ Duração: <b>${data.duration}</b>` : '';
  const reasonText = data.reason ? `\n📋 Motivo: <b>${data.reason}</b>` : '';

  return `
${emoji} <b>Ordem Executada!</b>
─────────────────────
📊 Par: <b>${sym}</b>
💵 Preço: <b>$${data.price}</b>
📦 Quantidade: <b>${data.quantity}</b>
${profitEmoji} Resultado: <b>${profitSign}$${data.profit}${pctText}</b>${durationText}${reasonText}
─────────────────────
🕐 ${new Date().toLocaleString('pt-PT')}
  `;
}

function formatAlert(message) {
  return `⚠️ <b>ALERTA</b>\n─────────────────────\n${message}\n─────────────────────\n🕐 ${new Date().toLocaleString('pt-PT')}`;
}

module.exports = { sendMessage, formatStatus, formatTrade, formatAlert };