// Terrain data: real elevation (baked by tools/bake-terrain.mjs) shaped into Putorana's stepped basalt.
//
// Each region (near 12.5 m, mid 25 m, far 100 m) is processed the same way:
//   1. the lowland is smoothed (the DEM is noisy where it is flat)
//   2. the massif is sharpened and its relief exaggerated ×1.4 (the DEM rounds every edge off)
//   3. steep slopes are cut into lava-flow terraces at fixed, irregular elevations — the "traps"
//   4. the city footprint is flattened
// From the processed heights we bake, per region, a texture of normal.xz + moon shadow + ambient occlusion.
import * as THREE from "three";
import META from "./terrain-meta.js";
import { CITY, LIGHT } from "./config.js";
import { smoothstep, mulberry32, fbm, vnoise } from "./util.js";

const ORDER = ["near", "mid", "far"];

async function decodeHeights(R) {
  const img = new Image();
  img.src = R.file;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = R.nx;
  c.height = R.nz;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, R.nx, R.nz).data;
  const h = new Float32Array(R.nx * R.nz);
  for (let i = 0; i < h.length; i++) h[i] = (d[i * 4] * 256 + d[i * 4 + 1]) / 20 - 100;
  return h;
}

function boxBlur(h, nx, nz, r) {
  const t = new Float32Array(h.length), o = new Float32Array(h.length);
  const w = 2 * r + 1;
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    let s = 0;
    for (let k = -r; k <= r; k++) s += h[row + Math.min(nx - 1, Math.max(0, k))];
    for (let i = 0; i < nx; i++) {
      t[row + i] = s / w;
      s += h[row + Math.min(nx - 1, i + r + 1)] - h[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += t[Math.min(nz - 1, Math.max(0, k)) * nx + i];
    for (let j = 0; j < nz; j++) {
      o[j * nx + i] = s / w;
      s += t[Math.min(nz - 1, j + r + 1) * nx + i] - t[Math.max(0, j - r) * nx + i];
    }
  }
  return o;
}

function maxFilter(h, nx, nz, r) {
  const t = new Float32Array(h.length), o = new Float32Array(h.length);
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      let m = -Infinity;
      for (let k = Math.max(0, i - r); k <= Math.min(nx - 1, i + r); k++) m = Math.max(m, h[row + k]);
      t[row + i] = m;
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      let m = -Infinity;
      for (let k = Math.max(0, j - r); k <= Math.min(nz - 1, j + r); k++) m = Math.max(m, t[k * nx + i]);
      o[j * nx + i] = m;
    }
  }
  return o;
}

// Lava-flow boundaries: one table for the whole plateau so the layers line up across valleys.
// Each flow has its own thickness and its own share of bench vs. riser.
export const LAYERS = (() => {
  const rnd = mulberry32(1935);
  const out = [];
  let y = 236;
  while (y < 3000) {
    out.push({ y, bench: 0.42 + 0.28 * rnd(), tone: rnd() });
    y += 34 + 62 * rnd();
  }
  return out;
})();

// Within a flow the smooth slope becomes: a flat bench, then talus easing into a cliff that ends in a
// sharp rim (ease-in), where the next bench starts.
function layerOf(v) {
  let lo = 0, hi = LAYERS.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (LAYERS[m].y <= v) lo = m;
    else hi = m;
  }
  return lo;
}
function terrace(v) {
  if (v < LAYERS[0].y) return v;
  const k = layerOf(v);
  const y0 = LAYERS[k].y, y1 = LAYERS[k + 1].y;
  const f = (v - y0) / (y1 - y0);
  const u = Math.max(0, (f - LAYERS[k].bench) / (1 - LAYERS[k].bench));
  return y0 + (y1 - y0) * u * u;
}

