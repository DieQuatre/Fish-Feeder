const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, securityQuestion, securityAnswer } = req.body;

    if (!username || !email || !password || !securityQuestion || !securityAnswer) {
      return res.status(400).json({ error: 'All fields including security question and answer are required.' });
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
    const answer_hash = bcrypt.hashSync(securityAnswer.trim().toLowerCase(), 10);
    
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, security_question, security_answer) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, email, password_hash, securityQuestion, answer_hash]
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

// POST /api/auth/get-security-question
router.post('/get-security-question', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Username or email is required.' });
    }

    const result = await pool.query('SELECT id, security_question FROM users WHERE username = $1 OR email = $2', [identifier, identifier]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];

    if (!user.security_question) {
      return res.status(400).json({ error: 'This account does not have a security question set up. Please contact an admin.' });
    }

    res.json({ question: user.security_question });
  } catch (err) {
    console.error('Get security question error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/reset-password-security
router.post('/reset-password-security', async (req, res) => {
  try {
    const { identifier, answer, newPassword } = req.body;

    if (!identifier || !answer || !newPassword) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const result = await pool.query(
      'SELECT id, username, security_answer FROM users WHERE username = $1 OR email = $2',
      [identifier, identifier]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(answer.trim().toLowerCase(), user.security_answer);

    if (!match) {
      return res.status(400).json({ error: 'Incorrect answer.' });
    }

    // Update password
    const password_hash = bcrypt.hashSync(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, user.id]);

    res.json({ message: 'Password reset successful! You can now sign in.', username: user.username });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, profile_updated, security_question FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = result.rows[0];
    res.json({ ...user, hasSecurityQuestion: !!user.security_question });
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

// PUT /api/auth/security-question
router.put('/security-question', authenticateToken, async (req, res) => {
  try {
    const { securityQuestion, securityAnswer } = req.body;
    if (!securityQuestion || !securityAnswer) {
      return res.status(400).json({ error: 'Question and answer are required.' });
    }

    const userCheck = await pool.query('SELECT security_question FROM users WHERE id = $1', [req.user.id]);
    if (userCheck.rows[0].security_question) {
      return res.status(400).json({ error: 'Security question is already set.' });
    }

    const answer_hash = bcrypt.hashSync(securityAnswer.trim().toLowerCase(), 10);
    await pool.query('UPDATE users SET security_question = $1, security_answer = $2 WHERE id = $3', 
      [securityQuestion, answer_hash, req.user.id]
    );

    res.json({ message: 'Security question saved successfully!' });
  } catch (err) {
    console.error('Set security question error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
