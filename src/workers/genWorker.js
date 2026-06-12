// ============================================================
// Chunk generation worker — wraps the pure Generator so heavy
// terrain work never blocks the render thread.
// ============================================================
import { Generator } from '../world/generation.js';

let gen = null;
self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new Generator(msg.seed);
    return;
  }
  if (msg.type === 'gen') {
    const { cx, cz, id } = msg;
    const r = gen.generate(cx, cz);
    self.postMessage({
      type: 'chunk', id, cx, cz,
      blocks: r.blocks.buffer, meta: r.meta.buffer, light: r.light.buffer,
      heightmap: r.heightmap.buffer, biomes: r.biomes.buffer, biomeNames: r.biomeNames,
    }, [r.blocks.buffer, r.meta.buffer, r.light.buffer, r.heightmap.buffer, r.biomes.buffer]);
  }
};
