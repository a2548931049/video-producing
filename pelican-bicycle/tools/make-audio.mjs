// Score + sound design for "鹈鹕骑自行车", synthesised from scratch (no samples).
// 120 BPM in D major: the pelican pedals at one revolution per second, so every power stroke is a beat.
// Reads tools/timeline.json (exported from the real story clock) so the sound follows the picture.
// usage: node tools/make-audio.mjs   →  assets/score.wav
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SR = 44100;
const DUR = 40;
const N = SR * DUR;
const TL = JSON.parse(fs.readFileSync(path.join(HERE, "timeline.json"), "utf8"));
const T = TL.T;

// ------------------------------------------------------------------ utils
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const nm = (s) => {
  const m = s.match(/^([A-G][#b]?)(-?\d)$/);
  return 12 * (+m[2] + 1) + NOTE[m[1]];
};
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function tl(t) {
  const i = clamp(Math.round(t * 200), 0, TL.rows.length - 1);
  const r = TL.rows[i];
  return { tau: r[1], v: r[2], crank: r[3], rate: r[4] };
}

const dryL = new Float32Array(N), dryR = new Float32Array(N);
const sendL = new Float32Array(N), sendR = new Float32Array(N);
function mix(t0, buf, { gain = 1, pan = 0, send = 0.2 } = {}) {
  const s0 = Math.round(t0 * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < buf.length; i++) {
    const k = s0 + i;
    if (k < 0 || k >= N) continue;
    const x = buf[i];
    dryL[k] += x * gl; dryR[k] += x * gr;
    sendL[k] += x * gl * send; sendR[k] += x * gr * send;
  }
}
// one-pole filters
function lowpass(buf, fc) {
  const a = Math.exp(-2 * Math.PI * fc / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y = (1 - a) * buf[i] + a * y; buf[i] = y; }
  return buf;
}
function highpass(buf, fc) {
  const a = Math.exp(-2 * Math.PI * fc / SR);
  let y = 0, xp = 0;
  for (let i = 0; i < buf.length; i++) { y = a * (y + buf[i] - xp); xp = buf[i]; buf[i] = y; }
  return buf;
}
// zero-delay-feedback state-variable band-pass (stable at any cutoff), time-varying centre
function bandpass(buf, fcFn, q = 1.2) {
  let ic1 = 0, ic2 = 0;
  const k = 1 / q;
  for (let i = 0; i < buf.length; i++) {
    const g = Math.tan(Math.PI * Math.min(fcFn(i / SR), SR * 0.45) / SR);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = buf[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[i] = v1 * k;
  }
  return buf;
}
const noise = (n) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = rnd() * 2 - 1; return b; };
const env = (i, a, d, len) => {
  const t = i / SR;
  if (t < a) return t / a;
  return Math.exp(-(t - a) / d) * (t > len ? Math.exp(-(t - len) / 0.05) : 1);
};

// ------------------------------------------------------------------ instruments
// Karplus–Strong nylon-ish pluck
function pluck(m, dur, vel = 0.8, bright = 0.5) {
  const f = midi(m);
  const len = Math.floor((dur + 1.6) * SR);
  const out = new Float32Array(len);
  const P = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(P);
  let lp = 0;
  for (let i = 0; i < P; i++) { const x = rnd() * 2 - 1; lp = lp + (x - lp) * (0.25 + 0.6 * bright); buf[i] = lp; }
  // remove DC from the excitation, otherwise the loop holds a slowly decaying offset (thumps)
  let mean = 0;
  for (let i = 0; i < P; i++) mean += buf[i];
  mean /= P;
  for (let i = 0; i < P; i++) buf[i] -= mean;
  let idx = 0;
  const damp = 0.996 - (m > 76 ? 0.003 : 0);
  for (let i = 0; i < len; i++) {
    const a = buf[idx], b = buf[(idx + 1) % P];
    const y = damp * 0.5 * (a + b);
    buf[idx] = y;
    out[i] = a * vel * (i / SR > dur ? Math.exp(-(i / SR - dur) / 0.25) : 1);
    idx = (idx + 1) % P;
  }
  return highpass(lowpass(out, 5200), 70);
}
function strum(t, notes, dir, vel, opts) {
  const order = dir > 0 ? notes : [...notes].reverse();
  order.forEach((m, k) => mix(t + k * 0.011, pluck(m, 0.42, vel * (0.85 + 0.3 * rnd()), 0.45), opts));
}
// music box / celesta
function bell(m, dur = 1.6, vel = 0.5) {
  const f = midi(m);
  const len = Math.floor((dur + 0.5) * SR);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.min(1, t / 0.002) * Math.exp(-t / (dur * 0.35));
    out[i] = vel * e * (Math.sin(2 * Math.PI * f * t + 0.6 * Math.sin(2 * Math.PI * f * 3.5 * t) * Math.exp(-t * 6)) + 0.18 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 3));
  }
  return out;
}
// warm pad: detuned saws through a soft low-pass
function pad(notes, dur, vel = 0.12, fc = 1400, att = 0.8, rel = 1.5) {
  const len = Math.floor((dur + rel) * SR);
  const out = new Float32Array(len);
  for (const m of notes) {
    for (const det of [-0.11, 0, 0.09]) {
      const f = midi(m + det);
      let ph = rnd();
      for (let i = 0; i < len; i++) {
        ph += f / SR; ph -= Math.floor(ph);
        out[i] += (2 * ph - 1) * vel / notes.length;
      }
    }
  }
  lowpass(out, fc); lowpass(out, fc * 1.2);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    out[i] *= Math.min(1, t / att) * (t > dur ? Math.exp(-(t - dur) / (rel * 0.4)) : 1);
  }
  return out;
}
// string ensemble with vibrato (for the slow motion)
function strings(m, dur, vel = 0.1, att = 1.0, rel = 1.2) {
  const len = Math.floor((dur + rel) * SR);
  const out = new Float32Array(len);
  for (let v = 0; v < 6; v++) {
    const f = midi(m + (v - 2.5) * 0.04);
    let ph = rnd();
    const vr = 5 + v * 0.3;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const vib = 1 + 0.004 * Math.sin(2 * Math.PI * vr * t) * Math.min(1, t / 0.6);
      ph += f * vib / SR; ph -= Math.floor(ph);
      out[i] += (2 * ph - 1) * vel / 6;
    }
  }
  lowpass(out, 2600); lowpass(out, 3200);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    out[i] *= smooth(0, att, t) * (t > dur ? Math.exp(-(t - dur) / (rel * 0.4)) : 1);
  }
  return out;
}
// whistled melody line: sine, gentle vibrato, breath, glides between notes
function whistle(notes, vel = 0.16) {
  // notes: [t, midi, dur]
  const tStart = notes[0][0], tEnd = notes[notes.length - 1][0] + notes[notes.length - 1][2] + 0.3;
  const len = Math.floor((tEnd - tStart) * SR);
  const out = new Float32Array(len);
  let ph = 0, fPrev = midi(notes[0][1]);
  const br = noise(len);
  bandpass(br, () => 2600, 2.0);
  for (let i = 0; i < len; i++) {
    const t = tStart + i / SR;
    let cur = null;
    for (const n of notes) if (t >= n[0] - 0.02 && t < n[0] + n[2] + 0.12) cur = n;
    let a = 0, fT = fPrev;
    if (cur) {
      const local = t - cur[0];
      fT = midi(cur[1]);
      a = smooth(-0.02, 0.05, local) * (local > cur[2] ? Math.exp(-(local - cur[2]) / 0.05) : 1);
      a *= 1 - 0.15 * smooth(0, cur[2], local);
    }
    fPrev += (fT - fPrev) * 0.0035;
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.4 * t) * smooth(0.12, 0.35, cur ? t - cur[0] : 0);
    ph += fPrev * vib / SR;
    out[i] = (Math.sin(2 * Math.PI * ph) + 0.06 * Math.sin(4 * Math.PI * ph)) * a * vel + br[i] * a * vel * 0.12;
  }
  return { start: tStart, buf: out };
}
function bassNote(m, dur, vel = 0.32) {
  const f = midi(m);
  const len = Math.floor((dur + 0.4) * SR);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.min(1, t / 0.008) * Math.exp(-t / 0.6) * (t > dur ? Math.exp(-(t - dur) / 0.06) : 1);
    const x = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 8);
    out[i] = Math.tanh(x * 1.4) * e * vel;
  }
  return out;
}
function kick(vel = 0.6) {
  const len = Math.floor(0.45 * SR), out = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 48 + 70 * Math.exp(-t * 28);
    ph += f / SR;
    out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.16) * vel + (i < 90 ? (rnd() - 0.5) * 0.25 * vel * (1 - i / 90) : 0);
  }
  return out;
}
function brush(vel = 0.25, long = 0.18) {
  const len = Math.floor((long + 0.1) * SR);
  const out = noise(len);
  bandpass(out, () => 3800, 0.7);
  for (let i = 0; i < len; i++) { const t = i / SR; out[i] *= vel * smooth(0, 0.012, t) * Math.exp(-t / (long * 0.45)); }
  return out;
}
function shaker(vel = 0.06) {
  const len = Math.floor(0.07 * SR), out = noise(len);
  highpass(out, 6000);
  for (let i = 0; i < len; i++) { const t = i / SR; out[i] *= vel * smooth(0, 0.006, t) * Math.exp(-t / 0.02); }
  return out;
}
function tick(freq = 3200, vel = 0.12, dec = 0.012) {
  const len = Math.floor(0.05 * SR), out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    out[i] = vel * Math.exp(-t / dec) * (Math.sin(2 * Math.PI * freq * t) * 0.6 + Math.sin(2 * Math.PI * freq * 1.63 * t) * 0.3 + (rnd() - 0.5) * 0.5 * Math.exp(-t / 0.002));
  }
  return out;
}
function metalClick(vel = 0.2) {
  const len = Math.floor(0.12 * SR), out = new Float32Array(len);
  const fs3 = [2150 + rnd() * 200, 3420 + rnd() * 300, 5230 + rnd() * 400];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let x = 0;
    fs3.forEach((f, k) => (x += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / (0.03 / (k + 1)))));
    out[i] = vel * (x * 0.4 + (rnd() - 0.5) * Math.exp(-t / 0.0015));
  }
  return out;
}
function bicycleBell(vel = 0.35) {
  const len = Math.floor(1.8 * SR), out = new Float32Array(len);
  const P = [[2330, 1, 0.9], [2337, 0.8, 0.9], [4740, 0.35, 0.45], [6960, 0.22, 0.3], [9520, 0.1, 0.18]];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let x = 0;
    for (const [f, a, d] of P) x += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d);
    out[i] = vel * x * Math.min(1, t / 0.0015) * 0.45 + (i < 40 ? (rnd() - 0.5) * vel * 0.6 : 0);
  }
  return out;
}

