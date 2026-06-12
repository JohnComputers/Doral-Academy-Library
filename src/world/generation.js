// ============================================================
// Terrain generation — pure module (runs in worker AND node tests)
// Produces blocks + meta + light arrays for one chunk column.
// Pipeline: climate -> biome -> warped heightmap -> strata ->
//           caves -> ores -> water/ice -> trees -> lighting
// ============================================================
import { CHUNK, HEIGHT, CHUNK_AREA, CHUNK_VOL, SEA_LEVEL, idx, mulberry32, hash2 } from './constants.js';
import { Noise } from './noise.js';
import { B, blockDef } from './Blocks.js';

export const BIOMES = {
  plains:       { name: 'Plains',        top: B.GRASS, filler: B.DIRT, trees: 0.002, treeTypes: ['oak'] },
  forest:       { name: 'Forest',        top: B.GRASS, filler: B.DIRT, trees: 0.02,  treeTypes: ['oak', 'oak', 'birch'] },
  birch_forest: { name: 'Birch Forest',  top: B.GRASS, filler: B.DIRT, trees: 0.018, treeTypes: ['birch'] },
  dark_forest:  { name: 'Dark Forest',   top: B.GRASS, filler: B.DIRT, trees: 0.045, treeTypes: ['oak'] },
  taiga:        { name: 'Taiga',         top: B.GRASS, filler: B.DIRT, trees: 0.025, treeTypes: ['spruce'] },
  snowy_taiga:  { name: 'Snowy Taiga',   top: B.SNOWY_GRASS, filler: B.DIRT, trees: 0.02, treeTypes: ['spruce'], snowy: true },
  snowy_plains: { name: 'Snowy Plains',  top: B.SNOWY_GRASS, filler: B.DIRT, trees: 0.001, treeTypes: ['spruce'], snowy: true },
  desert:       { name: 'Desert',        top: B.SAND, filler: B.SAND, under: B.SANDSTONE, trees: 0 },
  savanna:      { name: 'Savanna',       top: B.GRASS, filler: B.DIRT, trees: 0.003, treeTypes: ['oak'] },
  jungle:       { name: 'Jungle',        top: B.GRASS, filler: B.DIRT, trees: 0.05,  treeTypes: ['oak', 'birch'] },
  swamp:        { name: 'Swamp',         top: B.GRASS, filler: B.DIRT, trees: 0.012, treeTypes: ['oak'], flat: true },
  mountains:    { name: 'Mountains',     top: B.GRASS, filler: B.DIRT, trees: 0.004, treeTypes: ['spruce'] },
  frozen_mountains: { name: 'Frozen Mountains', top: B.SNOWY_GRASS, filler: B.DIRT, trees: 0.002, treeTypes: ['spruce'], snowy: true },
  beach:        { name: 'Beach',         top: B.SAND, filler: B.SAND, trees: 0 },
  ocean:        { name: 'Ocean',         top: B.GRAVEL, filler: B.DIRT, trees: 0 },
  frozen_ocean: { name: 'Frozen Ocean',  top: B.GRAVEL, filler: B.DIRT, trees: 0, snowy: true },
};

