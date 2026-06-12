// ============================================================
// Entities — lightweight ECS-style manager for mobs, dropped
// items, and arrows.
//   * box-model mobs (head/body/legs) batched to one buffer
//   * AI: wander, flee when hurt, chase (zombie/creeper/skeleton),
//     creeper fuse + explosion, skeleton arrows
//   * item drops bob, spin, magnet to the player, stack on pickup
// ============================================================
import { GRAVITY } from '../world/constants.js';
import { B, blockDef, faceTexture } from '../world/Blocks.js';
import { itemDef } from '../items/Items.js';
import { MOB_TILES, paintItemTile } from '../rendering/TextureAtlas.js';

const T = 1 / 16; // pixels -> blocks, MC-style part sizes

export const MOB_DEFS = {
  cow:      { hostile: false, hp: 10, speed: 1.4, w: 0.9, h: 1.3, drops: [{ item: 'beef', min: 1, max: 2 }],
              parts: [{ o: [0, 9*T, 0], s: [10*T, 9*T, 16*T], t: 'body' }, { o: [0, 16*T, -10*T], s: [8*T, 8*T, 7*T], t: 'face' },
                      ...legQuad(4, 9, 10, 5)] },
  pig:      { hostile: false, hp: 10, speed: 1.5, w: 0.9, h: 0.9, drops: [{ item: 'porkchop', min: 1, max: 2 }],
              parts: [{ o: [0, 7*T, 0], s: [9*T, 8*T, 15*T], t: 'body' }, { o: [0, 9*T, -10*T], s: [8*T, 8*T, 7*T], t: 'face' },
                      ...legQuad(4, 7, 9, 4)] },
  sheep:    { hostile: false, hp: 8, speed: 1.4, w: 0.9, h: 1.2, drops: [{ item: 'block:' + B.WOOL, min: 1, max: 2 }],
              parts: [{ o: [0, 9*T, 0], s: [9*T, 9*T, 14*T], t: 'body' }, { o: [0, 15*T, -9*T], s: [6*T, 7*T, 6*T], t: 'face' },
                      ...legQuad(4, 9, 9, 4)] },
  chicken:  { hostile: false, hp: 4, speed: 1.6, w: 0.5, h: 0.7, drops: [{ item: 'feather', min: 1, max: 2 }],
              parts: [{ o: [0, 5*T, 0], s: [5*T, 5*T, 7*T], t: 'body' }, { o: [0, 9*T, -4*T], s: [3*T, 5*T, 3*T], t: 'face' },
                      ...legQuad(2, 5, 4, 2)] },
  zombie:   { hostile: true, hp: 20, speed: 2.5, w: 0.6, h: 1.9, dmg: 3, drops: [],
              parts: humanoid('zombie') },
  skeleton: { hostile: true, hp: 16, speed: 2.4, w: 0.6, h: 1.95, dmg: 2, ranged: true, drops: [{ item: 'stick', min: 0, max: 1 }],
              parts: humanoid('skeleton') },
  creeper:  { hostile: true, hp: 20, speed: 2.6, w: 0.6, h: 1.6, dmg: 0, fuse: true, drops: [{ item: 'coal', min: 0, max: 1 }],
              parts: [{ o: [0, 9*T, 0], s: [7*T, 13*T, 5*T], t: 'body' }, { o: [0, 19*T, 0], s: [8*T, 8*T, 8*T], t: 'face' },
                      ...legQuad(3, 4, 4, 3)] },
};
function legQuad(w, legH, spreadZ, spreadX) {
  const parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push({ o: [sx * spreadX * T, legH * T / 2, sz * spreadZ * T / 1.6], s: [w * T, legH * T, w * T], t: 'legs', leg: sz });
  }
  return parts;
}
function humanoid(kind) {
  return [
    { o: [0, 1.05, 0], s: [8*T, 12*T, 4*T], t: 'body' },
    { o: [0, 1.65, 0], s: [8*T, 8*T, 8*T], t: 'face' },
    { o: [-6*T, 1.05, 0], s: [4*T, 12*T, 4*T], t: 'body', arm: -1 },
    { o: [6*T, 1.05, 0], s: [4*T, 12*T, 4*T], t: 'body', arm: 1 },
    { o: [-2*T, 0.375, 0], s: [4*T, 12*T, 4*T], t: 'legs', leg: -1 },
    { o: [2*T, 0.375, 0], s: [4*T, 12*T, 4*T], t: 'legs', leg: 1 },
  ];
}

