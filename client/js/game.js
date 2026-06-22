// Main game client - socket events, UI, input

requireAuth();

const charId = localStorage.getItem('wg_char_id');
if (!charId) window.location.href = '/charselect.html';

let socket;
let me = null;         // character data
let zoneData = null;
let targetSpawnId = null;
let targetIsNpc = true;
let spellbook = [];
let quests = [];

// ---- Input state ----
const keys = {};
const MOVE_SPEED = 8; // units/second
let moveInterval = null;

// ---- Initialize ----
(async function init() {
  const sheet = await api.get(`/api/characters/${charId}`);
  if (sheet.error) { alert('Failed to load character'); window.location.href = '/charselect.html'; return; }

  me = sheet.character;
  spellbook = sheet.spellbook || [];
  quests = sheet.active_quests || [];

  updateCharPanel(sheet);
  renderSpellbook();
  renderQuests();
  renderInventory(sheet.inventory || []);

  initSocket();
  initInput();
  initUI();
})();

// ---- Socket ----
function initSocket() {
  socket = io({ auth: { token: localStorage.getItem('wg_token') } });

  socket.on('connect', () => {
    socket.emit('char:enter', { characterId: parseInt(charId) });
  });

  socket.on('connect_error', (err) => {
    addChat('System', err.message, 'system');
  });

  socket.on('zone:entered', ({ character, snapshot, zone }) => {
    me = { ...me, ...character };
    zoneData = zone;
    document.getElementById('zoneName').textContent = zone.display_name;
    updateCharPanel({ character: me });

    if (window.renderer && zone) {
      window.renderer.loadZone(zone);
    }

    // Populate zone entities
    renderZoneEntities(snapshot);
    addChat('System', `You have entered ${zone.display_name}.`, 'system');
  });

  socket.on('player:entered', (data) => {
    addChat('System', `${data.name} has entered the zone.`, 'system');
    if (window.renderer) window.renderer.spawnPlayer(data);
    refreshPlayersList();
  });

  socket.on('player:left', ({ socketId }) => {
    if (window.renderer) window.renderer.removePlayer(socketId);
    refreshPlayersList();
  });

  socket.on('player:moved', ({ socketId, x, y, z }) => {
    if (window.renderer) window.renderer.moveEntity(socketId, x, y, z, true);
  });

  socket.on('npc:spawned', (npc) => {
    if (window.renderer) window.renderer.spawnNpc(npc);
    refreshNpcList();
  });

  socket.on('npc:moved', ({ spawnId, x, y, z }) => {
    if (window.renderer) window.renderer.moveEntity(spawnId, x, y, z, false);
  });

  socket.on('combat:events', ({ events, spawnId, targetType, targetId }) => {
    events.forEach(evt => {
      switch (evt.type) {
        case 'melee_hit':
          addChat('Combat', `${evt.attacker} hits ${evt.defender} for ${evt.damage} damage.`, 'combat');
          if (window.renderer && spawnId) window.renderer.flashDamage(spawnId, false);
          updateTargetHp();
          break;
        case 'miss':
          addChat('Combat', `${evt.attacker} misses ${evt.defender}.`, 'combat');
          break;
        case 'spell_cast':
          addChat('Combat', `${evt.caster} casts ${evt.spell} on ${evt.target} for ${evt.value}.`, 'spell');
          if (evt.spell_type === 'heal') updateCharPanel({ character: me });
          break;
        case 'resist':
          addChat('Combat', `${evt.target} resists ${evt.spell}!`, 'combat');
          break;
        case 'out_of_mana':
          addChat('System', 'You are out of mana!', 'system');
          break;
      }
    });
  });

  socket.on('char:levelup', ({ level, hp_max, mana_max }) => {
    me.level = level; me.hp_max = hp_max; me.hp_current = hp_max;
    me.mana_max = mana_max; me.mana_current = mana_max;
    updateCharPanel({ character: me });
    document.getElementById('levelUpText').textContent = `You have reached level ${level}!`;
    document.getElementById('levelUpModal').classList.remove('hidden');
  });

  socket.on('char:stats_update', (update) => {
    Object.assign(me, update);
    updateCharPanel({ character: me });
  });

  socket.on('quest:started', ({ quest, objectives }) => {
    quests.push({ quest_name: quest.name, quest_description: quest.description, quest_id: quest.id, status: 'active' });
    renderQuests();
    addChat('Quest', `Quest accepted: ${quest.name}`, 'quest');
  });

  socket.on('quest:progress', ({ questId, objectiveId, current, required }) => {
    addChat('Quest', `Progress: ${current}/${required}`, 'quest');
  });

  socket.on('quest:completed', ({ quest, exp, gold, silver }) => {
    addChat('Quest', `Quest completed: ${quest.name}! Reward: ${exp} XP, ${gold}g ${silver}s`, 'quest');
    quests = quests.filter(q => q.quest_id !== quest.id);
    renderQuests();
  });

  socket.on('chat:message', ({ sender, message, channel, tell_target }) => {
    addChat(tell_target ? `${sender} -> you` : sender, message, channel);
  });

  socket.on('who:list', (players) => {
    const el = document.getElementById('whoList');
    if (!players.length) { el.innerHTML = '<p>No players online.</p>'; return; }
    el.innerHTML = `<table class="who-table">
      <tr><th>Name</th><th>Level</th><th>Race</th><th>Class</th></tr>
      ${players.map(p => `<tr><td>${p.name}</td><td>${p.level}</td><td>${p.race}</td><td>${p.class}</td></tr>`).join('')}
    </table>`;
    document.getElementById('onlineCount').textContent = `${players.length} online`;
    document.getElementById('whoModal').classList.remove('hidden');
  });

  socket.on('npc:aggro', ({ spawnId, target }) => {
    addChat('Combat', `${target} has been spotted!`, 'combat');
  });

  socket.on('npc:reset', ({ spawnId, x, y, z }) => {
    if (window.renderer) window.renderer.moveEntity(spawnId, x, y, z, false);
  });

  socket.on('char:damage_taken', ({ spawnId, hp_current, hp_max, events }) => {
    me.hp_current = hp_current;
    me.hp_max     = hp_max;
    updateCharPanel({ character: me });
    events.forEach(evt => {
      if (evt.type === 'melee_hit')  addChat('Combat', `${evt.attacker} hits YOU for ${evt.damage} damage!`, 'combat');
      if (evt.type === 'miss')       addChat('Combat', `${evt.attacker} misses you.`, 'combat');
    });
    if (window.renderer) window.renderer.flashDamage(socket.id, true);
    if (hp_current <= 0) addChat('System', 'You have been slain!', 'system');
  });

  socket.on('npc:dialogue', ({ spawnId, name, npc_type, dialogue }) => {
    showNpcDialogue(spawnId, name, npc_type, dialogue);
  });

  socket.on('merchant:inventory', ({ spawnId, items }) => {
    showMerchantItems(items);
  });

  socket.on('quest:available', ({ spawnId, quests: available }) => {
    showAvailableQuests(available);
  });

  socket.on('error', ({ msg }) => {
    addChat('System', msg, 'system');
  });
}

