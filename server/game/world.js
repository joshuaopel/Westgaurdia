// World manager: tracks online players, zone instances, NPC AI
const { getDb } = require('../db/database');
const { meleeTick } = require('./combat');
const EventEmitter = require('events');

// How often the zone AI ticks (ms)
const TICK_MS = 500;
// Distance epsilon: how close to a waypoint counts as "arrived"
const WAYPOINT_ARRIVE_DIST = 3;

class World extends EventEmitter {
  constructor() {
    super();
    this.zones   = new Map();  // zoneId -> ZoneInstance
    this.players = new Map();  // socketId -> PlayerState
    this.charMap = new Map();  // characterId -> socketId
  }

  getZone(zoneId) {
    if (!this.zones.has(zoneId)) {
      const inst = new ZoneInstance(zoneId);
      this._attachZoneEvents(inst);
      this.zones.set(zoneId, inst);
    }
    return this.zones.get(zoneId);
  }

  playerEnterZone(socketId, characterId, zoneId) {
    const player = this.players.get(socketId);
    if (!player) return;
    if (player.zoneId) {
      const old = this.zones.get(player.zoneId);
      if (old) old.removePlayer(socketId);
    }
    player.zoneId = zoneId;
    const zone = this.getZone(zoneId);
    zone.addPlayer(socketId, player);
    return zone.getSnapshot();
  }

  playerLeaveZone(socketId) {
    const player = this.players.get(socketId);
    if (player?.zoneId) {
      const zone = this.zones.get(player.zoneId);
      if (zone) zone.removePlayer(socketId);
    }
  }

  addPlayer(socketId, characterData) {
    this.players.set(socketId, {
      socketId,
      characterId: characterData.id,
      name:        characterData.name,
      level:       characterData.level,
      zoneId:      characterData.zone_id,
      x: characterData.pos_x || 0,
      y: characterData.pos_y || 0,
      z: characterData.pos_z || 0,
      heading: characterData.heading || 0,
      hp_current: characterData.hp_current,
      hp_max:     characterData.hp_max,
      mana_current: characterData.mana_current,
      mana_max:     characterData.mana_max,
      end_current: characterData.end_current,
      end_max:     characterData.end_max,
      str: characterData.str,
      agi: characterData.agi,
      race:  characterData.race,
      class: characterData.class,
    });
    this.charMap.set(characterData.id, socketId);
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      this.playerLeaveZone(socketId);
      this.charMap.delete(player.characterId);
    }
    this.players.delete(socketId);
  }

  getPlayerByCharId(characterId) {
    const sid = this.charMap.get(characterId);
    return sid ? this.players.get(sid) : null;
  }

  updatePlayerPosition(socketId, x, y, z, heading) {
    const player = this.players.get(socketId);
    if (!player) return;
    player.x = x; player.y = y; player.z = z; player.heading = heading;
    const zone = this.zones.get(player.zoneId);
    if (zone) zone.updatePlayerPos(socketId, x, y, z, heading);
  }

  getOnlinePlayers() {
    return Array.from(this.players.values()).map(p => ({
      name: p.name, level: p.level, zone: p.zoneId, class: p.class, race: p.race,
    }));
  }

  _attachZoneEvents(zone) {
    zone.on('npc_spawn', data => this.emit('npc_spawn', data));
    zone.on('npc_move',  data => this.emit('npc_move',  data));
    zone.on('combat',    data => this.emit('combat',    data));
    zone.on('npc_aggro', data => this.emit('npc_aggro', data));
    zone.on('npc_reset', data => this.emit('npc_reset', data));
  }
}

// ============================================================
class ZoneInstance extends EventEmitter {
  constructor(zoneId) {
    super();
    this.zoneId  = zoneId;
    this.players = new Map();   // socketId -> player ref
    this.npcs    = new Map();   // spawnId  -> NpcState
    this._loadNpcs();
    this._startTick();
  }

  // ---- Loading ----

