// Synthesises the 10 s score + sound design → assets/score.wav (48 kHz, stereo, 16-bit). No samples.
//
//   node tools/make-audio.mjs
//
// 117 BPM so the picture's beats fall on the grid: archway = beat 4 (2.05 s), roof crest = beat 7 (3.59 s),
// speed ramp = beat 8 (4.10 s). D minor in the city; the reveal over the ridge opens into D major.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "assets", "score.wav");
const SR = 48000;
const DUR = 10.0;
const N = Math.round(SR * DUR);
const BPM = 117;
const BEAT = 60 / BPM;
const L = new Float32Array(N), R = new Float32Array(N);

// ---------- helpers ----------
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, Bb: 10, B: 11 };
const n = (name, oct) => 12 * (oct + 1) + NOTE[name];
function add(buf, i, v) {
  if (i >= 0 && i < N) buf[i] += v;
}
function addStereo(i, v, pan) {
  // equal-power pan, pan in [-1, 1]
  const a = (pan + 1) * Math.PI / 4;
  add(L, i, v * Math.cos(a));
  add(R, i, v * Math.sin(a));
}

// state-variable filter (Chamberlin, oversampled ×2 for stability at high cutoff)
function svf() {
  let lp = 0, bp = 0;
  return (x, fc, q, mode = "lp") => {
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR * 0.24) / (SR * 2));
    const damp = 1 / q;
    let hp;
    for (let k = 0; k < 2; k++) {
      lp += f * bp;
      hp = x - lp - damp * bp;
      bp += f * hp;
    }
    return mode === "lp" ? lp : mode === "bp" ? bp : hp;
  };
}

// ---------- speed of the camera (from src/camera.js anchors), drives wind ----------
const SPD_T = [0, 1.2, 2.0, 2.6, 3.3, 3.6, 3.9, 4.2, 4.45, 4.8, 5.0, 5.4, 6.2, 7.0, 7.6, 8.1, 8.5, 9.0, 9.5, 10];
const SPD_V = [70, 69, 82, 80, 45, 36, 80, 440, 780, 1490, 1670, 1590, 1450, 1470, 1530, 1500, 1000, 650, 300, 200];
const speed = (t) => {
  let i = 0;
  while (i < SPD_T.length - 2 && t > SPD_T[i + 1]) i++;
  const u = clamp((t - SPD_T[i]) / (SPD_T[i + 1] - SPD_T[i]), 0, 1);
  const s = u * u * (3 - 2 * u);
  return SPD_V[i] + (SPD_V[i + 1] - SPD_V[i]) * s;
};

// ---------- 1. pad: detuned saw stacks through a slow lowpass ----------
function pad(notes, t0, t1, gain, cutoff0, cutoff1, attack = 0.8, release = 1.2, width = 0.6) {
  for (const [vi, m] of notes.entries()) {
    const voices = 5;
    for (let v = 0; v < voices; v++) {
      const det = (v - (voices - 1) / 2) * 0.09; // cents-ish spread in semitones
      const f = mtof(m + det);
      const pan = ((v / (voices - 1)) * 2 - 1) * width * (vi % 2 ? -1 : 1);
      const flt = svf();
      let ph = rnd();
      const i0 = Math.floor(t0 * SR), i1 = Math.min(N, Math.floor((t1 + release) * SR));
      for (let i = i0; i < i1; i++) {
        const t = i / SR;
        ph += f / SR;
        ph -= Math.floor(ph);
        // band-limited-ish saw: polyBLEP
        const dt = f / SR;
        let saw = 2 * ph - 1;
        if (ph < dt) { const x = ph / dt; saw -= x + x - x * x - 1; }
        else if (ph > 1 - dt) { const x = (ph - 1) / dt; saw -= x * x + x + x + 1; }
        const env = smooth(t0, t0 + attack, t) * (1 - smooth(t1, t1 + release, t));
        const fc = cutoff0 + (cutoff1 - cutoff0) * smooth(t0, t1, t);
        const y = flt(saw, fc, 0.9);
        addStereo(i, y * env * gain / voices, pan);
      }
    }
  }
}

// ---------- 2. plucked arpeggio (city) ----------
function pluck(t, m, gain, pan, bright) {
  const f = mtof(m);
  const i0 = Math.floor(t * SR);
  const len = Math.floor(0.42 * SR);
  const flt = svf();
  let ph = rnd();
  for (let k = 0; k < len; k++) {
    const tt = k / SR;
    ph += f / SR;
    ph -= Math.floor(ph);
    const sq = (ph < 0.5 ? 1 : -1) * 0.6 + Math.sin(2 * Math.PI * ph) * 0.6;
    const env = Math.exp(-tt * 9) * smooth(0, 0.003, tt);
    const fc = 300 + bright * 5200 * Math.exp(-tt * 14);
    addStereo(i0 + k, flt(sq, fc, 1.2) * env * gain, pan);
  }
}