// ---- Input ----
function initInput() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
  });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });

  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  // Movement tick
  moveInterval = setInterval(sendMovement, 100);
}

let _pos = { x: 0, y: 0, z: 0, heading: 0 };
function sendMovement() {
  if (!socket || !me) return;
  let moved = false;
  const spd = MOVE_SPEED * 0.1;
  const h = _pos.heading;

  if (keys['KeyW'] || keys['ArrowUp']) {
    _pos.x -= Math.sin(h) * spd;
    _pos.y -= Math.cos(h) * spd;
    moved = true;
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    _pos.x += Math.sin(h) * spd;
    _pos.y += Math.cos(h) * spd;
    moved = true;
  }
  if (keys['KeyA'] || keys['ArrowLeft']) { _pos.heading -= 0.05; moved = true; }
  if (keys['KeyD'] || keys['ArrowRight']) { _pos.heading += 0.05; moved = true; }

  if (moved) {
    socket.emit('player:move', { x: _pos.x, y: _pos.y, z: _pos.z, heading: _pos.heading });
    if (window.renderer) {
      const mesh = window.renderer.playerMeshes.get(socket.id);
      if (mesh) {
        mesh.position.set(_pos.x, mesh.position.y, _pos.y);
        mesh.rotation.y = _pos.heading;
      }
    }
  }
}