  _loadNpcs() {
    const db = getDb();

    // Load waypoints for all paths in this zone keyed by path_id
    const allWaypoints = db.prepare(`
      SELECT pw.*
      FROM patrol_waypoints pw
      JOIN patrol_paths pp ON pp.id = pw.path_id
      WHERE pp.zone_id = ?
      ORDER BY pw.path_id, pw.step_order
    `).all(this.zoneId);

    const pathWaypoints = {};
    allWaypoints.forEach(w => {
      if (!pathWaypoints[w.path_id]) pathWaypoints[w.path_id] = [];
      pathWaypoints[w.path_id].push(w);
    });

    const pathMeta = {};
    db.prepare('SELECT * FROM patrol_paths WHERE zone_id=?').all(this.zoneId)
      .forEach(p => { pathMeta[p.id] = p; });

    const spawns = db.prepare(`
      SELECT ns.id AS spawn_id, ns.x, ns.y, ns.z, ns.heading,
             ns.respawn_time, ns.wander, ns.wander_radius,
             ns.path_id, ns.aggro_range_override, ns.leash_range_override,
             ns.spawn_group, ns.editor_note,
             n.id   AS npc_id,  n.name,  n.level,
             n.hp_base, n.mana_base, n.str, n.agi, n.ac,
             n.dmg_min, n.dmg_max, n.dmg_type, n.attack_delay,
             n.is_aggro, n.see_invis, n.see_hide,
             n.exp_reward, n.loot_table, n.npc_type, n.dialogue,
             n.aggro_range, n.leash_range, n.walk_speed, n.run_speed
      FROM npc_spawns ns
      JOIN npcs n ON n.id = ns.npc_id
      WHERE ns.zone_id = ?
    `).all(this.zoneId);

    spawns.forEach(s => {
      const waypoints = s.path_id ? (pathWaypoints[s.path_id] || []) : [];
      const pathInfo  = s.path_id ? (pathMeta[s.path_id] || null) : null;

      this.npcs.set(s.spawn_id, {
        // identity
        spawnId: s.spawn_id,
        npcId:   s.npc_id,
        name:    s.name,
        level:   s.level,
        npc_type: s.npc_type,
        dialogue: JSON.parse(s.dialogue || '{}'),

        // stats
        hp_current: s.hp_base, hp_max: s.hp_base,
        mana_current: s.mana_base, mana_max: s.mana_base,
        str: s.str, agi: s.agi, ac: s.ac,
        dmg_min: s.dmg_min, dmg_max: s.dmg_max, dmg_type: s.dmg_type,
        attack_delay: s.attack_delay,  // tenths of seconds
        resists: {},

        // flags
        is_aggro:  s.is_aggro,
        see_invis: s.see_invis,
        see_hide:  s.see_hide,

        // loot
        exp_reward: s.exp_reward,
        loot_table: JSON.parse(s.loot_table || '[]'),

        // position
        x: s.x, y: s.y, z: s.z, heading: s.heading,
        spawn_x: s.x, spawn_y: s.y, spawn_z: s.z,

        // movement
        move_speed:     s.run_speed || 3.0,
        walk_speed:     s.walk_speed || 1.0,
        wander:         s.wander,
        wander_radius:  s.wander_radius,

        // patrol
        waypoints,
        path_loop_type: pathInfo?.loop_type || 'loop',
        wp_index:       0,        // current target waypoint
        wp_direction:   1,        // +1 forward / -1 backward (ping_pong)
        wp_wait_until:  0,        // timestamp to resume moving after pause
        patrol_active:  waypoints.length > 0,

        // aggro
        aggro_range:  s.aggro_range_override ?? s.aggro_range ?? 50,
        leash_range:  s.leash_range_override ?? s.leash_range ?? 200,
        aggroTable:   new Map(),  // socketId -> threat number
        in_combat:    false,

        // timing
        respawn_time: s.respawn_time,
        is_dead:      false,
        respawn_at:   null,
        next_swing:   0,          // timestamp for next melee
      });
    });
  }

  // ---- Tick ----

  _startTick() {
    this._tickInterval = setInterval(() => this._tick(), TICK_MS);
  }

  _tick() {
    const now = Date.now();

    this.npcs.forEach(npc => {
      if (npc.is_dead) {
        this._tickRespawn(npc, now);
        return;
      }

      if (npc.in_combat) {
        this._tickCombat(npc, now);
      } else {
        this._tickAggro(npc, now);
        this._tickMovement(npc, now);
      }
    });
  }

  // ---- Respawn ----

  _tickRespawn(npc, now) {
    if (npc.respawn_at && now >= npc.respawn_at) {
      npc.is_dead       = false;
      npc.hp_current    = npc.hp_max;
      npc.mana_current  = npc.mana_max;
      npc.x = npc.spawn_x; npc.y = npc.spawn_y; npc.z = npc.spawn_z;
      npc.aggroTable.clear();
      npc.in_combat   = false;
      npc.wp_index    = 0;
      npc.wp_direction = 1;
      npc.respawn_at  = null;
      this.emit('npc_spawn', { zoneId: this.zoneId, npc: this._npcSnapshot(npc) });
    }
  }

  // ---- Aggro scan ----

  _tickAggro(npc, now) {
    if (!npc.is_aggro) return;

    this.players.forEach((player, socketId) => {
      if (player.hp_current <= 0) return;
      const dist = _dist2d(npc, player);
      if (dist <= npc.aggro_range) {
        if (!npc.aggroTable.has(socketId)) {
          npc.aggroTable.set(socketId, 1);
          this.emit('npc_aggro', { zoneId: this.zoneId, spawnId: npc.spawnId, target: player.name });
        }
      }
    });

    if (npc.aggroTable.size > 0) {
      npc.in_combat = true;
    }
  }

