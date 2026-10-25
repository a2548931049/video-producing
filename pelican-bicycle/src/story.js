// The film's timeline. Everything downstream reads state from here: t (film seconds) → τ (story
// seconds, slowed during the wing-spread), bike distance, crank angle, rider pose.
import { clamp, lerp, smoothstep, seg, easeInOutSine, easeInOutCubic, noise1, fbm1, TAU } from "./util.js";
import { roadSlope } from "./world.js";
import { B } from "./bike.js";

export const DURATION = 40;
export const FPS = 30;

export const T = {
  doodleIn: 0.3,
  doodleOut: 4.4,
  build0: 4.4,
  build1: 10.6,
  wipe0: 10.4,
  wipe1: 12.4,
  rideStart: 10.4,
  cutDrive: 18.0,
  cutHead: 21.0,
  cutDescent: 24.0,
  coast: 25.6,
  spread0: 26.2,
  spread1: 27.6,
  slow0: 27.3,
  slow1: 30.2,
  fold0: 32.2,
  fold1: 33.8,
  cutAerial: 31.0,
  title: 35.6,
  bell: 36.5,
  end: 40,
};

// ---- time remap (slow motion while the wings are fully open)
const RATE_LOW = 0.32;
function rate(t) {
  const a = smoothstep(T.slow0 - 0.5, T.slow0 + 0.4, t);
  const b = 1 - smoothstep(T.slow1 - 0.4, T.slow1 + 0.6, t);
  return lerp(1, RATE_LOW, a * b);
}
const DT = 1 / 1200;
const N = Math.ceil((DURATION + 1) / DT);
const TAU_TABLE = new Float64Array(N + 1);
{
  let acc = 0;
  TAU_TABLE[0] = 0;
  for (let i = 1; i <= N; i++) {
    const t = (i - 0.5) * DT;
    acc += rate(t) * DT;
    TAU_TABLE[i] = acc;
  }
}
export function storyTime(t) {
  const f = clamp(t / DT, 0, N);
  const i = Math.floor(f);
  return lerp(TAU_TABLE[i], TAU_TABLE[Math.min(N, i + 1)], f - i);
}
export function timeRate(t) {
  return rate(t);
}

// ---- bike kinematics on the story clock
export const X_START = 0;
// exactly one crank revolution per second: two power strokes per second = 120 BPM
const CRUISE = 2 * Math.PI * B.Rw * (B.ringTeeth / B.cogTeeth);
const KIN_DT = 1 / 600;
const KN = Math.ceil((DURATION + 2) / KIN_DT);
const KX = new Float64Array(KN + 1);
const KV = new Float64Array(KN + 1);
{
  let x = X_START, v = 0;
  for (let i = 0; i <= KN; i++) {
    const tau = i * KIN_DT;
    KX[i] = x;
    KV[i] = v;
    let target = 0;
    if (tau > T.rideStart) {
      target = CRUISE * smoothstep(T.rideStart, T.rideStart + 2.2, tau);
      const slope = roadSlope(x);
      target += Math.max(0, -slope) * 24 * smoothstep(T.coast - 1, T.coast + 1, tau);
    }
    const lag = tau < T.coast ? 0.55 : 1.6;
    v += ((target - v) / lag) * KIN_DT;
    if (tau < T.rideStart) v = 0;
    x += v * KIN_DT;
  }
}
export function bikeX(tau) {
  const f = clamp(tau / KIN_DT, 0, KN);
  const i = Math.floor(f);
  return lerp(KX[i], KX[Math.min(KN, i + 1)], f - i);
}
export function bikeV(tau) {
  const f = clamp(tau / KIN_DT, 0, KN);
  const i = Math.floor(f);
  return lerp(KV[i], KV[Math.min(KN, i + 1)], f - i);
}

