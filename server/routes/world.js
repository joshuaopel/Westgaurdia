const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/world/zones
router.get('/zones', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM zones ORDER BY min_level').all());
});

// GET /api/world/zones/:id
router.get('/zones/:id', (req, res) => {
  const db = getDb();
  const zone = db.prepare('SELECT * FROM zones WHERE id=? OR short_name=?').get(req.params.id, req.params.id);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  res.json(zone);
});

// GET /api/world/spells?class=WIZ&level=10
router.get('/spells', (req, res) => {
  const db = getDb();
  let query = 'SELECT * FROM spells WHERE 1=1';
  const params = [];
  if (req.query.class) {
    query += ' AND (req_class IS NULL OR req_class LIKE ?)';
    params.push(`%${req.query.class}%`);
  }
  if (req.query.level) {
    query += ' AND req_level <= ?';
    params.push(parseInt(req.query.level));
  }
  query += ' ORDER BY req_level, name';
  res.json(db.prepare(query).all(...params));
});

// GET /api/world/items
router.get('/items', (req, res) => {
  const db = getDb();
  let query = 'SELECT * FROM items WHERE 1=1';
  const params = [];
  if (req.query.type) { query += ' AND item_type=?'; params.push(req.query.type); }
  if (req.query.search) { query += ' AND name LIKE ?'; params.push(`%${req.query.search}%`); }
  query += ' ORDER BY req_level, name LIMIT 100';
  res.json(db.prepare(query).all(...params));
});

// GET /api/world/npcs
router.get('/npcs', (req, res) => {
  const db = getDb();
  const npcs = db.prepare('SELECT n.*, z.display_name AS zone_name FROM npcs n LEFT JOIN npc_spawns ns ON ns.npc_id=n.id LEFT JOIN zones z ON z.id=ns.zone_id GROUP BY n.id ORDER BY n.level').all();
  res.json(npcs);
});

// GET /api/world/quests
router.get('/quests', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT q.*, n.name AS giver_name FROM quests q LEFT JOIN npcs n ON n.id=q.giver_npc_id ORDER BY q.req_level').all());
});

module.exports = router;
