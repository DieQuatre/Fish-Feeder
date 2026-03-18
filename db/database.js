const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_token TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT 'Balık Yemleyici',
        is_online BOOLEAN DEFAULT FALSE,
        last_seen TIMESTAMP,
        food_level_percent INTEGER DEFAULT -1,
        pending_feed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS feed_logs (
        id SERIAL PRIMARY KEY,
        device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        fed_at TIMESTAMP DEFAULT NOW(),
        triggered_by TEXT DEFAULT 'manual'
      )
    `);

    console.log('✅ PostgreSQL tabloları hazır.');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
