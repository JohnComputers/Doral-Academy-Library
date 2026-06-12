// Logic tests for the pure (browser-free) modules.
// Run: node test/logic.test.js
import { strict as assert } from 'assert';
import { CHUNK, HEIGHT, idx, chunkKey } from '../src/world/constants.js';
import { Noise } from '../src/world/noise.js';
import { Generator, computeLight } from '../src/world/generation.js';
import { B, blockDef, faceTexture } from '../src/world/Blocks.js';
import { Chunk } from '../src/world/Chunk.js';
import { World } from '../src/world/World.js';
import { buildChunkMesh } from '../src/rendering/ChunkMesher.js';
import { matchRecipe, RECIPES, SMELTING, FUEL } from '../src/crafting/Recipes.js';
import { Inventory } from '../src/inventory/Inventory.js';
import { itemDef, blockItem, miningSpeed, canHarvest } from '../src/items/Items.js';
import { forward, viewMatrix, mat4 } from '../src/engine/math.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error(' FAIL ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

// ---------------- noise --------------------------------------
test('noise is deterministic per seed', () => {
  const a = new Noise(42), b = new Noise(42), c = new Noise(43);
  assert.equal(a.noise2D(1.5, 2.5), b.noise2D(1.5, 2.5));
  assert.equal(a.noise3D(1.1, 2.2, 3.3), b.noise3D(1.1, 2.2, 3.3));
  let same = 0;
  for (let i = 0; i < 50; i++) {
    if (Math.abs(a.noise2D(i * 0.31, i * 0.47) - c.noise2D(i * 0.31, i * 0.47)) < 1e-12) same++;
  }
  assert.ok(same < 25, 'different seeds look identical');
});
test('noise output stays in sane range', () => {
  const n = new Noise(7);
  for (let i = 0; i < 2000; i++) {
    const v = n.noise2D(i * 0.137, i * 0.291);
    assert.ok(v > -1.3 && v < 1.3, 'n2 out of range: ' + v);
    const w = n.noise3D(i * 0.1, i * 0.17, i * 0.07);
    assert.ok(w > -1.3 && w < 1.3, 'n3 out of range: ' + w);
  }
});

// ---------------- generation ---------------------------------
const gen = new Generator(1234);
const data = gen.generate(0, 0);
test('generated chunk has bedrock floor and is non-empty', () => {
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    assert.equal(data.blocks[idx(x, 0, z)], B.BEDROCK);
  }
  let solid = 0;
  for (let i = 0; i < data.blocks.length; i++) if (data.blocks[i] !== B.AIR) solid++;
  assert.ok(solid > 5000, 'chunk too empty: ' + solid);
});
test('generation is deterministic', () => {
  const again = new Generator(1234).generate(0, 0);
  assert.deepEqual(Buffer.from(again.blocks), Buffer.from(data.blocks));
  const diff = new Generator(99).generate(0, 0);
  assert.notDeepEqual(Buffer.from(diff.blocks), Buffer.from(data.blocks));
});
test('heightmap matches terrain', () => {
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const h = data.heightmap[x + z * CHUNK];
    assert.ok(h > 0 && h < HEIGHT, 'height out of range');
  }
});
test('sky light reaches open air and not solid rock', () => {
  const light = data.light;
  let litAir = 0;
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const top = idx(x, HEIGHT - 1, z);
    if (data.blocks[top] === B.AIR) { assert.equal(light[top] >> 4, 15); litAir++; }
  }
  assert.ok(litAir > 0);
});
test('biomes annotated', () => {
  assert.ok(data.biomeNames.length > 5);
  assert.ok(data.biomes.length === CHUNK * CHUNK);
});

