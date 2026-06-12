// ============================================================
// TextureAtlas — every texture in the game is generated at boot
// on a canvas: 16x16 tiles of 16px pixels (256x256 atlas), plus
// isometric block icons and pixel-art item icons for the UI.
// No proprietary assets, everything procedural + deterministic.
// ============================================================
import { mulberry32 } from '../world/constants.js';

export const TILE = 16, TILES = 16, ATLAS = TILE * TILES;

function shade(hex, f) {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * f)) | 0;
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * f)) | 0;
  const b = Math.min(255, Math.max(0, (hex & 255) * f)) | 0;
  return `rgb(${r},${g},${b})`;
}

export class TextureAtlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS;
    this.ctx = this.canvas.getContext('2d');
    this.blockIcons = new Map();
    this.itemIcons = new Map();
    this.paintAll();
  }

  tilePos(i) { return [(i % TILES) * TILE, ((i / TILES) | 0) * TILE]; }

  // speckled base fill — the core Minecraft-y texture look
  speckle(i, base, vary = 0.16, seed = 1) {
    const [tx, ty] = this.tilePos(i);
    const rng = mulberry32(i * 7919 + seed);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      this.ctx.fillStyle = shade(base, 1 - vary / 2 + rng() * vary);
      this.ctx.fillRect(tx + x, ty + y, 1, 1);
    }
  }
  px(i, x, y, color) { const [tx, ty] = this.tilePos(i); this.ctx.fillStyle = color; this.ctx.fillRect(tx + x, ty + y, 1, 1); }
  clearTile(i) { const [tx, ty] = this.tilePos(i); this.ctx.clearRect(tx, ty, TILE, TILE); }
  spots(i, color, count, seed, size = 1) {
    const rng = mulberry32(i * 31 + seed);
    for (let n = 0; n < count; n++) {
      const x = (rng() * (TILE - size)) | 0, y = (rng() * (TILE - size)) | 0;
      const [tx, ty] = this.tilePos(i);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(tx + x, ty + y, size, size);
    }
  }
  ore(i, color) {
    this.speckle(i, 0x7d7d7d, 0.18, 4);
    const rng = mulberry32(i * 131);
    for (let n = 0; n < 5; n++) {
      const x = 1 + ((rng() * 12) | 0), y = 1 + ((rng() * 12) | 0);
      this.spotsAt(i, x, y, color);
    }
  }
  spotsAt(i, x, y, hex) {
    this.px(i, x, y, shade(hex, 1.15));
    this.px(i, x + 1, y, shade(hex, 0.9));
    this.px(i, x, y + 1, shade(hex, 0.9));
    this.px(i, x + 1, y + 1, shade(hex, 0.7));
  }
  logSide(i, bark, dark) {
    this.speckle(i, bark, 0.1, i);
    const rng = mulberry32(i * 53);
    for (let x = 0; x < TILE; x += 2 + ((rng() * 2) | 0)) {
      for (let y = 0; y < TILE; y++) if (rng() < 0.8) this.px(i, x, y, shade(dark, 0.9 + rng() * 0.2));
    }
  }
  logTop(i, bark, inner) {
    this.speckle(i, bark, 0.1, i);
    const [tx, ty] = this.tilePos(i);
    for (let r = 6; r >= 1; r -= 1.6) {
      this.ctx.fillStyle = shade(inner, r % 3 < 1.6 ? 1.05 : 0.88);
      this.ctx.fillRect(tx + 8 - r, ty + 8 - r, r * 2, r * 2);
    }
  }
  leaves(i, base) {
    this.clearTile(i);
    const rng = mulberry32(i * 977);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (rng() < 0.82) this.px(i, x, y, shade(base, 0.7 + rng() * 0.55));
    }
  }

  paintAll() {
    const c = this;
    c.speckle(0, 0x6ea44c, 0.2, 2);                                // grass top
    c.speckle(1, 0x7d7d7d, 0.18, 4);                               // stone
    c.speckle(2, 0x866043, 0.2, 3);                                // dirt
    c.speckle(3, 0x866043, 0.2, 3);                                // grass side
    { const rng = mulberry32(99); for (let x = 0; x < TILE; x++) { const d = (rng() * 3) | 0; for (let y = 0; y <= 2 + d; y++) c.px(3, x, y, shade(0x5e9442, 0.85 + rng() * 0.35)); } }
    c.speckle(4, 0x7a7a7a, 0.1, 8);                                // cobblestone
    { const rng = mulberry32(404); for (let n = 0; n < 9; n++) { const x = (rng() * 12) | 0, y = (rng() * 12) | 0, s = 3 + ((rng() * 3) | 0); const [tx, ty] = c.tilePos(4); c.ctx.fillStyle = shade(0x8a8a8a, 0.7 + rng() * 0.55); c.ctx.fillRect(tx + x, ty + y, s, s); c.ctx.fillStyle = shade(0x4a4a4a, 1); c.ctx.fillRect(tx + x, ty + y + s - 1, s, 1); } }
    c.speckle(5, 0xd9cf9a, 0.1, 5);                                // sand
    c.speckle(6, 0xd6c585, 0.08, 6);                               // sandstone side
    { for (let y = 0; y < TILE; y += 4) for (let x = 0; x < TILE; x++) c.px(6, x, y, shade(0xb8a564, 1)); }
    c.speckle(7, 0xdccf8e, 0.06, 7);                               // sandstone top
    c.speckle(8, 0x8a8076, 0.25, 9);                               // gravel
    c.logSide(9, 0x6b5232, 0x4a3a22);                              // oak log
    c.logTop(10, 0x6b5232, 0xb8945f);
    c.leaves(11, 0x3f7a28);                                        // oak leaves
    c.logSide(12, 0xd7d3c8, 0x3c3c38);                             // birch log
    c.logTop(13, 0xd7d3c8, 0xc9b27a);
    c.leaves(14, 0x60a04a);                                        // birch leaves
    c.logSide(15, 0x4a3525, 0x33241a);                             // spruce log
    c.logTop(16, 0x4a3525, 0x8a6a42);
    c.leaves(17, 0x2c5430);                                        // spruce leaves
    // water / lava (animated by shader scroll, painted soft)
    { c.speckle(18, 0x3056c8, 0.12, 11); const [tx, ty] = c.tilePos(18); c.ctx.globalAlpha = 0.75; c.ctx.fillStyle = '#2a4cb4'; c.ctx.fillRect(tx, ty, TILE, TILE); c.ctx.globalAlpha = 1; }
    { c.speckle(19, 0xd96514, 0.3, 12); c.spots(19, '#ffe23d', 14, 5, 2); c.spots(19, '#7a1f00', 10, 9, 2); }
    c.ore(20, 0x2e2e2e);                                           // coal
    c.ore(21, 0xd8af93);                                           // iron
    c.ore(22, 0xfcee4b);                                           // gold
    c.ore(23, 0x4aedd9);                                           // diamond
    { c.speckle(24, 0x3a3a3a, 0.45, 13); }                         // bedrock
    { c.clearTile(25); const [tx, ty] = c.tilePos(25); c.ctx.fillStyle = 'rgba(210,235,244,0.95)'; c.ctx.fillRect(tx, ty, TILE, 1); c.ctx.fillRect(tx, ty + 15, TILE, 1); c.ctx.fillRect(tx, ty, 1, TILE); c.ctx.fillRect(tx + 15, ty, 1, TILE); c.ctx.fillStyle = 'rgba(255,255,255,0.55)'; c.ctx.fillRect(tx + 2, ty + 2, 1, 4); c.ctx.fillRect(tx + 3, ty + 2, 1, 2); c.ctx.fillRect(tx + 11, ty + 10, 1, 3); } // glass
    { c.speckle(26, 0xa3804f, 0.08, 14); for (let y = 3; y < TILE; y += 4) { const [tx, ty] = c.tilePos(26); c.ctx.fillStyle = shade(0x6e5433, 1); c.ctx.fillRect(tx, ty + y, TILE, 1); } } // planks
    { c.speckle(27, 0xa3804f, 0.08, 15); const [tx, ty] = c.tilePos(27); c.ctx.fillStyle = '#5c4426'; c.ctx.fillRect(tx + 1, ty + 1, 6, 6); c.ctx.fillRect(tx + 9, ty + 9, 6, 6); c.ctx.fillStyle = '#7d8da0'; c.ctx.fillRect(tx + 1, ty + 9, 6, 6); c.ctx.fillRect(tx + 9, ty + 1, 6, 6); } // crafting top (grid look)
    { c.speckle(28, 0xa3804f, 0.08, 16); const [tx, ty] = c.tilePos(28); c.ctx.fillStyle = '#5c4426'; c.ctx.fillRect(tx + 2, ty + 4, 5, 5); c.ctx.fillStyle = '#caa56b'; c.ctx.fillRect(tx + 9, ty + 4, 5, 5); } // crafting side
    { c.speckle(29, 0x6f6f6f, 0.14, 17); const [tx, ty] = c.tilePos(29); c.ctx.fillStyle = '#1d1d1d'; c.ctx.fillRect(tx + 4, ty + 7, 8, 6); } // furnace front
    c.speckle(30, 0x6f6f6f, 0.14, 18);                             // furnace side
    c.speckle(31, 0x7a7a7a, 0.12, 19);                             // furnace top
    { c.speckle(32, 0x6f6f6f, 0.14, 17); const [tx, ty] = c.tilePos(32); c.ctx.fillStyle = '#1d1d1d'; c.ctx.fillRect(tx + 4, ty + 7, 8, 6); c.ctx.fillStyle = '#ff9a1f'; c.ctx.fillRect(tx + 5, ty + 9, 6, 3); c.ctx.fillStyle = '#ffe23d'; c.ctx.fillRect(tx + 6, ty + 10, 4, 2); } // lit furnace
    { c.clearTile(33); const [tx, ty] = c.tilePos(33); c.ctx.fillStyle = '#6b5232'; c.ctx.fillRect(tx + 7, ty + 8, 2, 8); c.ctx.fillStyle = '#ffd83d'; c.ctx.fillRect(tx + 7, ty + 6, 2, 2); c.ctx.fillStyle = '#fff7c4'; c.ctx.fillRect(tx + 7, ty + 6, 2, 1); } // torch
    c.speckle(34, 0xeef3f5, 0.05, 20);                             // snow
    { c.speckle(35, 0x866043, 0.2, 3); const rng = mulberry32(321); for (let x = 0; x < TILE; x++) { const d = (rng() * 2) | 0; for (let y = 0; y <= 3 + d; y++) c.px(35, x, y, shade(0xeef3f5, 0.92 + rng() * 0.1)); } } // snowy grass side
    c.speckle(36, 0xe7e7e7, 0.07, 21);                             // wool
    { c.speckle(37, 0x9fc4ec, 0.08, 22); const [tx, ty] = c.tilePos(37); c.ctx.fillStyle = 'rgba(255,255,255,0.5)'; c.ctx.fillRect(tx + 3, ty + 3, 1, 5); c.ctx.fillRect(tx + 10, ty + 8, 1, 4); } // ice

    // crack overlay stages on row 15 (tiles 240..249)
    for (let s = 0; s < 10; s++) {
      const i = 240 + s;
      c.clearTile(i);
      const rng = mulberry32(s * 17 + 5);
      const n = 6 + s * 7;
      for (let k = 0; k < n; k++) c.px(i, (rng() * TILE) | 0, (rng() * TILE) | 0, 'rgba(20,16,12,0.85)');
    }
  }

  // 3D isometric icon for a block (top + two shaded sides)
  blockIcon(blockId, faceTexture) {
    if (this.blockIcons.has(blockId)) return this.blockIcons.get(blockId);
    const s = 48;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const tile = (f) => { const [tx, ty] = this.tilePos(faceTexture(blockId, f)); return [tx, ty]; };
    const w = 20, h = 10, bh = 22, cx = s / 2, cy = 8;
    // top
    let [tx, ty] = tile(2);
    g.save(); g.setTransform(1, 0.5, -1, 0.5, cx, cy + h);
    g.drawImage(this.canvas, tx, ty, TILE, TILE, 0, -TILE / 2 * 0, w / 1.42, w / 1.42); g.restore();
    // left (west face) darker
    [tx, ty] = tile(1);
    g.save(); g.setTransform(1, 0.5, 0, 1, cx - w, cy + h - w / 2 + 10);
    g.globalAlpha = 1; g.drawImage(this.canvas, tx, ty, TILE, TILE, 0, 0, w, bh); g.restore();
    g.save(); g.setTransform(1, 0.5, 0, 1, cx - w, cy + h - w / 2 + 10);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, bh); g.restore();
    // right (south face) darkest
    [tx, ty] = tile(4);
    g.save(); g.setTransform(1, -0.5, 0, 1, cx, cy + h + 10);
    g.drawImage(this.canvas, tx, ty, TILE, TILE, 0, 0, w, bh);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 0, w, bh); g.restore();
    const url = cv.toDataURL();
    this.blockIcons.set(blockId, url);
    return url;
  }

  // pixel-art icon from a string map
  pixelIcon(key, rows, palette) {
    if (this.itemIcons.has(key)) return this.itemIcons.get(key);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== ' ' && palette[ch]) { g.fillStyle = palette[ch]; g.fillRect(x, y, 1, 1); }
      });
    });
    const url = cv.toDataURL();
    this.itemIcons.set(key, url);
    return url;
  }
}