export class Generator {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.continent = new Noise(seed ^ 0x1a2b3c);
    this.erosion   = new Noise(seed ^ 0x4d5e6f);
    this.detail    = new Noise(seed ^ 0x778899);
    this.ridge     = new Noise(seed ^ 0xaabbcc);
    this.temp      = new Noise(seed ^ 0xddeeff);
    this.moist     = new Noise(seed ^ 0x112233);
    this.warpX     = new Noise(seed ^ 0x445566);
    this.warpZ     = new Noise(seed ^ 0x665544);
    this.river     = new Noise(seed ^ 0x99aa00);
    this.cave1     = new Noise(seed ^ 0xc0ffee);
    this.cave2     = new Noise(seed ^ 0xfeed5e);
    this.cavern    = new Noise(seed ^ 0xbada55);
  }

  climate(x, z) {
    const t = this.temp.fbm2(x * 0.0016, z * 0.0016, 3) * 0.5 + 0.5;
    const m = this.moist.fbm2(x * 0.0021 + 100, z * 0.0021, 3) * 0.5 + 0.5;
    return [t, m];
  }

  // continuous parameters at world (x,z); returns {h, biome}
  sample(x, z) {
    // domain warp keeps coastlines + ridges organic
    const wx = x + this.warpX.fbm2(x * 0.004, z * 0.004, 2) * 28;
    const wz = z + this.warpZ.fbm2(x * 0.004 + 50, z * 0.004, 2) * 28;

    const cont = this.continent.fbm2(wx * 0.0011, wz * 0.0011, 4);   // -1..1 land mass
    const ero  = this.erosion.fbm2(wx * 0.0027, wz * 0.0027, 3) * 0.5 + 0.5; // 0 flat .. 1 hilly
    const mtnMask = Math.max(0, this.erosion.fbm2(wx * 0.0009 + 999, wz * 0.0009, 3));
    const ridge = this.ridge.ridged2(wx * 0.004, wz * 0.004, 4);
    const det  = this.detail.fbm2(wx * 0.012, wz * 0.012, 4);

    let h = SEA_LEVEL + cont * 22;                 // base continents
    h += det * 6 * (0.35 + ero);                   // rolling detail
    const mtn = Math.pow(Math.max(0, mtnMask - 0.18) / 0.82, 1.4);
    h += mtn * ridge * 52;                         // ridged mountains

    const [t, m] = this.climate(x, z);

    // rivers carve where river noise crosses zero on land
    const rv = Math.abs(this.river.fbm2(wx * 0.0016, wz * 0.0016, 2));
    let riverDepth = 0;
    if (h > SEA_LEVEL - 2 && rv < 0.045) {
      const f = 1 - rv / 0.045;
      riverDepth = f * f * (h - (SEA_LEVEL - 3));
    }

    let biome;
    if (h < SEA_LEVEL - 3) biome = t < 0.22 ? 'frozen_ocean' : 'ocean';
    else if (h < SEA_LEVEL + 1.5) biome = t > 0.65 && m < 0.4 ? 'desert' : 'beach';
    else if (mtn > 0.45 && h > SEA_LEVEL + 26) biome = t < 0.3 ? 'frozen_mountains' : 'mountains';
    else if (t < 0.25) biome = m > 0.5 ? 'snowy_taiga' : 'snowy_plains';
    else if (t > 0.72 && m < 0.32) biome = 'desert';
    else if (t > 0.66 && m > 0.62) biome = 'jungle';
    else if (t > 0.6 && m < 0.45) biome = 'savanna';
    else if (m > 0.72 && h < SEA_LEVEL + 6) biome = 'swamp';
    else if (m > 0.62) biome = 'dark_forest';
    else if (m > 0.45) biome = t < 0.42 ? 'taiga' : 'forest';
    else if (m > 0.36) biome = 'birch_forest';
    else biome = 'plains';

    if (BIOMES[biome].flat) h = SEA_LEVEL + 1 + det * 1.5; // swamps hug sea level
    h -= riverDepth;
    if (riverDepth > 0.5 && h >= SEA_LEVEL) h = SEA_LEVEL - 1;

    return { h: Math.max(4, Math.min(HEIGHT - 6, h)), biome };
  }

  carveCave(x, y, z, surface) {
    if (y < 6 || y > surface + 1) return false;
    const s1 = this.cave1.noise3D(x * 0.018, y * 0.026, z * 0.018);
    const s2 = this.cave2.noise3D(x * 0.018 + 300, y * 0.026, z * 0.018);
    // spaghetti tunnels: two noise fields near zero simultaneously
    if (Math.abs(s1) < 0.07 && Math.abs(s2) < 0.07) return true;
    // cheese caverns, denser deep underground
    const depthBias = Math.max(0, (40 - y) / 40) * 0.22;
    const cv = this.cavern.noise3D(x * 0.011, y * 0.018, z * 0.011);
    return cv > 0.62 - depthBias;
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOL);
    const meta = new Uint8Array(CHUNK_VOL);     // water levels etc.
    const heightmap = new Uint8Array(CHUNK_AREA);
    const biomes = new Uint8Array(CHUNK_AREA);  // biome index per column
    const biomeNames = Object.keys(BIOMES);
    const rng = mulberry32(hash2(this.seed, cx, cz));
    const x0 = cx * CHUNK, z0 = cz * CHUNK;

    // ---- terrain strata --------------------------------------
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wxp = x0 + x, wzp = z0 + z;
      const { h, biome } = this.sample(wxp, wzp);
      const bio = BIOMES[biome];
      const hi = Math.floor(h);
      heightmap[x + z * CHUNK] = hi;
      biomes[x + z * CHUNK] = biomeNames.indexOf(biome);

      for (let y = 0; y <= Math.max(hi, SEA_LEVEL); y++) {
        let id = B.AIR;
        if (y <= hi) {
          if (y === 0 || (y < 3 && rng() < 0.6)) id = B.BEDROCK;
          else if (y === hi) id = (hi < SEA_LEVEL - 1 && bio.top === B.GRASS) ? B.DIRT : bio.top;
          else if (y > hi - 4) id = bio.under && y < hi - 1 ? bio.under : bio.filler;
          else id = B.STONE;
        } else if (y <= SEA_LEVEL) {
          id = B.WATER;
          meta[idx(x, y, z)] = 8; // source
        }
        if (id !== B.AIR) blocks[idx(x, y, z)] = id;
      }
      // frozen water surface
      if (bio.snowy && hi < SEA_LEVEL) {
        blocks[idx(x, SEA_LEVEL, z)] = B.ICE;
      }
    }

    // ---- caves (after strata so heightmap is known) ----------
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const hi = heightmap[x + z * CHUNK];
      for (let y = 4; y <= hi; y++) {
        const i = idx(x, y, z);
        const b = blocks[i];
        if (b === B.BEDROCK || b === B.WATER || b === B.AIR) continue;
        if (this.carveCave(x0 + x, y, z0 + z, hi)) {
          // never carve directly under water columns near the surface
          if (hi <= SEA_LEVEL && y > hi - 3) continue;
          blocks[i] = y < 11 ? B.LAVA : B.AIR;
        }
      }
    }

    // ---- ores ------------------------------------------------
    const placeVein = (id, count, minY, maxY, size) => {
      for (let n = 0; n < count; n++) {
        const ox = (rng() * CHUNK) | 0, oz = (rng() * CHUNK) | 0;
        const oy = minY + ((rng() * (maxY - minY)) | 0);
        for (let s = 0; s < size; s++) {
          const vx = ox + ((rng() * 3) | 0) - 1, vy = oy + ((rng() * 3) | 0) - 1, vz = oz + ((rng() * 3) | 0) - 1;
          if (vx < 0 || vx >= CHUNK || vz < 0 || vz >= CHUNK || vy < 1 || vy >= HEIGHT) continue;
          const i = idx(vx, vy, vz);
          if (blocks[i] === B.STONE) blocks[i] = id;
        }
      }
    };
    placeVein(B.COAL_ORE, 14, 8, 100, 9);
    placeVein(B.IRON_ORE, 10, 4, 56, 6);
    placeVein(B.GOLD_ORE, 3, 4, 28, 5);
    placeVein(B.DIAMOND_ORE, 2, 2, 14, 4);
    placeVein(B.GRAVEL, 4, 12, 70, 10);
    placeVein(B.DIRT, 4, 12, 80, 10);

    // ---- trees (trunks kept >=2 from edge so canopies fit) ---
    for (let z = 2; z < CHUNK - 2; z++) for (let x = 2; x < CHUNK - 2; x++) {
      const bio = BIOMES[biomeNames[biomes[x + z * CHUNK]]];
      if (!bio.trees) continue;
      if (rng() >= bio.trees) continue;
      const hi = heightmap[x + z * CHUNK];
      const ground = blocks[idx(x, hi, z)];
      if (ground !== B.GRASS && ground !== B.SNOWY_GRASS && ground !== B.DIRT) continue;
      if (blocks[idx(x, hi + 1, z)] !== B.AIR) continue;
      const type = bio.treeTypes[(rng() * bio.treeTypes.length) | 0];
      this.placeTree(blocks, x, hi + 1, z, type, rng);
      blocks[idx(x, hi, z)] = B.DIRT;
    }

    const light = computeLight(blocks);
    return { blocks, meta, light, heightmap, biomes, biomeNames };
  }

  placeTree(blocks, x, y, z, type, rng) {
    const set = (px, py, pz, id, soft) => {
      if (px < 0 || px >= CHUNK || pz < 0 || pz >= CHUNK || py < 1 || py >= HEIGHT) return;
      const i = idx(px, py, pz);
      if (soft && blocks[i] !== B.AIR) return;
      blocks[i] = id;
    };
    if (type === 'spruce') {
      const h = 6 + ((rng() * 3) | 0);
      for (let i = 0; i < h; i++) set(x, y + i, z, B.SPRUCE_LOG);
      for (let layer = 0; layer < h - 2; layer++) {
        const ly = y + h - 1 - layer;
        const r = layer % 2 === 0 ? 1 : Math.min(2, 1 + (layer >> 1));
        if (layer === 0) { set(x, ly + 1, z, B.SPRUCE_LEAVES, true); }
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && r > 1) continue;
          if (dx === 0 && dz === 0) continue;
          set(x + dx, ly, z + dz, B.SPRUCE_LEAVES, true);
        }
      }
    } else {
      const leaf = type === 'birch' ? B.BIRCH_LEAVES : B.OAK_LEAVES;
      const log = type === 'birch' ? B.BIRCH_LOG : B.OAK_LOG;
      const h = 4 + ((rng() * 3) | 0);
      for (let i = 0; i < h; i++) set(x, y + i, z, log);
      for (let dy = h - 3; dy <= h; dy++) {
        const r = dy >= h - 1 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < h) continue;
          if (Math.abs(dx) === r && Math.abs(dz) === r && rng() < 0.55) continue;
          set(x + dx, y + dy, z + dz, leaf, true);
        }
      }
    }
  }
}