  // ---- Combat tick ----

  _tickCombat(npc, now) {
    // Clean dead / logged-out targets from aggro table
    npc.aggroTable.forEach((threat, sid) => {
      const p = this.players.get(sid);
      if (!p || p.hp_current <= 0) npc.aggroTable.delete(sid);
    });

    if (npc.aggroTable.size === 0) {
      this._resetNpc(npc);
      return;
    }

    // Pick highest threat target
    let topSid = null, topThreat = -1;
    npc.aggroTable.forEach((threat, sid) => {
      if (threat > topThreat) { topThreat = threat; topSid = sid; }
    });

    const target = this.players.get(topSid);
    if (!target) { this._resetNpc(npc); return; }

    // Leash check
    const distFromSpawn = _dist2d(npc, { x: npc.spawn_x, y: npc.spawn_y });
    if (distFromSpawn > npc.leash_range) {
      this._resetNpc(npc);
      return;
    }

    // Move toward target
    const distToTarget = _dist2d(npc, target);
    const meleeRange = 3;
    if (distToTarget > meleeRange) {
      _stepToward(npc, target, npc.move_speed * (TICK_MS / 1000));
      this.emit('npc_move', { zoneId: this.zoneId, spawnId: npc.spawnId, x: npc.x, y: npc.y, z: npc.z, heading: npc.heading });
    }

    // Melee swing
    const swingIntervalMs = npc.attack_delay * 100; // attack_delay in tenths of seconds
    if (now >= npc.next_swing && distToTarget <= meleeRange + 2) {
      npc.next_swing = now + swingIntervalMs;

      const attackerProxy = { name: npc.name, level: npc.level, str: npc.str, agi: npc.agi, dmg_min: npc.dmg_min, dmg_max: npc.dmg_max, dmg_type: npc.dmg_type };
      const defenderProxy = { name: target.name, level: target.level, agi: target.agi || 75, ac: 10 };
      const events = meleeTick(attackerProxy, defenderProxy);

      events.forEach(evt => {
        if (evt.type === 'melee_hit') {
          target.hp_current = Math.max(0, target.hp_current - evt.damage);
          // Build threat: damage dealt increases threat
          npc.aggroTable.set(topSid, (npc.aggroTable.get(topSid) || 0) + evt.damage);
        }
      });

      this.emit('combat', { zoneId: this.zoneId, events, targetSocketId: topSid, spawnId: npc.spawnId, targetHp: target.hp_current, targetHpMax: target.hp_max });
    }
  }

  // ---- NPC reset (leash or no targets) ----

  _resetNpc(npc) {
    npc.aggroTable.clear();
    npc.in_combat   = false;
    npc.wp_index    = 0;
    npc.wp_direction = 1;
    // Heal fully on reset (classic EQ behaviour)
    npc.hp_current  = npc.hp_max;
    npc.mana_current = npc.mana_max;
    npc.x = npc.spawn_x; npc.y = npc.spawn_y; npc.z = npc.spawn_z;
    this.emit('npc_reset', { zoneId: this.zoneId, spawnId: npc.spawnId, x: npc.x, y: npc.y, z: npc.z });
    this.emit('npc_move',  { zoneId: this.zoneId, spawnId: npc.spawnId, x: npc.x, y: npc.y, z: npc.z, heading: npc.heading });
  }

  // ---- Movement (patrol / wander) ----

