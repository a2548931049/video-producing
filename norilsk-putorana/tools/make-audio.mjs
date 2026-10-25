// Synthesises assets/score.wav: 10 s of wind, smelter hum, pass-by whooshes and a pad,
// built entirely in code (no samples). Cues follow the camera (src/camera.js):
// 0.93 under the pipe overpass · building passes · 2.80 under the slab · 3.05 riser into the
// plume · 4.15 the cut · 5.43 the narrows · 6.7 the climb · 7.45 the name and the sun.
// Night is D minor, the canyon B♭maj7, the sunrise D major.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const DUR = 10;
const N = SR * DUR;
const TAU = Math.PI * 2;

// Two buses: dry, and a send into the reverb.
const DL = new Float32Array(N), DR = new Float32Array(N);
const SL = new Float32Array(N), SRb = new Float32Array(N);

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const lerp = (a, b, k) => a + (b - a) * k;

function pan2(v, pan) {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [v * Math.cos(a) * Math.SQRT2, v * Math.sin(a) * Math.SQRT2];
}
function add(i, l, r, send = 0) {
  if (i < 0 || i >= N) return;
  DL[i] += l;
  DR[i] += r;
  SL[i] += l * send;
  SRb[i] += r * send;
}

// RBJ biquad, transposed direct form II.
class Biquad {
  constructor(type = "lp", f = 1000, q = 0.707) {
    this.z1 = this.z2 = 0;
    this.set(type, f, q);
  }
  set(type, f, q) {
    const w = (TAU * clamp(f, 10, SR * 0.45)) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === "lp") (b0 = (1 - c) / 2), (b1 = 1 - c), (b2 = (1 - c) / 2);
    else if (type === "hp") (b0 = (1 + c) / 2), (b1 = -(1 + c)), (b2 = (1 + c) / 2);
    else (b0 = al), (b1 = 0), (b2 = -al);
    const a0 = 1 + al;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - al) / a0;
    this.type = type;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

function pinkGen(seed) {
  const r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return p * 0.11;
  };
}

// ---------------------------------------------------------------------------
// Wind: dark and gusty in the city, brighter and thinner on the plateau.
{
  const pl = pinkGen(11), pr = pinkGen(12);
  const lpL = new Biquad("lp", 500, 0.6), lpR = new Biquad("lp", 500, 0.6);
  const bpL = new Biquad("bp", 1200, 0.7), bpR = new Biquad("bp", 1200, 0.7);
  const hpL = new Biquad("hp", 110, 0.7), hpR = new Biquad("hp", 110, 0.7);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const gust = 0.5 + 0.3 * Math.sin(TAU * 0.23 * t + 1) + 0.2 * Math.sin(TAU * 0.61 * t + 2.3);
    if (i % 64 === 0) {
      // Under the slab the wind is cut off for a moment.
      const muffle = smooth(2.68, 2.8, t) * (1 - smooth(2.95, 3.08, t));
      const f = lerp(380 + 300 * gust, 160, muffle) + 900 * smooth(3.2, 4.1, t);
      lpL.set("lp", f, 0.6);
      lpR.set("lp", f * 1.07, 0.6);
      const fb = 900 + 500 * gust + 900 * smooth(6.7, 7.4, t);
      bpL.set("bp", fb, 0.7);
      bpR.set("bp", fb * 1.1, 0.7);
    }
    const nl = hpL.run(pl());
    const nr = hpR.run(pr());
    const city = (1 - smooth(4.0, 4.3, t)) * (0.55 + 0.45 * gust) * (1 - 0.6 * smooth(2.7, 2.82, t) * (1 - smooth(2.95, 3.1, t)));
    const rush = smooth(4.6, 5.0, t) * (1 - smooth(6.5, 7.0, t));
    const plat = smooth(4.1, 4.5, t) * (0.6 + 0.4 * gust) * (0.7 + 0.55 * rush + 0.8 * smooth(6.6, 7.3, t) * (1 - smooth(7.6, 8.8, t)));
    add(i, lpL.run(nl) * 0.55 * city + bpL.run(nl) * 0.42 * plat, lpR.run(nr) * 0.55 * city + bpR.run(nr) * 0.42 * plat);
  }
}

