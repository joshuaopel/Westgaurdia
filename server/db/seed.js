const { getDb } = require('./database');

const db = getDb();

// ============================================================
// ZONES
// ============================================================
const zones = [
  { short_name: 'qeynos_hills', display_name: 'Qeynos Hills', description: 'Rolling green hills outside the city of Qeynos. A good place for adventurers starting their journey.', min_level: 1, max_level: 10, safe_x: 0, safe_y: 0, safe_z: 0, zone_type: 'outdoor', fog_color: '#c8e8c0', sky: 'day' },
  { short_name: 'qeynos', display_name: 'South Qeynos', description: 'The great city of Qeynos, seat of power in the kingdom of Antonica.', min_level: 1, max_level: 60, safe_x: 100, safe_y: 50, safe_z: 0, zone_type: 'city', fog_color: '#b0c8e0', sky: 'day' },
  { short_name: 'blackburrow', display_name: 'Blackburrow', description: 'A vast underground lair home to gnolls of the Blackburrow clan. Dark tunnels echo with their howls.', min_level: 5, max_level: 20, safe_x: -50, safe_y: 0, safe_z: 0, zone_type: 'dungeon', fog_color: '#303030', sky: 'night' },
  { short_name: 'everfrost', display_name: 'Everfrost Peaks', description: 'Frozen tundra of the far north where barbarians and polar bears roam the eternal ice.', min_level: 15, max_level: 35, safe_x: 0, safe_y: 0, safe_z: 0, zone_type: 'outdoor', fog_color: '#d0e8ff', sky: 'day' },
  { short_name: 'befallen', display_name: 'Befallen', description: 'An ancient crypt filled with undead horrors. Once a noble keep, now cursed for eternity.', min_level: 20, max_level: 40, safe_x: 0, safe_y: 0, safe_z: 0, zone_type: 'dungeon', fog_color: '#202020', sky: 'night' },
  { short_name: 'highpass', display_name: 'Highpass Hold', description: 'A strategic mountain pass connecting the eastern and western continents. Patrolled by guards and infested with orcs.', min_level: 10, max_level: 25, safe_x: 0, safe_y: 0, safe_z: 0, zone_type: 'outdoor', fog_color: '#a0a0b0', sky: 'day' },
  { short_name: 'lavastorm', display_name: 'Lavastorm Mountains', description: 'Volcanic mountain range home to fire drakes and the Solusek Ro goblin tribes.', min_level: 30, max_level: 50, safe_x: 0, safe_y: 0, safe_z: 0, zone_type: 'outdoor', fog_color: '#603020', sky: 'day' },
  { short_name: 'solb', display_name: 'Solusek\'s Eye', description: 'The inner sanctum of the volcano Solusek Ro. Fire goblins and fire imps roam these scorching halls.', min_level: 35, max_level: 55, safe_x: 0, safe_y: 0, safe_z: 0, zone_type: 'dungeon', fog_color: '#401008', sky: 'night' },
];

const insertZone = db.prepare(`
  INSERT OR IGNORE INTO zones (short_name, display_name, description, min_level, max_level, safe_x, safe_y, safe_z, zone_type, fog_color, sky)
  VALUES (@short_name, @display_name, @description, @min_level, @max_level, @safe_x, @safe_y, @safe_z, @zone_type, @fog_color, @sky)
`);
zones.forEach(z => insertZone.run(z));
console.log('✓ Zones seeded');

