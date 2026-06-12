// ============================================================
// Block registry — data-driven block definitions
// Texture values are atlas tile indices (see TextureAtlas.js)
// tex: single index, or {top, bottom, side} / {top,bottom,north,south,east,west}
// ============================================================
export const B = {
  AIR: 0, STONE: 1, DIRT: 2, GRASS: 3, COBBLE: 4, SAND: 5, SANDSTONE: 6,
  GRAVEL: 7, OAK_LOG: 8, OAK_LEAVES: 9, BIRCH_LOG: 10, BIRCH_LEAVES: 11,
  SPRUCE_LOG: 12, SPRUCE_LEAVES: 13, WATER: 14, LAVA: 15, COAL_ORE: 16,
  IRON_ORE: 17, GOLD_ORE: 18, DIAMOND_ORE: 19, BEDROCK: 20, GLASS: 21,
  PLANKS: 22, CRAFTING_TABLE: 23, FURNACE: 24, FURNACE_LIT: 25, TORCH: 26,
  SNOWY_GRASS: 27, SNOW_BLOCK: 28, WOOL: 29, ICE: 30,
};

// tool requirements: 0 none, tiers: 1 wood, 2 stone, 3 iron, 4 gold(speed), 5 diamond
export const TOOL = { NONE: 'none', PICK: 'pickaxe', AXE: 'axe', SHOVEL: 'shovel', SWORD: 'sword' };

function def(name, opts) {
  return Object.assign({
    name,
    solid: true,          // collidable
    opaque: true,         // blocks light + hides neighbor faces
    fluid: false,
    hardness: 1,          // seconds to break by hand
    tool: TOOL.NONE,      // best tool class
    minTier: 0,           // minimum tool tier required to get a drop
    lightEmit: 0,
    drops: null,          // {item, count} | null = drops itself (as block item)
    cutout: false,        // alpha-tested texture (leaves/glass/torch)
    custom: null,         // custom mesh type ('torch')
  }, opts);
}

