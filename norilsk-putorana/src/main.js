// Assembles the world and renders frame(t). Driven by the HyperFrames timeline in index.html.
import * as THREE from "three";
import { W, H, FPS, DURATION } from "./config.js";
import { buildTerrainData } from "./heights.js";
import { buildTerrain, terrainUniforms } from "./terrain.js";
import { makeSky, skyUniforms } from "./sky.js";
import { Pipeline } from "./post.js";
import { buildCity } from "./city.js";
import { buildFx } from "./fx.js";
import { buildProps } from "./props.js";
import { makeCamera, BEATS } from "./camera.js";
import { hash1, clamp, smoothstep, lerp } from "./util.js";

// sub-frames per video frame (motion blur + anti-aliasing): ?q= in the dev lab, the composition's
// "subframes" variable in HyperFrames (default 1 for checks and drafts; --variables '{"subframes":6}' to deliver)
const params = new URLSearchParams(location.search);
const hfVars = (window.__hyperframes && window.__hyperframes.getVariables && window.__hyperframes.getVariables()) || {};
const QUALITY = Math.max(1, Math.round(Number(params.get("q") ?? hfVars.subframes ?? 1)));

const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;

const t0 = performance.now();
const TD = await buildTerrainData();
const tData = performance.now();
const terrain = buildTerrain(TD);
const sky = makeSky();
const city = buildCity(TD);
const fx = buildFx(TD, city);
const props = buildProps(TD);
const world = new THREE.Scene();
world.add(city.group, props.group, fx.group, terrain.group);
const flight = makeCamera(TD.cityGround);
const pipe = new Pipeline(renderer, W, H);
const camera = new THREE.PerspectiveCamera(55, W / H, 0.25, 120000);

// ---- pose → camera (with sub-pixel jitter for anti-aliasing)
const _q = new THREE.Quaternion();
function applyPose(cam, pose, jx = 0, jy = 0) {
  cam.position.copy(pose.pos);
  cam.quaternion.copy(pose.quat);
  cam.fov = pose.fov;
  cam.near = pose.near ?? 0.25;
  cam.far = 120000;
  cam.updateProjectionMatrix();
  if (jx || jy) cam.setViewOffset(W, H, jx, jy, W, H);
  else cam.clearViewOffset();
  cam.updateMatrixWorld(true);
}

export function poseLookAt(pos, target, fov = 55, roll = 0) {
  const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (roll) q.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  return { pos: pos.clone(), quat: q, fov };
}

// ---- one sub-frame
const vp = new THREE.Matrix4();
const tmpCam = camera.clone();
function vpOf(cam, pose) {
  applyPose(cam, pose);
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}

// the film's grade and atmosphere over time: warm city → cold plateau
function setWorldTime(t) {
  skyUniforms.uTime.value = t;
  skyUniforms.uDome.value = 1 - smoothstep(3.6, 5.6, t);
  skyUniforms.uAurora.value = lerp(0.6, 1.0, smoothstep(3.4, 5.6, t)) + 0.3 * smoothstep(8.2, 9.6, t);
  fx.dustU.uDust.value = 1 - smoothstep(4.2, 4.6, t);
  props.update(t);
}
function postAt(t, speed) {
  const sp = smoothstep(300, 1500, speed);
  return {
    exposure: 1.0,
    bloom: lerp(0.11, 0.07, smoothstep(3.8, 5.6, t)),
    bloomThreshold: 1.1,
    vignette: 0.3 + 0.16 * sp,
    ca: 0.0025 * sp,
    grain: 0.016,
    fade: Math.max(1 - smoothstep(0, 0.25, t), smoothstep(9.78, 10.0, t)),
  };
}

// the aurora is drawn once per video frame, from the frame's central pose (it changes slowly)
function drawAurora(pose) {
  applyPose(camera, pose);
  sky.setCamera(camera);
  renderer.setRenderTarget(pipe.rtAurora);
  renderer.render(sky.auroraScene, sky.orthoCam);
  sky.skyMat.uniforms.tAurora.value = pipe.rtAurora.texture;
}

function drawScene(pose, jx, jy) {
  applyPose(camera, pose, jx, jy);
  terrain.update(camera);
  sky.setCamera(camera);
  renderer.setRenderTarget(pipe.rtScene);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(world, camera);
  renderer.render(sky.skyScene, sky.orthoCam);
  vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return vp.clone().invert();
}

// poseAt(t) → { pos, quat, fov, near }
let poseAt = flight.pose;
export function setPoseSource(fn) {
  poseAt = fn;
}

const SHUTTER = 0.5 / FPS; // 180°
export function renderAt(t, opts = {}) {
  t = clamp(t, 0, DURATION);
  const n = opts.q ?? QUALITY;
  const source = opts.pose ? () => opts.pose : poseAt;
  const center = source(t);
  setWorldTime(t);
  drawAurora(center);
  pipe.render(n, (k, nn) => {
    const a = t - SHUTTER / 2 + (k / nn) * SHUTTER, b = a + SHUTTER / nn, c = (a + b) / 2;
    setWorldTime(c);
    const r1 = hash1(k * 13 + 1, Math.round(t * FPS)), r2 = hash1(k * 7 + 5, Math.round(t * FPS));
    const jitter = nn > 1 ? [(r1 - 0.5) * 1.0, (r2 - 0.5) * 1.0] : [0, 0];
    const vp0 = vpOf(tmpCam, source(a)), vp1 = vpOf(tmpCam, source(b));
    fx.setShutter(vp0, vp1);
    const invVP = drawScene(source(c), jitter[0], jitter[1]);
    return { invVP, vp0, vp1 };
  }, { frame: Math.round(t * FPS), ...postAt(t, center.speed ?? 0), ...(opts.exposure ? { exposure: opts.exposure } : {}), ...(opts.post ?? {}) });
}

// dev: time each pass with a GPU sync (SwiftShader runs asynchronously)
function profile(pose) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => { const rt = renderer.getRenderTarget(); renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); renderer.setRenderTarget(rt); };
  const out = {};
  let t = performance.now();
  const lap = (name) => { sync(); const n = performance.now(); out[name] = Math.round(n - t); t = n; };
  applyPose(camera, pose);
  terrain.update(camera);
  sky.setCamera(camera);
  lap("setup");
  drawAurora(pose);
  lap("aurora");
  applyPose(camera, pose);
  renderer.setRenderTarget(pipe.rtScene);
  renderer.clear(true, true, false);
  renderer.render(world, camera);
  lap("world");
  renderer.render(sky.skyScene, sky.orthoCam);
  lap("sky");
  const m = vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).clone();
  pipe.render(1, () => ({ invVP: m.clone().invert(), vp0: m, vp1: m }), { frame: 0 });
  lap("post");
  renderAt(5, { pose, q: 1 });
  lap("fullFrameQ1");
  return out;
}

window.__np = { renderAt, profile, city, fx, flight, BEATS, poseLookAt, setPoseSource, TD, terrain, camera, renderer, skyUniforms, terrainUniforms, THREE, timings: { data: tData - t0, total: performance.now() - t0 } };
if (window.__npBuilt) window.__npBuilt(renderAt);
