// ============================================================
// ChunkMesher — converts a chunk + its neighbors into vertex
// arrays. Pure (no WebGL), so it is unit-testable in node.
//
// Vertex layout (8 floats): x y z | u v | sky block ao
// Faces are emitted only where a neighbor doesn't hide them;
// light is smoothed across the 4 cells touching each vertex and
// classic 3-sample ambient occlusion darkens inner corners.
// ============================================================
import { CHUNK, HEIGHT } from '../world/constants.js';
import { B, blockDef, faceTexture } from '../world/Blocks.js';

const ATLAS_TILES = 16;
const INSET = 1 / 512; // half texel at 256px — stops atlas bleeding

// face = axis(0..2) + sign; order: +x -x +y -y +z -z
const FACE_DEFS = [];
for (const [axis, sign, faceId] of [[0,1,0],[0,-1,1],[1,1,2],[1,-1,3],[2,1,4],[2,-1,5]]) {
  const t1 = axis === 0 ? 1 : 0;            // first tangent axis
  const t2 = axis === 2 ? 1 : 2;            // second tangent axis
  const corners = [];
  for (const [a, b] of [[0,0],[1,0],[1,1],[0,1]]) {
    const p = [0, 0, 0];
    p[axis] = sign > 0 ? 1 : 0;
    p[t1] = a; p[t2] = b;
    corners.push({ p, a, b });
  }
  FACE_DEFS.push({ axis, sign, faceId, t1, t2, corners });
}

function tileUV(tile, u, v) {
  const col = tile % ATLAS_TILES, row = (tile / ATLAS_TILES) | 0;
  return [
    (col + INSET + u * (1 - 2 * INSET * ATLAS_TILES)) / ATLAS_TILES,
    (row + INSET + v * (1 - 2 * INSET * ATLAS_TILES)) / ATLAS_TILES,
  ];
}