// ============================================================
// SPELLS
// ============================================================
const spells = [
  // Cleric
  { name: 'Minor Healing', description: 'Restores a small amount of hit points to your target.', spell_type: 'heal', target_type: 'single', school: 'divine', req_level: 1, req_class: 'CLR', mana_cost: 10, cast_time: 2.5, duration: 0, range: 100, effect_value: 20, resist_type: 'divine', rank: 1 },
  { name: 'Light Healing', description: 'Restores a moderate amount of hit points to your target.', spell_type: 'heal', target_type: 'single', school: 'divine', req_level: 5, req_class: 'CLR', mana_cost: 25, cast_time: 3.0, duration: 0, range: 100, effect_value: 55, resist_type: 'divine', rank: 1 },
  { name: 'Healing', description: 'Restores a significant amount of hit points to your target.', spell_type: 'heal', target_type: 'single', school: 'divine', req_level: 15, req_class: 'CLR', mana_cost: 65, cast_time: 4.0, duration: 0, range: 100, effect_value: 150, resist_type: 'divine', rank: 1 },
  { name: 'Undead Ward', description: 'Wards your target against undead attacks, providing modest AC.', spell_type: 'buff', target_type: 'single', school: 'divine', req_level: 1, req_class: 'CLR', mana_cost: 15, cast_time: 2.0, duration: 1800, range: 100, effect_value: 5, resist_type: 'divine', stat_mods: '{"ac":5}', rank: 1 },
  { name: 'Smite', description: 'Calls down divine wrath upon your enemy.', spell_type: 'direct_damage', target_type: 'single', school: 'divine', req_level: 1, req_class: 'CLR|PAL', mana_cost: 15, cast_time: 2.0, duration: 0, range: 100, effect_value: 18, resist_type: 'divine', rank: 1 },
  { name: 'Turn Undead', description: 'Attempts to drive undead creatures away in fear.', spell_type: 'debuff', target_type: 'single', school: 'divine', req_level: 3, req_class: 'CLR|PAL', mana_cost: 20, cast_time: 1.5, duration: 30, range: 50, effect_value: 0, resist_type: 'divine', rank: 1 },

  // Wizard
  { name: 'Minor Shielding', description: 'Surrounds you with a small magical shield.', spell_type: 'buff', target_type: 'self', school: 'abjuration', req_level: 1, req_class: 'WIZ|MAG|ENC|NEC', mana_cost: 12, cast_time: 1.5, duration: 1800, range: 0, effect_value: 0, resist_type: 'magic', stat_mods: '{"ac":4,"hp":10}', rank: 1 },
  { name: 'Shock of Ice', description: 'Blasts your target with a shard of ice.', spell_type: 'direct_damage', target_type: 'single', school: 'evocation', req_level: 1, req_class: 'WIZ', mana_cost: 20, cast_time: 2.0, duration: 0, range: 200, effect_value: 32, resist_type: 'cold', rank: 1 },
  { name: 'Burning Embers', description: 'Ignites your target with a small flame.', spell_type: 'dot', target_type: 'single', school: 'evocation', req_level: 1, req_class: 'WIZ|MAG', mana_cost: 18, cast_time: 2.0, duration: 18, range: 200, effect_value: 4, resist_type: 'fire', rank: 1 },
  { name: 'Lightning Bolt', description: 'Strikes your target with a bolt of lightning.', spell_type: 'direct_damage', target_type: 'single', school: 'evocation', req_level: 8, req_class: 'WIZ', mana_cost: 45, cast_time: 2.5, duration: 0, range: 250, effect_value: 78, resist_type: 'magic', rank: 1 },
  { name: 'Firestrike', description: 'Calls down a column of fire upon your target.', spell_type: 'direct_damage', target_type: 'single', school: 'evocation', req_level: 12, req_class: 'WIZ|MAG', mana_cost: 60, cast_time: 3.0, duration: 0, range: 250, effect_value: 110, resist_type: 'fire', rank: 1 },
  { name: 'Gate', description: 'Returns you instantly to your bind point.', spell_type: 'gate', target_type: 'self', school: 'alteration', req_level: 9, req_class: 'WIZ|MAG|NEC|ENC', mana_cost: 70, cast_time: 9.0, duration: 0, range: 0, effect_value: 0, resist_type: 'magic', rank: 1 },

  // Druid
  { name: 'Skin like Wood', description: 'Hardens your skin, providing protection from attacks.', spell_type: 'buff', target_type: 'single', school: 'alteration', req_level: 1, req_class: 'DRU', mana_cost: 10, cast_time: 2.0, duration: 2700, range: 100, effect_value: 0, resist_type: 'magic', stat_mods: '{"ac":6}', rank: 1 },
  { name: 'Camouflage', description: 'Hides you from most creatures in the wild.', spell_type: 'buff', target_type: 'self', school: 'divination', req_level: 14, req_class: 'DRU|RNG', mana_cost: 25, cast_time: 2.0, duration: 3600, range: 0, effect_value: 0, resist_type: 'magic', stat_mods: '{}', rank: 1 },
  { name: 'Snare', description: 'Slows your target\'s movement speed dramatically.', spell_type: 'debuff', target_type: 'single', school: 'alteration', req_level: 5, req_class: 'DRU|RNG', mana_cost: 20, cast_time: 2.0, duration: 60, range: 150, effect_value: -50, resist_type: 'magic', rank: 1 },
  { name: 'Starfire', description: 'Calls down a bolt of celestial energy.', spell_type: 'direct_damage', target_type: 'single', school: 'evocation', req_level: 1, req_class: 'DRU', mana_cost: 20, cast_time: 2.0, duration: 0, range: 200, effect_value: 28, resist_type: 'magic', rank: 1 },
  { name: 'Burst of Flame', description: 'Engulfs your target in a burst of druidic flame.', spell_type: 'direct_damage', target_type: 'single', school: 'evocation', req_level: 5, req_class: 'DRU', mana_cost: 30, cast_time: 2.5, duration: 0, range: 200, effect_value: 52, resist_type: 'fire', rank: 1 },

  // Necromancer
  { name: 'Chill Bones', description: 'Saps the life force from your target, dealing damage over time.', spell_type: 'dot', target_type: 'single', school: 'alteration', req_level: 1, req_class: 'NEC', mana_cost: 15, cast_time: 2.0, duration: 24, range: 200, effect_value: 5, resist_type: 'magic', rank: 1 },
  { name: 'Fear', description: 'Sends your target fleeing in terror.', spell_type: 'debuff', target_type: 'single', school: 'alteration', req_level: 1, req_class: 'NEC', mana_cost: 20, cast_time: 2.0, duration: 18, range: 150, effect_value: 0, resist_type: 'magic', rank: 1 },
  { name: 'Darkness', description: 'Weakens your target with a shroud of shadow.', spell_type: 'debuff', target_type: 'single', school: 'alteration', req_level: 1, req_class: 'NEC|ENC', mana_cost: 15, cast_time: 2.0, duration: 45, range: 150, effect_value: -5, resist_type: 'magic', stat_mods: '{"str":-5}', rank: 1 },
  { name: 'Summon Dead', description: 'Animates a skeleton to fight for you.', spell_type: 'summon', target_type: 'self', school: 'conjuration', req_level: 4, req_class: 'NEC', mana_cost: 35, cast_time: 5.0, duration: 0, range: 0, effect_value: 1, resist_type: 'magic', rank: 1 },

  // Enchanter
  { name: 'Mesmerize', description: 'Puts your target into a trance, holding it immobile.', spell_type: 'mezz', target_type: 'single', school: 'alteration', req_level: 6, req_class: 'ENC', mana_cost: 25, cast_time: 2.0, duration: 30, range: 150, effect_value: 0, resist_type: 'magic', rank: 1 },
  { name: 'Befuddle', description: 'Briefly confuses your target.', spell_type: 'mezz', target_type: 'single', school: 'alteration', req_level: 1, req_class: 'ENC', mana_cost: 15, cast_time: 1.5, duration: 12, range: 150, effect_value: 0, resist_type: 'magic', rank: 1 },
  { name: 'Haste', description: 'Greatly increases your target\'s attack speed.', spell_type: 'buff', target_type: 'single', school: 'alteration', req_level: 8, req_class: 'ENC', mana_cost: 40, cast_time: 3.0, duration: 1800, range: 100, effect_value: 0, resist_type: 'magic', stat_mods: '{"attack_speed":20}', rank: 1 },

  // Shaman
  { name: 'Spirit of Wolf', description: 'Invokes the spirit of the wolf, greatly increasing movement speed.', spell_type: 'buff', target_type: 'single', school: 'alteration', req_level: 9, req_class: 'SHM', mana_cost: 35, cast_time: 3.0, duration: 1800, range: 100, effect_value: 0, resist_type: 'magic', stat_mods: '{"move_speed":45}', rank: 1 },
  { name: 'Talisman of the Serpent', description: 'Poisons your enemy with serpent venom.', spell_type: 'dot', target_type: 'single', school: 'alteration', req_level: 5, req_class: 'SHM', mana_cost: 25, cast_time: 2.5, duration: 48, effect_value: 6, resist_type: 'poison', rank: 1 },
  { name: 'Strengthen', description: 'Strengthens your target\'s muscles.', spell_type: 'buff', target_type: 'single', school: 'alteration', req_level: 1, req_class: 'SHM|DRU', mana_cost: 10, cast_time: 2.0, duration: 2700, range: 100, effect_value: 0, resist_type: 'magic', stat_mods: '{"str":11}', rank: 1 },
];

