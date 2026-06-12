// ============================================================
// Renderer — raw WebGL2. Owns all GPU state.
//
// Passes per frame:
//   1. sky gradient (fullscreen quad, no depth)
//   2. stars + sun + moon (rotating with time of day)
//   3. opaque chunk geometry (cutouts via discard)
//   4. crack overlay + selection wireframe
//   5. entities (mobs + dropped items, CPU-batched boxes)
//   6. clouds
//   7. water (blended, no depth write)
//   8. particles (gl.POINTS)
// ============================================================
import { CHUNK, HEIGHT } from '../world/constants.js';
import { mat4, perspective, multiply, viewMatrix, frustumPlanes, aabbInFrustum } from '../engine/math.js';

// ---------- shader sources ----------------------------------
const CHUNK_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aSky;
layout(location=3) in float aBlock;
layout(location=4) in float aAO;
uniform mat4 uPV;
uniform vec3 uEye;
uniform float uTime;
uniform int uWave;
out vec2 vUV;
out float vSky;
out float vBlock;
out float vAO;
out float vDist;
void main(){
  vec3 p = aPos;
  if (uWave == 1) {
    p.y += sin(uTime * 1.5 + aPos.x * 0.7 + aPos.z * 0.9) * 0.045 - 0.02;
  }
  vUV = aUV; vSky = aSky; vBlock = aBlock; vAO = aAO;
  vDist = distance(p, uEye);
  gl_Position = uPV * vec4(p, 1.0);
}`;

const CHUNK_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vSky;
in float vBlock;
in float vAO;
in float vDist;
uniform sampler2D uAtlas;
uniform float uDay;        // 0..1 sky brightness
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uAlpha;      // 1 opaque pass, ~0.72 water pass
uniform int uCutout;       // discard transparent texels
uniform vec3 uTint;
out vec4 fragColor;
void main(){
  vec4 tex = texture(uAtlas, vUV);
  if (uCutout == 1 && tex.a < 0.5) discard;
  float sky = vSky * max(uDay, 0.18);
  float light = max(sky, vBlock);
  light = light * light * 0.85 + light * 0.15;          // gentle gamma
  float ao = 0.55 + 0.45 * vAO;
  vec3 col = tex.rgb * light * ao * uTint;
  float fog = clamp((vDist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
  fog = fog * fog;
  fragColor = vec4(mix(col, uFogColor, fog), tex.a * uAlpha);
}`;

