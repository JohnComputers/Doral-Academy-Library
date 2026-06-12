// ============================================================
// Input — keyboard / mouse / pointer lock. Exposes a polled
// state object plus edge-triggered action callbacks.
// ============================================================
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = [false, false, false];
    this.locked = false;
    this.actions = {};      // name -> fn  (edge events)
    this.lookDX = 0;
    this.lookDY = 0;
    this.lastSpace = -10;

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      if (k === 'Space') {
        const now = performance.now() / 1000;
        if (now - this.lastSpace < 0.28) this.fire('doubleJump');
        this.lastSpace = now;
      }
      if (k.startsWith('Digit')) {
        const n = +k.slice(5);
        if (n >= 1 && n <= 9) this.fire('hotbar', n - 1);
      }
      const map = {
        KeyE: 'inventory', Escape: 'escape', KeyQ: 'drop', F3: 'debug',
        KeyF: 'debug2', Enter: 'enter',
      };
      if (map[k]) { if (k === 'F3') e.preventDefault(); this.fire(map[k]); }
      if (k === 'Tab') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      if (this.locked) this.fire('mouse' + e.button);
    });
    document.addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.fire(this.locked ? 'lock' : 'unlock');
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.fire('scroll', Math.sign(e.deltaY));
    }, { passive: false });
  }

  on(name, fn) { this.actions[name] = fn; }
  fire(name, arg) { if (this.actions[name]) this.actions[name](arg); }

  requestLock() {
    this.canvas.requestPointerLock();
  }
  exitLock() { if (this.locked) document.exitPointerLock(); }

  consumeLook() {
    const d = [this.lookDX, this.lookDY];
    this.lookDX = 0; this.lookDY = 0;
    return d;
  }

  state() {
    const k = this.keys;
    return {
      forward: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      strafe: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      jump: k.has('Space'),
      sneak: k.has('ShiftLeft') || k.has('ShiftRight'),
      sprint: k.has('ControlLeft') || k.has('ControlRight'),
      attack: this.mouseDown[0],
      use: this.mouseDown[2],
    };
  }
}
