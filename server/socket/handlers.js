const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');
const world = require('../game/world');
const { meleeTick, castSpell, checkLevelUp } = require('../game/combat');
const { calcMaxHp, calcMaxMana, calcMaxEndurance, expForLevel } = require('../game/constants');

const JWT_SECRET = process.env.JWT_SECRET || 'westgaurdia-secret-change-in-prod';

function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
}

function registerHandlers(io) {
  io.use(authenticateSocket);

  // ---- Broadcast world events to zone rooms ----
  world.on('npc_spawn',  ({ zoneId, npc })              => io.to(`zone:${zoneId}`).emit('npc:spawned', npc));
  world.on('npc_move',   ({ zoneId, spawnId, x, y, z, heading }) => io.to(`zone:${zoneId}`).emit('npc:moved', { spawnId, x, y, z, heading }));
  world.on('npc_aggro',  ({ zoneId, spawnId, target })  => io.to(`zone:${zoneId}`).emit('npc:aggro', { spawnId, target }));
  world.on('npc_reset',  ({ zoneId, spawnId, x, y, z }) => io.to(`zone:${zoneId}`).emit('npc:reset', { spawnId, x, y, z }));
  world.on('combat',     ({ zoneId, events, targetSocketId, spawnId, targetHp, targetHpMax }) => {
    // Send combat events to whole zone (others see it) and targeted player specifically
    io.to(`zone:${zoneId}`).emit('combat:events', { events, spawnId });
    // Send HP update to the targeted player
    if (targetSocketId) {
      io.to(targetSocketId).emit('char:damage_taken', {
        spawnId,
        hp_current: targetHp,
        hp_max:     targetHpMax,
        events,
      });
    }
  });

  io.on('connection', (socket) => {
    const db = getDb();
    let activeChar = null;

    // ---- Character selection ----
    socket.on('char:enter', ({ characterId }) => {
      const char = db.prepare('SELECT * FROM characters WHERE id=? AND account_id=? AND is_deleted=0')
        .get(characterId, socket.user.accountId);

      if (!char) return socket.emit('error', { msg: 'Character not found' });

      activeChar = char;
      world.addPlayer(socket.id, char);
      db.prepare('UPDATE characters SET last_played=? WHERE id=?').run(Date.now() / 1000 | 0, char.id);

      // Join zone room
      socket.join(`zone:${char.zone_id}`);
      const snapshot = world.playerEnterZone(socket.id, char.id, char.zone_id);

      socket.emit('zone:entered', {
        character: sanitizeChar(char),
        snapshot,
        zone: db.prepare('SELECT * FROM zones WHERE id=?').get(char.zone_id),
      });

      // Notify others in zone
      socket.to(`zone:${char.zone_id}`).emit('player:entered', {
        socketId: socket.id,
        name: char.name,
        level: char.level,
        x: char.pos_x, y: char.pos_y, z: char.pos_z,
        race: char.race, class: char.class,
      });
    });

    // ---- Movement ----
    socket.on('player:move', ({ x, y, z, heading }) => {
      if (!activeChar) return;
      world.updatePlayerPosition(socket.id, x, y, z, heading);
      db.prepare('UPDATE characters SET pos_x=?,pos_y=?,pos_z=?,heading=? WHERE id=?')
        .run(x, y, z, heading, activeChar.id);
      socket.to(`zone:${activeChar.zone_id}`).emit('player:moved', {
        socketId: socket.id, x, y, z, heading
      });
    });

    // ---- Melee attack ----
    socket.on('attack:melee', ({ spawnId }) => {
      if (!activeChar) return;
      const zone = world.getZone(activeChar.zone_id);
      const npc = zone.getNpc(spawnId);
      if (!npc || npc.is_dead) return socket.emit('error', { msg: 'Invalid target' });

      const player = world.players.get(socket.id);
      const events = meleeTick(
        { name: activeChar.name, level: activeChar.level, str: activeChar.str, agi: activeChar.agi, dmg_min: 1, dmg_max: 5, dmg_type: 'slash', ac: 10 },
        { name: npc.name, level: npc.level, agi: npc.agi, ac: npc.ac }
      );

      events.forEach(evt => {
        if (evt.type === 'melee_hit') {
          const result = zone.damageNpc(spawnId, evt.damage, socket.id);
          if (result?.killed) {
            _handleNpcDeath(socket, db, activeChar, npc, io);
          }
        }
      });

      io.to(`zone:${activeChar.zone_id}`).emit('combat:events', { events, spawnId });
    });

    // ---- Spell cast ----
    socket.on('spell:cast', ({ spellId, targetType, targetId }) => {
      if (!activeChar) return;
      const spell = db.prepare('SELECT * FROM spells WHERE id=?').get(spellId);
      if (!spell) return;

      // Verify character knows spell
      const known = db.prepare('SELECT 1 FROM character_spells WHERE character_id=? AND spell_id=?')
        .get(activeChar.id, spellId);
      if (!known) return socket.emit('error', { msg: 'Spell not in spellbook' });

      // Mana check
      if (activeChar.mana_current < spell.mana_cost) {
        return socket.emit('error', { msg: 'Insufficient mana' });
      }

      // Deduct mana
      activeChar.mana_current = Math.max(0, activeChar.mana_current - spell.mana_cost);
      db.prepare('UPDATE characters SET mana_current=? WHERE id=?').run(activeChar.mana_current, activeChar.id);

      if (targetType === 'npc') {
        const zone = world.getZone(activeChar.zone_id);
        const npc = zone.getNpc(targetId);
        if (!npc || npc.is_dead) return;

        const events = castSpell(spell, activeChar, npc);
        events.forEach(evt => {
          if (evt.type === 'spell_cast' && (spell.spell_type === 'direct_damage' || spell.spell_type === 'dot')) {
            const result = zone.damageNpc(targetId, evt.value);
            if (result?.killed) _handleNpcDeath(socket, db, activeChar, npc, io);
          }
        });
        io.to(`zone:${activeChar.zone_id}`).emit('combat:events', { events, targetType, targetId });
      } else if (targetType === 'player' && spell.target_type === 'self') {
        // Self-buff or self-heal
        if (spell.spell_type === 'heal') {
          activeChar.hp_current = Math.min(activeChar.hp_max, activeChar.hp_current + (spell.effect_value || 0));
          db.prepare('UPDATE characters SET hp_current=? WHERE id=?').run(activeChar.hp_current, activeChar.id);
        }
        socket.emit('combat:events', { events: [{ type: 'spell_cast', caster: activeChar.name, target: activeChar.name, spell: spell.name, value: spell.effect_value, spell_type: spell.spell_type }] });
        socket.emit('char:stats_update', { hp_current: activeChar.hp_current, mana_current: activeChar.mana_current });
      }
    });

    // ---- Chat ----
    socket.on('chat:message', ({ channel, message, tell_target }) => {
      if (!activeChar) return;
      const clean = String(message).slice(0, 500);
      const payload = { sender: activeChar.name, message: clean, channel, timestamp: Date.now() };

      db.prepare('INSERT INTO chat_log (channel, zone_id, sender_name, message) VALUES (?,?,?,?)')
        .run(channel, activeChar.zone_id, activeChar.name, clean);

      switch (channel) {
        case 'say':
          io.to(`zone:${activeChar.zone_id}`).emit('chat:message', payload);
          break;
        case 'shout':
        case 'ooc':
        case 'auction':
          io.emit('chat:message', payload);
          break;
        case 'tell':
          if (tell_target) {
            const targetChar = db.prepare('SELECT id FROM characters WHERE name=? COLLATE NOCASE').get(tell_target);
            if (targetChar) {
              const targetSid = world.charMap.get(targetChar.id);
              if (targetSid) {
                io.to(targetSid).emit('chat:message', { ...payload, tell_target });
                socket.emit('chat:message', { ...payload, tell_target });
              } else {
                socket.emit('error', { msg: `${tell_target} is not online.` });
              }
            }
          }
          break;
        case 'group':
          // TODO: group system
          socket.emit('chat:message', payload);
          break;
      }
    });

    // ---- NPC Interact ----
    socket.on('npc:interact', ({ spawnId }) => {
      if (!activeChar) return;
      const zone = world.getZone(activeChar.zone_id);
      const npc = zone.getNpc(spawnId);
      if (!npc || npc.is_dead) return;

      socket.emit('npc:dialogue', {
        spawnId,
        name: npc.name,
        npc_type: npc.npc_type,
        dialogue: npc.dialogue,
      });

      if (npc.npc_type === 'merchant') {
        const npcDef = getDb().prepare('SELECT merchant_items FROM npcs WHERE id=?').get(npc.npcId);
        const itemNames = JSON.parse(npcDef?.merchant_items || '[]');
        if (itemNames.length > 0) {
          const placeholders = itemNames.map(() => '?').join(',');
          const merchantItems = db.prepare(`SELECT * FROM items WHERE name IN (${placeholders})`).all(...itemNames);
          socket.emit('merchant:inventory', { spawnId, items: merchantItems });
        }
      }

      if (npc.npc_type === 'quest_giver') {
        const availableQuests = db.prepare(`
          SELECT q.* FROM quests q
          WHERE q.giver_npc_id = (SELECT id FROM npcs WHERE id=?)
          AND q.req_level <= ?
          AND NOT EXISTS (
            SELECT 1 FROM character_quests cq
            WHERE cq.character_id=? AND cq.quest_id=q.id AND cq.status='completed' AND q.repeatable=0
          )
        `).all(npc.npcId, activeChar.level, activeChar.id);
        socket.emit('quest:available', { spawnId, quests: availableQuests });
      }
    });

    // ---- Quest accept ----
    socket.on('quest:accept', ({ questId }) => {
      if (!activeChar) return;
      const quest = db.prepare('SELECT * FROM quests WHERE id=?').get(questId);
      if (!quest) return;
      if (activeChar.level < quest.req_level) return socket.emit('error', { msg: 'You are not high enough level for this quest.' });

      const existing = db.prepare('SELECT * FROM character_quests WHERE character_id=? AND quest_id=?').get(activeChar.id, questId);
      if (existing && existing.status === 'active') return socket.emit('error', { msg: 'Quest already active.' });
      if (existing && existing.status === 'completed' && !quest.repeatable) return socket.emit('error', { msg: 'Quest already completed.' });

      db.prepare('INSERT OR REPLACE INTO character_quests (character_id, quest_id, status, started_at) VALUES (?,?,?,?)')
        .run(activeChar.id, questId, 'active', Date.now() / 1000 | 0);

      const objectives = db.prepare('SELECT * FROM quest_objectives WHERE quest_id=? ORDER BY step_order').all(questId);
      socket.emit('quest:started', { quest, objectives });
    });

    // ---- Zone change ----
    socket.on('player:zone', ({ targetZoneShortName, destZoneId, x, y, z, heading }) => {
      if (!activeChar) return;

      // Accept either destZoneId (from trigger) or legacy short name
      const newZone = destZoneId
        ? db.prepare('SELECT * FROM zones WHERE id=?').get(destZoneId)
        : db.prepare('SELECT * FROM zones WHERE short_name=?').get(targetZoneShortName);
      if (!newZone) return socket.emit('error', { msg: 'Zone not found' });

      // Use trigger-supplied coords, otherwise fall back to zone safe point
      const destX = (x != null) ? x : newZone.safe_x;
      const destY = (y != null) ? y : newZone.safe_y;
      const destZ = (z != null) ? z : newZone.safe_z;
      const destH = (heading != null) ? heading : 0;

      socket.leave(`zone:${activeChar.zone_id}`);
      socket.to(`zone:${activeChar.zone_id}`).emit('player:left', { socketId: socket.id });

      activeChar.zone_id = newZone.id;
      activeChar.pos_x = destX;
      activeChar.pos_y = destY;
      activeChar.pos_z = destZ;
      activeChar.heading = destH;

      db.prepare('UPDATE characters SET zone_id=?,pos_x=?,pos_y=?,pos_z=?,heading=? WHERE id=?')
        .run(newZone.id, destX, destY, destZ, destH, activeChar.id);

      socket.join(`zone:${newZone.id}`);
      const snapshot = world.playerEnterZone(socket.id, activeChar.id, newZone.id);

      socket.emit('zone:entered', { character: sanitizeChar(activeChar), snapshot, zone: newZone });
      socket.to(`zone:${newZone.id}`).emit('player:entered', {
        socketId: socket.id, name: activeChar.name, level: activeChar.level,
        x: destX, y: destY, z: destZ,
        race: activeChar.race, class: activeChar.class,
      });
    });

    // ---- Who list ----
    socket.on('who', () => {
      socket.emit('who:list', world.getOnlinePlayers());
    });

    // ---- Disconnect ----
    socket.on('disconnect', () => {
      if (activeChar) {
        db.prepare('UPDATE characters SET hp_current=?,mana_current=?,pos_x=?,pos_y=?,pos_z=? WHERE id=?')
          .run(activeChar.hp_current, activeChar.mana_current, activeChar.pos_x || 0, activeChar.pos_y || 0, activeChar.pos_z || 0, activeChar.id);
        socket.to(`zone:${activeChar.zone_id}`).emit('player:left', { socketId: socket.id });
      }
      world.removePlayer(socket.id);
    });
  });

  // Broadcast world events from zone instances
  world.zones.forEach(zone => _attachZoneEvents(zone, io));
}