// ------------------------------------------------------------------ harmony
const CH = {
  Dmaj7: { bass: nm("D2"), v: ["D4", "F#4", "A4", "C#5"].map(nm) },
  Bm7: { bass: nm("B1"), v: ["D4", "F#4", "A4", "B4"].map(nm) },
  Gmaj7: { bass: nm("G1"), v: ["D4", "F#4", "G4", "B4"].map(nm) },
  A7sus: { bass: nm("A1"), v: ["D4", "E4", "G4", "A4"].map(nm) },
  A: { bass: nm("A1"), v: ["C#4", "E4", "A4", "E5"].map(nm) },
  Gmaj9: { bass: nm("G1"), v: ["B3", "D4", "F#4", "A4"].map(nm) },
  Dmaj9: { bass: nm("D2"), v: ["D4", "F#4", "A4", "C#5", "E5"].map(nm) },
};
const BEAT = 0.5;

// ---- 0–4 s: the doodle. Music box + pencil
[[0.5, "D6"], [1.0, "A5"], [1.5, "F#5"], [2.25, "A5"], [2.75, "B5"], [3.25, "A5"], [3.5, "D6"]].forEach(([t, n]) => mix(t, bell(nm(n), 1.8, 0.16), { pan: 0.2, send: 0.45 }));
mix(3.9, pad(CH.Dmaj7.v, 2.4, 0.06, 900, 1.0, 1.6), { send: 0.5 });
for (let i = 0; i < 15; i++) {
  const t0 = 0.35 + i * 0.17, d = 0.32;
  const len = Math.floor(d * SR);
  const s = noise(len);
  bandpass(s, (x) => 3200 + 1600 * Math.sin(x * 40 + i), 1.6);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const grain = 0.55 + 0.45 * Math.sin(2 * Math.PI * (28 + i * 3) * t + Math.sin(t * 90) * 2);
    s[k] *= 0.11 * smooth(0, 0.02, t) * (1 - smooth(d - 0.05, d, t)) * grain;
  }
  mix(t0, s, { pan: -0.3 + (i / 15) * 0.6, send: 0.1 });
}
mix(2.9, tick(1800, 0.1, 0.01), { send: 0.15 }); // the eye dot, a pen tap
{ // paper rustle as the doodle dissolves into the line drawing
  const len = Math.floor(1.0 * SR), s = noise(len);
  bandpass(s, (x) => 1500 + 2500 * x, 0.9);
  for (let k = 0; k < len; k++) { const t = k / SR; s[k] *= 0.07 * Math.sin(Math.PI * t / 1.0); }
  mix(4.15, s, { send: 0.3 });
}

