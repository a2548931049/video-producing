// American white pelican, breeding plumage, built procedurally.
// Pelican-local frame: origin = saddle-top contact, +X forward, +Y up, +Z right.
import * as THREE from "three";
import { surfaceNets, ellipsoid, roundCone, smin } from "./sdf.js";
import { sweep, tube, curvePts, merge, rod, place, ellipsoid as ellGeo } from "./geo.js";
import { patch, tag } from "./materials.js";
import { rng, clamp, lerp, smoothstep, noise1, TAU, easeOutBack, lin } from "./util.js";
import * as T from "./textures.js";

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ anatomy numbers
export const PEL = {
  neck: [V(0.25, 0.25), V(0.345, 0.33), V(0.318, 0.425), V(0.268, 0.5), V(0.288, 0.578), V(0.338, 0.628)],
  neckR: [0.07, 0.05, 0.041, 0.037, 0.036, 0.038],
  head: V(0.35, 0.645),
  billBase: V(0.4, 0.635),
  billDir: V(1, -0.27).normalize(),
  billLen: 0.36,
  eye: V(0.376, 0.655, 0.0405),
  shoulder: V(0.27, 0.255, 0.115),
  knee: V(0.1, -0.06, 0.102),
  L1: 0.33,
  L2: 0.29,
  humerus: 0.28,
  forearm: 0.32,
  hand: 0.23,
};
const NECK_W = [0.0, 0.12, 0.38, 0.68, 0.9]; // how much each neck bone follows the head

const FEATHER_RELIEF_GLSL = /* glsl */ `
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// soft plumage relief: fine streaks running down the feather tracts, broken into short
// overlapping strands, plus faint shingle bands. Low contrast — reads as feathers, not scales.
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i).x, n100 = hash3(i + vec3(1, 0, 0)).x, n010 = hash3(i + vec3(0, 1, 0)).x, n110 = hash3(i + vec3(1, 1, 0)).x;
  float n001 = hash3(i + vec3(0, 0, 1)).x, n101 = hash3(i + vec3(1, 0, 1)).x, n011 = hash3(i + vec3(0, 1, 1)).x, n111 = hash3(i + vec3(1, 1, 1)).x;
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float featherRelief(vec3 p) {
  // strands: high frequency across (x,z), low along y
  float strands = vn3(p * vec3(520.0, 55.0, 520.0)) * 0.6 + vn3(p * vec3(1100.0, 120.0, 1100.0)) * 0.4;
  // shingles: soft bands where one row of feathers overlaps the next
  float sh = fract(p.y * 70.0 + vn3(p * vec3(60.0, 10.0, 60.0)) * 1.6);
  float shingle = smoothstep(0.0, 0.85, sh) * (1.0 - smoothstep(0.85, 1.0, sh));
  return strands * 0.65 + shingle * 0.35;
}
vec3 perturbBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = dFdx(surf_pos);
  vec3 vSigmaY = dFdy(surf_pos);
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  if (abs(fDet) < 1e-14) return surf_norm;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  vec3 n = abs(fDet) * surf_norm - vGrad;
  float l = length(n);
  return l > 1e-14 ? n / l : surf_norm;
}
`;

// ------------------------------------------------------------------ SDF body
function bodySDF() {
  const trunk = ellipsoid([0.05, 0.14, 0], [0.27, 0.138, 0.158], 0.2);
  const breast = ellipsoid([0.225, 0.175, 0], [0.13, 0.128, 0.128], 0.55);
  const rump = ellipsoid([-0.165, 0.105, 0], [0.13, 0.078, 0.11], 0.22);
  const belly = ellipsoid([0.05, 0.045, 0], [0.21, 0.08, 0.148], 0.08);
  const back = ellipsoid([0.0, 0.2, 0], [0.22, 0.07, 0.13], 0.12);
  const neckSegs = [];
  const N = PEL.neck;
  for (let i = 0; i < N.length - 1; i++) {
    neckSegs.push(roundCone(N[i].toArray(), N[i + 1].toArray(), PEL.neckR[i], PEL.neckR[i + 1]));
  }
  const H = PEL.head;
  const head = ellipsoid([H.x, H.y, 0], [0.062, 0.05, 0.044], -0.18);
  const crown = ellipsoid([H.x - 0.012, H.y + 0.02, 0], [0.045, 0.03, 0.036], -0.15);
  const lore = roundCone([H.x + 0.02, H.y - 0.002, 0], [PEL.billBase.x + 0.014, PEL.billBase.y - 0.002, 0], 0.036, 0.022);
  return (x, y, z) => {
    let b = smin(trunk(x, y, z), breast(x, y, z), 0.07);
    b = smin(b, rump(x, y, z), 0.06);
    b = smin(b, belly(x, y, z), 0.06);
    b = smin(b, back(x, y, z), 0.05);
    let n = neckSegs[0](x, y, z);
    for (let i = 1; i < neckSegs.length; i++) n = smin(n, neckSegs[i](x, y, z), 0.03);
    let h = smin(head(x, y, z), crown(x, y, z), 0.02);
    h = smin(h, lore(x, y, z), 0.022);
    let d = smin(b, n, 0.06);
    d = smin(d, h, 0.03);
    return d;
  };
}
function distSeg(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / ab.lengthSq());
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

// bones: 0 trunk, 1..5 neck, 6 head
function boneSegments() {
  const N = PEL.neck;
  const segs = [{ a: V(-0.2, 0.1), b: V(0.24, 0.17), r: 0.12 }];
  for (let i = 0; i < 5; i++) segs.push({ a: N[i], b: N[i + 1], r: PEL.neckR[i] * 0.8 });
  segs.push({ a: V(PEL.head.x - 0.03, PEL.head.y), b: V(PEL.billBase.x + 0.01, PEL.billBase.y), r: 0.036 });
  return segs;
}

// plumage colour field (vertex colours on the skin)
function skinColor(p, out) {
  const white = [0.93, 0.92, 0.89];
  let c = white.slice();
  const mix = (col, k) => { for (let i = 0; i < 3; i++) c[i] = lerp(c[i], col[i], k); };
  // pale yellow breast patch (breeding)
  const db = p.distanceTo(V(0.315, 0.235, 0));
  mix([0.95, 0.86, 0.6], (1 - smoothstep(0.03, 0.11, db)) * 0.75);
  // nape / crest wash
  const H = PEL.head;
  if (p.y > H.y - 0.02) mix([0.95, 0.88, 0.62], smoothstep(H.x - 0.025, H.x - 0.06, p.x) * smoothstep(H.y - 0.02, H.y + 0.03, p.y) * 0.8);
  // bare orange facial skin: around the eye and the lores
  const az = Math.abs(p.z);
  const eye = V(PEL.eye.x, PEL.eye.y, Math.sign(p.z || 1) * PEL.eye.z);
  const de = p.distanceTo(eye);
  let face = 1 - smoothstep(0.012, 0.022, de);
  const loreY = lerp(PEL.eye.y - 0.004, PEL.billBase.y + 0.004, clamp((p.x - PEL.eye.x) / (PEL.billBase.x - PEL.eye.x)));
  const lore = smoothstep(PEL.eye.x - 0.006, PEL.eye.x + 0.01, p.x) * (1 - smoothstep(0.011, 0.02, Math.abs(p.y - loreY))) * smoothstep(0.012, 0.022, az);
  face = Math.max(face, lore);
  mix([0.96, 0.58, 0.2], face);
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return face;
}

