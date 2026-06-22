const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'westgaurdia-secret-change-in-prod';

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username may only contain letters, numbers, and underscores' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM accounts WHERE username=? OR email=?').get(username, email);
  if (existing) return res.status(409).json({ error: 'Username or email already taken' });

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO accounts (username, email, password) VALUES (?,?,?)').run(username, email, hash);

  const token = jwt.sign({ accountId: result.lastInsertRowid, username, role: 'player' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, accountId: result.lastInsertRowid });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const db = getDb();
  const account = db.prepare('SELECT * FROM accounts WHERE username=? COLLATE NOCASE').get(username);
  if (!account) return res.status(401).json({ error: 'Invalid credentials' });
  if (account.banned) return res.status(403).json({ error: 'Account suspended' });

  const valid = await bcrypt.compare(password, account.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  db.prepare('UPDATE accounts SET last_login=? WHERE id=?').run(Date.now() / 1000 | 0, account.id);
  const token = jwt.sign({ accountId: account.id, username: account.username, role: account.role }, JWT_SECRET, { expiresIn: '7d' });

  res.json({ token, username: account.username, accountId: account.id, role: account.role });
});

// GET /api/auth/me  (requires token)
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const account = db.prepare('SELECT id, username, email, role, created_at FROM accounts WHERE id=?').get(req.user.accountId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  res.json(account);
});

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