export function buildChunkMesh(world, chunk) {
  const opaque = [], water = [];
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;

  const get = (x, y, z) => {
    if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y >= 0 && y < HEIGHT) return chunk.get(x, y, z);
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    // border: a missing neighbor reads as opaque so we don't draw frontier walls
    const wx = x0 + x, wz = z0 + z;
    if (!world.isLoaded(wx, wz)) return B.STONE;
    return world.getBlock(wx, y, wz);
  };
  const getLight = (x, y, z) => {
    if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y >= 0 && y < HEIGHT) return chunk.getLight(x, y, z);
    return world.getLight(x0 + x, y, z0 + z);
  };

  const pushQuad = (out, verts, flip) => {
    const order = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    for (const i of order) out.push(...verts[i]);
  };

  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const id = chunk.get(x, y, z);
    if (id === B.AIR) continue;
    const def = blockDef(id);

    if (def.custom === 'torch') { emitTorch(opaque, chunk, x, y, z); continue; }

    const isWater = id === B.WATER;
    const isLava = id === B.LAVA;
    const out = isWater ? water : opaque;
    const fluidTop = (isWater || isLava) && get(x, y + 1, z) !== id ? 0.875 : 1;

    for (const fd of FACE_DEFS) {
      const nx = x + (fd.axis === 0 ? fd.sign : 0);
      const ny = y + (fd.axis === 1 ? fd.sign : 0);
      const nz = z + (fd.axis === 2 ? fd.sign : 0);
      const nb = get(nx, ny, nz);
      const nd = blockDef(nb);

      if (isWater || isLava) {
        if (nb === id) continue;                 // fluid against itself
        if (nd.opaque) continue;                 // hidden by solid
        if (fd.faceId === 3 && nd.solid) continue;
      } else if (def.cutout || !def.opaque) {
        if (nd.opaque) continue;
        if (nb === id) continue;                 // glass-glass, leaf-leaf
      } else {
        if (nd.opaque) continue;
      }

      const tile = faceTexture(id, fd.faceId);
      const verts = [];
      const aos = [];
      for (const c of fd.corners) {
        const px = x + c.p[0], py = y + c.p[1], pz = z + c.p[2];
        // ---- ambient occlusion + smooth light --------------
        const base = [x, y, z];
        base[fd.axis] += fd.sign;
        const d1 = c.a ? 1 : -1, d2 = c.b ? 1 : -1;
        const s1p = [...base]; s1p[fd.t1] += d1;
        const s2p = [...base]; s2p[fd.t2] += d2;
        const cnp = [...base]; cnp[fd.t1] += d1; cnp[fd.t2] += d2;
        const o1 = blockDef(get(...s1p)).opaque ? 1 : 0;
        const o2 = blockDef(get(...s2p)).opaque ? 1 : 0;
        const oc = blockDef(get(...cnp)).opaque ? 1 : 0;
        const ao = (o1 && o2) ? 0 : 3 - (o1 + o2 + oc);
        // smooth light: average non-opaque sample cells
        let sky = 0, blk = 0, n = 0;
        const samples = [base, s1p, s2p];
        if (!(o1 && o2)) samples.push(cnp);
        for (const sp of samples) {
          if (blockDef(get(...sp)).opaque) continue;
          const lv = getLight(...sp);
          sky += lv >> 4; blk += lv & 15; n++;
        }
        if (!n) { const lv = getLight(...base); sky = lv >> 4; blk = lv & 15; n = 1; }
        sky /= n; blk /= n;
        if (def.lightEmit) blk = Math.max(blk, def.lightEmit);

        // ---- position + uv ---------------------------------
        let vy = py;
        if ((isWater || isLava) && c.p[1] === 1) vy = y + fluidTop;
        let u, v;
        if (fd.axis === 1) { u = c.p[0]; v = c.p[2]; }
        else if (fd.axis === 0) { u = c.p[2]; v = 1 - c.p[1]; }
        else { u = c.p[0]; v = 1 - c.p[1]; }
        const [tu, tv] = tileUV(tile, u, v);
        verts.push([px + x0, vy, pz + z0, tu, tv, sky / 15, blk / 15, ao / 3]);
        aos.push(ao);
      }
      // flip quad diagonal so AO interpolates without artifacts
      pushQuad(out, verts, aos[0] + aos[2] < aos[1] + aos[3]);
    }
  }

  return {
    opaque: new Float32Array(opaque),
    water: new Float32Array(water),
  };
}

// small standing torch: 2px square column, 10px tall
function emitTorch(out, chunk, x, y, z) {
  const lv = chunk.getLight(x, y, z);
  const sky = (lv >> 4) / 15, blk = Math.max(lv & 15, 14) / 15;
  const x0 = chunk.cx * CHUNK + x, z0 = chunk.cz * CHUNK + z;
  const a = 7 / 16, b = 9 / 16, h = 10 / 16;
  const quad = (p0, p1, p2, p3, u0, v0, u1, v1) => {
    const [tu0, tv0] = tileUV(33, u0, v0);
    const [tu1, tv1] = tileUV(33, u1, v1);
    const vs = [
      [x0 + p0[0], y + p0[1], z0 + p0[2], tu0, tv1, sky, blk, 1],
      [x0 + p1[0], y + p1[1], z0 + p1[2], tu1, tv1, sky, blk, 1],
      [x0 + p2[0], y + p2[1], z0 + p2[2], tu1, tv0, sky, blk, 1],
      [x0 + p3[0], y + p3[1], z0 + p3[2], tu0, tv0, sky, blk, 1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...vs[i]);
  };
  // four sides sample the central sliver of the torch tile
  quad([a,0,a],[b,0,a],[b,h,a],[a,h,a], 7/16, 6/16, 9/16, 1);
  quad([a,0,b],[b,0,b],[b,h,b],[a,h,b], 7/16, 6/16, 9/16, 1);
  quad([a,0,a],[a,0,b],[a,h,b],[a,h,a], 7/16, 6/16, 9/16, 1);
  quad([b,0,a],[b,0,b],[b,h,b],[b,h,a], 7/16, 6/16, 9/16, 1);
  quad([a,h,a],[b,h,a],[b,h,b],[a,h,b], 7/16, 6/16, 9/16, 8/16); // tip
}
