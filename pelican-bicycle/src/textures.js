// Procedural textures, generated once at build time on 2D canvases.
import * as THREE from "three";
import { rng, fbm2, noise2, clamp, smoothstep } from "./util.js";

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Build a tangent-space normal map from a height function h(u, v) in [0,1]^2 (tileable if h is).
export function normalFromHeight(w, h, heightFn, strength = 2.0, wrap = true) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = heightFn(x / w, y / h);
  const data = new Uint8Array(w * h * 4);
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); }
    return H[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function canvasTex(c, srgb = true, wrap = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Tyre: u around the wheel, v across the section (0..1 from one bead to the other).
// Herringbone file tread in the middle, gum sidewalls with a subtle casing texture.
export function tyreTextures() {
  const W = 2048, Hh = 128;
  const c = canvas(W, Hh);
  const g = c.getContext("2d");
  const img = g.createImageData(W, Hh);
  const r = rng(11);
  for (let y = 0; y < Hh; y++) {
    const v = y / (Hh - 1);
    const tread = Math.abs(v - 0.5) < 0.2 ? 1 : Math.abs(v - 0.5) < 0.24 ? 1 - (Math.abs(v - 0.5) - 0.2) / 0.04 : 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const n = r() * 0.06;
      // gum wall: warm tan; tread: near black
      const gum = [176 + n * 200, 132 + n * 160, 84 + n * 120];
      const blk = [38 + n * 90, 34 + n * 80, 32 + n * 80];
      img.data[i] = gum[0] * (1 - tread) + blk[0] * tread;
      img.data[i + 1] = gum[1] * (1 - tread) + blk[1] * tread;
      img.data[i + 2] = gum[2] * (1 - tread) + blk[2] * tread;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const map = canvasTex(c);
  map.wrapT = THREE.ClampToEdgeWrapping;
  const normal = normalFromHeight(1024, 64, (u, v) => {
    const dv = v - 0.5;
    if (Math.abs(dv) < 0.2) {
      // herringbone chevrons
      const k = u * 180 + Math.abs(dv) * 9;
      const f = k - Math.floor(k);
      return f < 0.55 ? 1 : 0;
    }
    // sidewall casing threads
    return 0.5 + 0.5 * Math.sin(u * 2400) * 0.15 + (Math.abs(dv) > 0.42 ? 0.2 : 0);
  }, 3.0);
  normal.wrapT = THREE.ClampToEdgeWrapping;
  return { map, normal };
}

// Cotton bar tape: diagonal overlapping wraps. u around the bar, v along it (in metres * k).
export function barTapeTextures() {
  const normal = normalFromHeight(256, 256, (u, v) => {
    const k = (u + v * 1.0) % 1;
    const ridge = k < 0.85 ? k / 0.85 : 1 - (k - 0.85) / 0.15;
    const weave = 0.08 * Math.sin(u * Math.PI * 2 * 24) * Math.sin(v * Math.PI * 2 * 24);
    return ridge * 0.6 + weave;
  }, 3.5);
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    const n = noise2(x * 0.3, y * 0.3) * 6 + noise2(x * 0.05, y * 0.05) * 6;
    img.data[i] = 236 + n; img.data[i + 1] = 226 + n; img.data[i + 2] = 200 + n; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { map: canvasTex(c), normal };
}

// Leather: pebbly grain + darker patina
export function leatherTextures() {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext("2d");
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const p = fbm2(x / 90, y / 90, 4) * 0.5 + 0.5;
    const s = fbm2(x / 9, y / 9, 2) * 0.5 + 0.5;
    const k = 0.75 + 0.35 * p - 0.08 * s;
    img.data[i] = clamp(120 * k, 0, 255);
    img.data[i + 1] = clamp(64 * k, 0, 255);
    img.data[i + 2] = clamp(34 * k, 0, 255);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const normal = normalFromHeight(512, 512, (u, v) => fbm2(u * 140, v * 140, 2) * 0.35 + fbm2(u * 12, v * 12, 2) * 0.15, 1.5);
  return { map: canvasTex(c), normal };
}

// Fine brushed-metal anisotropy-ish roughness noise
export function brushedRoughness() {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext("2d");
  const img = g.createImageData(S, S);
  const r = rng(5);
  const rows = new Float32Array(S);
  for (let y = 0; y < S; y++) rows[y] = r();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const v = 70 + rows[y] * 60 + r() * 20;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c, false);
}

// Bird skin scutes (tarsus) as a normal map: rows of rounded scales.
export function scaleNormal() {
  return normalFromHeight(256, 256, (u, v) => {
    const row = Math.floor(v * 16);
    const off = (row % 2) * 0.5;
    const uu = u * 8 + off;
    const fu = uu - Math.floor(uu) - 0.5;
    const fv = v * 16 - row - 0.5;
    return Math.max(0, 1 - (fu * fu * 2.2 + fv * fv * 3.5)) ** 0.6;
  }, 4.0);
}

// ---------------------------------------------------------------------------- feathers
// A feather image: u along the shaft (0 = base, 1 = tip) mapped to texture x, v across (texture y).
// kind: "contour" (body), "flight" (long asymmetric remex), "covert" (wing covert), "crest" (filament)
export function featherTextures(kind, W = 512, H = 128, seed = 1) {
  const r = rng(seed);
  const c = canvas(W, H);
  const g = c.getContext("2d");
  const img = g.createImageData(W, H);
  const height = new Float32Array(W * H);
  const P = {
    contour: { wo: 0.95, wi: 0.95, tipRound: 0.55, down: 0.32, barbs: 34, angle: 1.1, rachis: 0.018 },
    covert: { wo: 0.8, wi: 0.95, tipRound: 0.5, down: 0.16, barbs: 46, angle: 1.0, rachis: 0.02 },
    flight: { wo: 0.42, wi: 0.95, tipRound: 0.35, down: 0.06, barbs: 120, angle: 0.75, rachis: 0.03 },
    crest: { wo: 0.28, wi: 0.28, tipRound: 0.2, down: 0.05, barbs: 60, angle: 0.5, rachis: 0.05 },
  }[kind];
  // splits in the vane (zip gaps), deterministic
  const splits = [];
  for (let i = 0; i < 5; i++) splits.push([0.3 + r() * 0.6, r() < 0.5 ? 1 : -1, 0.004 + r() * 0.008]);
  for (let y = 0; y < H; y++) {
    const v = (y / (H - 1)) * 2 - 1; // -1..1
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const side = v >= 0 ? 1 : -1;
      const wMax = side > 0 ? P.wo : P.wi;
      // vane outline: grows from the base, rounded at the tip
      const grow = Math.min(1, Math.pow(u / 0.18, 0.6));
      const tip = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, u - (1 - P.tipRound)) / P.tipRound, 2)));
      let w = wMax * grow * tip;
      const av = Math.abs(v);
      // barbs run outward and toward the tip
      const b = u * P.barbs - av * P.barbs * P.angle * 0.12;
      const barbLine = 0.5 + 0.5 * Math.cos(b * Math.PI * 2);
      // ragged edge
      w *= 0.94 + 0.06 * Math.sin(b * 2.1 + seed);
      let a = av < w ? 1 : 0;
      // soft edge
      a *= clamp((w - av) / 0.03, 0, 1);
      // splits
      for (const [su, ss, sw] of splits) {
        if (ss === side && Math.abs((u - av * P.angle * 0.12) - su) < sw && av > 0.08) a *= 0.0;
      }
      // downy base
      if (u < P.down) {
        const k = u / P.down;
        const fluff = 0.5 + 0.5 * noise2(x * 0.15, y * 0.4);
        a *= clamp(k * 0.6 + fluff * 0.7 - 0.25, 0, 1);
      }
      const rach = av < P.rachis * (1 - u * 0.7) ? 1 : 0;
      if (rach && u < 0.98) a = 1;
      const i = (y * W + x) * 4;
      const edgeShade = 1 - 0.16 * smoothstep(w - 0.16, w, av) * (u > P.down ? 1 : 0);
      const shade = (0.86 + 0.14 * barbLine) * edgeShade;
      const baseGrey = u < P.down + 0.1 ? 0.85 + 0.15 * (u / (P.down + 0.1)) : 1;
      const col = rach ? 1.02 : shade * baseGrey;
      img.data[i] = clamp(246 * col, 0, 255);
      img.data[i + 1] = clamp(243 * col, 0, 255);
      img.data[i + 2] = clamp(236 * col, 0, 255);
      img.data[i + 3] = clamp(a * 255, 0, 255);
      height[y * W + x] = (rach ? 0.7 : 0) + barbLine * 0.35 * a;
    }
  }
  g.putImageData(img, 0, 0);
  const map = canvasTex(c, true, false);
  map.premultiplyAlpha = false;
  const normal = normalFromHeight(W, H, (u, v) => height[Math.min(H - 1, Math.round(v * (H - 1))) * W + Math.min(W - 1, Math.round(u * (W - 1)))], 1.6, false);
  return { map, normal };
}

export { canvas, canvasTex };
