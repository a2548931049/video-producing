// The flight: one continuous FPV-style move, 10 s.
//   0.0–2.1  down the avenue, low, through the archway
//   2.1–3.7  across the yard, pull up the face of a 12-storey block, crest the roof
//   3.7–5.4  speed ramp: over the roofs, past the smelter stacks, across the lowland to the massif
//   5.4–7.0  into the valley, the north wall's basalt steps racing past on the left
//   7.0–8.4  bank right, climb over the south ridge
//   8.4–10   the ground drops away: the escarpment, the frozen lake, the plateau to the horizon
import * as THREE from "three";
import { monotone, clamp, smoothstep } from "./util.js";

// key moments (seconds) shared with the overlay and the sound
export const BEATS = {
  arch: 2.05,
  crest: 3.7,
  ramp: 4.05,
  mouth: 5.35,
  bank: 6.9,
  ridge: 8.3,
  title: 8.55,
  end: 10,
};

export function makeCamera(G) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // control points (metres). Each may carry an arrival time; between them the speed eases (monotone cubic).
  const K = [
    [-3572, G + 12.5, 0, 0],
    [-3530, G + 11.8, 0],
    [-3490, G + 9.6, 0],
    [-3462, G + 5.8, 0],
    [-3441, G + 3.9, 0],
    [-3427, G + 3.7, 0, 2.02], // inside the archway
    [-3412, G + 3.8, 0],
    [-3392, G + 4.6, 0.6],
    [-3368, G + 7.6, 1.2, 2.6],
    [-3346, G + 15.5, 1.2],
    [-3338.5, G + 26, 1.0],
    [-3336.5, G + 36.5, 0.6, 3.32], // 8 m off the facade, nose up
    [-3331, G + 44.5, 0, 3.58], // over the parapet
    [-3316, G + 48.5, 0, 3.88],
    [-3240, G + 53, 0, 4.22],
    [-2980, G + 60, -6, 4.56],
    [-2600, 205, -40, 4.84],
    [-2150, 270, -90, 5.12],
    [-1650, 318, -150, 5.43],
    [-1150, 350, -205, 5.76],
    [-500, 390, -228, 6.2], // hugging the north wall (~40 m off its lowest bench)
    [150, 428, -200, 6.66],
    [720, 476, 120, 7.1],
    [1180, 612, 760, 7.6],
    [1500, 820, 1420, 8.08],
    [1730, 1030, 1960, 8.5], // the ridge
    [1880, 1135, 2290, 8.95],
    [1975, 1205, 2490, 9.42],
    [2030, 1240, 2600, 10.0],
  ];
  const pts = K.map((k) => V(k[0], k[1], k[2]));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const L = curve.getLength();
  const DIV = 8000;
  const lens = curve.getLengths(DIV); // cumulative arc length at u = j / DIV
  const sOfU = (u) => {
    const f = u * DIV, j = Math.min(DIV - 1, Math.floor(f));
    return lens[j] + (lens[j + 1] - lens[j]) * (f - j);
  };
  const at = [], as = [];
  K.forEach((k, i) => {
    if (k.length > 3) {
      at.push(k[3]);
      as.push(sOfU(i / (K.length - 1)));
    }
  });
  const sAt = monotone(at, as);
  const vel = (t) => (sAt(Math.min(10, t + 0.005)) - sAt(Math.max(0, t - 0.005))) / (Math.min(10, t + 0.005) - Math.max(0, t - 0.005));
  const uAtS = (s) => {
    s = clamp(s, 0, L);
    let lo = 0, hi = lens.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (lens[m] < s) lo = m;
      else hi = m;
    }
    const seg = lens[hi] - lens[lo];
    return (lo + (seg > 0 ? (s - lens[lo]) / seg : 0)) / (lens.length - 1);
  };
  const pointAtS = (s) => curve.getPoint(uAtS(s));

  // look direction: the path a little ahead (further ahead when fast), smoothed
  const headingAt = (t) => {
    const s = sAt(t);
    const v = vel(t);
    const ahead = clamp(v * 0.32, 10, 520);
    const a = pointAtS(s), b = pointAtS(s + ahead);
    return Math.atan2(b.x - a.x, -(b.z - a.z)); // 0 = north, +π/2 = east
  };
  // pitch: authored (degrees); look up the facade while climbing, settle, nose down for the reveal
  const pitchK = monotone(
    [0, 1.7, 2.15, 2.45, 2.75, 3.05, 3.35, 3.6, 3.85, 4.2, 4.8, 5.3, 5.75, 6.3, 7.0, 7.8, 8.4, 9.0, 10.0],
    [-4, -3, 1, 9, 26, 33, 30, 9, -7, -6, -2, 2, 7, 1, -1, -3, -6.5, -5.5, -5],
  );
  const rollK = monotone([0, 1.2, 2.0, 3.6, 4.4, 5.3, 6.4, 7.2, 7.9, 8.6, 10], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // vertical FOV (degrees): FPV-wide in the streets, wider still at peak speed, a long lens for the reveal
  const fovK = monotone([0, 2.0, 3.3, 3.9, 4.6, 5.3, 6.2, 7.2, 8.2, 9.0, 10], [54, 54, 56, 54, 62, 66, 62, 57, 52, 46, 44]);

  const pose = (t) => {
    const s = sAt(t);
    const pos = pointAtS(s);
    let yaw = headingAt(t);
    // final framing: hold the composition, a slow push toward the south-east
    const hold = smoothstep(8.6, 9.6, t);
    const yawEnd = (136 * Math.PI) / 180;
    yaw = yaw + (yawEnd - yaw) * hold;
    // bank into turns: roll from the yaw rate (coordinated turn), capped
    const dt = 0.05;
    let dy = headingAt(t + dt) - headingAt(t - dt);
    if (dy > Math.PI) dy -= 2 * Math.PI;
    if (dy < -Math.PI) dy += 2 * Math.PI;
    const yawRate = dy / (2 * dt);
    const v = vel(t);
    let roll = clamp(-yawRate * Math.min(v, 900) * 0.0019, -0.36, 0.36) * (1 - hold);
    roll += (rollK(t) * Math.PI) / 180;
    // hand-held FPV micro-shake, stronger at speed
    const amp = 0.0016 + 0.0028 * smoothstep(300, 1400, v);
    const shY = amp * (Math.sin(t * 13.1) * 0.6 + Math.sin(t * 29.7 + 1.3) * 0.4);
    const shP = amp * (Math.sin(t * 17.3 + 0.7) * 0.6 + Math.sin(t * 37.1 + 2.1) * 0.4);
    const pitch = (pitchK(t) * Math.PI) / 180 + shP;
    // Euler YXZ: heading about world up, then pitch, then roll. The camera looks down -z (north) at 0,
    // so heading east (+π/2) is a rotation of -π/2; positive roll banks left.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, -yaw - shY, roll, "YXZ"));
    const near = t < 3.95 ? 0.25 : t < 4.6 ? 1.5 : 6;
    return { pos, quat: q, fov: fovK(t), near, speed: v };
  };
  return { pose, sAt, vel, length: L, curve, pointAtS };
}
