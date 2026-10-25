// Small deterministic helpers shared by every module. Nothing here reads a clock.
import * as THREE from "three";

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smoother = (t) => {
  t = clamp(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t));
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t) => Math.pow(clamp(t), 3);
export const easeInOutCubic = (t) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutBack = (t, s = 1.70158) => {
  t = clamp(t) - 1;
  return t * t * ((s + 1) * t + s) + 1;
};

// mulberry32 — seeded PRNG
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

// smooth 1D value noise in [-1, 1]
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
}
export function fbm1(x, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise1(x * f + i * 17.13);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
// smooth 2D value noise in [-1, 1]
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}
export function fbm2(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f + i * 31.7, y * f - i * 11.3);
    n += a;
    a *= 0.5;
    f *= 2.07;
  }
  return s / n;
}

// time window helper: 0 before a, 1 after b
export const seg = (t, a, b) => clamp((t - a) / (b - a));

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// sRGB component → linear (procedural colours are authored in sRGB)
export const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// Orient an object so that its local +Y axis runs from a to b.
const _up = new THREE.Vector3(0, 1, 0);
export function alignY(obj, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  obj.position.copy(a).addScaledVector(d, 0.5);
  obj.quaternion.setFromUnitVectors(_up, d.clone().normalize());
  return len;
}