export const BLOCKS = [];
BLOCKS[B.AIR]        = def('Air', { solid: false, opaque: false, hardness: 0 });
BLOCKS[B.STONE]      = def('Stone', { tex: 1, hardness: 7.5, tool: TOOL.PICK, minTier: 1, drops: { block: B.COBBLE } });
BLOCKS[B.DIRT]       = def('Dirt', { tex: 2, hardness: 0.75, tool: TOOL.SHOVEL });
BLOCKS[B.GRASS]      = def('Grass Block', { tex: { top: 0, bottom: 2, side: 3 }, hardness: 0.9, tool: TOOL.SHOVEL, drops: { block: B.DIRT } });
BLOCKS[B.COBBLE]     = def('Cobblestone', { tex: 4, hardness: 10, tool: TOOL.PICK, minTier: 1 });
BLOCKS[B.SAND]       = def('Sand', { tex: 5, hardness: 0.75, tool: TOOL.SHOVEL, gravity: true });
BLOCKS[B.SANDSTONE]  = def('Sandstone', { tex: { top: 7, bottom: 7, side: 6 }, hardness: 4, tool: TOOL.PICK, minTier: 1 });
BLOCKS[B.GRAVEL]     = def('Gravel', { tex: 8, hardness: 0.9, tool: TOOL.SHOVEL, gravity: true });
BLOCKS[B.OAK_LOG]    = def('Oak Log', { tex: { top: 10, bottom: 10, side: 9 }, hardness: 3, tool: TOOL.AXE });
BLOCKS[B.OAK_LEAVES] = def('Oak Leaves', { tex: 11, opaque: false, cutout: true, hardness: 0.3, leafDecay: true, drops: { maybe: [{ item: 'apple', chance: 0.05 }] } });
BLOCKS[B.BIRCH_LOG]  = def('Birch Log', { tex: { top: 13, bottom: 13, side: 12 }, hardness: 3, tool: TOOL.AXE });
BLOCKS[B.BIRCH_LEAVES] = def('Birch Leaves', { tex: 14, opaque: false, cutout: true, hardness: 0.3, leafDecay: true, drops: { maybe: [] } });
BLOCKS[B.SPRUCE_LOG] = def('Spruce Log', { tex: { top: 16, bottom: 16, side: 15 }, hardness: 3, tool: TOOL.AXE });
BLOCKS[B.SPRUCE_LEAVES] = def('Spruce Leaves', { tex: 17, opaque: false, cutout: true, hardness: 0.3, leafDecay: true, drops: { maybe: [] } });
BLOCKS[B.WATER]      = def('Water', { tex: 18, solid: false, opaque: false, fluid: true, hardness: Infinity });
BLOCKS[B.LAVA]       = def('Lava', { tex: 19, solid: false, opaque: false, fluid: true, hardness: Infinity, lightEmit: 15 });
BLOCKS[B.COAL_ORE]   = def('Coal Ore', { tex: 20, hardness: 10, tool: TOOL.PICK, minTier: 1, drops: { item: 'coal' } });
BLOCKS[B.IRON_ORE]   = def('Iron Ore', { tex: 21, hardness: 10, tool: TOOL.PICK, minTier: 2 });
BLOCKS[B.GOLD_ORE]   = def('Gold Ore', { tex: 22, hardness: 10, tool: TOOL.PICK, minTier: 3 });
BLOCKS[B.DIAMOND_ORE]= def('Diamond Ore', { tex: 23, hardness: 10, tool: TOOL.PICK, minTier: 3, drops: { item: 'diamond' } });
BLOCKS[B.BEDROCK]    = def('Bedrock', { tex: 24, hardness: Infinity });
BLOCKS[B.GLASS]      = def('Glass', { tex: 25, opaque: false, cutout: true, hardness: 0.4, drops: { nothing: true } });
BLOCKS[B.PLANKS]     = def('Oak Planks', { tex: 26, hardness: 3, tool: TOOL.AXE });
BLOCKS[B.CRAFTING_TABLE] = def('Crafting Table', { tex: { top: 27, bottom: 26, side: 28 }, hardness: 3.5, tool: TOOL.AXE, interactive: 'craft' });
BLOCKS[B.FURNACE]    = def('Furnace', { tex: { top: 31, bottom: 31, north: 30, south: 29, east: 30, west: 30 }, hardness: 5, tool: TOOL.PICK, minTier: 1, interactive: 'furnace' });
BLOCKS[B.FURNACE_LIT]= def('Lit Furnace', { tex: { top: 31, bottom: 31, north: 30, south: 32, east: 30, west: 30 }, hardness: 5, tool: TOOL.PICK, minTier: 1, interactive: 'furnace', lightEmit: 13, drops: { block: B.FURNACE } });
BLOCKS[B.TORCH]      = def('Torch', { tex: 33, solid: false, opaque: false, cutout: true, hardness: 0.05, lightEmit: 14, custom: 'torch' });
BLOCKS[B.SNOWY_GRASS]= def('Snowy Grass', { tex: { top: 34, bottom: 2, side: 35 }, hardness: 0.9, tool: TOOL.SHOVEL, drops: { block: B.DIRT } });
BLOCKS[B.SNOW_BLOCK] = def('Snow Block', { tex: 34, hardness: 0.5, tool: TOOL.SHOVEL });
BLOCKS[B.WOOL]       = def('Wool', { tex: 36, hardness: 1.2 });
BLOCKS[B.ICE]        = def('Ice', { tex: 37, opaque: false, cutout: true, hardness: 0.7, tool: TOOL.PICK, slippery: true, drops: { nothing: true } });

export function blockDef(id) { return BLOCKS[id] || BLOCKS[B.AIR]; }
export function isOpaque(id) { return blockDef(id).opaque; }
export function isSolid(id)  { return blockDef(id).solid; }

// face texture lookup: face = 0 +x(east) 1 -x(west) 2 +y(top) 3 -y(bottom) 4 +z(south) 5 -z(north)
export function faceTexture(id, face) {
  const t = blockDef(id).tex;
  if (typeof t === 'number') return t;
  if (t == null) return 0;
  switch (face) {
    case 2: return t.top;
    case 3: return t.bottom;
    case 0: return t.east ?? t.side;
    case 1: return t.west ?? t.side;
    case 4: return t.south ?? t.side;
    case 5: return t.north ?? t.side;
  }
  return t.side ?? 0;
}