// ---- item icon shape maps -----------------------------------
const TOOL_SHAPES = {
  pickaxe: [
    '   mmmmmm   ',
    '  mm    mm  ',
    ' mm      mm ',
    ' m    hh  m ',
    '     hh   m ',
    '    hh      ',
    '   hh       ',
    '  hh        ',
    ' hh         ',
    'hh          ',
  ],
  axe: [
    '   mmm    ',
    '  mmmmm   ',
    '  mmhmm   ',
    '  mmh m   ',
    '   hh     ',
    '   hh     ',
    '  hh      ',
    '  hh      ',
    ' hh       ',
    ' hh       ',
  ],
  shovel: [
    '    mm    ',
    '   mmmm   ',
    '   mmmm   ',
    '    hh    ',
    '    hh    ',
    '    hh    ',
    '   hh     ',
    '   hh     ',
    '  hh      ',
    '  hh      ',
  ],
  sword: [
    '       mm ',
    '      mmm ',
    '     mmm  ',
    '    mmm   ',
    '   mmm    ',
    '  mmm     ',
    ' hmm      ',
    'hhh       ',
    'hh        ',
  ],
};
const TIER_COLORS = { wooden: '#9a7242', stone: '#8c8c8c', iron: '#dadada', golden: '#f6d33c', diamond: '#52e3d4' };
const FLAT_ICONS = {
  stick: [['  b', ' b ', 'b  '], { b: '#8a6a3c' }],
  coal: [[' bb ', 'bbbb', 'bbbb', ' bb '], { b: '#2c2c2c' }],
  iron_ingot: [['  ww ', ' wwww', 'wwww ', 'www  '], { w: '#dcdcdc' }],
  gold_ingot: [['  gg ', ' gggg', 'gggg ', 'ggg  '], { g: '#f6d33c' }],
  diamond: [['  dd  ', ' dDDd ', 'dDDDDd', ' dDDd ', '  dd  '], { d: '#34b8aa', D: '#7df0e3' }],
  apple: [['  s  ', ' rrr ', 'rrRrr', 'rrrrr', ' rrr '], { r: '#d23b2e', R: '#ff8a7a', s: '#5b3d22' }],
  porkchop: [[' pp ', 'pppP', 'pPPP', ' bb '], { p: '#f0a0a8', P: '#ffd1d6', b: '#d8c8a8' }],
  cooked_porkchop: [[' pp ', 'pppP', 'pPPP', ' bb '], { p: '#b8743c', P: '#e0a86a', b: '#d8c8a8' }],
  beef: [[' rr ', 'rrrR', 'rRRR', ' rr '], { r: '#b3322c', R: '#e88a80' }],
  cooked_beef: [[' rr ', 'rrrR', 'rRRR', ' rr '], { r: '#6e3a22', R: '#a8693c' }],
  feather: [['   w', '  ww', ' ww ', 'ww  ', 'w   '], { w: '#f0f0f0' }],
};

