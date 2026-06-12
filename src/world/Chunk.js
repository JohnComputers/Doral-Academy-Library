// ============================================================
// Chunk — one 16 x 128 x 16 column of blocks + light + meta
// ============================================================
import { CHUNK, HEIGHT, CHUNK_VOL, idx } from './constants.js';

export class Chunk {
  constructor(cx, cz, data) {
    this.cx = cx; this.cz = cz;
    this.blocks = data ? new Uint8Array(data.blocks) : new Uint8Array(CHUNK_VOL);
    this.meta   = data ? new Uint8Array(data.meta)   : new Uint8Array(CHUNK_VOL);
    this.light  = data ? new Uint8Array(data.light)  : new Uint8Array(CHUNK_VOL);
    this.heightmap = data && data.heightmap ? new Uint8Array(data.heightmap) : new Uint8Array(CHUNK * CHUNK);
    this.biomes = data && data.biomes ? new Uint8Array(data.biomes) : null;
    this.biomeNames = data ? data.biomeNames : null;
    this.dirty = true;       // needs remesh
    this.modified = false;   // needs save
    this.mesh = null;        // GPU handles owned by Renderer
    this.entitiesSpawned = false;
  }
  get(x, y, z) { return this.blocks[idx(x, y, z)]; }
  set(x, y, z, id) { this.blocks[idx(x, y, z)] = id; this.modified = true; }
  getLight(x, y, z) { return this.light[idx(x, y, z)]; }
  setLight(x, y, z, v) { this.light[idx(x, y, z)] = v; }
  getMeta(x, y, z) { return this.meta[idx(x, y, z)]; }
  setMeta(x, y, z, v) { this.meta[idx(x, y, z)] = v; this.modified = true; }
}
