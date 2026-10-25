// Street-level life: snow-covered parked cars, curbside snowbanks, a few cars driving with their lights on.
import * as THREE from "three";
import { GLSL_NOISE, mulberry32 } from "./util.js";
import { SKY_GLSL, skyUniforms } from "./sky.js";
import { cityUniforms, LIGHTS_GLSL } from "./city.js";
import { HERO, ZA } from "./layout.js";

// a car: body + a tapered cabin as boxes (flags per vertex: 0 body, 1 glass, 2 headlight, 3 tail-light)
function carGeometry() {
  const pos = [], flag = [];
  const box = (x0, y0, z0, x1, y1, z1, f, inset = 0) => {
    const xi0 = x0 + inset, xi1 = x1 - inset, zi0 = z0 + inset, zi1 = z1 - inset;
    const P = [[x0, y0, z0], [x1, y0, z0], [xi1, y1, zi0], [xi0, y1, zi0], [x0, y0, z1], [x1, y0, z1], [xi1, y1, zi1], [xi0, y1, zi1]];
    const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2]];
    for (const q of faces)
      for (const k of [q[0], q[1], q[2], q[0], q[2], q[3]]) {
        pos.push(...P[k]);
        flag.push(f);
      }
  };
  box(-2.2, 0.32, -0.88, 2.2, 1.0, 0.88, 0);
  box(-1.15, 1.0, -0.8, 1.05, 1.5, 0.8, 1, 0.14);
  box(2.2, 0.62, -0.78, 2.24, 0.82, -0.48, 2);
  box(2.2, 0.62, 0.48, 2.24, 0.82, 0.78, 2);
  box(-2.24, 0.66, -0.82, -2.2, 0.84, -0.5, 3);
  box(-2.24, 0.66, 0.5, -2.2, 0.84, 0.82, 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(flag, 1));
  g.computeVertexNormals(); // non-indexed: flat face normals
  return g;
}