export function itemIconURL(atlas, itemId, blockId) {
  if (blockId != null) {
    // imported lazily by caller with faceTexture to avoid circular import
    return null;
  }
  const m = itemId.match(/^(wooden|stone|iron|golden|diamond)_(pickaxe|axe|shovel|sword)$/);
  if (m) {
    const rows = TOOL_SHAPES[m[2]].map(r => r.padEnd(16, ' '));
    return atlas.pixelIcon(itemId, rows, { m: TIER_COLORS[m[1]], h: '#8a6a3c' });
  }
  const flat = FLAT_ICONS[itemId];
  if (flat) {
    const pad = flat[0].map(r => ('      ' + r).padEnd(16, ' '));
    const rows = Array(5).fill('').concat(pad).slice(0, 16);
    return atlas.pixelIcon(itemId, rows, flat[1]);
  }
  return atlas.pixelIcon(itemId, ['????'], { '?': '#f0f' });
}

// paint an item's pixel-art directly into an atlas tile (for 3D drops)
export function paintItemTile(atlas, itemId, tile) {
  const [tx, ty] = atlas.tilePos(tile);
  atlas.ctx.clearRect(tx, ty, TILE, TILE);
  const m = itemId.match(/^(wooden|stone|iron|golden|diamond)_(pickaxe|axe|shovel|sword)$/);
  let rows = null, palette = null;
  if (m) {
    rows = TOOL_SHAPES[m[2]].map(r => ('  ' + r).padEnd(16, ' '));
    rows = Array(3).fill('').concat(rows).slice(0, 16);
    palette = { m: TIER_COLORS[m[1]], h: '#8a6a3c' };
  } else if (FLAT_ICONS[itemId]) {
    const f = FLAT_ICONS[itemId];
    rows = Array(5).fill('').concat(f[0].map(r => ('      ' + r).padEnd(16, ' '))).slice(0, 16);
    palette = f[1];
  } else {
    rows = ['????']; palette = { '?': '#f0f' };
  }
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== ' ' && palette[ch]) { atlas.ctx.fillStyle = palette[ch]; atlas.ctx.fillRect(tx + x, ty + y, 1, 1); }
    });
  });
}

