// ============================================================
// Game — the conductor. Owns the loop (fixed 60 Hz simulation,
// rAF rendering), chunk streaming through the worker pool,
// block interaction, survival systems, weather, mob spawning,
// furnace ticking, particles and persistence.
// ============================================================
import { CHUNK, HEIGHT, DAY_LENGTH, REACH, chunkKey, hash2, mulberry32 } from '../world/constants.js';
import { B, blockDef, faceTexture } from '../world/Blocks.js';
import { itemDef, blockItem, miningSpeed, canHarvest } from '../items/Items.js';
import { SMELTING, FUEL, SMELT_TIME } from '../crafting/Recipes.js';
import { World } from '../world/World.js';
import { Chunk } from '../world/Chunk.js';
import { computeLight } from '../world/generation.js';
import { buildChunkMesh } from '../rendering/ChunkMesher.js';
import { Player } from '../player/Player.js';
import { EntityManager, MOB_DEFS } from '../entities/Entities.js';
import { Inventory } from '../inventory/Inventory.js';
import { NetworkAdapter, LocalServer, MSG } from '../networking/NetworkAdapter.js';
import { forward } from '../engine/math.js';

const PASSIVE_TYPES = ['cow', 'pig', 'sheep', 'chicken'];
const HOSTILE_TYPES = ['zombie', 'zombie', 'skeleton', 'creeper'];