const insertSpell = db.prepare(`
  INSERT OR IGNORE INTO spells (name, description, spell_type, target_type, school, req_level, req_class, mana_cost, cast_time, duration, range, effect_value, resist_type, stat_mods, rank)
  VALUES (@name, @description, @spell_type, @target_type, @school, @req_level, @req_class, @mana_cost, @cast_time, @duration, @range, @effect_value, @resist_type, @stat_mods, @rank)
`);
spells.forEach(s => insertSpell.run({ stat_mods: '{}', range: 0, ...s }));
console.log('✓ Spells seeded');

// ============================================================
// ITEMS
// ============================================================
const items = [
  // Weapons
  { name: 'Rusty Short Sword', description: 'A battered short sword covered in rust spots. Better than nothing.', item_type: 'weapon', slot: 'primary', weight: 4.0, dmg_min: 3, dmg_max: 7, dmg_type: 'slash', attack_delay: 18, value_copper: 25 },
  { name: 'Wooden Club', description: 'A simple wooden club.', item_type: 'weapon', slot: 'primary', weight: 5.0, dmg_min: 2, dmg_max: 6, dmg_type: 'blunt', attack_delay: 22, value_copper: 10 },
  { name: 'Short Spear', description: 'A hunting spear useful in both melee and as a throwing weapon.', item_type: 'weapon', slot: 'primary', weight: 6.0, dmg_min: 4, dmg_max: 9, dmg_type: 'pierce', attack_delay: 25, value_copper: 50 },
  { name: 'Bone Dirk', description: 'A knife carved from a large bone. Crude but effective.', item_type: 'weapon', slot: 'primary', weight: 1.5, dmg_min: 2, dmg_max: 5, dmg_type: 'pierce', attack_delay: 12, value_copper: 30 },
  { name: 'Gnoll Fang', description: 'A fang pulled from a gnoll, sharpened into a blade.', item_type: 'weapon', slot: 'primary', weight: 2.0, dmg_min: 4, dmg_max: 8, dmg_type: 'pierce', attack_delay: 14, value_copper: 80 },
  { name: 'Iron Longsword', description: 'A well-crafted iron longsword.', item_type: 'weapon', slot: 'primary', weight: 7.0, dmg_min: 6, dmg_max: 14, dmg_type: 'slash', attack_delay: 28, value_copper: 250, req_level: 5 },
  { name: 'Wizard\'s Staff', description: 'A gnarled wooden staff favored by spellcasters.', item_type: 'weapon', slot: 'primary', weight: 5.0, dmg_min: 3, dmg_max: 9, dmg_type: 'blunt', attack_delay: 30, mod_int: 3, value_copper: 120 },
  { name: 'Battle Axe', description: 'A heavy battle axe for dealing serious damage.', item_type: 'weapon', slot: 'primary', weight: 9.0, dmg_min: 8, dmg_max: 18, dmg_type: 'slash', attack_delay: 35, req_level: 8, mod_str: 2, value_copper: 400 },
  // Armor
  { name: 'Cloth Cap', description: 'A simple cloth cap.', item_type: 'armor', slot: 'head', weight: 0.5, ac: 1, value_copper: 10 },
  { name: 'Leather Skullcap', description: 'A skullcap made of hardened leather.', item_type: 'armor', slot: 'head', weight: 1.0, ac: 3, value_copper: 35 },
  { name: 'Cloth Tunic', description: 'A simple cloth tunic.', item_type: 'armor', slot: 'chest', weight: 1.0, ac: 1, value_copper: 15 },
  { name: 'Leather Tunic', description: 'A tunic of tanned leather offering modest protection.', item_type: 'armor', slot: 'chest', weight: 3.0, ac: 5, value_copper: 80 },
  { name: 'Banded Armor', description: 'Strips of metal banded together for solid protection.', item_type: 'armor', slot: 'chest', weight: 7.0, ac: 10, req_level: 8, value_copper: 350 },
  { name: 'Leather Leggings', description: 'Leather leggings providing modest leg protection.', item_type: 'armor', slot: 'legs', weight: 2.0, ac: 4, value_copper: 60 },
  { name: 'Cloth Boots', description: 'Simple cloth boots.', item_type: 'armor', slot: 'feet', weight: 0.5, ac: 1, value_copper: 10 },
  { name: 'Leather Boots', description: 'Comfortable leather boots.', item_type: 'armor', slot: 'feet', weight: 1.5, ac: 2, mod_agi: 1, value_copper: 45 },
  // Jewelry
  { name: 'Copper Ring', description: 'A simple copper ring with no magical properties.', item_type: 'misc', slot: 'finger', weight: 0.1, value_copper: 20 },
  { name: 'Silver Earring', description: 'A small silver earring.', item_type: 'misc', slot: 'neck', weight: 0.1, mod_cha: 1, value_copper: 55 },
  // Consumables
  { name: 'Bandage', description: 'A cloth bandage used to treat minor wounds.', item_type: 'misc', stackable: 1, stack_size: 20, weight: 0.1, value_copper: 5 },
  { name: 'Bread Loaf', description: 'A fresh loaf of bread. Restores a small amount of HP when consumed.', item_type: 'food', stackable: 1, stack_size: 10, weight: 0.5, value_copper: 5 },
  { name: 'Water Flask', description: 'A flask of clean water. Restores a small amount of mana when consumed.', item_type: 'drink', stackable: 1, stack_size: 10, weight: 0.5, value_copper: 3 },
  // Quest items
  { name: 'Gnoll Hide', description: 'The hide of a slain gnoll. Someone might pay good coin for this.', item_type: 'quest', stackable: 1, stack_size: 10, weight: 1.0, no_trade: 0, value_copper: 15 },
  { name: 'Blackburrow Stout', description: 'A frothy mug of gnoll-brewed ale. Smells terrible but tastes... okay?', item_type: 'drink', stackable: 1, stack_size: 5, weight: 1.0, value_copper: 20 },
];

