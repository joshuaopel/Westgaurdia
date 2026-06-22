// World manager: tracks online players, zone instances, NPC state
const { getDb } = require('../db/database');
const { meleeTick } = require('./combat');
const EventEmitter = require('events');

class World extends EventEmitter {
  constructor() {
    super();
    this.zones = new Map();       // zoneId -> ZoneInstance
    this.players = new Map();     // socketId -> PlayerState
    this.charMap = new Map();     // characterId -> socketId
  }

  // ---- Zone management ----

  getZone(zoneId) {
    if (!this.zones.has(zoneId)) {
      this.zones.set(zoneId, new ZoneInstance(zoneId));
    }
    return this.zones.get(zoneId);
  }

  playerEnterZone(socketId, characterId, zoneId) {
    const player = this.players.get(socketId);
    if (!player) return;

    // Leave old zone
    if (player.zoneId) {
      const oldZone = this.zones.get(player.zoneId);
      if (oldZone) oldZone.removePlayer(socketId);
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
      name: characterData.name,
      level: characterData.level,
      zoneId: characterData.zone_id,
      x: characterData.pos_x,
      y: characterData.pos_y,
      z: characterData.pos_z,
      heading: characterData.heading,
      hp_current: characterData.hp_current,
      hp_max: characterData.hp_max,
      mana_current: characterData.mana_current,
      mana_max: characterData.mana_max,
      end_current: characterData.end_current,
      end_max: characterData.end_max,
      str: characterData.str,
      agi: characterData.agi,
      race: characterData.race,
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
      name: p.name,
      level: p.level,
      zone: p.zoneId,
      class: p.class,
      race: p.race,
    }));
  }
}

class ZoneInstance {
  constructor(zoneId) {
    this.zoneId = zoneId;
    this.players = new Map();   // socketId -> player ref
    this.npcs = new Map();      // spawnId -> NpcState
    this.combatPairs = new Map(); // entityId -> targetId

    this._loadNpcs();
    this._startTick();
  }

  _loadNpcs() {
    const db = getDb();
    const spawns = db.prepare(`
      SELECT ns.id AS spawn_id, ns.x, ns.y, ns.z, ns.heading, ns.respawn_time, ns.wander, ns.wander_radius,
             n.id AS npc_id, n.name, n.level, n.hp_base, n.mana_base, n.str, n.agi, n.ac,
             n.dmg_min, n.dmg_max, n.dmg_type, n.attack_delay, n.is_aggro, n.exp_reward,
             n.loot_table, n.npc_type, n.dialogue
      FROM npc_spawns ns
      JOIN npcs n ON n.id = ns.npc_id
      WHERE ns.zone_id = ?
    `).all(this.zoneId);

    spawns.forEach(s => {
      this.npcs.set(s.spawn_id, {
        spawnId: s.spawn_id,
        npcId: s.npc_id,
        name: s.name,
        level: s.level,
        hp_current: s.hp_base,
        hp_max: s.hp_base,
        mana_current: s.mana_base,
        mana_max: s.mana_base,
        str: s.str, agi: s.agi, ac: s.ac,
        dmg_min: s.dmg_min, dmg_max: s.dmg_max, dmg_type: s.dmg_type,
        attack_delay: s.attack_delay,
        is_aggro: s.is_aggro,
        exp_reward: s.exp_reward,
        loot_table: JSON.parse(s.loot_table || '[]'),
        npc_type: s.npc_type,
        dialogue: JSON.parse(s.dialogue || '{}'),
        x: s.x, y: s.y, z: s.z, heading: s.heading,
        spawn_x: s.x, spawn_y: s.y, spawn_z: s.z,
        respawn_time: s.respawn_time,
        wander: s.wander,
        wander_radius: s.wander_radius,
        is_dead: false,
        respawn_at: null,
        target: null,
      });
    });
  }

  _startTick() {
    this._tickInterval = setInterval(() => this._tick(), 1000);
  }

  _tick() {
    const now = Date.now();

    // Respawn dead NPCs
    this.npcs.forEach(npc => {
      if (npc.is_dead && npc.respawn_at && now >= npc.respawn_at) {
        npc.is_dead = false;
        npc.hp_current = npc.hp_max;
        npc.x = npc.spawn_x;
        npc.y = npc.spawn_y;
        npc.z = npc.spawn_z;
        npc.target = null;
        npc.respawn_at = null;
        this.emit('npc_spawn', { zoneId: this.zoneId, npc: this._npcSnapshot(npc) });
      }
    });

    // NPC wander
    this.npcs.forEach(npc => {
      if (!npc.is_dead && npc.wander && !npc.target) {
        if (Math.random() < 0.05) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * npc.wander_radius;
          npc.x = npc.spawn_x + Math.cos(angle) * dist;
          npc.y = npc.spawn_y + Math.sin(angle) * dist;
          this.emit('npc_move', { zoneId: this.zoneId, spawnId: npc.spawnId, x: npc.x, y: npc.y, z: npc.z });
        }
      }
    });
  }

  _npcSnapshot(npc) {
    return {
      spawnId: npc.spawnId,
      npcId: npc.npcId,
      name: npc.name,
      level: npc.level,
      hp_pct: npc.hp_max > 0 ? Math.round((npc.hp_current / npc.hp_max) * 100) : 0,
      is_dead: npc.is_dead,
      npc_type: npc.npc_type,
      x: npc.x, y: npc.y, z: npc.z, heading: npc.heading,
      is_aggro: npc.is_aggro,
    };
  }

  addPlayer(socketId, player) {
    this.players.set(socketId, player);
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  updatePlayerPos(socketId, x, y, z, heading) {
    const p = this.players.get(socketId);
    if (p) { p.x = x; p.y = y; p.z = z; p.heading = heading; }
  }

  getSnapshot() {
    return {
      players: Array.from(this.players.values()).map(p => ({
        socketId: p.socketId,
        name: p.name,
        level: p.level,
        x: p.x, y: p.y, z: p.z, heading: p.heading,
        hp_pct: p.hp_max > 0 ? Math.round((p.hp_current / p.hp_max) * 100) : 0,
        race: p.race,
        class: p.class,
      })),
      npcs: Array.from(this.npcs.values())
        .filter(n => !n.is_dead)
        .map(n => this._npcSnapshot(n)),
    };
  }

  getNpc(spawnId) {
    return this.npcs.get(spawnId);
  }

  damageNpc(spawnId, amount) {
    const npc = this.npcs.get(spawnId);
    if (!npc || npc.is_dead) return null;
    npc.hp_current = Math.max(0, npc.hp_current - amount);
    if (npc.hp_current <= 0) {
      npc.is_dead = true;
      npc.respawn_at = Date.now() + npc.respawn_time * 1000;
      return { killed: true, npc };
    }
    return { killed: false, npc };
  }

  destroy() {
    if (this._tickInterval) clearInterval(this._tickInterval);
  }
}

// Singleton
const world = new World();
module.exports = world;