// ---- 4–12 s: the build. Arpeggios, clockwork, clicks as parts land
{
  const prog = ["Dmaj7", "Gmaj7", "Bm7", "A7sus"];
  for (let b = 0; b < 4; b++) {
    const c = CH[prog[b]];
    const t0 = 4 + b * 2;
    const pat = [0, 2, 1, 3, 2, 1, 3, 2];
    pat.forEach((k, j) => mix(t0 + j * 0.25, pluck(c.v[k] + 12, 0.6, 0.32 + 0.1 * (b / 3), 0.55), { pan: (k - 1.5) * 0.25, send: 0.35 }));
    if (b >= 2) mix(t0, bassNote(c.bass + 12, 1.8, 0.22), { send: 0.1 });
    mix(t0, pad(c.v, 1.9, 0.045 + 0.02 * b, 1200, 0.5, 0.8), { send: 0.4 });
  }
  for (let t = 4.5; t < 10.4; t += 0.25) mix(t, tick(4200 + ((t * 4) % 2) * 600, 0.035 + 0.02 * smooth(4.5, 10, t), 0.008), { pan: 0.35, send: 0.08 });
  const parts = [5.5, 5.8, 5.95, 6.2, 6.5, 6.55, 7.55, 6.65, 7.65, 6.6, 7.15, 7.35, 7.95, 7.25, 7.95, 8.15, 8.35];
  parts.forEach((t, i) => mix(t, metalClick(0.09 + 0.03 * (i % 3)), { pan: -0.4 + (i % 5) * 0.2, send: 0.25 }));
  [8.95, 9.15, 9.0].forEach((t) => mix(t, tick(900, 0.12, 0.03), { send: 0.25 }));
  [7.2, 7.65, 8.05, 9.15, 9.75].forEach((t) => mix(t, tick(2600, 0.07, 0.006), { pan: 0.3, send: 0.1 }));
  { // feathers growing: soft rising rustle
    const len = Math.floor(1.6 * SR), s = noise(len);
    bandpass(s, (x) => 2000 + 4000 * x, 0.6);
    for (let k = 0; k < len; k++) { const t = k / SR; s[k] *= 0.06 * smooth(0, 1.2, t) * (1 - smooth(1.3, 1.6, t)) * (0.6 + 0.4 * Math.sin(t * 50)); }
    mix(9.0, s, { send: 0.35 });
  }
  { // the paint wipe: a brush swoosh moving left → right with the wipe front, over a riser
    const d = T.wipe1 - T.wipe0;
    const len = Math.floor((d + 0.3) * SR);
    const sL = noise(len), sR = noise(len);
    bandpass(sL, (x) => 400 + 5200 * smooth(0, d, x), 0.8);
    bandpass(sR, (x) => 400 + 5200 * smooth(0, d, x), 0.8);
    const outL = new Float32Array(len), outR = new Float32Array(len);
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      const w = smooth(0, d, t);
      const a = 0.16 * Math.sin(Math.PI * clamp(t / d)) ** 0.7;
      outL[k] = sL[k] * a * (1 - w);
      outR[k] = sR[k] * a * w;
    }
    mix(T.wipe0, outL, { pan: -0.8, send: 0.3 });
    mix(T.wipe0, outR, { pan: 0.8, send: 0.3 });
    mix(T.wipe0 + 0.4, strings(nm("A3"), 1.4, 0.05, 1.2, 0.4), { send: 0.4 });
    mix(T.wipe0 + 0.4, strings(nm("E4"), 1.4, 0.05, 1.2, 0.4), { send: 0.4 });
  }
}

