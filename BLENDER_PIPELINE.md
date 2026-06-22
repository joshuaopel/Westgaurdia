# Westgaurdia — Blender Asset Pipeline

## Overview

Westgaurdia uses **Blender** for creating all 3D content:
- Zone/map geometry
- Character models (races + classes)
- NPC models
- Items & props

All assets are exported as **GLTF 2.0 (.glb)** and loaded at runtime via Three.js `GLTFLoader`.

---

## Export Settings (Blender → GLTF)

**File → Export → glTF 2.0**

| Setting | Value |
|---|---|
| Format | glTF Binary (.glb) |
| Apply Modifiers | ✓ |
| UVs | ✓ |
| Normals | ✓ |
| Vertex Colors | ✓ |
| Materials | ✓ (PBR) |
| Draco Compression | Optional (reduces file size) |
| Animations | ✓ (for characters/NPCs) |

---

## Zone Maps

### File Naming
```
client/assets/zones/<zone_short_name>.glb
```

### Examples
```
client/assets/zones/qeynos_hills.glb
client/assets/zones/blackburrow.glb
client/assets/zones/everfrost.glb
```

### Zone short names (match database `zones.short_name`):
- `qeynos_hills` — rolling outdoor hills
- `qeynos` — city zone
- `blackburrow` — gnoll dungeon
- `everfrost` — frozen tundra
- `befallen` — undead crypt
- `highpass` — mountain pass
- `lavastorm` — volcanic mountains
- `solb` — Solusek's Eye dungeon

### Zone Blender Setup
1. Model on a **Y-forward, Z-up** axis
2. Scale: **1 Blender unit = 1 game unit**
3. Place player spawn at world origin (0,0,0)
4. Name collision mesh objects with prefix `col_` (e.g. `col_ground`, `col_wall`)
5. Add an **Empty** named `safe_point` at the zone's safe spawn location
6. Zone bounds: typically 500×500 units for outdoor, smaller for dungeons

### Lighting
- Export baked lightmaps into textures for static objects
- Dynamic lights (campfires, torches) use scene lights in Blender

---

## Character Models — Weeble Style

Characters use a deliberately simple, chunky "weeble wobble" aesthetic.
The engine procedurally generates a weeble from code (so the game works
without any art), and replaces it with your GLB the moment it loads.
Lean into the style — keep it fun, not realistic.

### File Naming
```
client/assets/characters/<race>_<class>.glb
client/assets/npcs/<npc_type_or_id>.glb
```

### Examples
```
client/assets/characters/human_war.glb
client/assets/characters/darkelf_nec.glb
client/assets/npcs/gnoll.glb
client/assets/npcs/human_guard.glb
client/assets/npcs/generic.glb     ← fallback for unknown NPCs
```

### Races
`human`, `barbarian`, `erudite`, `woodelf`, `highelf`, `darkelf`,
`halfelf`, `halfling`, `gnome`, `dwarf`, `troll`, `ogre`, `iksar`

### Classes (lowercase)
`war`, `pal`, `rng`, `shd`, `mnk`, `brd`, `rog`, `bst`,
`clr`, `dru`, `shm`, `wiz`, `mag`, `nec`, `enc`

---

### Weeble Mesh Proportions

Build the character as a **single skinned mesh** over a minimal rig.
Reference dimensions (1 unit = 1 game unit, feet at origin):

| Part | Shape | Scale | Center Y |
|---|---|---|---|
| Body | Sphere (r=0.42) | (1, 1.3, 1) — taller than wide | 0.55 |
| Head | Sphere (r=0.30) | (1, 1, 1) | 1.40 |
| Arm L/R | Sphere (r=0.14) | (0.65, 0.85, 0.65) | 0.70 |
| Eyes | Sphere (r=0.05) | — | 1.44 |

Total height ≈ 1.7 units. No legs — the rounded belly is the bottom.

Keep poly count low: 500–1000 tris per character is plenty.

---

### Minimal Rig — 5 Bones

The rig intentionally has only 5 bones. Keep it this simple.

```
Root          (at ground, y=0)
└── Body      (body sphere pivot, y=0.55)
    ├── Head  (head sphere pivot, y=1.40)
    ├── ArmL  (left arm pivot, x=-0.52, y=0.70)
    └── ArmR  (right arm pivot, x= 0.52, y=0.70)
```

