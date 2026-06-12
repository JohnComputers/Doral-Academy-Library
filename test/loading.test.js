// Integration test: simulates the exact loading pipeline Game.js
// runs during "Generating world…" — chunk generation (sync stand-in
// for the worker), World.onChunkLoaded light blending, and meshing
// of every dirty chunk — to prove the path can't throw or stall.
// Run: node test/loading.test.js
import { strict as assert } from 'assert';
import { CHUNK, chunkKey } from '../src/world/constants.js';
import { Generator } from '../src/world/generation.js';
import { World } from '../src/world/World.js';
import { Chunk } from '../src/world/Chunk.js';
import { buildChunkMesh } from '../src/rendering/ChunkMesher.js';

const seed = (Math.random() * 0xffffffff) >>> 0;
console.log('seed', seed);
const world = new World(seed);
const gen = new Generator(seed);

// mock of Renderer.setChunkMesh
const meshes = new Map();
const renderer = {
  setChunkMesh(key, cx, cz, mesh) { meshes.set(key, mesh); },
};

// --- mirror Game.streamChunks request logic (rd = 4) ----------
const rd = 4;
const pcx = 0, pcz = 0;
const wanted = [];
for (let dx = -rd; dx <= rd; dx++) for (let dz = -rd; dz <= rd; dz++) {
  if (dx * dx + dz * dz > rd * rd + 2) continue;
  wanted.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
}
wanted.sort((a, b) => a[0] - b[0]);

// "worker" responses arriving nearest-first, like the real pool
for (const [, cx, cz] of wanted) {
  const r = gen.generate(cx, cz);
  const chunk = new Chunk(cx, cz, {
    blocks: r.blocks.buffer, meta: r.meta.buffer, light: r.light.buffer,
    heightmap: r.heightmap.buffer, biomes: r.biomes.buffer, biomeNames: r.biomeNames,
  });
  world.addChunk(chunk);
  world.onChunkLoaded(chunk);   // border light blending across seams
}
assert.ok(world.getChunk(0, 0), 'spawn chunk exists');

// --- mirror the dirty-chunk meshing loop ----------------------
let built = 0;
for (const c of world.chunks.values()) {
  if (!c.dirty) continue;
  const mesh = buildChunkMesh(world, c);
  renderer.setChunkMesh(chunkKey(c.cx, c.cz), c.cx, c.cz, mesh);
  c.dirty = false;
  built++;
}
assert.ok(built >= wanted.length, 'all chunks meshed (' + built + ')');
let totalVerts = 0;
for (const m of meshes.values()) totalVerts += m.opaque.length / 8 + m.water.length / 8;
assert.ok(totalVerts > 10000, 'world produced real geometry: ' + totalVerts);

// spawn placement math used by waitForSpawn
const y = world.surfaceY(8, 8);
assert.ok(y > 0 && y < 128, 'spawnable surface at y=' + y);

// edits after load keep the pipeline consistent
world.setBlock(8, y + 1, 8, 1 /* stone */);
let redirty = 0;
for (const c of world.chunks.values()) if (c.dirty) { buildChunkMesh(world, c); c.dirty = false; redirty++; }
assert.ok(redirty >= 1, 'edit re-dirtied chunks');

console.log(`ok — ${built} chunks generated+meshed, ${totalVerts | 0} verts, surface y=${y}`);
