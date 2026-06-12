// ============================================================
// Player — first-person controller.
//   * AABB 0.6 × 1.8 × 0.6, eye at +1.62 (1.27 when sneaking)
//   * axis-separated swept collision against solid blocks
//   * walking / sprinting / sneaking (edge-safe) / swimming /
//     creative flight (double-tap space)
//   * DDA voxel raycast for targeting
// ============================================================
import { GRAVITY, REACH } from '../world/constants.js';
import { B, blockDef } from '../world/Blocks.js';
import { forward } from '../engine/math.js';

const W = 0.6, H = 1.8, HALF = W / 2;
const EYE_STAND = 1.62, EYE_SNEAK = 1.27;

export class Player {
  constructor(world, mode = 'survival') {
    this.world = world;
    this.mode = mode;            // 'survival' | 'creative'
    this.pos = [8, 80, 8];       // feet position
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.inLava = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.fallStart = null;       // y where the current fall began
    this.health = 20;
    this.maxHealth = 20;
    this.hunger = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.dead = false;
    this.hurtTime = 0;           // red flash timer
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.spawn = [8, 80, 8];
    this.bobPhase = 0;
    this.lastSpaceTap = -1;
  }

  eyeHeight() { return this.sneaking ? EYE_SNEAK : EYE_STAND; }
  eyePos() { return [this.pos[0], this.pos[1] + this.eyeHeight(), this.pos[2]]; }

