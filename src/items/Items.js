// ============================================================
// Item registry — block items + materials + food + tiered tools
// Item stacks are plain objects: { id, count, durability? }
// Block items use id 'block:<blockId>'
// ============================================================
import { B, blockDef } from '../world/Blocks.js';
import { TOOL } from '../world/Blocks.js';

export const TIERS = {
  wooden:  { tier: 1, speed: 2,  durability: 60,  damage: 1 },
  stone:   { tier: 2, speed: 4,  durability: 132, damage: 2 },
  iron:    { tier: 3, speed: 6,  durability: 251, damage: 3 },
  golden:  { tier: 3, speed: 12, durability: 33,  damage: 1 },
  diamond: { tier: 5, speed: 8,  durability: 1562, damage: 4 },
};

export const ITEMS = {};
function item(id, name, opts = {}) { ITEMS[id] = Object.assign({ id, name, stack: 64 }, opts); return ITEMS[id]; }

item('stick', 'Stick');
item('coal', 'Coal');
item('iron_ingot', 'Iron Ingot');
item('gold_ingot', 'Gold Ingot');
item('diamond', 'Diamond');
item('apple', 'Apple', { food: 4 });
item('porkchop', 'Raw Porkchop', { food: 3 });
item('cooked_porkchop', 'Cooked Porkchop', { food: 8 });
item('beef', 'Raw Beef', { food: 3 });
item('cooked_beef', 'Steak', { food: 8 });
item('feather', 'Feather');

for (const mat of Object.keys(TIERS)) {
  const t = TIERS[mat];
  const cap = mat[0].toUpperCase() + mat.slice(1);
  item(mat + '_pickaxe', cap + ' Pickaxe', { tool: TOOL.PICK,   ...t, stack: 1, damage: t.damage + 1 });
  item(mat + '_axe',     cap + ' Axe',     { tool: TOOL.AXE,    ...t, stack: 1, damage: t.damage + 2 });
  item(mat + '_shovel',  cap + ' Shovel',  { tool: TOOL.SHOVEL, ...t, stack: 1, damage: t.damage });
  item(mat + '_sword',   cap + ' Sword',   { tool: TOOL.SWORD,  ...t, stack: 1, damage: t.damage + 3 });
}

export function itemDef(id) {
  if (id == null) return null;
  if (id.startsWith('block:')) {
    const bid = +id.slice(6);
    return { id, name: blockDef(bid).name, stack: 64, block: bid };
  }
  return ITEMS[id] || null;
}
export function blockItem(bid) { return 'block:' + bid; }
export function isTool(id) { const d = itemDef(id); return d && d.tool; }
export function maxStack(id) { const d = itemDef(id); return d ? d.stack : 64; }

// mining speed multiplier of an item against a block
export function miningSpeed(itemId, blockId) {
  const bd = blockDef(blockId);
  const id = itemDef(itemId);
  if (id && id.tool && id.tool === bd.tool) return id.speed;
  return 1;
}
// can this item harvest drops from a block?
export function canHarvest(itemId, blockId) {
  const bd = blockDef(blockId);
  if (!bd.minTier) return true;
  const id = itemDef(itemId);
  return !!(id && id.tool === bd.tool && id.tier >= bd.minTier);
}
export { B };