// The same table as a lookup for the shaders: height (0–2048 m, 0.5 m texels) →
// R: position within the flow (0 on the bench, 1 at the rim), G: flow tone, B: thin interbed of tuff
export function layerTexture() {
  const N = 4096;
  const d = new Uint8Array(N * 4);
  const rnd = mulberry32(77);
  const beds = LAYERS.map(() => [rnd() * 0.5 + 0.25, rnd()]);
  for (let i = 0; i < N; i++) {
    const h = (i + 0.5) * 0.5;
    if (h < LAYERS[0].y) {
      d[i * 4] = 0;
      d[i * 4 + 1] = 128;
      continue;
    }
    const k = layerOf(h);
    const y0 = LAYERS[k].y, y1 = LAYERS[k + 1].y;
    const f = (h - y0) / (y1 - y0);
    const bed = beds[k][1] > 0.45 ? Math.exp(-((((f - beds[k][0]) * (y1 - y0)) / 1.6) ** 2)) : 0;
    d[i * 4] = Math.round(f * 255);
    d[i * 4 + 1] = Math.round(LAYERS[k].tone * 255);
    d[i * 4 + 2] = Math.round(bed * 255);
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const softplus = (x, k) => (x > 20 * k ? x : k * Math.log1p(Math.exp(x / k)));

function cityMask(x, z) {
  const [x0, z0, x1, z1] = CITY.rect;
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  return 1 - smoothstep(0, CITY.falloff, Math.hypot(dx, dz));
}

function processRegion(R, raw, terraced) {
  const { nx, nz, dx } = R;
  const lowSmooth = boxBlur(raw, nx, nz, Math.max(1, Math.round(70 / dx)));
  const wide = boxBlur(raw, nx, nz, Math.max(1, Math.round(160 / dx)));
  const e = new Float32Array(raw.length);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const hi = smoothstep(120, 280, raw[k]);
      // sharpen where the ground slopes; the DEM's flat valley floors are mostly noise
      const sx = (wide[j * nx + Math.min(nx - 1, i + 1)] - wide[j * nx + Math.max(0, i - 1)]) / (2 * dx);
      const sz = (wide[Math.min(nz - 1, j + 1) * nx + i] - wide[Math.max(0, j - 1) * nx + i]) / (2 * dx);
      const sl = smoothstep(0.04, 0.16, Math.hypot(sx, sz));
      let v = raw[k] * hi + lowSmooth[k] * (1 - hi);
      v += 0.5 * (raw[k] - wide[k]) * hi * sl;
      e[k] = v + 0.4 * softplus(v - 150, 40);
    }
  }
  // terrace weight: steep and above the lowland. Kept separate from the smooth field so the steps can be
  // cut after interpolation (terracing first and interpolating after leaves the steps jagged).
  let w = null;
  if (terraced) {
    w = new Float32Array(raw.length);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const gx = (e[j * nx + Math.min(nx - 1, i + 1)] - e[j * nx + Math.max(0, i - 1)]) / (2 * dx);
        const gz = (e[Math.min(nz - 1, j + 1) * nx + i] - e[Math.max(0, j - 1) * nx + i]) / (2 * dx);
        w[k] = smoothstep(0.11, 0.32, Math.hypot(gx, gz)) * smoothstep(230, 330, e[k]);
      }
    }
    // a crest between two steep flanks is flat for a texel or two: it has to take the steps too, or it
    // is left standing as a fin above the cut flanks. Spread the weight ~40 m, then soften it.
    const r = Math.max(1, Math.round(40 / dx));
    w = boxBlur(maxFilter(w, nx, nz, r), nx, nz, r);
  }
  return { e, w };
}

// Noise on the terrace input makes the cliff lines wander in plan (eroded rims, talus cones), plus a
// little roughness on the benches. Shared by the grid bake and by heightAt so shading matches geometry.
function terraced(e, w, x, z) {
  if (w <= 0.001) return e;
  const wob = (fbm(x / 140, z / 140, 3, 5) - 0.5) * 30 + (vnoise(x / 23, z / 23, 9) - 0.5) * 8;
  const tv = terrace(e + wob * w) - wob * w * 0.15;
  return e + (tv - e) * w;
}

function bakeGrid(R) {
  const h = new Float32Array(R.e.length);
  for (let j = 0; j < R.nz; j++)
    for (let i = 0; i < R.nx; i++) {
      const k = j * R.nx + i;
      h[k] = R.w ? terraced(R.e[k], R.w[k], R.x0 + i * R.dx, R.z0 + j * R.dx) : R.e[k];
    }
  return h;
}

