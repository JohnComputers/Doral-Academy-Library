// ============================================================
// Inventory — 36 slots (0-8 = hotbar). Stacks are plain objects
// { id, count, durability? } so they serialize directly.
// ============================================================
import { itemDef, maxStack, TIERS } from '../items/Items.js';

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
    this.selected = 0;          // hotbar index
    this.cursor = null;         // stack being dragged in UI
    this.craftGrid = new Array(9).fill(null);
    this.craftSize = 2;         // 2 (player) or 3 (table)
    this.onChange = null;
  }

  changed() { if (this.onChange) this.onChange(); }
  held() { return this.slots[this.selected]; }

  // add items, returns count that did NOT fit
  add(id, count = 1, durability) {
    const def = itemDef(id);
    if (!def) return count;
    const max = maxStack(id);
    if (max > 1) {
      for (let i = 0; i < this.slots.length && count > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < max) {
          const take = Math.min(max - s.count, count);
          s.count += take; count -= take;
        }
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(max, count);
        this.slots[i] = { id, count: take };
        if (durability !== undefined) this.slots[i].durability = durability;
        else if (def.durability) this.slots[i].durability = def.durability;
        count -= take;
      }
    }
    this.changed();
    return count;
  }

  // remove n of an item anywhere in the inventory; true on success
  remove(id, count = 1) {
    let have = 0;
    for (const s of this.slots) if (s && s.id === id) have += s.count;
    if (have < count) return false;
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, count);
        s.count -= take; count -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  consumeHeld(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  // tool durability: returns true if the tool broke
  damageHeld(amount = 1) {
    const s = this.slots[this.selected];
    if (!s || s.durability === undefined) return false;
    s.durability -= amount;
    if (s.durability <= 0) {
      this.slots[this.selected] = null;
      this.changed();
      return true;
    }
    this.changed();
    return false;
  }

  clearCraftToInventory(drop) {
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (s) {
        const left = this.add(s.id, s.count, s.durability);
        if (left > 0 && drop) drop(s.id, left);
        this.craftGrid[i] = null;
      }
    }
    if (this.cursor) {
      const left = this.add(this.cursor.id, this.cursor.count, this.cursor.durability);
      if (left > 0 && drop) drop(this.cursor.id, left);
      this.cursor = null;
    }
    this.changed();
  }

  serialize() { return { slots: this.slots, selected: this.selected }; }
  deserialize(d) {
    if (!d) return;
    if (Array.isArray(d.slots)) {
      this.slots = d.slots.map(s => (s && itemDef(s.id) ? s : null));
      while (this.slots.length < 36) this.slots.push(null);
    }
    this.selected = d.selected || 0;
    this.changed();
  }
}
export { TIERS };
