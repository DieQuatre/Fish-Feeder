const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');
const { pool } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required.' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'This username is already taken.' });
    }

    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ error: 'This email is already registered.' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [username, email, password_hash]
    );
    const id = result.rows[0].id;

    const token = jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Registration successful!',
      token,
      user: { id, username, email }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user = result.rows[0];
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful!',
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const result = await pool.query('SELECT id, username FROM users WHERE email = $1', [email]);
    
    // Always return success (don't reveal if email exists)
    if (result.rows.length === 0) {
      return res.json({ message: 'If an account with this email exists, a reset link will be sent.' });
    }

    const user = result.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Invalidate old tokens
    await pool.query('UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]);

    // Save new token
    await pool.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, expiresAt]
    );

    // Build reset URL
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    // Send email
    try {
      const { data, error } = await resend.emails.send({
        from: process.env.SMTP_FROM || 'FishFeeder <onboarding@resend.dev>',
        to: email,
        subject: 'Fish Feeder - Password Reset',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <h2 style="color:#3B82F6;">🐟 Fish Feeder</h2>
            <p>Hi <strong>${user.username}</strong>,</p>
            <p>You requested a password reset. Click the button below to set a new password:</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${resetUrl}" style="background:linear-gradient(135deg,#3B82F6,#8B5CF6);color:white;padding:12px 32px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color:#666;font-size:14px;">This link expires in 30 minutes.</p>
            <p style="color:#999;font-size:12px;">If you didn't request this, you can ignore this email.</p>
          </div>
        `
      });

      if (error) {
        console.error('Email send API error:', error);
        return res.status(500).json({ error: 'Failed to send email via API. Check Resend Key.' });
      }
    } catch (emailErr) {
      console.error('Email send exception:', emailErr);
      return res.status(500).json({ error: 'Failed to send email. Please try again later.' });
    }

    res.json({ message: 'If an account with this email exists, a reset link will be sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const result = await pool.query(
      'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link.' });
    }

    const resetRecord = result.rows[0];
    const password_hash = bcrypt.hashSync(password, 10);

    // Update password
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, resetRecord.user_id]);

    // Mark token as used
    await pool.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [resetRecord.id]);

    res.json({ message: 'Password reset successful! You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, profile_updated FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { username, email } = req.body;
    
    const userCheck = await pool.query('SELECT profile_updated FROM users WHERE id = $1', [req.user.id]);
    if (userCheck.rows.length > 0 && userCheck.rows[0].profile_updated) {
      return res.status(403).json({ error: 'Profile can only be updated once.' });
    }

    if (!username || !email) {
      return res.status(400).json({ error: 'Username and email are required.' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Check uniqueness (exclude current user)
    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, req.user.id]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'This username is already taken.' });
    }

    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ error: 'This email is already registered.' });
    }

    await pool.query('UPDATE users SET username = $1, email = $2, profile_updated = TRUE WHERE id = $3', [username, email, req.user.id]);

    res.json({ message: 'Profile updated successfully!', user: { id: req.user.id, username, email } });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/auth/password
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const valid = bcrypt.compareSync(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect current password.' });
    }

    const password_hash = bcrypt.hashSync(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, req.user.id]);

    res.json({ message: 'Password changed successfully!' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
