// Assembles the film and renders frame(t). Called by the HyperFrames timeline (see index.html).
import * as THREE from "three";
import { buildBike, B } from "./bike.js";
import { buildPelican, PEL } from "./pelican.js";
import { makeRig } from "./rig.js";
import { makeMaterials, shared } from "./materials.js";
import * as TX from "./textures.js";
import { buildWorld, WORLD, roadY, roadZ } from "./world.js";
import { SKY, skyUniforms } from "./skyglsl.js";
import { Pipeline } from "./post.js";
import { T, storyTime, riderState, bikeX, X_START, FPS } from "./story.js";
import { shotAt } from "./shots.js";
import { clamp, seg, smoothstep, lerp, easeInOutSine, hash1 } from "./util.js";
import { buildFlock } from "./flock.js";
import { overlay, initOverlay } from "./overlay.js";

const W = 1920, H = 1080;
const params = new URLSearchParams(location.search);
const QUALITY = Number(params.get("q") ?? 8);

const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, W / H, 0.02, 2500);

// ---- assets
const tex = {
  tyre: TX.tyreTextures(),
  tape: TX.barTapeTextures(),
  leather: TX.leatherTextures(),
  brushed: TX.brushedRoughness(),
};
const M = makeMaterials(tex);
const world = buildWorld(M);
scene.add(world.group);
const bike = buildBike(M);
scene.add(bike.root);
const pel = buildPelican(M);
const rig = makeRig(bike, pel);
const flock = buildFlock();
scene.add(flock.group);

// ---- light
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.6, 0.34), 7.5);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const SB = 3.2;
Object.assign(sun.shadow.camera, { left: -SB, right: SB, top: SB, bottom: -SB, near: 1, far: 140 });
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.012;
scene.add(sun, sun.target);
const fill = new THREE.HemisphereLight(new THREE.Color(0.55, 0.6, 0.85), new THREE.Color(0.32, 0.25, 0.18), 0.35);
scene.add(fill);

// environment from the sky itself
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(world.sky.geometry, world.skyMat);
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.12, 0.09) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  scene.environment = pm.fromScene(envScene, 0, 0.1, 2000).texture;
  scene.environmentIntensity = 0.5;
}

const pipe = new Pipeline(renderer, W, H);
flock.setAnchor(placeBike(storyTime(T.cutAerial)).clone());

// ---- transparent bits we hide in sketch mode
const transparentMeshes = [];
pel.root.traverse((o) => { if (o.isMesh && o.material && o.material.transparent) transparentMeshes.push(o); });

// ---- build schedule: part id → [start, end] (film seconds)
const BUILD = {
  1: [4.45, 5.5], 2: [5.1, 5.8], 3: [5.3, 5.95], 4: [5.6, 6.2], 5: [5.95, 6.5],
  6: [5.85, 6.55], 7: [6.35, 7.55], 8: [5.95, 6.65], 9: [6.45, 7.65], 10: [6.15, 6.6],
  11: [6.55, 7.15], 12: [6.95, 7.35], 13: [7.15, 7.95], 14: [6.85, 7.25], 15: [7.35, 7.95],
  16: [7.55, 8.15], 17: [7.75, 8.35],
  20: [7.95, 8.95], 22: [8.55, 9.15], 23: [8.85, 9.15], 24: [8.35, 9.0],
};
const FEATHER_GROW = [9.0, 10.5];

function applyReveal(t) {
  const rv = shared.uReveal.value;
  for (let i = 0; i < rv.length; i++) rv[i] = 1;
  if (t >= T.wipe0) return 1;
  for (const [id, [a, b]] of Object.entries(BUILD)) rv[+id] = smoothstep(a, b, t) * 1.001;
  return seg(t, FEATHER_GROW[0], FEATHER_GROW[1]);
}

// ---- place the bike on the road at story time τ
const _v = new THREE.Vector3();
function placeBike(tau) {
  const x = bikeX(tau);
  const xr = x + B.RA.x, xf = x + B.FA.x;
  const yr = roadY(xr), yf = roadY(xf);
  const pitch = Math.atan2(yf - yr, xf - xr);
  const y = yr + (x - xr) * Math.tan(pitch);
  const z = roadZ(x) + WORLD.LANE;
  bike.root.position.set(x, y, z);
  bike.root.rotation.set(0, 0, pitch);
  bike.root.updateMatrixWorld(true);
  return bike.root.position;
}

