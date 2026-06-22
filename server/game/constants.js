// Race definitions
const RACES = {
  human:    { name: 'Human',      str: 75, sta: 75, agi: 75, dex: 75, int: 75, wis: 75, cha: 75, size: 'medium', classes: ['WAR','PAL','RNG','MNK','BRD','ROG','CLR','DRU','WIZ','MAG','NEC','ENC','SHM'] },
  barbarian:{ name: 'Barbarian',  str: 103,sta: 95, agi: 82, dex: 75, int: 60, wis: 70, cha: 55, size: 'large',  classes: ['WAR','MNK','ROG','SHM','BRD'] },
  erudite:  { name: 'Erudite',    str: 60, sta: 70, agi: 70, dex: 70, int: 107,wis: 83, cha: 70, size: 'medium', classes: ['CLR','WIZ','MAG','NEC','ENC','PAL'] },
  woodelf:  { name: 'Wood Elf',   str: 65, sta: 65, agi: 95, dex: 80, int: 75, wis: 80, cha: 75, size: 'small',  classes: ['WAR','RNG','BRD','DRU','ROG'] },
  highelf:  { name: 'High Elf',   str: 55, sta: 65, agi: 85, dex: 75, int: 92, wis: 100,cha: 80, size: 'medium', classes: ['CLR','PAL','WIZ','MAG','ENC'] },
  darkelf:  { name: 'Dark Elf',   str: 60, sta: 65, agi: 90, dex: 75, int: 99, wis: 83, cha: 60, size: 'medium', classes: ['WAR','ROG','NEC','WIZ','MAG','ENC','CLR','SHM'] },
  halfelf:  { name: 'Half Elf',   str: 70, sta: 70, agi: 85, dex: 80, int: 75, wis: 70, cha: 75, size: 'medium', classes: ['WAR','PAL','RNG','BRD','DRU','ROG','CLR'] },
  halfling: { name: 'Halfling',   str: 70, sta: 75, agi: 95, dex: 90, int: 67, wis: 80, cha: 50, size: 'small',  classes: ['WAR','ROG','CLR','DRU'] },
  gnome:    { name: 'Gnome',      str: 60, sta: 70, agi: 85, dex: 90, int: 98, wis: 67, cha: 60, size: 'small',  classes: ['WAR','ROG','CLR','WIZ','MAG','NEC','ENC'] },
  dwarf:    { name: 'Dwarf',      str: 90, sta: 90, agi: 70, dex: 85, int: 60, wis: 83, cha: 45, size: 'small',  classes: ['WAR','PAL','ROG','CLR','SHM'] },
  troll:    { name: 'Troll',      str: 108,sta: 109,agi: 83, dex: 75, int: 52, wis: 60, cha: 40, size: 'large',  classes: ['WAR','SHM'] },
  ogre:     { name: 'Ogre',       str: 130,sta: 122,agi: 70, dex: 70, int: 60, wis: 67, cha: 40, size: 'large',  classes: ['WAR','SHM','MNK'] },
  iksar:    { name: 'Iksar',      str: 70, sta: 70, agi: 90, dex: 85, int: 75, wis: 80, cha: 55, size: 'medium', classes: ['WAR','MNK','NEC','SHM','BST'] },
};

// Class definitions
const CLASSES = {
  WAR: { name: 'Warrior',      role: 'tank',    armor: ['cloth','leather','chain','plate'], weapons: ['1hs','1hb','1hp','2hs','2hb','hand2hand','piercing','throwing'], hp_bonus: 1.5, mana_type: null },
  PAL: { name: 'Paladin',      role: 'hybrid',  armor: ['cloth','leather','chain','plate'], weapons: ['1hs','1hb','2hs','2hb'], hp_bonus: 1.2, mana_type: 'wis' },
  RNG: { name: 'Ranger',       role: 'hybrid',  armor: ['cloth','leather','chain'],         weapons: ['1hs','1hb','2hs','2hb','piercing','archery'], hp_bonus: 1.1, mana_type: 'wis' },
  SHD: { name: 'Shadow Knight',role: 'hybrid',  armor: ['cloth','leather','chain','plate'], weapons: ['1hs','1hb','2hs','2hb'], hp_bonus: 1.2, mana_type: 'int' },
  MNK: { name: 'Monk',         role: 'melee',   armor: ['cloth','leather'],                 weapons: ['hand2hand','1hb','2hb'], hp_bonus: 1.1, mana_type: null },
  BRD: { name: 'Bard',         role: 'hybrid',  armor: ['cloth','leather','chain'],         weapons: ['1hs','1hb','piercing'], hp_bonus: 1.0, mana_type: 'cha' },
  ROG: { name: 'Rogue',        role: 'melee',   armor: ['cloth','leather'],                 weapons: ['1hs','piercing','throwing'], hp_bonus: 1.0, mana_type: null },
  BST: { name: 'Beastlord',    role: 'hybrid',  armor: ['cloth','leather'],                 weapons: ['hand2hand','1hb'], hp_bonus: 1.0, mana_type: 'wis' },
  CLR: { name: 'Cleric',       role: 'healer',  armor: ['cloth','leather','chain','plate'], weapons: ['1hb','2hb'], hp_bonus: 0.9, mana_type: 'wis' },
  DRU: { name: 'Druid',        role: 'healer',  armor: ['cloth','leather'],                 weapons: ['1hb','2hb','piercing','archery'], hp_bonus: 0.9, mana_type: 'wis' },
  SHM: { name: 'Shaman',       role: 'healer',  armor: ['cloth','leather','chain'],         weapons: ['1hb','2hb','hand2hand'], hp_bonus: 0.9, mana_type: 'wis' },
  WIZ: { name: 'Wizard',       role: 'caster',  armor: ['cloth'],                           weapons: ['1hb','2hb'], hp_bonus: 0.7, mana_type: 'int' },
  MAG: { name: 'Magician',     role: 'caster',  armor: ['cloth'],                           weapons: ['1hb','2hb'], hp_bonus: 0.7, mana_type: 'int' },
  NEC: { name: 'Necromancer',  role: 'caster',  armor: ['cloth'],                           weapons: ['1hb','2hb'], hp_bonus: 0.7, mana_type: 'int' },
  ENC: { name: 'Enchanter',    role: 'caster',  armor: ['cloth'],                           weapons: ['1hb','2hb'], hp_bonus: 0.7, mana_type: 'int' },
};

// Experience required per level
function expForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 2.5));
}

// HP formula: base + (sta * multiplier * level)
function calcMaxHp(level, sta, classKey) {
  const cls = CLASSES[classKey] || CLASSES.WAR;
  return Math.floor(50 + (sta * 0.3 * level * cls.hp_bonus));
}

// Mana formula depends on class
function calcMaxMana(level, stat, classKey) {
  const cls = CLASSES[classKey];
  if (!cls || !cls.mana_type) return 0;
  return Math.floor(50 + (stat * 0.35 * level));
}

function calcMaxEndurance(level, sta) {
  return Math.floor(50 + (sta * 0.25 * level));
}

module.exports = { RACES, CLASSES, expForLevel, calcMaxHp, calcMaxMana, calcMaxEndurance };
