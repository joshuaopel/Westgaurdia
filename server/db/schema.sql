-- ============================================================
-- Westgaurdia MMO RPG Database Schema
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ------------------------------------------------------------
-- Accounts (login)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password    TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'player', -- player | gm | admin
  banned      INTEGER NOT NULL DEFAULT 0,
  last_login  INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ------------------------------------------------------------
-- Zones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  short_name    TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  description   TEXT,
  min_level     INTEGER NOT NULL DEFAULT 1,
  max_level     INTEGER NOT NULL DEFAULT 60,
  safe_x        REAL    NOT NULL DEFAULT 0,
  safe_y        REAL    NOT NULL DEFAULT 0,
  safe_z        REAL    NOT NULL DEFAULT 0,
  zone_type     TEXT    NOT NULL DEFAULT 'outdoor', -- outdoor | indoor | dungeon | city
  pvp           INTEGER NOT NULL DEFAULT 0,
  fog_color     TEXT    NOT NULL DEFAULT '#8ab4d0',
  sky           TEXT    NOT NULL DEFAULT 'day'
);

-- ------------------------------------------------------------
-- Characters
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS characters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  race          TEXT    NOT NULL,
  class         TEXT    NOT NULL,
  gender        TEXT    NOT NULL DEFAULT 'male',
  level         INTEGER NOT NULL DEFAULT 1,
  experience    INTEGER NOT NULL DEFAULT 0,

  -- Core stats (base, before equipment)
  str           INTEGER NOT NULL DEFAULT 75,
  sta           INTEGER NOT NULL DEFAULT 75,
  agi           INTEGER NOT NULL DEFAULT 75,
  dex           INTEGER NOT NULL DEFAULT 75,
  int           INTEGER NOT NULL DEFAULT 75,
  wis           INTEGER NOT NULL DEFAULT 75,
  cha           INTEGER NOT NULL DEFAULT 75,

  -- Resources
  hp_current    INTEGER NOT NULL DEFAULT 100,
  hp_max        INTEGER NOT NULL DEFAULT 100,
  mana_current  INTEGER NOT NULL DEFAULT 100,
  mana_max      INTEGER NOT NULL DEFAULT 100,
  end_current   INTEGER NOT NULL DEFAULT 100,
  end_max       INTEGER NOT NULL DEFAULT 100,

  -- Position
  zone_id       INTEGER NOT NULL DEFAULT 1 REFERENCES zones(id),
  pos_x         REAL    NOT NULL DEFAULT 0,
  pos_y         REAL    NOT NULL DEFAULT 0,
  pos_z         REAL    NOT NULL DEFAULT 0,
  heading       REAL    NOT NULL DEFAULT 0,

  -- Currency (copper base)
  platinum      INTEGER NOT NULL DEFAULT 0,
  gold          INTEGER NOT NULL DEFAULT 0,
  silver        INTEGER NOT NULL DEFAULT 0,
  copper        INTEGER NOT NULL DEFAULT 0,

  -- Status
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  last_played   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ------------------------------------------------------------
-- Items (base definitions)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  icon        TEXT    NOT NULL DEFAULT 'item_generic',
  item_type   TEXT    NOT NULL DEFAULT 'misc', -- weapon | armor | spell | food | drink | misc | quest
  slot        TEXT,                             -- head | neck | shoulder | chest | back | arms | wrist | hands | finger | legs | feet | primary | secondary | ranged | ammo
  weight      REAL    NOT NULL DEFAULT 1.0,
  size        TEXT    NOT NULL DEFAULT 'small', -- tiny | small | medium | large | giant
  no_drop     INTEGER NOT NULL DEFAULT 0,
  no_trade    INTEGER NOT NULL DEFAULT 0,
  stackable   INTEGER NOT NULL DEFAULT 0,
  stack_size  INTEGER NOT NULL DEFAULT 1,
  req_level   INTEGER NOT NULL DEFAULT 0,
  req_race    TEXT,   -- NULL = any, else pipe-separated race list
  req_class   TEXT,   -- NULL = any

  -- Stat modifiers
  mod_str     INTEGER NOT NULL DEFAULT 0,
  mod_sta     INTEGER NOT NULL DEFAULT 0,
  mod_agi     INTEGER NOT NULL DEFAULT 0,
  mod_dex     INTEGER NOT NULL DEFAULT 0,
  mod_int     INTEGER NOT NULL DEFAULT 0,
  mod_wis     INTEGER NOT NULL DEFAULT 0,
  mod_cha     INTEGER NOT NULL DEFAULT 0,
  mod_hp      INTEGER NOT NULL DEFAULT 0,
  mod_mana    INTEGER NOT NULL DEFAULT 0,

  -- Weapon stats
  dmg_min     INTEGER NOT NULL DEFAULT 0,
  dmg_max     INTEGER NOT NULL DEFAULT 0,
  dmg_type    TEXT,   -- slash | blunt | pierce | magic | fire | cold | poison | disease
  attack_delay INTEGER NOT NULL DEFAULT 20, -- in tenths of seconds
  range       INTEGER NOT NULL DEFAULT 0,

  -- Armor stats
  ac          INTEGER NOT NULL DEFAULT 0,

  value_copper INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- Character Inventory
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  slot          TEXT    NOT NULL DEFAULT 'bag', -- equipped slot name or 'bag'
  bag_slot      INTEGER,                        -- 0-indexed bag slot when slot='bag'
  quantity      INTEGER NOT NULL DEFAULT 1,
  equipped      INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- Spells
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spells (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  description     TEXT,
  icon            TEXT    NOT NULL DEFAULT 'spell_generic',
  spell_type      TEXT    NOT NULL DEFAULT 'direct_damage', -- direct_damage | dot | heal | hot | buff | debuff | mezz | charm | root | snare | summon | gate | teleport | utility
  target_type     TEXT    NOT NULL DEFAULT 'single',        -- self | single | group | pbae | targeted_ae | corpse
  school          TEXT    NOT NULL DEFAULT 'magic',         -- magic | fire | cold | poison | disease | divine | alteration | conjuration | evocation | abjuration | divination

  req_level       INTEGER NOT NULL DEFAULT 1,
  req_class       TEXT,   -- pipe-separated class list, NULL = any

  mana_cost       INTEGER NOT NULL DEFAULT 0,
  end_cost        INTEGER NOT NULL DEFAULT 0,
  cast_time       REAL    NOT NULL DEFAULT 2.0,  -- seconds
  recast_time     REAL    NOT NULL DEFAULT 0.0,  -- seconds
  duration        REAL    NOT NULL DEFAULT 0.0,  -- seconds, 0 = instant
  range           INTEGER NOT NULL DEFAULT 0,    -- 0 = melee, in units
  ae_range        INTEGER NOT NULL DEFAULT 0,

  -- Effect values
  effect_value    INTEGER NOT NULL DEFAULT 0,   -- primary effect (damage, heal, etc.)
  effect_value2   INTEGER NOT NULL DEFAULT 0,
  resist_type     TEXT    NOT NULL DEFAULT 'magic',
  resist_adjust   INTEGER NOT NULL DEFAULT 0,

  -- Buffs/debuffs (JSON-encoded stat mods applied during duration)
  stat_mods       TEXT    NOT NULL DEFAULT '{}',

  components_text TEXT,  -- spell component description
  cast_animation  TEXT   NOT NULL DEFAULT 'cast_generic',
  impact_fx       TEXT   NOT NULL DEFAULT 'impact_generic',
  rank            INTEGER NOT NULL DEFAULT 1   -- spell rank / version
);