const insertItem = db.prepare(`
  INSERT OR IGNORE INTO items (name, description, item_type, slot, weight, ac, dmg_min, dmg_max, dmg_type, attack_delay, mod_str, mod_sta, mod_agi, mod_dex, mod_int, mod_wis, mod_cha, mod_hp, mod_mana, stackable, stack_size, req_level, no_trade, value_copper)
  VALUES (@name, @description, @item_type, @slot, @weight, @ac, @dmg_min, @dmg_max, @dmg_type, @attack_delay, @mod_str, @mod_sta, @mod_agi, @mod_dex, @mod_int, @mod_wis, @mod_cha, @mod_hp, @mod_mana, @stackable, @stack_size, @req_level, @no_trade, @value_copper)
`);
items.forEach(i => insertItem.run({
  slot: null, ac: 0, dmg_min: 0, dmg_max: 0, dmg_type: null, attack_delay: 20,
  mod_str: 0, mod_sta: 0, mod_agi: 0, mod_dex: 0, mod_int: 0, mod_wis: 0, mod_cha: 0, mod_hp: 0, mod_mana: 0,
  stackable: 0, stack_size: 1, req_level: 0, no_trade: 0, value_copper: 0, ...i
}));
console.log('✓ Items seeded');

// ============================================================
// NPCS
// ============================================================
const npcs = [
  // Qeynos Hills
  {
    name: 'Gnoll Pup', race: 'gnoll', class: 'warrior', npc_type: 'monster', level: 1, is_aggro: 0,
    hp_base: 25, str: 60, agi: 70, ac: 5, dmg_min: 1, dmg_max: 4, dmg_type: 'slash', attack_delay: 20,
    exp_reward: 8, loot_table: JSON.stringify([{ item_name: 'Gnoll Hide', chance: 0.4, min_qty: 1, max_qty: 1 }]),
    dialogue: JSON.stringify({ greeting: '*growls menacingly*' })
  },
  {
    name: 'Gnoll Scout', race: 'gnoll', class: 'warrior', npc_type: 'monster', level: 3, is_aggro: 1,
    hp_base: 55, str: 70, agi: 75, ac: 8, dmg_min: 3, dmg_max: 7, dmg_type: 'slash', attack_delay: 20,
    exp_reward: 22, loot_table: JSON.stringify([{ item_name: 'Gnoll Hide', chance: 0.6, min_qty: 1, max_qty: 2 }]),
    dialogue: JSON.stringify({ greeting: '*barks and draws a blade*' })
  },
  {
    name: 'Guard Fynn', last_name: '', race: 'human', class: 'warrior', npc_type: 'guard', level: 8, is_aggro: 0,
    hp_base: 200, str: 90, agi: 80, ac: 20, dmg_min: 8, dmg_max: 18, dmg_type: 'slash', attack_delay: 28,
    exp_reward: 0,
    dialogue: JSON.stringify({ greeting: 'Hail, adventurer! Keep the roads clear of gnolls and you\'ll find Qeynos a friendly city.', keywords: [{ keyword: 'gnoll', response: 'The gnolls of Blackburrow have been pushing further west lately. Be careful out there.' }] })
  },
  {
    name: 'Toresian Ironhammer', last_name: '', race: 'human', class: 'warrior', npc_type: 'merchant', level: 5, is_aggro: 0,
    hp_base: 100, str: 80, agi: 70, ac: 10, dmg_min: 4, dmg_max: 10, dmg_type: 'blunt', attack_delay: 25,
    exp_reward: 0,
    merchant_items: JSON.stringify(['Rusty Short Sword', 'Wooden Club', 'Leather Tunic', 'Leather Leggings', 'Leather Boots', 'Bandage']),
    dialogue: JSON.stringify({ greeting: 'Welcome to Ironhammer\'s Goods! Browse my wares, friend. Best prices in Qeynos.', keywords: [{ keyword: 'buy', response: 'Let me show you what I have for sale.' }] })
  },
  // Blackburrow
  {
    name: 'Gnoll Warrior', race: 'gnoll', class: 'warrior', npc_type: 'monster', level: 6, is_aggro: 1,
    hp_base: 100, str: 80, agi: 75, ac: 12, dmg_min: 6, dmg_max: 13, dmg_type: 'slash', attack_delay: 22,
    exp_reward: 45, loot_table: JSON.stringify([{ item_name: 'Gnoll Hide', chance: 0.7, min_qty: 1, max_qty: 2 }, { item_name: 'Blackburrow Stout', chance: 0.2, min_qty: 1, max_qty: 1 }]),
    dialogue: JSON.stringify({ greeting: '*snarls*' })
  },
  {
    name: 'Gnoll Shaman', race: 'gnoll', class: 'shaman', npc_type: 'monster', level: 8, is_aggro: 1,
    hp_base: 90, mana_base: 120, str: 70, agi: 70, ac: 10, dmg_min: 4, dmg_max: 9, dmg_type: 'blunt', attack_delay: 28,
    exp_reward: 65, loot_table: JSON.stringify([{ item_name: 'Gnoll Hide', chance: 0.5, min_qty: 1, max_qty: 1 }]),
    dialogue: JSON.stringify({ greeting: '*chants in gnollish*' })
  },
  {
    name: 'Darkpaw Alpha', last_name: '(Named)', race: 'gnoll', class: 'warrior', npc_type: 'named', level: 12, is_aggro: 1,
    hp_base: 450, str: 110, agi: 90, ac: 22, dmg_min: 14, dmg_max: 28, dmg_type: 'slash', attack_delay: 24,
    exp_reward: 280, loot_table: JSON.stringify([{ item_name: 'Gnoll Fang', chance: 0.3, min_qty: 1, max_qty: 1 }, { item_name: 'Gnoll Hide', chance: 1.0, min_qty: 2, max_qty: 4 }]),
    dialogue: JSON.stringify({ greeting: 'YOU DARE ENTER MY LAIR?!' })
  },
  // Everfrost
  {
    name: 'Snow Badger', race: 'animal', class: 'warrior', npc_type: 'monster', level: 15, is_aggro: 0,
    hp_base: 180, str: 85, agi: 90, ac: 15, dmg_min: 10, dmg_max: 20, dmg_type: 'slash', attack_delay: 16,
    exp_reward: 90, loot_table: JSON.stringify([{ item_name: 'Bandage', chance: 0.1, min_qty: 1, max_qty: 2 }]),
    dialogue: JSON.stringify({ greeting: '*hisses*' })
  },
  // Quest givers
  {
    name: 'Sheriff Roglio', last_name: '', race: 'human', class: 'warrior', npc_type: 'quest_giver', level: 10, is_aggro: 0,
    hp_base: 300, str: 95, agi: 85, ac: 25, dmg_min: 10, dmg_max: 22, dmg_type: 'slash', attack_delay: 28,
    exp_reward: 0,
    dialogue: JSON.stringify({
      greeting: 'Hail! The gnolls have been raiding our farms and I need capable adventurers to push them back. Will you help?',
      keywords: [
        { keyword: 'gnoll', response: 'The gnolls from Blackburrow have been emboldened of late. Kill ten gnoll scouts and return to me for your reward.' },
        { keyword: 'reward', response: 'Bring me proof you\'ve slain ten gnoll scouts - gnoll hides will do - and I\'ll pay you well.' }
      ]
    })
  },
];