let nextId = 1;

export class EntityManager {
  constructor(world, atlas) {
    this.world = world;
    this.atlas = atlas;
    this.entities = [];
    this.itemTiles = new Map();  // itemId -> atlas tile (rows 4-6: 64..111)
    this.nextItemTile = 64;
    this.atlasDirty = false;
    this.onSound = null;         // (name, pos)
    this.onExplosion = null;     // (x,y,z,power)
  }

  // ---- spawning ---------------------------------------------
  spawnMob(type, x, y, z) {
    const d = MOB_DEFS[type];
    if (!d) return null;
    const e = {
      id: nextId++, kind: 'mob', type, pos: [x, y, z], vel: [0, 0, 0],
      yaw: Math.random() * Math.PI * 2, hp: d.hp, w: d.w, h: d.h,
      onGround: false, wanderT: Math.random() * 3, wanderDir: null,
      hurtT: 0, attackT: 0, fuseT: 0, fleeT: 0, animT: Math.random() * 10, age: 0,
    };
    this.entities.push(e);
    return e;
  }
  dropItem(itemId, count, x, y, z, vel) {
    const e = {
      id: nextId++, kind: 'item', item: itemId, count,
      pos: [x, y, z], vel: vel || [(Math.random() - 0.5) * 2.4, 3 + Math.random() * 1.5, (Math.random() - 0.5) * 2.4],
      w: 0.25, h: 0.25, onGround: false, age: 0, pickupDelay: 0.6,
    };
    this.entities.push(e);
    this.ensureItemTile(itemId);
    return e;
  }
  spawnArrow(x, y, z, vel) {
    this.entities.push({ id: nextId++, kind: 'arrow', pos: [x, y, z], vel, w: 0.1, h: 0.1, age: 0 });
  }

  ensureItemTile(itemId) {
    if (itemId.startsWith('block:')) return -1;
    if (this.itemTiles.has(itemId)) return this.itemTiles.get(itemId);
    const tile = this.nextItemTile++;
    paintItemTile(this.atlas, itemId, tile);
    this.itemTiles.set(itemId, tile);
    this.atlasDirty = true;
    return tile;
  }

  countHostiles() { return this.entities.filter(e => e.kind === 'mob' && MOB_DEFS[e.type].hostile).length; }
  countPassive() { return this.entities.filter(e => e.kind === 'mob' && !MOB_DEFS[e.type].hostile).length; }