// ---- UI ----
function initUI() {
  // Panel tabs
  document.querySelectorAll('.ptab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ptab-content').forEach(t => { t.classList.remove('active'); t.classList.add('hidden'); });
      btn.classList.add('active');
      const panel = document.getElementById(`ptab-${btn.dataset.ptab}`);
      panel.classList.remove('hidden'); panel.classList.add('active');
    });
  });

  // Chat tabs
  document.querySelectorAll('.ctab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isTell = btn.dataset.chan === 'tell';
      document.getElementById('tellTarget').classList.toggle('hidden', !isTell);
    });
  });

  document.getElementById('chatSendBtn').addEventListener('click', sendChat);
  document.getElementById('attackBtn').addEventListener('click', attackTarget);
  document.getElementById('talkBtn').addEventListener('click', talkTarget);
  document.getElementById('whoBtn').addEventListener('click', () => socket.emit('who'));
  document.getElementById('exitBtn').addEventListener('click', () => { if (confirm('Return to character select?')) window.location.href = '/charselect.html'; });
  document.getElementById('closeNpcModal').addEventListener('click', () => document.getElementById('npcDialogueModal').classList.add('hidden'));

  // Three.js renderer
  const canvas = document.getElementById('gameCanvas');
  if (typeof THREE !== 'undefined' && typeof WGRenderer !== 'undefined') {
    window.renderer = new WGRenderer(canvas);
    // Spawn local player placeholder
    if (me) {
      window.renderer.spawnPlayer({ socketId: 'local', race: me.race, class: me.class, x: me.pos_x || 0, y: me.pos_y || 0 });
      window.renderer.followPlayer('local');
    }
  }
}

// ---- Chat ----
function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg || !socket) return;
  const channel = document.querySelector('.ctab.active')?.dataset.chan || 'say';
  const tell_target = document.getElementById('tellTarget').value.trim() || undefined;
  socket.emit('chat:message', { channel, message: msg, tell_target });
  input.value = '';
}

