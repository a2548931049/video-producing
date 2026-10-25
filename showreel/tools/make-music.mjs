// Synthesises assets/music.wav: a 15 s, 120 BPM track built entirely in code
// (no samples). Beat grid: 1 beat = 0.5 s, 1 bar = 2 s. Cues line up with index.html:
// 1.5 burst · 2.0 groove + words · 5.0 riser · 6.0 drop · 10.0 wipes · 12.0 final hit.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const DUR = 15;
const N = SR * DUR;

// Two buses: drums/fx stay dry, the music bus gets side-chained by the kick.
const DL = new Float32Array(N), DR = new Float32Array(N);
const ML = new Float32Array(N), MR = new Float32Array(N);

let seed = 1337;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const noise = () => rand() * 2 - 1;
const TAU = Math.PI * 2;

function put(L, R, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  const a = ((pan + 1) * Math.PI) / 4;
  L[i] += v * Math.cos(a) * Math.SQRT2;
  R[i] += v * Math.sin(a) * Math.SQRT2;
}

const kickTimes = [];
function kick(t0, amp = 1) {
  kickTimes.push(t0);
  const s0 = Math.round(t0 * SR);
  for (let k = 0; k < 0.5 * SR; k++) {
    const tau = k / SR;
    const ph = TAU * (48 * tau + (120 * (1 - Math.exp(-30 * tau))) / 30);
    const env = Math.exp(-6.5 * tau) * Math.min(1, tau * 2000);
    const click = Math.exp(-tau * 400) * 0.25 * noise();
    put(DL, DR, s0 + k, amp * (Math.sin(ph) * env * 0.9 + click));
  }
}

function clap(t0, amp = 1, pan = 0) {
  const s0 = Math.round(t0 * SR);
  let lp = 0;
  for (let k = 0; k < 0.3 * SR; k++) {
    const tau = k / SR;
    const n = noise();
    lp += 0.12 * (n - lp);
    let e = Math.exp(-tau * 140);
    if (tau >= 0.011) e += Math.exp(-(tau - 0.011) * 140);
    if (tau >= 0.022) e += Math.exp(-(tau - 0.022) * 13);
    put(DL, DR, s0 + k, amp * 0.33 * (n - lp) * e, pan);
  }
}

function hat(t0, amp = 1, pan = 0.25) {
  const s0 = Math.round(t0 * SR);
  let lp = 0;
  for (let k = 0; k < 0.08 * SR; k++) {
    const tau = k / SR;
    const n = noise();
    lp += 0.5 * (n - lp);
    put(DL, DR, s0 + k, amp * 0.16 * (n - lp) * Math.exp(-tau * 70), pan);
  }
}

function crash(t0, amp = 1) {
  const s0 = Math.round(t0 * SR);
  let lpL = 0, lpR = 0;
  for (let k = 0; k < 2.6 * SR; k++) {
    const i = s0 + k;
    if (i >= N) break;
    const tau = k / SR;
    const e = amp * 0.2 * Math.exp(-tau * 1.8) * Math.min(1, tau * 3000);
    const nl = noise(), nr = noise();
    lpL += 0.35 * (nl - lpL);
    lpR += 0.35 * (nr - lpR);
    DL[i] += (nl - lpL) * e;
    DR[i] += (nr - lpR) * e;
  }
}

function boom(t0, amp = 1) {
  const s0 = Math.round(t0 * SR);
  let ph = 0;
  for (let k = 0; k < 1.6 * SR; k++) {
    const tau = k / SR;
    ph += (TAU * (34 + 30 * Math.exp(-tau * 4))) / SR;
    put(DL, DR, s0 + k, amp * 0.55 * Math.sin(ph) * Math.exp(-tau * 2.2) * Math.min(1, tau * 500));
  }
}

