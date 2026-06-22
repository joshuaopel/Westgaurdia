#!/usr/bin/env node
// Import a Blender-authored zone manifest into the database.
//
// Usage:
//   npm run import:zone -- content/zones/qeynos_hills.zone.json
//   npm run import:zone -- content/zones/qeynos_hills.zone.json --replace-spawns
//
// --replace-spawns  Delete all existing npc_spawns, patrol_paths, patrol_waypoints,
//                   and zone_triggers for this zone before inserting from the manifest.
//                   Omit the flag for a dry-run validation only.

'use strict';

const fs   = require('fs');
const path = require('path');
const { getDb } = require('../db/database');

// ---- CLI args ----
const args         = process.argv.slice(2);
const manifestPath = args.find(a => !a.startsWith('--'));
const replaceFlag  = args.includes('--replace-spawns');
const dryRun       = !replaceFlag;

if (!manifestPath) {
  console.error('Usage: npm run import:zone -- <manifest.zone.json> [--replace-spawns]');
  process.exit(1);
}

const manifestFile = path.resolve(manifestPath);
if (!fs.existsSync(manifestFile)) {
  console.error(`Manifest not found: ${manifestFile}`);
  process.exit(1);
}

// ---- Load manifest ----
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
} catch (e) {
  console.error(`Failed to parse manifest: ${e.message}`);
  process.exit(1);
}

const { zone: zoneShortName, spawns = [], patrol_paths = [], zone_triggers = [], version } = manifest;

if (!zoneShortName) {
  console.error('Manifest missing required "zone" field.');
  process.exit(1);
}

console.log(`\nWestgaurdia Zone Importer`);
console.log(`  Manifest : ${manifestFile}`);
console.log(`  Zone     : ${zoneShortName}  (schema v${version || '?'})`);
console.log(`  Mode     : ${dryRun ? 'DRY RUN (validation only — add --replace-spawns to write)' : 'REPLACE SPAWNS'}`);
console.log('');

const db = getDb();

// ---- Resolve zone ----
const zone = db.prepare('SELECT * FROM zones WHERE short_name = ?').get(zoneShortName);
if (!zone) {
  console.error(`Zone "${zoneShortName}" not found in database. Seed it first.`);
  process.exit(1);
}
console.log(`  Zone id  : ${zone.id}  "${zone.display_name}"`);

// ---- Validate NPC names ----
let validationFailed = false;
const npcCache = new Map();

for (const spawn of spawns) {
  if (!spawn.npc_name) { console.error(`  ERROR: spawn missing npc_name at (${spawn.x},${spawn.y},${spawn.z})`); validationFailed = true; continue; }
  if (!npcCache.has(spawn.npc_name)) {
    const npc = db.prepare("SELECT id FROM npcs WHERE name = ?").get(spawn.npc_name);
    npcCache.set(spawn.npc_name, npc ? npc.id : null);
  }
  if (npcCache.get(spawn.npc_name) === null) {
    console.error(`  ERROR: NPC not found in DB: "${spawn.npc_name}"`);
    validationFailed = true;
  }
}

// ---- Validate dest zones in triggers ----
const zoneIdCache = new Map();
zoneIdCache.set(zoneShortName, zone.id);

for (const trigger of zone_triggers) {
  if (!trigger.dest_zone) { console.error(`  ERROR: zone_trigger missing dest_zone`); validationFailed = true; continue; }
  if (!zoneIdCache.has(trigger.dest_zone)) {
    const dest = db.prepare('SELECT id FROM zones WHERE short_name = ?').get(trigger.dest_zone);
    zoneIdCache.set(trigger.dest_zone, dest ? dest.id : null);
  }
  if (zoneIdCache.get(trigger.dest_zone) === null) {
    console.error(`  ERROR: Destination zone not found: "${trigger.dest_zone}"`);
    validationFailed = true;
  }
}

// ---- Validate patrol path refs ----
const pathNames = new Set(patrol_paths.map(p => p.name));
for (const spawn of spawns) {
  if (spawn.patrol_path && !pathNames.has(spawn.patrol_path)) {
    console.error(`  ERROR: spawn references unknown patrol_path: "${spawn.patrol_path}"`);
    validationFailed = true;
  }
}