// ---- 12–24 s: the ride. Strummed guitar, brushes, bass; a whistled tune from 16 s
const RIDE = ["Dmaj7", "Bm7", "Gmaj7", "A7sus", "Dmaj7", "Bm7"];
function groove(t0, chord, bar, opts = {}) {
  const c = CH[chord];
  const light = opts.light ?? 0;
  // strum pattern D . D U . U D U
  const pat = [[0, 1, 0.9], [1, 1, 0.55], [1.5, -1, 0.45], [2.5, -1, 0.5], [3, 1, 0.7], [3.5, -1, 0.45]];
  for (const [b, dir, v] of pat) strum(t0 + b * BEAT, c.v, dir, v * 0.42 * (1 - light * 0.4), { pan: -0.25, send: 0.22 });
  // bass: root on 1, fifth on 3, passing note
  mix(t0, bassNote(c.bass + 12, 0.9, 0.24), { send: 0.06 });
  mix(t0 + 2 * BEAT, bassNote(c.bass + 19, 0.45, 0.19), { send: 0.06 });
  mix(t0 + 3.5 * BEAT, bassNote(c.bass + 12 + (bar % 2 ? 2 : -1), 0.2, 0.18), { send: 0.06 });
  if (light < 1) {
    mix(t0, kick(0.55 * (1 - light * 0.5)), { send: 0.05 });
    mix(t0 + 2 * BEAT, kick(0.4 * (1 - light * 0.6)), { send: 0.05 });
    mix(t0 + BEAT, brush(0.22 * (1 - light * 0.5)), { pan: 0.15, send: 0.18 });
    mix(t0 + 3 * BEAT, brush(0.24 * (1 - light * 0.5), 0.24), { pan: 0.15, send: 0.18 });
    for (let k = 0; k < 8; k++) mix(t0 + k * 0.25, shaker(k % 2 ? 0.035 : 0.05), { pan: 0.45, send: 0.08 });
  }
}
RIDE.forEach((c, i) => groove(12 + i * 2, c, i));
const MEL_A = [
  [0, "A4", 1], [1, "D5", 1], [2, "F#5", 1.5], [3.5, "E5", 0.5],
  [4, "F#5", 2], [6, "D5", 1], [7, "B4", 1],
  [8, "D5", 1], [9, "E5", 1], [10, "G5", 1], [11, "F#5", 1],
  [12, "E5", 3],
];
{
  const w = whistle(MEL_A.map(([b, n, d]) => [16 + b * BEAT, nm(n), d * BEAT - 0.04]), 0.15);
  mix(w.start, w.buf, { pan: 0.1, send: 0.35 });
}
// a little fill into the descent
[23.0, 23.25, 23.5, 23.75].forEach((t, i) => mix(t, brush(0.12 + i * 0.04, 0.12), { pan: 0.1 + i * 0.05, send: 0.2 }));

