// ============================================================
// Crafting — shaped + shapeless recipes, data driven.
// Shaped patterns use a key map; '#' rows are trimmed to the
// bounding box, so a 2x2 recipe works anywhere in a 3x3 grid.
// ============================================================
import { blockItem, B } from '../items/Items.js';

const P = blockItem(B.PLANKS), LOGS = [blockItem(B.OAK_LOG), blockItem(B.BIRCH_LOG), blockItem(B.SPRUCE_LOG)];

export const RECIPES = [];
function shaped(pattern, key, result, count = 1) { RECIPES.push({ type: 'shaped', pattern, key, result, count }); }
function shapeless(inputs, result, count = 1) { RECIPES.push({ type: 'shapeless', inputs, result, count }); }

// basics
for (const log of LOGS) shapeless([log], P, 4);
shaped(['#', '#'], { '#': P }, 'stick', 4);
shaped(['##', '##'], { '#': P }, blockItem(B.CRAFTING_TABLE), 1);
shaped(['###', '# #', '###'], { '#': blockItem(B.COBBLE) }, blockItem(B.FURNACE), 1);
shaped(['c', 's'], { c: 'coal', s: 'stick' }, blockItem(B.TORCH), 4);
shaped(['##', '##'], { '#': blockItem(B.SAND) }, blockItem(B.SANDSTONE), 1);

// tools per tier
const MATS = { wooden: P, stone: blockItem(B.COBBLE), iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [mat, m] of Object.entries(MATS)) {
  shaped(['mmm', ' s ', ' s '], { m, s: 'stick' }, mat + '_pickaxe');
  shaped(['mm', 'ms', ' s'], { m, s: 'stick' }, mat + '_axe');
  shaped(['m', 's', 's'], { m, s: 'stick' }, mat + '_shovel');
  shaped(['m', 'm', 's'], { m, s: 'stick' }, mat + '_sword');
}

// --- matching -------------------------------------------------
// grid: array of itemIds (null for empty), size*size (2 or 3)
function bbox(grid, size) {
  let minR = size, maxR = -1, minC = size, maxC = -1;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (grid[r * size + c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  }
  if (maxR < 0) return null;
  const rows = [];
  for (let r = minR; r <= maxR; r++) {
    const row = [];
    for (let c = minC; c <= maxC; c++) row.push(grid[r * size + c]);
    rows.push(row);
  }
  return rows;
}
function matchShaped(rows, recipe, mirror) {
  const pat = recipe.pattern;
  if (rows.length !== pat.length) return false;
  const w = pat[0].length;
  for (const row of pat) if (row.length !== w) return false; // patterns are rectangular
  if (rows[0].length !== w) return false;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < w; c++) {
    const ch = pat[r][mirror ? w - 1 - c : c];
    const want = ch === ' ' ? null : recipe.key[ch];
    if ((rows[r][c] || null) !== (want || null)) return false;
  }
  return true;
}
export function matchRecipe(grid, size) {
  const rows = bbox(grid, size);
  if (!rows) return null;
  const present = grid.filter(Boolean);
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (present.length !== r.inputs.length) continue;
      const pool = [...present];
      let ok = true;
      for (const need of r.inputs) {
        const i = pool.indexOf(need);
        if (i < 0) { ok = false; break; }
        pool.splice(i, 1);
      }
      if (ok) return r;
    } else {
      if (matchShaped(rows, r, false) || matchShaped(rows, r, true)) return r;
    }
  }
  return null;
}

// --- smelting -------------------------------------------------
export const SMELTING = {
  [blockItem(B.COBBLE)]: blockItem(B.STONE),
  [blockItem(B.SAND)]: blockItem(B.GLASS),
  [blockItem(B.IRON_ORE)]: 'iron_ingot',
  [blockItem(B.GOLD_ORE)]: 'gold_ingot',
  'porkchop': 'cooked_porkchop',
  'beef': 'cooked_beef',
};
export const FUEL = { // burn seconds
  'coal': 80,
  [blockItem(B.PLANKS)]: 15,
  [blockItem(B.OAK_LOG)]: 15, [blockItem(B.BIRCH_LOG)]: 15, [blockItem(B.SPRUCE_LOG)]: 15,
  'stick': 5,
  [blockItem(B.CRAFTING_TABLE)]: 15,
};
export const SMELT_TIME = 10; // seconds per item
