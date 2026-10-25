// Signed distance primitives + a surface-nets mesher. Used for the pelican's body, neck and head
// so that the three blend into one continuous skin.
import * as THREE from "three";

export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

// ellipsoid in its own frame (iq's bound-correct approximation)
export function sdEllipsoidLocal(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

// ellipsoid at centre c, rotated about Z by angle a (pitch in the XY plane), plus optional yaw
export function ellipsoid(c, r, a = 0) {
  const ca = Math.cos(a), sa = Math.sin(a);
  return (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const lx = dx * ca + dy * sa;
    const ly = -dx * sa + dy * ca;
    return sdEllipsoidLocal(lx, ly, dz, r[0], r[1], r[2]);
  };
}

// round cone (tapered capsule) between a and b with radii ra, rb
export function roundCone(a, b, ra, rb) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yv = pax * bax + pay * bay + paz * baz;
    const zv = yv - l2;
    const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
  };
}

export function gradient(f, x, y, z, e = 1e-4) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

// Surface nets over [min,max] with cell size h. Returns an indexed BufferGeometry whose normals
// come from the SDF gradient and whose vertices are projected onto the zero set.
export function surfaceNets(f, min, max, h) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  // coarse pass to skip far-away regions cheaply
  let i3 = 0;
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * h;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h;
      for (let i = 0; i < nx; i++, i3++) {
        F[i3] = f(min[0] + i * h, y, z);
      }
    }
  }
  const at = (i, j, k) => F[i + nx * (j + ny * k)];
  const cnx = nx - 1, cny = ny - 1;
  const cellIdx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = at(i + corner[c][0], j + corner[c][1], k + corner[c][2]);
          if (v[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of edges) {
          if ((v[a] < 0) === (v[b] < 0)) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
          sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
          sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
          cnt++;
        }
        cellIdx[i + cnx * (j + cny * k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / cnt) * h, min[1] + (j + sy / cnt) * h, min[2] + (k + sz / cnt) * h);
      }
    }
  }
  const cell = (i, j, k) => cellIdx[i + cnx * (j + cny * k)];
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = at(i, j, k) < 0, b = at(i + 1, j, k) < 0;
        if (a !== b) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), a);
      }
    }
  }
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const a = at(i, j, k) < 0, b = at(i, j + 1, k) < 0;
        if (a !== b) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), a);
      }
    }
  }
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const a = at(i, j, k) < 0, b = at(i, j, k + 1) < 0;
        if (a !== b) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), a);
      }
    }
  }
  // project onto the surface and take normals from the gradient
  const nrm = new Float32Array(pos.length);
  for (let p = 0; p < pos.length; p += 3) {
    let x = pos[p], y = pos[p + 1], z = pos[p + 2];
    for (let it = 0; it < 2; it++) {
      const d = f(x, y, z);
      const g = gradient(f, x, y, z);
      x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
    }
    pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
    const g = gradient(f, x, y, z);
    nrm[p] = g[0]; nrm[p + 1] = g[1]; nrm[p + 2] = g[2];
  }
  // fix winding against the gradient (cheap check on the first triangle of each quad pair)
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const dn = cx * (nrm[a] + nrm[b] + nrm[c]) + cy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + cz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
    if (dn < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
