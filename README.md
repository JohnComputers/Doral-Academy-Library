# VoxelCraft

A browser-based, Minecraft-inspired sandbox built from scratch — raw WebGL2, zero
dependencies, zero build step, zero external assets. Every texture, icon, and
sound is generated procedurally at boot.

![stack](https://img.shields.io/badge/WebGL2-raw-blue) ![deps](https://img.shields.io/badge/dependencies-0-green) ![build](https://img.shields.io/badge/build_step-none-green)

## Running it

ES module workers can't load over `file://`, so serve the folder with any static
server and open `index.html`:

```bash
# any one of these, from the project root:
npx serve .
python3 -m http.server 8000
```

Then visit `http://localhost:8000` (or whatever port your server prints).

**GitHub Pages works out of the box** — push the folder to a repo, enable Pages,
done. No bundler, no node_modules, no compile.

Requires a browser with WebGL2 (current Chrome / Edge / Firefox / Safari).

## What's in the game

**World** — infinite procedural terrain streamed in 16×128×16 chunks from a
2-worker pool. 17 biomes (plains, forest, birch forest, dark forest, taiga,
snowy taiga, snowy plains, desert, savanna, jungle, swamp, mountains, frozen
mountains, beach, ocean, frozen ocean) driven by temperature/moisture climate
noise, domain-warped continental + erosion + ridged mountain height, carved
rivers, spaghetti-tunnel and cheese-cavern caves with lava pools, depth-ranged
ore veins (coal/iron/gold/diamond), and oak/birch/spruce trees.

**Rendering** — raw WebGL2: per-chunk meshing with hidden-face culling, smooth
per-vertex lighting, classic 3-sample ambient occlusion with quad-flip,
frustum culling, distance fog, a procedural 256×256 texture atlas, animated
water with a translucent blended pass, drifting clouds, a square sun and moon
that arc across the sky, stars at night, and dynamic sky/fog colors through
sunrise → noon → sunset → night.

**Lighting** — flood-filled voxel lighting with separate sky and block
channels packed per cell. Sunlight pours down columns and spreads sideways;
torches, lava, and lit furnaces emit block light; the shader blends both with
the day/night cycle so caves stay dark at noon and torchlight glows at night.

**Survival** — health, hunger + saturation + exhaustion, regeneration,
starvation, fall damage, drowning with air bubbles, lava damage, death
screen + respawn. Eating (apples, porkchops, steaks — raw and cooked).

**Blocks & items** — 30 block types, mining with hold-to-break crack
animation, tool classes (pickaxe/axe/shovel/sword) in five tiers
(wood/stone/iron/gold/diamond) with authentic-style speeds, durability bars,
and harvest gating (iron ore needs stone+, diamond needs iron+). Gravity for
sand/gravel, torches that pop without support, flowing water and slow lava
with level-based spread, lava+water → stone/cobblestone.

**Crafting** — data-driven shaped (bounding-box normalized, mirror-aware) and
shapeless recipes: planks, sticks, torches, crafting table, furnace,
sandstone, and all 20 tools. 2×2 in-inventory grid, 3×3 at a crafting table.
Furnaces smelt with real fuel burn times (cobble→stone, sand→glass, ores→
ingots, raw→cooked food) and swap to a glowing lit-furnace block.

**Inventory** — 36 slots + hotbar, drag & drop, right-click stack splitting,
shift-free Minecraft click semantics, creative item browser, Q to drop items
into the world as pickups that bob, spin, and magnet to you.

**Mobs** — cows, pigs, sheep, chickens (wander, flee when hit, drop food/
wool/feathers), zombies (night melee chasers), skeletons (kite you and shoot
arrows), and creepers (hissing fuse, flash, explosion that carves terrain).
Passive mobs populate new chunks; hostiles spawn in darkness and fade at dawn.
Torch light suppresses spawns.

**Weather** — periodic rain with particle streaks and a darkened sky; snowy
biomes get drifting snowfall instead.

**Audio** — fully synthesized WebAudio: footsteps (grass vs. stone), digging,
break/place, pickup pops, hurt, eating, splashes, bow shots, explosions, UI
clicks, and a low wind ambience that swells with rain.

**Persistence** — IndexedDB world saves (seed, time, player, inventory,
furnace contents, entities, and only the chunks you've modified — everything
else regenerates deterministically). Multiple named worlds, autosave every
45 s, save on quit and on tab close. Settings (render distance, FOV,
sensitivity, volume) persist in localStorage.

**Multiplayer foundation** — block edits route through a
`NetworkAdapter → LocalServer` loopback so an authoritative WebSocket server
can replace the local one without touching gameplay code
(`src/networking/NetworkAdapter.js`).

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Left click | Mine / attack |
| Right click | Place / use / eat / open table & furnace |
| Space | Jump / swim up |
| Double Space | Toggle flight (creative) |
| Shift | Sneak (edge-safe) / fly down |
| Ctrl | Sprint |
| E | Inventory |
| Q | Drop item |
| 1–9 / scroll | Hotbar |
| F3 | Debug overlay (FPS, position, biome, chunk stats) |
| Esc | Pause |

## Architecture

```
index.html / styles.css        shell + pixel UI
src/
  main.js                      boot & wiring
  engine/    Game.js           fixed-60Hz loop, chunk streaming, interactions
             Input.js          keyboard/mouse/pointer-lock
             math.js           mat4, frustum, view math
  world/     constants.js      sizes, RNG, hashing
             noise.js          seeded simplex 2D/3D + fbm + ridged
             generation.js     biomes, terrain, caves, ores, trees, lighting (pure)
             Blocks.js         data-driven block registry
             Chunk.js, World.js chunk storage, edits, relighting, fluid ticks
  workers/   genWorker.js      module worker wrapping the pure generator
  rendering/ Renderer.js       WebGL2 passes: sky, celestials, chunks, entities,
                               clouds, water, particles, crack overlay, selection
             ChunkMesher.js    face culling + smooth light + AO (pure, tested)
             TextureAtlas.js   every texture/icon, painted at boot
  player/    Player.js         swept-AABB physics, modes, DDA raycast
  entities/  Entities.js       mobs, AI, arrows, item drops, batched box models
  items/     Items.js          materials, food, tiered tools
  inventory/ Inventory.js      stacks, durability
  crafting/  Recipes.js        shaped/shapeless matcher, smelting, fuels
  ui/        HUD.js, InventoryUI.js, Menus.js
  audio/     Audio.js          synthesized SFX + ambience
  save/      SaveManager.js    IndexedDB worlds/chunks, localStorage settings
  networking/NetworkAdapter.js multiplayer abstraction (loopback today)
test/
  logic.test.js                23 node tests for the pure modules
```

Design choices worth knowing:

- **No build step** by design — plain ES modules + a module worker. Deploys to
  any static host as-is.
- **Pure core** — generation, meshing, world simulation, crafting and
  inventory have no DOM/GL dependencies, so they run (and are tested) in node:
  `node test/logic.test.js`.
- **Meshing** happens on the main thread under a per-frame time budget;
  terrain generation (the expensive part) is off-thread.
- **Light seams**: lighting is computed per chunk locally, then border light
  is blended into neighbors when chunks load or change. Light crossing a
  chunk border propagates one extra ring rather than the full 15 blocks, so a
  torch placed right at a border can look slightly dimmer across the seam.

## Known limitations (honest list)

- Performance targets depend on hardware; render distance is adjustable
  3–16 chunks in Settings (default 8). Meshing is culled-faces (not greedy).
- Water uses level-based spreading but simplified flow rendering (no
  directional flow angles); no buckets yet.
- Mobs use straight-line steering with auto-jump, not A* pathfinding.
- No sneak-peek third person, beds, redstone, or item frames — block/item set
  is the survival core loop.
- Multiplayer is an architecture seam, not a feature: the adapter/server
  abstraction exists, the WebSocket implementation does not.
- Browser saves live in IndexedDB — clearing site data deletes worlds.

## Testing

```bash
node test/logic.test.js     # 23 unit tests for the pure modules
node test/loading.test.js   # headless world-loading pipeline (random seed)
```

Covers: noise determinism & range, terrain determinism, bedrock floor,
heightmaps, sky-light correctness, mesher output validity, world edit +
relight round trips, torch light radius, water spread/dry-up, falling sand,
recipe matching (shapeless, position-independent shaped, mirrored, negative
cases), smelting/fuel tables, tool speed/harvest tiers, inventory stacking and
overflow, atlas face mapping for every block, and camera math consistency.