  _tickMovement(npc, now) {
    if (npc.patrol_active && npc.waypoints.length > 0) {
      this._tickPatrol(npc, now);
      return;
    }

    if (npc.wander && now > (npc._nextWanderAt || 0)) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * npc.wander_radius;
      npc.x = npc.spawn_x + Math.cos(angle) * dist;
      npc.y = npc.spawn_y + Math.sin(angle) * dist;
      npc._nextWanderAt = now + 3000 + Math.random() * 5000;
      this.emit('npc_move', { zoneId: this.zoneId, spawnId: npc.spawnId, x: npc.x, y: npc.y, z: npc.z, heading: npc.heading });
    }
  }

  _tickPatrol(npc, now) {
    // Waiting at waypoint
    if (now < npc.wp_wait_until) return;

    const wp = npc.waypoints[npc.wp_index];
    if (!wp) return;

    const dist = _dist2d(npc, wp);

    if (dist <= WAYPOINT_ARRIVE_DIST) {
      // Arrived at waypoint
      if (wp.wait_time > 0) npc.wp_wait_until = now + wp.wait_time * 1000;
      this._advanceWaypoint(npc);
    } else {
      _stepToward(npc, wp, npc.walk_speed * (TICK_MS / 1000));
      this.emit('npc_move', { zoneId: this.zoneId, spawnId: npc.spawnId, x: npc.x, y: npc.y, z: npc.z, heading: npc.heading });
    }
  }

  _advanceWaypoint(npc) {
    const len = npc.waypoints.length;
    if (len === 0) return;

    switch (npc.path_loop_type) {
      case 'loop':
        npc.wp_index = (npc.wp_index + 1) % len;
        break;
      case 'ping_pong':
        npc.wp_index += npc.wp_direction;
        if (npc.wp_index >= len)      { npc.wp_index = len - 2; npc.wp_direction = -1; }
        else if (npc.wp_index < 0)    { npc.wp_index = 1;       npc.wp_direction =  1; }
        break;
      case 'once':
        npc.wp_index = Math.min(npc.wp_index + 1, len - 1);
        break;
    }
  }

  // ---- Aggro / threat API (called by socket handlers) ----

  addThreat(spawnId, socketId, amount) {
    const npc = this.npcs.get(spawnId);
    if (!npc || npc.is_dead) return;
    npc.aggroTable.set(socketId, (npc.aggroTable.get(socketId) || 0) + amount);
    npc.in_combat = true;
  }

  // ---- Entity API ----

  addPlayer(socketId, player)                  { this.players.set(socketId, player); }
  removePlayer(socketId)                        { this.players.delete(socketId); }
  updatePlayerPos(socketId, x, y, z, heading)  {
    const p = this.players.get(socketId);
    if (p) { p.x = x; p.y = y; p.z = z; p.heading = heading; }
  }

  getNpc(spawnId) { return this.npcs.get(spawnId); }

  damageNpc(spawnId, amount, attackerSocketId) {
    const npc = this.npcs.get(spawnId);
    if (!npc || npc.is_dead) return null;
    npc.hp_current = Math.max(0, npc.hp_current - amount);
    // Any damage puts attacker on aggro table
    if (attackerSocketId) {
      npc.aggroTable.set(attackerSocketId, (npc.aggroTable.get(attackerSocketId) || 0) + amount);
      npc.in_combat = true;
    }
    if (npc.hp_current <= 0) {
      npc.is_dead     = true;
      npc.in_combat   = false;
      npc.respawn_at  = Date.now() + npc.respawn_time * 1000;
      npc.aggroTable.clear();
      return { killed: true, npc };
    }
    return { killed: false, npc };
  }

  getSnapshot() {
    return {
      players: Array.from(this.players.values()).map(p => ({
        socketId: p.socketId, name: p.name, level: p.level,
        x: p.x, y: p.y, z: p.z, heading: p.heading,
        hp_pct: p.hp_max > 0 ? Math.round((p.hp_current / p.hp_max) * 100) : 0,
        race: p.race, class: p.class,
      })),
      npcs: Array.from(this.npcs.values())
        .filter(n => !n.is_dead)
        .map(n => this._npcSnapshot(n)),
    };
  }

  // Full spawn data for GM tool
  getSpawnData() {
    const db = getDb();
    return db.prepare(`
      SELECT ns.*, n.name AS npc_name, n.level AS npc_level, n.npc_type,
             n.is_aggro, n.aggro_range, n.leash_range,
             pp.name AS path_name, pp.loop_type
      FROM npc_spawns ns
      JOIN npcs n ON n.id = ns.npc_id
      LEFT JOIN patrol_paths pp ON pp.id = ns.path_id
      WHERE ns.zone_id = ?
    `).all(this.zoneId);
  }

  _npcSnapshot(npc) {
    return {
      spawnId:   npc.spawnId,
      npcId:     npc.npcId,
      name:      npc.name,
      level:     npc.level,
      npc_type:  npc.npc_type,
      hp_pct:    npc.hp_max > 0 ? Math.round((npc.hp_current / npc.hp_max) * 100) : 0,
      is_dead:   npc.is_dead,
      in_combat: npc.in_combat,
      x: npc.x, y: npc.y, z: npc.z, heading: npc.heading,
      is_aggro:  npc.is_aggro,
      aggro_range: npc.aggro_range,
      patrol_active: npc.patrol_active,
    };
  }

  destroy() {
    if (this._tickInterval) clearInterval(this._tickInterval);
  }
}

// ---- Math helpers ----

function _dist2d(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function _stepToward(mover, target, maxDist) {
  const dx = target.x - mover.x, dy = target.y - mover.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return;
  const frac = Math.min(1, maxDist / dist);
  mover.x += dx * frac;
  mover.y += dy * frac;
  mover.heading = Math.atan2(dx, dy);
}

// Singleton
const world = new World();
module.exports = world;