-- ------------------------------------------------------------
-- Character Spellbook & Memorized Spells
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_spells (
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  spell_id      INTEGER NOT NULL REFERENCES spells(id),
  memorized     INTEGER NOT NULL DEFAULT 0,
  gem_slot      INTEGER,  -- 0-7 for memorized gems
  PRIMARY KEY (character_id, spell_id)
);

-- ------------------------------------------------------------
-- Abilities (combat skills, disciplines, passive)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abilities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT,
  ability_type  TEXT    NOT NULL DEFAULT 'skill',   -- skill | discipline | passive | combat_art
  req_level     INTEGER NOT NULL DEFAULT 1,
  req_class     TEXT,
  end_cost      INTEGER NOT NULL DEFAULT 0,
  reuse_time    REAL    NOT NULL DEFAULT 0.0,
  duration      REAL    NOT NULL DEFAULT 0.0,
  effect_type   TEXT    NOT NULL DEFAULT 'none',
  effect_value  INTEGER NOT NULL DEFAULT 0,
  max_rank      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS character_abilities (
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  ability_id    INTEGER NOT NULL REFERENCES abilities(id),
  current_rank  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (character_id, ability_id)
);

-- ------------------------------------------------------------
-- NPCs (definitions)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS npcs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  last_name     TEXT,
  description   TEXT,
  race          TEXT    NOT NULL DEFAULT 'human',
  class         TEXT    NOT NULL DEFAULT 'warrior',
  npc_type      TEXT    NOT NULL DEFAULT 'monster',  -- monster | merchant | quest_giver | guard | banker | trainer | named
  level         INTEGER NOT NULL DEFAULT 1,
  is_aggro      INTEGER NOT NULL DEFAULT 0,
  see_invis     INTEGER NOT NULL DEFAULT 0,
  see_hide      INTEGER NOT NULL DEFAULT 0,
  faction_id    INTEGER,

  hp_base       INTEGER NOT NULL DEFAULT 100,
  mana_base     INTEGER NOT NULL DEFAULT 0,
  str           INTEGER NOT NULL DEFAULT 75,
  agi           INTEGER NOT NULL DEFAULT 75,
  ac            INTEGER NOT NULL DEFAULT 10,
  dmg_min       INTEGER NOT NULL DEFAULT 1,
  dmg_max       INTEGER NOT NULL DEFAULT 5,
  dmg_type      TEXT    NOT NULL DEFAULT 'blunt',
  attack_delay  INTEGER NOT NULL DEFAULT 20,

  exp_reward    INTEGER NOT NULL DEFAULT 10,
  faction_reward INTEGER NOT NULL DEFAULT 0,

  -- Loot table (JSON array of {item_id, chance, min_qty, max_qty})
  loot_table    TEXT    NOT NULL DEFAULT '[]',

  -- Merchant inventory (JSON array of item_ids)
  merchant_items TEXT   NOT NULL DEFAULT '[]',

  -- Dialogue (JSON object {greeting, keywords: [{keyword, response}]})
  dialogue      TEXT    NOT NULL DEFAULT '{}',

  walk_speed    REAL    NOT NULL DEFAULT 1.0,
  run_speed     REAL    NOT NULL DEFAULT 3.0,
  leash_range   INTEGER NOT NULL DEFAULT 200,
  aggro_range   INTEGER NOT NULL DEFAULT 50
);

