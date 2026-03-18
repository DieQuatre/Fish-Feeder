const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

// GET /api/devices
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, device_token, name, is_online, last_seen, food_level_percent, pending_feed, created_at FROM devices WHERE user_id = $1',
      [req.user.id]
    );

    const devices = result.rows.map(d => {
      // Check if actually online (last seen within 30 seconds)
      if (d.last_seen) {
        const lastSeen = new Date(d.last_seen).getTime();
        d.is_online = (Date.now() - lastSeen) < 30000;
      }
      return d;
    });

    res.json({ devices });
  } catch (err) {
    console.error('Get devices error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// POST /api/devices
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    const deviceName = name || 'Balık Yemleyici';
    const device_token = 'DEV-' + uuidv4().replace(/-/g, '').substring(0, 24).toUpperCase();

    const result = await pool.query(
      'INSERT INTO devices (user_id, device_token, name) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, device_token, deviceName]
    );

    res.status(201).json({
      message: 'Cihaz eklendi!',
      device: { id: result.rows[0].id, device_token, name: deviceName }
    });
  } catch (err) {
    console.error('Add device error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// DELETE /api/devices/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM devices WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cihaz bulunamadı.' });
    }
    await pool.query('DELETE FROM feed_logs WHERE device_id = $1', [req.params.id]);
    await pool.query('DELETE FROM devices WHERE id = $1', [req.params.id]);
    res.json({ message: 'Cihaz silindi.' });
  } catch (err) {
    console.error('Delete device error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// POST /api/devices/:id/feed
router.post('/:id/feed', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM devices WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cihaz bulunamadı.' });
    }
    await pool.query('UPDATE devices SET pending_feed = TRUE WHERE id = $1', [req.params.id]);
    res.json({ message: 'Besleme komutu gönderildi!' });
  } catch (err) {
    console.error('Feed command error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// GET /api/devices/:id/logs
router.get('/:id/logs', async (req, res) => {
  try {
    const device = await pool.query('SELECT * FROM devices WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (device.rows.length === 0) {
      return res.status(404).json({ error: 'Cihaz bulunamadı.' });
    }
    const logs = await pool.query(
      'SELECT id, fed_at, triggered_by FROM feed_logs WHERE device_id = $1 ORDER BY fed_at DESC LIMIT 20',
      [req.params.id]
    );
    res.json({ logs: logs.rows });
  } catch (err) {
    console.error('Get logs error:', err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

module.exports = router;
