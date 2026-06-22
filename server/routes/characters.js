const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');
const { RACES, CLASSES, calcMaxHp, calcMaxMana, calcMaxEndurance } = require('../game/constants');

const router = express.Router();
router.use(requireAuth);

// GET /api/characters  - list characters for account
router.get('/', (req, res) => {
  const db = getDb();
  const chars = db.prepare(`
    SELECT c.id, c.name, c.race, c.class, c.gender, c.level, c.experience,
           z.display_name AS zone_name, c.last_played, c.created_at
    FROM characters c
    JOIN zones z ON z.id = c.zone_id
    WHERE c.account_id=? AND c.is_deleted=0
    ORDER BY c.last_played DESC
  `).all(req.user.accountId);
  res.json(chars);
});

// POST /api/characters  - create character
router.post('/', (req, res) => {
  const { name, race, classKey, gender } = req.body;
  const db = getDb();

  // Validation
  if (!name || !race || !classKey) return res.status(400).json({ error: 'Name, race, and class required' });
  if (name.length < 3 || name.length > 20) return res.status(400).json({ error: 'Name must be 3-20 characters' });
  if (!/^[A-Za-z]+$/.test(name)) return res.status(400).json({ error: 'Name may only contain letters' });

  const raceDef = RACES[race.toLowerCase()];
  if (!raceDef) return res.status(400).json({ error: 'Invalid race', valid: Object.keys(RACES) });

  const classDef = CLASSES[classKey.toUpperCase()];
  if (!classDef) return res.status(400).json({ error: 'Invalid class', valid: Object.keys(CLASSES) });

  if (!raceDef.classes.includes(classKey.toUpperCase())) {
    return res.status(400).json({ error: `${raceDef.name} cannot be a ${classDef.name}` });
  }

  // Check name uniqueness
  const taken = db.prepare('SELECT id FROM characters WHERE name=? COLLATE NOCASE').get(name);
  if (taken) return res.status(409).json({ error: 'Name already taken' });

  // Check slot limit (max 8 per account)
  const count = db.prepare('SELECT COUNT(*) AS c FROM characters WHERE account_id=? AND is_deleted=0').get(req.user.accountId);
  if (count.c >= 8) return res.status(400).json({ error: 'Character limit reached (8)' });

  // Base stats from race
  const str = raceDef.str, sta = raceDef.sta, agi = raceDef.agi, dex = raceDef.dex;
  const int = raceDef.int, wis = raceDef.wis, cha = raceDef.cha;

  const hp_max = calcMaxHp(1, sta, classKey.toUpperCase());
  const statForMana = ['WIZ','MAG','NEC','ENC','SHD'].includes(classKey.toUpperCase()) ? int : wis;
  const mana_max = calcMaxMana(1, statForMana, classKey.toUpperCase());
  const end_max = calcMaxEndurance(1, sta);

  // Start zone = qeynos_hills
  const startZone = db.prepare("SELECT id, safe_x, safe_y, safe_z FROM zones WHERE short_name='qeynos_hills'").get();
  if (!startZone) return res.status(500).json({ error: 'Start zone not found. Run seed first.' });

  const result = db.prepare(`
    INSERT INTO characters (account_id, name, race, class, gender, level, experience,
      str, sta, agi, dex, int, wis, cha,
      hp_current, hp_max, mana_current, mana_max, end_current, end_max,
      zone_id, pos_x, pos_y, pos_z)
    VALUES (?,?,?,?,?,1,0, ?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?)
  `).run(
    req.user.accountId, name, race.toLowerCase(), classKey.toUpperCase(),
    gender || 'male',
    str, sta, agi, dex, int, wis, cha,
    hp_max, hp_max, mana_max, mana_max, end_max, end_max,
    startZone.id, startZone.safe_x, startZone.safe_y, startZone.safe_z
  );

  const newChar = db.prepare('SELECT * FROM characters WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(newChar);
});

// GET /api/characters/:id  - full character sheet
router.get('/:id', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT * FROM characters WHERE id=? AND account_id=? AND is_deleted=0')
    .get(req.params.id, req.user.accountId);
  if (!char) return res.status(404).json({ error: 'Not found' });

  const inventory = db.prepare(`
    SELECT ci.*, i.name, i.icon, i.item_type, i.slot AS item_slot, i.ac, i.dmg_min, i.dmg_max, i.weight
    FROM character_inventory ci JOIN items i ON i.id = ci.item_id
    WHERE ci.character_id=?
  `).all(char.id);

  const spellbook = db.prepare(`
    SELECT cs.*, s.name, s.description, s.spell_type, s.school, s.mana_cost, s.cast_time, s.icon
    FROM character_spells cs JOIN spells s ON s.id = cs.spell_id
    WHERE cs.character_id=?
  `).all(char.id);

  const quests = db.prepare(`
    SELECT cq.*, q.name AS quest_name, q.description AS quest_description
    FROM character_quests cq JOIN quests q ON q.id = cq.quest_id
    WHERE cq.character_id=? AND cq.status='active'
  `).all(char.id);

  const zone = db.prepare('SELECT * FROM zones WHERE id=?').get(char.zone_id);
  const { expForLevel } = require('../game/constants');

  res.json({
    character: char,
    zone,
    inventory,
    spellbook,
    active_quests: quests,
    exp_to_next: expForLevel(char.level + 1),
    race_def: RACES[char.race],
    class_def: CLASSES[char.class],
  });
});

// DELETE /api/characters/:id  (soft delete)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT id FROM characters WHERE id=? AND account_id=?').get(req.params.id, req.user.accountId);
  if (!char) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE characters SET is_deleted=1 WHERE id=?').run(char.id);
  res.json({ success: true });
});

// GET /api/characters/options  - race/class options for creation
router.get('/meta/options', (req, res) => {
  res.json({ races: RACES, classes: CLASSES });
});

module.exports = router;
