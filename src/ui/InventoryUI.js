// ============================================================
// InventoryUI — survival inventory (2x2 craft), crafting table
// (3x3), furnace, and creative item browser. Mouse-driven with
// Minecraft semantics: left = pick up / place all / merge,
// right = split half / place one.
// ============================================================
import { itemDef, maxStack, blockItem, ITEMS } from '../items/Items.js';
import { B, BLOCKS } from '../world/Blocks.js';
import { matchRecipe, SMELTING, FUEL, SMELT_TIME } from '../crafting/Recipes.js';

const CREATIVE_BLOCKS = [
  B.STONE, B.DIRT, B.GRASS, B.COBBLE, B.SAND, B.SANDSTONE, B.GRAVEL,
  B.OAK_LOG, B.OAK_LEAVES, B.BIRCH_LOG, B.BIRCH_LEAVES, B.SPRUCE_LOG, B.SPRUCE_LEAVES,
  B.PLANKS, B.GLASS, B.CRAFTING_TABLE, B.FURNACE, B.TORCH,
  B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE,
  B.SNOW_BLOCK, B.WOOL, B.ICE, B.BEDROCK,
];

export class InventoryUI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('invui');
    this.open = false;
    this.mode = 'inventory';   // inventory | table | furnace | creative
    this.furnacePos = null;
    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'cursorStack';
    document.body.appendChild(this.cursorEl);
    document.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = e.clientX + 'px';
      this.cursorEl.style.top = e.clientY + 'px';
    });
  }

  show(mode = 'inventory', furnacePos = null) {
    const inv = this.game.inventory;
    this.mode = this.game.player.mode === 'creative' && mode === 'inventory' ? 'creative' : mode;
    this.furnacePos = furnacePos;
    inv.craftSize = mode === 'table' ? 3 : 2;
    inv.craftGrid.fill(null);
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }
  hide() {
    if (!this.open) return;
    this.open = false;
    const inv = this.game.inventory;
    inv.clearCraftToInventory((id, n) => this.game.dropFromPlayer(id, n));
    this.root.classList.add('hidden');
    this.cursorEl.innerHTML = '';
  }

  // ---------- rendering --------------------------------------
  slotEl(stack, onClick, cls = '') {
    const el = document.createElement('div');
    el.className = 'slot ' + cls;
    if (stack) {
      const img = document.createElement('img');
      img.src = this.game.hud.iconFor(stack);
      img.draggable = false;
      el.appendChild(img);
      if (stack.count > 1) {
        const c = document.createElement('span');
        c.className = 'count'; c.textContent = stack.count;
        el.appendChild(c);
      }
      const def = itemDef(stack.id);
      el.title = def ? def.name : stack.id;
      if (def && def.durability && stack.durability < def.durability) {
        const bar = document.createElement('div'); bar.className = 'durab';
        const fill = document.createElement('div');
        const f = stack.durability / def.durability;
        fill.style.width = f * 100 + '%';
        fill.style.background = f > 0.5 ? '#5ad05a' : f > 0.2 ? '#e8c43c' : '#e05050';
        bar.appendChild(fill); el.appendChild(bar);
      }
    }
    el.addEventListener('mousedown', (e) => { e.preventDefault(); onClick(e.button); });
    return el;
  }

  render() {
    const inv = this.game.inventory;
    this.root.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel';
    this.root.appendChild(panel);

    const title = document.createElement('h2');
    title.textContent = { inventory: 'Inventory', table: 'Crafting', furnace: 'Furnace', creative: 'Creative inventory' }[this.mode];
    panel.appendChild(title);

    if (this.mode === 'creative') this.renderCreative(panel);
    else if (this.mode === 'furnace') this.renderFurnace(panel);
    else this.renderCrafting(panel);

    // main inventory 27 + hotbar 9
    const grid = document.createElement('div');
    grid.className = 'grid inv9';
    for (let i = 9; i < 36; i++) grid.appendChild(this.slotEl(inv.slots[i], (b) => this.clickSlot(inv.slots, i, b)));
    panel.appendChild(grid);
    const hot = document.createElement('div');
    hot.className = 'grid inv9 hotrow';
    for (let i = 0; i < 9; i++) hot.appendChild(this.slotEl(inv.slots[i], (b) => this.clickSlot(inv.slots, i, b)));
    panel.appendChild(hot);

    this.renderCursor();
  }

  renderCrafting(panel) {
    const inv = this.game.inventory;
    const size = inv.craftSize;
    const wrap = document.createElement('div');
    wrap.className = 'craftRow';
    const grid = document.createElement('div');
    grid.className = 'grid craft' + size;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const i = r * 3 + c; // grid stored 3x3, 2x2 uses top-left
      grid.appendChild(this.slotEl(inv.craftGrid[i], (b) => this.clickSlot(inv.craftGrid, i, b, true)));
    }
    wrap.appendChild(grid);
    const arrow = document.createElement('div');
    arrow.className = 'arrow'; arrow.textContent = '→';
    wrap.appendChild(arrow);

    const recipe = this.currentRecipe();
    const out = recipe ? { id: recipe.result, count: recipe.count } : null;
    wrap.appendChild(this.slotEl(out, (b) => this.takeCraft(b), 'outSlot'));
    panel.appendChild(wrap);
  }

  currentRecipe() {
    const inv = this.game.inventory;
    const size = inv.craftSize;
    const grid = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const s = inv.craftGrid[r * 3 + c];
      grid.push(s ? s.id : null);
    }
    return matchRecipe(grid, size);
  }
  takeCraft() {
    const inv = this.game.inventory;
    const recipe = this.currentRecipe();
    if (!recipe) return;
    const def = itemDef(recipe.result);
    // merge into cursor if possible
    if (this.cursorBlocked(recipe.result, recipe.count)) return;
    for (let i = 0; i < 9; i++) {
      const s = inv.craftGrid[i];
      if (s) { s.count--; if (s.count <= 0) inv.craftGrid[i] = null; }
    }
    if (inv.cursor && inv.cursor.id === recipe.result) inv.cursor.count += recipe.count;
    else {
      inv.cursor = { id: recipe.result, count: recipe.count };
      if (def && def.durability) inv.cursor.durability = def.durability;
    }
    this.game.audio.play('craft');
    this.render();
  }
  cursorBlocked(id, count) {
    const inv = this.game.inventory;
    if (!inv.cursor) return false;
    if (inv.cursor.id !== id) return true;
    return inv.cursor.count + count > maxStack(id);
  }

  renderFurnace(panel) {
    const f = this.game.getFurnace(this.furnacePos);
    const wrap = document.createElement('div');
    wrap.className = 'furnaceRow';
    const colIn = document.createElement('div');
    colIn.className = 'furnCol';
    colIn.appendChild(this.slotEl(f.input, (b) => this.clickFurnaceSlot(f, 'input', b)));
    const flame = document.createElement('div');
    flame.className = 'flame' + (f.burnTime > 0 ? ' lit' : '');
    flame.textContent = '🔥';
    flame.style.opacity = f.burnTime > 0 ? 0.4 + 0.6 * Math.min(1, f.burnTime / 10) : 0.18;
    colIn.appendChild(flame);
    colIn.appendChild(this.slotEl(f.fuel, (b) => this.clickFurnaceSlot(f, 'fuel', b)));
    wrap.appendChild(colIn);

    const prog = document.createElement('div');
    prog.className = 'smeltProg';
    const fill = document.createElement('div');
    fill.style.width = (f.cookTime / SMELT_TIME * 100) + '%';
    prog.appendChild(fill);
    wrap.appendChild(prog);

    wrap.appendChild(this.slotEl(f.output, (b) => this.clickFurnaceSlot(f, 'output', b), 'outSlot'));
    panel.appendChild(wrap);
  }
  clickFurnaceSlot(f, key, button) {
    const inv = this.game.inventory;
    if (key === 'output') {
      if (!f.output) return;
      if (!inv.cursor) { inv.cursor = f.output; f.output = null; }
      else if (inv.cursor.id === f.output.id && inv.cursor.count + f.output.count <= maxStack(f.output.id)) {
        inv.cursor.count += f.output.count; f.output = null;
      }
      this.render();
      return;
    }
    f[key] = this.swapLogic(f[key], button, (v) => { f[key] = v; });
    this.render();
  }

  renderCreative(panel) {
    const list = document.createElement('div');
    list.className = 'grid creativeGrid';
    const all = [
      ...CREATIVE_BLOCKS.map(b => blockItem(b)),
      ...Object.keys(ITEMS),
    ];
    for (const id of all) {
      const stack = { id, count: 1 };
      const def = itemDef(id);
      if (def && def.durability) stack.durability = def.durability;
      list.appendChild(this.slotEl(stack, (button) => {
        const inv = this.game.inventory;
        if (button === 0) {
          inv.cursor = { id, count: 1 };
          if (def && def.durability) inv.cursor.durability = def.durability;
        }
        if (button === 2 && inv.cursor && inv.cursor.id === id) inv.cursor.count = Math.min(maxStack(id), inv.cursor.count + 1);
        this.render();
      }));
    }
    panel.appendChild(list);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Left-click an item to pick it up, right-click to add one more. Click a slot below to place it.';
    panel.appendChild(hint);
  }

  // ---------- click semantics --------------------------------
  clickSlot(arr, i, button, isCraft = false) {
    arr[i] = this.swapLogic(arr[i], button, (v) => { arr[i] = v; });
    this.game.inventory.changed();
    this.render();
  }
  // returns new slot value given cursor interaction
  swapLogic(slot, button) {
    const inv = this.game.inventory;
    const cur = inv.cursor;
    if (button === 0) {
      if (!cur && slot) { inv.cursor = slot; return null; }
      if (cur && !slot) { inv.cursor = null; return cur; }
      if (cur && slot) {
        if (cur.id === slot.id && maxStack(cur.id) > 1) {
          const space = maxStack(cur.id) - slot.count;
          const move = Math.min(space, cur.count);
          slot.count += move; cur.count -= move;
          if (cur.count <= 0) inv.cursor = null;
          return slot;
        }
        inv.cursor = slot;
        return cur;
      }
      return slot;
    }
    if (button === 2) {
      if (!cur && slot) {
        const half = Math.ceil(slot.count / 2);
        inv.cursor = { ...slot, count: half };
        slot.count -= half;
        return slot.count > 0 ? slot : null;
      }
      if (cur) {
        if (!slot) {
          const one = { ...cur, count: 1 };
          cur.count--;
          if (cur.count <= 0) inv.cursor = null;
          return one;
        }
        if (slot.id === cur.id && slot.count < maxStack(slot.id)) {
          slot.count++; cur.count--;
          if (cur.count <= 0) inv.cursor = null;
        }
        return slot;
      }
    }
    return slot;
  }

  renderCursor() {
    const cur = this.game.inventory.cursor;
    this.cursorEl.innerHTML = '';
    if (cur) {
      const img = document.createElement('img');
      img.src = this.game.hud.iconFor(cur);
      this.cursorEl.appendChild(img);
      if (cur.count > 1) {
        const c = document.createElement('span');
        c.className = 'count'; c.textContent = cur.count;
        this.cursorEl.appendChild(c);
      }
    }
  }
}
export { SMELTING, FUEL, SMELT_TIME };
