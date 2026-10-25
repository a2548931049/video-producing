// The coast: sky dome, sea, cliff-top road that runs down to a bay, posts, grass, flowers, shrubs,
// a lighthouse on the far headland and a sailboat. Everything is a pure function of time.
import * as THREE from "three";
import { SKY_GLSL, skyUniforms, SKY } from "./skyglsl.js";
import { patch, shared, tag } from "./materials.js";
import { rng, clamp, lerp, smoothstep, fbm1, fbm2, noise1, noise2, TAU, lin } from "./util.js";
import { normalFromHeight, canvas, canvasTex } from "./textures.js";
import { rod, merge, place, latheZ, ellipsoid, mergeVertices as mergeVerts } from "./geo.js";

export const WORLD = { SEA_Y: -16.5, LANE: 2.25 };

const cosEase = (u) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u));
export function roadY(x) {
  return 0.5 * smoothstep(5, 70, x) - 14.5 * cosEase((x - 74) / 165);
}
export function roadSlope(x) {
  const e = 0.05;
  return (roadY(x + e) - roadY(x - e)) / (2 * e);
}
export function coastZ(x) {
  let z = -14.5 - 10 * smoothstep(120, 245, x);
  if (x > 300) z -= 0.00062 * (x - 300) ** 2;
  if (x < -150) z -= 0.0008 * (x + 150) ** 2;
  z += 2.2 * fbm1(x * 0.018 + 3.1, 3) + 0.7 * noise1(x * 0.11);
  return z;
}
const COAST300 = () => coastZ(300);
export function roadZ(x) {
  if (x <= 300) return 0;
  return coastZ(x) - COAST300() + 0.0;
}
const beachness = (x) => smoothstep(150, 238, x);

export function terrainH(x, z) {
  const zr = roadZ(x), yr = roadY(x);
  const zc = coastZ(x);
  const dz = z - zc;
  const SEA = WORLD.SEA_Y;
  const beach = beachness(x);
  const top = yr - 0.25;
  let h;
  if (dz < 0) {
    h = SEA - 1.2 + dz * lerp(0.6, 0.08, beach);
  } else {
    const edge = lerp(4.5, 20, beach);
    const u = clamp(dz / edge);
    const cliff = Math.pow(u, 0.28);
    const shore = smoothstep(0, 1, u) * 0.85 + u * 0.15;
    const s = lerp(cliff, shore, beach);
    h = SEA - 0.4 + (top - SEA + 0.4) * s;
    // rocky relief on the cliff face
    h += (1 - beach) * (1 - Math.abs(2 * u - 1)) * (1.6 * fbm2(x * 0.18, z * 0.25, 3) + 0.6 * fbm2(x * 0.9, z * 0.9, 2));
  }
  // inland: rolling grass dunes, low near the road so the low sun stays clear
  const dl = z - (zr + 4.6);
  if (dl > 0) {
    h += smoothstep(0, 30, dl) * (1.2 + 1.6 * fbm2(x * 0.02, z * 0.03, 3));
    h += smoothstep(40, 500, dl) * 26 * (0.55 + 0.45 * fbm2(x * 0.004 + 2, z * 0.004, 3));
  }
  // headlands across the water
  const headW = smoothstep(25, 220, dz) * smoothstep(-6, -40, z - zr);
  h += headW * 34 * (0.55 + 0.45 * fbm2(x * 0.0045 + 7, z * 0.0045, 4));
  // flatten under the road and its shoulders
  const dr = Math.abs(z - zr);
  const flat = 1 - smoothstep(3.9, 5.2, dr);
  h = lerp(h, yr - 0.035, flat);
  // gentle verge undulation
  h += (1 - flat) * smoothstep(5.2, 9, dr) * 0.15 * fbm2(x * 0.3, z * 0.3, 2) * (dz > 6 ? 1 : 0);
  return h;
}