// ---------- 3. noise sweeps (whooshes, risers, wind) ----------
function whoosh(t0, t1, gain, f0, f1, pan0, pan1, q = 1.4, shape = 2) {
  const flt = svf();
  const i0 = Math.floor(t0 * SR), i1 = Math.floor(t1 * SR);
  for (let i = i0; i < i1; i++) {
    const u = (i - i0) / (i1 - i0);
    const env = Math.sin(Math.PI * u) ** shape;
    const fc = f0 * (f1 / f0) ** u;
    const y = flt(rnd() * 2 - 1, fc, q, "bp");
    addStereo(i, y * env * gain, pan0 + (pan1 - pan0) * u);
  }
}

// ---------- 4. sub hits ----------
function boom(t, gain, f0 = 58, decay = 1.6, click = 0.4) {
  const i0 = Math.floor(t * SR);
  let ph = 0;
  for (let k = 0; k < Math.floor((decay * 3 + 0.2) * SR); k++) {
    const tt = k / SR;
    const f = f0 * (1 + 1.8 * Math.exp(-tt * 18));
    ph += f / SR;
    const env = Math.exp(-tt / decay) * smooth(0, 0.004, tt);
    const y = Math.sin(2 * Math.PI * ph) * env + (rnd() * 2 - 1) * Math.exp(-tt * 60) * click;
    addStereo(i0 + k, y * gain, 0);
  }
}

// ---------- 5. bell / shimmer ----------
function bell(t, m, gain, pan, decay = 2.2) {
  const f = mtof(m);
  const partials = [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12]];
  const i0 = Math.floor(t * SR);
  for (let k = 0; k < Math.floor(decay * 2.5 * SR); k++) {
    const tt = k / SR;
    let y = 0;
    for (const [r, a] of partials) if (f * r < 12000) y += Math.sin(2 * Math.PI * f * r * tt) * a * Math.exp(-tt * (1 + r * 0.6) / decay);
    addStereo(i0 + k, y * gain * smooth(0, 0.002, tt), pan);
  }
}

// ================= the cue =================
const bt = (b) => b * BEAT; // beat → seconds

// city: D minor (add9) pad, warm and filtered
pad([n("D", 2), n("A", 2), n("D", 3), n("F", 3), n("E", 4)], 0.0, 3.55, 0.11, 380, 1500, 0.05, 0.6);
// the arpeggio: 16ths, two bars, rising register on the climb; muffled through the archway
{
  const seqA = [n("D", 4), n("F", 4), n("A", 4), n("E", 5), n("D", 5), n("A", 4), n("F", 4), n("A", 4)];
  const seqB = [n("F", 4), n("A", 4), n("C", 5), n("G", 5), n("F", 5), n("C", 5), n("A", 4), n("C", 5)];
  const seqC = [n("A", 4), n("C", 5), n("E", 5), n("A", 5), n("G", 5), n("E", 5), n("C", 5), n("E", 5)];
  for (let s = 0; s < 28; s++) {
    const t = bt(s / 4);
    if (t > 3.52) break;
    const seq = t < bt(4) ? seqA : t < bt(5.5) ? seqB : seqC;
    const m = seq[s % 8];
    const inArch = t > 1.98 && t < 2.2;
    const bright = inArch ? 0.08 : 0.25 + 0.75 * smooth(0, 3.4, t);
    const g = (0.1 + 0.08 * smooth(0, 3.4, t)) * (s % 4 === 0 ? 1.25 : 1) * (inArch ? 0.5 : 1);
    pluck(t, m, g, s % 2 ? 0.35 : -0.35, bright);
  }
}
// kick on the beats in the city, softer at first
for (let b = 0; b < 7; b++) boom(bt(b), 0.17 + 0.04 * b, 52, 0.18, 0.15);
// streetlights flicking past the camera
for (let t = 0.1; t < 1.95; t += 0.245) whoosh(t, t + 0.16, 0.05, 2500, 900, (t * 7) % 2 > 1 ? -0.7 : 0.7, 0, 3.5, 2);
// the archway: in fast, a short tunnel boom, out
whoosh(1.7, 2.3, 0.32, 300, 2400, -0.2, 0.2, 1.2, 1.6);
boom(bt(4), 0.32, 44, 0.35, 0.3);
// climbing the facade: rising whoosh, windows streaming
whoosh(2.45, 3.55, 0.2, 500, 5200, 0, 0, 1.6, 1.2);
// the crest: everything holds its breath (a soft air swell only)
whoosh(3.45, 4.05, 0.07, 900, 1600, 0, 0, 0.8, 2);
// the ramp: a reverse swell into a sub drop on beat 8, then the warp riser
{
  const i0 = Math.floor(3.55 * SR), i1 = Math.floor(bt(8) * SR);
  const flt = svf();
  for (let i = i0; i < i1; i++) {
    const u = (i - i0) / (i1 - i0);
    addStereo(i, flt(rnd() * 2 - 1, 400 + 7000 * u * u, 0.9, "bp") * u ** 3 * 0.5, 0);
  }
}
boom(bt(8), 0.62, 41, 1.1, 0.9);
whoosh(bt(8), 5.05, 0.28, 180, 6200, -0.5, 0.5, 1.1, 0.9);
// cold pad for the plateau: D minor, wide and bright, under everything from the ramp on
pad([n("D", 2), n("A", 2), n("F", 3), n("A", 3), n("D", 4)], 3.9, 8.3, 0.075, 600, 2600, 0.9, 0.5, 0.9);
// the valley: an eighth-note pulse on low D, driving
for (let b = 10.5; b < 16.2; b += 0.5) {
  const t = bt(b);
  boom(t, 0.11 + (b % 1 === 0 ? 0.05 : 0), 46, 0.12, 0.1);
}
// the bank to the right, and the climb up the ridge
whoosh(6.75, 7.35, 0.26, 400, 2800, -0.6, 0.8, 1.3, 1.5);
{
  const i0 = Math.floor(7.4 * SR), i1 = Math.floor(8.46 * SR);
  const flt = svf();
  for (let i = i0; i < i1; i++) {
    const u = (i - i0) / (i1 - i0);
    addStereo(i, flt(rnd() * 2 - 1, 300 + 6500 * u * u, 1.1, "bp") * u ** 2.5 * 0.34, Math.sin(u * 9) * 0.3);
  }
}
// the reveal: the ground drops away — sub boom, the chord opens into D major, shimmer like the aurora
boom(8.46, 0.7, 36, 2.2, 0.6);
pad([n("D", 2), n("A", 2), n("D", 3), n("F#", 3), n("A", 3), n("D", 4), n("F#", 4), n("A", 4)], 8.42, 9.6, 0.13, 900, 3600, 0.12, 1.6, 1.0);
for (const [k, m] of [n("A", 5), n("D", 6), n("F#", 6), n("A", 6), n("E", 6), n("D", 7)].entries()) bell(8.55 + k * 0.17, m, 0.06 - k * 0.006, k % 2 ? 0.55 : -0.55, 1.6);
bell(8.6, n("D", 5), 0.09, 0, 2.6);

