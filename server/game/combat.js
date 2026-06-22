// Combat engine - handles PvE and PvP combat calculations

const { calcMaxHp } = require('./constants');

// Attack roll: attacker hits if roll > defender's avoidance
function rollAttack(attacker, defender) {
  const hitChance = Math.min(95, Math.max(5,
    50 + (attacker.agi - defender.agi) * 0.3 + (attacker.level - defender.level) * 2
  ));
  return Math.random() * 100 < hitChance;
}

// Damage roll
function rollDamage(attacker) {
  const dmgMin = attacker.dmg_min || 1;
  const dmgMax = attacker.dmg_max || 4;
  const baseDmg = Math.floor(Math.random() * (dmgMax - dmgMin + 1)) + dmgMin;
  const strBonus = Math.floor(((attacker.str || 75) - 75) * 0.1);
  return Math.max(1, baseDmg + strBonus);
}

// Mitigation: returns damage after AC reduction
function mitigate(rawDmg, defenderAc, defenderLevel) {
  const acFactor = (defenderAc + defenderLevel * 2) / 100;
  const reduction = Math.min(0.6, acFactor * 0.4);
  return Math.max(1, Math.floor(rawDmg * (1 - reduction)));
}

// Spell damage/heal roll
function rollSpellEffect(spell, casterLevel, casterStat) {
  const base = spell.effect_value || 0;
  const levelBonus = Math.floor((casterLevel - spell.req_level) * 0.5);
  const statBonus = Math.floor((casterStat - 75) * 0.15);
  const variance = Math.floor(base * 0.1);
  return Math.max(1, base + levelBonus + statBonus + Math.floor((Math.random() * 2 - 1) * variance));
}

// Resistance check: returns true if resisted
function checkResist(spell, casterLevel, targetLevel, targetResists) {
  const resistValue = targetResists[spell.resist_type] || 0;
  const levelDiff = casterLevel - targetLevel;
  const resistChance = Math.max(5, Math.min(50,
    resistValue * 0.1 - levelDiff * 3 + (spell.resist_adjust || 0)
  ));
  return Math.random() * 100 < resistChance;
}

// Process a single melee round
function meleeTick(attacker, defender) {
  const events = [];
  const hit = rollAttack(attacker, defender);

  if (!hit) {
    events.push({ type: 'miss', attacker: attacker.name, defender: defender.name });
    return events;
  }

  const raw = rollDamage(attacker);
  const dmg = mitigate(raw, defender.ac || 5, defender.level || 1);

  events.push({
    type: 'melee_hit',
    attacker: attacker.name,
    defender: defender.name,
    damage: dmg,
    dmg_type: attacker.dmg_type || 'blunt',
  });

  return events;
}

// Process a spell cast
function castSpell(spell, caster, target) {
  const events = [];

  // Mana check
  if ((caster.mana_current || 0) < spell.mana_cost) {
    events.push({ type: 'out_of_mana', caster: caster.name });
    return events;
  }

  // Resist check (only for harmful spells)
  if (['direct_damage', 'dot', 'debuff', 'mezz', 'root', 'snare'].includes(spell.spell_type)) {
    const resisted = checkResist(spell, caster.level || 1, target.level || 1, target.resists || {});
    if (resisted) {
      events.push({ type: 'resist', caster: caster.name, target: target.name, spell: spell.name });
      return events;
    }
  }

  const statKey = spell.school === 'divine' ? 'wis' : 'int';
  const casterStat = caster[statKey] || 75;
  const value = rollSpellEffect(spell, caster.level || 1, casterStat);

  events.push({ type: 'spell_cast', caster: caster.name, target: target.name, spell: spell.name, value, spell_type: spell.spell_type });
  return events;
}

// Level-up check: returns new level if leveled up
function checkLevelUp(character) {
  const { expForLevel } = require('./constants');
  let level = character.level;
  const maxLevel = 60;

  while (level < maxLevel && character.experience >= expForLevel(level + 1)) {
    level++;
  }

  return level > character.level ? level : null;
}

module.exports = { meleeTick, castSpell, checkLevelUp, rollSpellEffect, mitigate };