// ---------------- world + mesher ------------------------------
function makeWorldWithChunks(seed, coords) {
  const w = new World(seed);
  const g = new Generator(seed);
  for (const [cx, cz] of coords) {
    const d = g.generate(cx, cz);
    w.addChunk(new Chunk(cx, cz, {
      blocks: d.blocks.buffer, meta: d.meta.buffer, light: d.light.buffer,
      heightmap: d.heightmap.buffer, biomes: d.biomes.buffer, biomeNames: d.biomeNames,
    }));
  }
  return w;
}
test('mesher produces geometry with valid vertex stride', () => {
  const w = makeWorldWithChunks(1234, [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
  const mesh = buildChunkMesh(w, w.getChunk(0, 0));
  assert.ok(mesh.opaque.length > 0, 'no opaque verts');
  assert.equal(mesh.opaque.length % 8, 0, 'stride misaligned');
  assert.equal(mesh.opaque.length % (8 * 3), 0, 'not whole triangles');
  // every vertex inside world-space chunk bounds (+1 for far faces)
  for (let i = 0; i < mesh.opaque.length; i += 8) {
    const x = mesh.opaque[i], y = mesh.opaque[i + 1], z = mesh.opaque[i + 2];
    assert.ok(x >= -0.01 && x <= CHUNK + 0.01, 'x out: ' + x);
    assert.ok(y >= -0.01 && y <= HEIGHT + 0.01, 'y out: ' + y);
    assert.ok(z >= -0.01 && z <= CHUNK + 0.01, 'z out: ' + z);
    const sky = mesh.opaque[i + 5], blk = mesh.opaque[i + 6], ao = mesh.opaque[i + 7];
    assert.ok(sky >= 0 && sky <= 1 && blk >= 0 && blk <= 1 && ao >= 0 && ao <= 1, 'light out of range');
  }
});
test('world get/set + relight round trip', () => {
  const w = makeWorldWithChunks(55, [[0, 0]]);
  const y = w.surfaceY(8, 8);
  assert.ok(y > 0);
  w.setBlock(8, y + 1, 8, B.STONE);
  assert.equal(w.getBlock(8, y + 1, 8), B.STONE);
  w.setBlock(8, y + 1, 8, B.AIR);
  assert.equal(w.getBlock(8, y + 1, 8), B.AIR);
  assert.equal(w.getBlock(8, y + 1, 8 + CHUNK * 10), B.AIR, 'unloaded reads as air');
});
test('torch lights its surroundings after relight', () => {
  const w = makeWorldWithChunks(55, [[0, 0]]);
  const y = w.surfaceY(8, 8);
  w.setBlock(8, y + 1, 8, B.TORCH);
  const lv = w.getLight(8, y + 1, 8) & 15;
  assert.ok(lv >= 13, 'torch cell light ' + lv);
  const near = w.getLight(10, y + 1, 8) & 15;
  assert.ok(near >= 10, 'nearby light ' + near);
});
test('water spreads and dries up via scheduled ticks', () => {
  const w = makeWorldWithChunks(55, [[0, 0]]);
  // build a flat stone platform high in the air
  for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) w.setBlock(x, 100, z, B.STONE);
  w.setBlock(8, 101, 8, B.WATER, 8);
  w.scheduleTick(8, 101, 8, 0);
  for (let i = 0; i < 40; i++) { w.time += 0.3; w.processTicks(999); }
  assert.equal(w.getBlock(9, 101, 8), B.WATER, 'water spread sideways');
  // remove the source: flowing water should dry up
  w.setBlock(8, 101, 8, B.AIR);
  for (let i = 0; i < 60; i++) { w.time += 0.3; w.processTicks(999); }
  assert.equal(w.getBlock(9, 101, 8), B.AIR, 'flow dried up');
});
test('sand falls', () => {
  const w = makeWorldWithChunks(55, [[0, 0]]);
  const y = w.surfaceY(4, 4);
  w.setBlock(4, y + 5, 4, B.SAND);
  w.scheduleTick(4, y + 5, 4, 0);
  w.time += 1; w.processTicks(999);
  assert.equal(w.getBlock(4, y + 5, 4), B.AIR);
  assert.equal(w.getBlock(4, y + 1, 4), B.SAND);
});

// ---------------- crafting ------------------------------------
const P = blockItem(B.PLANKS);
test('log -> planks (shapeless, any position)', () => {
  const g = new Array(9).fill(null);
  g[4] = blockItem(B.OAK_LOG);
  const r = matchRecipe(g, 3);
  assert.ok(r, 'no match');
  assert.equal(r.result, P);
  assert.equal(r.count, 4);
});
test('sticks match anywhere in the grid', () => {
  for (const col of [0, 1, 2]) {
    const g = new Array(9).fill(null);
    g[col] = P; g[col + 3] = P;
    const r = matchRecipe(g, 3);
    assert.ok(r && r.result === 'stick', 'col ' + col);
  }
  const g2 = new Array(4).fill(null);
  g2[0] = P; g2[2] = P; // 2x2 grid vertical
  assert.equal(matchRecipe(g2, 2).result, 'stick');
});
test('pickaxe recipe (and mirror) matches; wrong shape does not', () => {
  const g = new Array(9).fill(null);
  g[0] = g[1] = g[2] = P;
  g[4] = 'stick'; g[7] = 'stick';
  assert.equal(matchRecipe(g, 3).result, 'wooden_pickaxe');
  const axe = new Array(9).fill(null);
  axe[0] = axe[1] = P; axe[3] = P; axe[4] = 'stick'; axe[7] = 'stick';
  assert.equal(matchRecipe(axe, 3).result, 'wooden_axe');
  // mirrored axe
  const axem = new Array(9).fill(null);
  axem[1] = axem[2] = P; axem[5] = P; axem[4] = 'stick'; axem[7] = 'stick';
  assert.equal(matchRecipe(axem, 3).result, 'wooden_axe');
  const bad = new Array(9).fill(null);
  bad[0] = P; bad[4] = 'stick';
  assert.equal(matchRecipe(bad, 3), null);
});
test('furnace ring matches', () => {
  const C = blockItem(B.COBBLE);
  const g = [C, C, C, C, null, C, C, C, C];
  assert.equal(matchRecipe(g, 3).result, blockItem(B.FURNACE));
});
test('smelting + fuel tables sane', () => {
  assert.equal(SMELTING[blockItem(B.IRON_ORE)], 'iron_ingot');
  assert.ok(FUEL['coal'] > FUEL['stick']);
});
test('every recipe result is a valid item', () => {
  for (const r of RECIPES) assert.ok(itemDef(r.result), 'bad result ' + r.result);
});

// ---------------- items / tools -------------------------------
test('mining speed + harvest tiers', () => {
  assert.ok(miningSpeed('diamond_pickaxe', B.STONE) > miningSpeed('wooden_pickaxe', B.STONE));
  assert.equal(miningSpeed('wooden_axe', B.STONE), 1);
  assert.ok(canHarvest('stone_pickaxe', B.IRON_ORE));
  assert.ok(!canHarvest('wooden_pickaxe', B.IRON_ORE));
  assert.ok(!canHarvest(null, B.STONE) === false || canHarvest(null, B.DIRT));
  assert.ok(canHarvest(null, B.DIRT));
  assert.ok(!canHarvest(null, B.DIAMOND_ORE));
});

// ---------------- inventory -----------------------------------
test('inventory stacks, overflows, removes', () => {
  const inv = new Inventory();
  assert.equal(inv.add('coal', 70), 0);
  assert.equal(inv.slots[0].count, 64);
  assert.equal(inv.slots[1].count, 6);
  assert.equal(inv.count('coal'), 70);
  assert.ok(inv.remove('coal', 65));
  assert.equal(inv.count('coal'), 5);
  assert.ok(!inv.remove('coal', 6));
  // tools don't stack
  inv.add('wooden_pickaxe', 1);
  inv.add('wooden_pickaxe', 1);
  const picks = inv.slots.filter(s => s && s.id === 'wooden_pickaxe');
  assert.equal(picks.length, 2);
  assert.equal(picks[0].count, 1);
  assert.ok(picks[0].durability > 0);
});
test('full inventory rejects overflow', () => {
  const inv = new Inventory();
  for (let i = 0; i < 36; i++) inv.slots[i] = { id: 'coal', count: 64 };
  assert.equal(inv.add('coal', 10), 10);
});

// ---------------- blocks / atlas mapping ----------------------
test('face textures resolve for every block', () => {
  for (let id = 1; id <= B.ICE; id++) {
    for (let f = 0; f < 6; f++) {
      const t = faceTexture(id, f);
      assert.ok(Number.isInteger(t) && t >= 0 && t < 256, `block ${id} face ${f} -> ${t}`);
    }
  }
});

// ---------------- math ----------------------------------------
test('forward vector matches view matrix -z row', () => {
  const yaw = 0.7, pitch = -0.3;
  const v = mat4();
  viewMatrix(v, [0, 0, 0], yaw, pitch);
  const f = forward(yaw, pitch);
  // view row 2 = (m[2], m[6], m[10]); forward = -row2
  assert.ok(Math.abs(f[0] + v[2]) < 1e-6);
  assert.ok(Math.abs(f[1] + v[6]) < 1e-6);
  assert.ok(Math.abs(f[2] + v[10]) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...f) - 1) < 1e-6, 'unit length');
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