const GEAR = B.ringTeeth / B.cogTeeth;
function crankRaw(x) {
  return -((x - X_START) / B.Rw) / GEAR;
}
// phase so the right pedal is level-forward (power stroke) on every beat of the ride
const SYNC_T = 15.0;
const CRANK_PHASE = -(((crankRaw(bikeX(SYNC_T)) % Math.PI) + Math.PI) % Math.PI);
function crankFromX(x) {
  return crankRaw(x) + CRANK_PHASE;
}
// crank: driven by the wheel while pedalling; after T.coast it eases to a stop with the cranks level
const COAST_X = bikeX(T.coast);
const COAST_W = -(bikeV(T.coast) / B.Rw) / GEAR;
const CRANK_COAST = crankFromX(COAST_X);
const CRANK_STOP = Math.floor(CRANK_COAST / Math.PI - 0.35) * Math.PI; // next level position ahead
const STOP_DUR = Math.max(0.5, Math.min(1.2, (2 * (CRANK_STOP - CRANK_COAST)) / COAST_W));
export function crankAngle(tau) {
  if (tau <= T.coast) return crankFromX(bikeX(tau));
  const u = clamp((tau - T.coast) / STOP_DUR);
  // cubic Hermite: start value/slope match the pedalling, end at rest
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2;
  return h00 * CRANK_COAST + h10 * COAST_W * STOP_DUR + h01 * CRANK_STOP;
}

// ---- rider pose (on the story clock unless noted)
export function riderState(t, tau) {
  const s = {};
  s.t = tau;
  s.crank = crankAngle(tau);
  s.wheel = -(bikeX(tau) - X_START) / B.Rw;
  const v = bikeV(tau);
  s.speed = v;
  s.wind = clamp(0.15 + v / 9);
  s.pedaling = tau < T.coast ? clamp((tau - T.rideStart) / 1.5) : 1 - clamp((tau - T.coast) / 0.6);
  // steering: tiny corrections, scaled with speed
  s.steer = 0.012 * noise1(tau * 0.9 + 3) * clamp(v / 3) + 0.006 * Math.sin(s.crank) * s.pedaling;
  s.lean = 0;
  // feet off the pedals while coasting, back on near the end
  s.feetOff = smoothstep(T.coast + 0.35, T.coast + 1.2, tau) * (1 - smoothstep(storyTime(T.fold0), storyTime(T.fold1), tau));
  // wings
  const sp0 = storyTime(T.spread0), sp1 = storyTime(T.spread1), f0 = storyTime(T.fold0), f1 = storyTime(T.fold1);
  s.wingSpread = easeInOutCubic(seg(tau, sp0, sp1)) * (1 - easeInOutCubic(seg(tau, f0, f1)));
  s.wingFlap = 0.25 * s.wingSpread;
  // head: idle life + the glance at camera in the close-up
  const gl0 = storyTime(T.cutHead + 0.55), gl1 = storyTime(T.cutHead + 1.15), gb0 = storyTime(T.cutHead + 2.25), gb1 = storyTime(T.cutHead + 2.75);
  const glance = easeInOutSine(seg(tau, gl0, gl1)) * (1 - easeInOutSine(seg(tau, gb0, gb1)));
  s.headYaw = 0.05 * fbm1(tau * 0.35 + 11) + glance * 0.62;
  s.headPitch = 0.06 * fbm1(tau * 0.3 + 4) - glance * 0.06 + s.wingSpread * 0.12;
  s.headRoll = glance * 0.12;
  // blinks: one during the glance, a couple elsewhere
  const blinkAt = [storyTime(T.cutHead + 1.55), 15.3, 33.0];
  s.blink = 0;
  for (const b of blinkAt) {
    const d = tau - b;
    if (d > -0.08 && d < 0.18) s.blink = Math.max(s.blink, d < 0 ? 1 + d / 0.08 : 1 - d / 0.18);
  }
  s.pouchExtra = s.wingSpread * 0.6 * Math.sin(tau * 9) + (v > 6 ? (v - 6) * 0.25 * noise1(tau * 7) : 0);
  s.pouchSwayExtra = 0.6 * noise1(tau * 3.1 + 2) * clamp(v / 8);
  s.tailLift = s.wingSpread * 0.12;
  return s;
}