  // ---- physics shared by mobs/items/arrows -------------------
  collides(e, px, py, pz) {
    const hw = e.w / 2;
    const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw - 1e-7);
    const y0 = Math.floor(py), y1 = Math.floor(py + e.h - 1e-7);
    const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw - 1e-7);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const d = blockDef(this.world.getBlock(x, y, z));
      if (d.solid && !d.fluid) return true;
    }
    return false;
  }
  stepPhysics(e, dt, friction = 0.6) {
    const inWater = this.world.getBlock(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.3), Math.floor(e.pos[2])) === B.WATER;
    e.vel[1] -= (inWater ? GRAVITY * 0.3 : GRAVITY) * dt;
    if (inWater) e.vel[1] = Math.max(e.vel[1], -2);
    // y
    let ny = e.pos[1] + e.vel[1] * dt;
    if (this.collides(e, e.pos[0], ny, e.pos[2])) {
      if (e.vel[1] < 0) { e.onGround = true; e.pos[1] = Math.floor(ny) + 1; }
      e.vel[1] = 0;
    } else { e.pos[1] = ny; e.onGround = false; }
    // x / z with auto-jump for mobs
    for (const axis of [0, 2]) {
      const d = e.vel[axis] * dt;
      if (!d) continue;
      const np = [...e.pos]; np[axis] += d;
      if (!this.collides(e, np[0], np[1], np[2])) { e.pos[axis] = np[axis]; }
      else if (e.kind === 'mob' && e.onGround) { e.vel[1] = 7.2; e.vel[axis] *= 0.4; }
      else e.vel[axis] = 0;
    }
    if (e.onGround) { e.vel[0] *= Math.pow(friction, dt * 12); e.vel[2] *= Math.pow(friction, dt * 12); }
    return inWater;
  }

  // ---- main update ------------------------------------------
  update(dt, player, daylight, game) {
    const px = player.pos[0], py = player.pos[1], pz = player.pos[2];
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.age += dt;
      const dx = px - e.pos[0], dy = py - e.pos[1], dz = pz - e.pos[2];
      const dist = Math.hypot(dx, dy, dz);

      if (e.kind === 'item') {
        e.pickupDelay -= dt;
        const inWater = this.stepPhysics(e, dt, 0.4);
        if (inWater) e.vel[1] = Math.min(e.vel[1] + 8 * dt, 1.2);
        // magnet + pickup
        if (e.pickupDelay <= 0 && !player.dead) {
          if (dist < 1.9) {
            const pull = 5.5 / Math.max(dist, 0.3);
            e.vel[0] += (dx / dist) * pull * dt * 4;
            e.vel[1] += ((dy + 0.9) / dist) * pull * dt * 4;
            e.vel[2] += (dz / dist) * pull * dt * 4;
          }
          if (dist < 0.95) {
            const left = game.inventory.add(e.item, e.count, e.durability);
            if (left < e.count) {
              if (this.onSound) this.onSound('pickup', e.pos);
              if (left === 0) { this.entities.splice(i, 1); continue; }
              e.count = left;
            }
          }
        }
        if (e.age > 240) { this.entities.splice(i, 1); continue; }
        if (e.pos[1] < -10) { this.entities.splice(i, 1); }
        continue;
      }

      if (e.kind === 'arrow') {
        e.vel[1] -= 18 * dt;
        e.pos[0] += e.vel[0] * dt; e.pos[1] += e.vel[1] * dt; e.pos[2] += e.vel[2] * dt;
        const bid = this.world.getBlock(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]));
        if (blockDef(bid).solid) { this.entities.splice(i, 1); continue; }
        if (dist < 0.8 && !player.dead) {
          player.damage(3, 'arrow');
          player.vel[0] += e.vel[0] * 0.25; player.vel[2] += e.vel[2] * 0.25;
          this.entities.splice(i, 1); continue;
        }
        if (e.age > 8) this.entities.splice(i, 1);
        continue;
      }

      // ----- mobs -----
      const d = MOB_DEFS[e.type];
      e.hurtT = Math.max(0, e.hurtT - dt);
      e.attackT = Math.max(0, e.attackT - dt);

      // despawn rules
      if (dist > 72) { this.entities.splice(i, 1); continue; }
      if (d.hostile && daylight > 0.72 && dist > 24) { this.entities.splice(i, 1); continue; }

      let moveX = 0, moveZ = 0, speed = d.speed;

      if (e.fleeT > 0) {                           // run from the player
        e.fleeT -= dt;
        if (dist > 0.01) { moveX = -dx / dist; moveZ = -dz / dist; speed *= 1.6; }
      } else if (d.hostile && dist < 18 && !player.dead && player.mode !== 'creative') {
        e.yaw = Math.atan2(-dx, -dz);
        if (d.fuse) {                              // creeper
          if (dist > 2.6) { moveX = dx / dist; moveZ = dz / dist; e.fuseT = Math.max(0, e.fuseT - dt * 2); }
          else {
            e.fuseT += dt;
            if (e.fuseT > 1.5) {
              this.explode(e.pos[0], e.pos[1] + 0.8, e.pos[2], 2.6, player);
              this.entities.splice(i, 1);
              continue;
            }
          }
        } else if (d.ranged) {                     // skeleton
          if (dist > 9) { moveX = dx / dist; moveZ = dz / dist; }
          else if (dist < 5) { moveX = -dx / dist; moveZ = -dz / dist; }
          if (dist < 15 && e.attackT <= 0) {
            e.attackT = 2.1;
            const eh = e.pos[1] + e.h * 0.85;
            const tv = [dx / dist * 14, dy / dist * 14 + dist * 0.32, dz / dist * 14];
            this.spawnArrow(e.pos[0], eh, e.pos[2], tv);
            if (this.onSound) this.onSound('bow', e.pos);
          }
        } else {                                   // zombie
          if (dist > 1.4) { moveX = dx / dist; moveZ = dz / dist; }
          if (dist < 1.7 && e.attackT <= 0) {
            e.attackT = 1.1;
            player.damage(d.dmg, 'mob');
            player.vel[0] += (dx / dist) * 4; player.vel[1] += 2.4; player.vel[2] += (dz / dist) * 4;
            if (this.onSound) this.onSound('hurt', player.pos);
          }
        }
      } else {                                     // wander
        e.wanderT -= dt;
        if (e.wanderT <= 0) {
          e.wanderT = 2 + Math.random() * 5;
          e.wanderDir = Math.random() < 0.4 ? null : Math.random() * Math.PI * 2;
        }
        if (e.wanderDir != null) {
          moveX = -Math.sin(e.wanderDir); moveZ = -Math.cos(e.wanderDir);
          e.yaw = e.wanderDir;
          speed *= 0.45;
        }
      }

      const accel = e.onGround ? 10 : 2.5;
      e.vel[0] += (moveX * speed - e.vel[0]) * Math.min(1, accel * dt);
      e.vel[2] += (moveZ * speed - e.vel[2]) * Math.min(1, accel * dt);
      if (moveX || moveZ) {
        e.animT += dt * speed * 2.4;
        if (e.fleeT <= 0 && !(d.hostile && dist < 18)) e.yaw = Math.atan2(-moveX, -moveZ);
      }
      const inWater = this.stepPhysics(e, dt);
      if (inWater) e.vel[1] = Math.max(e.vel[1], 1.4); // mobs float up
      if (e.pos[1] < -10) { this.entities.splice(i, 1); continue; }
      // lava kills mobs
      if (this.world.getBlock(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.2), Math.floor(e.pos[2])) === B.LAVA) {
        this.hurt(e, 4, player);
      }
    }
  }

  hurt(e, dmg, player, knock) {
    if (e.kind !== 'mob') return;
    e.hp -= dmg;
    e.hurtT = 0.35;
    if (!MOB_DEFS[e.type].hostile) e.fleeT = 4;
    if (knock) {
      e.vel[0] += knock[0]; e.vel[1] += 4.5; e.vel[2] += knock[2];
    }
    if (this.onSound) this.onSound('mobhurt', e.pos);
    if (e.hp <= 0) this.kill(e);
  }
  kill(e) {
    const i = this.entities.indexOf(e);
    if (i < 0) return;
    this.entities.splice(i, 1);
    for (const drop of MOB_DEFS[e.type].drops) {
      const n = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
      if (n > 0) this.dropItem(drop.item, n, e.pos[0], e.pos[1] + 0.4, e.pos[2]);
    }
  }

  explode(x, y, z, radius, player) {
    if (this.onSound) this.onSound('explode', [x, y, z]);
    // carve sphere
    const r = Math.ceil(radius);
    for (let bx = -r; bx <= r; bx++) for (let by = -r; by <= r; by++) for (let bz = -r; bz <= r; bz++) {
      if (bx * bx + by * by + bz * bz > radius * radius) continue;
      const wx = Math.floor(x + bx), wy = Math.floor(y + by), wz = Math.floor(z + bz);
      const id = this.world.getBlock(wx, wy, wz);
      if (id === B.AIR || id === B.BEDROCK || blockDef(id).fluid) continue;
      this.world.setBlock(wx, wy, wz, B.AIR, 0, { silent: true });
    }
    // damage player + nearby mobs
    const hit = (pos) => {
      const dd = Math.hypot(pos[0] - x, pos[1] - y, pos[2] - z);
      return dd < radius * 2.2 ? Math.ceil((1 - dd / (radius * 2.2)) * 16) : 0;
    };
    const pd = hit([player.pos[0], player.pos[1] + 1, player.pos[2]]);
    if (pd > 0) {
      player.damage(pd, 'explosion');
      const dd = Math.max(0.5, Math.hypot(player.pos[0] - x, player.pos[2] - z));
      player.vel[0] += (player.pos[0] - x) / dd * 8;
      player.vel[1] += 6;
      player.vel[2] += (player.pos[2] - z) / dd * 8;
    }
    for (const e of [...this.entities]) {
      if (e.kind !== 'mob') continue;
      const md = hit(e.pos);
      if (md > 0) this.hurt(e, md, player);
    }
    if (this.onExplosion) this.onExplosion(x, y, z, radius);
  }

  // ray vs entity AABBs — returns nearest mob within reach
  raycastMob(eye, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const e of this.entities) {
      if (e.kind !== 'mob') continue;
      const hw = e.w / 2;
      const min = [e.pos[0] - hw, e.pos[1], e.pos[2] - hw];
      const max = [e.pos[0] + hw, e.pos[1] + e.h, e.pos[2] + hw];
      let t0 = 0, t1 = bestT, ok = true;
      for (let a = 0; a < 3; a++) {
        const inv = 1 / (dir[a] || 1e-9);
        let ta = (min[a] - eye[a]) * inv, tb = (max[a] - eye[a]) * inv;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < bestT) { bestT = t0; best = e; }
    }
    return best ? { entity: best, dist: bestT } : null;
  }

  // ---- rendering: batch every entity into one vertex array ---
  buildVerts(timeOfDay) {
    const out = [];
    for (const e of this.entities) {
      const lv = this.world.getLight(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.5), Math.floor(e.pos[2]));
      const sky = (lv >> 4) / 15, blk = (lv & 15) / 15;
      let light = Math.max(blk, sky * Math.max(timeOfDay, 0.18));
      light = 0.18 + light * 0.85;

      if (e.kind === 'item') {
        const spin = e.age * 1.6;
        const bob = Math.sin(e.age * 2.2) * 0.06 + 0.18;
        if (e.item.startsWith('block:')) {
          const bid = +e.item.slice(6);
          this.miniCube(out, e.pos[0], e.pos[1] + bob, e.pos[2], 0.14, spin, bid, light);
        } else {
          const tile = this.ensureItemTile(e.item);
          this.flatQuad(out, e.pos[0], e.pos[1] + bob + 0.08, e.pos[2], 0.36, spin, tile, light);
        }
        continue;
      }
      if (e.kind === 'arrow') {
        this.flatQuad(out, e.pos[0], e.pos[1], e.pos[2], 0.2, Math.atan2(-e.vel[0], -e.vel[2]), this.ensureItemTile('stick'), light);
        continue;
      }

      const d = MOB_DEFS[e.type];
      const tiles = MOB_TILES[e.type];
      const flash = e.hurtT > 0 ? 1.8 : (e.fuseT > 0 && (e.fuseT * 8 | 0) % 2 ? 2.2 : 1);
      const swing = Math.sin(e.animT * 4) * 0.18;
      for (const part of d.parts) {
        const ox = part.o[0], oy = part.o[1];
        let oz = part.o[2];
        if (part.leg) oz += swing * (part.o[0] * part.leg > 0 ? 1 : -1); // simple gait
        // rotate offset by yaw
        const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
        const rx = ox * cy + oz * sy;
        const rz = -ox * sy + oz * cy;
        const baseTile = part.t === 'legs' ? tiles.legs : tiles.body;
        const frontTile = part.t === 'face' ? tiles.face : baseTile;
        this.box(out,
          e.pos[0] + rx, e.pos[1] + oy, e.pos[2] + rz,
          part.s[0], part.s[1], part.s[2], e.yaw,
          baseTile, frontTile,
          Math.min(1.6, light * flash));
      }
    }
    return new Float32Array(out);
  }

  // axis box centered at (cx,cy,cz) rotated around its own center by yaw
  box(out, cx, cy, cz, sx, sy, sz, yaw, tile, faceTile, light) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const rot = (x, z) => [x * cyw + z * syw, -x * syw + z * cyw];
    const col = tile % 16, row = (tile / 16) | 0;
    const fcol = faceTile % 16, frow = (faceTile / 16) | 0;
    const uv = (u, v, front) => [
      ((front ? fcol : col) + 0.02 + u * 0.96) / 16,
      ((front ? frow : row) + 0.02 + v * 0.96) / 16,
    ];
    const shadeOf = [0.78, 0.78, 1.0, 0.5, 0.62, 0.92];
    // faces: +x -x +y -y +z -z(front)
    const faces = [
      [[hx,-hy,-hz],[hx,hy,-hz],[hx,hy,hz],[hx,-hy,hz]],
      [[-hx,-hy,hz],[-hx,hy,hz],[-hx,hy,-hz],[-hx,-hy,-hz]],
      [[-hx,hy,-hz],[hx,hy,-hz],[hx,hy,hz],[-hx,hy,hz]],
      [[-hx,-hy,hz],[hx,-hy,hz],[hx,-hy,-hz],[-hx,-hy,-hz]],
      [[-hx,-hy,hz],[-hx,hy,hz],[hx,hy,hz],[hx,-hy,hz]],
      [[hx,-hy,-hz],[hx,hy,-hz],[-hx,hy,-hz],[-hx,-hy,-hz]],
    ];
    const faceUV = [[0,1],[1,1],[1,0],[0,0]];
    for (let f = 0; f < 6; f++) {
      const front = f === 5;
      const verts = faces[f].map((p, vi) => {
        const [px, pz] = rot(p[0], p[2]);
        const [u, v] = uv(faceUV[vi][0], faceUV[vi][1], front);
        return [cx + px, cy + p[1], cz + pz, u, v, light * shadeOf[f]];
      });
      for (const i of [0, 1, 2, 0, 2, 3]) out.push(...verts[i]);
    }
  }

  miniCube(out, cx, cy, cz, half, yaw, blockId, light) {
    // mini cube uses the block's own face textures
    const col = (t) => [t % 16, (t / 16) | 0];
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const rot = (x, z) => [x * cyw + z * syw, -x * syw + z * cyw];
    const h = half;
    const faces = [
      [0, [[h,-h,-h],[h,h,-h],[h,h,h],[h,-h,h]], 0.78],
      [1, [[-h,-h,h],[-h,h,h],[-h,h,-h],[-h,-h,-h]], 0.78],
      [2, [[-h,h,-h],[h,h,-h],[h,h,h],[-h,h,h]], 1.0],
      [3, [[-h,-h,h],[h,-h,h],[h,-h,-h],[-h,-h,-h]], 0.5],
      [4, [[-h,-h,h],[-h,h,h],[h,h,h],[h,-h,h]], 0.92],
      [5, [[h,-h,-h],[h,h,-h],[-h,h,-h],[-h,-h,-h]], 0.62],
    ];
    const faceUV = [[0,1],[0,0],[1,0],[1,1]];
    for (const [fid, pts, shade] of faces) {
      const [c, r] = col(faceTexture(blockId, fid));
      const verts = pts.map((p, vi) => {
        const [px, pz] = rot(p[0], p[2]);
        return [cx + px, cy + h + p[1], cz + pz,
          (c + 0.02 + faceUV[vi][0] * 0.96) / 16, (r + 0.02 + faceUV[vi][1] * 0.96) / 16,
          light * shade];
      });
      for (const i of [0, 1, 2, 0, 2, 3]) out.push(...verts[i]);
    }
  }

  flatQuad(out, cx, cy, cz, size, yaw, tile, light) {
    const col = tile % 16, row = (tile / 16) | 0;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const h = size / 2;
    const pts = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const faceUV = [[0,1],[1,1],[1,0],[0,0]];
    const verts = pts.map((p, vi) => [
      cx + p[0] * cyw, cy + p[1] + h, cz - p[0] * syw,
      (col + 0.02 + faceUV[vi][0] * 0.96) / 16, (row + 0.02 + faceUV[vi][1] * 0.96) / 16,
      light,
    ]);
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...verts[i]);
  }

  serialize() {
    return this.entities.filter(e => e.kind === 'item' || e.kind === 'mob').map(e => ({
      kind: e.kind, type: e.type, item: e.item, count: e.count, pos: e.pos, hp: e.hp,
    }));
  }
  deserialize(list) {
    for (const s of list || []) {
      if (s.kind === 'mob' && MOB_DEFS[s.type]) {
        const e = this.spawnMob(s.type, s.pos[0], s.pos[1], s.pos[2]);
        if (e && s.hp) e.hp = s.hp;
      } else if (s.kind === 'item' && itemDef(s.item)) {
        this.dropItem(s.item, s.count || 1, s.pos[0], s.pos[1], s.pos[2], [0, 0, 0]);
      }
    }
  }
}