// ---- 24–31 s: the descent, the wings, the slow motion
mix(24, pad(CH.Dmaj7.v, 2.2, 0.07, 1500, 0.3, 1.0), { send: 0.45 });
[0, 1, 2, 3, 4, 5, 6, 7].forEach((j) => mix(24 + j * 0.25, pluck([nm("D5"), nm("A4"), nm("F#5"), nm("A4")][j % 4], 0.5, 0.22, 0.6), { pan: 0.3, send: 0.4 }));
mix(26, strings(nm("G3"), 4.6, 0.07, 1.6, 2.0), { send: 0.5 });
mix(26, strings(nm("D4"), 4.6, 0.07, 1.6, 2.0), { send: 0.5 });
mix(26, strings(nm("B4"), 4.6, 0.06, 2.0, 2.0), { send: 0.5 });
mix(27.2, pad(CH.Gmaj9.v, 3.2, 0.08, 1100, 1.2, 1.6), { send: 0.6 });
mix(27.2, bassNote(nm("G1"), 3.0, 0.22), { send: 0.15 });
{
  // the soaring line while time slows
  const line = [[27.4, "D6", 0.9], [28.3, "E6", 0.5], [28.8, "F#6", 1.2], [30.0, "E6", 0.35], [30.35, "C#6", 0.6]];
  line.forEach(([t, n, d]) => mix(t, strings(nm(n), d, 0.05, 0.25, 0.8), { pan: -0.15, send: 0.6 }));
  line.forEach(([t, n, d]) => mix(t, bell(nm(n), 2.2, 0.06), { pan: 0.25, send: 0.6 }));
}
mix(30.2, pad(CH.A7sus.v, 0.8, 0.07, 1300, 0.3, 0.5), { send: 0.4 });
mix(30.2, bassNote(nm("A1"), 0.7, 0.2), { send: 0.1 });
// freewheel ratchet: clicks at the pawl rate of the rear hub; follows story time (slows in slow motion)
{
  let phase = 0;
  const pawls = 24;
  for (let i = Math.floor(T.coast * SR); i < Math.floor(31.2 * SR); i += 32) {
    const t = i / SR;
    const s = tl(t);
    const wheelRps = s.v / (2 * Math.PI * 0.328);
    phase += wheelRps * pawls * s.rate * (32 / SR);
    if (phase >= 1) {
      phase -= Math.floor(phase);
      const g = 0.05 * smooth(T.coast, T.coast + 0.2, t) * (1 - smooth(30.6, 31.0, t)) * (s.rate < 0.5 ? 1.2 : 1);
      mix(t, tick(s.rate < 0.5 ? 2600 : 3600, g, s.rate < 0.5 ? 0.01 : 0.005), { pan: -0.1, send: 0.12 });
    }
  }
}
// crank stops with a soft knock
mix(T.coast + 0.9, tick(700, 0.08, 0.03), { send: 0.2 });
// wings opening: two big feathered whooshes
[[26.25, 1.0], [26.95, 0.8]].forEach(([t, g]) => {
  const len = Math.floor(0.9 * SR), s = noise(len);
  bandpass(s, (x) => 300 + 1800 * Math.sin(Math.PI * clamp(x / 0.9)), 0.7);
  for (let k = 0; k < len; k++) { const x = k / SR; s[k] *= 0.22 * g * Math.sin(Math.PI * clamp(x / 0.9)) ** 1.5; }
  mix(t, s, { send: 0.35 });
});