const CAR_VERT = /* glsl */ `
attribute float aPart;
attribute vec4 aCar; // colour index, snow amount, moving (1) / parked (0), seed
varying vec3 vWorld; varying vec3 vN; varying float vPart; varying vec4 vCar; varying vec3 vLocal;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz; vLocal = position;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vPart = aPart; vCar = aCar;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CAR_FRAG = /* glsl */ `
uniform vec3 uPalette[12];
uniform vec3 uMoonCity, uAmbCity;
varying vec3 vWorld; varying vec3 vN; varying float vPart; varying vec4 vCar; varying vec3 vLocal;
void main() {
  vec3 N = normalize(vN);
  float part = floor(vPart + 0.5);
  float ci = floor(vCar.x + 0.5);
  vec3 paint = vec3(0.12);
  for (int i = 0; i < 12; i++) if (float(i) == ci) paint = uPalette[i] * 0.6;
  if (ci > 11.5) paint = vec3(0.025);
  vec3 alb = paint;
  vec3 emit = vec3(0.0);
  float spec = 0.0;
  if (part > 0.5 && part < 1.5) { alb = vec3(0.015, 0.018, 0.024); spec = 0.6; }
  // snow: a cap on parked cars, drifted against the sides
  float n = vnoise(vWorld.xz * 3.1) * 0.5 + vnoise(vWorld.xz * 9.0) * 0.5;
  float cap = smoothstep(0.35, 0.8, N.y + n * 0.3) * vCar.y;
  float side = smoothstep(0.55, 0.0, vLocal.y) * vCar.y * 0.8;
  alb = mix(alb, vec3(0.62, 0.65, 0.7), clamp(max(cap, side * (0.6 + 0.4 * n)), 0.0, 1.0));
  if (part > 1.5 && part < 2.5) emit = vec3(1.0, 0.92, 0.8) * 25.0 * vCar.z;
  if (part > 2.5) emit = vec3(1.0, 0.04, 0.02) * 5.0 * (0.25 + 0.75 * vCar.z);
  vec3 light = streetLight(vWorld + N * 0.3, N) + yardLight(vWorld + N * 0.3, N);
  light += uMoonCity * max(dot(N, uMoonDir), 0.0) + uAmbCity;
  vec3 V = normalize(vWorld - cameraPosition);
  vec3 col = alb * light + emit;
  col += spec * vec3(0.25, 0.13, 0.05) * pow(1.0 - max(-dot(V, N), 0.0), 4.0);
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

export function buildProps(TD) {
  const G = TD.cityGround;
  const U = { ...skyUniforms, ...cityUniforms };
  const group = new THREE.Group();
  const rnd = mulberry32(404);

  // ---- parked cars: avenue curbs and the hero yard ----
  const parked = [];
  for (const side of [-1, 1]) {
    for (let x = -3700; x < -3490; ) {
      if (rnd() < 0.28) { x += 6 + rnd() * 8; continue; }
      parked.push({ x, z: ZA + side * 10.6, rot: side < 0 ? 0 : Math.PI, col: Math.floor(rnd() * 13), snow: 0.75 + 0.25 * rnd() });
      x += 5.4 + rnd() * 1.4;
    }
  }
  // yard: a row along the north and south sides, nose-in
  for (const zs of [HERO.blockZ0 + 21, HERO.blockZ1 - 21]) {
    for (let x = HERO.archX1 + 16; x < HERO.yardX1 - 14; x += 2.9 + rnd() * 0.6) {
      if (rnd() < 0.3) continue;
      parked.push({ x, z: zs, rot: Math.PI / 2 + (rnd() - 0.5) * 0.1, col: Math.floor(rnd() * 13), snow: 0.85 + 0.15 * rnd() });
    }
  }
  // moving: eastbound on the right (south) lanes, westbound on the north lanes; lights on
  const moving = [
    { x0: -3700, v: 13, z: ZA + 4.2, rot: 0, col: 12 },
    { x0: -3560, v: 11, z: ZA + 7.6, rot: 0, col: 6 },
    { x0: -3450, v: -14, z: ZA - 4.4, rot: Math.PI, col: 1 },
    { x0: -3600, v: -12, z: ZA - 7.8, rot: Math.PI, col: 10 },
  ];
  const all = parked.length + moving.length;
  const geo = carGeometry();
  const cars = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: CAR_VERT, fragmentShader: GLSL_NOISE + SKY_GLSL + LIGHTS_GLSL + CAR_FRAG }), all);
  const info = new Float32Array(all * 4);
  const M = new THREE.Matrix4();
  parked.forEach((c, i) => {
    M.makeRotationY(c.rot).setPosition(c.x, G, c.z);
    cars.setMatrixAt(i, M);
    info.set([c.col, c.snow, 0, rnd()], i * 4);
  });
  moving.forEach((c, k) => info.set([c.col, 0.12, 1, rnd()], (parked.length + k) * 4));
  geo.setAttribute("aCar", new THREE.InstancedBufferAttribute(info, 4));
  cars.frustumCulled = false;
  cars.renderOrder = -85;
  group.add(cars);

  // headlight and tail-light glows for the moving cars
  const glowN = moving.length * 4;
  const glowGeo = new THREE.InstancedBufferGeometry();
  glowGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const glowPos = new THREE.InstancedBufferAttribute(new Float32Array(glowN * 3), 3);
  const glowCol = new THREE.InstancedBufferAttribute(new Float32Array(glowN * 4), 4);
  glowGeo.setAttribute("aPos", glowPos);
  glowGeo.setAttribute("aCol", glowCol);
  glowGeo.instanceCount = glowN;
  const glow = new THREE.Mesh(glowGeo, new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute vec4 aCol;
      varying vec2 vQ; varying vec4 vCol;
      void main() {
        vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float d = distance(cameraPosition, aPos);
        vec3 wp = aPos + (r * position.x + u * position.y) * aCol.w * (1.0 + d / 300.0);
        vQ = position.xy; vCol = aCol;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vQ; varying vec4 vCol;
      void main() { float r = length(vQ); gl_FragColor = vec4(vCol.rgb * (exp(-r * r * 10.0) * 1.4 + exp(-r * 3.5) * 0.12), 1.0); }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }));
  glow.frustumCulled = false;
  glow.renderOrder = 13;
  group.add(glow);

  // ---- snowbanks along the avenue and the cross street, broken at crossings and driveways ----
  {
    const pos = [], nor = [];
    const SEG = 7;
    const bank = (ax, az, bx, bz, h, w) => {
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      const steps = Math.max(2, Math.round(len / 3));
      for (let s = 0; s < steps; s++) {
        const u0 = s / steps, u1 = (s + 1) / steps;
        const wob = (u) => 1 + 0.18 * Math.sin(u * len * 0.7 + ax) + 0.1 * Math.sin(u * len * 1.9);
        for (let k = 0; k < SEG; k++) {
          const a0 = Math.PI * (k / SEG), a1 = Math.PI * ((k + 1) / SEG);
          const ring = (u, a) => {
            const hh = h * wob(u);
            const x = ax + dx * len * u + nx * Math.cos(a) * w * 0.5;
            const z = az + dz * len * u + nz * Math.cos(a) * w * 0.5;
            const y = G + Math.sin(a) * hh;
            const n = new THREE.Vector3(nx * Math.cos(a) / w, Math.sin(a) / hh, nz * Math.cos(a) / w).normalize();
            return [x, y, z, n];
          };
          const p00 = ring(u0, a0), p01 = ring(u0, a1), p10 = ring(u1, a0), p11 = ring(u1, a1);
          for (const p of [p00, p10, p11, p00, p11, p01]) {
            pos.push(p[0], p[1], p[2]);
            nor.push(p[3].x, p[3].y, p[3].z);
          }
        }
      }
    };
    const runs = [];
    for (const side of [-1, 1]) {
      let x = -3780;
      while (x < HERO.crossX - 26) {
        const L = 14 + rnd() * 26;
        runs.push([x, ZA + side * 12.4, Math.min(x + L, HERO.crossX - 26), ZA + side * 12.4, 0.75 + rnd() * 0.5, 2.0]);
        x += L + 3 + rnd() * 6;
      }
    }
    for (const side of [-1, 1]) {
      for (const [z0, z1] of [[ZA - 120, ZA - 16], [ZA + 16, ZA + 120]]) {
        runs.push([HERO.crossX + side * 11.0, z0, HERO.crossX + side * 11.0, z1, 0.9, 2.2]);
      }
    }
    for (const r of runs) bank(r[0], r[1], r[2], r[3], r[4], r[5]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: /* glsl */ `varying vec3 vWorld; varying vec3 vN; void main() { vWorld = position; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: GLSL_NOISE + SKY_GLSL + LIGHTS_GLSL + /* glsl */ `
        uniform vec3 uMoonCity, uAmbCity;
        varying vec3 vWorld; varying vec3 vN;
        void main() {
          vec3 N = normalize(vN + (vec3(vnoise(vWorld.xz * 2.0), 0.0, vnoise(vWorld.zx * 2.0 + 3.0)) - 0.5) * 0.5);
          float dirt = smoothstep(0.4, 0.0, vWorld.y - uG) * 0.35;
          vec3 alb = mix(vec3(0.64, 0.66, 0.7), vec3(0.3, 0.27, 0.25), dirt);
          vec3 light = streetLight(vWorld + N * 0.2, N) + uMoonCity * max(dot(N, uMoonDir), 0.0) + uAmbCity;
          gl_FragColor = vec4(applyFog(alb * light, vWorld), 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -84;
    group.add(mesh);
  }

  const _m = new THREE.Matrix4();
  return {
    group,
    // place the moving cars and their lights at time t
    update(t) {
      moving.forEach((c, k) => {
        const x = c.x0 + c.v * t;
        _m.makeRotationY(c.rot).setPosition(x, G, c.z);
        cars.setMatrixAt(parked.length + k, _m);
        const fwd = Math.cos(c.rot);
        for (let s = 0; s < 2; s++) {
          const zz = c.z + (s ? 0.63 : -0.63) * (fwd > 0 ? 1 : -1);
          glowPos.setXYZ(k * 4 + s, x + fwd * 2.3, G + 0.72, zz);
          glowCol.setXYZW(k * 4 + s, 1.0 * 5, 0.92 * 5, 0.8 * 5, 0.55);
          glowPos.setXYZ(k * 4 + 2 + s, x - fwd * 2.3, G + 0.75, zz);
          glowCol.setXYZW(k * 4 + 2 + s, 1.0 * 2.2, 0.05, 0.03, 0.3);
        }
      });
      cars.instanceMatrix.needsUpdate = true;
      glowPos.needsUpdate = true;
      glowCol.needsUpdate = true;
    },
  };
}
