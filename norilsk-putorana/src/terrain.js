// Terrain renderer: a CDLOD quadtree over a 102.4 km square. Every frame picks nodes by distance to the
// camera; each node is a 32×32-quad patch whose vertices morph to the next-coarser grid before the switch,
// so detail fades in without popping. Heights come from heights.js; shading reads the baked
// normal/shadow/AO textures, so lighting detail never depends on mesh resolution.
import * as THREE from "three";
import { EARTH_R, LIGHT } from "./config.js";
import { GLSL_NOISE } from "./util.js";
import { SKY_GLSL, skyUniforms } from "./sky.js";
import { layerTexture } from "./heights.js";

const PATCH = 32;
const ROOT = { x0: -40000, z0: -51200, size: 102400 };
const MAXL = 9; // 200 m nodes, 6.25 m vertex spacing
const K = 192; // range = K × vertex spacing (≈10 px per quad at the switch)
const SIZE = (L) => ROOT.size / 2 ** L;
const RANGE = Array.from({ length: MAXL + 2 }, (_, L) => (K * SIZE(L)) / PATCH);

export const terrainUniforms = {
  tNear: { value: null },
  tMid: { value: null },
  tFar: { value: null },
  uNear: { value: new THREE.Vector4() },
  uMid: { value: new THREE.Vector4() },
  uFar: { value: new THREE.Vector4() },
  uNearB: { value: new THREE.Vector4() },
  uMidB: { value: new THREE.Vector4() },
  uMoonCol: { value: LIGHT.moonColor.clone().multiplyScalar(LIGHT.moonIntensity) },
  uAmbSky: { value: LIGHT.ambientSky.clone() },
  uAmbGround: { value: LIGHT.ambientGround.clone() },
  uAurTint: { value: LIGHT.auroraTint.clone() },
  uCity: { value: new THREE.Vector4(-3700, 0, 900, 1) }, // centre xz, radius, intensity
  uCityCol: { value: LIGHT.cityGlow.clone() },
  tLayers: { value: null },
};