// ---- wind + tyres across the whole ride (speed-driven, muffled in slow motion)
{
  const len = N;
  const w = noise(len);
  const out = new Float32Array(len);
  const fcAt = (x) => { const s = tl(x); return 300 + 120 * s.v * (s.rate < 0.6 ? 0.35 : 1); };
  const wb = bandpass(w, fcAt, 0.8);
  for (let i = Math.floor(10.4 * SR); i < Math.floor(39.9 * SR); i++) {
    const t = i / SR;
    const s = tl(t);
    const band = wb[i];
    let g = 0.0035 * s.v * s.v * (t > 24 ? 1.4 : 0.8);
    if (t > T.cutAerial) g *= 0.45; // far above the road
    if (t >= T.cutHead && t < T.cutDescent) g *= 1.25; // close to the bird
    out[i] = band * g * smooth(10.4, 12.4, t);
  }
  mix(0, out, { send: 0.05 });
  // tyre rumble
  const r = noise(len);
  lowpass(r, 140); lowpass(r, 160);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if (t < 10.4 || t > 31) { r[i] = 0; continue; }
    const s = tl(t);
    r[i] *= 0.05 * s.v * (t >= T.cutDrive && t < T.cutHead ? 1.6 : 0.9) * smooth(10.4, 12, t) * (s.rate < 0.6 ? 0.4 : 1);
  }
  mix(0, r, { send: 0.02 });
}
// chain whir in the drivetrain close-up: link-rate buzz
{
  const len = Math.floor((T.cutHead - T.cutDrive + 0.2) * SR);
  const s = noise(len);
  bandpass(s, () => 1900, 2.5);
  for (let k = 0; k < len; k++) {
    const t = T.cutDrive + k / SR;
    const linkRate = 48; // 48 links pass per crank revolution, one rev per second
    const m = 0.5 + 0.5 * Math.sin(2 * Math.PI * linkRate * t);
    s[k] *= 0.05 * m * smooth(T.cutDrive, T.cutDrive + 0.08, t) * (1 - smooth(T.cutHead - 0.05, T.cutHead + 0.1, t));
  }
  mix(T.cutDrive, s, { pan: 0.2, send: 0.1 });
}