export async function buildTerrainData() {
  const regions = [];
  for (const name of ORDER) {
    const M = META.regions[name];
    const R = { name, x0: M.x0, z0: M.z0, dx: M.dx, nx: M.nx, nz: M.nz, file: M.file };
    R.x1 = R.x0 + R.dx * (R.nx - 1);
    R.z1 = R.z0 + R.dx * (R.nz - 1);
    Object.assign(R, processRegion(R, await decodeHeights(R), name !== "far"));
    R.h = bakeGrid(R);
    regions.push(R);
  }
  const [near, mid, far] = regions;

  // city ground: flatten to the median of the near heights under the footprint
  const samples = [];
  {
    const [x0, z0, x1, z1] = CITY.rect;
    for (let z = z0; z <= z1; z += 50) for (let x = x0; x <= x1; x += 50) samples.push(sampleBilinear(near, x, z, near.e));
    samples.sort((a, b) => a - b);
  }
  const cityGround = samples[samples.length >> 1];
  for (const R of regions) {
    for (let j = 0; j < R.nz; j++) {
      for (let i = 0; i < R.nx; i++) {
        const m = cityMask(R.x0 + i * R.dx, R.z0 + j * R.dx);
        if (m > 0) {
          const k = j * R.nx + i;
          R.h[k] += (cityGround - R.h[k]) * m;
          R.e[k] += (cityGround - R.e[k]) * m;
          if (R.w) R.w[k] *= 1 - m;
        }
      }
    }
  }

  // blend weights: a finer region wins inside, fading out toward its border
  const BORDER = { near: 500, mid: 1800 };
  function inside(R, x, z) {
    const b = BORDER[R.name];
    if (!b) return 1;
    const d = Math.min(x - R.x0, R.x1 - x, z - R.z0, R.z1 - z) - R.dx * 2;
    return smoothstep(0, b, d);
  }

  // smooth field interpolated first, steps cut afterwards (terracing before interpolating leaves jaggies)
  function regionHeight(R, x, z) {
    const e = sampleCubic(R, x, z, R.e);
    if (!R.w) return e;
    return terraced(e, sampleBilinear(R, x, z, R.w), x, z);
  }
  function heightAt(x, z) {
    let h = regionHeight(far, x, z);
    const wm = inside(mid, x, z);
    if (wm > 0) h += (regionHeight(mid, x, z) - h) * wm;
    const wn = inside(near, x, z);
    if (wn > 0) h += (regionHeight(near, x, z) - h) * wn;
    return h;
  }
  // cheap version for marching rays: finest region, bilinear
  function heightFast(x, z) {
    if (x > near.x0 && x < near.x1 && z > near.z0 && z < near.z1) return sampleBilinear(near, x, z);
    if (x > mid.x0 && x < mid.x1 && z > mid.z0 && z < mid.z1) return sampleBilinear(mid, x, z);
    return sampleBilinear(far, x, z);
  }

  for (const R of regions) R.texture = bakeTexture(R, heightFast);
  return { regions, near, mid, far, heightAt, heightFast, cityGround, inside };
}

function at(R, i, j, a = R.h) {
  i = i < 0 ? 0 : i >= R.nx ? R.nx - 1 : i;
  j = j < 0 ? 0 : j >= R.nz ? R.nz - 1 : j;
  return a[j * R.nx + i];
}

export function sampleBilinear(R, x, z, a = R.h) {
  const fx = (x - R.x0) / R.dx, fz = (z - R.z0) / R.dx;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  return (at(R, i, j, a) * (1 - u) + at(R, i + 1, j, a) * u) * (1 - v) + (at(R, i, j + 1, a) * (1 - u) + at(R, i + 1, j + 1, a) * u) * v;
}

function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

export function sampleCubic(R, x, z, a = R.h) {
  const fx = (x - R.x0) / R.dx, fz = (z - R.z0) / R.dx;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const r = (jj) => cr(at(R, i - 1, jj, a), at(R, i, jj, a), at(R, i + 1, jj, a), at(R, i + 2, jj, a), u);
  return cr(r(j - 1), r(j), r(j + 1), r(j + 2), v);
}

// normal.xz, moon visibility, ambient occlusion → RGBA8 with mipmaps
function bakeTexture(R, heightFast) {
  const { nx, nz, dx } = R;
  const data = new Uint8Array(nx * nz * 4);
  const L = LIGHT.moonDir;
  const lh = Math.hypot(L.x, L.z);
  const ldx = L.x / lh, ldz = L.z / lh, tanEl = L.y / lh;
  const blur = boxBlur(R.h, nx, nz, Math.max(1, Math.round(220 / dx)));
  const steps = [];
  for (let d = dx * 0.75; d < 9000; d *= 1.13) steps.push(d);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = R.x0 + i * dx, z = R.z0 + j * dx;
      const h0 = R.h[k];
      const gx = (at(R, i + 1, j) - at(R, i - 1, j)) / (2 * dx);
      const gz = (at(R, i, j + 1) - at(R, i, j - 1)) / (2 * dx);
      const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1);
      const nX = -gx * inv, nZ = -gz * inv;
      // soft moon shadow: highest obstruction angle along the light, compared with the moon's elevation
      let worst = -1;
      for (const d of steps) {
        const hh = heightFast(x + ldx * d, z + ldz * d);
        const s = (hh - h0 - 2) / d - tanEl;
        if (s > worst) worst = s;
        if (h0 + d * (tanEl + 0.08) > 1500) break;
      }
      const vis = 1 - smoothstep(-0.035, 0.03, worst);
      const cavity = Math.max(0, blur[k] - h0);
      const ao = Math.max(0.3, 1 - cavity / 260);
      data[k * 4] = Math.round((nX * 0.5 + 0.5) * 255);
      data[k * 4 + 1] = Math.round((nZ * 0.5 + 0.5) * 255);
      data[k * 4 + 2] = Math.round(vis * 255);
      data[k * 4 + 3] = Math.round(ao * 255);
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