  look(dx, dy, sensitivity) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  isSolidAt(x, y, z) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const def = blockDef(id);
    return def && def.solid && !def.fluid;
  }

  // does the player's AABB at (px,py,pz) collide with any solid block?
  collides(px, py, pz, h = H) {
    const x0 = Math.floor(px - HALF), x1 = Math.floor(px + HALF - 1e-7);
    const y0 = Math.floor(py), y1 = Math.floor(py + h - 1e-7);
    const z0 = Math.floor(pz - HALF), z1 = Math.floor(pz + HALF - 1e-7);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const def = blockDef(this.world.getBlock(x, y, z));
      if (def && def.solid && !def.fluid) return true;
    }
    return false;
  }

  // which fluids overlap the body?
  scanFluids() {
    let water = false, lava = false, headWater = false;
    const px = this.pos[0], pz = this.pos[2];
    for (let dy = 0.1; dy < H; dy += 0.6) {
      const id = this.world.getBlock(Math.floor(px), Math.floor(this.pos[1] + dy), Math.floor(pz));
      if (id === B.WATER) water = true;
      if (id === B.LAVA) lava = true;
    }
    const eye = this.world.getBlock(Math.floor(px), Math.floor(this.pos[1] + this.eyeHeight()), Math.floor(pz));
    if (eye === B.WATER) headWater = true;
    this.inWater = water;
    this.inLava = lava;
    this.headInWater = headWater;
  }

  toggleFlight() {
    if (this.mode !== 'creative') return;
    this.flying = !this.flying;
    if (this.flying) { this.vel[1] = 0; this.fallStart = null; }
  }

  update(dt, input) {
    if (this.dead) return;
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.scanFluids();

    const inFluid = this.inWater || this.inLava;
    this.sneaking = input.sneak && !this.flying;
    this.sprinting = input.sprint && input.forward > 0 && !this.sneaking && this.hunger > 6;

    // ---- wish direction (camera-relative, horizontal) ----
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = (-sy * input.forward) + (cy * input.strafe);
    let wz = (-cy * input.forward) + (-sy * input.strafe);
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    let speed = 4.32;
    if (this.sprinting) speed = 5.6;
    if (this.sneaking) speed = 1.3;
    if (inFluid && !this.flying) speed *= this.inLava ? 0.35 : 0.55;
    if (this.flying) speed = input.sprint ? 21 : 10.9;

    // ---- vertical ----
    if (this.flying) {
      let vy = 0;
      if (input.jump) vy += speed;
      if (input.sneak) vy -= speed;
      this.vel[1] += (vy - this.vel[1]) * Math.min(1, dt * 12);
      this.fallStart = null;
    } else if (inFluid) {
      const buoy = this.inLava ? 6 : 10;
      this.vel[1] -= (GRAVITY * 0.28) * dt;
      if (input.jump) this.vel[1] += buoy * dt * 2.4;
      this.vel[1] = Math.max(-4.2, Math.min(4.5, this.vel[1]));
      this.fallStart = null;
    } else {
      this.vel[1] -= GRAVITY * dt;
      this.vel[1] = Math.max(this.vel[1], -55);
      if (input.jump && this.onGround) {
        this.vel[1] = 8.2;
        this.onGround = false;
        this.exhaustion += 0.05;
      }
      if (this.fallStart === null && this.vel[1] < -0.01 && !this.onGround) this.fallStart = this.pos[1];
    }

    // ---- horizontal accel (snappier on ground) ----
    const accel = this.onGround || this.flying ? 14 : (inFluid ? 6 : 3.2);
    this.vel[0] += (wx * speed - this.vel[0]) * Math.min(1, accel * dt);
    this.vel[2] += (wz * speed - this.vel[2]) * Math.min(1, accel * dt);

    // ---- integrate with axis-separated collision ----
    this.move(this.vel[0] * dt, this.vel[1] * dt, this.vel[2] * dt, input);

    // ---- fall damage ----
    if (this.onGround && this.fallStart !== null) {
      const dist = this.fallStart - this.pos[1];
      this.fallStart = null;
      if (dist > 3.2 && this.mode === 'survival') {
        const dmg = Math.floor(dist - 3);
        if (dmg > 0) this.damage(dmg, 'fall');
      }
    }
    if (this.inWater || this.flying) this.fallStart = null;

    // ---- lava damage ----
    if (this.inLava && this.mode === 'survival') {
      this.lavaTimer = (this.lavaTimer || 0) + dt;
      if (this.lavaTimer > 0.5) { this.lavaTimer = 0; this.damage(4, 'lava'); }
    } else this.lavaTimer = 0;

    // ---- drowning ----
    if (this.headInWater && this.mode === 'survival') {
      this.air = (this.air === undefined ? 10 : this.air) - dt;
      if (this.air < 0) { this.air = 0; this.drownTimer = (this.drownTimer || 0) + dt;
        if (this.drownTimer > 1) { this.drownTimer = 0; this.damage(2, 'drown'); } }
    } else { this.air = 10; this.drownTimer = 0; }

    // ---- hunger / regen (survival) ----
    if (this.mode === 'survival') {
      const moving = Math.hypot(this.vel[0], this.vel[2]) > 0.5;
      this.exhaustion += dt * (this.sprinting ? 0.12 : moving ? 0.015 : 0.003);
      if (this.exhaustion >= 4) {
        this.exhaustion -= 4;
        if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
        else this.hunger = Math.max(0, this.hunger - 1);
      }
      if (this.hunger >= 18 && this.health < this.maxHealth) {
        this.regenTimer += dt;
        if (this.regenTimer > 2.5) { this.regenTimer = 0; this.health = Math.min(this.maxHealth, this.health + 1); this.exhaustion += 1.5; }
      } else this.regenTimer = 0;
      if (this.hunger <= 0) {
        this.starveTimer += dt;
        if (this.starveTimer > 4) { this.starveTimer = 0; if (this.health > 1) this.damage(1, 'starve'); }
      } else this.starveTimer = 0;
    }

    // ---- view bob ----
    const hv = Math.hypot(this.vel[0], this.vel[2]);
    if (this.onGround && hv > 0.5) this.bobPhase += dt * hv * 1.6;

    if (this.pos[1] < -12) this.damage(1000, 'void');
  }

  move(dx, dy, dz, input) {
    const sneakEdge = this.sneaking && this.onGround;
    const startGround = this.onGround;

    // y axis
    if (dy !== 0) {
      const ny = this.pos[1] + dy;
      if (this.collides(this.pos[0], ny, this.pos[2])) {
        if (dy < 0) this.onGround = true;
        this.vel[1] = 0;
        // snap to block boundary
        this.pos[1] = dy < 0 ? Math.floor(ny) + 1 : this.pos[1];
      } else {
        this.pos[1] = ny;
        this.onGround = false;
      }
    }

    const tryAxis = (axis, d) => {
      if (d === 0) return;
      const np = [...this.pos];
      np[axis] += d;
      // sneak: don't walk off edges
      if (sneakEdge && startGround && !this.collides(np[0], np[1] - 0.05, np[2], 0.04)) {
        this.vel[axis] = 0;
        return;
      }
      if (!this.collides(np[0], np[1], np[2])) {
        this.pos[axis] = np[axis];
        return;
      }
      // step-up: try climbing 0.6 if on ground
      if (this.onGround || this.inWater) {
        const stepY = Math.floor(this.pos[1]) + 1.001;
        if (stepY - this.pos[1] <= 0.62 && !this.collides(np[0], stepY, np[2])) {
          this.pos[axis] = np[axis];
          this.pos[1] = stepY;
          return;
        }
      }
      this.vel[axis] = 0;
    };
    tryAxis(0, dx);
    tryAxis(2, dz);
  }

  damage(amount, cause) {
    if (this.mode === 'creative' && cause !== 'void') return;
    if (this.dead) return;
    this.health -= amount;
    this.hurtTime = 0.4;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathCause = cause;
    }
    if (this.onHurt) this.onHurt(cause);
  }

  eat(food, sat) {
    this.hunger = Math.min(20, this.hunger + food);
    this.saturation = Math.min(this.hunger, this.saturation + sat);
  }

  respawn() {
    this.pos = [...this.spawn];
    // find safe y
    let y = this.world.surfaceY(Math.floor(this.pos[0]), Math.floor(this.pos[2]));
    if (y > 0) this.pos[1] = y + 1;
    this.vel = [0, 0, 0];
    this.health = this.maxHealth;
    this.hunger = 20;
    this.saturation = 5;
    this.dead = false;
    this.fallStart = null;
    this.flying = false;
  }

  // DDA voxel raycast. Returns {x,y,z, face:[nx,ny,nz], dist} or null.
  raycast(maxDist = REACH) {
    const eye = this.eyePos();
    const dir = forward(this.yaw, this.pitch);
    let [x, y, z] = eye.map(Math.floor);
    const step = dir.map(d => (d > 0 ? 1 : -1));
    const tDelta = dir.map(d => Math.abs(1 / (d || 1e-9)));
    const tMax = [0, 1, 2].map(i => {
      const o = eye[i] - Math.floor(eye[i]);
      return tDelta[i] * (step[i] > 0 ? 1 - o : o);
    });
    let face = [0, 0, 0];
    let t = 0;
    for (let i = 0; i < 256; i++) {
      const id = this.world.getBlock(x, y, z);
      const def = blockDef(id);
      if (id !== B.AIR && def && !def.fluid) {
        return { x, y, z, id, face, dist: t };
      }
      // advance to next voxel boundary
      let axis = 0;
      if (tMax[1] < tMax[0]) axis = 1;
      if (tMax[2] < tMax[axis]) axis = 2;
      t = tMax[axis];
      if (t > maxDist) return null;
      tMax[axis] += tDelta[axis];
      if (axis === 0) { x += step[0]; face = [-step[0], 0, 0]; }
      else if (axis === 1) { y += step[1]; face = [0, -step[1], 0]; }
      else { z += step[2]; face = [0, 0, -step[2]]; }
    }
    return null;
  }

  // would placing a block at (x,y,z) intersect the player?
  intersectsBlock(x, y, z) {
    return (
      x + 1 > this.pos[0] - HALF && x < this.pos[0] + HALF &&
      y + 1 > this.pos[1] && y < this.pos[1] + H &&
      z + 1 > this.pos[2] - HALF && z < this.pos[2] + HALF
    );
  }
}
