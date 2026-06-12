// ============================================================
// Minimal math — column-major mat4 (WebGL convention) + frustum
// ============================================================
export function mat4() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = (far + near) * nf; out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function multiply(out, a, b) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    r[c * 4 + row] = a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] + a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
  }
  out.set(r);
  return out;
}

// first-person view matrix: Rx(-pitch) * Ry(-yaw) * T(-eye)
export function viewMatrix(out, eye, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // rotation rows (world -> view)
  const r00 = cy,        r01 = 0,   r02 = -sy;
  const r10 = sy * sp,   r11 = cp,  r12 = cy * sp;
  const r20 = sy * cp,   r21 = -sp, r22 = cy * cp;
  out[0] = r00; out[4] = r01; out[8] = r02;
  out[1] = r10; out[5] = r11; out[9] = r12;
  out[2] = r20; out[6] = r21; out[10] = r22;
  out[3] = 0; out[7] = 0; out[11] = 0;
  out[12] = -(r00 * eye[0] + r01 * eye[1] + r02 * eye[2]);
  out[13] = -(r10 * eye[0] + r11 * eye[1] + r12 * eye[2]);
  out[14] = -(r20 * eye[0] + r21 * eye[1] + r22 * eye[2]);
  out[15] = 1;
  return out;
}

export function translation(out, x, y, z) {
  out.fill(0); out[0] = out[5] = out[10] = out[15] = 1;
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}
export function rotateY(out, m, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const r = mat4();
  r[0] = c; r[8] = s; r[2] = -s; r[10] = c;
  return multiply(out, m, r);
}
export function scaleM(out, m, s) {
  const r = mat4(); r[0] = r[5] = r[10] = s;
  return multiply(out, m, r);
}

// forward unit vector from yaw/pitch (matches viewMatrix)
export function forward(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

// frustum planes from proj*view; each plane [a,b,c,d]
export function frustumPlanes(m) {
  const p = [];
  const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a, b, s) => p.push([a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]]);
  add(r3, r0, 1); add(r3, r0, -1);
  add(r3, r1, 1); add(r3, r1, -1);
  add(r3, r2, 1); add(r3, r2, -1);
  return p;
}
export function aabbInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (const pl of planes) {
    const px = pl[0] > 0 ? maxX : minX;
    const py = pl[1] > 0 ? maxY : minY;
    const pz = pl[2] > 0 ? maxZ : minZ;
    if (pl[0] * px + pl[1] * py + pl[2] * pz + pl[3] < 0) return false;
  }
  return true;
}