-- ------------------------------------------------------------
-- Patrol Paths
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patrol_paths (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  zone_id   INTEGER NOT NULL REFERENCES zones(id),
  loop_type TEXT    NOT NULL DEFAULT 'loop'  -- loop | ping_pong | once
);

CREATE TABLE IF NOT EXISTS patrol_waypoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path_id     INTEGER NOT NULL REFERENCES patrol_paths(id) ON DELETE CASCADE,
  step_order  INTEGER NOT NULL DEFAULT 1,
  x           REAL    NOT NULL DEFAULT 0,
  y           REAL    NOT NULL DEFAULT 0,
  z           REAL    NOT NULL DEFAULT 0,
  heading     REAL    NOT NULL DEFAULT 0,
  wait_time   REAL    NOT NULL DEFAULT 0   -- seconds to pause at this point
);

-- ------------------------------------------------------------
-- NPC Spawns (proxy objects — one row = one spawn point)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS npc_spawns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_id        INTEGER NOT NULL REFERENCES npcs(id),
  zone_id       INTEGER NOT NULL REFERENCES zones(id),
  -- position (spawn origin and safe-return point)
  x             REAL    NOT NULL DEFAULT 0,
  y             REAL    NOT NULL DEFAULT 0,
  z             REAL    NOT NULL DEFAULT 0,
  heading       REAL    NOT NULL DEFAULT 0,
  -- timing
  respawn_time  INTEGER NOT NULL DEFAULT 300,  -- seconds until re-pop after death
  -- movement behaviour: wander OR patrol (patrol takes priority)
  wander        INTEGER NOT NULL DEFAULT 0,
  wander_radius INTEGER NOT NULL DEFAULT 50,
  path_id       INTEGER REFERENCES patrol_paths(id),
  -- aggro overrides (NULL = use npc defaults)
  aggro_range_override   INTEGER,
  leash_range_override   INTEGER,
  -- grouping label for related spawns (e.g. 'camp_a')
  spawn_group   TEXT,
  -- optional note visible in GM tool
  editor_note   TEXT
);