// Smelter hum (50 Hz mains and its harmonics) and a low rumble, fading into the plume.
{
  const br = rng(21);
  let brown = 0;
  const lp = new Biquad("lp", 90, 0.7);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const g = (1 - smooth(3.6, 4.15, t)) * smooth(0, 0.05, t) * (1 - 0.7 * smooth(2.7, 2.8, t) * (1 - smooth(2.95, 3.05, t)));
    if (g <= 0) continue;
    const am = 1 + 0.2 * Math.sin(TAU * 0.7 * t);
    let h = 0;
    [1, 0.5, 0.3, 0.15].forEach((a, k) => (h += a * Math.sin(TAU * 50 * (k + 1) * t + k)));
    brown = 0.995 * brown + (br() * 2 - 1) * 0.04;
    const v = g * (h * 0.012 * am + lp.run(brown) * 0.35);
    add(i, v, v);
  }
}

// ---------------------------------------------------------------------------
// Pad: detuned saws (PolyBLEP) through a lowpass that opens as the sun comes up.
function polyblep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
const CHORDS = [
  { t0: 0.0, t1: 4.35, fin: 1.4, fout: 0.5, gain: 1.0, notes: [73.42, 110.0, 174.61, 329.63, 440.0] }, // D minor add9
  { t0: 4.15, t1: 7.6, fin: 0.8, fout: 0.45, gain: 0.85, notes: [116.54, 174.61, 220.0, 293.66, 349.23] }, // B♭maj7
  { t0: 7.3, t1: 10.0, fin: 0.45, fout: 0.9, gain: 1.05, notes: [73.42, 110.0, 185.0, 220.0, 329.63, 369.99] }, // D major add9
];
{
  const r = rng(31);
  const lpL = new Biquad("lp", 800, 0.9), lpR = new Biquad("lp", 800, 0.9);
  const voices = [];
  CHORDS.forEach((c, ci) =>
    c.notes.forEach((f, ni) => {
      for (const cents of [-8, 0, 7]) {
        const [gl, gr] = pan2(1, ((ni / (c.notes.length - 1)) * 2 - 1) * 0.6 + cents * 0.02);
        voices.push({ ci, f: f * Math.pow(2, cents / 1200), ph: r(), gl, gr });
      }
    }),
  );
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    if (i % 64 === 0) {
      const cut = lerp(lerp(650, 1250, smooth(4.2, 5.0, t)), 3300, smooth(7.35, 8.4, t)) * (1 - 0.45 * smooth(3.3, 4.1, t) * (1 - smooth(4.15, 4.6, t)));
      lpL.set("lp", cut, 0.9);
      lpR.set("lp", cut * 1.05, 0.9);
    }
    const amp = CHORDS.map((c) => c.gain * smooth(c.t0, c.t0 + c.fin, t) * (1 - smooth(c.t1 - c.fout, c.t1, t)));
    let l = 0, rr = 0;
    for (const v of voices) {
      const a = amp[v.ci];
      const dt = v.f / SR;
      v.ph += dt;
      if (v.ph >= 1) v.ph -= 1;
      if (a <= 0) continue;
      const s = (2 * v.ph - 1 - polyblep(v.ph, dt)) * a;
      l += s * v.gl;
      rr += s * v.gr;
    }
    const g = 0.022 * (1 - 0.5 * smooth(3.3, 4.1, t) * (1 - smooth(4.15, 4.7, t)));
    add(i, lpL.run(l) * g, lpR.run(rr) * g, 0.9);
  }
}