const insertNpc = db.prepare(`
  INSERT OR IGNORE INTO npcs (name, last_name, race, class, npc_type, level, is_aggro, hp_base, mana_base, str, agi, ac, dmg_min, dmg_max, dmg_type, attack_delay, exp_reward, loot_table, merchant_items, dialogue)
  VALUES (@name, @last_name, @race, @class, @npc_type, @level, @is_aggro, @hp_base, @mana_base, @str, @agi, @ac, @dmg_min, @dmg_max, @dmg_type, @attack_delay, @exp_reward, @loot_table, @merchant_items, @dialogue)
`);
npcs.forEach(n => insertNpc.run({
  last_name: null, mana_base: 0, loot_table: '[]', merchant_items: '[]', dialogue: '{}', ...n
}));
console.log('✓ NPCs seeded');

// ============================================================
// NPC SPAWNS
// ============================================================
const qhZone = db.prepare('SELECT id FROM zones WHERE short_name=?').get('qeynos_hills');
const bbZone = db.prepare('SELECT id FROM zones WHERE short_name=?').get('blackburrow');
const efZone = db.prepare('SELECT id FROM zones WHERE short_name=?').get('everfrost');
const qcZone = db.prepare('SELECT id FROM zones WHERE short_name=?').get('qeynos');

