// Westgaurdia 3D Renderer
// Handles: zone GLB loading, collision resolution, lightmap wiring, entity meshes
//
// Coordinate mapping (game ↔ Three.js):
//   game (x, y, z)  →  Three.js (x, z, y)
//   - game X  = Three.js X  (east/west)
//   - game Y  = Three.js Z  (north/south — Three.js depth axis)
//   - game Z  = Three.js Y  (elevation — Three.js up axis)
//
// Collision meshes: any object in the GLB whose name starts with "col_"
//   → made invisible, added to collisionMeshes[]
//   → ground clamping: downward ray from above player snaps feet to terrain
//   → wall sliding: forward ray projects velocity onto surface normal
//
// Lightmaps: Blender bakes to UV2; GLTF loader reads occlusionTexture → aoMap (UV2).
//   After load we copy aoMap → lightMap on each material so baked lighting
//   illuminates the mesh. Dynamic entities (players/NPCs) use real-time lighting only.

(function () {
  if (typeof THREE === 'undefined') return;

  const {
    Scene, PerspectiveCamera, WebGLRenderer,
    AmbientLight, DirectionalLight, HemisphereLight,
    GridHelper, Group, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry,
    MeshLambertMaterial, MeshStandardMaterial,
    Color, Fog, Clock, Vector3, Raycaster,
  } = THREE;

  // How far above feet the wall ray is cast (avoids ground false-positives)
  const WALL_RAY_HEIGHT  = 1.0;
  // How far ahead to check for walls (units)
  const WALL_CHECK_DIST  = 0.6;
  // Player capsule radius for wall push-back
  const PLAYER_RADIUS    = 0.4;
  // Ground ray cast starts this far above the player's current Y
  const GROUND_RAY_UP    = 12;
  // Maximum step-up height (climbing small stairs / curbs)
  const MAX_STEP_UP      = 0.6;
  // If no collision mesh loaded, ground is at this Three.js Y
  const FALLBACK_GROUND_Y = 0;

  class WGRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.scene  = new Scene();
      this.clock  = new Clock();
      this.playerMeshes = new Map();  // socketId  → Object3D
      this.npcMeshes    = new Map();  // spawnId   → Object3D
      this._mixers      = new Map();  // entity key → AnimationMixer (for GLB chars)
      this.collisionMeshes = [];      // invisible col_* meshes for raycasting
      this._triggerMeshes  = [];      // debug wireframe boxes for zone triggers
      this.loadedZone = null;

      this._groundRaycaster = new Raycaster();
      this._wallRaycaster   = new Raycaster();

      this._initRenderer();
      this._initCamera();
      this._initLights();
      this._initFallbackGround();
      this._startLoop();
    }

    // ================================================================
    // Renderer + Camera
    // ================================================================

    _initRenderer() {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.shadowMap.enabled = true;
      this.renderer.outputEncoding = THREE.sRGBEncoding || 3001;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const w = this.canvas.clientWidth  || this.canvas.width;
      const h = this.canvas.clientHeight || this.canvas.height;
      this.renderer.setSize(w, h, false);
      if (this.camera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
    }

    _initCamera() {
      this.camera = new PerspectiveCamera(
        60, (this.canvas.clientWidth || 800) / (this.canvas.clientHeight || 600), 0.1, 2000
      );
      this.camera.position.set(0, 15, 30);
      this.camera.lookAt(0, 0, 0);

      this.camTarget  = new Vector3();
      this._camDist   = 22;   // distance from player
      this._camYaw    = 0;
      this._camPitch  = 0.35;
      this._isDragging = false;
      this._lastMX = 0; this._lastMY = 0;

      this.canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) { this._isDragging = true; this._lastMX = e.clientX; this._lastMY = e.clientY; e.preventDefault(); }
      });
      window.addEventListener('mouseup', () => { this._isDragging = false; });
      window.addEventListener('mousemove', (e) => {
        if (!this._isDragging) return;
        this._camYaw   -= (e.clientX - this._lastMX) * 0.005;
        this._camPitch  = Math.max(0.08, Math.min(1.3, this._camPitch - (e.clientY - this._lastMY) * 0.005));
        this._lastMX = e.clientX; this._lastMY = e.clientY;
      });
      this.canvas.addEventListener('wheel', (e) => {
        this._camDist = Math.max(4, Math.min(80, this._camDist + e.deltaY * 0.05));
        e.preventDefault();
      }, { passive: false });
      this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    // ================================================================
    // Lights
    // ================================================================

    _initLights() {
      // Hemisphere gives sky/ground colour split — overrides pure ambient for outdoor zones
      this._hemiLight = new HemisphereLight(0x9ab4d4, 0x4a5a38, 0.6);
      this.scene.add(this._hemiLight);

      this._sunLight = new DirectionalLight(0xfff5e0, 1.0);
      this._sunLight.position.set(200, 400, 100);
      this._sunLight.castShadow = true;
      this._sunLight.shadow.mapSize.width  = 2048;
      this._sunLight.shadow.mapSize.height = 2048;
      this._sunLight.shadow.camera.near = 1;
      this._sunLight.shadow.camera.far  = 1000;
      this._sunLight.shadow.camera.left = this._sunLight.shadow.camera.bottom = -200;
      this._sunLight.shadow.camera.right = this._sunLight.shadow.camera.top   =  200;
      this.scene.add(this._sunLight);
    }

    _applyZoneLighting(zoneData) {
      if (zoneData.sky === 'night' || zoneData.zone_type === 'dungeon') {
        // Dark zones: dim hemisphere, cool sun, small ambient
        this._hemiLight.intensity = 0.15;
        this._sunLight.intensity  = 0.1;
        this._sunLight.color.setHex(0x334466);
      } else {
        // Outdoor day
        this._hemiLight.intensity = 0.6;
        this._sunLight.intensity  = 1.0;
        this._sunLight.color.setHex(0xfff5e0);
      }
    }

    // ================================================================
    // Fallback ground (shown when no zone GLB exists)
    // ================================================================

    _initFallbackGround() {
      const geo = new BoxGeometry(600, 1, 600);
      const mat = new MeshLambertMaterial({ color: 0x4a7c35 });
      this.fallbackGround = new Mesh(geo, mat);
      this.fallbackGround.position.y = -0.5;
      this.fallbackGround.receiveShadow = true;
      this.scene.add(this.fallbackGround);

      const grid = new GridHelper(600, 60, 0x000000, 0x000000);
      grid.material.opacity = 0.08;
      grid.material.transparent = true;
      this.scene.add(grid);
    }

    // ================================================================
    // Zone loading — collision mesh extraction + lightmap wiring
    // ================================================================

    loadZone(zoneData) {
      this.loadedZone = zoneData;
      this.collisionMeshes = [];

      const fogColor = new Color(zoneData.fog_color || '#8ab4d0');
      this.scene.background = fogColor;
      this.scene.fog = new Fog(fogColor, 100, 500);
      this._applyZoneLighting(zoneData);

      if (this._zoneModel) {
        this.scene.remove(this._zoneModel);
        this._zoneModel = null;
      }

      if (typeof THREE.GLTFLoader === 'undefined') {
        this.fallbackGround.visible = true;
        return;
      }

      const loader = new THREE.GLTFLoader();
      loader.load(
        `/assets/zones/${zoneData.short_name}.glb`,
        (gltf) => {
          this._zoneModel = gltf.scene;
          this._zoneModel.traverse(obj => {
            if (!obj.isMesh) return;

            if (obj.name.startsWith('col_')) {
              // ---- Collision mesh ----
              obj.visible = false;
              // Ensure geometry has a BVH or standard index for fast raycasting
              obj.geometry.computeBoundingBox();
              obj.updateWorldMatrix(true, false);
              this.collisionMeshes.push(obj);
            } else {
              // ---- Visual mesh ----
              obj.castShadow    = true;
              obj.receiveShadow = true;
              this._wireUpLightmap(obj);
            }
          });

          this.scene.add(this._zoneModel);
          this.fallbackGround.visible = false;
          console.log(`[renderer] Zone ${zoneData.short_name} loaded. Collision meshes: ${this.collisionMeshes.length}`);
        },
        undefined,
        (err) => {
          console.warn(`[renderer] No GLB for zone "${zoneData.short_name}", using fallback ground.`);
          this.fallbackGround.visible = true;
        }
      );
    }

    // ================================================================
    // Lightmap wiring
    //
    // Blender bakes lighting to UV2 and stores it in the material's
    // occlusionTexture (aoMap) field, which the GLTF loader reads into
    // material.aoMap using the UV2 channel.
    //
    // We copy aoMap → lightMap so Three.js multiplies baked light onto
    // the albedo.  lightMapIntensity controls blend strength (0 = ignore
    // baked light entirely, 1 = full baked light).
    //
    // When a zone is fully baked:
    //   - set lightMapIntensity = 1, aoMapIntensity = 0
    //   - reduce hemiLight + sunLight intensities (lighting is already in texture)
    //
    // When a zone uses real-time lighting only (no baked lightmap in GLB):
    //   - aoMap will be null, nothing happens here — real-time lights take over
    // ================================================================

    _wireUpLightmap(meshObj) {
      const mat = meshObj.material;
      if (!mat) return;

      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach(m => {
        if (!m.isMeshStandardMaterial && !m.isMeshLambertMaterial) return;

        // If Blender baked an AO/lightmap into UV2, the GLTF loader gives us aoMap.
        // Copy it to lightMap so it influences final colour.
        if (m.aoMap && !m.lightMap) {
          m.lightMap = m.aoMap;
          m.lightMapIntensity = 1.0;
          m.aoMapIntensity    = 0.0;   // avoid double-darkening
        }

        // Ensure second UV set (uv2) is present — GLTF loader puts TEXCOORD_1 here.
        // Three.js r128 uses geometry.attributes.uv2 for lightMap/aoMap sampling.
        if (m.lightMap && !meshObj.geometry.attributes.uv2) {
          // Fallback: duplicate uv → uv2 so the texture at least appears
          const uv = meshObj.geometry.attributes.uv;
          if (uv) meshObj.geometry.setAttribute('uv2', uv.clone());
        }

        m.needsUpdate = true;
      });
    }

    // ================================================================
    // Zone trigger debug overlay (call from game.js if desired)
    // ================================================================

    showTriggers(triggers) {
      this._triggerMeshes.forEach(m => this.scene.remove(m));
      this._triggerMeshes = [];

      if (!triggers?.length) return;

      triggers.forEach(t => {
        const geo = new BoxGeometry(t.half_w * 2, t.half_h * 2, t.half_d * 2);
        const mat = new MeshLambertMaterial({
          color: t.trigger_type === 'dungeon_enter' ? 0xff8800 : 0x44aaff,
          wireframe: true,
          transparent: true,
          opacity: 0.4,
        });
        const mesh = new Mesh(geo, mat);
        // game (x, y, z) → Three.js (x, z, y)
        mesh.position.set(t.x, t.z, t.y);
        this.scene.add(mesh);
        this._triggerMeshes.push(mesh);
      });
    }

    // ================================================================
    // Collision resolution  (called from game.js movement loop)
    //
    // Input:  current game position  (gx, gy, gz)
    //         proposed movement delta (dgx, dgy)   — horizontal only
    // Output: { x, y, z } resolved game position
    //
    // Steps:
    //   1. Wall check — cast ray in movement direction; if hit, slide
    //   2. Ground clamp — cast ray downward; snap gz to terrain surface
    // ================================================================

    resolveMovement(gx, gy, gz, dgx, dgy) {
      // Convert game coords to Three.js coords
      // game: (x=east, y=north, z=up)  Three.js: (x=east, y=up, z=south)
      let tx = gx, ty = gz, tz = gy;
      const movLen = Math.sqrt(dgx * dgx + dgy * dgy);

      // ---- 1. Wall sliding ----
      if (movLen > 0.001 && this.collisionMeshes.length > 0) {
        const moveDir = new Vector3(dgx, 0, dgy).normalize();
        this._wallRaycaster.set(
          new Vector3(tx, ty + WALL_RAY_HEIGHT, tz),
          moveDir
        );
        this._wallRaycaster.far = movLen + PLAYER_RADIUS + 0.1;

        const wallHits = this._wallRaycaster.intersectObjects(this.collisionMeshes, false);
        if (wallHits.length > 0 && wallHits[0].distance < movLen + PLAYER_RADIUS) {
          const face   = wallHits[0].face;
          const normal = face ? wallHits[0].face.normal.clone() : new Vector3(0, 0, 0);
          // Transform normal to world space
          normal.transformDirection(wallHits[0].object.matrixWorld);
          normal.y = 0;
          if (normal.lengthSq() > 0.001) {
            normal.normalize();
            // Project movement onto the wall surface (slide)
            const dot = moveDir.dot(normal);
            const slide = moveDir.clone().sub(normal.clone().multiplyScalar(dot));
            tx += slide.x * movLen;
            tz += slide.z * movLen;
          }
          // else: degenerate normal → allow movement through (rare)
        } else {
          tx += dgx;
          tz += dgy;
        }
      } else {
        tx += dgx;
        tz += dgy;
      }

      // ---- 2. Ground clamping ----
      if (this.collisionMeshes.length > 0) {
        this._groundRaycaster.set(
          new Vector3(tx, ty + GROUND_RAY_UP, tz),
          new Vector3(0, -1, 0)
        );
        this._groundRaycaster.far = GROUND_RAY_UP + MAX_STEP_UP + 5;

        const groundHits = this._groundRaycaster.intersectObjects(this.collisionMeshes, false);
        if (groundHits.length > 0) {
          const groundY = groundHits[0].point.y;
          // Only snap down or step up (not fall through floors, not clip into ceilings)
          if (groundY >= ty - 2 && groundY <= ty + MAX_STEP_UP) {
            ty = groundY;
          }
        }
      } else {
        ty = FALLBACK_GROUND_Y;
      }

      // Convert Three.js back to game coords
      return { x: tx, y: tz, z: ty };
    }

    // ================================================================
    // Entity meshes (players / NPCs)
    // ================================================================

    // ----------------------------------------------------------------
    // Weeble character body colors by player class / NPC type
    // ----------------------------------------------------------------
    _entityColor(data, isPlayer) {
      if (isPlayer) {
        const cls = (data.class || '').toLowerCase();
        const palette = {
          war:'#7090b0', pal:'#c8b040', rng:'#507840', shd:'#503060',
          mnk:'#c06028', brd:'#a04880', rog:'#404040', bst:'#806030',
          clr:'#e8e8ff', dru:'#408850', shm:'#609060', wiz:'#3040a0',
          mag:'#8040c0', nec:'#205020', enc:'#a050c0',
        };
        return new Color(palette[cls] || '#4488ff');
      }
      const typeMap = {
        monster:'#c03030', named:'#c05020', guard:'#6080b0',
        merchant:'#40a040', quest_giver:'#c0a020', trainer:'#8040a0',
        banker:'#60a060',
      };
      return new Color(typeMap[data.npc_type] || '#cc4444');
    }

    // ----------------------------------------------------------------
    // Build the procedural weeble group
    // Layout (Three.js local Y = up):
    //   feet at y=0, body center y=0.55, head center y=1.4
    // ----------------------------------------------------------------
    _buildWeeble(bodyColor) {
      const skinColor = new Color('#f0c898');
      const group = new Group();

      // Body — egg-shaped sphere, slightly taller than wide
      const bodyMesh = new Mesh(
        new SphereGeometry(0.42, 12, 10),
        new MeshStandardMaterial({ color: bodyColor })
      );
      bodyMesh.scale.set(1, 1.3, 1);
      bodyMesh.position.y = 0.55;
      bodyMesh.castShadow = true;
      bodyMesh.name = 'body';
      group.add(bodyMesh);

      // Head
      const headMesh = new Mesh(
        new SphereGeometry(0.3, 10, 8),
        new MeshStandardMaterial({ color: skinColor })
      );
      headMesh.position.y = 1.4;
      headMesh.castShadow = true;
      headMesh.name = 'head';
      group.add(headMesh);

      // Eyes (two dark spheres facing +Z in local space)
      const eyeGeo = new SphereGeometry(0.055, 6, 6);
      const eyeMat = new MeshStandardMaterial({ color: 0x222222 });
      [[-0.12, 1.44, 0.26], [0.12, 1.44, 0.26]].forEach(([x, y, z], i) => {
        const eye = new Mesh(eyeGeo, eyeMat);
        eye.position.set(x, y, z);
        eye.name = i === 0 ? 'eyeL' : 'eyeR';
        group.add(eye);
      });

      // Arms — small squished spheres on the sides
      const armGeo = new SphereGeometry(0.14, 8, 6);
      [[-0.52, 0.70, 0.08], [0.52, 0.70, 0.08]].forEach(([x, y, z], i) => {
        const arm = new Mesh(armGeo, new MeshStandardMaterial({ color: bodyColor }));
        arm.scale.set(0.65, 0.85, 0.65);
        arm.position.set(x, y, z);
        arm.castShadow = true;
        arm.name = i === 0 ? 'armL' : 'armR';
        group.add(arm);
      });

      return group;
    }

    // ----------------------------------------------------------------
    // Per-frame procedural weeble animation
    // Called from render loop with the current frame delta (seconds)
    // ----------------------------------------------------------------
    _animateWeeble(entity, delta) {
      if (!entity.userData.isProceduralWeeble) return;

      entity.userData.animPhase = (entity.userData.animPhase || 0) + delta;
      const p   = entity.userData.animPhase;
      const off = entity.userData.phaseOffset || 0;
      const state = entity.userData.animState || 'idle';

      const body = entity.getObjectByName('body');
      const head = entity.getObjectByName('head');
      const armL = entity.getObjectByName('armL');
      const armR = entity.getObjectByName('armR');

      // Reset per-frame so transitions are clean
      entity.rotation.x = 0;
      entity.rotation.z = 0;
      if (body) body.scale.set(1, 1.3, 1);
      if (head) head.rotation.y = 0;
      if (armL) armL.position.y = 0.70;
      if (armR) armR.position.y = 0.70;

      switch (state) {
        case 'idle':
          entity.rotation.z = Math.sin(p * 1.5 + off) * 0.04;
          if (body) body.scale.y = 1.3 + Math.sin(p * 1.2 + off * 0.5) * 0.012;
          break;

        case 'walk':
          entity.rotation.z = Math.sin(p * 5 + off) * 0.15;
          if (body) body.scale.y = 1.3 - Math.abs(Math.sin(p * 10)) * 0.04;
          if (head) head.rotation.y = Math.sin(p * 5) * 0.08;
          if (armL) armL.position.y = 0.70 + Math.sin(p * 5) * 0.14;
          if (armR) armR.position.y = 0.70 - Math.sin(p * 5) * 0.14;
          break;

        case 'attack': {
          // Forward lunge arc over 0.5 s then auto-return to idle
          const t = Math.min(p / 0.5, 1);
          entity.rotation.x = Math.sin(t * Math.PI) * 0.42;
          entity.rotation.z = Math.sin(p * 1.5 + off) * 0.04;
          if (armL) armL.position.y = 0.70 + Math.sin(t * Math.PI) * 0.18;
          if (armR) armR.position.y = 0.70 + Math.sin(t * Math.PI) * 0.18;
          if (t >= 1) { entity.userData.animState = 'idle'; entity.userData.animPhase = 0; }
          break;
        }

        case 'hit': {
          // Rock backward over 0.35 s then return to idle
          const t = Math.min(p / 0.35, 1);
          entity.rotation.x = -Math.sin(t * Math.PI) * 0.5;
          if (t >= 1) { entity.userData.animState = 'idle'; entity.userData.animPhase = 0; }
          break;
        }

        case 'death': {
          // Tip over sideways — ease-out cubic, permanent
          const t = Math.min(p / 0.8, 1);
          entity.rotation.z = (Math.PI / 2) * (1 - Math.pow(1 - t, 3));
          break;
        }
      }
    }

    // ----------------------------------------------------------------
    // Play an animation state on an entity
    // state: 'idle' | 'walk' | 'attack' | 'hit' | 'death'
    // ----------------------------------------------------------------
    playAnim(id, isPlayer, state) {
      const map    = isPlayer ? this.playerMeshes : this.npcMeshes;
      const entity = map.get(id);
      if (!entity) return;

      if (entity.userData.isProceduralWeeble) {
        if (entity.userData.animState === state) return; // already in this state
        entity.userData.animState = state;
        entity.userData.animPhase = 0;
        return;
      }

      // GLB with AnimationMixer
      const mixer = this._mixers.get(id);
      if (!mixer || !entity.userData.clips) return;
      const clipName = { attack: 'attack1', hit: 'hit', walk: 'walk', idle: 'idle', death: 'death' }[state] || state;
      const clip = THREE.AnimationClip.findByName(entity.userData.clips, clipName);
      if (!clip) return;
      const action = mixer.clipAction(clip);
      mixer.stopAllAction();
      action.reset().play();
    }

    _makeEntityMesh(data, isPlayer) {
      const map = isPlayer ? this.playerMeshes : this.npcMeshes;
      const key = isPlayer ? data.socketId : data.spawnId;

      const bodyColor = this._entityColor(data, isPlayer);
      const group = this._buildWeeble(bodyColor);

      // game (x, y, z) → Three.js (x, z, y)
      group.position.set(data.x || 0, data.z || 0, data.y || 0);
      group.userData.isProceduralWeeble = true;
      group.userData.animState  = 'idle';
      group.userData.animPhase  = 0;
      group.userData.phaseOffset = Math.random() * Math.PI * 2; // desync NPCs

      this.scene.add(group);
      map.set(key, group);

      // Attempt to load a GLB override; procedural weeble stays until it arrives
      if (typeof THREE.GLTFLoader !== 'undefined') {
        const modelPath = isPlayer
          ? `/assets/characters/${(data.race || 'human').toLowerCase()}_${(data.class || 'war').toLowerCase()}.glb`
          : `/assets/npcs/${data.npcId || 'generic'}.glb`;

        const loader = new THREE.GLTFLoader();
        loader.load(modelPath, (gltf) => {
          const model = gltf.scene;
          model.position.copy(group.position);
          model.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
          this.scene.remove(group);
          this.scene.add(model);
          map.set(key, model);

          // Wire up AnimationMixer if the GLB has clips
          if (gltf.animations && gltf.animations.length) {
            const mixer = new THREE.AnimationMixer(model);
            model.userData.clips = gltf.animations;
            this._mixers.set(key, mixer);
            const idle = THREE.AnimationClip.findByName(gltf.animations, 'idle');
            if (idle) mixer.clipAction(idle).play();
          }
        });
      }

      return group;
    }

    spawnPlayer(data) {
      if (this.playerMeshes.has(data.socketId)) return;
      this._makeEntityMesh(data, true);
    }

    spawnNpc(data) {
      if (this.npcMeshes.has(data.spawnId)) return;
      this._makeEntityMesh(data, false);
    }

    removePlayer(socketId) {
      const m = this.playerMeshes.get(socketId);
      if (m) { this.scene.remove(m); this.playerMeshes.delete(socketId); this._mixers.delete(socketId); }
    }

    removeNpc(spawnId) {
      const m = this.npcMeshes.get(spawnId);
      if (m) { this.scene.remove(m); this.npcMeshes.delete(spawnId); this._mixers.delete(spawnId); }
    }

    // Move entity using game coordinates
    moveEntity(id, gx, gy, gz, isPlayer) {
      const map  = isPlayer ? this.playerMeshes : this.npcMeshes;
      const mesh = map.get(id);
      if (!mesh) return;
      // game (x, y, z) → Three.js (x, z, y)
      mesh.position.set(gx, gz ?? mesh.position.y, gy);
    }

    followPlayer(socketId) { this._followId = socketId; }

    flashDamage(id, isPlayer) {
      const map  = isPlayer ? this.playerMeshes : this.npcMeshes;
      const mesh = map.get(id);
      if (!mesh) return;
      mesh.traverse(obj => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          const orig = m.color?.clone();
          if (orig) {
            m.color.setHex(0xffffff);
            setTimeout(() => m.color.copy(orig), 150);
          }
        });
      });
    }

    // ================================================================
    // Render loop
    // ================================================================

    _startLoop() {
      const loop = () => {
        requestAnimationFrame(loop);
        const delta = this.clock.getDelta();

        // Tick GLB AnimationMixers
        this._mixers.forEach(mixer => mixer.update(delta));

        // Procedural weeble animations
        this.playerMeshes.forEach(e => this._animateWeeble(e, delta));
        this.npcMeshes.forEach(e => this._animateWeeble(e, delta));

        if (this._followId) {
          const mesh = this.playerMeshes.get(this._followId);
          if (mesh) {
            this.camTarget.lerp(mesh.position, 0.12);
            const d = this._camDist;
            const camX = this.camTarget.x + Math.sin(this._camYaw)   * Math.cos(this._camPitch) * d;
            const camY = this.camTarget.y + Math.sin(this._camPitch) * d;
            const camZ = this.camTarget.z + Math.cos(this._camYaw)   * Math.cos(this._camPitch) * d;
            this.camera.position.set(camX, camY, camZ);
            this.camera.lookAt(this.camTarget);
          }
        }

        this.renderer.render(this.scene, this.camera);
      };
      loop();
    }
  }

  window.WGRenderer = WGRenderer;
})();
