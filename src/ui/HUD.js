// ============================================================
// HUD — DOM overlay: crosshair, hotbar, hearts/hunger/air,
// hurt vignette, underwater tint, F3 debug panel.
// All icons are generated from the procedural atlas.
// ============================================================
import { itemDef } from '../items/Items.js';
import { faceTexture } from '../world/Blocks.js';
import { itemIconURL } from '../rendering/TextureAtlas.js';

export class HUD {
  constructor(atlas) {
    this.atlas = atlas;
    this.root = document.getElementById('hud');
    this.root.innerHTML = `
      <div id="crosshair">+</div>
      <div id="vignette"></div>
      <div id="waterOverlay"></div>
      <div id="statusRow">
        <div id="hearts" class="iconRow"></div>
        <div id="hunger" class="iconRow"></div>
      </div>
      <div id="air" class="iconRow"></div>
      <div id="hotbar"></div>
      <div id="debug" class="hidden"></div>
      <div id="toast"></div>`;
    this.hotbarEl = this.root.querySelector('#hotbar');
    this.heartsEl = this.root.querySelector('#hearts');
    this.hungerEl = this.root.querySelector('#hunger');
    this.airEl = this.root.querySelector('#air');
    this.debugEl = this.root.querySelector('#debug');
    this.vignette = this.root.querySelector('#vignette');
    this.waterOverlay = this.root.querySelector('#waterOverlay');
    this.toastEl = this.root.querySelector('#toast');
    this.debugVisible = false;
    this.toastTimer = null;

    this.heartIcon = atlas.pixelIcon('ui_heart', [
      ' rr rr ', 'rrrrrrr', 'rRrrrrr', ' rrrrr ', '  rrr  ', '   r   ',
    ].map(r => r.padEnd(8, ' ')), { r: '#e03434', R: '#ff8a8a' });
    this.heartEmpty = atlas.pixelIcon('ui_heart_e', [
      ' rr rr ', 'r  r  r', 'r     r', ' r   r ', '  r r  ', '   r   ',
    ].map(r => r.padEnd(8, ' ')), { r: '#3a3a3a' });
    this.foodIcon = atlas.pixelIcon('ui_food', [
      '  ss  ', ' mmmm ', 'mmmmmm', 'mmmmmm', ' mmmm ', '  mm  ',
    ].map(r => r.padEnd(8, ' ')), { m: '#b8743c', s: '#7a4a22' });
    this.foodEmpty = atlas.pixelIcon('ui_food_e', [
      '  ss  ', ' m  m ', 'm    m', 'm    m', ' m  m ', '  mm  ',
    ].map(r => r.padEnd(8, ' ')), { m: '#3a3a3a', s: '#3a3a3a' });
    this.bubbleIcon = atlas.pixelIcon('ui_air', [
      ' bb ', 'bBbb', 'bbbb', ' bb ',
    ].map(r => r.padEnd(8, ' ')), { b: '#5aa8e8', B: '#cfe9ff' });

    this.lastHotbarJSON = '';
  }

  iconFor(stack) {
    if (!stack) return null;
    const def = itemDef(stack.id);
    if (!def) return null;
    if (def.block !== undefined) return this.atlas.blockIcon(def.block, faceTexture);
    return itemIconURL(this.atlas, stack.id);
  }

  updateHotbar(inv) {
    const json = JSON.stringify({ s: inv.slots.slice(0, 9), sel: inv.selected });
    if (json === this.lastHotbarJSON) return;
    this.lastHotbarJSON = json;
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotslot' + (i === inv.selected ? ' sel' : '');
      const s = inv.slots[i];
      if (s) {
        const img = document.createElement('img');
        img.src = this.iconFor(s);
        img.draggable = false;
        slot.appendChild(img);
        if (s.count > 1) {
          const c = document.createElement('span');
          c.className = 'count'; c.textContent = s.count;
          slot.appendChild(c);
        }
        const def = itemDef(s.id);
        if (def && def.durability && s.durability < def.durability) {
          const bar = document.createElement('div');
          bar.className = 'durab';
          const fill = document.createElement('div');
          const f = s.durability / def.durability;
          fill.style.width = (f * 100) + '%';
          fill.style.background = f > 0.5 ? '#5ad05a' : f > 0.2 ? '#e8c43c' : '#e05050';
          bar.appendChild(fill);
          slot.appendChild(bar);
        }
      }
      this.hotbarEl.appendChild(slot);
    }
  }

  updateStatus(player, creative) {
    const show = !creative;
    this.heartsEl.style.display = show ? '' : 'none';
    this.hungerEl.style.display = show ? '' : 'none';
    if (show) {
      this.row(this.heartsEl, Math.ceil(player.health / 2), 10, this.heartIcon, this.heartEmpty);
      this.row(this.hungerEl, Math.ceil(player.hunger / 2), 10, this.foodIcon, this.foodEmpty);
      const bubbles = player.headInWater ? Math.ceil((player.air ?? 10)) : 0;
      this.airEl.style.display = bubbles > 0 ? '' : 'none';
      if (bubbles > 0) this.row(this.airEl, bubbles, 10, this.bubbleIcon, null);
    } else {
      this.airEl.style.display = 'none';
    }
    this.vignette.style.opacity = player.hurtTime > 0 ? Math.min(0.55, player.hurtTime * 1.6) : 0;
    this.waterOverlay.style.opacity = player.headInWater ? 0.25 : 0;
  }
  row(el, full, total, icon, empty) {
    const key = el.id + full + '/' + total;
    if (el._key === key) return;
    el._key = key;
    el.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const img = document.createElement('img');
      img.src = i < full ? icon : (empty || icon);
      if (!empty && i >= full) img.style.visibility = 'hidden';
      el.appendChild(img);
    }
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('hidden', !this.debugVisible);
  }
  updateDebug(game) {
    if (!this.debugVisible) return;
    const p = game.player;
    const stats = game.renderer.frameStats;
    this.debugEl.innerHTML =
      `VoxelCraft (fps: ${game.fps | 0})<br>` +
      `XYZ: ${p.pos[0].toFixed(2)} / ${p.pos[1].toFixed(2)} / ${p.pos[2].toFixed(2)}<br>` +
      `Chunk: ${Math.floor(p.pos[0] / 16)}, ${Math.floor(p.pos[2] / 16)}<br>` +
      `Biome: ${game.world.biomeAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]))}<br>` +
      `Chunks: ${stats.drawnChunks}/${stats.totalChunks} drawn, tris ${stats.triangles}<br>` +
      `Entities: ${game.entities.entities.length} | Time: ${(game.timeOfDay * 24).toFixed(1)}h<br>` +
      `Mode: ${p.mode}${p.flying ? ' (flying)' : ''}`;
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  setVisible(v) { this.root.style.display = v ? '' : 'none'; }
}