function riser(t0, dur, amp = 1) {
  const s0 = Math.round(t0 * SR);
  let lp = 0, ph = 0;
  for (let k = 0; k < dur * SR; k++) {
    const x = k / (dur * SR);
    const n = noise();
    lp += (0.02 + 0.6 * x * x) * (n - lp);
    ph += (TAU * (300 + 1200 * x * x)) / SR;
    put(DL, DR, s0 + k, amp * x * x * (0.3 * lp + 0.07 * Math.sin(ph)), Math.sin(x * 9) * 0.4);
  }
}

function whoosh(t0, dur, amp = 1) {
  const s0 = Math.round(t0 * SR);
  let lp = 0;
  for (let k = 0; k < dur * SR; k++) {
    const x = k / (dur * SR);
    const bell = Math.sin(Math.PI * x) ** 2;
    const n = noise();
    lp += (0.03 + 0.3 * bell) * (n - lp);
    put(DL, DR, s0 + k, amp * 0.35 * lp * bell, -0.8 + 1.6 * x);
  }
}

function bass(t0, f, dur, amp = 1) {
  const s0 = Math.round(t0 * SR);
  let ph = 0, lp1 = 0, lp2 = 0;
  for (let k = 0; k < (dur + 0.05) * SR; k++) {
    const tau = k / SR;
    ph += f / SR;
    const saw = 2 * (ph % 1) - 1;
    const c = 0.04 + 0.25 * Math.exp(-tau * 18);
    lp1 += c * (saw - lp1);
    lp2 += c * (lp1 - lp2);
    const gate = tau < dur ? 1 : Math.max(0, 1 - (tau - dur) / 0.05);
    const env = Math.min(1, tau * 400) * gate * (0.7 + 0.3 * Math.exp(-tau * 10));
    put(ML, MR, s0 + k, amp * env * (0.3 * lp2 + 0.2 * Math.sin(TAU * ph)));
  }
}

function pad(t0, dur, freqs, amp = 1, att = 0.3, rel = 0.6, bright = 0.06) {
  const s0 = Math.round(t0 * SR);
  for (const f of freqs) {
    for (const [det, pan] of [[-0.006, -0.6], [0.006, 0.6], [0, 0]]) {
      let ph = rand(), lp1 = 0, lp2 = 0;
      const ff = f * (1 + det);
      for (let k = 0; k < (dur + rel) * SR; k++) {
        const tau = k / SR;
        ph += ff / SR;
        const saw = 2 * (ph % 1) - 1;
        lp1 += bright * (saw - lp1);
        lp2 += bright * (lp1 - lp2);
        const env = Math.min(1, tau / att) * (tau < dur ? 1 : Math.max(0, 1 - (tau - dur) / rel) ** 2);
        put(ML, MR, s0 + k, amp * 0.045 * lp2 * env, pan);
      }
    }
  }
}

function pluck(t0, f, amp = 1, pan = 0) {
  const s0 = Math.round(t0 * SR);
  let ph = 0, lp = 0;
  for (let k = 0; k < 0.35 * SR; k++) {
    const tau = k / SR;
    ph += f / SR;
    const sq = Math.tanh(3 * Math.sin(TAU * ph));
    lp += 0.25 * (sq - lp);
    put(ML, MR, s0 + k, amp * 0.09 * lp * Math.exp(-tau * 13) * Math.min(1, tau * 1500), pan);
  }
}

// ---- Arrangement -------------------------------------------------------------
const CHORD = {
  Am: [220, 261.63, 329.63],
  F: [174.61, 220, 261.63],
  C: [196, 261.63, 329.63],
  G: [196, 246.94, 293.66],
};
const ROOT = { Am: 110, F: 87.31, C: 130.81, G: 98 };
const PROG = ["Am", "F", "C", "G"];
const chordAt = (t) => PROG[Math.floor(t / 2) % 4];
const near = (a, b) => Math.abs(a - b) < 1e-6;

// Pads, bars 0–5 (0–12 s). The first bar swells in under the intro.
for (let b = 0; b < 6; b++) pad(2 * b, 2, CHORD[PROG[b % 4]], b === 0 ? 0.8 : 1, b === 0 ? 1.4 : 0.12, 0.35);