function _attachZoneEvents(zone, io) {
  zone.on('npc_spawn', ({ zoneId, npc }) => {
    io.to(`zone:${zoneId}`).emit('npc:spawned', npc);
  });
  zone.on('npc_move', ({ zoneId, spawnId, x, y, z }) => {
    io.to(`zone:${zoneId}`).emit('npc:moved', { spawnId, x, y, z });
  });
}

function _handleNpcDeath(socket, db, char, npc, io) {
  // Award experience
  char.experience = (char.experience || 0) + npc.exp_reward;
  db.prepare('UPDATE characters SET experience=? WHERE id=?').run(char.experience, char.id);

  const newLevel = checkLevelUp(char);
  if (newLevel) {
    char.level = newLevel;
    const newHp = calcMaxHp(newLevel, char.sta, char.class);
    const manaKey = char.class === 'WIZ' || char.class === 'MAG' || char.class === 'NEC' || char.class === 'ENC' ? char.int : char.wis;
    const newMana = calcMaxMana(newLevel, manaKey, char.class);
    char.hp_max = newHp;
    char.hp_current = newHp;
    char.mana_max = newMana;
    char.mana_current = newMana;
    db.prepare('UPDATE characters SET level=?,hp_max=?,hp_current=?,mana_max=?,mana_current=? WHERE id=?')
      .run(newLevel, newHp, newHp, newMana, newMana, char.id);
    socket.emit('char:levelup', { level: newLevel, hp_max: newHp, mana_max: newMana });
    io.to(`zone:${char.zone_id}`).emit('chat:message', {
      channel: 'say', sender: 'System', message: `${char.name} has reached level ${newLevel}!`, timestamp: Date.now()
    });
  }

  // Quest kill progress
  const activeQuests = db.prepare(`
    SELECT cq.quest_id, qo.id AS obj_id, qo.target_name, qo.quantity
    FROM character_quests cq
    JOIN quest_objectives qo ON qo.quest_id = cq.quest_id
    WHERE cq.character_id=? AND cq.status='active' AND qo.obj_type='kill' AND qo.target_name=?
  `).all(char.id, npc.name);

  activeQuests.forEach(aq => {
    db.prepare(`
      INSERT INTO character_quest_progress (character_id, quest_id, objective_id, current_count)
      VALUES (?,?,?,1)
      ON CONFLICT(character_id, quest_id, objective_id) DO UPDATE SET current_count=current_count+1
    `).run(char.id, aq.quest_id, aq.obj_id);

    const prog = db.prepare('SELECT current_count FROM character_quest_progress WHERE character_id=? AND quest_id=? AND objective_id=?')
      .get(char.id, aq.quest_id, aq.obj_id);

    socket.emit('quest:progress', { questId: aq.quest_id, objectiveId: aq.obj_id, current: prog.current_count, required: aq.quantity });

    if (prog.current_count >= aq.quantity) {
      // Check if ALL objectives complete
      const allObjs = db.prepare('SELECT id FROM quest_objectives WHERE quest_id=?').all(aq.quest_id);
      const allDone = allObjs.every(o => {
        const p = db.prepare('SELECT current_count FROM character_quest_progress WHERE character_id=? AND quest_id=? AND objective_id=?')
          .get(char.id, aq.quest_id, o.id);
        const req = db.prepare('SELECT quantity FROM quest_objectives WHERE id=?').get(o.id);
        return p && p.current_count >= req.quantity;
      });

      if (allDone) {
        const quest = db.prepare('SELECT * FROM quests WHERE id=?').get(aq.quest_id);
        db.prepare("UPDATE character_quests SET status='completed',completed_at=? WHERE character_id=? AND quest_id=?")
          .run(Date.now() / 1000 | 0, char.id, aq.quest_id);

        char.experience += quest.exp_reward;
        char.gold = (char.gold || 0) + quest.gold_reward;
        char.silver = (char.silver || 0) + quest.silver_reward;
        db.prepare('UPDATE characters SET experience=?,gold=?,silver=? WHERE id=?').run(char.experience, char.gold, char.silver, char.id);

        socket.emit('quest:completed', { quest, exp: quest.exp_reward, gold: quest.gold_reward, silver: quest.silver_reward });
      }
    }
  });

  socket.emit('char:stats_update', {
    experience: char.experience,
    level: char.level,
    exp_to_next: expForLevel(char.level + 1),
  });
}

function sanitizeChar(char) {
  const { ...safe } = char;
  return safe;
}

module.exports = { registerHandlers };