// wind: the air the camera tears through, rising with speed (two band-passed noise layers)
{
  const f1 = svf(), f2 = svf(), f3 = svf();
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const s = speed(t);
    const amt = 0.03 + 0.24 * smooth(60, 1600, s);
    const w1 = f1(rnd() * 2 - 1, 280 + s * 1.2, 0.7, "bp");
    const w2 = f2(rnd() * 2 - 1, 900 + s * 2.4, 1.6, "bp");
    const gust = 0.8 + 0.2 * Math.sin(t * 2.3) * Math.sin(t * 0.7 + 1);
    const y = f3((w1 * 0.7 + w2 * 0.4) * amt * gust, 6000, 0.7);
    addStereo(i, y, Math.sin(t * 1.3) * 0.3);
  }
}

// ---------- reverb (Freeverb-style), mixed in; then master ----------
function reverb(inL, inR, mix, size = 0.86, damp = 0.35) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((d) => Math.round((d * SR) / 44100));
  const aps = [556, 441, 341, 225].map((d) => Math.round((d * SR) / 44100));
  const run = (inp, spread) => {
    const out = new Float32Array(N);
    for (const d0 of combs) {
      const d = d0 + spread;
      const buf = new Float32Array(d);
      let idx = 0, store = 0;
      for (let i = 0; i < N; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = inp[i] * 0.015 + store * size;
        idx = (idx + 1) % d;
        out[i] += y;
      }
    }
    for (const d0 of aps) {
      const d = d0 + spread;
      const buf = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < N; i++) {
        const b = buf[idx];
        const y = -out[i] + b;
        buf[idx] = out[i] + b * 0.5;
        idx = (idx + 1) % d;
        out[i] = y;
      }
    }
    return out;
  };
  const wl = run(inL, 0), wr = run(inR, 23);
  for (let i = 0; i < N; i++) {
    inL[i] = inL[i] * (1 - mix * 0.4) + wl[i] * mix;
    inR[i] = inR[i] * (1 - mix * 0.4) + wr[i] * mix;
  }
}
reverb(L, R, 0.55);

// master: gentle fade at the very end, soft clip, normalise to -1 dBFS
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = 1 - smooth(9.7, 10.0, t);
  L[i] = Math.tanh(L[i] * g * 1.15);
  R[i] = Math.tanh(R[i] * g * 1.15);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.891 / peak;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0);
pcm.writeUInt32LE(36 + N * 4, 4);
pcm.write("WAVE", 8);
pcm.write("fmt ", 12);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36);
pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(clamp(L[i] * norm, -1, 1) * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(clamp(R[i] * norm, -1, 1) * 32767), 46 + i * 4);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, pcm);
console.log(`wrote ${OUT} (${DUR}s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS before normalising)`);