// Intro: two heartbeat kicks under the dot pulses, a short riser, the burst at 1.5.
kick(0.5, 0.55);
kick(1.0, 0.65);
riser(0.85, 0.65, 0.7);
kick(1.5, 1);
crash(1.5, 0.8);
boom(1.5, 0.6);

// Groove 2–12 s, with a breath at 5.5–6.0 before the drop.
const inGap = (t) => t >= 5.5 - 1e-6 && t < 6 - 1e-6;
for (let t = 2; t < 12 - 1e-6; t += 0.5) if (!inGap(t) && !near(t, 6)) kick(t, 0.95);
for (let bar = 2; bar < 12; bar += 2) for (const off of [0.5, 1.5]) if (!inGap(bar + off)) clap(bar + off, 1, 0.1);
for (let t = 2; t < 12 - 1e-6; t += 0.25) {
  if (inGap(t)) continue;
  const offbeat = near(t % 0.5, 0.25);
  hat(t, offbeat ? 1 : 0.35, offbeat ? 0.3 : -0.3);
}
for (let t = 6.125; t < 10; t += 0.25) hat(t, 0.25, 0.5);

// Riser and snare roll into the drop.
riser(5.0, 1.0, 1);
for (let k = 0; k < 8; k++) clap(5.5 + k * 0.0625, 0.25 + k * 0.09, k % 2 ? 0.3 : -0.3);

// Drop at 6.0.
kick(6, 1.15);
crash(6, 1);
boom(6, 1);

// Bass in eighths, 2–12 s.
const BASS_STEP = [1, 1, 2, 1, 1, 2, 1, 1.5];
for (let t = 2; t < 12 - 1e-6; t += 0.25) {
  if (inGap(t)) continue;
  const step = Math.round((t % 2) / 0.25) % 8;
  bass(t, ROOT[chordAt(t)] * BASS_STEP[step], 0.2, 1);
}

// Arpeggio over the generative and equaliser scenes, 6–10 s.
const ARP = [0, 1, 2, 1, 2, 0, 1, 2];
for (let t = 6, i = 0; t < 10 - 1e-6; t += 0.125, i++) {
  const notes = CHORD[chordAt(t)];
  pluck(t, notes[ARP[i % 8]] * 2, 0.9 + 0.3 * (i % 4 === 0), i % 2 ? 0.5 : -0.5);
}

// Wipes.
whoosh(9.8, 0.45, 1);
crash(10, 0.45);
whoosh(11.45, 0.55, 1);

// Final hit at 12.0 and a descending echo.
kick(12, 1.15);
crash(12, 1);
boom(12, 1.1);
pad(12, 0.05, [110, 220, 261.63, 329.63, 440], 2.2, 0.005, 2.6, 0.12);
[[12.25, 659.25], [12.5, 523.25], [12.75, 440], [13.0, 329.63]].forEach(([t, f], i) => pluck(t, f, 1 - i * 0.2, i % 2 ? 0.4 : -0.4));

// ---- Mix -------------------------------------------------------------------
kickTimes.sort((a, b) => a - b);
const out = new Float32Array(N * 2);
let kp = -1, peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  while (kp + 1 < kickTimes.length && kickTimes[kp + 1] <= t) kp++;
  const duck = kp < 0 ? 1 : 1 - 0.55 * Math.exp(-(t - kickTimes[kp]) * 9);
  const fade = Math.min(1, t / 0.01, (DUR - t) / 0.35);
  const l = Math.tanh(1.2 * (DL[i] + ML[i] * duck)) * fade;
  const r = Math.tanh(1.2 * (DR[i] + MR[i] * duck)) * fade;
  out[2 * i] = l;
  out[2 * i + 1] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}

const gain = 0.89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N * 2; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * gain)) * 32767), 44 + i * 2);

const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "music.wav");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, buf);
console.log(`wrote ${file} (${(buf.length / 1e6).toFixed(1)} MB, peak gain ${gain.toFixed(2)})`);