function addChat(sender, message, channel) {
  const log = document.getElementById('chatLog');
  const div = document.createElement('div');
  div.className = `chat-line chat-${channel}`;
  div.innerHTML = `<span class="chat-sender">${sender}:</span> <span class="chat-msg">${escHtml(message)}</span>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  // Keep max 200 lines
  while (log.children.length > 200) log.removeChild(log.firstChild);
}

// ---- Target ----
function setTarget(spawnId, name, hpPct, isNpc = true) {
  targetSpawnId = spawnId;
  targetIsNpc = isNpc;
  document.getElementById('targetFrame').classList.remove('hidden');
  document.getElementById('targetName').textContent = name;
  document.getElementById('targetHpBar').style.width = `${hpPct}%`;
  document.getElementById('targetHpBar').className = `target-hp-bar hp-${hpPct < 25 ? 'low' : hpPct < 50 ? 'mid' : 'high'}`;
  document.getElementById('talkBtn').classList.toggle('hidden', !isNpc);
}

function updateTargetHp() { /* Updated via combat events */ }

function attackTarget() {
  if (targetSpawnId === null || !targetIsNpc) return;
  socket.emit('attack:melee', { spawnId: targetSpawnId });
}

function talkTarget() {
  if (targetSpawnId === null) return;
  socket.emit('npc:interact', { spawnId: targetSpawnId });
}

// ---- Zone entity rendering ----
function renderZoneEntities(snapshot) {
  const npcEl = document.getElementById('npcList');
  const playerEl = document.getElementById('playersList');
  npcEl.innerHTML = '';
  playerEl.innerHTML = '';

  (snapshot?.npcs || []).forEach(npc => {
    if (window.renderer) window.renderer.spawnNpc(npc);
    const row = document.createElement('div');
    row.className = `entity-row npc-row ${npc.is_aggro ? 'aggro' : ''}`;
    row.innerHTML = `<span class="entity-con ${conColor(npc.level, me?.level)}">●</span> ${npc.name} <span class="entity-lvl">(${npc.level})</span>`;
    row.addEventListener('click', () => setTarget(npc.spawnId, npc.name, npc.hp_pct, true));
    npcEl.appendChild(row);
  });

  (snapshot?.players || []).forEach(p => {
    if (p.socketId !== socket?.id) {
      if (window.renderer) window.renderer.spawnPlayer(p);
    }
    const row = document.createElement('div');
    row.className = 'entity-row player-row';
    row.textContent = `${p.name} (${p.level})`;
    playerEl.appendChild(row);
  });
}

function refreshPlayersList() {}
function refreshNpcList() {}

// CON system: color based on level difference
function conColor(npcLevel, myLevel) {
  const diff = npcLevel - (myLevel || 1);
  if (diff >= 4) return 'con-red';
  if (diff >= 2) return 'con-yellow';
  if (diff >= -1) return 'con-white';
  if (diff >= -3) return 'con-blue';
  return 'con-green';
}

// ---- Spellbook ----
function renderSpellbook() {
  const el = document.getElementById('spellbook');
  const gems = document.getElementById('spellGems');
  el.innerHTML = '';
  gems.innerHTML = '';

  const memorized = spellbook.filter(s => s.memorized);

  // Gem slots (8 max)
  for (let i = 0; i < 8; i++) {
    const mem = memorized.find(s => s.gem_slot === i);
    const gem = document.createElement('div');
    gem.className = `spell-gem ${mem ? 'gem-ready' : 'gem-empty'}`;
    gem.title = mem ? `${mem.name} (${mem.mana_cost} MP, ${mem.cast_time}s)` : 'Empty';
    gem.textContent = mem ? mem.name.slice(0, 2) : '-';
    if (mem) {
      gem.addEventListener('click', () => socket.emit('spell:cast', { spellId: mem.spell_id, targetType: mem.target_type === 'self' ? 'player' : 'npc', targetId: targetSpawnId }));
    }
    gems.appendChild(gem);
  }

  // Full spellbook list
  spellbook.forEach(s => {
    const row = document.createElement('div');
    row.className = 'spell-row';
    row.innerHTML = `
      <span class="spell-school school-${s.school}">${s.school.slice(0,3).toUpperCase()}</span>
      <span class="spell-name">${s.name}</span>
      <span class="spell-lvl">L${s.req_level}</span>
      <span class="spell-cost">${s.mana_cost}m</span>
      <button class="btn btn-xs" onclick="socket.emit('spell:cast',{spellId:${s.spell_id},targetType:'${s.target_type === 'self' ? 'player' : 'npc'}',targetId:targetSpawnId})">Cast</button>
    `;
    el.appendChild(row);
  });
}

// ---- Quests ----
function renderQuests() {
  const el = document.getElementById('questLog');
  if (!quests.length) { el.innerHTML = '<div class="empty-msg">No active quests.</div>'; return; }
  el.innerHTML = quests.map(q => `
    <div class="quest-entry">
      <div class="quest-name">${q.quest_name}</div>
      <div class="quest-desc">${q.quest_description || ''}</div>
    </div>
  `).join('');
}

// ---- Inventory ----
function renderInventory(inventory) {
  const el = document.getElementById('inventoryGrid');
  el.innerHTML = inventory.map(item => `
    <div class="inv-slot ${item.equipped ? 'equipped' : ''}" title="${item.name}\n${item.description || ''}">
      <div class="inv-icon">${item.name.slice(0, 2)}</div>
      <div class="inv-name">${item.name}</div>
    </div>
  `).join('') || '<div class="empty-msg">Empty.</div>';

  const currency = document.getElementById('currencyDisplay');
  currency.textContent = `${me?.platinum || 0}pp  ${me?.gold || 0}gp  ${me?.silver || 0}sp  ${me?.copper || 0}cp`;
}

// ---- Char panel ----
function updateCharPanel({ character }) {
  if (!character) return;
  document.getElementById('playerName').textContent = character.name;
  document.getElementById('playerTitle').textContent = `Level ${character.level} ${cap(character.race)} ${character.class}`;

  const hp = character.hp_current, hpMax = character.hp_max || 1;
  const mp = character.mana_current, mpMax = character.mana_max || 1;
  const ep = character.end_current || 100, epMax = character.end_max || 100;

  setBar('hpBar', 'hpVal', hp, hpMax);
  setBar('manaBar', 'manaVal', mp, mpMax);
  setBar('endBar', 'endVal', ep, epMax);

  const expPct = character.exp_to_next > 0 ? Math.round((character.experience / character.exp_to_next) * 100) : 0;
  document.getElementById('expBar').style.width = `${Math.min(100, expPct)}%`;
  document.getElementById('expLabel').textContent = `${character.experience || 0} / ${character.exp_to_next || '?'} XP`;

  if (mpMax === 0) document.getElementById('manaRow').classList.add('hidden');

  ['str','sta','agi','dex','int','wis','cha'].forEach(s => {
    const el = document.getElementById(`s_${s}`);
    if (el) el.textContent = character[s] || 75;
  });
}

function setBar(barId, valId, cur, max) {
  const pct = Math.max(0, Math.min(100, Math.round((cur / max) * 100)));
  document.getElementById(barId).style.width = `${pct}%`;
  document.getElementById(valId).textContent = `${cur}/${max}`;
}

// ---- NPC Dialogue ----
function showNpcDialogue(spawnId, name, npc_type, dialogue) {
  document.getElementById('npcDialogueName').textContent = name;
  document.getElementById('npcDialogueText').textContent = dialogue.greeting || '*no greeting*';
  document.getElementById('npcQuestList').classList.add('hidden');
  document.getElementById('merchantList').classList.add('hidden');

  const kwEl = document.getElementById('npcKeywords');
  kwEl.innerHTML = (dialogue.keywords || []).map(kw =>
    `<button class="kw-btn" data-response="${escHtml(kw.response)}">[${kw.keyword}]</button>`
  ).join('');

  kwEl.querySelectorAll('.kw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('npcDialogueText').textContent = btn.dataset.response;
    });
  });

  document.getElementById('npcDialogueModal').classList.remove('hidden');
}

function showMerchantItems(items) {
  const el = document.getElementById('merchantList');
  el.classList.remove('hidden');
  el.innerHTML = '<h4>Merchant Wares</h4>' + items.map(item => `
    <div class="merchant-item">
      <span class="merchant-item-name">${item.name}</span>
      <span class="merchant-item-price">${item.value_copper}cp</span>
    </div>
  `).join('');
}

function showAvailableQuests(available) {
  const el = document.getElementById('npcQuestList');
  if (!available.length) return;
  el.classList.remove('hidden');
  el.innerHTML = '<h4>Available Quests</h4>' + available.map(q => `
    <div class="quest-offer">
      <strong>${q.name}</strong><br>
      <small>${q.description}</small><br>
      <button class="btn btn-sm btn-primary" onclick="acceptQuest(${q.id})">Accept</button>
    </div>
  `).join('');
}

function acceptQuest(questId) {
  socket.emit('quest:accept', { questId });
  document.getElementById('npcDialogueModal').classList.add('hidden');
}

// ---- Helpers ----
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