// mob skins live in atlas row 3 (tiles 48..62): body tile + face tile
export const MOB_TILES = {
  cow:      { body: 48, face: 49, legs: 62 },
  pig:      { body: 50, face: 51, legs: 50 },
  sheep:    { body: 52, face: 53, legs: 62 },
  chicken:  { body: 54, face: 55, legs: 56 },
  zombie:   { body: 57, face: 58, legs: 57 },
  skeleton: { body: 59, face: 60, legs: 59 },
  creeper:  { body: 61, face: 63, legs: 61 },
};
export function paintMobTiles(atlas) {
  const c = atlas;
  const face = (tile, base, eye, mouth, opts = {}) => {
    c.speckle(tile, base, 0.12, tile);
    c.px(tile, 4, 6, eye); c.px(tile, 5, 6, eye);
    c.px(tile, 10, 6, eye); c.px(tile, 11, 6, eye);
    if (mouth) { for (let x = opts.mx0 ?? 6; x <= (opts.mx1 ?? 9); x++) for (let y = opts.my0 ?? 10; y <= (opts.my1 ?? 12); y++) c.px(tile, x, y, mouth); }
  };
  c.speckle(48, 0x5b3a26, 0.18, 48); c.spots(48, '#e8e2d8', 10, 7, 3);     // cow hide
  face(49, 0x5b3a26, '#1d1d1d', '#d8b9a4', { my0: 9, my1: 13, mx0: 5, mx1: 10 }); // cow face + muzzle
  c.speckle(50, 0xefa0a8, 0.08, 50);                                       // pig
  face(51, 0xefa0a8, '#1d1d1d', '#d96a78', { my0: 8, my1: 11 });           // pig snout
  c.speckle(52, 0xe9e9e9, 0.1, 52);                                        // sheep wool
  face(53, 0xc9a98c, '#1d1d1d', null);                                     // sheep face
  c.speckle(54, 0xf4f4f4, 0.06, 54);                                       // chicken
  face(55, 0xf4f4f4, '#1d1d1d', '#e8a13c', { my0: 8, my1: 10, mx0: 7, mx1: 8 }); // beak
  c.speckle(56, 0xe8c33c, 0.15, 56);                                       // chicken legs
  c.speckle(57, 0x44704a, 0.16, 57);                                       // zombie skin
  face(58, 0x44704a, '#101418', '#2c4a30');
  c.speckle(59, 0xc8c8c0, 0.1, 59);                                        // skeleton bone
  face(60, 0xc8c8c0, '#16181c', '#5a5a54', { my0: 10, my1: 11 });
  { // creeper camo
    c.speckle(61, 0x4caa48, 0.1, 61);
    const rng = mulberry32(6161);
    for (let n = 0; n < 26; n++) c.px(61, (rng() * 16) | 0, (rng() * 16) | 0, n % 2 ? '#2c7a30' : '#7ad06a');
  }
  { // creeper face — the icon look
    c.speckle(63, 0x4caa48, 0.1, 63);
    const k = '#101810';
    for (const [x, y, w, h] of [[3,4,3,3],[10,4,3,3],[6,7,4,4],[5,10,2,3],[9,10,2,3]]) {
      const [tx, ty] = c.tilePos(63);
      c.ctx.fillStyle = k; c.ctx.fillRect(tx + x, ty + y, w, h);
    }
  }
  c.speckle(62, 0x3c2c1e, 0.14, 62);                                       // dark legs
}