// ------------------------------------------------------------------ helpers
function warp(n, a, b, coreA, coreB, coreStep) {
  // sample positions: uniform `coreStep` inside [coreA, coreB], geometric growth outside
  const pts = [];
  for (let v = coreA; v <= coreB; v += coreStep) pts.push(v);
  let s = coreStep, v = coreA;
  const left = [];
  while (v > a) { s *= 1.06; v -= s; left.push(Math.max(a, v)); }
  s = coreStep; v = coreB;
  const right = [];
  while (v < b) { s *= 1.06; v += s; right.push(Math.min(b, v)); }
  return [...left.reverse(), ...pts, ...right];
}

export function buildWorld(M) {
  const group = new THREE.Group();
  group.name = "world";
  const R = rng(777);

  // ---------------------------------------------------------------- sky dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: SKY_GLSL + /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        gl_FragColor = vec4(skyFull(d), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  group.add(sky);

  // ---------------------------------------------------------------- sea
  const seaMat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, uTime: shared.uTime, uSeaY: { value: WORLD.SEA_Y } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: SKY_GLSL + /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      vec2 waveGrad(vec2 p, float t, float fade) {
        vec2 g = vec2(0.0);
        // long swell + chop, directions roughly onshore (+z)
        const int N = 9;
        float amp = 0.16, k = 0.07, ang = 1.2;
        for (int i = 0; i < N; i++) {
          vec2 dir = vec2(cos(ang), sin(ang));
          float w = sqrt(9.81 * k);
          float ph = dot(dir, p) * k - w * t + float(i) * 1.7;
          g += dir * k * amp * cos(ph) * (i > 3 ? fade : 1.0);
          amp *= 0.74; k *= 1.53; ang += 2.17 + float(i) * 0.61;
        }
        return g;
      }
      void main() {
        vec3 dv = vWorld - cameraPosition;
        float dist = length(dv);
        vec3 V = dv / dist;
        float fade = 1.0 - smoothstep(60.0, 600.0, dist);
        vec2 g = waveGrad(vWorld.xz, uTime, fade);
        // fine ripples
        float e = 0.35;
        vec2 rp = vWorld.xz * 0.9 + vec2(uTime * 0.6, uTime * 0.35);
        float n0 = fbm5(rp), nx = fbm5(rp + vec2(e, 0.0)), nz = fbm5(rp + vec2(0.0, e));
        g += vec2(nx - n0, nz - n0) / e * 0.22 * (1.0 - smoothstep(20.0, 160.0, dist));
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 R = reflect(V, N);
        R.y = abs(R.y) + 0.002;
        float cosT = max(dot(N, -V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 refl = skyColor(R);
        // moon path
        refl += vec3(1.0, 0.85, 0.75) * pow(max(dot(R, uMoonDir), 0.0), 900.0) * 6.0;
        refl += vec3(0.9, 0.7, 0.65) * pow(max(dot(R, uMoonDir), 0.0), 60.0) * 0.12;
        // sun glints (sun is behind the land for most views but catches wave faces)
        refl += vec3(4.0, 2.2, 0.9) * pow(max(dot(R, uSunDir), 0.0), 1200.0) * 20.0;
        vec3 deep = vec3(0.012, 0.045, 0.07);
        vec3 scatter = vec3(0.03, 0.12, 0.13) * (0.4 + 0.6 * pow(1.0 - cosT, 2.0));
        vec3 col = mix(deep + scatter, refl, fres);
        // horizon haze
        col = mix(col, hazeColor(V), smoothstep(400.0, 3600.0, dist) * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = WORLD.SEA_Y;
  sea.frustumCulled = false;
  sea.renderOrder = -5;
  group.add(sea);

  // ---------------------------------------------------------------- terrain
  const xs = warp(0, -900, 1700, -90, 430, 0.8);
  const zs = warp(0, -1100, 900, -34, 42, 0.5);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = xs[i], z = zs[j];
    const h = terrainH(x, z);
    H[j * nx + i] = h;
    const k = j * nx + i;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    uv[k * 2] = x * 0.25; uv[k * 2 + 1] = z * 0.25;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  tg.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  tg.setIndex(new THREE.BufferAttribute(idx, 1));
  tg.computeVertexNormals();
  const nrm = tg.attributes.normal;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const x = xs[i], z = zs[j], h = H[k];
    const ny = nrm.getY(k);
    const n1 = fbm2(x * 0.05, z * 0.05, 3), n2 = fbm2(x * 0.6, z * 0.6, 2);
    // dry golden grass with green patches
    let c = [lerp(0.46, 0.62, n1 * 0.5 + 0.5), lerp(0.46, 0.55, n1 * 0.5 + 0.5), lerp(0.2, 0.26, n2 * 0.5 + 0.5)];
    c = c.map((v, i2) => lerp(v, [0.32, 0.42, 0.18][i2], smoothstep(0.1, 0.5, n2) * 0.6));
    // rock on steep faces
    const rock = 1 - smoothstep(0.45, 0.72, ny);
    const rc = [0.34 + 0.08 * n2, 0.3 + 0.06 * n2, 0.26 + 0.05 * n2];
    c = c.map((v, i2) => lerp(v, rc[i2], rock));
    // sand near sea level
    const sand = (1 - smoothstep(WORLD.SEA_Y + 1.8, WORLD.SEA_Y + 3.8, h)) * smoothstep(0.75, 0.9, ny);
    const wet = 1 - smoothstep(WORLD.SEA_Y - 0.2, WORLD.SEA_Y + 0.5, h);
    const sc = [lerp(0.78, 0.45, wet), lerp(0.68, 0.38, wet), lerp(0.5, 0.3, wet)];
    c = c.map((v, i2) => lerp(v, sc[i2], sand));
    // gravel shoulder
    const dr = Math.abs(z - roadZ(x));
    const grav = smoothstep(3.4, 3.7, dr) * (1 - smoothstep(4.4, 5.2, dr));
    c = c.map((v, i2) => lerp(v, [0.44, 0.41, 0.37][i2], grav));
    const dp = z - roadZ(x);
    const path = smoothstep(6.8, 7.2, dp) * (1 - smoothstep(8.2, 8.6, dp)) * (0.85 + 0.15 * n2);
    c = c.map((v, i2) => lerp(v, [0.52, 0.44, 0.33][i2], path));
    col[k * 3] = lin(c[0]); col[k * 3 + 1] = lin(c[1]); col[k * 3 + 2] = lin(c[2]);
  }
  tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const groundNormal = normalFromHeight(256, 256, (u, v) => fbm2(u * 24, v * 24, 3) * 0.6 + fbm2(u * 80, v * 80, 2) * 0.3, 2.2);
  const terrainMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, normalMap: groundNormal, normalScale: new THREE.Vector2(0.6, 0.6) }), { aerial: true });
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  terrain.name = "terrain";
  group.add(terrain);

  // ---------------------------------------------------------------- road
  const roadTex = makeRoadTexture();
  const rx0 = -90, rx1 = 720;
  const rpts = [];
  for (let x = rx0; x <= rx1; x += x < 430 ? 0.5 : 2) rpts.push(x);
  const across = [-3.55, -3.3, -1.6, 0, 1.6, 3.3, 3.55];
  const rp = new Float32Array(rpts.length * across.length * 3);
  const ru = new Float32Array(rpts.length * across.length * 2);
  let L = 0;
  for (let i = 0; i < rpts.length; i++) {
    const x = rpts[i];
    if (i > 0) {
      const x0 = rpts[i - 1];
      L += Math.hypot(x - x0, roadY(x) - roadY(x0), roadZ(x) - roadZ(x0));
    }
    const zr = roadZ(x), yr = roadY(x);
    const dzdx = (roadZ(x + 0.5) - roadZ(x - 0.5));
    const side = new THREE.Vector3(-dzdx, 0, 1).normalize();
    for (let j = 0; j < across.length; j++) {
      const a = across[j];
      const crown = 0.03 * (1 - (a / 3.55) ** 2);
      const k = i * across.length + j;
      rp[k * 3] = x + side.x * a; rp[k * 3 + 1] = yr + crown + (Math.abs(a) > 3.4 ? -0.02 : 0); rp[k * 3 + 2] = zr + side.z * a;
      ru[k * 2] = (a + 3.55) / 7.1; ru[k * 2 + 1] = L / 28;
    }
  }
  const ri = [];
  for (let i = 0; i < rpts.length - 1; i++) for (let j = 0; j < across.length - 1; j++) {
    const a = i * across.length + j, b = a + 1, c = a + across.length, d = c + 1;
    ri.push(a, b, c, b, d, c);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
  rg.setAttribute("uv", new THREE.BufferAttribute(ru, 2));
  rg.setIndex(ri);
  rg.computeVertexNormals();
  const roadMat = patch(new THREE.MeshStandardMaterial({ map: roadTex.map, roughnessMap: roadTex.rough, normalMap: roadTex.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1 }), { aerial: true });
  const road = new THREE.Mesh(rg, roadMat);
  road.receiveShadow = true;
  road.name = "road";
  group.add(road);

  // ---------------------------------------------------------------- posts + rails (sea side)
  {
    const postG = new THREE.BoxGeometry(0.11, 1.05, 0.11);
    postG.translate(0, 0.52, 0);
    const capG = new THREE.ConeGeometry(0.085, 0.07, 4);
    capG.rotateY(Math.PI / 4);
    capG.translate(0, 1.08, 0);
    const reflG = new THREE.BoxGeometry(0.02, 0.12, 0.05);
    reflG.translate(0.06, 0.88, 0);
    const posts = [];
    for (let x = -88; x < 420; x += 2.6) posts.push(x);
    const woodTex = makeWoodTexture();
    const woodMat = patch(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 }), { aerial: true });
    const postM = new THREE.InstancedMesh(merge([postG, capG]), woodMat, posts.length);
    const reflM = new THREE.InstancedMesh(reflG, patch(new THREE.MeshStandardMaterial({ color: 0xc8a020, roughness: 0.3, metalness: 0.4, emissive: 0x201000 }), { aerial: true }), posts.length);
    const railG = new THREE.BoxGeometry(1, 0.1, 0.045);
    const railM = new THREE.InstancedMesh(railG, woodMat, posts.length * 2);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion();
    posts.forEach((x, i) => {
      const zr = roadZ(x) - 4.35;
      const y = terrainH(x, zr) - 0.05;
      const tilt = (R() - 0.5) * 0.04;
      qq.setFromEuler(new THREE.Euler(tilt, (R() - 0.5) * 0.1, (R() - 0.5) * 0.04));
      m.compose(new THREE.Vector3(x, y, zr), qq, new THREE.Vector3(1, 0.95 + R() * 0.1, 1));
      postM.setMatrixAt(i, m);
      reflM.setMatrixAt(i, m);
      const x2 = x + 2.6, z2 = roadZ(x2) - 4.35, y2 = terrainH(x2, z2) - 0.05;
      for (let r = 0; r < 2; r++) {
        const hy = r === 0 ? 0.55 : 0.92;
        const a = new THREE.Vector3(x, y + hy, zr + 0.06), b = new THREE.Vector3(x2, y2 + hy, z2 + 0.06);
        const d = b.clone().sub(a);
        const len = d.length();
        qq.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
        m.compose(a.clone().add(b).multiplyScalar(0.5), qq, new THREE.Vector3(len, 1, 1));
        railM.setMatrixAt(i * 2 + r, m);
      }
    });
    for (const im of [postM, reflM, railM]) { im.castShadow = true; im.receiveShadow = true; group.add(im); }
  }

  // ---------------------------------------------------------------- grass tufts (wind in the vertex shader)
  const grassMat = makeGrassMaterial();
  {
    const blades = [];
    const r2 = rng(99);
    for (let b = 0; b < 9; b++) {
      const a = r2() * TAU, rr = r2() * 0.07;
      const h = 0.28 + r2() * 0.36, w = 0.012 + r2() * 0.01;
      const lean = (r2() - 0.5) * 0.5, leanDir = r2() * TAU;
      const segs = 4;
      const P = [], C = [], I = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const bend = lean * t * t;
        const cx = Math.cos(a) * rr + Math.cos(leanDir) * bend * h, cz = Math.sin(a) * rr + Math.sin(leanDir) * bend * h;
        const ww = w * (1 - t * 0.92);
        const ox = Math.cos(a + 1.57) * ww, oz = Math.sin(a + 1.57) * ww;
        P.push(cx - ox, t * h, cz - oz, cx + ox, t * h, cz + oz);
        const g = lin(lerp(0.45, 1.0, t));
        C.push(g, g, g, g, g, g);
      }
      for (let s = 0; s < segs; s++) { const k = s * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      gg.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      gg.setIndex(I);
      gg.computeVertexNormals();
      blades.push(gg);
    }
    const tuft = mergeKeepColor(blades);
    const spots = [];
    const r3 = rng(4242);
    for (let n = 0; n < 34000; n++) {
      const x = -70 + r3() * 340;
      const side = r3() < 0.6 ? 1 : -1;
      let off = side > 0 ? 3.75 + Math.pow(r3(), 1.3) * 16 : 3.75 + r3() * 4.6;
      if (side > 0 && off > 6.9 && off < 8.5) continue; // footpath along the verge
      const z = roadZ(x) + side * off;
      const h = terrainH(x, z);
      // skip steep cliff faces and the beach
      const e = 0.4;
      const sl = Math.abs(terrainH(x + e, z) - terrainH(x - e, z)) + Math.abs(terrainH(x, z + e) - terrainH(x, z - e));
      if (sl > 0.5 || h < WORLD.SEA_Y + 3) continue;
      const mown = side > 0 && off < 6.9 ? 0.42 : side < 0 && off < 4.3 ? 0.5 : 1;
      spots.push([x, h, z, r3() * TAU, (0.6 + r3() * 0.8) * mown, r3()]);
    }
    const gm = new THREE.InstancedMesh(tuft, grassMat, spots.length);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion();
    const cc = new THREE.Color();
    spots.forEach((s, i) => {
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s[3]);
      m.compose(new THREE.Vector3(s[0], s[1] - 0.02, s[2]), qq, new THREE.Vector3(s[4], s[4] * (0.8 + s[5] * 0.5), s[4]));
      gm.setMatrixAt(i, m);
      const dry = s[5];
      cc.setRGB(lerp(0.4, 0.74, dry), lerp(0.5, 0.62, dry), lerp(0.18, 0.26, dry), THREE.SRGBColorSpace);
      gm.setColorAt(i, cc);
    });
    gm.castShadow = false;
    gm.receiveShadow = true;
    gm.frustumCulled = false;
    gm.name = "grass";
    group.add(gm);
  }

  // ---------------------------------------------------------------- wildflowers
  {
    const head = new THREE.IcosahedronGeometry(0.03, 1);
    head.scale(1, 0.5, 1);
    head.translate(0, 0.24, 0);
    const stem = new THREE.CylinderGeometry(0.0025, 0.0035, 0.24, 4);
    stem.translate(0, 0.12, 0);
    const flowerG = mergeKeepColor([colorize(head, [1, 1, 1]), colorize(stem, [0.25, 0.35, 0.12])]);
    const fl = [];
    const r4 = rng(31337);
    for (let n = 0; n < 5200; n++) {
      const x = -70 + r4() * 330;
      const side = r4() < 0.65 ? 1 : -1;
      const off = side > 0 ? 3.9 + Math.pow(r4(), 1.4) * 12 : 3.9 + r4() * 4.2;
      if (side > 0 && off > 6.7 && off < 8.7) continue;
      const z = roadZ(x) + side * off;
      // clump them
      if (fbm2(x * 0.08, z * 0.08, 2) < 0.05) continue;
      const h = terrainH(x, z);
      if (h < WORLD.SEA_Y + 3) continue;
      fl.push([x, h, z, r4(), r4()]);
    }
    const fm = new THREE.InstancedMesh(flowerG, grassMat, fl.length);
    const m = new THREE.Matrix4(), cc = new THREE.Color();
    const palette = [[1.0, 0.78, 0.12], [0.98, 0.95, 0.9], [0.62, 0.4, 0.85], [1.0, 0.5, 0.2]];
    fl.forEach((f, i) => {
      const s = 0.55 + f[3] * 0.9;
      m.compose(new THREE.Vector3(f[0], f[1], f[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f[4] * TAU), new THREE.Vector3(s, s, s));
      fm.setMatrixAt(i, m);
      const p = palette[Math.floor(f[4] * 3.999)];
      fm.setColorAt(i, cc.setRGB(p[0], p[1], p[2], THREE.SRGBColorSpace));
    });
    fm.receiveShadow = true;
    fm.frustumCulled = false;
    group.add(fm);
  }

  // ---------------------------------------------------------------- shrubs on the hills
  {
    let blob = new THREE.IcosahedronGeometry(1, 4);
    blob.deleteAttribute("normal");
    blob.deleteAttribute("uv");
    blob = mergeVerts(blob);
    const bp = blob.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(bp, i);
      const k = 1 + 0.22 * noise2(v.x * 2.3 + v.z, v.y * 2.3) + 0.1 * noise2(v.x * 6, v.z * 6);
      v.multiplyScalar(k);
      v.y = Math.max(v.y, -0.2) * 0.75;
      bp.setXYZ(i, v.x, v.y, v.z);
    }
    blob.computeVertexNormals();
    const shrubs = [];
    const r5 = rng(555);
    for (let n = 0; n < 2600; n++) {
      const x = -150 + r5() * 700;
      const z = roadZ(x) + 9 + Math.pow(r5(), 1.3) * 160;
      const h = terrainH(x, z);
      shrubs.push([x, h, z, 0.3 + r5() * 0.6, r5()]);
    }
    for (let n = 0; n < 400; n++) {
      // a few hanging on to the cliff top on the sea side
      const x = -80 + r5() * 260;
      const z = roadZ(x) - 5.2 - r5() * 2.8;
      shrubs.push([x, terrainH(x, z), z, 0.25 + r5() * 0.45, r5()]);
    }
    blob.computeVertexNormals();
    const sm = new THREE.InstancedMesh(blob, patch(new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0xffffff }), { aerial: true }), shrubs.length);
    const m = new THREE.Matrix4(), cc = new THREE.Color();
    shrubs.forEach((s, i) => {
      m.compose(new THREE.Vector3(s[0], s[1] - s[3] * 0.1, s[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s[4] * TAU), new THREE.Vector3(s[3] * (1 + s[4] * 0.4), s[3], s[3]));
      sm.setMatrixAt(i, m);
      cc.setRGB(lerp(0.3, 0.46, s[4]), lerp(0.38, 0.44, s[4]), lerp(0.2, 0.22, s[4]), THREE.SRGBColorSpace);
      sm.setColorAt(i, cc);
    });
    sm.castShadow = true;
    sm.receiveShadow = true;
    group.add(sm);
  }

  // ---------------------------------------------------------------- lighthouse on the far headland
  const lighthouse = new THREE.Group();
  {
    const lx = 1060, lz = coastZ(1060) + 32;
    const ly = terrainH(lx, lz);
    lighthouse.position.set(lx, ly - 0.5, lz);
    const white = patch(new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.7 }), { aerial: true });
    const red = patch(new THREE.MeshStandardMaterial({ color: 0xa02a22, roughness: 0.6 }), { aerial: true });
    const dark = patch(new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }), { aerial: true });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 22, 24), white);
    tower.position.y = 11;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.78, 3.5, 24), red);
    band.position.y = 12;
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.4, 24), dark);
    gallery.position.y = 22.2;
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.5, 2.6) });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 16), lampMat);
    lamp.position.y = 23.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.8, 16), red);
    roof.position.y = 25.4;
    const house = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 6), white);
    house.position.set(-7, 2.2, 3);
    const houseRoof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.6, 4), red);
    houseRoof.rotation.y = Math.PI / 4;
    houseRoof.scale.set(1.05, 1, 0.75);
    houseRoof.position.set(-7, 5.8, 3);
    lighthouse.add(tower, band, gallery, lamp, roof, house, houseRoof);
    lighthouse.userData.lamp = lamp;
    group.add(lighthouse);
  }

  // ---------------------------------------------------------------- sailboat
  const boat = new THREE.Group();
  {
    const hullMat = patch(new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.5 }), { aerial: true });
    const sailMat = patch(new THREE.MeshStandardMaterial({ color: 0xfff6ea, roughness: 0.8, side: THREE.DoubleSide }), { aerial: true, translucency: 0.8 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 1.0, 2.2), hullMat);
    hull.geometry.translate(0, 0.3, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 6), hullMat);
    mast.position.set(0.5, 5, 0);
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0); sailShape.lineTo(-3.4, 0); sailShape.quadraticCurveTo(-1.2, 4.6, 0, 8.4); sailShape.lineTo(0, 0);
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape, 12), sailMat);
    sail.position.set(0.45, 1.1, 0.05);
    const jibShape = new THREE.Shape();
    jibShape.moveTo(0, 0); jibShape.lineTo(2.8, 0); jibShape.lineTo(0, 7.4); jibShape.lineTo(0, 0);
    const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape, 4), sailMat);
    jib.position.set(0.7, 1.1, -0.05);
    boat.add(hull, mast, sail, jib);
    boat.rotation.y = 0.5;
    group.add(boat);
  }

  // ---------------------------------------------------------------- update
  function update(t) {
    shared.uTime.value = t;
    skyUniforms.uSkyTime.value = t;
    const bx = 230 + t * 1.2;
    boat.position.set(bx, WORLD.SEA_Y + 0.15 + Math.sin(t * 0.9) * 0.12, -230 + t * 0.2);
    boat.rotation.z = Math.sin(t * 0.7) * 0.04;
    boat.rotation.x = Math.sin(t * 0.55 + 1) * 0.03;
    // lighthouse lamp breathes as its beam sweeps
    const beam = 0.5 + 0.5 * Math.cos(t * 1.2);
    lighthouse.userData.lamp.material.color.setRGB(3 + 9 * beam ** 8, 2.2 + 6 * beam ** 8, 1.3 + 3.5 * beam ** 8);
  }
  update(0);
  return { group, sky, sea, terrain, road, update, lighthouse, boat, skyMat };
}

