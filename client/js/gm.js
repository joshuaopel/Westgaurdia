// GM Spawn Editor — 2D overhead map tool
requireAuth();

// ---- State ----
let currentZone = null;
let allNpcs     = [];
let spawns      = [];    // loaded from server
let paths       = [];    // patrol paths
let selectedNpc = null;  // NPC template for placement
let activePath  = null;  // path being edited
let selected    = null;  // { type: 'spawn'|'waypoint', data }
let tool        = 'select'; // select | spawn | waypoint | path
let dirty       = false;

// Canvas / viewport
let canvas, ctx;
let cam = { x: 0, y: 0, zoom: 2 };  // world coords at canvas center
let _drag = null;

// Pending unsaved changes (new spawns, modified waypoints)
const pendingSpawns    = [];  // {npc_id, x, y, z, zone_id, respawn_time, ...}
const pendingWaypoints = {};  // pathId -> [{x,y,z,heading,wait_time}]
const deletedSpawns    = [];  // ids to delete on save

// ---- Init ----
(async function init() {
  canvas = document.getElementById('gmCanvas');
  ctx    = canvas.getContext('2d');

  const zones = await api.get('/api/world/zones');
  const zoneEl = document.getElementById('zoneSelect');
  zones.forEach(z => {
    const opt = document.createElement('option');
    opt.value = z.id; opt.textContent = `${z.display_name} (${z.short_name})`;
    zoneEl.appendChild(opt);
  });
  zoneEl.addEventListener('change', () => loadZone(parseInt(zoneEl.value)));

  allNpcs = await api.get('/api/gm/npcs');
  renderNpcPalette();

  if (zones.length) loadZone(zones[0].id);

  setupCanvas();
  setupToolbar();
  setupKeyboard();
  renderLoop();
})();

async function loadZone(zoneId) {
  currentZone = (await api.get(`/api/world/zones/${zoneId}`));
  spawns  = await api.get(`/api/gm/spawns?zone_id=${zoneId}`);
  paths   = await api.get(`/api/gm/paths?zone_id=${zoneId}`);
  selected = null;
  renderPathList();
  renderInspector(null);
  // Centre camera on safe point
  cam.x = currentZone.safe_x || 0;
  cam.y = currentZone.safe_y || 0;
}

// ---- Canvas setup ----
function setupCanvas() {
  const resize = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; };
  resize();
  window.addEventListener('resize', resize);

  // Pan with middle mouse or right drag
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup',   onMouseUp);
  canvas.addEventListener('wheel',     onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('click',      onCanvasClick);
}

function worldToCanvas(wx, wy) {
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  return {
    sx: cx + (wx - cam.x) * cam.zoom,
    sy: cy + (wy - cam.y) * cam.zoom,
  };
}

function canvasToWorld(sx, sy) {
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  return {
    wx: cam.x + (sx - cx) / cam.zoom,
    wy: cam.y + (sy - cy) / cam.zoom,
  };
}

function onMouseDown(e) {
  if (e.button === 1 || e.button === 2) {
    _drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    e.preventDefault();
  } else if (e.button === 0 && tool === 'select') {
    // start drag for spawn
    const w = canvasToWorld(e.offsetX, e.offsetY);
    const hit = hitTest(w.wx, w.wy);
    if (hit?.type === 'spawn') {
      _drag = { moveSpawn: hit.data, ox: hit.data.x - w.wx, oy: hit.data.y - w.wy };
    }
  }
}

function onMouseMove(e) {
  const w = canvasToWorld(e.offsetX, e.offsetY);
  document.getElementById('gmCoords').textContent = `x: ${w.wx.toFixed(1)}  y: ${w.wy.toFixed(1)}`;

  if (!_drag) return;
  if (_drag.moveSpawn) {
    _drag.moveSpawn.x = w.wx + _drag.ox;
    _drag.moveSpawn.y = w.wy + _drag.oy;
    dirty = true;
  } else {
    cam.x = _drag.cx - (e.clientX - _drag.sx) / cam.zoom;
    cam.y = _drag.cy - (e.clientY - _drag.sy) / cam.zoom;
  }
}