// ---- one sub-frame of state
const probe = { bike: new THREE.Vector3(), head: new THREE.Vector3(), eye: new THREE.Vector3() };
const camState = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 };
function setState(t, k, n) {
  const tau = storyTime(t);
  const st = riderState(t, tau);
  const grow = applyReveal(t);
  // before the ride starts the rider is posed for the drawing
  st.featherGrow = grow;
  placeBike(tau);
  rig.solve(st);
  world.update(tau);

  shared.uTime.value = tau;
  pel.root.updateMatrixWorld(true);
  probe.bike.copy(bike.root.position);
  pel.headGroup.updateMatrixWorld(true);
  pel.headWorld(probe.head);
  pel.eyeWorld(0, probe.eye);
  const s = shotAt(t, probe);
  flock.update(t, bike.root.position, s.pos, SKY.moonDir);
  // sub-pixel + aperture jitter (deterministic per sub-frame)
  const r1 = hash1(k * 13.1 + 1.7), r2 = hash1(k * 7.3 + 5.1);
  const ang = (k / n) * Math.PI * 2 * 1.618 + r1 * 0.3;
  const rad = Math.sqrt((k + 0.5) / n);
  camera.fov = s.fov;
  camera.position.copy(s.pos);
  camera.up.set(0, 1, 0);
  if (s.aperture > 0) {
    // thin lens: move the eye on the aperture disk, keep the focal plane fixed
    camera.lookAt(s.target);
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const dir = s.target.clone().sub(s.pos).normalize();
    const focalPt = s.pos.clone().addScaledVector(dir, s.focus);
    camera.position.addScaledVector(right, Math.cos(ang) * rad * s.aperture).addScaledVector(up, Math.sin(ang) * rad * s.aperture);
    camera.lookAt(focalPt);
  } else {
    camera.lookAt(s.target);
  }
  camera.updateProjectionMatrix();
  camera.clearViewOffset();
  if (n > 1) camera.setViewOffset(W, H, (r1 - 0.5) * 1.0, (r2 - 0.5) * 1.0, W, H);
  camera.updateMatrixWorld();
  shared.uViewInv.value.copy(camera.matrixWorld);
  // shadows follow the rider
  const bp = bike.root.position;
  sun.target.position.set(bp.x + 0.1, bp.y + 0.8, bp.z);
  sun.position.copy(sun.target.position).addScaledVector(SKY.sunDir, 60);
  sun.target.updateMatrixWorld();
  camState.pos.copy(s.pos);
  camState.target.copy(s.target);
  camState.fov = s.fov;
  return { tau, st, s };
}

function sunScreen() {
  const p = camera.position.clone().addScaledVector(SKY.sunDir, 500).project(camera);
  const vis = p.z < 1 && Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3 ? 1 : 0;
  return new THREE.Vector3(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, vis);
}

// ---- the frame
const CUTS = [T.cutDrive, T.cutHead, T.cutDescent, T.cutAerial];
let lastT = -1;
export function renderAt(t) {
  t = clamp(t, 0, 40);
  const sketchOnly = t < T.wipe0;
  const both = t >= T.wipe0 && t < T.wipe1;
  const n = t < T.build0 ? 1 : QUALITY;
  // 180° shutter; 45° in the drivetrain macro so the chain links stay readable
  const shutter = (t >= T.cutDrive && t < T.cutHead ? 0.125 : 0.5) / FPS;
  const subs = [];
  let shotLo = 0, shotHi = 40;
  for (const c of CUTS) {
    if (c <= t) shotLo = c;
    else { shotHi = c - 1e-4; break; }
  }
  pipe.render(scene, camera, n, (k, nn) => {
    let st = t + ((k + 0.5) / nn - 0.5) * shutter * (nn > 1 ? 1 : 0);
    // never let the shutter straddle a cut: keep every sub-frame inside this frame's shot
    st = Math.min(Math.max(st, shotLo), shotHi);
    subs.push(setState(Math.max(0, st), k, nn));
    return {
      pbr: !sketchOnly,
      sketch: sketchOnly || both,
      beforeSketch() {
        world.group.visible = false;
        flock.group.visible = false;
        transparentMeshes.forEach((m) => (m.visible = false));
      },
      afterSketch() {
        world.group.visible = true;
        flock.group.visible = true;
        transparentMeshes.forEach((m) => (m.visible = true));
      },
    };
  }, postParams(t));
  // pose the scene at the frame centre (no jitter) for the DOM anchors
  setState(t, 0, 1);
  overlay(t, { anchorPx });
  lastT = t;
}