const getNpc = (name) => db.prepare('SELECT id FROM npcs WHERE name=?').get(name);

const spawns = [
  { npc_name: 'Gnoll Pup', zone: qhZone.id, x: 50, y: 30, z: 0, respawn_time: 120, wander: 1, wander_radius: 80 },
  { npc_name: 'Gnoll Pup', zone: qhZone.id, x: -20, y: 80, z: 0, respawn_time: 120, wander: 1, wander_radius: 80 },
  { npc_name: 'Gnoll Pup', zone: qhZone.id, x: 120, y: -30, z: 0, respawn_time: 120, wander: 1, wander_radius: 60 },
  { npc_name: 'Gnoll Scout', zone: qhZone.id, x: 150, y: 100, z: 0, respawn_time: 180, wander: 1, wander_radius: 100 },
  { npc_name: 'Gnoll Scout', zone: qhZone.id, x: -100, y: 50, z: 0, respawn_time: 180, wander: 1, wander_radius: 100 },
  { npc_name: 'Guard Fynn', zone: qhZone.id, x: 5, y: 5, z: 0, respawn_time: 60, wander: 0 },
  { npc_name: 'Sheriff Roglio', zone: qcZone.id, x: 80, y: 40, z: 0, respawn_time: 60, wander: 0 },
  { npc_name: 'Toresian Ironhammer', zone: qcZone.id, x: 120, y: 60, z: 0, respawn_time: 60, wander: 0 },
  { npc_name: 'Gnoll Warrior', zone: bbZone.id, x: 30, y: 20, z: -10, respawn_time: 240, wander: 1, wander_radius: 50 },
  { npc_name: 'Gnoll Warrior', zone: bbZone.id, x: -40, y: 60, z: -10, respawn_time: 240, wander: 1, wander_radius: 50 },
  { npc_name: 'Gnoll Warrior', zone: bbZone.id, x: 80, y: -20, z: -15, respawn_time: 240, wander: 1, wander_radius: 50 },
  { npc_name: 'Gnoll Shaman', zone: bbZone.id, x: 60, y: 80, z: -20, respawn_time: 300, wander: 0 },
  { npc_name: 'Darkpaw Alpha', zone: bbZone.id, x: 0, y: 0, z: -40, respawn_time: 900, wander: 0 },
  { npc_name: 'Snow Badger', zone: efZone.id, x: 100, y: 50, z: 0, respawn_time: 180, wander: 1, wander_radius: 150 },
  { npc_name: 'Snow Badger', zone: efZone.id, x: -80, y: 120, z: 0, respawn_time: 180, wander: 1, wander_radius: 150 },
];

