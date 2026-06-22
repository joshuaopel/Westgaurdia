// GM Tools API — spawn placement, patrol paths, live zone inspection
// Requires role: gm or admin

const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');
const world = require('../game/world');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  if (req.user.role !== 'gm' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'GM access required' });
  }
  next();
});

// ================================================================
// SPAWN POINTS
// ================================================================

// GET /api/gm/spawns?zone_id=1
router.get('/spawns', (req, res) => {
  const db = getDb();
  const { zone_id } = req.query;
  let query = `
    SELECT ns.*, n.name AS npc_name, n.level AS npc_level, n.npc_type,
           n.is_aggro, n.aggro_range, n.leash_range,
           pp.name AS path_name, pp.loop_type
    FROM npc_spawns ns
    JOIN npcs n ON n.id = ns.npc_id
    LEFT JOIN patrol_paths pp ON pp.id = ns.path_id
  `;
  const params = [];
  if (zone_id) { query += ' WHERE ns.zone_id=?'; params.push(zone_id); }
  query += ' ORDER BY ns.zone_id, ns.id';
  res.json(db.prepare(query).all(...params));
});

// POST /api/gm/spawns  — place a new spawn point
router.post('/spawns', (req, res) => {
  const { npc_id, zone_id, x, y, z, heading, respawn_time, wander, wander_radius,
          path_id, aggro_range_override, leash_range_override, spawn_group, editor_note } = req.body;
  if (!npc_id || !zone_id) return res.status(400).json({ error: 'npc_id and zone_id required' });

  const db = getDb();
  const npc = db.prepare('SELECT id FROM npcs WHERE id=?').get(npc_id);
  if (!npc) return res.status(404).json({ error: 'NPC not found' });

  const result = db.prepare(`
    INSERT INTO npc_spawns
      (npc_id, zone_id, x, y, z, heading, respawn_time, wander, wander_radius,
       path_id, aggro_range_override, leash_range_override, spawn_group, editor_note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    npc_id, zone_id, x ?? 0, y ?? 0, z ?? 0, heading ?? 0,
    respawn_time ?? 300, wander ? 1 : 0, wander_radius ?? 50,
    path_id ?? null, aggro_range_override ?? null, leash_range_override ?? null,
    spawn_group ?? null, editor_note ?? null
  );

  // Hot-reload in live zone if it's active
  const zoneInst = world.zones.get(parseInt(zone_id));
  if (zoneInst) zoneInst._loadNpcs();  // reload all spawns for zone

  const row = db.prepare('SELECT ns.*, n.name AS npc_name FROM npc_spawns ns JOIN npcs n ON n.id=ns.npc_id WHERE ns.id=?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PATCH /api/gm/spawns/:id  — update spawn properties
router.patch('/spawns/:id', (req, res) => {
  const db = getDb();
  const spawn = db.prepare('SELECT * FROM npc_spawns WHERE id=?').get(req.params.id);
  if (!spawn) return res.status(404).json({ error: 'Spawn not found' });

  const fields = ['x','y','z','heading','respawn_time','wander','wander_radius','path_id',
                  'aggro_range_override','leash_range_override','spawn_group','editor_note','npc_id'];
  const updates = [];
  const vals = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { updates.push(`${f}=?`); vals.push(req.body[f]); }
  });
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(req.params.id);
  db.prepare(`UPDATE npc_spawns SET ${updates.join(',')} WHERE id=?`).run(...vals);

  // Hot-reload
  const zoneInst = world.zones.get(spawn.zone_id);
  if (zoneInst) zoneInst._loadNpcs();

  res.json(db.prepare('SELECT * FROM npc_spawns WHERE id=?').get(req.params.id));
});

// DELETE /api/gm/spawns/:id
router.delete('/spawns/:id', (req, res) => {
  const db = getDb();
  const spawn = db.prepare('SELECT * FROM npc_spawns WHERE id=?').get(req.params.id);
  if (!spawn) return res.status(404).json({ error: 'Spawn not found' });
  db.prepare('DELETE FROM npc_spawns WHERE id=?').run(req.params.id);

  const zoneInst = world.zones.get(spawn.zone_id);
  if (zoneInst) zoneInst._loadNpcs();

  res.json({ success: true });
});

// ================================================================
// PATROL PATHS
// ================================================================

// GET /api/gm/paths?zone_id=1
router.get('/paths', (req, res) => {
  const db = getDb();
  const { zone_id } = req.query;
  const paths = zone_id
    ? db.prepare('SELECT * FROM patrol_paths WHERE zone_id=?').all(zone_id)
    : db.prepare('SELECT * FROM patrol_paths').all();

  // Attach waypoints
  paths.forEach(p => {
    p.waypoints = db.prepare('SELECT * FROM patrol_waypoints WHERE path_id=? ORDER BY step_order').all(p.id);
  });
  res.json(paths);
});

// POST /api/gm/paths  — create a patrol path with waypoints
router.post('/paths', (req, res) => {
  const { name, zone_id, loop_type, waypoints } = req.body;
  if (!name || !zone_id) return res.status(400).json({ error: 'name and zone_id required' });

  const db = getDb();
  const pathResult = db.prepare(
    'INSERT INTO patrol_paths (name, zone_id, loop_type) VALUES (?,?,?)'
  ).run(name, zone_id, loop_type || 'loop');

  const pathId = pathResult.lastInsertRowid;
  const insertWp = db.prepare(
    'INSERT INTO patrol_waypoints (path_id, step_order, x, y, z, heading, wait_time) VALUES (?,?,?,?,?,?,?)'
  );

  (waypoints || []).forEach((wp, i) => {
    insertWp.run(pathId, i + 1, wp.x ?? 0, wp.y ?? 0, wp.z ?? 0, wp.heading ?? 0, wp.wait_time ?? 0);
  });

  res.status(201).json({
    id: pathId, name, zone_id, loop_type: loop_type || 'loop',
    waypoints: db.prepare('SELECT * FROM patrol_waypoints WHERE path_id=? ORDER BY step_order').all(pathId),
  });
});

// PATCH /api/gm/paths/:id  — rename / change loop_type
router.patch('/paths/:id', (req, res) => {
  const db = getDb();
  const { name, loop_type } = req.body;
  const sets = [], vals = [];
  if (name)      { sets.push('name=?');      vals.push(name); }
  if (loop_type) { sets.push('loop_type=?'); vals.push(loop_type); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE patrol_paths SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json(db.prepare('SELECT * FROM patrol_paths WHERE id=?').get(req.params.id));
});

// PUT /api/gm/paths/:id/waypoints  — replace all waypoints
router.put('/paths/:id/waypoints', (req, res) => {
  const db = getDb();
  const path = db.prepare('SELECT * FROM patrol_paths WHERE id=?').get(req.params.id);
  if (!path) return res.status(404).json({ error: 'Path not found' });

  db.prepare('DELETE FROM patrol_waypoints WHERE path_id=?').run(path.id);
  const insertWp = db.prepare(
    'INSERT INTO patrol_waypoints (path_id, step_order, x, y, z, heading, wait_time) VALUES (?,?,?,?,?,?,?)'
  );
  (req.body.waypoints || []).forEach((wp, i) => {
    insertWp.run(path.id, i + 1, wp.x ?? 0, wp.y ?? 0, wp.z ?? 0, wp.heading ?? 0, wp.wait_time ?? 0);
  });

  // Hot-reload any zone that has this path
  world.zones.forEach((zone, zoneId) => {
    if (zoneId === path.zone_id) zone._loadNpcs();
  });

  res.json({ waypoints: db.prepare('SELECT * FROM patrol_waypoints WHERE path_id=? ORDER BY step_order').all(path.id) });
});

// DELETE /api/gm/paths/:id
router.delete('/paths/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM patrol_paths WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ================================================================
// LIVE ZONE INSPECTION
// ================================================================

// GET /api/gm/zone/:id/live  — current NPC states (for overlay)
router.get('/zone/:id/live', (req, res) => {
  const zoneInst = world.zones.get(parseInt(req.params.id));
  if (!zoneInst) return res.json({ npcs: [], players: [] });
  res.json(zoneInst.getSnapshot());
});

// GET /api/gm/npcs  — all NPC templates for spawn picker
router.get('/npcs', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT id, name, level, npc_type, is_aggro, aggro_range, leash_range FROM npcs ORDER BY level, name').all());
});

// POST /api/gm/accounts/:id/role  — promote to GM (admin only)
router.post('/accounts/:id/role', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { role } = req.body;
  if (!['player','gm','admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  getDb().prepare('UPDATE accounts SET role=? WHERE id=?').run(role, req.params.id);
  res.json({ success: true });
});

module.exports = router;