Bone naming — use **exactly** these names (case-sensitive):

| Bone | Purpose |
|---|---|
| `Root` | Root motion / world translation |
| `Body` | Whole-body wobble & squash-stretch |
| `Head` | Head turn / nod |
| `ArmL` | Left arm flap |
| `ArmR` | Right arm flap |

---

### Required Animations (NLA Editor)

Export each action as a named NLA track. The engine looks these up by
exact name:

| Clip name | Duration | Description |
|---|---|---|
| `idle` | 2–3 s, looping | Gentle side-to-side sway on Body bone |
| `walk` | 0.6 s, looping | Bigger body wobble; ArmL/ArmR alternate up-down |
| `attack1` | 0.5 s, once | Body lunges forward then rocks back |
| `hit` | 0.35 s, once | Body reels backward then recovers |
| `death` | 0.8 s, hold last frame | Body tips over sideways (Z rotation to 90°) |
| `cast` | 1.2 s, once | Head tilts up; both arms raise briefly |

If a clip is missing the engine falls back to its built-in procedural
version of that animation, so you can ship them incrementally.

---

### Blender NLA Export Checklist

1. Rig in **Pose Mode** — zero pose = T-pose (arms straight out)
2. Each animation is a separate **NLA action** with the exact clip name
3. **Apply rest pose as armature bind pose** before export
4. Export settings:
   - ✓ Armature / Skinning
   - ✓ Shape Keys (if used for facial morph)
   - ✓ All NLA actions → exported as separate clips
   - Animation mode: **NLA Tracks**

---

## NPC Models

NPC models use the same weeble style and 5-bone rig as characters.
The renderer tries `<npc_id>.glb` first, then `generic.glb` as the fallback.
A procedural coloured weeble shows until the GLB loads — colour varies by NPC type
(monster=red, guard=blue, merchant=green, quest_giver=gold, trainer=purple).

Same clip names as characters: `idle`, `walk`, `attack1`, `hit`, `death`, `cast`.
Non-combat NPCs only need `idle` — the rest are optional.

---

## Item Models (Optional)

For dropped item pickups or 3D inventory display:
```
client/assets/items/<item_name_slugified>.glb
```

---

## Coordinate System

Blender and Three.js use different coordinate systems:

| | Blender | Three.js |
|---|---|---|
| Right | +X | +X |
| Up | +Z | +Y |
| Forward | +Y | -Z |

The GLTF exporter handles this conversion automatically when using **Y-forward, Z-up** in Blender. Game positions (x,y,z) in the database map to Three.js (x, z, y) — the renderer handles this.

---

## Texture Guidelines

- **Format**: PNG (with transparency where needed) or JPEG for opaque surfaces
- **Resolution**: Power-of-2 dimensions (512×512, 1024×1024, 2048×2048)
- **PBR Workflow**: Metallic/Roughness preferred
  - `*_albedo.png` — base color
  - `*_normal.png` — normal map
  - `*_metalrough.png` — metallic (R) + roughness (G) packed
  - `*_emissive.png` — self-illumination (glowing effects)

---

## Blender Add-ons Recommended

- **GLTF 2.0 Exporter** (built-in, enable in Preferences → Add-ons)
- **Rigify** for character rigging
- **UV Packmaster** or **UVSquares** for UV layout
- **Batch Export** for exporting multiple objects

---

## Quick Start: First Zone

1. Open Blender, set units to **metric, 1m scale**
2. Model `qeynos_hills.blend`:
   - Ground plane (500×500 units, subdivided terrain)
   - Some trees, rocks, bushes as separate objects
   - Apply all transforms (Ctrl+A → All Transforms)
3. File → Export → glTF 2.0
   - Select all objects
   - Output: `client/assets/zones/qeynos_hills.glb`
4. Start the server (`npm start`) and enter the zone — your model loads automatically

---

## Testing Your Assets

```bash
# Start the dev server
npm run dev

# Open the game in browser
http://localhost:3000

# Login, create a character, and enter the world
# If your GLB loads correctly, you'll see it in the game canvas
# Check the browser console for GLTF loading errors
```

The renderer falls back to a flat green ground plane if no zone GLB is found, so the game always works even without 3D assets.
