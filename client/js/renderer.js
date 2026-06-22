// Three.js 3D renderer for Westgaurdia
// Loads Blender-exported GLTF/GLB zone maps and character models

(function () {
  if (typeof THREE === 'undefined') return;

  const { Scene, PerspectiveCamera, WebGLRenderer, AmbientLight, DirectionalLight,
    GridHelper, Mesh, BoxGeometry, MeshLambertMaterial, MeshStandardMaterial,
    Color, Fog, Clock, Vector3 } = THREE;

  class WGRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.scene = new Scene();
      this.clock = new Clock();
      this.entities = new Map(); // id -> { mesh, label, data }
      this.playerMeshes = new Map();
      this.npcMeshes = new Map();
      this.loadedZone = null;
      this._initRenderer();
      this._initCamera();
      this._initLights();
      this._initFallbackGround();
      this._startLoop();
    }

    _initRenderer() {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.shadowMap.enabled = true;
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      if (this.camera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
    }

    _initCamera() {
      this.camera = new PerspectiveCamera(60, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 2000);
      this.camera.position.set(0, 15, 30);
      this.camera.lookAt(0, 0, 0);

      // Camera target for follow
      this.camTarget = new Vector3();
      this.camOffset = new Vector3(0, 15, 25);
      this._setupMouseLook();
    }

    _setupMouseLook() {
      this._camYaw = 0;
      this._camPitch = 0.3;
      this._isDragging = false;
      this._lastMX = 0;
      this._lastMY = 0;

      this.canvas.addEventListener('mousedown', (e) => { if (e.button === 2) { this._isDragging = true; this._lastMX = e.clientX; this._lastMY = e.clientY; e.preventDefault(); } });
      window.addEventListener('mouseup', () => this._isDragging = false);
      window.addEventListener('mousemove', (e) => {
        if (!this._isDragging) return;
        this._camYaw -= (e.clientX - this._lastMX) * 0.005;
        this._camPitch = Math.max(0.1, Math.min(1.2, this._camPitch - (e.clientY - this._lastMY) * 0.005));
        this._lastMX = e.clientX; this._lastMY = e.clientY;
      });

      this.canvas.addEventListener('wheel', (e) => {
        this.camOffset.setLength(Math.max(5, Math.min(80, this.camOffset.length() + e.deltaY * 0.05)));
        e.preventDefault();
      }, { passive: false });

      this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    _initLights() {
      const ambient = new AmbientLight(0x8899aa, 0.8);
      this.scene.add(ambient);

      this.sunLight = new DirectionalLight(0xfff5e0, 1.2);
      this.sunLight.position.set(100, 200, 100);
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.width = 2048;
      this.sunLight.shadow.mapSize.height = 2048;
      this.scene.add(this.sunLight);
    }

    _initFallbackGround() {
      // Shown when no zone GLB is loaded
      const geo = new BoxGeometry(500, 1, 500);
      const mat = new MeshLambertMaterial({ color: 0x4a7c35 });
      this.fallbackGround = new Mesh(geo, mat);
      this.fallbackGround.position.y = -0.5;
      this.fallbackGround.receiveShadow = true;
      this.scene.add(this.fallbackGround);

      const grid = new GridHelper(500, 50, 0x000000, 0x000000);
      grid.material.opacity = 0.08;
      grid.material.transparent = true;
      this.scene.add(grid);
    }

    // ---- Zone loading ----

    loadZone(zoneData) {
      this.loadedZone = zoneData;
      const fogColor = new Color(zoneData.fog_color || '#8ab4d0');
      this.scene.background = fogColor;
      this.scene.fog = new Fog(fogColor, 80, 400);
      this.sunLight.color.setHex(zoneData.sky === 'night' ? 0x334466 : 0xfff5e0);

      const zonePath = `/assets/zones/${zoneData.short_name}.glb`;

      if (typeof THREE.GLTFLoader !== 'undefined') {
        const loader = new THREE.GLTFLoader();
        loader.load(
          zonePath,
          (gltf) => {
            if (this._zoneModel) this.scene.remove(this._zoneModel);
            this._zoneModel = gltf.scene;
            this._zoneModel.traverse(obj => {
              if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
            });
            this.scene.add(this._zoneModel);
            this.fallbackGround.visible = false;
          },
          undefined,
          () => {
            // GLB not found - use fallback ground
            this.fallbackGround.visible = true;
          }
        );
      }
    }

    // ---- Player / NPC meshes ----

    _makeEntityMesh(data, isPlayer) {
      const modelPath = isPlayer
        ? `/assets/characters/${data.race}_${data.class?.toLowerCase()}.glb`
        : `/assets/npcs/${data.npcId || 'generic'}.glb`;

      // Placeholder capsule mesh until GLB loads
      const body = new Mesh(
        new BoxGeometry(1, 2, 1),
        new MeshStandardMaterial({ color: isPlayer ? 0x4488ff : 0xff4444 })
      );
      body.position.set(data.x || 0, 1, data.y || 0);
      body.castShadow = true;
      this.scene.add(body);

      if (typeof THREE.GLTFLoader !== 'undefined') {
        const loader = new THREE.GLTFLoader();
        loader.load(modelPath, (gltf) => {
          this.scene.remove(body);
          const model = gltf.scene;
          model.position.copy(body.position);
          model.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; } });
          this.scene.add(model);
          (isPlayer ? this.playerMeshes : this.npcMeshes).set(data.socketId || data.spawnId, model);
        }, undefined, () => {
          (isPlayer ? this.playerMeshes : this.npcMeshes).set(data.socketId || data.spawnId, body);
        });
      } else {
        (isPlayer ? this.playerMeshes : this.npcMeshes).set(data.socketId || data.spawnId, body);
      }

      return body;
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
      const mesh = this.playerMeshes.get(socketId);
      if (mesh) { this.scene.remove(mesh); this.playerMeshes.delete(socketId); }
    }

    removeNpc(spawnId) {
      const mesh = this.npcMeshes.get(spawnId);
      if (mesh) { this.scene.remove(mesh); this.npcMeshes.delete(spawnId); }
    }

    moveEntity(id, x, y, z, isPlayer) {
      const map = isPlayer ? this.playerMeshes : this.npcMeshes;
      const mesh = map.get(id);
      if (mesh) { mesh.position.set(x, mesh.position.y, y); }
    }

    setPlayerMesh(socketId) {
      return this.playerMeshes.get(socketId);
    }

    followPlayer(socketId) {
      this._followId = socketId;
    }

    // ---- Render loop ----

    _startLoop() {
      const loop = () => {
        requestAnimationFrame(loop);
        const dt = this.clock.getDelta();

        // Camera follow
        if (this._followId) {
          const mesh = this.playerMeshes.get(this._followId);
          if (mesh) {
            this.camTarget.lerp(mesh.position, 0.1);
            const dist = this.camOffset.length();
            const camX = this.camTarget.x + Math.sin(this._camYaw) * Math.cos(this._camPitch) * dist;
            const camY = this.camTarget.y + Math.sin(this._camPitch) * dist;
            const camZ = this.camTarget.z + Math.cos(this._camYaw) * Math.cos(this._camPitch) * dist;
            this.camera.position.set(camX, camY, camZ);
            this.camera.lookAt(this.camTarget);
          }
        }

        this.renderer.render(this.scene, this.camera);
      };
      loop();
    }

    // ---- Hit flash on damage ----
    flashDamage(id, isPlayer) {
      const map = isPlayer ? this.playerMeshes : this.npcMeshes;
      const mesh = map.get(id);
      if (!mesh) return;
      mesh.traverse(obj => {
        if (obj.isMesh) {
          const orig = obj.material.color.clone();
          obj.material.color.setHex(0xffffff);
          setTimeout(() => obj.material.color.copy(orig), 150);
        }
      });
    }
  }

  window.WGRenderer = WGRenderer;
})();
