// Things that glow, rise or fall: street-lamp poles and halos, light pillars over the lamps (ice crystals
// at −35 °C), the smelter's stacks and their plumes, drifting diamond dust around the camera.
import * as THREE from "three";
import { GLSL_NOISE, mulberry32 } from "./util.js";
import { SKY_GLSL, skyUniforms } from "./sky.js";
import { cityUniforms, LIGHTS_GLSL } from "./city.js";
import { ZA } from "./layout.js";

const SODIUM = new THREE.Color(1.0, 0.52, 0.2);

// the Copper Plant: three stacks east-north-east of the district, plumes leaning east on the wind
export const STACKS = [
  { x: -2480, z: ZA - 340, h: 190, r: 7.5 },
  { x: -2420, z: ZA - 290, h: 165, r: 6.5 },
  { x: -2545, z: ZA - 265, h: 145, r: 6.0 },
];
export const WIND = new THREE.Vector3(0.55, 0, -1).normalize();

function addBox(arr, x0, y0, z0, x1, y1, z1, flag) {
  const P = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
  const N = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]];
  faces.forEach((f, i) => {
    for (const k of [f[0], f[1], f[2], f[0], f[2], f[3]]) arr.push(...P[k], ...N[i], flag);
  });
}

export function buildFx(TD, city) {
  const G = TD.cityGround;
  const group = new THREE.Group();
  const U = { ...skyUniforms, ...cityUniforms };

  // ---------------- lamp poles (instanced) ----------------
  const L = city.lamps;
  {
    const v = [];
    addBox(v, -0.09, 0, -0.09, 0.09, 9.7, 0.09, 0);
    addBox(v, 0, 9.55, -0.05, 1.7, 9.68, 0.05, 0);
    addBox(v, 1.15, 9.32, -0.17, 1.85, 9.55, 0.17, 1);
    const arr = new Float32Array(v);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3, false));
    const pos = [], nor = [], flag = [];
    for (let i = 0; i < arr.length; i += 7) {
      pos.push(arr[i], arr[i + 1], arr[i + 2]);
      nor.push(arr[i + 3], arr[i + 4], arr[i + 5]);
      flag.push(arr[i + 6]);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("aHead", new THREE.Float32BufferAttribute(flag, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: /* glsl */ `
        attribute float aHead;
        varying vec3 vWorld; varying vec3 vN; varying float vHead;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorld = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vHead = aHead;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: GLSL_NOISE + SKY_GLSL + LIGHTS_GLSL + /* glsl */ `
        varying vec3 vWorld; varying vec3 vN; varying float vHead;
        void main() {
          vec3 N = normalize(vN);
          vec3 col = vec3(0.06, 0.06, 0.065) * (streetLight(vWorld + N * 0.4, N) * 0.6 + vec3(0.02, 0.025, 0.04));
          if (vHead > 0.5) col = N.y < -0.5 ? vec3(1.0, 0.55, 0.22) * 60.0 : vec3(0.05);
          gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
        }`,
    });
    const im = new THREE.InstancedMesh(g, m, L.length);
    const M = new THREE.Matrix4();
    L.forEach((l, i) => {
      const ang = Math.atan2(-l.dir[1], l.dir[0]);
      M.makeRotationY(ang).setPosition(l.x, G, l.z);
      im.setMatrixAt(i, M);
    });
    im.frustumCulled = false;
    im.renderOrder = -80;
    group.add(im);
  }

  // heads in world space, for halos and pillars
  const heads = L.map((l) => new THREE.Vector3(l.x + l.dir[0] * 1.5, G + 9.3, l.z + l.dir[1] * 1.5));
  const plantLights = [];
  {
    const rnd = mulberry32(11);
    for (let i = 0; i < 26; i++) {
      const s = STACKS[i % 3];
      plantLights.push(new THREE.Vector3(s.x - 90 + rnd() * 200, G + 6 + rnd() * 28, s.z - 70 + rnd() * 160));
    }
  }

  // ---------------- halos: camera-facing glows around every light head ----------------
  const haloPts = [...heads, ...plantLights];
  {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(new Float32Array(haloPts.flatMap((p) => [p.x, p.y, p.z])), 3));
    g.setAttribute("aSize", new THREE.InstancedBufferAttribute(new Float32Array(haloPts.map((_, i) => (i < heads.length ? 2.6 : 7.0))), 1));
    g.instanceCount = haloPts.length;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...U, uHalo: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute float aSize;
        uniform float uHalo;
        varying vec2 vQ; varying float vFade; varying vec3 vWorld;
        void main() {
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float d = distance(cameraPosition, aPos);
          float s = aSize * (1.0 + d / 400.0);            // stays visible as a point far away
          vec3 wp = aPos + (r * position.x + u * position.y) * s;
          vQ = position.xy; vWorld = aPos;
          vFade = uHalo * smoothstep(1.5, 6.0, d);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: GLSL_NOISE + SKY_GLSL + /* glsl */ `
        varying vec2 vQ; varying float vFade; varying vec3 vWorld;
        void main() {
          float r = length(vQ);
          float g = exp(-r * r * 9.0) * 1.6 + exp(-r * 3.2) * 0.12;
          vec3 col = vec3(1.0, 0.55, 0.22) * g * vFade * 2.2;
          float f = 1.0 - exp(-layerDepth(cameraPosition, vWorld, uFog.x, uFog.y, uFog.z));
          gl_FragColor = vec4(col * (1.0 - f), 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    group.add(mesh);
  }

  // ---------------- light pillars: ice crystals reflect each lamp into a vertical shaft ----------------
  {
    const rnd = mulberry32(5);
    const pts = haloPts.filter((_, i) => i >= heads.length || i % 5 === 0);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(new Float32Array(pts.flatMap((p) => [p.x, p.y + 1.0, p.z])), 3));
    const nLamp = pts.length - plantLights.length;
    g.setAttribute("aH", new THREE.InstancedBufferAttribute(new Float32Array(pts.map((_, i) => (i < nLamp ? 70 + 110 * rnd() : 200 + 140 * rnd()))), 1));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(pts.map(() => rnd())), 1));
    g.instanceCount = pts.length;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...U, uPillar: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute float aH; attribute float aSeed;
        uniform float uPillar;
        varying vec2 vQ; varying float vFade; varying float vSeed; varying vec3 vWorld;
        void main() {
          vec3 toCam = cameraPosition - aPos; toCam.y = 0.0;
          vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          float d = length(toCam);
          float w = 2.2 + d * 0.007;
          vec3 wp = aPos + r * position.x * w + vec3(0.0, position.y * aH, 0.0);
          vQ = position.xy; vSeed = aSeed; vWorld = wp;
          // only seen from a distance: up close the crystals overhead scatter it out of view
          vFade = uPillar * smoothstep(70.0, 260.0, d);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: GLSL_NOISE + SKY_GLSL + /* glsl */ `
        varying vec2 vQ; varying float vFade; varying float vSeed; varying vec3 vWorld;
        void main() {
          float x = vQ.x, y = vQ.y;
          float core = exp(-x * x * 3.0);
          float fall = exp(-y * 2.6) * smoothstep(0.0, 0.03, y);
          float flick = 0.75 + 0.25 * vnoise(vec2(vSeed * 50.0, y * 6.0 + uTime * 0.4));
          vec3 col = vec3(1.0, 0.5, 0.2) * core * fall * flick * vFade * 0.13;
          float f = 1.0 - exp(-layerDepth(cameraPosition, vWorld, uFog.x, uFog.y, uFog.z));
          gl_FragColor = vec4(col * (1.0 - f), 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    group.add(mesh);
  }

  // ---------------- the plant: halls and stacks ----------------
  {
    const v = [];
    const rnd = mulberry32(3);
    for (let i = 0; i < 7; i++) {
      const cx = -2600 + rnd() * 240, cz = ZA - 400 + rnd() * 200;
      const w = 40 + rnd() * 70, d = 25 + rnd() * 40, h = 14 + rnd() * 26;
      addBox(v, cx - w / 2, G, cz - d / 2, cx + w / 2, G + h, cz + d / 2, 2);
    }
    const arr = new Float32Array(v);
    const pos = [], nor = [], flag = [];
    for (let i = 0; i < arr.length; i += 7) {
      pos.push(arr[i], arr[i + 1], arr[i + 2]);
      nor.push(arr[i + 3], arr[i + 4], arr[i + 5]);
      flag.push(arr[i + 6]);
    }
    // stacks: tapered cylinders, red-and-white bands on top
    for (const s of STACKS) {
      const cg = new THREE.CylinderGeometry(s.r * 0.72, s.r, s.h, 20, 1, true);
      cg.translate(s.x, G + s.h / 2, s.z);
      const p = cg.attributes.position.array, n = cg.attributes.normal.array, idx = cg.index.array;
      for (const k of idx) {
        pos.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
        nor.push(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]);
        flag.push(3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(flag, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...U, uPlantCol: { value: SODIUM.clone().multiplyScalar(1.0) } },
      vertexShader: /* glsl */ `
        attribute float aKind;
        varying vec3 vWorld; varying vec3 vN; varying float vKind;
        void main() { vWorld = position; vN = normal; vKind = aKind; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: GLSL_NOISE + SKY_GLSL + /* glsl */ `
        uniform vec3 uPlantCol;
        varying vec3 vWorld; varying vec3 vN; varying float vKind;
        void main() {
          vec3 N = normalize(vN);
          float y = vWorld.y - ${G.toFixed(1)};
          vec3 alb = vec3(0.12, 0.12, 0.13);
          vec3 emit = vec3(0.0);
          if (vKind > 2.5) {
            // stack: concrete, red/white aviation bands near the top
            float top = ${Math.max(...STACKS.map((s) => s.h)).toFixed(1)};
            float band = step(0.5, fract(y / 9.0));
            alb = vec3(0.3, 0.3, 0.31);
            if (y > 95.0) alb = mix(vec3(0.5, 0.06, 0.04), vec3(0.6, 0.6, 0.6), band);
          } else {
            // halls: strip windows, a few lit
            float row = step(0.6, fract(y / 7.0)) * step(fract(y / 7.0), 0.85);
            float cell = floor((vWorld.x + vWorld.z) / 6.0);
            float lit = step(0.55, hash12(vec2(cell, floor(y / 7.0))));
            emit = vec3(1.0, 0.6, 0.3) * row * lit * 1.4 * (1.0 - abs(N.y));
          }
          // floodlit from below, fading upward
          vec3 light = uPlantCol * (0.9 / (1.0 + y * 0.03)) * (0.4 + 0.6 * max(-N.y + 0.5, 0.0));
          light += vec3(0.1, 0.11, 0.15) * max(dot(N, uMoonDir), 0.0) + vec3(0.012, 0.015, 0.025);
          vec3 col = alb * light + emit;
          gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -70;
    group.add(mesh);
  }

  // aviation lights on the stacks (blink at 0.75 Hz, each with its own phase)
  const beacons = [];
  STACKS.forEach((s, i) => {
    beacons.push({ p: new THREE.Vector3(s.x, G + s.h + 1, s.z), ph: i * 0.37 });
    beacons.push({ p: new THREE.Vector3(s.x + s.r * 0.8, G + s.h * 0.6, s.z), ph: i * 0.37 + 0.5 });
  });
  const beaconMat = new THREE.ShaderMaterial({
    uniforms: { uTime: skyUniforms.uTime },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute float aPh;
      uniform float uTime;
      varying vec2 vQ; varying float vOn;
      void main() {
        vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float d = distance(cameraPosition, aPos);
        vec3 wp = aPos + (r * position.x + u * position.y) * (2.0 + d * 0.004);
        vQ = position.xy;
        vOn = step(fract(uTime * 0.75 + aPh), 0.45);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vQ; varying float vOn;
      void main() { float r = length(vQ); gl_FragColor = vec4(vec3(1.0, 0.08, 0.04) * (exp(-r * r * 14.0) * 30.0 + exp(-r * 4.0) * 0.5) * vOn, 1.0); }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(new Float32Array(beacons.flatMap((b) => [b.p.x, b.p.y, b.p.z])), 3));
    g.setAttribute("aPh", new THREE.InstancedBufferAttribute(new Float32Array(beacons.map((b) => b.ph)), 1));
    g.instanceCount = beacons.length;
    const mesh = new THREE.Mesh(g, beaconMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    group.add(mesh);
  }

  // ---------------- plumes: soft puffs streaming off each stack on the wind ----------------
  {
    const N = 70;
    const data = [];
    STACKS.forEach((s, si) => {
      for (let i = 0; i < N; i++) data.push(s.x, G + s.h, s.z, si * 100 + i);
    });
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute("aBase", new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
    g.instanceCount = data.length / 4;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...U, uWind: { value: WIND.clone() }, uPlumeLight: { value: SODIUM.clone().multiplyScalar(0.45) } },
      vertexShader: GLSL_NOISE + /* glsl */ `
        attribute vec4 aBase;
        uniform float uTime;
        uniform vec3 uWind;
        varying vec2 vQ; varying float vAge; varying float vSeed; varying vec3 vWorld; varying float vRise;
        void main() {
          float seed = aBase.w;
          float h = hash12(vec2(seed, 1.7));
          // age along the plume: puffs are born at the stack mouth and travel ~1.6 km downwind
          float age = fract(h + uTime * 0.012);
          float L = 900.0;
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), uWind));
          float rise = 60.0 * (1.0 - exp(-age * 9.0)) + age * 40.0;
          vec3 c = aBase.xyz + uWind * (age * L + 12.0) + vec3(0.0, rise, 0.0);
          c += side * (hash12(vec2(seed, 5.1)) - 0.5) * (8.0 + age * 160.0);
          c.y += (hash12(vec2(seed, 9.3)) - 0.5) * (6.0 + age * 70.0);
          float size = 9.0 + age * 85.0;
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = c + (r * position.x + u * position.y) * size;
          vQ = position.xy; vAge = age; vSeed = seed; vWorld = c; vRise = rise;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: GLSL_NOISE + SKY_GLSL + /* glsl */ `
        uniform vec3 uPlumeLight;
        varying vec2 vQ; varying float vAge; varying float vSeed; varying vec3 vWorld; varying float vRise;
        void main() {
          float r = length(vQ);
          if (r > 1.0) discard;
          vec2 q = vQ * 1.6 + vec2(vSeed * 3.1, vSeed * 1.7);
          float n = fbm3(q + uTime * 0.05);
          float dens = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7);
          dens *= smoothstep(0.0, 0.02, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
          // lit from below by the plant's sodium floodlights near the stacks, by the moon everywhere
          float low = exp(-vRise / 45.0) * (1.0 - vAge);
          vec3 light = uPlumeLight * (0.08 + 1.4 * low) * (0.6 - 0.4 * vQ.y) + vec3(0.15, 0.17, 0.23) * (0.65 + 0.35 * vQ.y);
          vec3 col = vec3(0.7) * light;
          float a = dens * 0.3;
          col = applyFog(col, vWorld);
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    group.add(mesh);
  }

  // ---------------- diamond dust: crystals drifting around the camera, streaked by its motion ----------------
  const dustU = { uVP0: { value: new THREE.Matrix4() }, uVP1: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1920, 1080) }, uDust: { value: 1 } };
  {
    const N = 3500;
    const rnd = mulberry32(21);
    const seeds = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) seeds.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = N;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...U, ...dustU },
      vertexShader: GLSL_NOISE + LIGHTS_GLSL + /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime, uDust;
        uniform mat4 uVP0, uVP1;
        uniform vec2 uRes;
        varying float vB; varying vec2 vQ;
        const float BOX = 46.0;
        void main() {
          // wrap the field around the camera so it is always full; drift down and with the wind
          vec3 p0 = aSeed.xyz * BOX + vec3(uTime * 1.2, -uTime * 0.35, uTime * 0.3);
          vec3 p = cameraPosition + mod(p0 - cameraPosition, BOX) - BOX * 0.5;
          vec4 c0 = uVP0 * vec4(p, 1.0), c1 = uVP1 * vec4(p, 1.0);
          vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0);
          float d = length(p - cameraPosition);
          // streak from shutter-open to shutter-close position, 1.6 px wide
          vec2 s0 = c0.xy / c0.w, s1 = c1.xy / c1.w;
          vec2 dir = (s1 - s0) * uRes;
          float len = length(dir);
          vec2 tdir = len > 0.5 ? dir / len : vec2(1.0, 0.0);
          vec2 nrm = vec2(-tdir.y, tdir.x);
          float sz = clamp(0.03 / max(d, 0.5) * uRes.y * 1.2, 0.8, 3.0);
          vec2 sNow = mix(s0, s1, position.x);
          if (len < 1.0) sNow = c.xy / c.w + tdir * (position.x - 0.5) * sz * 2.0 / uRes;
          vec2 off = nrm * position.y * sz / uRes;
          gl_Position = vec4((sNow + off) * c.w, c.z, c.w);
          if (c0.w < 0.1 || c1.w < 0.1) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
          // brightness: sodium light where the lamps are, a cold glint elsewhere; dimmer when smeared
          float glint = pow(hash12(vec2(aSeed.w * 97.0, floor(uTime * 8.0 + aSeed.w * 13.0))), 6.0);
          float lampLit = lampAir(p) * 140.0;
          vB = uDust * (0.04 + lampLit * 0.5 + glint * 1.2) * smoothstep(0.4, 2.0, d) * (1.0 - smoothstep(14.0, 23.0, d)) / (1.0 + len * 0.08);
          vQ = position.xy;
        }`,
      fragmentShader: /* glsl */ `
        varying float vB; varying vec2 vQ;
        void main() {
          float a = 1.0 - abs(vQ.y);
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.46) * vB * a, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    group.add(mesh);
  }

  return {
    group,
    heads,
    dustU,
    // per sub-frame: the shutter's camera matrices (for streaks)
    setShutter(vp0, vp1) {
      dustU.uVP0.value.copy(vp0);
      dustU.uVP1.value.copy(vp1);
    },
  };
}