export class Game {
  constructor({ canvas, renderer, atlas, hud, invUI, menus, audio, input, save, settings }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.atlas = atlas;
    this.hud = hud;
    this.invUI = invUI;
    this.menus = menus;
    this.audio = audio;
    this.input = input;
    this.save = save;
    this.settings = settings;

    this.state = 'menu';     // menu | loading | playing | paused | inventory | dead
    this.world = null;
    this.player = null;
    this.entities = null;
    this.inventory = new Inventory();
    this.net = new NetworkAdapter(new LocalServer());

    this.workers = [];
    this.pendingChunks = new Set();
    this.timeOfDay = 0.3;
    this.fps = 60;
    this.accum = 0;
    this.lastT = 0;
    this.mining = null;       // {x,y,z,id,progress}
    this.particles = [];
    this.tileColors = new Map();
    this.rain = { active: false, timer: 30 + Math.random() * 120, stopIn: 0 };
    this.autosaveT = 0;
    this.stepDist = 0;
    this.worldMeta = null;
    this.spawnTimer = 0;
    this.savingChunks = false;

    this.net.on(MSG.SET_BLOCK, (m) => {
      // authoritative block changes arrive here (local loopback today)
      this.world.setBlock(m.x, m.y, m.z, m.id, m.meta || 0);
    });

    this.wireInput();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ============================================================
  // world lifecycle
  // ============================================================
  async startWorld(meta) {
    this.state = 'loading';
    this.menus.showLoading('Generating world…');
    this.worldMeta = meta;
    this.world = new World(meta.seed);
    this.world.time = meta.worldTime || 0;
    this.timeOfDay = meta.timeOfDay ?? 0.3;
    this.world.onBlockChanged = (x, y, z, prev, id) => {
      const c = this.world.chunkAt(x, z);
      if (c) c.modified = true;
    };

    this.player = new Player(this.world, meta.mode || 'survival');
    this.player.onHurt = () => this.audio.play('hurt');
    if (meta.player) {
      this.player.pos = [...meta.player.pos];
      this.player.yaw = meta.player.yaw; this.player.pitch = meta.player.pitch;
      this.player.health = meta.player.health ?? 20;
      this.player.hunger = meta.player.hunger ?? 20;
      this.player.spawn = meta.player.spawn || [...meta.player.pos];
      this.player.flying = !!meta.player.flying;
    }
    this.inventory = new Inventory();
    this.inventory.deserialize(meta.inventory);
    this.inventory.onChange = () => this.hud.updateHotbar(this.inventory);

    this.entities = new EntityManager(this.world, this.atlas);
    this.entities.onSound = (name, pos) => {
      const d = Math.hypot(pos[0] - this.player.pos[0], pos[1] - this.player.pos[1], pos[2] - this.player.pos[2]);
      if (d < 28) this.audio.play(name);
    };
    this.entities.onExplosion = (x, y, z, r) => this.spawnExplosionParticles(x, y, z, r);
    this.entities.deserialize(meta.entities);
    if (meta.blockEntities) {
      this.world.blockEntities = new Map(Object.entries(meta.blockEntities));
    }

    // worker pool
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (let i = 0; i < 2; i++) {
      const w = new Worker(new URL('../workers/genWorker.js', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', seed: meta.seed });
      w.busy = 0;
      w.onmessage = (e) => this.onChunkGenerated(e.data, w);
      w.onerror = (e) => {
        console.error('Chunk worker failed:', e.message || e);
        const el = document.querySelector('#menus .loading');
        if (el) el.textContent = 'Worker error: ' + (e.message || 'see console') +
          ' \u2014 are you serving over http:// (not file://)?';
      };
      this.workers.push(w);
    }

    this.spawnTimer = 0;
    this.needSpawnPlace = !meta.player;
    this.autosaveT = 0;
    this.mining = null;
    this.particles.length = 0;
    this.hud.updateHotbar(this.inventory);

    // wait until the spawn chunk arrives, then drop into the game
    this.waitForSpawn();
  }

  waitForSpawn() {
    if (!this.world) return; // user quit while loading
    // the main loop is parked during 'loading', so drive chunk
    // requests + meshing from here until the spawn area exists
    this.streamChunks();
    const el = document.querySelector('#menus .loading');
    if (el) el.textContent = `Generating world… ${this.world.chunks.size} chunks`;
    const cx = Math.floor(this.player.pos[0] / CHUNK), cz = Math.floor(this.player.pos[2] / CHUNK);
    const ready = this.world.getChunk(cx, cz);
    if (ready) {
      if (this.needSpawnPlace) {
        const y = this.world.surfaceY(Math.floor(this.player.pos[0]), Math.floor(this.player.pos[2]));
        this.player.pos[1] = Math.max(y > 0 ? y : 70, 53) + 1.01; // never spawn under the sea
        this.player.spawn = [...this.player.pos];
        this.needSpawnPlace = false;
      }
      this.menus.hide();
      this.hud.setVisible(true);
      this.state = 'playing';
      this.input.requestLock();
      return;
    }
    setTimeout(() => this.waitForSpawn(), 120);
  }

  async quitToTitle() {
    await this.saveAll();
    for (const w of this.workers) w.terminate();
    this.workers = [];
    if (this.world) {
      for (const key of [...this.renderer.meshes.keys()]) this.renderer.deleteChunkMesh(key);
    }
    this.world = null;
    this.state = 'menu';
    this.hud.setVisible(false);
    this.input.exitLock();
    const worlds = await this.save.listWorlds();
    this.menus.showTitle(worlds);
  }

  async saveAll() {
    if (!this.world || !this.worldMeta) return;
    const meta = {
      seed: this.worldMeta.seed,
      mode: this.player.mode,
      worldTime: this.world.time,
      timeOfDay: this.timeOfDay,
      player: {
        pos: this.player.pos, yaw: this.player.yaw, pitch: this.player.pitch,
        health: this.player.health, hunger: this.player.hunger,
        spawn: this.player.spawn, flying: this.player.flying,
      },
      inventory: this.inventory.serialize(),
      blockEntities: Object.fromEntries(this.world.blockEntities),
    };
    await this.save.saveWorld(this.worldMeta.name, meta, this.world, this.entities.serialize());
    for (const c of this.world.chunks.values()) c.modified = false;
  }

  // ============================================================
  // chunk streaming
  // ============================================================
  async requestChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.pendingChunks.has(key) || this.world.getChunk(cx, cz)) return;
    this.pendingChunks.add(key);

    // saved chunks override fresh generation
    let saved = null;
    try {
      saved = await this.save.loadChunk(this.worldMeta.name, cx, cz);
    } catch (e) {
      console.warn('Saved-chunk read failed, regenerating:', e);
    }
    if (!this.world) { this.pendingChunks.delete(key); return; }
    if (saved) {
      const chunk = new Chunk(cx, cz, {
        blocks: saved.blocks, meta: saved.meta, light: saved.blocks, // placeholder, relit below
        heightmap: saved.heightmap, biomes: saved.biomes, biomeNames: saved.biomeNames,
      });
      chunk.light = computeLight(chunk.blocks);
      chunk.modified = false;
      chunk.entitiesSpawned = true;
      this.world.addChunk(chunk);
      this.world.onChunkLoaded(chunk);
      this.pendingChunks.delete(key);
      return;
    }
    // pick least busy worker
    let w = this.workers[0];
    for (const c of this.workers) if (c.busy < w.busy) w = c;
    w.busy++;
    w.postMessage({ type: 'gen', cx, cz, id: key });
  }

  onChunkGenerated(msg, worker) {
    worker.busy = Math.max(0, worker.busy - 1);
    if (!this.world || msg.type !== 'chunk') return;
    this.pendingChunks.delete(msg.id);
    const chunk = new Chunk(msg.cx, msg.cz, msg);
    this.world.addChunk(chunk);
    this.world.onChunkLoaded(chunk);
  }

  streamChunks() {
    const rd = this.settings.renderDistance;
    const pcx = Math.floor(this.player.pos[0] / CHUNK), pcz = Math.floor(this.player.pos[2] / CHUNK);

    // request missing chunks, nearest first
    const wanted = [];
    for (let dx = -rd; dx <= rd; dx++) for (let dz = -rd; dz <= rd; dz++) {
      if (dx * dx + dz * dz > rd * rd + 2) continue;
      const cx = pcx + dx, cz = pcz + dz;
      if (!this.world.getChunk(cx, cz) && !this.pendingChunks.has(chunkKey(cx, cz))) {
        wanted.push([dx * dx + dz * dz, cx, cz]);
      }
    }
    wanted.sort((a, b) => a[0] - b[0]);
    let inflight = this.pendingChunks.size;
    for (const [, cx, cz] of wanted) {
      if (inflight >= 8) break;
      this.requestChunk(cx, cz);
      inflight++;
    }

    // unload far chunks
    for (const c of [...this.world.chunks.values()]) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (rd + 2) * (rd + 2)) {
        const key = chunkKey(c.cx, c.cz);
        if (c.modified) this.persistChunk(c);
        this.renderer.deleteChunkMesh(key);
        this.world.removeChunk(c.cx, c.cz);
      }
    }