-- ------------------------------------------------------------
-- Quests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT,
  quest_type    TEXT    NOT NULL DEFAULT 'side',  -- main | side | daily | repeatable
  zone_id       INTEGER REFERENCES zones(id),
  giver_npc_id  INTEGER REFERENCES npcs(id),
  turn_in_npc_id INTEGER REFERENCES npcs(id),
  req_level     INTEGER NOT NULL DEFAULT 1,
  max_level     INTEGER NOT NULL DEFAULT 60,
  req_quest_id  INTEGER REFERENCES quests(id),  -- prerequisite
  exp_reward    INTEGER NOT NULL DEFAULT 0,
  platinum_reward INTEGER NOT NULL DEFAULT 0,
  gold_reward   INTEGER NOT NULL DEFAULT 0,
  silver_reward INTEGER NOT NULL DEFAULT 0,
  copper_reward INTEGER NOT NULL DEFAULT 0,
  item_reward   TEXT    NOT NULL DEFAULT '[]',   -- JSON array of item_ids
  repeatable    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quest_objectives (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_id    INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  step_order  INTEGER NOT NULL DEFAULT 1,
  obj_type    TEXT    NOT NULL DEFAULT 'kill',  -- kill | collect | talk | explore | escort | use_item
  description TEXT    NOT NULL,
  target_id   INTEGER,  -- npc_id for kill/talk, item_id for collect, zone_id for explore
  target_name TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS character_quests (
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id      INTEGER NOT NULL REFERENCES quests(id),
  status        TEXT    NOT NULL DEFAULT 'active',  -- active | completed | failed
  started_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  completed_at  INTEGER,
  PRIMARY KEY (character_id, quest_id)
);

CREATE TABLE IF NOT EXISTS character_quest_progress (
  character_id    INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id        INTEGER NOT NULL REFERENCES quests(id),
  objective_id    INTEGER NOT NULL REFERENCES quest_objectives(id),
  current_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, quest_id, objective_id)
);

-- ------------------------------------------------------------
-- Factions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factions (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS character_factions (
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  faction_id    INTEGER NOT NULL REFERENCES factions(id),
  standing      INTEGER NOT NULL DEFAULT 0,  -- -2000 to +2000
  PRIMARY KEY (character_id, faction_id)
);

-- ------------------------------------------------------------
-- Skills (combat skills tracked as 0-300)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_skills (
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_name    TEXT    NOT NULL,
  skill_value   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (character_id, skill_name)
);

-- ------------------------------------------------------------
-- Chat / World Messages (persisted log, last 1000 per zone)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel       TEXT    NOT NULL DEFAULT 'say',  -- say | shout | ooc | auction | tell | group | guild
  zone_id       INTEGER REFERENCES zones(id),
  sender_name   TEXT    NOT NULL,
  message       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);
CREATE INDEX IF NOT EXISTS idx_characters_zone ON characters(zone_id);
CREATE INDEX IF NOT EXISTS idx_npc_spawns_zone ON npc_spawns(zone_id);
CREATE INDEX IF NOT EXISTS idx_character_inventory ON character_inventory(character_id);
CREATE INDEX IF NOT EXISTS idx_character_quests ON character_quests(character_id);
CREATE INDEX IF NOT EXISTS idx_chat_log_zone ON chat_log(zone_id, created_at DESC);
