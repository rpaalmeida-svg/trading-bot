const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_state (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    logger.info('Base de dados iniciada');
  } catch (err) {
    logger.error('Erro ao iniciar base de dados', { message: err.message });
  }
}

async function saveState(key, value) {
  try {
    await pool.query(`
      INSERT INTO bot_state (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `, [key, JSON.stringify(value)]);
  } catch (err) {
    logger.error('Erro ao guardar estado', { key, message: err.message });
  }
}

async function loadState(key) {
  try {
    const res = await pool.query('SELECT value FROM bot_state WHERE key = $1', [key]);
    if (res.rows.length > 0) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (err) {
    logger.error('Erro ao carregar estado', { key, message: err.message });
  }
  return null;
}

module.exports = { initDB, saveState, loadState };