const insertSpawn = db.prepare(`
  INSERT OR IGNORE INTO npc_spawns (npc_id, zone_id, x, y, z, heading, respawn_time, wander, wander_radius)
  VALUES (@npc_id, @zone_id, @x, @y, @z, @heading, @respawn_time, @wander, @wander_radius)
`);
spawns.forEach(s => {
  const npc = getNpc(s.npc_name);
  if (npc) insertSpawn.run({ npc_id: npc.id, zone_id: s.zone, x: s.x, y: s.y, z: s.z, heading: 0, respawn_time: s.respawn_time, wander: s.wander || 0, wander_radius: s.wander_radius || 0 });
});
console.log('✓ NPC Spawns seeded');

// ============================================================
// QUESTS
// ============================================================
const qcId = qcZone.id;
const qhId = qhZone.id;
const bbId = bbZone.id;
const sheriffNpc = getNpc('Sheriff Roglio');

const insertQuest = db.prepare(`
  INSERT OR IGNORE INTO quests (name, description, quest_type, zone_id, giver_npc_id, req_level, exp_reward, platinum_reward, gold_reward, silver_reward, copper_reward, item_reward)
  VALUES (@name, @description, @quest_type, @zone_id, @giver_npc_id, @req_level, @exp_reward, @platinum_reward, @gold_reward, @silver_reward, @copper_reward, @item_reward)
`);