if (validationFailed) {
  console.error('\nValidation failed — fix errors above before importing.\n');
  process.exit(1);
}

console.log(`  Validation passed.`);
console.log(`    ${spawns.length} spawns, ${patrol_paths.length} patrol paths, ${zone_triggers.length} zone triggers`);

if (dryRun) {
  console.log('\nDry run complete. Pass --replace-spawns to write to the database.\n');
  process.exit(0);
}

// ---- Write to DB (transaction) ----
const importAll = db.transaction(() => {

  // Clear existing zone data — order matters for FK constraints:
  // spawns reference patrol_paths, so delete spawns first
  db.prepare('DELETE FROM zone_triggers WHERE zone_id = ?').run(zone.id);
  db.prepare('DELETE FROM npc_spawns WHERE zone_id = ?').run(zone.id);
  db.prepare(`
    DELETE FROM patrol_waypoints WHERE path_id IN
      (SELECT id FROM patrol_paths WHERE zone_id = ?)
  `).run(zone.id);
  db.prepare('DELETE FROM patrol_paths WHERE zone_id = ?').run(zone.id);

  // Insert patrol paths + waypoints
  const pathIdMap = new Map(); // name → DB id
  const insertPath = db.prepare(`
    INSERT INTO patrol_paths (name, zone_id, loop_type) VALUES (?, ?, ?)
  `);
  const insertWP = db.prepare(`
    INSERT INTO patrol_waypoints (path_id, step_order, x, y, z, heading, wait_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const pp of patrol_paths) {
    const result = insertPath.run(pp.name, zone.id, pp.loop_type || 'loop');
    pathIdMap.set(pp.name, result.lastInsertRowid);
    (pp.waypoints || []).forEach((wp, i) => {
      insertWP.run(result.lastInsertRowid, i + 1, wp.x, wp.y, wp.z, wp.heading ?? 0, wp.wait_time ?? 0);
    });
  }

  // Insert spawns
  const insertSpawn = db.prepare(`
    INSERT INTO npc_spawns
      (npc_id, zone_id, x, y, z, heading, respawn_time,
       wander, wander_radius, path_id,
       aggro_range_override, leash_range_override,
       spawn_group, editor_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const spawn of spawns) {
    const npcId   = npcCache.get(spawn.npc_name);
    const pathId  = spawn.patrol_path ? (pathIdMap.get(spawn.patrol_path) ?? null) : null;
    insertSpawn.run(
      npcId, zone.id,
      spawn.x ?? 0, spawn.y ?? 0, spawn.z ?? 0,
      spawn.heading ?? 0,
      spawn.respawn_time ?? 300,
      spawn.wander ? 1 : 0,
      spawn.wander_radius ?? 50,
      pathId,
      spawn.aggro_range_override ?? null,
      spawn.leash_range_override ?? null,
      spawn.spawn_group ?? null,
      spawn.editor_note ?? null
    );
  }

  // Insert zone triggers
  const insertTrigger = db.prepare(`
    INSERT INTO zone_triggers
      (zone_id, trigger_type, x, y, z, half_w, half_d, half_h,
       dest_zone_id, dest_x, dest_y, dest_z, dest_heading,
       req_level, label, facing)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const trigger of zone_triggers) {
    insertTrigger.run(
      zone.id,
      trigger.trigger_type ?? 'zone_line',
      trigger.x ?? 0, trigger.y ?? 0, trigger.z ?? 0,
      trigger.half_w ?? 10, trigger.half_d ?? 10, trigger.half_h ?? 10,
      zoneIdCache.get(trigger.dest_zone),
      trigger.dest_x ?? 0, trigger.dest_y ?? 0, trigger.dest_z ?? 0,
      trigger.dest_heading ?? 0,
      trigger.req_level ?? 1,
      trigger.label ?? null,
      trigger.facing ?? 0
    );
  }
});

try {
  importAll();
} catch (e) {
  console.error(`\nDatabase write failed: ${e.message}\n`);
  process.exit(1);
}

console.log('\nImport complete.');
console.log(`  Inserted ${spawns.length} spawns`);
console.log(`  Inserted ${patrol_paths.length} patrol paths`);
console.log(`  Inserted ${zone_triggers.length} zone triggers`);
console.log('');