// ------------------------------------------------------------------ feather geometry
function featherGeo(camber = 0.08, cup = 0.08, segsX = 6, segsZ = 2) {
  const g = new THREE.PlaneGeometry(1, 1, segsX, segsZ);
  // plane is in XY; move to X (shaft) / Z (width), base at x=0
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 0.5, w = pos.getY(i);
    pos.setXYZ(i, x, -camber * x * x - cup * w * w * 2, w);
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ build
export function buildPelican(M, opts = {}) {
  const root = new THREE.Group();
  root.name = "pelican";
  const R = rng(1234);

  // ---- materials
  const PM = {};
  PM.skin = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.82, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5 }), { translucency: 0.35, transColor: 0xffe2b8 });
  {
    const prevSkin = PM.skin.onBeforeCompile;
    PM.skin.onBeforeCompile = (sh, r) => {
      prevSkin(sh, r);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRest;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = position;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRest;\n" + FEATHER_RELIEF_GLSL)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          float k = 1.0 - smoothstep(0.6, 3.5, vViewDepth);
          if (k > 0.0) {
            float h = featherRelief(vRest);
            vec2 dH = clamp(vec2(dFdx(h), dFdy(h)), -0.5, 0.5) * 0.00045 * k;
            normal = perturbBump(-vViewPosition, normal, dH, faceDirection);
          }
        }`);
    };
    PM.skin.customProgramCacheKey = () => "pel-skin-relief";
  }
  const tex = {
    contour: T.featherTextures("contour", 256, 128, 3),
    covert: T.featherTextures("covert", 256, 96, 5),
    flight: T.featherTextures("flight", 512, 96, 7),
    crest: T.featherTextures("crest", 256, 48, 9),
  };
  const featherMat = (t, trans = 0.55) => {
    const m = new THREE.MeshPhysicalMaterial({
      map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.6, 0.6), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.78, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff),
    });
    m.alphaToCoverage = true;
    return patch(m, { translucency: trans, transColor: 0xffe0b0 });
  };
  PM.fContour = featherMat(tex.contour);
  PM.fCovert = featherMat(tex.covert);
  PM.fFlight = featherMat(tex.flight, 0.7);
  PM.fCrest = featherMat(tex.crest, 0.8);
  PM.bill = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.2 }), { translucency: 0.45, transColor: 0xffa040 });
  PM.nail = patch(new THREE.MeshPhysicalMaterial({ color: 0xd8522a, roughness: 0.3, clearcoat: 0.7 }));
  PM.pouch = patch(new THREE.MeshPhysicalMaterial({ color: 0xf2a452, normalMap: T.normalFromHeight(256, 256, (u, v) => 0.5 + 0.5 * Math.sin(u * TAU * 22 + Math.sin(v * TAU * 3) * 1.5) * (0.6 + 0.4 * Math.sin(v * TAU * 9 + u * 5)), 2.5), normalScale: new THREE.Vector2(0.28, 0.28), roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4, side: THREE.DoubleSide, sheen: 0.3, sheenColor: new THREE.Color(0xffd0a0) }), { translucency: 0.6, transColor: 0xffa848 });
  PM.leg = patch(new THREE.MeshPhysicalMaterial({ color: 0xf08a2c, roughness: 0.5, normalMap: T.scaleNormal(), normalScale: new THREE.Vector2(0.7, 0.7), clearcoat: 0.25 }), { translucency: 0.4, transColor: 0xff8a40 });
  PM.web = patch(new THREE.MeshPhysicalMaterial({ color: 0xf28a30, roughness: 0.5, side: THREE.DoubleSide }), { translucency: 1.0, transColor: 0xff7a30 });
  PM.claw = patch(new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.35 }));
  PM.faceSkin = patch(new THREE.MeshPhysicalMaterial({ color: 0xf4a040, roughness: 0.45, clearcoat: 0.4 }), { translucency: 0.4 });
  PM.nictit = patch(new THREE.MeshPhysicalMaterial({ color: 0xdfe6ea, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  PM.cornea = patch(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.0, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.12, depthWrite: false }));
  PM.white = patch(new THREE.MeshPhysicalMaterial({ color: 0xf2efe8, roughness: 0.85, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) }), { translucency: 0.35, transColor: 0xffe2b8 });
  {
    // iris: pale cream with radial fibres, black pupil; uv centred on +Z pole
    const S = 256, c = T.canvas(S, S), g = c.getContext("2d");
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x / S) * 2 - 1, v = (y / S) * 2 - 1;
      const r = Math.hypot(u, v), a = Math.atan2(v, u);
      let col;
      if (r < 0.3) col = [12, 10, 10];
      else if (r < 0.62) {
        const f = 0.85 + 0.15 * Math.sin(a * 60 + Math.sin(a * 7) * 3) * (1 - (r - 0.3) / 0.32);
        const ring = r > 0.55 ? 0.75 : 1;
        col = [232 * f * ring, 222 * f * ring, 190 * f * ring];
      } else col = [40, 30, 26];
      const i = (y * S + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    PM.iris = patch(new THREE.MeshPhysicalMaterial({ map: T.canvasTex(c, true, false), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02 }));
  }
  const allMats = PM;

  // ---- skin mesh (SDF), skinned to a flat bone list
  const sdf = bodySDF();
  const geo = surfaceNets(sdf, [-0.36, -0.08, -0.19], [0.47, 0.75, 0.19], opts.res ?? 0.0042);
  const pos = geo.attributes.position;
  const nV = pos.count;
  const segs = boneSegments();
  const skinIdx = new Uint16Array(nV * 4), skinW = new Float32Array(nV * 4);
  const colors = new Float32Array(nV * 3);
  const p = new THREE.Vector3();
  const cc = [0, 0, 0];
  for (let i = 0; i < nV; i++) {
    p.fromBufferAttribute(pos, i);
    const ws = segs.map((s, b) => {
      const d = Math.max(0, distSeg(p, s.a, s.b) - s.r);
      return [b, 1 / Math.pow(d + 0.012, 4)];
    }).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((s, w) => s + w[1], 0);
    for (let k = 0; k < 4; k++) { skinIdx[i * 4 + k] = ws[k][0]; skinW[i * 4 + k] = ws[k][1] / sum; }
    skinColor(p, cc);
    colors[i * 3] = lin(cc[0]); colors[i * 3 + 1] = lin(cc[1]); colors[i * 3 + 2] = lin(cc[2]);
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIdx, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinW, 4));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(nV * 2), 2));
  tag(geo, 20, new THREE.Vector3(0.3, 1, 0)); // revealed bottom → top
  const bonePos = [V(0, 0.15), ...PEL.neck.slice(0, 5), PEL.head.clone()];
  const bones = bonePos.map((bp) => {
    const b = new THREE.Bone();
    b.position.copy(bp);
    return b;
  });
  const skel = new THREE.Skeleton(bones);
  const body = new THREE.SkinnedMesh(geo, PM.skin);
  bones.forEach((b) => body.add(b));
  body.updateMatrixWorld(true);
  body.bind(skel);
  body.castShadow = body.receiveShadow = true;
  body.frustumCulled = false;
  root.add(body);

  // ---- head group: bill, pouch, eyes, crest
  const headGroup = new THREE.Group();
  root.add(headGroup);
  const billInfo = buildBill(headGroup, PM);
  const pouch = buildPouch(headGroup, PM, billInfo);
  const eyes = buildEyes(headGroup, PM, sdf);

  // ---- feathers sampled on the skin
  const feathers = sampleFeathers(geo, segs, R);
  const fGeo = featherGeo(0.04, 0.05);
  const bodyF = new THREE.InstancedMesh(fGeo, PM.fContour, feathers.length);
  bodyF.castShadow = bodyF.receiveShadow = true;
  bodyF.frustumCulled = false;
  const col = new THREE.Color();
  feathers.forEach((f, i) => {
    col.setRGB(f.color[0], f.color[1], f.color[2], THREE.SRGBColorSpace);
    bodyF.setColorAt(i, col);
  });
  root.add(bodyF);

  // crest: filament feathers on the nape, bound to the head
  const crest = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 23 - 0.5) * 1.4;
    const row = i % 2;
    crest.push({
      base: V(PEL.head.x - 0.042 - row * 0.012 + 0.008 * Math.cos(a * 2), PEL.head.y + 0.03 - row * 0.012, Math.sin(a) * 0.024),
      dir: V(-1, -0.6 + 0.08 * R() - row * 0.1, Math.sin(a) * 0.2).normalize(),
      len: 0.02 + 0.012 * R(),
      phase: R() * 10,
    });
  }
  const crestMesh = new THREE.InstancedMesh(featherGeo(0.05, 0.05), PM.fContour, crest.length);
  crest.forEach((c, i) => crestMesh.setColorAt(i, col.setRGB(0.99, 0.95, 0.8, THREE.SRGBColorSpace)));
  crestMesh.castShadow = true;
  crestMesh.frustumCulled = false;
  root.add(crestMesh);

  // ---- tail (bound to trunk)
  const tail = [];
  for (let i = 0; i < 16; i++) {
    const k = i / 15 - 0.5;
    tail.push({ base: V(-0.27, 0.115 + 0.01 * Math.cos(k * 3), k * 0.09), dir: V(-0.97, -0.1, k * 0.6).normalize(), len: 0.17 - Math.abs(k) * 0.05, up: V(0.1, 1, 0).normalize(), w: 0.05, phase: R() * 10 });
  }
  for (let i = 0; i < 12; i++) {
    const k = i / 11 - 0.5;
    tail.push({ base: V(-0.24, 0.14, k * 0.085), dir: V(-0.97, -0.08, k * 0.5).normalize(), len: 0.11, up: V(0.1, 1, 0).normalize(), w: 0.045, phase: R() * 10, offset: 0.006 });
  }

  // ---- wings
  const wings = [buildWing(1, PM, R), buildWing(-1, PM, R)];
  wings.forEach((w) => root.add(w.group));
  const tailMesh = new THREE.InstancedMesh(featherGeo(0.06, 0.06), PM.fFlight, tail.length);
  tail.forEach((t, i) => tailMesh.setColorAt(i, col.setRGB(0.97, 0.96, 0.93, THREE.SRGBColorSpace)));
  tailMesh.castShadow = tailMesh.receiveShadow = true;
  tailMesh.frustumCulled = false;
  root.add(tailMesh);

  // ---- legs
  const legs = [buildLeg(1, PM), buildLeg(-1, PM)];
  legs.forEach((l) => root.add(l.group));

  // ------------------------------------------------------------------ per-frame
  const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
  const qI = new THREE.Quaternion();
  const boneQ = bones.map(() => new THREE.Quaternion());
  const boneP = bones.map(() => new THREE.Vector3());
  const boneMat = bones.map(() => new THREE.Matrix4());
  const blendM = new THREE.Matrix4();
  const headDelta = new THREE.Matrix4();

  function update(st) {
    const t = st.t ?? 0;
    const wind = st.wind ?? 0.5;
    // head delta: rotate about the head centre, then translate
    const hq = new THREE.Quaternion().setFromEuler(new THREE.Euler(st.headRoll ?? 0, st.headYaw ?? 0, st.headPitch ?? 0, "YZX"));
    const pivot = PEL.head;
    const hoff = st.headOffset ?? V();
    headDelta.compose(V().copy(pivot).sub(pivot.clone().applyQuaternion(hq)).add(hoff), hq, V(1, 1, 1));
    headGroup.matrixAutoUpdate = false;
    headGroup.matrix.copy(headDelta);
    // bones
    bones.forEach((b, i) => {
      const w = i === 0 ? 0 : i === 6 ? 1 : NECK_W[i - 1];
      tmpQ.slerpQuaternions(qI, hq, w);
      const rest = bonePos[i];
      const moved = rest.clone().applyMatrix4(headDelta);
      b.position.copy(rest).lerp(moved, w);
      b.quaternion.copy(tmpQ);
      boneQ[i].copy(tmpQ);
      boneP[i].copy(b.position);
    });
    body.updateMatrixWorld(true);
    for (let i = 0; i < bones.length; i++) {
      // bone delta in pelican-local: T(p') R(q) T(-rest)
      boneMat[i].compose(boneP[i], boneQ[i], V(1, 1, 1)).multiply(tmpM.makeTranslation(-bonePos[i].x, -bonePos[i].y, -bonePos[i].z));
    }
    // body feathers
    const grow = st.featherGrow ?? 1;
    for (let i = 0; i < feathers.length; i++) {
      const f = feathers[i];
      const g = clamp((grow - f.seq) / 0.06);
      const s = g <= 0 ? 0 : easeOutBack(g, 1.4);
      const flutter = (noise1(t * (6 + f.phase % 3) + f.phase * 13) * 0.5 + 0.5) * wind * f.exposed;
      tmpQ.setFromAxisAngle(f.axis, f.lift + flutter * 0.35);
      tmpQ.premultiply(f.q);
      tmpS.set(f.len * s, 1 * s, f.wid * s);
      tmpM.compose(f.p, tmpQ, tmpS);
      blendM.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < f.w.length; k++) {
        const e = boneMat[f.w[k][0]].elements, be = blendM.elements, wk = f.w[k][1];
        for (let m = 0; m < 16; m++) be[m] += e[m] * wk;
      }
      tmpM.premultiply(blendM);
      bodyF.setMatrixAt(i, tmpM);
    }
    bodyF.instanceMatrix.needsUpdate = true;
    bodyF.visible = grow > 0.001;
    crestMesh.visible = grow > 0.951;
    tailMesh.visible = grow > 0.021;
    // crest
    for (let i = 0; i < crest.length; i++) {
      const c = crest[i];
      const g = clamp((grow - 0.95) / 0.05);
      const sway = noise1(t * 5 + c.phase) * 0.35 * wind;
      const d = c.dir.clone().applyAxisAngle(V(0, 1, 0), sway * 0.4).applyAxisAngle(V(0, 0, 1), 0.08 + 0.18 * wind + noise1(t * 7 + c.phase * 3) * 0.1 * wind);
      tmpQ.setFromUnitVectors(V(1, 0, 0), d);
      tmpM.compose(c.base, tmpQ, V(c.len * g, 1, c.len * 0.55 * g));
      tmpM.premultiply(headDelta);
      crestMesh.setMatrixAt(i, tmpM);
    }
    crestMesh.instanceMatrix.needsUpdate = true;
    // tail
    for (let i = 0; i < tail.length; i++) {
      const f = tail[i];
      const g = clamp((grow - 0.02 - i * 0.002) / 0.05);
      const flap = noise1(t * 4 + f.phase) * 0.08 * wind + (st.tailLift ?? 0);
      const d = f.dir.clone().applyAxisAngle(V(0, 0, 1), flap);
      const m = new THREE.Matrix4().makeBasis(d, f.up.clone().sub(d.clone().multiplyScalar(f.up.dot(d))).normalize(), new THREE.Vector3().crossVectors(d, f.up).normalize());
      tmpQ.setFromRotationMatrix(m);
      tmpM.compose(f.base.clone().add(V(0, f.offset ?? 0, 0)), tmpQ, V(f.len * g, 1, f.w * g));
      tailMesh.setMatrixAt(i, tmpM);
    }
    tailMesh.instanceMatrix.needsUpdate = true;
    // pouch jiggle, eyes
    pouch.update(st);
    eyes.update(st);
    // wings and legs
    for (let s = 0; s < 2; s++) {
      wings[s].update(st, s === 0 ? st.hoodR : st.hoodL, grow);
      legs[s].update(st, s === 0 ? st.footR : st.footL);
    }
  }

  // reveal tags for build animation
  const info = {
    feathers: feathers.length + crest.length + tail.length + wings[0].count + wings[1].count,
    bodyFeathers: feathers.length,
  };
  const headWorld = (out = V()) => out.copy(PEL.head).applyMatrix4(headGroup.matrixWorld);
  const eyeWorld = (i = 0, out = V()) => out.copy(eyes.centers[i]).applyMatrix4(headGroup.matrixWorld);
  return { root, update, info, headGroup, bones, materials: allMats, headDelta, headWorld, eyeWorld };
}

function skinWeights(p, segs) {
  const ws = segs.map((s, b) => [b, 1 / Math.pow(Math.max(0, distSeg(p, s.a, s.b) - s.r) + 0.012, 4)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = ws.reduce((s, w) => s + w[1], 0);
  return ws.map((w) => [w[0], w[1] / sum]);
}

// ------------------------------------------------------------------ feather sampling
function sampleFeathers(geo, segs, R) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index.array;
  const tris = [];
  let total = 0;
  const a = V(), b = V(), c = V();
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
    const area = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() * 0.5;
    total += area;
    tris.push(total);
  }
  const out = [];
  const grid = new Map();
  const key = (p, h) => `${Math.floor(p.x / h)},${Math.floor(p.y / h)},${Math.floor(p.z / h)}`;
  const H = 0.03;
  const N = PEL.neck;
  const tries = 26000;
  for (let k = 0; k < tries; k++) {
    const r = R() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m] < r) lo = m + 1; else hi = m; }
    const t = lo * 3;
    let u = R(), v = R();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
    const p = a.clone().multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
    const n = V().fromBufferAttribute(nrm, idx[t]).multiplyScalar(1 - u - v)
      .addScaledVector(V().fromBufferAttribute(nrm, idx[t + 1]), u)
      .addScaledVector(V().fromBufferAttribute(nrm, idx[t + 2]), v).normalize();
    // region → nearest bone
    let best = 0, bd = Infinity;
    segs.forEach((s, bi) => { const d = distSeg(p, s.a, s.b) - s.r; if (d < bd) { bd = d; best = bi; } });
    // no feathers on bare facial skin / bill base / the saddle contact
    const face = skinColor(p, [0, 0, 0]);
    if (face > 0.2) continue;
    if (p.x > PEL.billBase.x - 0.012 && p.y > PEL.head.y - 0.06) continue;
    if (p.y < -0.02 && Math.abs(p.z) < 0.05) continue;
    if (best >= 3) continue;
    let size, spacing, flow;
    if (best === 0) {
      size = 0.06 + 0.02 * R();
      spacing = 0.024;
      flow = V(-0.97, -0.2, 0);
      // breast feathers flow down
      if (p.x > 0.2) flow = V(-0.35, -1, 0);
      flow.z += p.z * 1.2;
    } else if (best < 6) {
      size = lerp(0.04, 0.022, (best - 1) / 4);
      spacing = lerp(0.016, 0.011, (best - 1) / 4);
      flow = N[best - 1].clone().sub(N[best]).normalize();
    } else {
      size = 0.016;
      spacing = 0.0085;
      flow = V(-1, -0.15, 0);
    }
    // project flow to tangent plane
    flow.addScaledVector(n, -flow.dot(n));
    if (flow.lengthSq() < 1e-6) continue;
    flow.normalize();
    // poisson rejection
    const kk = key(p, H);
    let ok = true;
    const [gx, gy, gz] = kk.split(",").map(Number);
    for (let dx = -1; dx <= 1 && ok; dx++) for (let dy = -1; dy <= 1 && ok; dy++) for (let dz = -1; dz <= 1 && ok; dz++) {
      const cell = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
      if (!cell) continue;
      for (const q of cell) if (q.p.distanceTo(p) < Math.min(spacing, q.spacing)) { ok = false; break; }
    }
    if (!ok) continue;
    const side = new THREE.Vector3().crossVectors(n, flow).normalize(); // width axis
    const m = new THREE.Matrix4().makeBasis(flow, n, new THREE.Vector3().crossVectors(flow, n).normalize());
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const tint = 0.97 + R() * 0.03;
    let color = [tint, tint * 0.995, tint * 0.975];
    const sc = [0, 0, 0];
    skinColor(p, sc);
    color = [color[0] * sc[0] / 0.93, color[1] * sc[1] / 0.92, color[2] * sc[2] / 0.89];
    const f = {
      p: p.clone().addScaledVector(n, 0.0015), q, axis: V(0, 0, 1), lift: (best === 0 ? 0.2 : 0.07) + R() * (best === 0 ? 0.12 : 0.06),
      len: size, wid: size * (best === 0 ? 0.62 : 0.7), bone: best, spacing, w: skinWeights(p, segs),
      seq: clamp((p.y + 0.06) / 0.8) * 0.85 + R() * 0.1,
      phase: R() * 100, exposed: best === 0 ? (n.y > 0.2 ? 0.5 : 0.25) : 0.8, color,
    };
    void side;
    out.push(f);
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk).push(f);
  }
  // draw order: tail-side first so overlapping looks like shingles
  out.sort((x, y) => x.seq - y.seq);
  return out;
}

// ------------------------------------------------------------------ bill
function buildBill(group, PM) {
  const base = PEL.billBase, d = PEL.billDir, L = PEL.billLen;
  const up = V(-d.y, d.x); // perpendicular in XY, pointing up
  const n = 70;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = base.clone().addScaledVector(d, u * L);
    const hook = u > 0.88 ? Math.pow((u - 0.88) / 0.12, 2) * 0.024 : 0;
    p.addScaledVector(up, -hook - 0.006 * Math.sin(u * Math.PI));
    pts.push(p);
  }
  const width = (u) => lerp(0.026, 0.016, smoothstep(0, 0.85, u)) * Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.max(0, u - 0.9) / 0.1, 2)));
  const thick = (u) => lerp(0.02, 0.0085, smoothstep(0, 0.6, u)) * (u > 0.9 ? 1 + (u - 0.9) * 6 : 1);
  const upper = sweep(pts, (s, a) => {
    const w = width(s), th = thick(s);
    if (a < 0.5) {
      const z = (a / 0.5) * 2 - 1; // -1..1 over the top
      const ridge = 0.86 + 0.14 * Math.pow(1 - Math.abs(z), 0.8);
      const edge = Math.pow(1 - Math.pow(Math.abs(z), 6), 0.5);
      return [th * ridge * edge, z * w];
    }
    const z = ((a - 0.5) / 0.5) * 2 - 1;
    return [-0.0025 * (1 - z * z), -z * w];
  }, { radial: 36, up: V(0, 1, 0), caps: true });
  billColors(upper, (u, around) => {
    const top = around < 0.5 ? Math.sin((around / 0.5) * Math.PI) : 0;
    const side = 1 - top;
    let c = [0.98, 0.7, 0.22]; // yellow-orange culmen
    c = c.map((x, i) => lerp(x, [0.96, 0.56, 0.3][i], side * 0.5)); // pink-orange sides
    const nail = smoothstep(0.9, 0.95, u);
    return c.map((x, i) => lerp(x, [0.84, 0.3, 0.16][i], nail));
  });
  const m1 = new THREE.Mesh(tag(upper, 22, "v"), PM.bill);
  m1.castShadow = m1.receiveShadow = true;
  group.add(m1);
  // breeding horn on the culmen
  const hs = new THREE.Shape();
  hs.moveTo(0, 0);
  hs.lineTo(0.006, 0.02);
  hs.quadraticCurveTo(0.01, 0.027, 0.02, 0.026);
  hs.lineTo(0.033, 0.023);
  hs.quadraticCurveTo(0.038, 0.012, 0.042, 0);
  hs.closePath();
  const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.0032, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 12 });
  hg.translate(0, 0, -0.0016);
  const hu = 0.56;
  const hp = base.clone().addScaledVector(d, hu * L).addScaledVector(up, thick(hu) * 0.92 - 0.006 * Math.sin(hu * Math.PI));
  const hq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(d, up, V(0, 0, 1)));
  place(hg, hp, hq);
  billColors(hg, () => [0.97, 0.68, 0.26]);
  const m3 = new THREE.Mesh(tag(hg, 22, 1), PM.bill);
  m3.castShadow = true;
  group.add(m3);
  // lower mandible rami
  const rami = [];
  for (const sz of [-1, 1]) {
    const rp = [];
    for (let i = 0; i <= 40; i++) {
      const u = 0.0 + (i / 40) * 0.97;
      const p = base.clone().addScaledVector(d, u * L - 0.01).addScaledVector(up, -0.006 - 0.006 * Math.sin(u * Math.PI));
      p.z = sz * width(u) * (u > 0.85 ? 1 - (u - 0.85) / 0.15 * 0.85 : 0.97);
      rp.push(p);
    }
    rami.push(rp);
    const g = tube(rp, (s) => lerp(0.0062, 0.0032, s), 10, { caps: true });
    billColors(g, (u) => [lerp(0.95, 0.88, u), lerp(0.58, 0.42, u), lerp(0.26, 0.24, u)]);
    const m = new THREE.Mesh(tag(g, 22, "v"), PM.bill);
    m.castShadow = true;
    group.add(m);
  }
  return { pts, up, rami, width };
}

function billColors(g, fn) {
  const uv = g.attributes.uv, n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = fn(uv ? uv.getY(i) : 0, uv ? uv.getX(i) : 0);
    col[i * 3] = lin(c[0]); col[i * 3 + 1] = lin(c[1]); col[i * 3 + 2] = lin(c[2]);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

// ------------------------------------------------------------------ pouch
function buildPouch(group, PM, bill) {
  const NU = 44, NV = 26;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3);
  const uv = new Float32Array((NU + 1) * (NV + 1) * 2);
  const idx = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
    uv[(i * (NV + 1) + j) * 2] = j / NV;
    uv[(i * (NV + 1) + j) * 2 + 1] = i / NU;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  tag(geo, 22, "v");
  const mesh = new THREE.Mesh(geo, PM.pouch);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  const throat = V(PEL.neck[4].x + 0.025, PEL.neck[4].y - 0.01, 0);
  const rampt = (k, u) => {
    // point on ramus k at param u in [0, 0.97]
    const r = bill.rami[k];
    const f = clamp(u / 0.97) * (r.length - 1);
    const i0 = Math.floor(f), i1 = Math.min(r.length - 1, i0 + 1);
    return r[i0].clone().lerp(r[i1], f - i0);
  };
  const tmp = V();
  function update(st) {
    const sag = st.pouchSag ?? 0;
    const sway = st.pouchSway ?? 0;
    for (let i = 0; i <= NU; i++) {
      const s = i / NU; // 0 throat → 1 tip
      const u = (s - 0.22) / 0.78; // jaw param; negative = along the throat
      let L, Rr;
      if (u >= 0) {
        L = rampt(1, u * 0.97); Rr = rampt(0, u * 0.97);
      } else {
        const k = -u / (0.22 / 0.78);
        const g0 = rampt(1, 0), g1 = rampt(0, 0);
        L = g0.clone().lerp(throat.clone().setZ(-0.02), k);
        Rr = g1.clone().lerp(throat.clone().setZ(0.02), k);
      }
      const mid = L.clone().add(Rr).multiplyScalar(0.5);
      const halfW = L.distanceTo(Rr) / 2;
      const depthBase = 0.058 * Math.sin(Math.PI * clamp((s + 0.05) / 1.02)) * (1 - smoothstep(0.75, 1.0, s)) + 0.004;
      const depth = depthBase * (1 + 0.16 * sag);
      for (let j = 0; j <= NV; j++) {
        const th = (j / NV) * Math.PI;
        const lat = -Math.cos(th) * (halfW * (1 + 0.55 * Math.sin(th) * smoothstep(0.0, 0.3, s)) + 0.002);
        const down = Math.pow(Math.sin(th), 1.25) * depth;
        tmp.copy(mid);
        tmp.z += lat + sway * Math.sin(th) * depth * 0.45;
        tmp.addScaledVector(bill.up, -down);
        tmp.x -= down * 0.18 * (1 - s); // the throat end hangs back a little
        const k = (i * (NV + 1) + j) * 3;
        pos[k] = tmp.x; pos[k + 1] = tmp.y; pos[k + 2] = tmp.z;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  update({});
  return { update, mesh };
}

// ------------------------------------------------------------------ eyes
function buildEyes(group, PM, sdf) {
  const eyes = [];
  const centers = [];
  for (const sz of [1, -1]) {
    // find the head surface along -Z*sz and seat the eyeball into it
    let z = sz * 0.08;
    while (Math.abs(z) > 0.005 && sdf(PEL.eye.x, PEL.eye.y, z) > 0) z -= sz * 0.0005;
    const e = 1e-4;
    const nrm = V(
      sdf(PEL.eye.x + e, PEL.eye.y, z) - sdf(PEL.eye.x - e, PEL.eye.y, z),
      sdf(PEL.eye.x, PEL.eye.y + e, z) - sdf(PEL.eye.x, PEL.eye.y - e, z),
      sdf(PEL.eye.x, PEL.eye.y, z + e) - sdf(PEL.eye.x, PEL.eye.y, z - e),
    ).normalize();
    const c = V(PEL.eye.x, PEL.eye.y, z).addScaledVector(nrm, -0.0066);
    centers.push(c);
    const g = new THREE.Group();
    g.position.copy(c);
    const look = nrm.clone().add(V(0.25, 0.04, 0)).normalize();
    g.quaternion.setFromUnitVectors(V(0, 0, 1), look);
    // eyeball with iris uv on +Z
    const eg = new THREE.SphereGeometry(0.0112, 32, 24);
    const ep = eg.attributes.position, euv = eg.attributes.uv;
    for (let i = 0; i < ep.count; i++) {
      const x = ep.getX(i) / 0.0112, y = ep.getY(i) / 0.0112;
      euv.setXY(i, x * 0.5 + 0.5, y * 0.5 + 0.5);
    }
    const eye = new THREE.Mesh(tag(eg, 23, 0.5), PM.iris);
    g.add(eye);
    eye.scale.setScalar(0.94);
    const cornea = new THREE.Mesh(new THREE.SphereGeometry(0.011, 32, 16, 0, TAU, 0, 1.0).rotateX(Math.PI / 2), PM.cornea);
    g.add(cornea);
    // lids (upper/lower shells) close for a blink; hidden inside the head otherwise
    const lidG = new THREE.SphereGeometry(0.0112, 32, 12, 0, TAU, 0, Math.PI * 0.5);
    const upper = new THREE.Mesh(tag(lidG.clone(), 23, 0.7), PM.faceSkin);
    const lower = new THREE.Mesh(tag(lidG.clone(), 23, 0.7), PM.faceSkin);
    // nictitating membrane: a translucent third eyelid that sweeps across from the front corner
    const nict = new THREE.Mesh(new THREE.SphereGeometry(0.0111, 24, 12, 0, Math.PI, 0, Math.PI).rotateY(Math.PI * 0.5), PM.nictit);
    g.add(upper, lower, nict);
    group.add(g);
    eyes.push({ g, upper, lower, nict, sz });
  }
  function update(st) {
    const blink = clamp(st.blink ?? 0);
    for (const e of eyes) {
      // hemispheres around Y; rotate about local X so they cover the eye from above/below
      const lid = clamp((blink - 0.35) / 0.65);
      e.upper.visible = e.lower.visible = lid > 0.01;
      e.upper.rotation.set(lerp(-0.7, 1.42, lid), 0, 0);
      e.lower.rotation.set(Math.PI - lerp(-0.7, 1.3, lid * 0.85), 0, 0);
      const nk = clamp(blink / 0.6);
      e.nict.visible = nk > 0.01;
      e.nict.rotation.set(0, -e.sz * lerp(-1.9, 0.1, nk), 0);
    }
  }
  update({});
  return { update, centers };
}

// ------------------------------------------------------------------ legs + feet
function buildLeg(side, PM) {
  const group = new THREE.Group();
  const s = side;
  const tibG = tag(tube(curvePts([V(0, 0), V(0, PEL.L1 * 0.5), V(0, PEL.L1)], 10), (u) => lerp(0.021, 0.0125, u), 16, { caps: true }), 24, "v");
  const tarG = tag(tube(curvePts([V(0, 0), V(0, PEL.L2 * 0.5), V(0, PEL.L2)], 10), (u) => lerp(0.0118, 0.0098, u), 16, { caps: true }), 24, "v");
  // flip uv for scales density
  for (const g of [tibG, tarG]) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 6);
  }
  const tib = new THREE.Mesh(tibG, PM.leg);
  const tar = new THREE.Mesh(tarG, PM.leg);
  // feathered "trousers" over the upper tibiotarsus
  const trousersG = tag(tube(curvePts([V(0, -0.02), V(0, 0.04), V(0, 0.1)], 8), (u) => lerp(0.034, 0.017, u), 18, { caps: true }), 24, "v");
  const trousers = new THREE.Mesh(trousersG, PM.white);
  const jointG = new THREE.SphereGeometry(0.0145, 16, 12);
  const joint = new THREE.Mesh(tag(jointG, 24, 0.5), PM.leg);
  for (const m of [tib, tar, trousers, joint]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  // foot (rigid): origin at the ball, +X toes forward, +Y up, +Z outward*side
  const foot = new THREE.Group();
  group.add(foot);
  const toes = [
    { ang: -0.62, len: [0.03, 0.022, 0.018], r: 0.0058 }, // I (hallux, points inward-forward)
    { ang: -0.3, len: [0.038, 0.03, 0.022], r: 0.0064 }, // II
    { ang: 0.0, len: [0.045, 0.034, 0.026], r: 0.0068 }, // III
    { ang: 0.28, len: [0.042, 0.032, 0.024], r: 0.0064 }, // IV
  ];
  const curl = [0, 0.9, 1.25];
  const toePts = toes.map((tt) => {
    const pts = [V(0, 0.004, 0)];
    let p = V(0, 0.004, 0);
    let pitch = 0;
    const dirH = V(Math.cos(tt.ang), 0, Math.sin(tt.ang) * s); // negative angle = inward
    for (let k = 0; k < 3; k++) {
      pitch = curl[k];
      const d = dirH.clone().multiplyScalar(Math.cos(pitch)).add(V(0, -Math.sin(pitch), 0));
      p = p.clone().addScaledVector(d, tt.len[k]);
      pts.push(p);
    }
    return pts;
  });
  const fb = [];
  toes.forEach((tt, k) => {
    const pts = curvePts(toePts[k], 20);
    fb.push(tag(tube(pts, (u) => lerp(tt.r, tt.r * 0.6, u), 10, { caps: true }), 24, "v"));
    // knuckle pads
    for (let j = 1; j < 3; j++) {
      const kg = new THREE.SphereGeometry(tt.r * 1.08, 10, 8);
      place(kg, toePts[k][j]);
      fb.push(tag(kg, 24, 0.6));
    }
  });
  const footMesh = new THREE.Mesh(merge(fb), PM.leg);
  footMesh.castShadow = footMesh.receiveShadow = true;
  foot.add(footMesh);
  // claws
  const cg = [];
  toes.forEach((tt, k) => {
    const pts = toePts[k];
    const a = pts[3], b = pts[2];
    const d = a.clone().sub(b).normalize();
    cg.push(tag(rod(a.clone().addScaledVector(d, -0.004), a.clone().addScaledVector(d, 0.012), tt.r * 0.55, 0.0006, 8), 24, 0.9));
  });
  const claws = new THREE.Mesh(merge(cg), PM.claw);
  claws.castShadow = true;
  foot.add(claws);
  // webs between toes (ruled surfaces with a scalloped free edge)
  const webG = [];
  for (let k = 0; k < 3; k++) {
    const A = curvePts(toePts[k], 16), Bp = curvePts(toePts[k + 1], 16);
    const nU = 16, nV = 6;
    const P = [], I = [];
    for (let i = 0; i <= nU; i++) {
      const u = i / nU;
      const lim = 0.88;
      const a = A[Math.round(u * lim * 16)], b = Bp[Math.round(u * lim * 16)];
      for (let j = 0; j <= nV; j++) {
        const v = j / nV;
        const p = a.clone().lerp(b, v);
        const scallop = Math.sin(v * Math.PI) * 0.006 * smoothstep(0.6, 1.0, u);
        p.addScaledVector(a.clone().sub(b).cross(V(0, 1, 0)).normalize(), 0);
        p.y -= Math.sin(v * Math.PI) * 0.002 + scallop * 0.3;
        // pull the far edge back to make the scallop
        if (i === nU) p.addScaledVector(a.clone().add(b).multiplyScalar(0.5).normalize(), -scallop);
        P.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++) {
      const q = i * (nV + 1) + j;
      I.push(q, q + nV + 1, q + 1, q + 1, q + nV + 1, q + nV + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    g.computeVertexNormals();
    webG.push(tag(g, 24, 0.7));
  }
  const web = new THREE.Mesh(merge(webG), PM.web);
  web.castShadow = web.receiveShadow = true;
  foot.add(web);

  const K = V(PEL.knee.x, PEL.knee.y, s * PEL.knee.z);
  const J = V(), F = V();
  function update(st, target) {
    // target: { p: Vector3 ball position, fwd: Vector3, up: Vector3 }
    F.copy(target.p);
    const d = F.clone().sub(K);
    let len = d.length();
    const L1 = PEL.L1, L2 = PEL.L2;
    len = Math.min(len, (L1 + L2) * 0.999);
    const dn = d.clone().normalize();
    F.copy(K).addScaledVector(dn, len);
    const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = (target.pole ?? V(-1, -0.15, s * 0.45)).clone();
    pole.addScaledVector(dn, -pole.dot(dn)).normalize();
    J.copy(K).addScaledVector(dn, a).addScaledVector(pole, h);
    // place segments (tube local +Y from start to end)
    const q1 = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), J.clone().sub(K).normalize());
    tib.position.copy(K); tib.quaternion.copy(q1);
    trousers.position.copy(K); trousers.quaternion.copy(q1);
    const q2 = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), F.clone().sub(J).normalize());
    tar.position.copy(J); tar.quaternion.copy(q2);
    joint.position.copy(J);
    // foot frame
    const fwd = target.fwd.clone().normalize();
    const up = target.up.clone().addScaledVector(fwd, -target.up.dot(fwd)).normalize();
    const zz = new THREE.Vector3().crossVectors(fwd, up);
    foot.position.copy(F);
    foot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, up, zz));
    if (s < 0) foot.scale.set(1, 1, 1);
  }
  return { group, update, K };
}

// ------------------------------------------------------------------ wings
function buildWing(side, PM, R) {
  const s = side;
  const group = new THREE.Group();
  // feather list: bone 0 humerus, 1 forearm, 2 hand
  const F = [];
  const add = (o) => F.push(o);
  const black = [0.1, 0.09, 0.1], white = [0.97, 0.96, 0.93], grey = [0.95, 0.94, 0.91];
  // primaries P1 (inner) .. P10 (outer) on the hand
  for (let k = 0; k < 10; k++) {
    const f = k / 9;
    add({ type: "flight", bone: 2, t: 0.2 + 0.8 * f, layer: 0, betaS: lerp(1.2, 0.12, Math.pow(f, 0.9)), betaF: lerp(0.18, 0.04, f), len: lerp(0.3, 0.4, Math.sin(f * 2.2)), w: lerp(0.075, 0.05, f), col: black, twist: -0.1 * f });
  }
  // secondaries S1 (at wrist) .. S20 (at elbow)
  for (let k = 0; k < 20; k++) {
    const f = k / 19;
    add({ type: "flight", bone: 1, t: 1 - 0.95 * f, layer: 0, betaS: lerp(1.5, 1.75, f), betaF: lerp(2.78, 2.98, f), len: lerp(0.27, 0.24, f), w: 0.075, col: k < 13 ? black : (k < 15 ? grey : white), twist: 0 });
  }
  // tertials on the distal humerus
  for (let k = 0; k < 6; k++) {
    const f = k / 5;
    add({ type: "flight", bone: 0, t: 0.98 - 0.4 * f, layer: 0.002, betaS: lerp(1.95, 2.3, f), betaF: lerp(0.3, 0.12, f), len: lerp(0.24, 0.2, f), w: 0.08, col: white, twist: 0 });
  }
  // greater + median + lesser coverts over the forearm
  const rows = [
    { n: 18, len: 0.13, layer: 0.006, w: 0.07, dBeta: 0.05 },
    { n: 18, len: 0.085, layer: 0.01, w: 0.06, dBeta: 0.1 },
    { n: 16, len: 0.055, layer: 0.013, w: 0.05, dBeta: 0.2 },
    { n: 14, len: 0.04, layer: 0.016, w: 0.045, dBeta: 0.35 },
  ];
  rows.forEach((row, ri) => {
    for (let k = 0; k < row.n; k++) {
      const f = (k + 0.5 * (ri % 2)) / row.n;
      add({ type: "covert", bone: 1, t: 1 - f, layer: row.layer, betaS: lerp(1.5, 1.75, f) + row.dBeta, betaF: 2.82 + row.dBeta * 0.2, len: row.len * (0.9 + 0.2 * R()), w: row.w, col: white, twist: 0, inset: ri * 0.012 });
    }
  });
  // humerus coverts / scapulars
  for (let k = 0; k < 14; k++) {
    const f = k / 13;
    add({ type: "covert", bone: 0, t: 0.15 + 0.8 * f, layer: 0.012, betaS: 2.0, betaF: 0.12, len: 0.16 - 0.04 * f, w: 0.06, col: white, twist: 0 });
  }
  // primary coverts (black) + alula
  for (let k = 0; k < 10; k++) {
    const f = k / 9;
    add({ type: "covert", bone: 2, t: 0.12 + 0.7 * f, layer: 0.006, betaS: lerp(1.2, 0.3, f), betaF: 0.12, len: 0.12, w: 0.06, col: black, twist: 0 });
  }
  for (let k = 0; k < 3; k++) {
    add({ type: "covert", bone: 2, t: 0.05 + 0.04 * k, layer: 0.012, betaS: -0.1 + 0.1 * k, betaF: -0.05, len: 0.07, w: 0.04, col: white, twist: 0 });
  }
  // marginal coverts along the leading edge of the hand
  for (let k = 0; k < 12; k++) {
    const f = k / 11;
    add({ type: "covert", bone: 2, t: 0.05 + 0.9 * f, layer: 0.014, betaS: 1.0, betaF: 0.35, len: 0.05, w: 0.05, col: f > 0.4 ? black : white, twist: 0 });
  }
  // marginal coverts along the forearm leading edge (round, overlapping, hide the arm)
  for (let k = 0; k < 22; k++) {
    const f = k / 21;
    add({ type: "covert", bone: 1, t: 0.02 + 0.96 * f, layer: 0.02, betaS: 1.9, betaF: 2.6 + 0.2 * R(), len: 0.045 + 0.015 * R(), w: 0.045, col: white, twist: 0, inset: -0.012 });
  }
  for (let k = 0; k < 10; k++) {
    const f = k / 9;
    add({ type: "covert", bone: 0, t: 0.3 + 0.7 * f, layer: 0.022, betaS: 2.2, betaF: 0.3 + 0.2 * R(), len: 0.05 + 0.02 * R(), w: 0.05, col: white, twist: 0, inset: -0.01 });
  }
  // underwing coverts
  for (let k = 0; k < 18; k++) {
    const f = k / 17;
    add({ type: "covert", bone: 1, t: 1 - f, layer: -0.008, betaS: 1.6, betaF: 2.85, len: 0.12, w: 0.07, col: white, twist: 0, under: true });
  }
  for (let k = 0; k < 10; k++) {
    add({ type: "covert", bone: 2, t: 0.1 + 0.08 * k, layer: -0.008, betaS: 1.1 - 0.07 * k, betaF: 0.12, len: 0.11, w: 0.06, col: grey, twist: 0, under: true });
  }
  F.forEach((f, i) => { f.phase = R() * 100; f.idx = i; f.jit = (R() - 0.5) * 0.12; f.lenJ = 0.92 + R() * 0.16; f.liftJ = R() * 0.08; });
  const flight = F.filter((f) => f.type === "flight");
  const covert = F.filter((f) => f.type === "covert");
  const gFlight = featherGeo(0.05, 0.04, 8, 2);
  const gCovert = featherGeo(0.1, 0.06, 5, 2);
  const mFlight = new THREE.InstancedMesh(gFlight, PM.fFlight, flight.length);
  const mCovert = new THREE.InstancedMesh(gCovert, PM.fCovert, covert.length);
  const col = new THREE.Color();
  flight.forEach((f, i) => mFlight.setColorAt(i, col.setRGB(f.col[0], f.col[1], f.col[2], THREE.SRGBColorSpace)));
  covert.forEach((f, i) => mCovert.setColorAt(i, col.setRGB(f.col[0], f.col[1], f.col[2], THREE.SRGBColorSpace)));
  for (const m of [mFlight, mCovert]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; group.add(m); }

  // arm core (dynamic tube shoulder→elbow→wrist→tip) + patagium membrane
  const coreN = 28, coreR = 12;
  const coreGeo = new THREE.BufferGeometry();
  const corePos = new Float32Array((coreN + 1) * (coreR + 1) * 3);
  coreGeo.setAttribute("position", new THREE.BufferAttribute(corePos, 3));
  {
    const I = [];
    for (let i = 0; i < coreN; i++) for (let j = 0; j < coreR; j++) {
      const a = i * (coreR + 1) + j, b = a + 1, c = a + coreR + 1, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
    coreGeo.setIndex(I);
  }
  const core = new THREE.Mesh(coreGeo, PM.white);
  core.castShadow = core.receiveShadow = true;
  core.frustumCulled = false;
  group.add(core);
  const patN = 14;
  const patGeo = new THREE.BufferGeometry();
  const patPos = new Float32Array((patN + 1) * 2 * 3);
  patGeo.setAttribute("position", new THREE.BufferAttribute(patPos, 3));
  {
    const I = [];
    for (let i = 0; i < patN; i++) { const a = i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    patGeo.setIndex(I);
  }
  const patMat = PM.white.clone();
  patMat.side = THREE.DoubleSide;
  patch(patMat, { translucency: 0.5, transColor: 0xffe2b8 });
  const pat = new THREE.Mesh(patGeo, patMat);
  pat.castShadow = pat.receiveShadow = true;
  pat.frustumCulled = false;
  group.add(pat);

  const S0 = V(PEL.shoulder.x, PEL.shoulder.y, s * PEL.shoulder.z);
  const Lh = PEL.humerus, Lf = PEL.forearm, Lw = PEL.hand;
  // spread pose directions
  const spread = {
    hum: V(-0.28, 0.16, s).normalize(),
    fore: V(0.2, 0.05, s).normalize(),
    hand: V(-0.15, -0.03, s).normalize(),
    up: V(0, 1, 0),
  };
  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion();
  const E = V(), W = V(), Tp = V();
  const slerpV = (a, b, t) => {
    const qa = new THREE.Quaternion().setFromUnitVectors(a, b);
    return a.clone().applyQuaternion(new THREE.Quaternion().slerp(qa, t));
  };
  function boneFrame(a, u) {
    // a: along bone (unit), u: dorsal reference → returns {a, u, back}
    const uu = u.clone().addScaledVector(a, -u.dot(a)).normalize();
    const back = s > 0 ? new THREE.Vector3().crossVectors(a, uu) : new THREE.Vector3().crossVectors(uu, a);
    return { a, u: uu, back: back.normalize() };
  }
  function update(st, hood, grow) {
    const sp = clamp(st.wingSpread ?? 0);
    const t = st.t ?? 0;
    // hold pose via IK to the hood
    const target = hood ? hood.clone() : S0.clone().add(V(0.4, -0.2, s * 0.08));
    const d = target.clone().sub(S0);
    let len = Math.min(d.length(), (Lh + Lf) * 0.995);
    const dn = d.clone().normalize();
    const a = (Lh * Lh - Lf * Lf + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, Lh * Lh - a * a));
    const pole = V(-0.75, -0.65, s * 0.12);
    pole.addScaledVector(dn, -pole.dot(dn)).normalize();
    const Eh = S0.clone().addScaledVector(dn, a).addScaledVector(pole, h);
    const holdHum = Eh.clone().sub(S0).normalize();
    const holdFore = S0.clone().addScaledVector(dn, len).sub(Eh).normalize();
    const holdHand = V(-1, -0.06, s * 0.05).normalize();
    const holdUp = V(0.0, 0.28, s).normalize();
    const sm = sp * sp * (3 - 2 * sp);
    const flap = (st.wingFlap ?? 0) * Math.sin(t * 5.2) * sm;
    const hum = slerpV(holdHum, spread.hum.clone().applyAxisAngle(V(1, 0, 0), -s * flap * 0.4), sm);
    const fore = slerpV(holdFore, spread.fore.clone().applyAxisAngle(V(1, 0, 0), -s * flap * 0.6), sm);
    const hand = slerpV(holdHand, spread.hand.clone().applyAxisAngle(V(1, 0, 0), -s * flap * 0.9), sm);
    const up = slerpV(holdUp, spread.up, sm);
    E.copy(S0).addScaledVector(hum, Lh);
    W.copy(E).addScaledVector(fore, Lf);
    Tp.copy(W).addScaledVector(hand, Lw);
    const frames = [boneFrame(hum, up), boneFrame(fore, up), boneFrame(hand, up)];
    const starts = [S0, E, W], lens = [Lh, Lf, Lw];
    // feathers
    let fi = 0, ci = 0;
    const wind = st.wind ?? 0.5;
    for (const f of F) {
      const fr = frames[f.bone];
      const base = starts[f.bone].clone().addScaledVector(fr.a, f.t * lens[f.bone]).addScaledVector(fr.u, f.layer).addScaledVector(fr.back, -(f.inset ?? 0) * 0.3);
      const beta = lerp(f.betaF, f.betaS, sm) + f.jit * (1 - sm * 0.6);
      const dir = fr.a.clone().multiplyScalar(Math.cos(beta)).addScaledVector(fr.back, Math.sin(beta)).normalize();
      // flutter + slight lift off the wing plane
      const flutter = noise1(t * 7 + f.phase) * 0.06 * wind * (f.type === "covert" ? 0.6 : 1);
      const nrm = fr.u.clone();
      const dirL = dir.clone().addScaledVector(nrm, (f.under ? -1 : 1) * (0.05 + f.liftJ + flutter)).normalize();
      const side = new THREE.Vector3().crossVectors(dirL, nrm).normalize();
      const nn = new THREE.Vector3().crossVectors(side, dirL).normalize();
      const m = new THREE.Matrix4().makeBasis(dirL, f.under ? nn.clone().negate() : nn, f.under ? side.clone().negate() : side);
      q.setFromRotationMatrix(m);
      const g = clamp((grow - 0.55 - (f.idx / F.length) * 0.35) / 0.06);
      const sc = g <= 0 ? 0 : easeOutBack(g, 1.2);
      tmpM.compose(base, q, V(f.len * f.lenJ * sc, 1, f.w * sc));
      if (f.type === "flight") mFlight.setMatrixAt(fi++, tmpM);
      else mCovert.setMatrixAt(ci++, tmpM);
    }
    mFlight.instanceMatrix.needsUpdate = true;
    mCovert.instanceMatrix.needsUpdate = true;
    mFlight.visible = mCovert.visible = grow > 0.551;
    // core tube along S0→E→W→Tp
    const ctrl = [S0.clone().addScaledVector(frames[0].a, -0.03), S0, E, W, Tp.clone().addScaledVector(frames[2].a, -0.04)];
    const curve = new THREE.CatmullRomCurve3(ctrl, false, "centripetal");
    const pts = curve.getSpacedPoints(coreN);
    for (let i = 0; i <= coreN; i++) {
      const u = i / coreN;
      const tg = curve.getTangentAt(Math.min(0.999, u)).normalize();
      const nn = up.clone().addScaledVector(tg, -up.dot(tg)).normalize();
      const bb = new THREE.Vector3().crossVectors(tg, nn);
      const r = lerp(0.03, 0.008, Math.pow(u, 0.8)) * (sc0(grow)) * lerp(0.6, 1, sm);
      for (let j = 0; j <= coreR; j++) {
        const ang = (j / coreR) * TAU;
        const p = pts[i].clone().addScaledVector(nn, Math.cos(ang) * r * 0.55).addScaledVector(bb, Math.sin(ang) * r);
        const k = (i * (coreR + 1) + j) * 3;
        corePos[k] = p.x; corePos[k + 1] = p.y; corePos[k + 2] = p.z;
      }
    }
    coreGeo.attributes.position.needsUpdate = true;
    coreGeo.computeVertexNormals();
    // patagium: leading edge straight-ish S0→W, trailing along S0→E→W
    for (let i = 0; i <= patN; i++) {
      const u = i / patN;
      const lead = S0.clone().lerp(W, u).addScaledVector(fore.clone().cross(up).normalize(), 0);
      const trail = u < 0.5 ? S0.clone().lerp(E, u * 2) : E.clone().lerp(W, (u - 0.5) * 2);
      // keep the leading edge in front of the arm
      const k = i * 6;
      patPos[k] = lead.x; patPos[k + 1] = lead.y; patPos[k + 2] = lead.z;
      patPos[k + 3] = trail.x; patPos[k + 4] = trail.y; patPos[k + 5] = trail.z;
    }
    patGeo.attributes.position.needsUpdate = true;
    patGeo.computeVertexNormals();
    pat.visible = grow > 0.5 && sm > 0.15;
    core.visible = grow > 0.5;
  }
  const sc0 = (g) => clamp((g - 0.5) / 0.05);
  return { group, update, count: F.length };
}
