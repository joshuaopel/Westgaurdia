# Agent Handoff

This file is the communication lane between Claude Code and Codex while Westgaurdia is early-stage.
Update the **Status** column when you finish a task. Both agents read this before starting work.

---

## Division of Responsibility

| Domain | Owner |
|---|---|
| Server, DB schema, socket events, gameplay systems | Claude |
| NPC / item / quest / faction content definitions | Claude |
| Blender addon, manifest authoring, zone export panel | Codex |
| CI / GitHub Actions, manifest validation pipeline | Codex |
| Zone importer CLI (`npm run import:zone`) | Claude (done) |

---

## Shared Contract

| Item | Value |
|---|---|
| Zone manifests | `content/zones/<short_name>.zone.json` |
| Zone GLBs | `client/assets/zones/<short_name>.glb` |
| Character GLBs | `client/assets/characters/<race>_<class>.glb` |
| NPC GLBs | `client/assets/npcs/<name>.glb` |
| Import command | `npm run import:zone -- <manifest> [--replace-spawns]` |

NPC names in spawn manifests must match `npcs.name` exactly (case-sensitive) or import validation will fail loudly.

---

## Task Status

### Claude tasks

| Task | Status |
|---|---|
| DB schema: patrol_paths, patrol_waypoints | ✅ Done — `server/db/schema.sql` |
| DB schema: zone_triggers with AABB + req_level/quest gates | ✅ Done — `server/db/schema.sql` |
| GM/admin endpoint for live zone spawns | ✅ Done — `GET /api/gm/zone/:id/live` |
| Zone trigger API endpoint for client | ✅ Done — `GET /api/world/triggers/:zoneId` |
| Zone transition (client AABB check + fade) | ✅ Done — `client/js/game.js` |
| Collision + lightmap wiring | ✅ Done — `client/js/renderer.js` |
| Weeble character mesh + animation state machine | ✅ Done — `client/js/renderer.js` |
| Zone manifest format defined | ✅ Done — see `content/zones/qeynos_hills.zone.json` |
| `npm run import:zone` importer with validation | ✅ Done — `server/scripts/importZone.js` |
| Expose col_mesh field in manifest (navmesh reference) | 🔲 Pending |

### Codex tasks

| Task | Status |
|---|---|
| Blender panel: zone export → `.zone.json` | 🔲 Pending |
| Blender panel: path markers (waypoints) | 🔲 Pending (schema ready) |
| Blender panel: zone trigger volumes (AABB empties) | 🔲 Pending (schema ready) |
| Manifest validation in CI | 🔲 Pending |
| GitHub Actions: run `npm run import:zone --dry-run` on PR | 🔲 Pending |

---

## Zone Manifest Schema

```jsonc
{
  "zone": "qeynos_hills",   // matches zones.short_name in DB
  "version": "1",

  "spawns": [
    {
      "npc_name": "Gnoll Scout",          // must match npcs.name exactly
      "x": 120.0, "y": 85.0, "z": 0.0,   // game coordinates
      "heading": 0,                        // 0–360, degrees
      "respawn_time": 300,                 // seconds
      "wander": true,
      "wander_radius": 40,
      "patrol_path": "gnoll_camp_loop",    // optional — name from patrol_paths below
      "aggro_range_override": 70,          // optional, overrides NPC default
      "leash_range_override": 200,         // optional
      "spawn_group": "gnoll_east",         // optional label for related spawns
      "editor_note": "Near the big oak"   // optional GM note
    }
  ],

  "patrol_paths": [
    {
      "name": "gnoll_camp_loop",           // referenced by spawns above
      "loop_type": "loop",                 // loop | ping_pong | once
      "waypoints": [
        { "x": 200.0, "y": 120.0, "z": 0.0, "heading": 0, "wait_time": 0.0 },
        { "x": 220.0, "y": 130.0, "z": 0.0, "heading": 45, "wait_time": 1.5 }
      ]
    }
  ],

  "zone_triggers": [
    {
      "trigger_type": "zone_line",          // zone_line | portal | dungeon_enter | dungeon_exit
      "label": "To Qeynos",
      "x": -5.0, "y": 0.0, "z": 5.0,       // AABB center (game coords)
      "half_w": 8.0, "half_d": 6.0, "half_h": 12.0,  // AABB half-extents
      "dest_zone": "qeynos",                // destination zones.short_name
      "dest_x": 150.0, "dest_y": -20.0, "dest_z": 0.0,
      "dest_heading": 0,
      "req_level": 1                        // optional minimum level
    }
  ]
}
```

The importer is intentionally strict: unknown NPC names or destination zones are hard errors, not warnings. This prevents silent runtime failures.

---

## Open Questions — Resolved

**Q: Should patrol paths be DB rows, JSON blobs, or content files?**
→ **DB rows** (`patrol_paths` + `patrol_waypoints`). Blender exports them into the zone manifest; the importer writes them to the DB so the server runtime (world.js NPC tick) can query them without parsing files. Content files are the authoring format, DB is the runtime format.

**Q: Should zone triggers own quest behavior directly, or only emit named events?**
→ **Named events only.** Triggers carry only data fields (`req_level`, `req_quest_id`). Quest gating is checked in the server `player:zone` handler, not in trigger data. This keeps triggers as pure AABB data and behavior in code.

**Q: Should collision remain GLB-only, or export separate `col_` data?**
→ **GLB-only for now** with the `col_` prefix naming convention (objects named `col_*` in Blender are invisible collision meshes in the runtime). If pathfinding is needed later, add a separate `<zone>_nav.glb` export — but don't over-engineer it now.

---

## What Codex Can Build Against Right Now

1. **Spawn placement** — any object in Blender named with NPC names that exist in the DB seed can be placed and exported to a manifest. Use `npm run import:zone -- <file> --replace-spawns` to push to the DB. Dry-run (no flag) validates without writing.

2. **Patrol paths** — create a Blender path (curve or empties chain) named `patrol_<name>`. Export waypoints as `{ x, y, z, heading, wait_time }`. The importer maps them to `patrol_paths` + `patrol_waypoints` automatically.

3. **Zone trigger volumes** — create a Blender Empty (or box) named `trigger_<type>_<dest_zone>` positioned and scaled to the AABB. Export `x/y/z + half_w/half_d/half_h`. The importer writes to `zone_triggers` and the client checks them on every movement tick.

4. **Validation in CI** — run `node server/scripts/importZone.js <manifest>` (no `--replace-spawns`) as a CI step. Exit code is non-zero on any validation failure.

---

## Notes for Next Claude Session

- `docs/agenthandoff.md` is the source of truth for task status — update it when completing work
- Check git log before starting: `git log --oneline -5`
- Seed NPC names (exact, case-sensitive): Gnoll Pup, Gnoll Scout, Guard Fynn, Toresian Ironhammer, Gnoll Warrior, Gnoll Shaman, Darkpaw Alpha, Snow Badger, Sheriff Roglio
- Zone short names: qeynos_hills, qeynos, blackburrow, everfrost, befallen, highpass, lavastorm, solb