const insertObjective = db.prepare(`
  INSERT OR IGNORE INTO quest_objectives (quest_id, step_order, obj_type, description, target_name, quantity)
  VALUES (@quest_id, @step_order, @obj_type, @description, @target_name, @quantity)
`);

const q1 = insertQuest.run({
  name: 'The Gnoll Menace', description: 'Sheriff Roglio has asked you to thin the gnoll population harassing the farms of Qeynos Hills.',
  quest_type: 'side', zone_id: qhId, giver_npc_id: sheriffNpc.id, req_level: 1,
  exp_reward: 200, platinum_reward: 0, gold_reward: 1, silver_reward: 5, copper_reward: 0, item_reward: '[]'
});
insertObjective.run({ quest_id: q1.lastInsertRowid, step_order: 1, obj_type: 'kill', description: 'Slay Gnoll Scouts in Qeynos Hills', target_name: 'Gnoll Scout', quantity: 5 });
insertObjective.run({ quest_id: q1.lastInsertRowid, step_order: 2, obj_type: 'kill', description: 'Slay Gnoll Pups in Qeynos Hills', target_name: 'Gnoll Pup', quantity: 10 });

const q2 = insertQuest.run({
  name: 'Into the Burrow', description: 'Venture into Blackburrow and defeat the Darkpaw Alpha who leads the gnoll raids.',
  quest_type: 'side', zone_id: bbId, giver_npc_id: sheriffNpc.id, req_level: 8,
  exp_reward: 800, platinum_reward: 0, gold_reward: 5, silver_reward: 0, copper_reward: 0, item_reward: '[]'
});
insertObjective.run({ quest_id: q2.lastInsertRowid, step_order: 1, obj_type: 'kill', description: 'Defeat the Darkpaw Alpha in Blackburrow', target_name: 'Darkpaw Alpha', quantity: 1 });

console.log('✓ Quests seeded');

// ============================================================
// FACTIONS
// ============================================================
const factions = [
  { name: 'Qeynos Guard', description: 'The city guard and peacekeeping force of Qeynos.' },
  { name: 'Darkpaw Gnolls', description: 'The gnoll clans of Blackburrow, hostile to humanoids.' },
  { name: 'Guards of the North', description: 'Barbarian warriors who keep order in Halas and Everfrost.' },
  { name: 'Circle of Unseen Hands', description: 'The thieves\' guild of Qeynos, operating in shadow.' },
  { name: 'Priests of Life', description: 'Devoted clerics who serve Rodcet Nife in Qeynos.' },
];
const insertFaction = db.prepare('INSERT OR IGNORE INTO factions (name, description) VALUES (@name, @description)');
factions.forEach(f => insertFaction.run(f));
console.log('✓ Factions seeded');

console.log('\nSeed complete!');