function onMouseUp(e) {
  if (_drag?.moveSpawn) {
    // commit position to server if it has an id
    const sp = _drag.moveSpawn;
    if (sp.id) {
      api.del; // just set dirty, save on Save button
      dirty = true;
    }
  }
  _drag = null;
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 0.87;
  cam.zoom = Math.max(0.3, Math.min(20, cam.zoom * factor));
}

function onCanvasClick(e) {
  if (_drag) return;
  const w = canvasToWorld(e.offsetX, e.offsetY);

  if (tool === 'select') {
    const hit = hitTest(w.wx, w.wy);
    selected = hit;
    renderInspector(hit);
    return;
  }

  if (tool === 'spawn') {
    if (!selectedNpc) { alert('Select an NPC from the palette first.'); return; }
    const sp = {
      _pending: true,
      npc_id: selectedNpc.id,
      npc_name: selectedNpc.name,
      npc_level: selectedNpc.level,
      npc_type:  selectedNpc.npc_type,
      is_aggro:  selectedNpc.is_aggro,
      aggro_range: selectedNpc.aggro_range,
      leash_range: selectedNpc.leash_range,
      zone_id: currentZone.id,
      x: w.wx, y: w.wy, z: 0,
      heading: 0,
      respawn_time: 300,
      wander: 0, wander_radius: 50,
      path_id: null, spawn_group: null, editor_note: null,
    };
    spawns.push(sp);
    pendingSpawns.push(sp);
    selected = { type: 'spawn', data: sp };
    renderInspector(selected);
    dirty = true;
    return;
  }

  if (tool === 'waypoint') {
    if (!activePath) { alert('Select a path from the path list first.'); return; }
    const wp = { x: w.wx, y: w.wy, z: 0, heading: 0, wait_time: 0, _pending: true };
    if (!pendingWaypoints[activePath.id]) pendingWaypoints[activePath.id] = [...(activePath.waypoints || [])];
    pendingWaypoints[activePath.id].push(wp);
    activePath._pendingWaypoints = pendingWaypoints[activePath.id];
    selected = { type: 'waypoint', data: wp, path: activePath };
    renderInspector(selected);
    dirty = true;
    return;
  }
}

// ---- Hit testing ----
function hitTest(wx, wy) {
  const R = 8 / cam.zoom;

  // Waypoints first (on top of spawns)
  for (const path of paths) {
    const wps = path._pendingWaypoints || path.waypoints || [];
    for (const wp of wps) {
      if (Math.abs(wp.x - wx) < R && Math.abs(wp.y - wy) < R) {
        return { type: 'waypoint', data: wp, path };
      }
    }
  }

  // Spawns
  for (const sp of spawns) {
    if (Math.abs(sp.x - wx) < R * 2 && Math.abs(sp.y - wy) < R * 2) {
      return { type: 'spawn', data: sp };
    }
  }

  return null;
}

// ---- Render loop ----
function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawPaths();
  drawSpawns();
  drawSelection();
}