// ============================================================
// Lighting — sky + block light, packed sky<<4 | block.
// Local flood fill within the chunk (border bleed resolved by
// neighbor remeshes sampling across chunk edges at mesh time).
// ============================================================
export function computeLight(blocks) {
  const light = new Uint8Array(CHUNK_VOL);
  const queue = [];

  // sunlight: pour straight down, then spread sideways
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    let level = 15;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const i = idx(x, y, z);
      const b = blocks[i];
      if (level > 0 && blockDef(b).opaque) level = 0;
      else if (b === B.WATER && level > 0) level = Math.max(0, level - 2);
      else if (blockDef(b).cutout && level > 0) level = Math.max(0, level - 1);
      if (level > 0) { light[i] = level << 4; queue.push(i); }
    }
  }
  floodSky(blocks, light, queue);

  // block light from emitters
  const bq = [];
  for (let i = 0; i < CHUNK_VOL; i++) {
    const e = blockDef(blocks[i]).lightEmit;
    if (e) { light[i] = (light[i] & 0xf0) | e; bq.push(i); }
  }
  floodBlockLight(blocks, light, bq);
  return light;
}

const NB = []; // neighbor offsets in flat index space, with coordinate guards
function neighbors(i, out) {
  const y = (i / CHUNK_AREA) | 0;
  const r = i - y * CHUNK_AREA;
  const z = (r / CHUNK) | 0;
  const x = r - z * CHUNK;
  let n = 0;
  if (x > 0) out[n++] = i - 1;
  if (x < CHUNK - 1) out[n++] = i + 1;
  if (z > 0) out[n++] = i - CHUNK;
  if (z < CHUNK - 1) out[n++] = i + CHUNK;
  if (y > 0) out[n++] = i - CHUNK_AREA;
  if (y < HEIGHT - 1) out[n++] = i + CHUNK_AREA;
  return n;
}
function floodSky(blocks, light, queue) {
  const out = new Int32Array(6);
  while (queue.length) {
    const i = queue.pop();
    const lv = light[i] >> 4;
    if (lv <= 1) continue;
    const n = neighbors(i, out);
    for (let k = 0; k < n; k++) {
      const j = out[k];
      const bd = blockDef(blocks[j]);
      if (bd.opaque) continue;
      let next = lv - 1;
      if (blocks[j] === B.WATER) next = lv - 3;
      if (next > (light[j] >> 4)) {
        light[j] = (light[j] & 0x0f) | (Math.max(0, next) << 4);
        if (next > 1) queue.push(j);
      }
    }
  }
}
function floodBlockLight(blocks, light, queue) {
  const out = new Int32Array(6);
  while (queue.length) {
    const i = queue.pop();
    const lv = light[i] & 0x0f;
    if (lv <= 1) continue;
    const n = neighbors(i, out);
    for (let k = 0; k < n; k++) {
      const j = out[k];
      if (blockDef(blocks[j]).opaque) continue;
      const next = lv - 1;
      if (next > (light[j] & 0x0f)) {
        light[j] = (light[j] & 0xf0) | next;
        if (next > 1) queue.push(j);
      }
    }
  }
}
