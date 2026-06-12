// ============================================================
// SaveManager — IndexedDB persistence.
//   db "voxelcraft" → store "worlds"  (meta per world name)
//                   → store "chunks"  (modified chunks, key "world/x,z")
// Survives refresh; only player-modified chunks are stored, the
// rest regenerate deterministically from the seed.
// ============================================================
const DB_NAME = 'voxelcraft', DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}
function get(db, store, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const req = t.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function allKeys(db, store) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const req = t.objectStore(store).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SaveManager {
  constructor() { this.db = null; }
  async init() {
    try { this.db = await openDB(); } catch (e) { console.warn('IndexedDB unavailable:', e); }
    return this;
  }

  async listWorlds() {
    if (!this.db) return [];
    const keys = await allKeys(this.db, 'worlds');
    const out = [];
    for (const k of keys) out.push(await get(this.db, 'worlds', k));
    return out.filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  async loadWorldMeta(name) {
    if (!this.db) return null;
    return await get(this.db, 'worlds', name);
  }

  async saveWorld(name, meta, world, entities) {
    if (!this.db) return;
    meta.savedAt = Date.now();
    meta.name = name;
    meta.entities = entities;
    await tx(this.db, 'worlds', 'readwrite', s => s.put(meta, name));
    // persist only modified chunks
    const dirty = [];
    for (const c of world.chunks.values()) if (c.modified) dirty.push(c);
    if (dirty.length) {
      await new Promise((resolve, reject) => {
        const t = this.db.transaction('chunks', 'readwrite');
        const s = t.objectStore('chunks');
        for (const c of dirty) {
          s.put({
            blocks: c.blocks.buffer.slice(0), meta: c.meta.buffer.slice(0),
            heightmap: c.heightmap.buffer.slice(0),
            biomes: c.biomes ? c.biomes.buffer.slice(0) : null,
            biomeNames: c.biomeNames,
          }, name + '/' + c.cx + ',' + c.cz);
        }
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    }
  }

  async loadChunk(worldName, cx, cz) {
    if (!this.db) return null;
    return await get(this.db, 'chunks', worldName + '/' + cx + ',' + cz);
  }

  async deleteWorld(name) {
    if (!this.db) return;
    await tx(this.db, 'worlds', 'readwrite', s => s.delete(name));
    const keys = await allKeys(this.db, 'chunks');
    await new Promise((resolve, reject) => {
      const t = this.db.transaction('chunks', 'readwrite');
      const s = t.objectStore('chunks');
      for (const k of keys) if (typeof k === 'string' && k.startsWith(name + '/')) s.delete(k);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }
}

// settings live in localStorage (small + synchronous)
export const Settings = {
  defaults: { renderDistance: 8, fov: 75, sensitivity: 0.0024, volume: 0.8 },
  load() {
    try { return Object.assign({}, this.defaults, JSON.parse(localStorage.getItem('voxelcraft.settings') || '{}')); }
    catch { return { ...this.defaults }; }
  },
  save(s) { try { localStorage.setItem('voxelcraft.settings', JSON.stringify(s)); } catch {} },
};