const SKY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vPos;
void main(){ vPos = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vPos;
uniform vec3 uTop;
uniform vec3 uHorizon;
out vec4 fragColor;
void main(){
  float t = clamp(vPos.y * 0.5 + 0.5, 0.0, 1.0);
  fragColor = vec4(mix(uHorizon, uTop, pow(t, 0.8)), 1.0);
}`;

// celestial bodies + stars share one tiny program (solid colors)
const CEL_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
layout(location=2) in float aSize;
uniform mat4 uPV;
uniform mat4 uModel;
out vec3 vColor;
void main(){
  vColor = aColor;
  gl_PointSize = aSize;
  gl_Position = uPV * uModel * vec4(aPos, 1.0);
}`;

const CEL_FS = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uAlpha;
out vec4 fragColor;
void main(){ fragColor = vec4(vColor, uAlpha); }`;

const CLOUD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uPV;
uniform vec3 uEye;
uniform float uTime;
out vec2 vUV;
void main(){
  // huge quad following the camera horizontally at fixed height
  vec3 p = vec3(uEye.x + aPos.x * 640.0, 130.0, uEye.z + aPos.y * 640.0);
  vUV = (p.xz + vec2(uTime * 2.0, 0.0)) / 256.0;
  gl_Position = uPV * vec4(p, 1.0);
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uDay;
out vec4 fragColor;
void main(){
  float a = texture(uTex, vUV).a;
  if (a < 0.5) discard;
  vec3 c = vec3(0.55 + 0.45 * uDay);
  fragColor = vec4(c, 0.72);
}`;

const ENT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aLight;
uniform mat4 uPV;
out vec2 vUV;
out float vLight;
void main(){ vUV = aUV; vLight = aLight; gl_Position = uPV * vec4(aPos, 1.0); }`;

const ENT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vLight;
uniform sampler2D uAtlas;
uniform vec3 uFogColor;
out vec4 fragColor;
void main(){
  vec4 tex = texture(uAtlas, vUV);
  if (tex.a < 0.5) discard;
  fragColor = vec4(tex.rgb * vLight, 1.0);
}`;

const PART_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
layout(location=2) in float aSize;
uniform mat4 uPV;
uniform vec3 uEye;
out vec3 vColor;
void main(){
  vColor = aColor;
  float d = max(distance(aPos, uEye), 0.5);
  gl_PointSize = clamp(aSize * 60.0 / d, 1.0, 24.0);
  gl_Position = uPV * vec4(aPos, 1.0);
}`;

const PART_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main(){ fragColor = vec4(vColor, 1.0); }`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uPV;
uniform vec3 uOffset;
void main(){ gl_Position = uPV * vec4(aPos + uOffset, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main(){ fragColor = uColor; }`;

// ---------- helpers ------------------------------------------
function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(sh) + '\n' + src);
  }
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u: uniforms };
}

// generate the cloud pattern texture (value-noise blobs)
function cloudCanvas() {
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const img = g.createImageData(s, s);
  const cells = 8, grid = [];
  for (let i = 0; i < (cells + 1) * (cells + 1); i++) grid.push(Math.random());
  const val = (x, y) => {
    const gx = (x / s) * cells, gy = (y / s) * cells;
    const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
    const sm = (t) => t * t * (3 - 2 * t);
    const g2 = (a, b) => grid[((b % (cells + 1)) * (cells + 1)) + (a % (cells + 1))];
    const a = g2(x0, y0), b = g2(x0 + 1, y0), c = g2(x0, y0 + 1), d = g2(x0 + 1, y0 + 1);
    return a + (b - a) * sm(fx) + (c - a) * sm(fy) + (a - b - c + d) * sm(fx) * sm(fy);
  };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const v = val(x, y) * 0.65 + val(x * 2.3 % s, y * 2.3 % s) * 0.35;
    const a = v > 0.58 ? 255 : 0;
    const i = (y * s + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// unit wireframe cube (12 edges)
const CUBE_LINES = (() => {
  const c = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const e = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const out = [];
  for (const [a, b] of e) out.push(...c[a], ...c[b]);
  return new Float32Array(out);
})();

// solid cube faces for the crack overlay: pos3 + uv2, slightly inflated
const CRACK_CUBE = (() => {
  const out = [];
  const eps = 0.002;
  const faces = [
    [[1+eps,0,0],[0,1,0],[0,0,1]], [[-eps,0,1],[0,1,0],[0,0,-1]],
    [[0,1+eps,0],[0,0,1],[1,0,0]], [[0,-eps,1],[0,0,-1],[1,0,0]],
    [[0,0,1+eps],[1,0,0],[0,1,0]], [[1,0,-eps],[-1,0,0],[0,1,0]],
  ];
  for (const [o, u, v] of faces) {
    const p = (a, b) => [
      o[0] + u[0] * a + v[0] * b - (u[0] + v[0] < 0 ? (u[0] + v[0]) * 0 : 0),
      o[1] + u[1] * a + v[1] * b,
      o[2] + u[2] * a + v[2] * b,
    ];
    const q = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...q[i], [0,1,1,0][i] ?? 0, 0); // uv filled below
  }
  // rewrite uvs properly: each face quad gets (0,0)(1,0)(1,1)(0,1)
  const uvs = [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 6; v++) {
    const base = (f * 6 + v) * 5;
    out[base + 3] = uvs[v][0];
    out[base + 4] = uvs[v][1];
  }
  return new Float32Array(out);
})();

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE); // winding mixed by design; depth test handles it
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    this.pChunk = program(gl, CHUNK_VS, CHUNK_FS);
    this.pSky = program(gl, SKY_VS, SKY_FS);
    this.pCel = program(gl, CEL_VS, CEL_FS);
    this.pCloud = program(gl, CLOUD_VS, CLOUD_FS);
    this.pEnt = program(gl, ENT_VS, ENT_FS);
    this.pPart = program(gl, PART_VS, PART_FS);
    this.pLine = program(gl, LINE_VS, LINE_FS);

    // fullscreen quad
    this.skyVAO = gl.createVertexArray();
    gl.bindVertexArray(this.skyVAO);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // cloud quad (positions in -1..1, scaled in shader)
    this.cloudVAO = gl.createVertexArray();
    gl.bindVertexArray(this.cloudVAO);
    const cq = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cq);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.cloudTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cloudCanvas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // celestial geometry: sun quad, moon quad, stars (points)
    this.celVAO = gl.createVertexArray();
    gl.bindVertexArray(this.celVAO);
    this.celBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.celBuf);
    const cel = [];
    const quadAt = (dist, size, color, ny) => {
      // quad facing origin, on +y or -y of the rotation circle (x axis rotation)
      const y = ny * dist;
      const cs = [[-size, y, -size], [size, y, -size], [size, y, size], [-size, y, -size], [size, y, size], [-size, y, size]];
      for (const p of cs) cel.push(...p, ...color, 1);
    };
    quadAt(380, 34, [1.0, 0.95, 0.55], 1);   // sun above
    quadAt(380, 26, [0.86, 0.88, 0.95], -1); // moon opposite
    this.starStart = cel.length / 7;
    let seed = 1337;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 350; i++) {
      const a = rnd() * Math.PI * 2, b = Math.acos(rnd() * 2 - 1);
      const r = 400;
      cel.push(r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a),
        0.9, 0.9, 1.0, 1 + rnd() * 1.6);
    }
    this.starCount = 350;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cel), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);

    // entity dynamic buffer (pos3 uv2 light1)
    this.entVAO = gl.createVertexArray();
    gl.bindVertexArray(this.entVAO);
    this.entBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.entBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 6 * 4 * 24576, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);

    // particle dynamic buffer (pos3 color3 size1)
    this.partVAO = gl.createVertexArray();
    gl.bindVertexArray(this.partVAO);
    this.partBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 7 * 4 * 4096, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);

    // line geometry
    this.lineVAO = gl.createVertexArray();
    gl.bindVertexArray(this.lineVAO);
    const lb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lb);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE_LINES, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // crack overlay geometry (pos3 uv2)
    this.crackVAO = gl.createVertexArray();
    gl.bindVertexArray(this.crackVAO);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, CRACK_CUBE, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    // crack uses entity program (pos/uv/light) — supply light via constant attrib
    gl.bindVertexArray(null);

    this.atlasTex = gl.createTexture();
    this.meshes = new Map();  // key -> {vaoO, bufO, nO, vaoW, bufW, nW, cx, cz, minY, maxY}
    this.proj = mat4();
    this.view = mat4();
    this.pv = mat4();
    this.identity = mat4();
    this.frameStats = { drawnChunks: 0, totalChunks: 0, triangles: 0 };
  }

  uploadAtlas(canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---- chunk mesh lifecycle ---------------------------------
  setChunkMesh(key, cx, cz, mesh) {
    const gl = this.gl;
    this.deleteChunkMesh(key);
    const make = (data) => {
      if (!data || data.length === 0) return null;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 32, 24);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 32, 28);
      gl.bindVertexArray(null);
      return { vao, buf, n: data.length / 8 };
    };
    const o = make(mesh.opaque);
    const w = make(mesh.water);
    if (!o && !w) { this.meshes.delete(key); return; }
    this.meshes.set(key, { o, w, cx, cz });
  }

  deleteChunkMesh(key) {
    const m = this.meshes.get(key);
    if (!m) return;
    const gl = this.gl;
    for (const part of [m.o, m.w]) {
      if (part) { gl.deleteBuffer(part.buf); gl.deleteVertexArray(part.vao); }
    }
    this.meshes.delete(key);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  // scene: see Game.buildScene
  render(scene) {
    const gl = this.gl;
    this.resize();

    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    perspective(this.proj, scene.fov * Math.PI / 180, aspect, 0.08, 1000);
    viewMatrix(this.view, scene.eye, scene.yaw, scene.pitch);
    multiply(this.pv, this.proj, this.view);
    const planes = frustumPlanes(this.pv);

    gl.clearColor(scene.fogColor[0], scene.fogColor[1], scene.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- 1. sky ----
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.pSky.prog);
    gl.uniform3fv(this.pSky.u.uTop, scene.skyTop);
    gl.uniform3fv(this.pSky.u.uHorizon, scene.fogColor);
    gl.bindVertexArray(this.skyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ---- 2. celestials (rotate around X with time, centered on eye) ----
    if (!scene.underwater) {
      const ang = scene.timeOfDay * Math.PI * 2 - Math.PI / 2; // noon = up
      const c = Math.cos(ang), s = Math.sin(ang);
      const model = this.identity;
      model.fill(0);
      model[0] = 1;
      model[5] = c; model[6] = s;
      model[9] = -s; model[10] = c;
      model[12] = scene.eye[0]; model[13] = scene.eye[1]; model[14] = scene.eye[2];
      model[15] = 1;
      gl.useProgram(this.pCel.prog);
      gl.uniformMatrix4fv(this.pCel.u.uPV, false, this.pv);
      gl.uniformMatrix4fv(this.pCel.u.uModel, false, model);
      gl.bindVertexArray(this.celVAO);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const night = Math.max(0, 1 - scene.daylight * 1.6);
      if (night > 0.02) {
        gl.uniform1f(this.pCel.u.uAlpha, night);
        gl.drawArrays(gl.POINTS, this.starStart, this.starCount);
      }
      gl.uniform1f(this.pCel.u.uAlpha, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 12);
      gl.disable(gl.BLEND);
    }
    gl.enable(gl.DEPTH_TEST);

    // ---- 3. opaque chunks ----
    gl.useProgram(this.pChunk.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.pChunk.u.uAtlas, 0);
    gl.uniformMatrix4fv(this.pChunk.u.uPV, false, this.pv);
    gl.uniform3fv(this.pChunk.u.uEye, scene.eye);
    gl.uniform1f(this.pChunk.u.uTime, scene.time);
    gl.uniform1f(this.pChunk.u.uDay, scene.daylight);
    gl.uniform3fv(this.pChunk.u.uFogColor, scene.fogColor);
    gl.uniform1f(this.pChunk.u.uFogStart, scene.fogStart);
    gl.uniform1f(this.pChunk.u.uFogEnd, scene.fogEnd);
    gl.uniform3fv(this.pChunk.u.uTint, scene.tint);
    gl.uniform1f(this.pChunk.u.uAlpha, 1);
    gl.uniform1i(this.pChunk.u.uCutout, 1);
    gl.uniform1i(this.pChunk.u.uWave, 0);

    let drawn = 0, tris = 0;
    const visible = [];
    for (const m of this.meshes.values()) {
      const x0 = m.cx * CHUNK, z0 = m.cz * CHUNK;
      if (!aabbInFrustum(planes, x0, 0, z0, x0 + CHUNK, HEIGHT, z0 + CHUNK)) continue;
      visible.push(m);
      if (m.o) {
        gl.bindVertexArray(m.o.vao);
        gl.drawArrays(gl.TRIANGLES, 0, m.o.n);
        drawn++; tris += m.o.n / 3;
      }
    }
    this.frameStats.drawnChunks = drawn;
    this.frameStats.totalChunks = this.meshes.size;

    // ---- 4. crack overlay + selection box ----
    if (scene.crack) {
      gl.useProgram(this.pEnt.prog);
      gl.uniformMatrix4fv(this.pEnt.u.uPV, false, this.pv);
      gl.uniform1i(this.pEnt.u.uAtlas, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR); // multiply-ish: darkens by crack texture
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -2);
      // remap crack cube uvs into the crack tile + offset to block position
      const tile = 240 + scene.crack.stage;
      const col = tile % 16, row = (tile / 16) | 0;
      const data = new Float32Array(CRACK_CUBE.length / 5 * 6);
      for (let v = 0; v < CRACK_CUBE.length / 5; v++) {
        data[v * 6 + 0] = CRACK_CUBE[v * 5 + 0] + scene.crack.x;
        data[v * 6 + 1] = CRACK_CUBE[v * 5 + 1] + scene.crack.y;
        data[v * 6 + 2] = CRACK_CUBE[v * 5 + 2] + scene.crack.z;
        data[v * 6 + 3] = (col + CRACK_CUBE[v * 5 + 3] * 0.998 + 0.001) / 16;
        data[v * 6 + 4] = (row + CRACK_CUBE[v * 5 + 4] * 0.998 + 0.001) / 16;
        data[v * 6 + 5] = 1;
      }
      gl.bindVertexArray(this.entVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.entBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.BLEND);
    }
    if (scene.selection) {
      gl.useProgram(this.pLine.prog);
      gl.uniformMatrix4fv(this.pLine.u.uPV, false, this.pv);
      gl.uniform3f(this.pLine.u.uOffset, scene.selection.x - 0.002, scene.selection.y - 0.002, scene.selection.z - 0.002);
      gl.uniform4f(this.pLine.u.uColor, 0, 0, 0, 0.85);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.lineVAO);
      // tiny inflate via second draw at +0.004 handled by offset; lines are thin anyway
      gl.drawArrays(gl.LINES, 0, 24);
      gl.disable(gl.BLEND);
    }

    // ---- 5. entities (CPU-batched) ----
    if (scene.entityVerts && scene.entityVerts.length > 0) {
      gl.useProgram(this.pEnt.prog);
      gl.uniformMatrix4fv(this.pEnt.u.uPV, false, this.pv);
      gl.uniform1i(this.pEnt.u.uAtlas, 0);
      gl.bindVertexArray(this.entVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.entBuf);
      const cap = 6 * 4 * 24576;
      let arr = scene.entityVerts;
      if (arr.byteLength > cap) arr = arr.subarray(0, cap / 4);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
      gl.drawArrays(gl.TRIANGLES, 0, arr.length / 6);
    }

    // ---- 6. clouds ----
    gl.useProgram(this.pCloud.prog);
    gl.uniformMatrix4fv(this.pCloud.u.uPV, false, this.pv);
    gl.uniform3fv(this.pCloud.u.uEye, scene.eye);
    gl.uniform1f(this.pCloud.u.uTime, scene.time);
    gl.uniform1f(this.pCloud.u.uDay, scene.daylight);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    gl.uniform1i(this.pCloud.u.uTex, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.cloudVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);

    // ---- 7. water ----
    gl.useProgram(this.pChunk.prog);
    gl.uniform1f(this.pChunk.u.uAlpha, 0.72);
    gl.uniform1i(this.pChunk.u.uCutout, 0);
    gl.uniform1i(this.pChunk.u.uWave, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const m of visible) {
      if (m.w) {
        gl.bindVertexArray(m.w.vao);
        gl.drawArrays(gl.TRIANGLES, 0, m.w.n);
        tris += m.w.n / 3;
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.frameStats.triangles = tris | 0;

    // ---- 8. particles ----
    if (scene.particleVerts && scene.particleVerts.length > 0) {
      gl.useProgram(this.pPart.prog);
      gl.uniformMatrix4fv(this.pPart.u.uPV, false, this.pv);
      gl.uniform3fv(this.pPart.u.uEye, scene.eye);
      gl.bindVertexArray(this.partVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      const cap = 7 * 4 * 4096;
      let arr = scene.particleVerts;
      if (arr.byteLength > cap) arr = arr.subarray(0, cap / 4);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
      gl.drawArrays(gl.POINTS, 0, arr.length / 7);
    }

    gl.bindVertexArray(null);
  }
}