function drawGrid() {
  const step = 50;
  ctx.strokeStyle = 'rgba(30,48,60,0.6)';
  ctx.lineWidth = 1;

  const { wx: x0, wy: y0 } = canvasToWorld(0, 0);
  const { wx: x1, wy: y1 } = canvasToWorld(canvas.width, canvas.height);

  const startX = Math.floor(x0 / step) * step;
  const startY = Math.floor(y0 / step) * step;

  for (let x = startX; x <= x1; x += step) {
    const { sx } = worldToCanvas(x, 0);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
  }
  for (let y = startY; y <= y1; y += step) {
    const { sy } = worldToCanvas(0, y);
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
  }

  // Origin crosshair
  const o = worldToCanvas(0, 0);
  ctx.strokeStyle = 'rgba(74,143,200,0.3)';
  ctx.beginPath(); ctx.moveTo(o.sx - 10, o.sy); ctx.lineTo(o.sx + 10, o.sy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(o.sx, o.sy - 10); ctx.lineTo(o.sx, o.sy + 10); ctx.stroke();
}

function drawPaths() {
  paths.forEach(path => {
    const wps = path._pendingWaypoints || path.waypoints || [];
    if (!wps.length) return;

    const isActive = activePath?.id === path.id;
    ctx.strokeStyle = isActive ? '#4a8fc8' : '#2a4a6a';
    ctx.lineWidth   = isActive ? 2 : 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();

    wps.forEach((wp, i) => {
      const { sx, sy } = worldToCanvas(wp.x, wp.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });

    // Close loop if loop type
    if (path.loop_type === 'loop' && wps.length > 1) {
      const { sx, sy } = worldToCanvas(wps[0].x, wps[0].y);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Waypoint dots
    wps.forEach((wp, i) => {
      const { sx, sy } = worldToCanvas(wp.x, wp.y);
      const isSelWp = selected?.type === 'waypoint' && selected.data === wp;
      ctx.beginPath();
      ctx.arc(sx, sy, isSelWp ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle   = isSelWp ? '#e8f0f8' : (isActive ? '#4a8fc8' : '#2a4a6a');
      ctx.strokeStyle = '#0a0c0e';
      ctx.lineWidth   = 1;
      ctx.fill(); ctx.stroke();

      // Step number
      ctx.fillStyle = '#c8d8e8';
      ctx.font      = `${Math.max(8, 10 * cam.zoom / 3)}px sans-serif`;
      ctx.fillText(i + 1, sx + 7, sy - 4);
    });
  });
}

function drawSpawns() {
  spawns.forEach(sp => {
    const { sx, sy } = worldToCanvas(sp.x, sp.y);
    const isSel = selected?.type === 'spawn' && selected.data === sp;
    const color = sp.is_aggro ? '#c83838' : '#38a858';

    // Aggro radius ring
    if (sp.aggro_range && cam.zoom > 1) {
      const r = sp.aggro_range * cam.zoom;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200,56,56,0.2)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // Leash radius ring
    if (sp.leash_range && isSel && cam.zoom > 0.5) {
      const r = sp.leash_range * cam.zoom;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(74,143,200,0.2)'; ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    // Body
    const size = isSel ? 10 : 7;
    ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2);
    ctx.fillStyle   = sp._pending ? color + '88' : color;
    ctx.strokeStyle = isSel ? '#ffffff' : '#0a0c0e';
    ctx.lineWidth   = isSel ? 2 : 1;
    ctx.fill(); ctx.stroke();

    // Label
    if (cam.zoom >= 1.5) {
      ctx.fillStyle = '#c8d8e8';
      ctx.font      = `${Math.max(9, 11 * cam.zoom / 3)}px sans-serif`;
      ctx.fillText(`${sp.npc_name} (${sp.npc_level})`, sx + 12, sy + 4);
    }

    // Heading arrow
    const ah = (sp.heading || 0);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.sin(ah) * 14, sy - Math.cos(ah) * 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function drawSelection() {
  if (!selected) return;
  if (selected.type === 'spawn') {
    const { sx, sy } = worldToCanvas(selected.data.x, selected.data.y);
    ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.stroke(); ctx.setLineDash([]);
  }
}

// ---- Toolbar ----
function setupToolbar() {
  ['select','spawn','waypoint','path'].forEach(t => {
    document.getElementById(`tool-${t}`).addEventListener('click', () => setTool(t));
  });
  document.getElementById('saveBtn').addEventListener('click', saveAll);
  document.getElementById('newPathBtn').addEventListener('click', () => document.getElementById('newPathModal').classList.remove('hidden'));
  document.getElementById('npcSearch').addEventListener('input', renderNpcPalette);
}

function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tool-${t}`).classList.add('active');
  if (t === 'path') { document.getElementById('newPathModal').classList.remove('hidden'); }
}

// ---- Keyboard ----
function setupKeyboard() {
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'v' || e.key === 'V') setTool('select');
    if (e.key === 's' || e.key === 'S') setTool('spawn');
    if (e.key === 'w' || e.key === 'W') setTool('waypoint');
    if (e.key === 'p' || e.key === 'P') setTool('path');
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'Escape') { selected = null; renderInspector(null); }
  });
}

function deleteSelected() {
  if (!selected) return;
  if (selected.type === 'spawn') {
    const sp = selected.data;
    const idx = spawns.indexOf(sp);
    if (idx >= 0) spawns.splice(idx, 1);
    if (sp.id) deletedSpawns.push(sp.id);
    const pi = pendingSpawns.indexOf(sp);
    if (pi >= 0) pendingSpawns.splice(pi, 1);
    dirty = true;
  } else if (selected.type === 'waypoint') {
    const path = selected.path;
    const wps = path._pendingWaypoints || [...(path.waypoints || [])];
    const idx = wps.indexOf(selected.data);
    if (idx >= 0) wps.splice(idx, 1);
    path._pendingWaypoints = wps;
    pendingWaypoints[path.id] = wps;
    dirty = true;
  }
  selected = null;
  renderInspector(null);
}

// ---- NPC Palette ----
function renderNpcPalette() {
  const search = document.getElementById('npcSearch').value.toLowerCase();
  const el = document.getElementById('npcPalette');
  const filtered = allNpcs.filter(n => n.name.toLowerCase().includes(search));
  el.innerHTML = filtered.map(n => `
    <div class="npc-entry ${selectedNpc?.id === n.id ? 'selected-npc' : ''}" data-id="${n.id}">
      <div class="npc-type-dot dot-${n.npc_type}"></div>
      <span>${n.name}</span>
      <span class="npc-lvl">L${n.level}</span>
    </div>
  `).join('');
  el.querySelectorAll('.npc-entry').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.id);
      selectedNpc = allNpcs.find(n => n.id === id) || null;
      renderNpcPalette();
      if (tool !== 'spawn') setTool('spawn');
    });
  });
}

// ---- Path List ----
function renderPathList() {
  const el = document.getElementById('pathList');
  el.innerHTML = paths.map(p => `
    <div class="path-entry ${activePath?.id === p.id ? 'active-path' : ''}" data-id="${p.id}">
      <span>${p.name} <small style="color:#4a5a6a">(${p.loop_type})</small></span>
      <button class="path-del" data-id="${p.id}" title="Delete path">&times;</button>
    </div>
  `).join('');
  el.querySelectorAll('.path-entry').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.classList.contains('path-del')) return;
      const id = parseInt(row.dataset.id);
      activePath = paths.find(p => p.id === id) || null;
      renderPathList();
      if (activePath) setTool('waypoint');
    });
  });
  el.querySelectorAll('.path-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      if (!confirm('Delete this patrol path and all its waypoints?')) return;
      await api.del(`/api/gm/paths/${id}`);
      paths = paths.filter(p => p.id !== id);
      if (activePath?.id === id) activePath = null;
      renderPathList();
    });
  });
}

// ---- Inspector ----
function renderInspector(sel) {
  const el = document.getElementById('inspectorContent');
  if (!sel) { el.innerHTML = '<p class="inspector-empty">Click a spawn or waypoint to inspect.</p>'; return; }

  if (sel.type === 'spawn') {
    const sp = sel.data;
    el.innerHTML = `
      <div class="inspector-section-title">Spawn Point</div>
      <div class="inspector-field"><label>NPC</label><input type="text" value="${sp.npc_name}" readonly></div>
      <div class="inspector-field"><label>Level</label><input type="number" value="${sp.npc_level}" readonly></div>
      <div class="inspector-field"><label>X</label><input type="number" id="sp_x" value="${sp.x.toFixed(1)}" step="0.5"></div>
      <div class="inspector-field"><label>Y</label><input type="number" id="sp_y" value="${sp.y.toFixed(1)}" step="0.5"></div>
      <div class="inspector-field"><label>Z</label><input type="number" id="sp_z" value="${sp.z}" step="0.5"></div>
      <div class="inspector-field"><label>Heading (rad)</label><input type="number" id="sp_heading" value="${(sp.heading||0).toFixed(2)}" step="0.1" min="0" max="6.28"></div>
      <div class="inspector-field"><label>Respawn Time (sec)</label><input type="number" id="sp_respawn" value="${sp.respawn_time||300}" min="10"></div>
      <div class="inspector-section-title">Movement</div>
      <div class="inspector-field"><label>Wander</label>
        <select id="sp_wander"><option value="0" ${!sp.wander?'selected':''}>No</option><option value="1" ${sp.wander?'selected':''}>Yes</option></select>
      </div>
      <div class="inspector-field"><label>Wander Radius</label><input type="number" id="sp_wrad" value="${sp.wander_radius||50}" min="0"></div>
      <div class="inspector-field"><label>Patrol Path</label>
        <select id="sp_path">
          <option value="">None</option>
          ${paths.map(p => `<option value="${p.id}" ${sp.path_id==p.id?'selected':''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="inspector-section-title">Aggro</div>
      <div class="inspector-field"><label>Aggro Range Override</label><input type="number" id="sp_aggro" value="${sp.aggro_range_override||''}" placeholder="(use NPC default)"></div>
      <div class="inspector-field"><label>Leash Range Override</label><input type="number" id="sp_leash" value="${sp.leash_range_override||''}" placeholder="(use NPC default)"></div>
      <div class="inspector-section-title">Meta</div>
      <div class="inspector-field"><label>Spawn Group</label><input type="text" id="sp_group" value="${sp.spawn_group||''}"></div>
      <div class="inspector-field"><label>Editor Note</label><input type="text" id="sp_note" value="${sp.editor_note||''}"></div>
      <div class="inspector-actions">
        <button class="btn btn-sm btn-primary" onclick="applySpawnChanges()">Apply</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSelected()">Delete Spawn</button>
      </div>
    `;
  } else if (sel.type === 'waypoint') {
    const wp = sel.data;
    el.innerHTML = `
      <div class="inspector-section-title">Waypoint — ${sel.path.name}</div>
      <div class="inspector-field"><label>X</label><input type="number" id="wp_x" value="${wp.x.toFixed(1)}" step="0.5"></div>
      <div class="inspector-field"><label>Y</label><input type="number" id="wp_y" value="${wp.y.toFixed(1)}" step="0.5"></div>
      <div class="inspector-field"><label>Z</label><input type="number" id="wp_z" value="${wp.z||0}" step="0.5"></div>
      <div class="inspector-field"><label>Heading (rad)</label><input type="number" id="wp_heading" value="${(wp.heading||0).toFixed(2)}" step="0.1" min="0" max="6.28"></div>
      <div class="inspector-field"><label>Pause (sec)</label><input type="number" id="wp_wait" value="${wp.wait_time||0}" min="0" step="0.5"></div>
      <div class="inspector-actions">
        <button class="btn btn-sm btn-primary" onclick="applyWaypointChanges()">Apply</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSelected()">Delete Waypoint</button>
      </div>
    `;
  }
}

function applySpawnChanges() {
  if (!selected || selected.type !== 'spawn') return;
  const sp = selected.data;
  sp.x            = parseFloat(document.getElementById('sp_x').value);
  sp.y            = parseFloat(document.getElementById('sp_y').value);
  sp.z            = parseFloat(document.getElementById('sp_z').value);
  sp.heading      = parseFloat(document.getElementById('sp_heading').value);
  sp.respawn_time = parseInt(document.getElementById('sp_respawn').value);
  sp.wander       = parseInt(document.getElementById('sp_wander').value);
  sp.wander_radius= parseInt(document.getElementById('sp_wrad').value);
  sp.path_id      = parseInt(document.getElementById('sp_path').value) || null;
  sp.aggro_range_override = parseInt(document.getElementById('sp_aggro').value) || null;
  sp.leash_range_override = parseInt(document.getElementById('sp_leash').value) || null;
  sp.spawn_group  = document.getElementById('sp_group').value || null;
  sp.editor_note  = document.getElementById('sp_note').value || null;
  dirty = true;
}

function applyWaypointChanges() {
  if (!selected || selected.type !== 'waypoint') return;
  const wp = selected.data;
  wp.x         = parseFloat(document.getElementById('wp_x').value);
  wp.y         = parseFloat(document.getElementById('wp_y').value);
  wp.z         = parseFloat(document.getElementById('wp_z').value);
  wp.heading   = parseFloat(document.getElementById('wp_heading').value);
  wp.wait_time = parseFloat(document.getElementById('wp_wait').value);
  dirty = true;
}

// ---- Save ----
async function saveAll() {
  // 1. Delete removed spawns
  for (const id of deletedSpawns) {
    await api.del(`/api/gm/spawns/${id}`);
  }
  deletedSpawns.length = 0;

  // 2. Create new spawns
  for (const sp of pendingSpawns) {
    const result = await api.post('/api/gm/spawns', {
      npc_id: sp.npc_id, zone_id: sp.zone_id,
      x: sp.x, y: sp.y, z: sp.z, heading: sp.heading,
      respawn_time: sp.respawn_time, wander: sp.wander, wander_radius: sp.wander_radius,
      path_id: sp.path_id, aggro_range_override: sp.aggro_range_override,
      leash_range_override: sp.leash_range_override, spawn_group: sp.spawn_group, editor_note: sp.editor_note,
    });
    if (!result.error) { sp.id = result.id; sp._pending = false; }
  }
  pendingSpawns.length = 0;

  // 3. Update modified existing spawns
  for (const sp of spawns) {
    if (sp.id && !sp._pending) {
      await api._fetch('PATCH', `/api/gm/spawns/${sp.id}`, {
        x: sp.x, y: sp.y, z: sp.z, heading: sp.heading,
        respawn_time: sp.respawn_time, wander: sp.wander, wander_radius: sp.wander_radius,
        path_id: sp.path_id, aggro_range_override: sp.aggro_range_override,
        leash_range_override: sp.leash_range_override, spawn_group: sp.spawn_group, editor_note: sp.editor_note,
      });
    }
  }

  // 4. Save modified patrol waypoints
  for (const [pathId, wps] of Object.entries(pendingWaypoints)) {
    await api._fetch('PUT', `/api/gm/paths/${pathId}/waypoints`, { waypoints: wps });
    const path = paths.find(p => p.id === parseInt(pathId));
    if (path) { path.waypoints = wps; path._pendingWaypoints = null; }
  }
  for (const k in pendingWaypoints) delete pendingWaypoints[k];

  dirty = false;
  // Reload fresh
  await loadZone(currentZone.id);
}

// ---- Create Path Modal ----
async function createPath() {
  const name = document.getElementById('newPathName').value.trim();
  if (!name) return;
  const loop_type = document.getElementById('newPathLoop').value;
  const result = await api.post('/api/gm/paths', { name, zone_id: currentZone.id, loop_type, waypoints: [] });
  if (result.error) { alert(result.error); return; }
  paths.push(result);
  activePath = result;
  renderPathList();
  setTool('waypoint');
  closeNewPathModal();
}

function closeNewPathModal() {
  document.getElementById('newPathModal').classList.add('hidden');
  document.getElementById('newPathName').value = '';
}

// Warn on unsaved leave
window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});
