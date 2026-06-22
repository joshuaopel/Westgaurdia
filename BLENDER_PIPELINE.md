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

## Character Models

### File Naming
```
client/assets/characters/<race>_<class>.glb
```

### Examples
```
client/assets/characters/human_war.glb
client/assets/characters/darkelf_nec.glb
client/assets/characters/halfling_rog.glb
```

### Races
`human`, `barbarian`, `erudite`, `woodelf`, `highelf`, `darkelf`, `halfelf`, `halfling`, `gnome`, `dwarf`, `troll`, `ogre`, `iksar`

### Classes (lowercase)
`war`, `pal`, `rng`, `shd`, `mnk`, `brd`, `rog`, `bst`, `clr`, `dru`, `shm`, `wiz`, `mag`, `nec`, `enc`

### Character Rig Requirements
- Use a **Humanoid rig** compatible with Three.js animation
- Bone naming convention (mixamo-compatible or custom):
  - `Hips`, `Spine`, `Chest`, `Neck`, `Head`
  - `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`
  - `RightShoulder`, `RightArm`, `RightForeArm`, `RightHand`
  - `LeftUpLeg`, `LeftLeg`, `LeftFoot`
  - `RightUpLeg`, `RightLeg`, `RightFoot`

### Required Animations (NLA Editor)
| Animation | Description |
|---|---|
| `idle` | Standing still |
| `walk` | Walking forward |
| `run` | Running forward |
| `attack1` | Primary melee swing |
| `attack2` | Secondary melee swing |
| `cast` | Spell casting gesture |
| `hit` | Taking damage reaction |
| `death` | Dying |
| `loot` | Bending to loot |

---

## NPC Models

### File Naming
```
client/assets/npcs/<npc_id>.glb
client/assets/npcs/<npc_type_name>.glb
```

### Examples
```
client/assets/npcs/gnoll.glb
client/assets/npcs/human_guard.glb
client/assets/npcs/generic.glb    ← fallback placeholder
```

The renderer will first try `<npc_id>.glb`, then fall back to a type-based name, then `generic.glb`.

Same animation set as characters is recommended.

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