    // remesh dirty chunks, nearest first, within a time budget
    const dirty = [];
    for (const c of this.world.chunks.values()) {
      if (!c.dirty) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > rd * rd + 2) continue;
      dirty.push([dx * dx + dz * dz, c]);
    }
    dirty.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    let built = 0;
    for (const [, c] of dirty) {
      const mesh = buildChunkMesh(this.world, c);
      this.renderer.setChunkMesh(chunkKey(c.cx, c.cz), c.cx, c.cz, mesh);
      c.dirty = false;
      built++;
      if (!c.entitiesSpawned) { c.entitiesSpawned = true; this.spawnPassiveIn(c); }
      if (built >= 2 && performance.now() - t0 > 7) break;
      if (performance.now() - t0 > 12) break;
    }
  }

  persistChunk(chunk) {
    // fire-and-forget single chunk write on unload
    if (!this.save.db || !this.worldMeta) return;
    try {
      const t = this.save.db.transaction('chunks', 'readwrite');
      t.objectStore('chunks').put({
        blocks: chunk.blocks.buffer.slice(0), meta: chunk.meta.buffer.slice(0),
        heightmap: chunk.heightmap.buffer.slice(0),
        biomes: chunk.biomes ? chunk.biomes.buffer.slice(0) : null,
        biomeNames: chunk.biomeNames,
      }, this.worldMeta.name + '/' + chunk.cx + ',' + chunk.cz);
    } catch (e) { /* best-effort */ }
  }

  // ============================================================
  // input wiring
  // ============================================================
  wireInput() {
    const inp = this.input;
    inp.on('escape', () => {
      if (this.state === 'inventory') { this.closeInventory(); }
      else if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    });
    inp.on('inventory', () => {
      if (this.state === 'playing') this.openInventory('inventory');
      else if (this.state === 'inventory') this.closeInventory();
    });
    inp.on('hotbar', (i) => { if (this.player) { this.inventory.selected = i; this.hud.updateHotbar(this.inventory); } });
    inp.on('scroll', (d) => {
      if (this.state !== 'playing') return;
      this.inventory.selected = (this.inventory.selected + d + 9) % 9;
      this.hud.updateHotbar(this.inventory);
    });
    inp.on('debug', () => this.hud.toggleDebug());
    inp.on('doubleJump', () => { if (this.state === 'playing') this.player.toggleFlight(); });
    inp.on('drop', () => {
      if (this.state !== 'playing') return;
      const held = this.inventory.held();
      if (!held) return;
      this.dropFromPlayer(held.id, 1, held.durability);
      this.inventory.consumeHeld(1);
    });
    inp.on('mouse0', () => this.attack());
    inp.on('mouse2', () => this.useItem());
    inp.on('unlock', () => {
      if (this.state === 'playing') this.pause();
    });
    inp.on('lock', () => { this.audio.resume(); });
    // clicking the canvas re-acquires pointer lock (the initial
    // requestLock after async world loading is often denied)
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !inp.locked) inp.requestLock();
    });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.menus.showPause();
  }
  resume() {
    this.menus.hide();
    this.state = 'playing';
    this.input.requestLock();
  }
  openInventory(mode, pos) {
    this.state = 'inventory';
    this.input.exitLock();
    this.invUI.show(mode, pos);
  }
  closeInventory() {
    this.invUI.hide();
    this.state = 'playing';
    this.input.requestLock();
  }

  dropFromPlayer(id, count, durability) {
    const eye = this.player.eyePos();
    const dir = forward(this.player.yaw, this.player.pitch);
    const e = this.entities.dropItem(id, count, eye[0] + dir[0] * 0.4, eye[1] - 0.2, eye[2] + dir[2] * 0.4,
      [dir[0] * 5 + (Math.random() - 0.5), dir[1] * 5 + 2, dir[2] * 5 + (Math.random() - 0.5)]);
    if (durability !== undefined) e.durability = durability;
    e.pickupDelay = 1.4;
  }

  // ============================================================
  // interaction
  // ============================================================
  attack() {
    if (this.state !== 'playing' || this.player.dead) return;
    const eye = this.player.eyePos();
    const dir = forward(this.player.yaw, this.player.pitch);
    // mobs take priority within reach
    const hit = this.entities.raycastMob(eye, dir, 3.4);
    const block = this.player.raycast();
    if (hit && (!block || hit.dist < block.dist)) {
      const held = itemDef(this.inventory.held()?.id);
      const dmg = held && held.damage ? held.damage : 1;
      this.entities.hurt(hit.entity, dmg, this.player, [dir[0] * 6, 0, dir[2] * 6]);
      if (held && held.tool === 'sword') this.inventory.damageHeld(1);
      this.player.exhaustion += 0.1;
    }
  }

  useItem() {
    if (this.state !== 'playing' || this.player.dead) return;
    const target = this.player.raycast();
    const held = this.inventory.held();
    const heldDef = held ? itemDef(held.id) : null;

    // interactive blocks open their UI (unless sneaking)
    if (target && !this.player.sneaking) {
      const tdef = blockDef(target.id);
      if (tdef.interactive === 'craft') { this.openInventory('table'); this.audio.play('click'); return; }
      if (tdef.interactive === 'furnace') {
        this.openInventory('furnace', target.x + ',' + target.y + ',' + target.z);
        this.audio.play('click');
        return;
      }
    }
    // eat
    if (heldDef && heldDef.food && this.player.hunger < 20 && this.player.mode === 'survival') {
      this.player.eat(heldDef.food, heldDef.food * 0.6);
      this.inventory.consumeHeld(1);
      this.audio.play('eat');
      return;
    }
    // place block
    if (heldDef && heldDef.block !== undefined && target) {
      const [fx, fy, fz] = target.face;
      const x = target.x + fx, y = target.y + fy, z = target.z + fz;
      if (y < 0 || y >= HEIGHT) return;
      const at = this.world.getBlock(x, y, z);
      if (blockDef(at).solid) return;
      const def = blockDef(heldDef.block);
      if (def.solid && this.player.intersectsBlock(x, y, z)) return;
      if (heldDef.block === B.TORCH && !blockDef(this.world.getBlock(x, y - 1, z)).solid) return;
      this.net.send(MSG.SET_BLOCK, { x, y, z, id: heldDef.block, meta: heldDef.block === B.WATER ? 8 : 0 });
      if (this.player.mode === 'survival') this.inventory.consumeHeld(1);
      this.audio.play('place');
    }
  }

  updateMining(dt, input) {
    if (this.state !== 'playing' || this.player.dead || !input.attack) { this.mining = null; return; }
    const target = this.player.raycast();
    if (!target) { this.mining = null; return; }
    const def = blockDef(target.id);
    if (def.hardness === Infinity) { this.mining = null; return; }

    // attacking a mob suppresses mining for that press
    if (this.mining && (this.mining.x !== target.x || this.mining.y !== target.y || this.mining.z !== target.z)) this.mining = null;
    if (!this.mining) this.mining = { x: target.x, y: target.y, z: target.z, id: target.id, progress: 0, soundT: 0 };

    if (this.player.mode === 'creative') { this.breakBlock(target); this.mining = null; return; }

    const held = this.inventory.held();
    let speed = miningSpeed(held?.id, target.id);
    if (this.player.headInWater) speed *= 0.25;
    if (!this.player.onGround && !this.player.flying) speed *= 0.4;
    const harvests = canHarvest(held?.id, target.id);
    const penalty = blockDef(target.id).minTier && !harvests ? 3.3 : 1;
    this.mining.progress += (dt * speed) / (def.hardness * 1.5 * penalty);
    this.mining.soundT -= dt;
    if (this.mining.soundT <= 0) { this.mining.soundT = 0.24; this.audio.play('dig'); }

    if (this.mining.progress >= 1) {
      this.breakBlock(target, harvests);
      this.mining = null;
      this.player.exhaustion += 0.025;
    }
  }

  breakBlock(target, harvests = true) {
    const def = blockDef(target.id);
    this.net.send(MSG.SET_BLOCK, { x: target.x, y: target.y, z: target.z, id: B.AIR });
    this.audio.play('break');
    this.spawnBreakParticles(target.x, target.y, target.z, target.id);

    if (this.player.mode === 'creative') return;
    // tool durability
    const held = itemDef(this.inventory.held()?.id);
    if (held && held.tool && held.tool !== 'sword') {
      if (this.inventory.damageHeld(1)) this.audio.play('break');
    }
    if (!harvests) return;
    // drops
    const d = def.drops;
    let drop = null;
    if (!d) drop = { id: blockItem(target.id), count: 1 };
    else if (d.nothing) drop = null;
    else if (d.block !== undefined) drop = { id: blockItem(d.block), count: 1 };
    else if (d.item) drop = { id: d.item, count: 1 };
    else if (d.maybe) {
      for (const m of d.maybe) if (Math.random() < m.chance) drop = { id: m.item, count: 1 };
    }
    if (drop) this.entities.dropItem(drop.id, drop.count, target.x + 0.5, target.y + 0.3, target.z + 0.5);
  }

  // ============================================================
  // furnaces (block entities)
  // ============================================================
  getFurnace(key) {
    let f = this.world.blockEntities.get(key);
    if (!f) {
      f = { input: null, fuel: null, output: null, burnTime: 0, cookTime: 0 };
      this.world.blockEntities.set(key, f);
    }
    return f;
  }
  tickFurnaces(dt) {
    for (const [key, f] of this.world.blockEntities) {
      if (!f || f.cookTime === undefined) continue;
      const [x, y, z] = key.split(',').map(Number);
      const id = this.world.getBlock(x, y, z);
      if (id !== B.FURNACE && id !== B.FURNACE_LIT) { this.world.blockEntities.delete(key); continue; }

      const canSmelt = f.input && SMELTING[f.input.id] &&
        (!f.output || (f.output.id === SMELTING[f.input.id] && f.output.count < 64));

      if (f.burnTime > 0) f.burnTime -= dt;

      if (f.burnTime <= 0 && canSmelt && f.fuel && FUEL[f.fuel.id]) {
        f.burnTime = FUEL[f.fuel.id];
        f.fuel.count--;
        if (f.fuel.count <= 0) f.fuel = null;
      }

      if (f.burnTime > 0 && canSmelt) {
        f.cookTime += dt;
        if (f.cookTime >= SMELT_TIME) {
          f.cookTime = 0;
          const result = SMELTING[f.input.id];
          f.input.count--;
          if (f.input.count <= 0) f.input = null;
          if (f.output) f.output.count++;
          else f.output = { id: result, count: 1 };
        }
      } else if (!canSmelt) {
        f.cookTime = Math.max(0, f.cookTime - dt * 2);
      }

      // keep the lit state in sync with the flame
      const shouldBeLit = f.burnTime > 0;
      if (shouldBeLit && id === B.FURNACE) this.world.setBlock(x, y, z, B.FURNACE_LIT, 0, { silent: true });
      if (!shouldBeLit && id === B.FURNACE_LIT) this.world.setBlock(x, y, z, B.FURNACE, 0, { silent: true });

      if (this.state === 'inventory' && this.invUI.mode === 'furnace' && this.invUI.furnacePos === key) {
        if (this.world.time - (this._furnaceUIT || 0) > 0.25) {
          this._furnaceUIT = this.world.time;
          this.invUI.render();
        }
      }
    }
  }

  // ============================================================
  // mobs + weather
  // ============================================================
  spawnPassiveIn(chunk) {
    const rng = mulberry32(hash2(this.world.seed ^ 0xa11ce, chunk.cx, chunk.cz));
    if (rng() > 0.14) return;
    const type = PASSIVE_TYPES[(rng() * PASSIVE_TYPES.length) | 0];
    const n = 2 + ((rng() * 2) | 0);
    if (this.entities.countPassive() > 24) return;
    for (let i = 0; i < n; i++) {
      const lx = (rng() * CHUNK) | 0, lz = (rng() * CHUNK) | 0;
      const wx = chunk.cx * CHUNK + lx, wz = chunk.cz * CHUNK + lz;
      const y = this.world.surfaceY(wx, wz);
      if (y <= 0) continue;
      const ground = this.world.getBlock(wx, y, wz);
      if (ground !== B.GRASS && ground !== B.SNOWY_GRASS && ground !== B.SAND) continue;
      this.entities.spawnMob(type, wx + 0.5, y + 1.05, wz + 0.5);
    }
  }

  trySpawnHostiles(daylight) {
    if (daylight > 0.32) return;
    if (this.entities.countHostiles() >= 10) return;
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 18;
    const wx = Math.floor(this.player.pos[0] + Math.cos(a) * r);
    const wz = Math.floor(this.player.pos[2] + Math.sin(a) * r);
    const y = this.world.surfaceY(wx, wz);
    if (y <= 0) return;
    const lv = this.world.getLight(wx, y + 1, wz) & 15;
    if (lv > 4) return; // torches keep monsters away
    const type = HOSTILE_TYPES[(Math.random() * HOSTILE_TYPES.length) | 0];
    this.entities.spawnMob(type, wx + 0.5, y + 1.05, wz + 0.5);
  }

  updateWeather(dt) {
    this.rain.timer -= dt;
    if (!this.rain.active && this.rain.timer <= 0) {
      this.rain.active = true;
      this.rain.stopIn = 45 + Math.random() * 90;
    }
    if (this.rain.active) {
      this.rain.stopIn -= dt;
      if (this.rain.stopIn <= 0) {
        this.rain.active = false;
        this.rain.timer = 180 + Math.random() * 420;
      }
      // precipitation particles around the player
      const biome = this.world.biomeAt(Math.floor(this.player.pos[0]), Math.floor(this.player.pos[2]));
      const snowy = (biome || '').startsWith('snowy') || (biome || '').startsWith('frozen');
      for (let i = 0; i < (snowy ? 8 : 16); i++) {
        const px = this.player.pos[0] + (Math.random() - 0.5) * 26;
        const pz = this.player.pos[2] + (Math.random() - 0.5) * 26;
        const py = this.player.pos[1] + 9 + Math.random() * 6;
        this.particles.push({
          pos: [px, py, pz],
          vel: snowy ? [(Math.random() - 0.5) * 0.6, -1.6, (Math.random() - 0.5) * 0.6] : [0.4, -17, 0],
          life: snowy ? 7 : 1.1,
          color: snowy ? [0.95, 0.96, 1] : [0.35, 0.45, 0.85],
          size: snowy ? 1.6 : 1.1,
          rain: true,
        });
      }
      if (Math.random() < dt * 1.6 && !snowy) this.audio.play('rain');
    }
  }

  // ============================================================
  // particles
  // ============================================================
  tileColor(tile) {
    if (this.tileColors.has(tile)) return this.tileColors.get(tile);
    const [tx, ty] = this.atlas.tilePos(tile);
    const data = this.atlas.ctx.getImageData(tx + 4, ty + 4, 8, 8).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 100) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    n = Math.max(1, n);
    const c = [r / n / 255, g / n / 255, b / n / 255];
    this.tileColors.set(tile, c);
    return c;
  }
  spawnBreakParticles(x, y, z, blockId) {
    const c = this.tileColor(faceTexture(blockId, 2));
    for (let i = 0; i < 16; i++) {
      this.particles.push({
        pos: [x + Math.random(), y + Math.random(), z + Math.random()],
        vel: [(Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4],
        life: 0.5 + Math.random() * 0.5,
        color: c.map(v => v * (0.7 + Math.random() * 0.5)),
        size: 1.4 + Math.random(),
      });
    }
  }
  spawnExplosionParticles(x, y, z, r) {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const s = 3 + Math.random() * 8;
      this.particles.push({
        pos: [x, y, z],
        vel: [Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 2, Math.sin(a) * Math.cos(b) * s],
        life: 0.6 + Math.random() * 0.9,
        color: Math.random() < 0.5 ? [0.4, 0.4, 0.4] : [1, 0.6 + Math.random() * 0.3, 0.15],
        size: 2 + Math.random() * 2,
      });
    }
  }
  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (!p.rain) p.vel[1] -= 14 * dt;
      p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += p.vel[2] * dt;
      const bid = this.world.getBlock(Math.floor(p.pos[0]), Math.floor(p.pos[1]), Math.floor(p.pos[2]));
      if (blockDef(bid).solid) {
        if (p.rain) { this.particles.splice(i, 1); continue; }
        p.pos[1] = Math.ceil(p.pos[1]);
        p.vel[0] *= 0.6; p.vel[2] *= 0.6; p.vel[1] = 0;
      }
    }
    if (this.particles.length > 3800) this.particles.splice(0, this.particles.length - 3800);
  }
  particleVerts() {
    const out = new Float32Array(this.particles.length * 7);
    let o = 0;
    for (const p of this.particles) {
      out[o++] = p.pos[0]; out[o++] = p.pos[1]; out[o++] = p.pos[2];
      out[o++] = p.color[0]; out[o++] = p.color[1]; out[o++] = p.color[2];
      out[o++] = p.size;
    }
    return out;
  }

  // ============================================================
  // main loop
  // ============================================================
  frame(t) {
    requestAnimationFrame((nt) => this.frame(nt));
    const rawDt = Math.min(0.25, (t - this.lastT) / 1000 || 0.016);
    this.lastT = t;
    this.fps = this.fps * 0.95 + (1 / Math.max(rawDt, 1e-4)) * 0.05;

    if (!this.world || this.state === 'menu' || this.state === 'loading') return;

    const simRunning = this.state === 'playing' || this.state === 'inventory';
    if (simRunning) {
      this.accum = Math.min(this.accum + rawDt, 0.12);
      const step = 1 / 60;
      while (this.accum >= step) {
        this.tick(step);
        this.accum -= step;
      }
    }
    this.renderFrame(rawDt);
  }

  tick(dt) {
    const inputState = this.state === 'playing' ? this.input.state()
      : { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, attack: false, use: false };

    if (this.state === 'playing') {
      const [dx, dy] = this.input.consumeLook();
      this.player.look(dx, dy, this.settings.sensitivity);
    } else this.input.consumeLook();

    const wasInWater = this.player.inWater;
    this.player.update(dt, inputState);
    if (!wasInWater && this.player.inWater && Math.abs(this.player.vel[1]) > 3) this.audio.play('splash');

    // footsteps
    if (this.player.onGround) {
      const hv = Math.hypot(this.player.vel[0], this.player.vel[2]);
      this.stepDist += hv * dt;
      if (this.stepDist > 2.2 && hv > 0.8) {
        this.stepDist = 0;
        const under = this.world.getBlock(Math.floor(this.player.pos[0]), Math.floor(this.player.pos[1] - 0.1), Math.floor(this.player.pos[2]));
        this.audio.play(under === B.GRASS || under === B.SNOWY_GRASS ? 'stepGrass' : 'step');
      }
    }

    if (this.player.dead && this.state !== 'dead') {
      this.state = 'dead';
      this.input.exitLock();
      this.menus.showDeath(this.player.deathCause);
    }

    this.updateMining(dt, inputState);

    // world clock + scheduled ticks
    this.world.time += dt;
    this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
    this.world.processTicks();
    this.tickFurnaces(dt);

    const daylight = this.daylight();
    this.entities.update(dt, this.player, daylight, this);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.2;
      this.trySpawnHostiles(daylight);
    }
    this.updateWeather(dt);
    this.updateParticles(dt);

    this.autosaveT += dt;
    if (this.autosaveT > 45 && !this.savingChunks) {
      this.autosaveT = 0;
      this.savingChunks = true;
      this.saveAll().finally(() => { this.savingChunks = false; });
    }

    this.streamChunks();

    if (this.entities.atlasDirty) {
      this.entities.atlasDirty = false;
      this.renderer.uploadAtlas(this.atlas.canvas);
    }
  }

  daylight() {
    const sun = Math.sin(this.timeOfDay * Math.PI * 2);
    return Math.max(0.03, Math.min(1, sun * 2.1 + 0.16));
  }

  skyColors(daylight) {
    const sun = Math.sin(this.timeOfDay * Math.PI * 2);
    const lerp = (a, b, t) => a + (b - a) * t;
    const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    let top = mix3([0.015, 0.02, 0.06], [0.4, 0.65, 0.98], daylight);
    let horizon = mix3([0.04, 0.05, 0.1], [0.7, 0.83, 0.96], daylight);
    const sunset = Math.max(0, 1 - Math.abs(sun) * 4.5);
    if (sunset > 0) horizon = mix3(horizon, [0.95, 0.5, 0.25], sunset * 0.65);
    if (this.rain.active) {
      top = mix3(top, [0.32, 0.35, 0.4], 0.6 * daylight);
      horizon = mix3(horizon, [0.42, 0.45, 0.5], 0.6 * daylight);
    }
    return { top, horizon };
  }

  renderFrame(dt) {
    const daylight = this.daylight() * (this.rain.active ? 0.82 : 1);
    const { top, horizon } = this.skyColors(daylight);
    const rd = this.settings.renderDistance * CHUNK;
    const p = this.player;

    // camera: eye + view bob + sprint FOV kick
    const bob = p.onGround && !p.flying ? Math.sin(p.bobPhase) * 0.045 : 0;
    const eye = p.eyePos();
    eye[1] += bob;

    let fogColor = horizon, fogStart = rd * 0.55, fogEnd = rd * 0.98;
    let tint = [1, 1, 1];
    if (p.headInWater) {
      fogColor = [0.1, 0.2, 0.45];
      fogStart = 2; fogEnd = 18;
      tint = [0.6, 0.75, 1.1];
    }

    const scene = {
      eye, yaw: p.yaw, pitch: p.pitch,
      fov: this.settings.fov + (p.sprinting ? 8 : 0) + (p.flying && this.input.state().sprint ? 10 : 0),
      time: this.world.time,
      timeOfDay: this.timeOfDay,
      daylight,
      skyTop: top,
      fogColor, fogStart, fogEnd,
      tint,
      underwater: p.headInWater,
      selection: null,
      crack: null,
      entityVerts: this.entities.buildVerts(daylight),
      particleVerts: this.particleVerts(),
    };

    if (this.state === 'playing' && !p.dead) {
      const target = p.raycast();
      if (target) scene.selection = target;
      if (this.mining && this.mining.progress > 0.02) {
        scene.crack = { x: this.mining.x, y: this.mining.y, z: this.mining.z, stage: Math.min(9, this.mining.progress * 10 | 0) };
      }
    }

    this.renderer.render(scene);

    // HUD refresh
    this.hud.updateHotbar(this.inventory);
    this.hud.updateStatus(p, p.mode === 'creative');
    this.hud.updateDebug(this);
    this.audio.setAmbience(this.rain.active ? 0.8 : 0.25);
  }

  async respawn() {
    this.player.respawn();
    this.menus.hide();
    this.state = 'playing';
    this.input.requestLock();
  }
}