// ------------------------------------------------------------------ materials/textures
function makeGrassMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const prev = m.onBeforeCompile;
  patch(m, { aerial: true, translucency: 0.6, transColor: 0xd8e080 });
  const patched = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    patched(sh, r);
    sh.uniforms.uWindT = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWindT;\nfloat whash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}\nfloat wnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(whash(i),whash(i+vec2(1,0)),u.x),mix(whash(i+vec2(0,1)),whash(i+vec2(1,1)),u.x),u.y);}")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec2 ip = vec2(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xz;
          #endif
          float hgt = max(position.y, 0.0);
          float gust = wnoise(ip * 0.08 + vec2(uWindT * 0.45, uWindT * 0.2));
          float flick = sin(uWindT * 4.2 + ip.x * 1.7 + ip.y * 0.9) * 0.5 + 0.5;
          float bend = (0.25 + 0.75 * gust) * (0.7 + 0.3 * flick) * hgt * hgt * 1.4;
          transformed.x -= bend * 0.55;
          transformed.z += bend * 0.18;
          transformed.y -= bend * bend * 0.3;
        }`,
      );
  };
  void prev;
  m.customProgramCacheKey = () => "grass-wind";
  return m;
}

function colorize(g, c) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}

function mergeKeepColor(list) {
  const gs = list.map((g) => {
    let gg = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(gg.attributes)) if (!["position", "normal", "color"].includes(k)) gg.deleteAttribute(k);
    if (!gg.attributes.normal) gg.computeVertexNormals();
    return gg;
  });
  const total = gs.reduce((s, g) => s + g.attributes.position.count, 0);
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3);
  let o = 0;
  for (const g of gs) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    C.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(P, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  out.setAttribute("color", new THREE.BufferAttribute(C, 3));
  return out;
}

function makeRoadTexture() {
  // 7.1 m across (u) × 28 m along (v)
  const W = 512, H = 2048;
  const c = canvas(W, H), g = c.getContext("2d");
  const img = g.createImageData(W, H);
  const rr = canvas(W, H), gr = rr.getContext("2d");
  const rimg = gr.createImageData(W, H);
  const heights = new Float32Array(W * H);
  const r = rng(808);
  for (let y = 0; y < H; y++) {
    const along = (y / H) * 28;
    for (let x = 0; x < W; x++) {
      const across = (x / W) * 7.1 - 3.55;
      const i = (y * W + x) * 4;
      const agg = r();
      const n = fbm2(x * 0.02, y * 0.02, 3);
      let v = 0.13 + 0.035 * n + (agg > 0.94 ? 0.06 : 0) - (agg < 0.05 ? 0.03 : 0);
      // darker polished tyre tracks in each lane
      for (const tc of [-2.5, -1.0, 1.0, 2.5]) v -= 0.018 * Math.exp(-(((across - tc) / 0.35) ** 2));
      // tar-sealed crack lines
      const crack = 0;
      v -= crack * 0.05;
      let paint = 0;
      // edge lines
      if (Math.abs(Math.abs(across) - 3.22) < 0.075) paint = 1;
      // dashed centre line: 3 m dash every 9 m
      if (Math.abs(across) < 0.06 && (along % 9) < 3) paint = 1;
      // worn paint
      if (paint) paint *= 0.75 + 0.25 * fbm2(x * 0.15, y * 0.05, 2) - (r() < 0.12 ? 0.4 : 0);
      const base = [v * 1.02, v, v * 0.98];
      const pc = Math.abs(across) < 0.1 ? [0.82, 0.66, 0.18] : [0.86, 0.86, 0.82];
      const col = base.map((b, k) => lerp(b, pc[k], clamp(paint)));
      img.data[i] = clamp(Math.pow(col[0], 1 / 2.2) * 255, 0, 255);
      img.data[i + 1] = clamp(Math.pow(col[1], 1 / 2.2) * 255, 0, 255);
      img.data[i + 2] = clamp(Math.pow(col[2], 1 / 2.2) * 255, 0, 255);
      img.data[i + 3] = 255;
      const rough = paint > 0.3 ? 0.55 : 0.82 + 0.1 * n;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rough * 255;
      rimg.data[i + 3] = 255;
      heights[y * W + x] = agg * 0.6 + n * 0.3 + paint * 0.4 - crack;
    }
  }
  g.putImageData(img, 0, 0);
  gr.putImageData(rimg, 0, 0);
  const map = canvasTex(c);
  const rough = canvasTex(rr, false);
  const normal = normalFromHeight(W, H, (u, v) => heights[Math.floor(v * H) * W + Math.floor(u * W)], 0.7);
  return { map, rough, normal };
}

function makeWoodTexture() {
  const c = canvas(64, 256), g = c.getContext("2d");
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    const grain = 0.5 + 0.5 * Math.sin(x * 0.9 + fbm2(x * 0.1, y * 0.02, 3) * 6);
    const v = 0.62 + 0.12 * grain + 0.06 * fbm2(x * 0.3, y * 0.3, 2);
    img.data[i] = clamp(v * 232, 0, 255); img.data[i + 1] = clamp(v * 226, 0, 255); img.data[i + 2] = clamp(v * 212, 0, 255); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c);
}

export { SKY };