// ---------------------------------------------------------------------------
// Whooshes: band-passed noise that rises in pitch toward the pass and falls after it.
let wseed = 100;
function whoosh(tp, attack, release, f0, fp, f1, gain, panFrom, panTo, q = 1.1, send = 0.35) {
  const r = rng(wseed++);
  const bp = new Biquad("bp", f0, q);
  const s0 = Math.round((tp - attack) * SR);
  const s1 = Math.round((tp + release) * SR);
  for (let i = Math.max(0, s0); i < Math.min(N, s1); i++) {
    const t = i / SR;
    let env, f;
    if (t < tp) {
      const u = clamp((t - (tp - attack)) / attack);
      env = Math.pow(u, 2.4);
      f = f0 * Math.pow(fp / f0, u);
    } else {
      const v = clamp((t - tp) / release);
      env = Math.exp(-v * 4.5) * (1 - v);
      f = fp * Math.pow(f1 / fp, v);
    }
    if ((i - s0) % 32 === 0) bp.set("bp", f, q);
    const x = bp.run(r() * 2 - 1) * env * gain;
    const u = (t - (tp - attack)) / (attack + release);
    const [l, rr] = pan2(x, lerp(panFrom, panTo, u));
    add(i, l, rr, send);
  }
}

whoosh(0.93, 0.5, 0.45, 450, 1900, 500, 0.55, -0.1, 0.1); // under the pipe overpass
// Facades sliding past, left and right (the camera crosses each front at these times).
[[0.45, -0.75], [0.81, 0.75], [1.29, -0.75], [1.66, 0.75], [2.02, -0.75], [2.37, 0.75]].forEach(([tp, pan], k) =>
  whoosh(tp, 0.28, 0.3, 300, 1100 + k * 60, 380, 0.22, pan * 0.4, pan, 1.3, 0.25),
);

// Under the slab: a muffled thump, then air as the far side opens.
{
  const r = rng(41);
  const lp = new Biquad("lp", 220, 0.7);
  const s0 = Math.round(2.79 * SR);
  for (let k = 0; k < 0.7 * SR; k++) {
    const tau = k / SR;
    const ph = TAU * (38 * tau + (24 * (1 - Math.exp(-tau * 9))) / 9);
    const v = Math.sin(ph) * Math.exp(-tau * 7) * Math.min(1, tau * 400) * 0.42 + lp.run(r() * 2 - 1) * Math.exp(-tau * 12) * 0.5;
    add(s0 + k, v, v, 0.2);
  }
}
whoosh(3.02, 0.12, 0.6, 900, 3200, 700, 0.28, 0, 0, 0.8);

// Riser into the plume, then the burst of air on the cut.
{
  const rl = rng(51), rrn = rng(52);
  const bpL = new Biquad("bp", 300, 1.4), bpR = new Biquad("bp", 300, 1.4);
  const hpL = new Biquad("hp", 4000, 0.7), hpR = new Biquad("hp", 4000, 0.7);
  for (let i = Math.round(3.05 * SR); i < Math.round(4.17 * SR); i++) {
    const t = i / SR;
    const u = clamp((t - 3.05) / 1.1);
    if (i % 32 === 0) {
      bpL.set("bp", 260 * Math.pow(22, u), 1.4);
      bpR.set("bp", 280 * Math.pow(22, u), 1.4);
    }
    const env = Math.pow(u, 2.3) * 0.5;
    const nl = rl() * 2 - 1, nr = rrn() * 2 - 1;
    add(i, bpL.run(nl) * env + hpL.run(nl) * env * 0.12, bpR.run(nr) * env + hpR.run(nr) * env * 0.12, 0.3);
  }
}
{
  const rl = rng(61), rrn = rng(62);
  const lpL = new Biquad("lp", 9000, 0.7), lpR = new Biquad("lp", 9000, 0.7);
  const s0 = Math.round(4.15 * SR);
  for (let k = 0; k < 1.2 * SR; k++) {
    const tau = k / SR;
    if (k % 32 === 0) {
      const f = 9000 * Math.pow(600 / 9000, clamp(tau / 0.9));
      lpL.set("lp", f, 0.7);
      lpR.set("lp", f * 0.92, 0.7);
    }
    const env = Math.min(1, tau * 60) * Math.exp(-tau * 3.2) * 0.42;
    add(s0 + k, lpL.run(rl() * 2 - 1) * env, lpR.run(rrn() * 2 - 1) * env, 0.5);
  }
}
whoosh(4.4, 0.18, 0.5, 700, 2400, 900, 0.18, 0.3, -0.3, 0.9); // the cloud tears open
whoosh(5.28, 0.3, 0.32, 400, 1700, 520, 0.2, 0.3, 0.85); // the icefall leaves frame right
whoosh(5.43, 0.32, 0.36, 320, 1500, 420, 0.32, -0.3, -0.85); // the narrows, wall on the left
whoosh(6.22, 0.3, 0.34, 350, 1400, 450, 0.2, 0.2, 0.8); // banking past the right wall
whoosh(7.12, 0.48, 0.45, 220, 2600, 1200, 0.3, 0, 0, 0.9); // the climb out of the canyon