const PAPER = new THREE.Color(0.955, 0.94, 0.905);
function postParams(t) {
  const p = {
    frame: Math.round(t * FPS),
    exposure: 0.62,
    bloom: 0.1,
    bloomThreshold: 1.6,
    vignette: 0.42,
    grain: 0.02,
    flare: 0,
  };
  if (t < T.wipe1) {
    p.wipe = t < T.wipe0 ? -2 : lerp(-0.25, 1.25, easeInOutSine(seg(t, T.wipe0, T.wipe1)));
    p.sketchMix = t < T.wipe0 ? 1 : 0;
    p.wipeSoft = 0.035;
    p.grid = 1 - smoothstep(T.wipe0, T.wipe1, t);
    p.grain = lerp(0.006, 0.02, seg(t, T.wipe0, T.wipe1));
    p.vignette = lerp(0.0, 0.42, seg(t, T.wipe0, T.wipe1));
  }
  if (t >= 27.0 && t < T.cutAerial) {
    p.flare = smoothstep(27.2, 28.2, t) * (1 - smoothstep(30.0, 30.9, t));
    p.sunScreen = sunScreen();
    p.bloom = 0.16;
  }
  if (t > 38.4) {
    // end on paper, as we began
    p.fade = smoothstep(38.5, 39.6, t);
    p.fadeColor = PAPER;
  }
  return p;
}

// ---- screen-space anchors for the overlay
const _a = new THREE.Vector3();
function toPx(v) {
  const p = v.clone().project(camera);
  return [(p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H];
}
function bikePt(x, y, z) {
  return _a.set(x, y, z).applyMatrix4(bike.root.matrixWorld).clone();
}
function billPt(u, up = 0) {
  const d = PEL.billDir, n = new THREE.Vector3(-d.y, d.x, 0);
  return PEL.billBase.clone().addScaledVector(d, u * PEL.billLen).addScaledVector(n, up).applyMatrix4(pel.headGroup.matrixWorld);
}
function anchorPx(key) {
  switch (key) {
    case "ring": return toPx(bikePt(B.BB.x + 0.05, B.BB.y + 0.065, B.chainline + 0.01));
    case "spoke": return toPx(bikePt(B.RA.x - 0.12, B.RA.y + 0.13, 0.03));
    case "chain": { const m = B.BB.clone().lerp(B.RA, 0.5); return toPx(bikePt(m.x, m.y - 0.078, B.chainline)); }
    case "horn": return toPx(billPt(0.6, 0.03));
    case "feather": return toPx(new THREE.Vector3(-0.02, 0.2, 0.16).applyMatrix4(pel.root.matrixWorld));
  }
  return [0, 0];
}
{
  // doodle anchors from the first frame of the line drawing, so the match cut lines up
  setState(4.5, 0, 1);
  const rear = toPx(bikePt(B.RA.x, B.RA.y, 0)), front = toPx(bikePt(B.FA.x, B.FA.y, 0));
  const top = toPx(bikePt(B.RA.x, B.RA.y + B.Rw, 0));
  const anchors = {
    rear, front, r: Math.hypot(top[0] - rear[0], top[1] - rear[1]) * 0.96,
    bb: toPx(bikePt(B.BB.x, B.BB.y, 0)), seat: toPx(bikePt(B.saddleTop.x, B.saddleTop.y, 0)),
    bar: toPx(bikePt(B.BC.x, B.BC.y, 0)), head: toPx(pel.headWorld()), tip: toPx(billPt(1.0, -0.01)),
  };
  initOverlay(document.getElementById("root"), anchors, { links: B.links, feathers: pel.info.feathers });
}

// expose for dev tools
import * as STORY from "./story.js";
window.__pel = { renderAt, scene, camera, renderer, bike, pel, world, setState, camState, B, STORY };
if (window.__pelicanBuilt) window.__pelicanBuilt(renderAt);
else renderAt(Number(params.get("t") ?? 14));
