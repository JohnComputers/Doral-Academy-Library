// ============================================================
// Menus — title screen, world list, pause, settings, death.
// Plain DOM with the game's pixel UI styling.
// ============================================================
export class Menus {
  constructor() {
    this.root = document.getElementById('menus');
    this.handlers = {};
    this.settings = null;
  }
  on(name, fn) { this.handlers[name] = fn; }
  fire(name, arg) { if (this.handlers[name]) this.handlers[name](arg); }
  hide() { this.root.classList.add('hidden'); this.root.innerHTML = ''; }
  show() { this.root.classList.remove('hidden'); }

  panel(title) {
    this.root.innerHTML = '';
    this.show();
    const p = document.createElement('div');
    p.className = 'menuPanel';
    if (title) {
      const h = document.createElement('h1');
      h.textContent = title;
      p.appendChild(h);
    }
    this.root.appendChild(p);
    return p;
  }
  button(parent, label, fn, cls = '') {
    const b = document.createElement('button');
    b.className = 'mbtn ' + cls;
    b.textContent = label;
    b.addEventListener('click', () => { this.fire('click'); fn(); });
    parent.appendChild(b);
    return b;
  }

  // ---------------- title ------------------------------------
  showTitle(worlds) {
    const p = this.panel(null);
    const logo = document.createElement('div');
    logo.className = 'logo';
    logo.innerHTML = 'VOXEL<span>CRAFT</span>';
    p.appendChild(logo);
    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = 'An infinite procedural sandbox, entirely in your browser';
    p.appendChild(sub);

    this.button(p, 'Singleplayer', () => this.showWorlds(worlds), 'big');
    this.button(p, 'Settings', () => this.showSettings(() => this.showTitle(worlds)), 'big');
    const foot = document.createElement('p');
    foot.className = 'foot';
    foot.textContent = 'WebGL2 · no plugins · saves locally';
    p.appendChild(foot);
  }

  // ---------------- world select ------------------------------
  showWorlds(worlds) {
    const p = this.panel('Select world');
    const list = document.createElement('div');
    list.className = 'worldList';
    if (!worlds.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No worlds yet — create your first one below.';
      list.appendChild(empty);
    }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'worldRow';
      const info = document.createElement('div');
      info.innerHTML = `<b>${escapeHTML(w.name)}</b><br><small>${w.mode || 'survival'} · seed ${w.seed} · ${new Date(w.savedAt).toLocaleString()}</small>`;
      row.appendChild(info);
      const btns = document.createElement('div');
      this.button(btns, 'Play', () => this.fire('loadWorld', w.name));
      this.button(btns, 'Delete', () => {
        if (confirm(`Delete world "${w.name}"? This cannot be undone.`)) this.fire('deleteWorld', w.name);
      }, 'danger');
      row.appendChild(btns);
      list.appendChild(row);
    }
    p.appendChild(list);

    const form = document.createElement('div');
    form.className = 'newWorld';
    form.innerHTML = `
      <h3>Create new world</h3>
      <label>Name <input id="wname" value="New World" maxlength="24"></label>
      <label>Seed <input id="wseed" placeholder="leave empty for random"></label>
      <label>Mode
        <select id="wmode">
          <option value="survival">Survival</option>
          <option value="creative">Creative</option>
        </select>
      </label>`;
    p.appendChild(form);
    this.button(p, 'Create world', () => {
      const name = form.querySelector('#wname').value.trim() || 'New World';
      const seedStr = form.querySelector('#wseed').value.trim();
      let seed;
      if (seedStr === '') seed = (Math.random() * 0xffffffff) >>> 0;
      else if (/^-?\d+$/.test(seedStr)) seed = (+seedStr) >>> 0;
      else { seed = 0; for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; }
      this.fire('newWorld', { name, seed, mode: form.querySelector('#wmode').value });
    }, 'big');
    this.button(p, 'Back', () => this.fire('title'));
  }

  // ---------------- settings ---------------------------------
  showSettings(back) {
    const s = this.settings;
    const p = this.panel('Settings');
    const make = (label, min, max, step, key, fmt) => {
      const row = document.createElement('label');
      row.className = 'setRow';
      const span = document.createElement('span');
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = step;
      input.value = s[key];
      const update = () => { span.textContent = `${label}: ${fmt(input.value)}`; };
      input.addEventListener('input', () => { s[key] = +input.value; update(); this.fire('settings'); });
      update();
      row.appendChild(span); row.appendChild(input);
      p.appendChild(row);
    };
    make('Render distance', 3, 16, 1, 'renderDistance', v => v + ' chunks');
    make('Field of view', 50, 110, 1, 'fov', v => v + '°');
    make('Mouse sensitivity', 0.0008, 0.006, 0.0002, 'sensitivity', v => Math.round(v / 0.0024 * 100) + '%');
    make('Volume', 0, 1, 0.05, 'volume', v => Math.round(v * 100) + '%');
    this.button(p, 'Done', back, 'big');
  }

  // ---------------- pause ------------------------------------
  showPause() {
    const p = this.panel('Game paused');
    this.button(p, 'Back to game', () => this.fire('resume'), 'big');
    this.button(p, 'Settings', () => this.showSettings(() => this.showPause()));
    this.button(p, 'Controls', () => this.showControls(() => this.showPause()));
    this.button(p, 'Save & quit to title', () => this.fire('quit'), 'danger');
  }

  showControls(back) {
    const p = this.panel('Controls');
    const rows = [
      ['W A S D', 'Move'], ['Mouse', 'Look'], ['Space', 'Jump / swim up'],
      ['Double Space', 'Toggle flight (creative)'], ['Shift', 'Sneak / fly down'],
      ['Ctrl', 'Sprint'], ['Left click', 'Mine / attack'], ['Right click', 'Place / use / eat'],
      ['E', 'Inventory'], ['Q', 'Drop item'], ['1-9 / scroll', 'Hotbar'], ['F3', 'Debug info'], ['Esc', 'Pause'],
    ];
    const table = document.createElement('div');
    table.className = 'controls';
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.innerHTML = `<kbd>${k}</kbd><span>${v}</span>`;
      table.appendChild(r);
    }
    p.appendChild(table);
    this.button(p, 'Done', back, 'big');
  }

  // ---------------- death ------------------------------------
  showDeath(cause) {
    const p = this.panel('You died!');
    const msg = document.createElement('p');
    msg.className = 'hint';
    msg.textContent = {
      fall: 'You hit the ground too hard.',
      lava: 'You tried to swim in lava.',
      drown: 'You drowned.',
      mob: 'You were slain.',
      arrow: 'You were shot.',
      explosion: 'You were blown up.',
      starve: 'You starved to death.',
      void: 'You fell out of the world.',
    }[cause] || 'You died.';
    p.appendChild(msg);
    this.button(p, 'Respawn', () => this.fire('respawn'), 'big');
    this.button(p, 'Title screen', () => this.fire('quit'));
  }

  showLoading(text) {
    const p = this.panel(null);
    const d = document.createElement('div');
    d.className = 'loading';
    d.textContent = text;
    p.appendChild(d);
  }
}
function escapeHTML(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
