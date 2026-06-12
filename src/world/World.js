// ============================================================
// World — owns chunks, global block/light access, block edits
// with relighting, scheduled ticks (fluids, falling blocks),
// and block entities (furnaces).
// ============================================================
import { CHUNK, HEIGHT, idx, chunkKey, inBounds, SEA_LEVEL } from './constants.js';
import { B, blockDef } from './Blocks.js';
import { computeLight } from './generation.js';

const DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map();
    this.pendingTicks = new Map();   // "x,y,z" -> dueTime
    this.blockEntities = new Map();  // "x,y,z" -> data (furnace state)
    this.time = 0;                   // world seconds
    this.onBlockChanged = null;      // hook for game (sounds/particles)
  }

  chunkAt(x, z) { return this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK))); }
  getChunk(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }
  addChunk(chunk) { this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk); }
  removeChunk(cx, cz) { this.chunks.delete(chunkKey(cx, cz)); }

  getBlock(x, y, z) {
    if (!inBounds(y)) return B.AIR;
    const c = this.chunkAt(x, z);
    if (!c) return B.AIR;
    return c.get(((x % CHUNK) + CHUNK) % CHUNK, y, ((z % CHUNK) + CHUNK) % CHUNK);
  }
  // light for meshing: missing chunks read as full sky so frontier isn't black
  getLight(x, y, z) {
    if (y >= HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0xf0;
    return c.getLight(((x % CHUNK) + CHUNK) % CHUNK, y, ((z % CHUNK) + CHUNK) % CHUNK);
  }
  getMeta(x, y, z) {
    if (!inBounds(y)) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.getMeta(((x % CHUNK) + CHUNK) % CHUNK, y, ((z % CHUNK) + CHUNK) % CHUNK) : 0;
  }
  setMeta(x, y, z, v) {
    const c = this.chunkAt(x, z);
    if (c && inBounds(y)) c.setMeta(((x % CHUNK) + CHUNK) % CHUNK, y, ((z % CHUNK) + CHUNK) % CHUNK, v);
  }
  isLoaded(x, z) { return !!this.chunkAt(x, z); }

  // ---- editing ----------------------------------------------
  setBlock(x, y, z, id, meta = 0, opts = {}) {
    if (!inBounds(y)) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const lx = ((x % CHUNK) + CHUNK) % CHUNK, lz = ((z % CHUNK) + CHUNK) % CHUNK;
    const prev = c.get(lx, y, lz);
    c.set(lx, y, lz, id);
    c.setMeta(lx, y, lz, meta);
    if (blockDef(prev).interactive || blockDef(id).interactive) {
      if (!blockDef(id).interactive) this.blockEntities.delete(x + ',' + y + ',' + z);
    }
    this.relightColumn(c);
    this.markDirtyAround(x, y, z);
    this.notifyNeighbors(x, y, z);
    if (this.onBlockChanged && !opts.silent) this.onBlockChanged(x, y, z, prev, id);
    return true;
  }

  markDirtyAround(x, y, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = this.getChunk(cx + dx, cz + dz);
      if (c) c.dirty = true;
    }
  }

  // local relight + pull border light from neighbors + push out
  relightColumn(chunk) {
    chunk.light = computeLight(chunk.blocks);
    this.pullBorderLight(chunk);
  }
  pullBorderLight(chunk) {
    // inject neighbor border light as BFS seeds, both channels
    const queueS = [], queueB = [];
    const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
    const seed = (lx, lz, wx, wz) => {
      const nl = this.getLight(wx, 0, wz); // probe loaded?
      const nc = this.chunkAt(wx, wz);
      if (!nc) return;
      for (let y = 0; y < HEIGHT; y++) {
        const v = nc.getLight(((wx % CHUNK) + CHUNK) % CHUNK, y, ((wz % CHUNK) + CHUNK) % CHUNK);
        const i = idx(lx, y, lz);
        if (blockDef(chunk.blocks[i]).opaque) continue;
        const s = (v >> 4) - 1, b = (v & 15) - 1;
        if (s > (chunk.light[i] >> 4)) { chunk.light[i] = (chunk.light[i] & 15) | (s << 4); queueS.push(i); }
        if (b > (chunk.light[i] & 15)) { chunk.light[i] = (chunk.light[i] & 0xf0) | b; queueB.push(i); }
      }
    };
    for (let lz = 0; lz < CHUNK; lz++) { seed(0, lz, x0 - 1, z0 + lz); seed(CHUNK - 1, lz, x0 + CHUNK, z0 + lz); }
    for (let lx = 0; lx < CHUNK; lx++) { seed(lx, 0, x0 + lx, z0 - 1); seed(lx, CHUNK - 1, x0 + lx, z0 + CHUNK); }
    this.floodLocal(chunk, queueS, true);
    this.floodLocal(chunk, queueB, false);
  }
  floodLocal(chunk, queue, sky) {
    while (queue.length) {
      const i = queue.pop();
      const lv = sky ? chunk.light[i] >> 4 : chunk.light[i] & 15;
      if (lv <= 1) continue;
      const y = (i / (CHUNK * CHUNK)) | 0, r = i - y * CHUNK * CHUNK, z = (r / CHUNK) | 0, x = r - z * CHUNK;
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nx >= CHUNK || nz < 0 || nz >= CHUNK || ny < 0 || ny >= HEIGHT) continue;
        const j = idx(nx, ny, nz);
        if (blockDef(chunk.blocks[j]).opaque) continue;
        const next = lv - 1;
        const cur = sky ? chunk.light[j] >> 4 : chunk.light[j] & 15;
        if (next > cur) {
          chunk.light[j] = sky ? (chunk.light[j] & 15) | (next << 4) : (chunk.light[j] & 0xf0) | next;
          queue.push(j);
        }
      }
    }
  }
  // called when a freshly generated chunk arrives: blend light at seams
  onChunkLoaded(chunk) {
    this.pullBorderLight(chunk);
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const n = this.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (n) { this.pullBorderLight(n); n.dirty = true; }
    }
  }

  // ---- scheduled ticks (fluids / falling blocks) -------------
  scheduleTick(x, y, z, delay) {
    const k = x + ',' + y + ',' + z;
    const due = this.time + delay;
    if (!this.pendingTicks.has(k) || this.pendingTicks.get(k) > due) this.pendingTicks.set(k, due);
  }
  notifyNeighbors(x, y, z) {
    for (const [dx, dy, dz] of DIRS) {
      const id = this.getBlock(x + dx, y + dy, z + dz);
      const d = blockDef(id);
      if (d.fluid) this.scheduleTick(x + dx, y + dy, z + dz, id === B.LAVA ? 0.8 : 0.25);
      if (d.gravity) this.scheduleTick(x + dx, y + dy, z + dz, 0.1);
      if (id === B.TORCH && dy === 1 && !blockDef(this.getBlock(x, y, z)).solid) {
        // torch lost its support
        this.scheduleTick(x + dx, y + dy, z + dz, 0.05);
      }
    }
    const selfId = this.getBlock(x, y, z);
    if (blockDef(selfId).fluid) this.scheduleTick(x, y, z, selfId === B.LAVA ? 0.8 : 0.25);
  }

  processTicks(budget = 256) {
    if (!this.pendingTicks.size) return;
    const due = [];
    for (const [k, t] of this.pendingTicks) {
      if (t <= this.time) due.push(k);
      if (due.length >= budget) break;
    }
    for (const k of due) {
      this.pendingTicks.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.tickBlock(x, y, z);
    }
  }

  tickBlock(x, y, z) {
    const id = this.getBlock(x, y, z);
    const d = blockDef(id);
    if (d.gravity) {
      if (this.getBlock(x, y - 1, z) === B.AIR) {
        let ny = y - 1;
        while (ny > 0 && this.getBlock(x, ny - 1, z) === B.AIR) ny--;
        this.setBlock(x, y, z, B.AIR);
        this.setBlock(x, ny, z, id);
      }
      return;
    }
    if (id === B.TORCH && !blockDef(this.getBlock(x, y - 1, z)).solid) {
      this.setBlock(x, y, z, B.AIR); // pop unsupported torches
      return;
    }
    if (id === B.WATER || id === B.LAVA) this.tickFluid(x, y, z, id);
  }

  tickFluid(x, y, z, id) {
    const isLava = id === B.LAVA;
    const level = this.getMeta(x, y, z) || 8;

    // lava + water interactions
    for (const [dx, dy, dz] of DIRS) {
      const n = this.getBlock(x + dx, y + dy, z + dz);
      if (isLava && n === B.WATER) { this.setBlock(x, y, z, level === 8 ? B.STONE : B.COBBLE); return; }
      if (!isLava && n === B.LAVA) { this.setBlock(x + dx, y + dy, z + dz, B.COBBLE); }
    }

    // flowing blocks dry up without a feeder
    if (level < 8) {
      let fed = this.getBlock(x, y + 1, z) === id;
      if (!fed) for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (this.getBlock(x + dx, y, z + dz) === id && (this.getMeta(x + dx, y, z + dz) || 8) > level) { fed = true; break; }
      }
      if (!fed) { this.setBlock(x, y, z, B.AIR); return; }
    }

    const delay = isLava ? 0.8 : 0.25;
    const below = this.getBlock(x, y - 1, z);
    if (below === B.AIR) {
      this.setBlock(x, y - 1, z, id, 8); // falling column keeps strength
      this.scheduleTick(x, y - 1, z, delay);
      return;
    }
    if (blockDef(below).solid || below === id || (below === B.WATER && isLava)) {
      const spread = level - (isLava ? 2 : 1);
      const max = isLava ? 5 : 1;
      if (spread >= max) {
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, nz = z + dz;
          const n = this.getBlock(nx, y, nz);
          if (n === B.AIR) {
            this.setBlock(nx, y, nz, id, spread);
            this.scheduleTick(nx, y, nz, delay);
          } else if (n === id && (this.getMeta(nx, y, nz) || 8) < spread) {
            this.setMeta(nx, y, nz, spread);
            this.scheduleTick(nx, y, nz, delay);
          }
        }
      }
    }
  }

  // highest solid block at world (x,z); -1 if column unloaded
  surfaceY(x, z) {
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    const lx = ((x % CHUNK) + CHUNK) % CHUNK, lz = ((z % CHUNK) + CHUNK) % CHUNK;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      if (blockDef(c.get(lx, y, lz)).solid) return y;
    }
    return -1;
  }
  biomeAt(x, z) {
    const c = this.chunkAt(x, z);
    if (!c || !c.biomes) return 'Unknown';
    const lx = ((x % CHUNK) + CHUNK) % CHUNK, lz = ((z % CHUNK) + CHUNK) % CHUNK;
    const i = c.biomes[lx + lz * CHUNK];
    return c.biomeNames ? c.biomeNames[i] : 'Unknown';
  }
}
export { SEA_LEVEL };