const VERT = /* glsl */ `
attribute float hc;
uniform vec2 uMorph;
varying vec3 vWorld;
varying float vDist;
void main() {
  vec3 p = position;
  float d = distance(cameraPosition, p);
  p.y = mix(p.y, hc, clamp((d - uMorph.x) / (uMorph.y - uMorph.x), 0.0, 1.0));
  vWorld = p;
  vDist = d;
  vec2 dd = p.xz - cameraPosition.xz;
  p.y -= dot(dd, dd) / ${(2 * EARTH_R).toFixed(1)};
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tNear, tMid, tFar, tLayers;
uniform vec4 uNear, uMid, uFar;     // x0, z0, 1/width, 1/depth
uniform vec4 uNearB, uMidB;         // x0, z0, x1, z1 of the blend boxes
uniform vec3 uMoonCol, uAmbSky, uAmbGround, uAurTint, uCityCol;
uniform vec4 uCity;
varying vec3 vWorld;
varying float vDist;

float inBox(vec2 p, vec4 b, float w) {
  vec2 d = min(p - b.xy, b.zw - p);
  return smoothstep(0.0, w, min(d.x, d.y));
}

void main() {
  vec2 xz = vWorld.xz;
  // normal.xz / moon visibility / AO from the finest region that covers this point
  vec4 T;
  float wn = inBox(xz, uNearB, 500.0);
  if (wn >= 1.0) {
    T = texture2D(tNear, (xz - uNear.xy) * uNear.zw);
  } else {
    float wm = inBox(xz, uMidB, 1800.0);
    T = texture2D(tMid, (xz - uMid.xy) * uMid.zw);
    if (wm < 1.0) T = mix(texture2D(tFar, (xz - uFar.xy) * uFar.zw), T, wm);
    if (wn > 0.0) T = mix(T, texture2D(tNear, (xz - uNear.xy) * uNear.zw), wn);
  }
  vec3 N = vec3(T.r * 2.0 - 1.0, 0.0, T.g * 2.0 - 1.0);
  N.y = sqrt(max(1.0 - dot(N.xz, N.xz), 0.02));
  float sh = T.b, ao = T.a;

  // which lava flow, and where within it (exact: the geometry was cut with the same table)
  vec4 Lr = texture2D(tLayers, vec2(vWorld.y / 2048.0, 0.5));
  float f = Lr.r;                       // 0 on the bench … 1 at the rim above
  float n1 = vnoise(xz * 0.019);
  float chute = vnoise(vec2((xz.x - xz.y) * 0.06, vWorld.y * 0.02));
  if (vDist < 2400.0) {
    float near = 1.0 - smoothstep(300.0, 2400.0, vDist);
    vec2 g = vec2(vnoise(xz * 0.11 + 3.1), vnoise(xz * 0.11 + 9.7)) - 0.5;
    N += vec3(g.x, 0.0, g.y) * 0.3 * near;
  }
  N = normalize(N);
  float slope = 1.0 - N.y;

  // cliff = upper part of each flow on terraced ground; talus below it; snow on the benches.
  // Snow chutes and thin tuff interbeds break the cliffs up.
  float terr = smoothstep(0.1, 0.24, slope);
  float cliff = smoothstep(0.34 + 0.12 * Lr.g, 0.5 + 0.12 * Lr.g, f) * terr;
  cliff = max(cliff, smoothstep(0.5, 0.7, slope + (n1 - 0.5) * 0.2));
  cliff *= smoothstep(0.18, 0.42, chute + 0.18 * n1);
  cliff *= 1.0 - Lr.b * 0.85 * (1.0 - smoothstep(600.0, 1800.0, vDist));
  float talus = smoothstep(0.08, 0.3, f) * (1.0 - cliff) * terr * smoothstep(0.3, 0.7, chute);
  // columnar jointing: vertical organ-pipe grooves across the cliff faces (close range only)
  float cols = 0.0;
  if (cliff > 0.01 && vDist < 1500.0) {
    vec3 Tc = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4);
    float along = dot(vWorld, Tc);
    float c1 = vnoise(vec2(along * 0.42, vWorld.y * 0.035));
    float fade = 1.0 - smoothstep(500.0, 1500.0, vDist);
    cols = (c1 - 0.5) * fade;
    N = normalize(N + Tc * cols * 0.9);
  }
  vec3 snow = vec3(0.82, 0.87, 0.96);
  vec3 basalt = vec3(0.05, 0.046, 0.043) * (0.75 + 0.5 * Lr.g) * (1.0 + cols * 0.8);
  vec3 alb = mix(snow, vec3(0.3, 0.3, 0.32), talus * 0.45);
  alb = mix(alb, basalt, cliff);

  float ndl = max(dot(N, uMoonDir), 0.0);
  vec3 light = uMoonCol * ndl * sh;
  light += mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * ao;
  light += uAurTint * uAurora * (0.35 + 0.65 * N.y) * ao;
  // the city's sodium glow on nearby slopes
  vec2 tc = uCity.xy - xz;
  float dc = length(tc);
  light += uCityCol * uCity.w * max(dot(N, normalize(vec3(tc.x, 120.0, tc.y))), 0.0) / (1.0 + (dc / uCity.z) * (dc / uCity.z));

  vec3 col = alb * light;
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

export function buildTerrain(TD) {
  const { near, mid, far } = TD;
  const U = terrainUniforms;
  U.tNear.value = near.texture;
  U.tMid.value = mid.texture;
  U.tFar.value = far.texture;
  U.tLayers.value = layerTexture();
  // texel centres: a texture of n texels spans n*dx starting half a texel before x0
  U.uNear.value.set(near.x0 - near.dx / 2, near.z0 - near.dx / 2, 1 / (near.nx * near.dx), 1 / (near.nz * near.dx));
  U.uMid.value.set(mid.x0 - mid.dx / 2, mid.z0 - mid.dx / 2, 1 / (mid.nx * mid.dx), 1 / (mid.nz * mid.dx));
  U.uFar.value.set(far.x0 - far.dx / 2, far.z0 - far.dx / 2, 1 / (far.nx * far.dx), 1 / (far.nz * far.dx));
  U.uNearB.value.set(near.x0, near.z0, near.x1, near.z1);
  U.uMidB.value.set(mid.x0, mid.z0, mid.x1, mid.z1);

  const materials = [];
  const debugFlat = new URLSearchParams(location.search).has("flat");
  for (let L = 0; L <= MAXL; L++) {
    materials.push(
      new THREE.ShaderMaterial({
        uniforms: { ...skyUniforms, ...U, uMorph: { value: new THREE.Vector2(RANGE[L] * 0.75, RANGE[L] * 0.98) } },
        vertexShader: VERT,
        fragmentShader: debugFlat ? "varying vec3 vWorld; void main(){ gl_FragColor = vec4(vec3(fract(vWorld.y/50.0)), 1.0); }" : GLSL_NOISE + SKY_GLSL + FRAG,
      }),
    );
  }

  // shared index buffer: grid with "\" diagonals + outward skirts
  const NV = PATCH + 1;
  const idx = [];
  for (let j = 0; j < PATCH; j++)
    for (let i = 0; i < PATCH; i++) {
      const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  const perim = [];
  for (let i = 0; i < PATCH; i++) perim.push([i, 0]);
  for (let j = 0; j < PATCH; j++) perim.push([PATCH, j]);
  for (let i = PATCH; i > 0; i--) perim.push([i, PATCH]);
  for (let j = PATCH; j > 0; j--) perim.push([0, j]);
  const NP = perim.length;
  for (let k = 0; k < NP; k++) {
    const a = perim[k][1] * NV + perim[k][0], b = perim[(k + 1) % NP][1] * NV + perim[(k + 1) % NP][0];
    const a2 = NV * NV + k, b2 = NV * NV + ((k + 1) % NP);
    idx.push(a, b, a2, b, b2, a2);
  }
  const index = new THREE.Uint16BufferAttribute(idx, 1);

  // conservative height bounds per 400 m cell (level 8), then a min/max pyramid
  const BN = 256, CELL = ROOT.size / BN;
  const pyr = [];
  {
    const mn = new Float32Array(BN * BN), mx = new Float32Array(BN * BN);
    for (let cj = 0; cj < BN; cj++)
      for (let ci = 0; ci < BN; ci++) {
        let lo = Infinity, hi = -Infinity;
        for (let sj = 0; sj <= 4; sj++)
          for (let si = 0; si <= 4; si++) {
            const h = TD.heightFast(ROOT.x0 + (ci + si / 4) * CELL, ROOT.z0 + (cj + sj / 4) * CELL);
            if (h < lo) lo = h;
            if (h > hi) hi = h;
          }
        mn[cj * BN + ci] = lo - 40;
        mx[cj * BN + ci] = hi + 40;
      }
    pyr[8] = { n: BN, mn, mx };
    for (let L = 7; L >= 0; L--) {
      const c = pyr[L + 1], n = c.n / 2;
      const m0 = new Float32Array(n * n), m1 = new Float32Array(n * n);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const ks = [(2 * j) * c.n + 2 * i, (2 * j) * c.n + 2 * i + 1, (2 * j + 1) * c.n + 2 * i, (2 * j + 1) * c.n + 2 * i + 1];
          m0[j * n + i] = Math.min(...ks.map((k) => c.mn[k]));
          m1[j * n + i] = Math.max(...ks.map((k) => c.mx[k]));
        }
      pyr[L] = { n, mn: m0, mx: m1 };
    }
  }
  function bounds(L, ix, iz) {
    if (L <= 8) {
      const p = pyr[L];
      return [p.mn[iz * p.n + ix], p.mx[iz * p.n + ix]];
    }
    const p = pyr[8];
    const k = (iz >> (L - 8)) * p.n + (ix >> (L - 8));
    return [p.mn[k], p.mx[k]];
  }

  const cache = new Map();
  function nodeMesh(L, ix, iz) {
    const key = `${L}/${ix}/${iz}`;
    let m = cache.get(key);
    if (m) return m;
    const size = SIZE(L), s = size / PATCH;
    const x0 = ROOT.x0 + ix * size, z0 = ROOT.z0 + iz * size;
    const h = new Float32Array(NV * NV);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) h[j * NV + i] = TD.heightAt(x0 + i * s, z0 + j * s);
    const pos = new Float32Array((NV * NV + NP) * 3);
    const hc = new Float32Array(NV * NV + NP);
    const H = (i, j) => h[j * NV + i];
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NV; i++) {
        const k = j * NV + i;
        pos[k * 3] = x0 + i * s;
        pos[k * 3 + 1] = H(i, j);
        pos[k * 3 + 2] = z0 + j * s;
        const oi = i & 1, oj = j & 1;
        hc[k] = !oi && !oj ? H(i, j) : oi && !oj ? (H(i - 1, j) + H(i + 1, j)) / 2 : !oi && oj ? (H(i, j - 1) + H(i, j + 1)) / 2 : (H(i - 1, j - 1) + H(i + 1, j + 1)) / 2;
      }
    const skirt = Math.max(4, size * 0.03);
    for (let k = 0; k < NP; k++) {
      const [i, j] = perim[k], src = j * NV + i, dst = NV * NV + k;
      pos[dst * 3] = pos[src * 3];
      pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt;
      pos[dst * 3 + 2] = pos[src * 3 + 2];
      hc[dst] = hc[src] - skirt;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("hc", new THREE.BufferAttribute(hc, 1));
    g.setIndex(index);
    const [lo, hi] = bounds(L, ix, iz);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, lo - skirt - 400, z0), new THREE.Vector3(x0 + size, hi, z0 + size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    m = new THREE.Mesh(g, materials[L]);
    m.frustumCulled = false; // culled during selection
    m.matrixAutoUpdate = false;
    cache.set(key, m);
    return m;
  }

  const group = new THREE.Group();
  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const bb = new THREE.Box3();
  const cam = new THREE.Vector3();
  let selected = [];

  function select(L, ix, iz) {
    const size = SIZE(L);
    const x0 = ROOT.x0 + ix * size, z0 = ROOT.z0 + iz * size;
    const [lo, hi] = bounds(L, ix, iz);
    bb.min.set(x0, lo, z0);
    bb.max.set(x0 + size, hi, z0 + size);
    const d = bb.distanceToPoint(cam);
    // the earth curves the far nodes down; widen their box before culling
    const far = d + size * 1.5;
    bb.min.y -= (far * far) / (2 * EARTH_R) + 10;
    if (!frustum.intersectsBox(bb)) return;
    if (L < MAXL && d < RANGE[L + 1]) {
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) select(L + 1, ix * 2 + dx, iz * 2 + dz);
      return;
    }
    selected.push(nodeMesh(L, ix, iz));
  }

  return {
    group,
    // pick this camera's nodes; call after the camera's matrices are current
    update(camera) {
      cam.copy(camera.position);
      pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pm);
      for (const m of selected) group.remove(m);
      selected = [];
      select(0, 0, 0);
      // front to back, so early depth rejection skips the hidden slopes (meshes all sit at the origin)
      for (const m of selected) m.userData.d = m.geometry.boundingBox.distanceToPoint(cam);
      selected.sort((a, b) => a.userData.d - b.userData.d);
      selected.forEach((m, i) => { m.renderOrder = i; group.add(m); });
      return selected.length;
    },
    stats: () => ({ nodes: selected.length, cached: cache.size }),
  };
}