// The name and the sun: a soft, low bloom — no chime.
{
  const r = rng(71);
  const lp = new Biquad("lp", 180, 0.7);
  const s0 = Math.round(7.44 * SR);
  for (let k = 0; k < 2.4 * SR; k++) {
    const tau = k / SR;
    const ph = TAU * (40 * tau + (32 * (1 - Math.exp(-tau * 5))) / 5);
    const v = Math.sin(ph) * Math.exp(-tau * 2.4) * Math.min(1, tau * 120) * 0.38 + lp.run(r() * 2 - 1) * Math.exp(-tau * 9) * Math.min(1, tau * 300) * 0.5;
    add(s0 + k, v, v, 0.35);
  }
}
// Air brightening as the light arrives.
{
  const rl = rng(81), rrn = rng(82);
  const hpL = new Biquad("hp", 5000, 0.7), hpR = new Biquad("hp", 5200, 0.7);
  for (let i = Math.round(7.2 * SR); i < N; i++) {
    const t = i / SR;
    const env = smooth(7.25, 7.9, t) * (1 - smooth(8.6, 9.9, t)) * 0.045;
    add(i, hpL.run(rl() * 2 - 1) * env, hpR.run(rrn() * 2 - 1) * env, 0.6);
  }
}

// ---------------------------------------------------------------------------
// Freeverb-style room on the send bus.
function freeverb(inp, spread) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0, store: 0 }));
  const aps = [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0 }));
  const room = 0.86, damp = 0.32;
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const x = inp[n] * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.store = o * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * room;
      if (++c.i >= c.buf.length) c.i = 0;
      y += o;
    }
    for (const a of aps) {
      const b = a.buf[a.i];
      a.buf[a.i] = y + b * 0.5;
      y = b - y;
      if (++a.i >= a.buf.length) a.i = 0;
    }
    out[n] = y;
  }
  return out;
}
const WL = freeverb(SL, 0);
const WR = freeverb(SRb, 23);

// ---------------------------------------------------------------------------
// Master: mix, fade the edges, soft-limit, normalise to a fixed RMS.
const L = new Float32Array(N), R = new Float32Array(N);
let sum = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = smooth(0, 0.03, t) * (1 - smooth(9.25, 10.0, t));
  L[i] = (DL[i] + WL[i] * 1.6) * fade;
  R[i] = (DR[i] + WR[i] * 1.6) * fade;
  sum += L[i] * L[i] + R[i] * R[i];
}
const rms = Math.sqrt(sum / (2 * N));
const gain = Math.pow(10, -17 / 20) / rms;
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * gain * 1.1) / 1.1;
  R[i] = Math.tanh(R[i] * gain * 1.1) / 1.1;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const ceil = Math.pow(10, -1.5 / 20);
if (peak > ceil) for (let i = 0; i < N; i++) (L[i] *= ceil / peak), (R[i] *= ceil / peak);

// 24-bit PCM WAV.
const bytes = 44 + N * 2 * 3;
const buf = Buffer.alloc(bytes);
buf.write("RIFF", 0);
buf.writeUInt32LE(bytes - 8, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 6, 28);
buf.writeUInt16LE(6, 32);
buf.writeUInt16LE(24, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 6, 40);
let o = 44;
for (let i = 0; i < N; i++) {
  for (const v of [L[i], R[i]]) {
    const s = Math.round(clamp(v, -1, 1) * 8388607);
    buf.writeIntLE(s, o, 3);
    o += 3;
  }
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/score.wav");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`wrote ${out} (${DUR}s, peak ${(20 * Math.log10(Math.max(peak * gain, 1e-9))).toFixed(1)} dBFS before ceiling)`);
