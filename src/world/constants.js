// ============================================================
// World constants — shared by main thread, workers, and tests
// ============================================================
export const CHUNK = 16;          // chunk width/depth in blocks
export const HEIGHT = 128;        // world height in blocks
export const SEA_LEVEL = 52;      // water surface y
export const CHUNK_AREA = CHUNK * CHUNK;
export const CHUNK_VOL = CHUNK * CHUNK * HEIGHT;

export const DAY_LENGTH = 600;    // seconds per full day/night cycle
export const REACH = 4.5;         // block interaction distance
export const GRAVITY = 26.0;

// index helpers: blocks stored as x + z*CHUNK + y*CHUNK*CHUNK
export function idx(x, y, z) { return x + z * CHUNK + y * CHUNK_AREA; }
export function inBounds(y) { return y >= 0 && y < HEIGHT; }

// deterministic hashing / RNG --------------------------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(seed, x, z) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export function chunkKey(cx, cz) { return cx + ',' + cz; }
