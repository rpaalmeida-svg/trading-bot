// ─────────────────────────────────────────────────────
// ML SNAPSHOTS — logging passivo de indicadores
//
// Guarda uma fotografia de todos os indicadores no momento
// de cada compra e venda. Custa zero em performance.
// Com 50-100 trades vamos ter dados para perceber
// o que funciona e optimizar a estratégia.
// ─────────────────────────────────────────────────────

const { saveState, loadState } = require('./database');
const logger = require('./logger');

const ML_KEY = 'ml_snapshots';
const MAX_SNAPSHOTS = 500;

async function logSnapshot(data) {
  try {
    const snapshots = await loadState(ML_KEY) || [];

    snapshots.push({
      timestamp: new Date().toISOString(),
      ...data
    });

    // Manter últimos 500
    if (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
    }

    await saveState(ML_KEY, snapshots);
    logger.info(`ML snapshot guardado: ${data.action} ${data.symbol}`, {
      score: data.compositeScore,
      technicalScore: data.technicalScore,
      macroScore: data.macroScore
    });
  } catch (err) {
    // Nunca bloquear o bot por causa de ML
    logger.warn('Erro ao guardar ML snapshot', { message: err.message });
  }
}

// Snapshot de COMPRA — indicadores no momento da decisão
async function logBuySnapshot(analysis, macroData, sentiment) {
  await logSnapshot({
    action: 'BUY',
    symbol: analysis.symbol,
    price: analysis.currentPrice,
    rsi: analysis.rsi ? parseFloat(analysis.rsi.toFixed(2)) : null,
    smaFast: analysis.smaFast ? parseFloat(analysis.smaFast.toFixed(2)) : null,
    smaSlow: analysis.smaSlow ? parseFloat(analysis.smaSlow.toFixed(2)) : null,
    macdHistogram: analysis.macd ? parseFloat(analysis.macd.histogram.toFixed(6)) : null,
    macdAboveSignal: analysis.macd ? analysis.macd.macdLine > analysis.macd.signalLine : null,
    bbPercentB: analysis.bb ? parseFloat(analysis.bb.percentB.toFixed(3)) : null,
    atrPct: analysis.atrData ? parseFloat(analysis.atrData.atrPct.toFixed(2)) : null,
    trend4h: analysis.trend4h,
    candlePattern: analysis.candlePattern,
    volumeRatio: analysis.volumeRatio ? parseFloat(analysis.volumeRatio.toFixed(2)) : null,
    signal: analysis.signal,
    technicalScore: analysis.technicalScore,
    macroScore: analysis.macroScore,
    compositeScore: analysis.score,
    fearGreed: sentiment.value,
    newsSignal: macroData.signal,
    newsScore: macroData.sentimentScore
  });
}

// Snapshot de VENDA — indicadores + resultado
async function logSellSnapshot(analysis, trade, reason, sentiment, macroData) {
  await logSnapshot({
    action: 'SELL',
    reason,
    symbol: analysis ? analysis.symbol : trade.symbol,
    price: analysis ? analysis.currentPrice : trade.closePrice,
    entryPrice: trade ? trade.price : null,
    rsi: analysis?.rsi ? parseFloat(analysis.rsi.toFixed(2)) : null,
    trend4h: analysis?.trend4h || null,
    technicalScore: analysis?.technicalScore || null,
    macroScore: analysis?.macroScore || null,
    compositeScore: analysis?.score || null,
    fearGreed: sentiment ? sentiment.value : null,
    // Resultado
    profit: trade ? trade.profit : null,
    profitPercent: trade ? trade.profitPercent : null,
    durationMinutes: trade ? trade.durationMinutes : null
  });
}

// Obter todos os snapshots (para análise futura)
async function getSnapshots() {
  try {
    return await loadState(ML_KEY) || [];
  } catch {
    return [];
  }
}

module.exports = { logBuySnapshot, logSellSnapshot, getSnapshots };