// ---- 31–40 s: aerial, the flock, the title. Lighter groove, the tune again, the bell, a last chord
{
  const END = ["Dmaj7", "Bm7", "Gmaj7"];
  END.forEach((c, i) => groove(31 + i * 2, c, i, { light: i === 2 ? 0.8 : 0.45 }));
  const MEL_B = [
    [0, "A5", 1.5], [1.5, "F#5", 0.5], [2, "A5", 1], [3, "B5", 1],
    [4, "A5", 2], [6, "F#5", 1], [7, "D5", 1],
    [8, "E5", 1], [9, "F#5", 1], [10, "G5", 1], [11, "B5", 1],
    [12, "A5", 1.2], [13.4, "D6", 4.0],
  ];
  const w = whistle(MEL_B.map(([b, n, d]) => [31 + b * BEAT, nm(n), d * BEAT - 0.04]), 0.13);
  mix(w.start, w.buf, { pan: 0.05, send: 0.45 });
  mix(37, pad(CH.A.v, 0.9, 0.05, 1300, 0.3, 0.6), { send: 0.4 });
  mix(37, bassNote(nm("A1"), 0.9, 0.2), { send: 0.1 });
  mix(37.9, pad(CH.Dmaj9.v, 1.8, 0.07, 1400, 0.2, 1.4), { send: 0.6 });
  mix(37.9, bassNote(nm("D2"), 1.8, 0.22), { send: 0.15 });
  ["D5", "A5", "C#6", "E6", "F#6"].forEach((n, i) => mix(37.9 + i * 0.13, bell(nm(n), 2.4, 0.1), { pan: -0.3 + i * 0.15, send: 0.55 }));
  mix(T.bell, bicycleBell(0.32), { pan: 0.0, send: 0.25 });
  mix(T.bell + 0.19, bicycleBell(0.26), { pan: 0.0, send: 0.25 });
}

// ------------------------------------------------------------------ reverb (Freeverb)
function freeverb(inL, inR, room = 0.84, damp = 0.32) {
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const scale = SR / 44100;
  const outL = new Float32Array(N), outR = new Float32Array(N);
  for (const [inp, out, spread] of [[inL, outL, 0], [inR, outR, 23]]) {
    const combs = combT.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0, store: 0 }));
    const aps = apT.map((a) => ({ buf: new Float32Array(Math.round((a + spread) * scale)), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = inp[n] * 0.015;
      let s = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        s += y;
      }
      for (const a of aps) {
        const b = a.buf[a.i];
        a.buf[a.i] = s + b * 0.5;
        s = b - s;
        a.i = (a.i + 1) % a.buf.length;
      }
      out[n] = s;
    }
  }
  return [outL, outR];
}
const [wL, wR] = freeverb(sendL, sendR);

// ------------------------------------------------------------------ master: sum, gentle glue, fade, limit
const L = new Float32Array(N), Rr = new Float32Array(N);
let peak = 0;
for (const b of [dryL, dryR, wL, wR]) { highpass(b, 30); highpass(b, 30); }
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = (1 - smooth(39.0, 40.0, t)) * smooth(0, 0.05, t);
  let l = (dryL[i] + wL[i] * 3.2) * fade, r = (dryR[i] + wR[i] * 3.2) * fade;
  L[i] = l; Rr[i] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const gain = 0.84 / Math.max(peak, 1e-6);
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write("WAVE", 8);
pcm.write("fmt ", 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34);
pcm.write("data", 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const l = Math.tanh(L[i] * gain * 1.15) / Math.tanh(1.15), r = Math.tanh(Rr[i] * gain * 1.15) / Math.tanh(1.15);
  pcm.writeInt16LE(Math.round(clamp(l, -1, 1) * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(clamp(r, -1, 1) * 32767), 46 + i * 4);
}
const out = path.join(HERE, "..", "assets", "score.wav");
fs.writeFileSync(out, pcm);
console.log("wrote", out, "peak", peak.toFixed(3), "gain", gain.toFixed(3));
