// ============================================================
// main.js — boot. Builds the atlas, GL renderer, UI, audio and
// save systems, then hands control to Game + Menus.
// ============================================================
import { TextureAtlas, paintMobTiles } from './rendering/TextureAtlas.js';
import { Renderer } from './rendering/Renderer.js';
import { HUD } from './ui/HUD.js';
import { InventoryUI } from './ui/InventoryUI.js';
import { Menus } from './ui/Menus.js';
import { Audio } from './audio/Audio.js';
import { Input } from './engine/Input.js';
import { Game } from './engine/Game.js';
import { SaveManager, Settings } from './save/SaveManager.js';

async function boot() {
  const canvas = document.getElementById('game');
  const settings = Settings.load();

  const atlas = new TextureAtlas();
  paintMobTiles(atlas);

  let renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (e) {
    document.getElementById('menus').innerHTML =
      `<div class="menuPanel"><h1>Unsupported browser</h1><p class="hint">${e.message}</p>
       <p class="hint">VoxelCraft needs WebGL2 — try a current version of Chrome, Edge, Firefox or Safari.</p></div>`;
    return;
  }
  renderer.uploadAtlas(atlas.canvas);

  const hud = new HUD(atlas);
  hud.setVisible(false);
  const menus = new Menus();
  menus.settings = settings;
  const audio = new Audio();
  audio.volume = settings.volume;
  const input = new Input(canvas);
  const save = await new SaveManager().init();

  const game = new Game({
    canvas, renderer, atlas, hud, menus, audio, input, save, settings,
    invUI: null, // set below (needs game reference)
  });
  game.invUI = new InventoryUI(game);

  // ---- menu wiring ------------------------------------------
  menus.on('click', () => audio.play('click'));
  menus.on('settings', () => {
    Settings.save(settings);
    audio.setVolume(settings.volume);
  });
  menus.on('title', async () => menus.showTitle(await save.listWorlds()));
  menus.on('newWorld', async ({ name, seed, mode }) => {
    // avoid silently overwriting an existing world with the same name
    const existing = await save.loadWorldMeta(name);
    let finalName = name, n = 2;
    while (await save.loadWorldMeta(finalName)) finalName = `${name} (${n++})`;
    audio.ensure();
    game.startWorld({ name: finalName, seed, mode });
  });
  menus.on('loadWorld', async (name) => {
    const meta = await save.loadWorldMeta(name);
    if (!meta) return;
    audio.ensure();
    meta.name = name;
    game.startWorld(meta);
  });
  menus.on('deleteWorld', async (name) => {
    await save.deleteWorld(name);
    menus.showTitle(await save.listWorlds());
  });
  menus.on('resume', () => game.resume());
  menus.on('quit', () => game.quitToTitle());
  menus.on('respawn', () => game.respawn());

  window.addEventListener('beforeunload', () => {
    if (game.world) game.saveAll();
  });

  menus.showTitle(await save.listWorlds());
}

boot();
