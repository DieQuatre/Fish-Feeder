const express = require('express');
const { pool } = require('../db/database');

const router = express.Router();

// Middleware: Authenticate device by token
async function authenticateDevice(req, res, next) {
  const token = req.headers['x-device-token'] || req.body.device_token;

  if (!token) {
    return res.status(401).json({ error: 'Device token gerekli.' });
  }

  try {
    const result = await pool.query('SELECT * FROM devices WHERE device_token = $1', [token]);
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Geçersiz device token.' });
    }
    req.device = result.rows[0];
    next();
  } catch (err) {
    console.error('Device auth error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
}

// POST /api/esp/heartbeat
router.post('/heartbeat', authenticateDevice, async (req, res) => {
  try {
    const { food_level_percent } = req.body;
    const foodLevel = (typeof food_level_percent === 'number')
      ? Math.max(0, Math.min(100, food_level_percent))
      : req.device.food_level_percent;

    await pool.query(
      'UPDATE devices SET is_online = TRUE, last_seen = NOW(), food_level_percent = $1 WHERE id = $2',
      [foodLevel, req.device.id]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// GET /api/esp/commands
router.get('/commands', authenticateDevice, async (req, res) => {
  try {
    const result = await pool.query('SELECT pending_feed FROM devices WHERE id = $1', [req.device.id]);

    const commands = [];
    if (result.rows[0] && result.rows[0].pending_feed) {
      commands.push({ action: 'feed' });
      await pool.query('UPDATE devices SET pending_feed = FALSE WHERE id = $1', [req.device.id]);
    }

    res.json({ commands });
  } catch (err) {
    console.error('Commands error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// POST /api/esp/feed-done
router.post('/feed-done', authenticateDevice, async (req, res) => {
  try {
    const triggered_by = req.body.triggered_by || 'manual';

    await pool.query(
      'INSERT INTO feed_logs (device_id, triggered_by) VALUES ($1, $2)',
      [req.device.id, triggered_by]
    );

    res.json({ status: 'ok', message: 'Besleme kaydedildi.' });
  } catch (err) {
    console.error('Feed done error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

module.exports = router;
