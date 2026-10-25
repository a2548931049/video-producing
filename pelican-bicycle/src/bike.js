// A vintage lugged-steel road bike, built from numbers.
// Root origin = ground point under the bottom bracket. +X forward, +Y up, +Z = drive side.
import * as THREE from "three";
import { rod, tube, sweep, latheZ, sprocketShape, extrude, ellipsoid, place, helixPts, curvePts, merge } from "./geo.js";
const ellGeo = ellipsoid;
import { tag } from "./materials.js";
import { TAU } from "./util.js";

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- geometry numbers
export const B = {};
B.Rw = 0.328; // tyre outer radius (650b x 38)
B.rimR = 0.297;
B.BB = V(0, 0.265);
B.crankLen = 0.165;
B.ringTeeth = 48;
B.cogTeeth = 18;
B.pitch = 0.0127;
B.R1 = B.pitch / (2 * Math.sin(Math.PI / B.ringTeeth));
B.R2 = B.pitch / (2 * Math.sin(Math.PI / B.cogTeeth));
B.chainline = 0.043;
B.links = 100;
// Solve the chainstay so a 100-link chain wraps exactly (pins sit in every valley).
{
  const dy = B.Rw - B.BB.y;
  const Lpins = (D) => {
    const g = Math.asin((B.R1 - B.R2) / D);
    const span = Math.sqrt(D * D - (B.R1 - B.R2) ** 2);
    return (Math.PI + 2 * g) / (TAU / B.ringTeeth) + (Math.PI - 2 * g) / (TAU / B.cogTeeth) + (2 * span) / B.pitch;
  };
  let lo = 0.38, hi = 0.46;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (Lpins(m) < B.links) lo = m; else hi = m;
  }
  B.D = (lo + hi) / 2;
  B.RA = V(-Math.sqrt(B.D * B.D - dy * dy), B.Rw);
}
B.st = V(-Math.cos((73 * Math.PI) / 180), Math.sin((73 * Math.PI) / 180)); // seat-tube direction
B.ST = B.BB.clone().addScaledVector(B.st, 0.4);
B.s = V(-Math.cos((72 * Math.PI) / 180), Math.sin((72 * Math.PI) / 180)); // steering axis (up)
B.n = V(B.s.y, -B.s.x); // perpendicular, forward
B.FA = V(0.595, B.Rw);
B.P0 = B.FA.clone().addScaledVector(B.n, -0.045);
B.C = B.P0.clone().addScaledVector(B.s, 0.365); // fork crown
B.HB = B.C.clone().addScaledVector(B.s, 0.012);
B.HT = B.HB.clone().addScaledVector(B.s, 0.088);
B.TT0 = B.BB.clone().addScaledVector(B.st, 0.385);
B.TT1 = B.HT.clone().addScaledVector(B.s, -0.02);
B.DT1 = B.HB.clone().addScaledVector(B.s, 0.024);
B.SP = B.BB.clone().addScaledVector(B.st, 0.452); // seatpost top / saddle clamp
B.Q = B.HT.clone().addScaledVector(B.s, 0.11); // quill top
B.BC = B.Q.clone().add(V(0.055, 0.01)); // handlebar centre
B.saddleTop = B.SP.clone().add(V(-0.01, 0.05));

// Swept-back "Albatross" bar (right half) in bar-local coords: x fwd, y up, z lateral.
// The grips come back beside the rider, which lets a bird rest its wrists on them with the wings folded.
const BAR_R = [
  V(0, 0, 0.0), V(0, 0, 0.05), V(-0.004, 0.0, 0.09), V(-0.03, -0.002, 0.14), V(-0.08, -0.01, 0.18),
  V(-0.15, -0.02, 0.2), V(-0.215, -0.027, 0.205), V(-0.27, -0.031, 0.206), V(-0.33, -0.034, 0.207),
];
B.gripStart = 0.62; // fraction of the half-bar path where the grip begins
export function barPoint(local) {
  return B.BC.clone().add(local);
}
B.gripLocal = V(-0.235, -0.028, 0.205);
B.hoodR = barPoint(B.gripLocal);
B.hoodL = barPoint(V(B.gripLocal.x, B.gripLocal.y, -B.gripLocal.z));

// ------------------------------------------------------------------ chain path
// u is measured in pins (0..links). The path runs clockwise seen from +Z:
// ring arc (front) → bottom span → cog arc (rear) → top span.
function chainPath() {
  const c1 = B.BB, c2 = B.RA;
  const d = new THREE.Vector2(c2.x - c1.x, c2.y - c1.y);
  const D = d.length();
  const psi = Math.atan2(d.y, d.x);
  const off = Math.acos((B.R1 - B.R2) / D);
  // tangent normals for upper and lower spans
  const mU = psi + off, mL = psi - off; // check which is upper
  const nU = Math.sin(mU) > Math.sin(mL) ? mU : mL;
  const nL = nU === mU ? mL : mU;
  const t1u = V(c1.x + B.R1 * Math.cos(nU), c1.y + B.R1 * Math.sin(nU));
  const t1l = V(c1.x + B.R1 * Math.cos(nL), c1.y + B.R1 * Math.sin(nL));
  const t2u = V(c2.x + B.R2 * Math.cos(nU), c2.y + B.R2 * Math.sin(nU));
  const t2l = V(c2.x + B.R2 * Math.cos(nL), c2.y + B.R2 * Math.sin(nL));
  const d1 = TAU / B.ringTeeth, d2 = TAU / B.cogTeeth;
  // ring arc clockwise from nU down to nL (through angle 0, the front)
  let a1 = nU - nL; while (a1 < 0) a1 += TAU; // clockwise sweep
  let a2 = nU - nL; // cog: clockwise from nL (bottom) round the back to nU
  a2 = TAU - a1; // external tangents: wraps sum to 2π
  const span = t1l.distanceTo(t2l);
  const seg = [a1 / d1, span / B.pitch, a2 / d2, span / B.pitch];
  const total = seg[0] + seg[1] + seg[2] + seg[3];
  const scale = B.links / total; // ≈1, absorbs float error
  return {
    total: B.links,
    at(u, out) {
      u = ((u % B.links) + B.links) % B.links;
      u /= scale;
      if (u < seg[0]) {
        const a = nU - u * d1;
        return out.set(c1.x + B.R1 * Math.cos(a), c1.y + B.R1 * Math.sin(a), B.chainline);
      }
      u -= seg[0];
      if (u < seg[1]) {
        const f = u / seg[1];
        return out.set(t1l.x + (t2l.x - t1l.x) * f, t1l.y + (t2l.y - t1l.y) * f, B.chainline);
      }
      u -= seg[1];
      if (u < seg[2]) {
        const a = nL - u * d2;
        return out.set(c2.x + B.R2 * Math.cos(a), c2.y + B.R2 * Math.sin(a), B.chainline);
      }
      u -= seg[2];
      const f = u / seg[3];
      return out.set(t2u.x + (t1u.x - t2u.x) * f, t2u.y + (t1u.y - t2u.y) * f, B.chainline);
    },
    ringPhase: nU, // pin 0 sits at this angle on the ring when the crank is at 0
    cogPhase: nL + (seg[0] + seg[1]) * scale * d2, // valley phase so cog teeth meet the pins
  };
}

// ----------------------------------------------------------------- builders
class Bin {
  constructor(M) { this.M = M; this.map = new Map(); }
  add(mat, g) {
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
    return g;
  }
  into(group, name = "") {
    for (const [k, list] of this.map) {
      const mesh = new THREE.Mesh(merge(list), this.M[k]);
      mesh.name = `${name}:${k}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.map.clear();
    return group;
  }
}

// lug sleeve with two spear points (front/back of tube) pointing away from the joint
function lugSleeve(a, dir, len, r, pointAxis = V(0, 0, 1), radial = 32, rows = 10) {
  dir = dir.clone().normalize();
  const ax = pointAxis.clone().addScaledVector(dir, -pointAxis.dot(dir)).normalize();
  const bx = new THREE.Vector3().crossVectors(dir, ax);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * TAU;
      const pointy = Math.pow(Math.abs(Math.cos(ang)), 10);
      const L = len * (0.42 + 0.58 * pointy);
      const p = a.clone().addScaledVector(dir, s * L)
        .addScaledVector(ax, Math.cos(ang) * r).addScaledVector(bx, Math.sin(ang) * r);
      pos.push(p.x, p.y, p.z);
      uv.push(j / radial, s);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const q = i * row + j;
    idx.push(q, q + 1, q + row, q + 1, q + row + 1, q + row);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function dir(a, b) { return new THREE.Vector3().subVectors(b, a).normalize(); }

// ------------------------------------------------------------------- wheel
function buildWheel(M, front, partRim, partSpokes, partHub) {
  const g = new THREE.Group();
  const bin = new Bin(M);
  // tyre: lathe of a near-circular section sitting on the rim
  const tc = 0.3105, tr = 0.0178;
  const prof = [];
  for (let i = 0; i <= 40; i++) {
    const a = -2.05 + (i / 40) * 4.1;
    prof.push([tc + Math.cos(a) * tr, Math.sin(a) * tr * 1.04]);
  }
  const tyre = latheZ(prof, 160);
  // lathe uv: u = around, v = along profile. Repeat u for tread.
  const uvA = tyre.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) * 3);
  // swap: our tread texture is u=around (repeat), v = across
  bin.add("tyre", tag(tyre, partRim, (x, y, z) => Math.atan2(y, x)));
  // rim: box section
  const rimProf = [
    [0.2995, 0.0105], [0.2955, 0.0118], [0.2865, 0.0105], [0.2805, 0.0062], [0.2795, 0], [0.2805, -0.0062],
    [0.2865, -0.0105], [0.2955, -0.0118], [0.2995, -0.0105], [0.2975, -0.0082], [0.2935, -0.0072],
    [0.2915, 0], [0.2935, 0.0072], [0.2975, 0.0082], [0.2995, 0.0105],
  ];
  bin.add("alu", tag(latheZ(rimProf, 160), partRim, (x, y) => Math.atan2(y, x)));
  // hub
  const flZ = front ? 0.03 : 0.034;
  const hubProf = [
    [0.0045, -0.062], [0.009, -0.062], [0.009, -0.055], [0.011, -0.05], [0.011, -flZ - 0.004], [0.0235, -flZ - 0.0018],
    [0.0235, -flZ + 0.0018], [0.0125, -flZ + 0.003], [0.0105, -0.012], [0.0102, 0], [0.0105, 0.012],
    [0.0125, flZ - 0.003], [0.0235, flZ - 0.0018], [0.0235, flZ + 0.0018], [0.011, flZ + 0.004], [0.011, 0.05],
    [0.009, 0.055], [0.009, 0.062], [0.0045, 0.062],
  ];
  bin.add("alu", tag(latheZ(hubProf, 48), partHub, 0.0));
  // quick release lever on the non-drive side
  const qr = merge([
    rod(V(0, 0, -0.062), V(0, 0, -0.075), 0.007, 0.007, 20),
    rod(V(0, 0, -0.07), V(-0.012, -0.055, -0.078), 0.0045, 0.0032, 12),
    rod(V(0, 0, 0.062), V(0, 0, 0.07), 0.0055, 0.0055, 16),
  ]);
  bin.add("chrome", tag(qr, partHub, 0.0));
  // spokes, 3-cross, 32 holes
  const spokes = [], nipples = [];
  const N = 32;
  const cross = 3;
  const span = (cross * 4 * Math.PI) / N;
  let idx = 0;
  for (const side of [-1, 1]) {
    for (let k = 0; k < N / 2; k++) {
      const hubA = (k / (N / 2)) * TAU + (side > 0 ? TAU / N : 0);
      const rimA = hubA + (k % 2 === 0 ? span : -span);
      const h = V(Math.cos(hubA) * 0.0205, Math.sin(hubA) * 0.0205, side * flZ);
      const r = V(Math.cos(rimA) * 0.2745, Math.sin(rimA) * 0.2745, side * 0.0022);
      const seq = idx / N; // drawn one spoke after another
      // lift spoke heads alternately inside/outside the flange
      const head = h.clone().add(V(0, 0, (k % 2 ? 1 : -1) * 0.0022));
      spokes.push(tag(rod(head, r, 0.00095, 0.00095, 6, false), partSpokes, seq));
      const nd = dir(head, r);
      nipples.push(tag(rod(r.clone().addScaledVector(nd, -0.011), r.clone().addScaledVector(nd, 0.003), 0.0018, 0.0016, 8), partSpokes, seq));
      idx++;
    }
  }
  bin.add("chrome", merge(spokes));
  bin.add("alu", merge(nipples));
  // valve stem between two spoke holes
  const va = TAU / N / 2 + 0.01;
  bin.add("brass", tag(rod(V(Math.cos(va) * 0.258, Math.sin(va) * 0.258), V(Math.cos(va) * 0.276, Math.sin(va) * 0.276), 0.0035, 0.0035, 12), partRim, 0.9));
  bin.into(g, front ? "frontWheel" : "rearWheel");
  return g;
}

// ------------------------------------------------------------------- pedal
function buildPedal(M, side, part) {
  // pedal-local: origin on the spindle axis at the crank eye; +z outward*side
  const bin = new Bin(M);
  const s = side;
  bin.add("chrome", tag(rod(V(0, 0, 0), V(0, 0, s * 0.082), 0.0065, 0.0058, 16), part, 0.0));
  bin.add("alu", tag(rod(V(0, 0, s * 0.012), V(0, 0, s * 0.078), 0.0115, 0.0115, 24), part, 0.2));
  // cage plates with serrated tops, front and back
  for (const fx of [-1, 1]) {
    const sh = new THREE.Shape();
    const L = 0.09, H = 0.022;
    sh.moveTo(0, -H / 2);
    sh.lineTo(L, -H / 2);
    const teeth = 9;
    for (let i = teeth; i >= 0; i--) {
      const z = (i / teeth) * L;
      sh.lineTo(z, H / 2 + (i % 2 === 0 ? 0.0028 : 0));
    }
    sh.closePath();
    const g = extrude(sh, 0.0022, 0.0004, 4);
    // shape x → pedal z, shape y → pedal y; extrusion → pedal x
    g.rotateY(-Math.PI / 2);
    g.translate(fx * 0.036, 0, 0);
    if (s < 0) g.scale(1, 1, -1);
    g.translate(0, 0, s * 0.002);
    bin.add("chrome", tag(g, part, 0.4));
  }
  // end plates
  for (const zz of [0.012, 0.09]) {
    const sh = new THREE.Shape();
    sh.absarc(-0.034, 0, 0.011, Math.PI / 2, (3 * Math.PI) / 2, false);
    sh.absarc(0.034, 0, 0.011, -Math.PI / 2, Math.PI / 2, false);
    sh.closePath();
    const g = extrude(sh, 0.0025, 0.0005, 8);
    g.translate(0, 0, s * zz);
    bin.add("chrome", tag(g, part, 0.6));
  }
  return bin;
}

// ------------------------------------------------------------------- main build
export function buildBike(M) {
  const root = new THREE.Group();
  root.name = "bike";
  const frame = new THREE.Group();
  root.add(frame);
  const bin = new Bin(M);

  const P = { frame: 1, lugs: 2, fork: 3, cockpit: 4, tape: 5, rimR: 6, spokesR: 7, rimF: 8, spokesF: 9, hubs: 10, crank: 11, pedals: 12, chain: 13, cog: 14, saddle: 15, brakes: 16, extras: 17 };

  // ---- main triangle
  const BB = B.BB, ST = B.ST, HT = B.HT, HB = B.HB;
  bin.add("paint", tag(rod(BB.clone().addScaledVector(B.st, 0.015), ST.clone().addScaledVector(B.st, 0.008), 0.0143, 0.0143, 32), P.frame));
  bin.add("paint", tag(rod(B.TT0, B.TT1, 0.0127, 0.0127, 32), P.frame));
  bin.add("paint", tag(rod(BB, B.DT1, 0.0145, 0.0145, 32), P.frame));
  bin.add("paint", tag(rod(HB, HT, 0.0166, 0.0166, 32), P.frame));
  // BB shell
  bin.add("paint", tag(rod(V(BB.x, BB.y, -0.034), V(BB.x, BB.y, 0.034), 0.0198, 0.0198, 32), P.frame, 0.0));
  // stays (curved, tapering)
  for (const sz of [-1, 1]) {
    const cs = curvePts([V(BB.x - 0.012, BB.y + 0.004, sz * 0.026), V(-0.12, 0.29, sz * 0.046), V(-0.3, 0.315, sz * 0.056), V(B.RA.x + 0.012, B.RA.y, sz * 0.061)], 40);
    bin.add("paint", tag(tube(cs, (s) => 0.0105 - 0.0035 * s, 16), P.frame));
    const ssTop = BB.clone().addScaledVector(B.st, 0.372);
    const ss = curvePts([V(ssTop.x - 0.006, ssTop.y, sz * 0.018), V(ssTop.x - 0.12, ssTop.y - 0.12, sz * 0.042), V(B.RA.x + 0.01, B.RA.y + 0.012, sz * 0.06)], 40);
    bin.add("paint", tag(tube(ss, (s) => 0.0085 - 0.002 * s, 16), P.frame));
    // rear dropout plate
    const dsh = new THREE.Shape();
    dsh.moveTo(-0.012, -0.012); dsh.lineTo(0.022, -0.008); dsh.lineTo(0.024, 0.016); dsh.lineTo(-0.004, 0.02);
    dsh.quadraticCurveTo(-0.018, 0.012, -0.012, -0.012);
    const dg = extrude(dsh, 0.004, 0.0008, 6);
    dg.translate(B.RA.x, B.RA.y, sz * 0.062);
    bin.add("chrome", tag(dg, P.lugs, 0.5));
  }
  // seat-stay bridge + chainstay bridge
  const sbP = B.RA.clone().addScaledVector(dir(B.RA, BB.clone().addScaledVector(B.st, 0.372)), 0.39);
  bin.add("paint", tag(rod(V(sbP.x, sbP.y, -0.048), V(sbP.x, sbP.y, 0.048), 0.0055, 0.0055, 12), P.frame, 0.9));
  B.rearBridge = sbP;

  // ---- lugs (chrome sleeves with spear points) + gold lining rings
  const lug = (at, d, len, r) => {
    bin.add("chrome", tag(lugSleeve(at, d, len, r, V(0, 0, 1)), P.lugs));
    // lining ring just past the sleeve base
    const ring = new THREE.TorusGeometry(r + 0.0002, 0.0007, 6, 40);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.clone().normalize());
    place(ring, at.clone().addScaledVector(d.clone().normalize(), len * 0.42 + 0.002), q);
    bin.add("gold", tag(ring, P.lugs, 0.6));
  };
  const ttd = dir(B.TT0, B.TT1), dtd = dir(BB, B.DT1);
  lug(B.TT1.clone().addScaledVector(ttd, 0.008), ttd.clone().negate(), 0.045, 0.0136);
  lug(B.DT1.clone().addScaledVector(dtd, 0.008), dtd.clone().negate(), 0.05, 0.0154);
  lug(B.TT0.clone().addScaledVector(ttd, -0.008), ttd.clone(), 0.045, 0.0136);
  lug(ST.clone().addScaledVector(B.st, 0.006), B.st.clone().negate(), 0.05, 0.0152);
  lug(HT.clone().addScaledVector(B.s, 0.004), B.s.clone().negate(), 0.032, 0.0174);
  lug(HB.clone().addScaledVector(B.s, -0.004), B.s.clone(), 0.032, 0.0174);
  lug(BB.clone().addScaledVector(B.st, 0.01), B.st.clone(), 0.045, 0.0152);
  lug(BB.clone().addScaledVector(dtd, 0.012), dtd.clone(), 0.05, 0.0154);
  // seat binder bolt
  const sbolt = ST.clone().addScaledVector(B.st, -0.012).add(V(-0.022, 0, 0));
  bin.add("chrome", tag(rod(V(sbolt.x, sbolt.y, -0.024), V(sbolt.x, sbolt.y, 0.024), 0.0042, 0.0042, 12), P.lugs, 0.8));
  bin.add("chrome", tag(rod(V(sbolt.x, sbolt.y, 0.024), V(sbolt.x, sbolt.y, 0.03), 0.0062, 0.0062, 6), P.lugs, 0.8));
  // head badge (brass oval on the head tube front)
  {
    const hc = HB.clone().lerp(HT, 0.5).addScaledVector(B.n, 0.0168);
    const badge = ellipsoid(0.0018, 0.022, 0.012, 24, 12);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(B.n, B.s, V(0, 0, 1)));
    place(badge, hc, q);
    bin.add("brass", tag(badge, P.extras, 0.5));
  }
  // frame pump behind the seat tube
  {
    const back = V(-B.st.y, B.st.x).multiplyScalar(-1); // points rearward
    const p0 = BB.clone().addScaledVector(B.st, 0.07).addScaledVector(back, 0.03);
    const p1 = BB.clone().addScaledVector(B.st, 0.345).addScaledVector(back, 0.03);
    bin.add("alu", tag(rod(p0, p1, 0.0115, 0.0115, 24), P.extras));
    bin.add("blackRubber", tag(rod(p0.clone().addScaledVector(B.st, -0.012), p0.clone().addScaledVector(B.st, 0.006), 0.0128, 0.0128, 24), P.extras, 0.1));
    bin.add("blackRubber", tag(rod(p1.clone().addScaledVector(B.st, -0.006), p1.clone().addScaledVector(B.st, 0.014), 0.0128, 0.0105, 24), P.extras, 0.9));
  }

  // ---- seatpost + saddle
  bin.add("chrome", tag(rod(ST.clone().addScaledVector(B.st, -0.01), B.SP, 0.0134, 0.0134, 24), P.saddle));
  buildSaddle(bin, P.saddle);
  // rear reflector on the seatpost
  {
    const rp = B.SP.clone().addScaledVector(B.st, -0.03).add(V(-0.018, 0, 0));
    const disc = new THREE.CylinderGeometry(0.022, 0.022, 0.008, 24);
    disc.rotateZ(Math.PI / 2);
    place(disc, rp);
    bin.add("reflectorRed", tag(disc, P.extras, 0.5));
  }

  // ---- rear brake on the seat-stay bridge
  buildCaliper(bin, B.rearBridge, B.RA, P.brakes, -1);

  // ---- rear brake cable along the top tube
  {
    const up = V(0, 0.0165, 0);
    const pts = curvePts([
      barPoint(V(-0.175, -0.03, 0.198)), barPoint(V(-0.1, -0.005, 0.185)), barPoint(V(-0.02, 0.012, 0.12)), barPoint(V(0.012, -0.01, 0.05)),
      B.TT1.clone().addScaledVector(ttd, -0.05).add(up.clone().multiplyScalar(1.8)), B.TT1.clone().addScaledVector(ttd, -0.12).add(up), B.TT0.clone().addScaledVector(ttd, 0.07).add(up),
      B.TT0.clone().addScaledVector(ttd, 0.01).add(V(-0.01, 0.03, 0.0)),
      B.rearBridge.clone().add(V(0.005, 0.035, 0)),
    ], 120);
    bin.add("cable", tag(tube(pts, 0.0024, 8), P.brakes));
  }
  bin.into(frame, "frame");

  // ---- steering assembly (pivot on the steering axis at the head tube bottom)
  const steer = new THREE.Group();
  steer.position.copy(HB);
  root.add(steer);
  const sb = new Bin(M);
  const rel = (p) => p.clone().sub(HB);
  // fork crown + blades
  {
    const crown = ellipsoid(0.021, 0.012, 0.05, 32, 16);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(B.n, B.s, V(0, 0, 1)));
    place(crown, rel(B.C), q);
    sb.add("chrome", tag(crown, P.fork, 0.0));
    for (const sz of [-1, 1]) {
      const pts = [];
      const ks = [0.004, 0.12, 0.22, 0.29, 0.335, 0.365], ms = [0, 0.001, 0.006, 0.015, 0.028, 0.045];
      for (let i = 0; i < ks.length; i++) {
        const z = sz * (0.04 + 0.01 * (i / (ks.length - 1)));
        pts.push(rel(B.C.clone().addScaledVector(B.s, -ks[i]).addScaledVector(B.n, ms[i])).setZ(z));
      }
      sb.add("paint", tag(tube(curvePts(pts, 48), (s) => 0.0118 - 0.0055 * s, 16), P.fork));
      // chrome fork tips
      const tip = curvePts(pts.slice(3), 16);
      sb.add("chrome", tag(tube(tip, (s) => 0.0072 - 0.0012 * s, 16), P.fork, 0.95));
      const dg = new THREE.CylinderGeometry(0.009, 0.009, 0.004, 20);
      dg.rotateX(Math.PI / 2);
      place(dg, rel(B.FA).setZ(sz * 0.051));
      sb.add("chrome", tag(dg, P.fork, 0.99));
    }
    // headset cups, steerer, quill stem
    sb.add("chrome", tag(rod(rel(HB.clone().addScaledVector(B.s, -0.009)), rel(HB.clone().addScaledVector(B.s, 0.006)), 0.0186, 0.0186, 32), P.cockpit, 0.0));
    sb.add("chrome", tag(rod(rel(HT.clone().addScaledVector(B.s, -0.004)), rel(HT.clone().addScaledVector(B.s, 0.016)), 0.0188, 0.0188, 32), P.cockpit, 0.05));
    sb.add("chrome", tag(rod(rel(HT.clone().addScaledVector(B.s, 0.016)), rel(HT.clone().addScaledVector(B.s, 0.024)), 0.017, 0.015, 6), P.cockpit, 0.1));
    sb.add("chrome", tag(rod(rel(HT.clone().addScaledVector(B.s, 0.02)), rel(B.Q), 0.0112, 0.0112, 24), P.cockpit, 0.2));
    const stemTop = B.Q.clone().addScaledVector(B.s, 0.006);
    sb.add("chrome", tag(rod(rel(B.Q.clone().addScaledVector(B.s, -0.008)), rel(B.BC), 0.0125, 0.0115, 24), P.cockpit, 0.3));
    sb.add("chrome", tag(rod(rel(stemTop), rel(stemTop.clone().addScaledVector(B.s, 0.004)), 0.0085, 0.0085, 6), P.cockpit, 0.3));
    sb.add("chrome", tag(rod(rel(B.BC.clone().setZ(-0.02)), rel(B.BC.clone().setZ(0.02)), 0.0165, 0.0165, 32), P.cockpit, 0.35));
  }
  // handlebar (swept-back Albatross bar) + leather grips + city brake levers
  {
    const left = BAR_R.slice(1).reverse().map((p) => V(p.x, p.y, -p.z));
    const all = [...left, ...BAR_R];
    const pts = curvePts(all.map((p) => rel(barPoint(p))), 200);
    sb.add("chrome", tag(tube(pts, (s) => (Math.abs(s - 0.5) < 0.035 ? 0.0128 : 0.0112), 20), P.cockpit));
    const half = curvePts(BAR_R.map((p) => p.clone()), 120);
    for (const sz of [-1, 1]) {
      const gp = half.slice(Math.floor(B.gripStart * 120)).map((p) => rel(barPoint(V(p.x, p.y, p.z * sz))));
      const g = tube(gp, (s) => 0.0152 + 0.0012 * Math.sin(s * Math.PI), 20, { caps: true });
      sb.add("leather", tag(g, P.tape, "v"));
      // brass ferrule at the grip front + end cap
      const f0 = gp[0], f1 = gp[3];
      sb.add("brass", tag(tube([f0.clone().lerp(f1, -0.3), f0.clone().lerp(f1, 0.6)], 0.0166, 20, { caps: true }), P.tape, 0.0));
      const e0 = gp[gp.length - 1], e1 = gp[gp.length - 3];
      sb.add("brass", tag(tube([e0.clone().lerp(e1, 0.5), e0.clone().lerp(e1, -0.4)], 0.0164, 20, { caps: true }), P.tape, 0.99));
      // city brake lever: clamp body ahead of the grip, blade running back under it
      const zL = 0.2 * sz;
      const body = ellGeo(0.022, 0.013, 0.013, 20, 12);
      place(body, rel(barPoint(V(-0.192, -0.036, zL))), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -sz * 0.45, -0.25)));
      sb.add("alu", tag(body, P.tape, 0.5));
      sb.add("alu", tag(rod(rel(barPoint(V(-0.192, -0.026, zL - 0.016 * sz))), rel(barPoint(V(-0.192, -0.026, zL + 0.016 * sz))), 0.0148, 0.0148, 16), P.tape, 0.5));
      const lever = curvePts([V(-0.2, -0.05, zL + 0.004 * sz), V(-0.24, -0.06, zL + 0.007 * sz), V(-0.285, -0.058, zL + 0.009 * sz), V(-0.31, -0.052, zL + 0.01 * sz)].map((p) => rel(barPoint(p))), 30);
      sb.add("alu", tag(sweep(lever, (s, a) => {
        const ang = a * TAU;
        return [Math.cos(ang) * 0.0035, Math.sin(ang) * (0.0075 - 0.002 * s)];
      }, { radial: 14, caps: true, up: V(0, 1, 0) }), P.tape, 0.7));
    }
    // bell on the left bar top
    const bc = barPoint(V(-0.004, 0.0, -0.075));
    sb.add("chrome", tag(rod(rel(bc.clone().add(V(0, -0.003, 0))), rel(bc.clone().add(V(0, 0.017, 0))), 0.0045, 0.0045, 12), P.extras, 0.5));
    const dome = latheZ([[0.0001, 0.019], [0.006, 0.0185], [0.013, 0.016], [0.0185, 0.011], [0.0215, 0.005], [0.0225, 0.0], [0.0218, -0.0008], [0.019, -0.0008], [0.0001, -0.0008]], 48);
    dome.rotateX(-Math.PI / 2);
    place(dome, rel(bc.clone().add(V(0, 0.017, 0))));
    sb.add("chrome", tag(dome, P.extras, 0.7));
    const thumb = rod(rel(bc.clone().add(V(0.0, 0.02, 0.0))), rel(bc.clone().add(V(0.012, 0.024, -0.025))), 0.0022, 0.0018, 8);
    sb.add("brass", tag(thumb, P.extras, 0.9));
    B.bellPos = bc.clone().add(V(0, 0.03, 0));
  }
  // front brake + its cable + headlamp
  {
    const above = B.C.clone().addScaledVector(B.n, 0.024).addScaledVector(B.s, -0.004);
    buildCaliper(sb, above, B.FA, P.brakes, 1, rel);
    const cp = curvePts([
      barPoint(V(-0.175, -0.03, -0.198)), barPoint(V(-0.09, 0.0, -0.182)), barPoint(V(0.0, 0.03, -0.11)), barPoint(V(0.035, 0.0, -0.05)),
      above.clone().addScaledVector(B.s, 0.11).addScaledVector(B.n, 0.01), above.clone().addScaledVector(B.s, 0.03),
    ].map(rel), 80);
    sb.add("cable", tag(tube(cp, 0.0024, 8), P.brakes));
    // headlamp on a bracket on the crown
    const lc = B.C.clone().addScaledVector(B.n, 0.07).addScaledVector(B.s, 0.012);
    const lamp = latheZ([[0.0001, -0.036], [0.01, -0.034], [0.019, -0.026], [0.024, -0.012], [0.026, 0.004], [0.026, 0.012], [0.0275, 0.014], [0.0275, 0.018], [0.0001, 0.018]], 48);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(1, 0, 0));
    place(lamp, rel(lc), q);
    sb.add("chrome", tag(lamp, P.extras, 0.4));
    const lens = new THREE.SphereGeometry(0.04, 32, 12, 0, TAU, 0, 0.748);
    lens.rotateZ(-Math.PI / 2);
    place(lens, rel(lc.clone().add(V(-0.0123, 0, 0))));
    sb.add("glass", tag(lens, P.extras, 0.6));
    sb.add("chrome", tag(rod(rel(B.C.clone().addScaledVector(B.n, 0.012)), rel(lc.clone().add(V(-0.03, 0, 0))), 0.004, 0.004, 8), P.extras, 0.2));
    B.lampPos = lc.clone().add(V(0.03, 0, 0));
  }
  sb.into(steer, "steer");
  const frontWheel = buildWheel(M, true, P.rimF, P.spokesF, P.hubs);
  frontWheel.position.copy(rel(B.FA));
  steer.add(frontWheel);

  // ---- rear wheel + cog
  const rearWheel = buildWheel(M, false, P.rimR, P.spokesR, P.hubs);
  rearWheel.position.copy(B.RA);
  root.add(rearWheel);
  const cog = new THREE.Group();
  cog.position.copy(B.RA);
  {
    const cb = new Bin(M);
    const { shape } = sprocketShape(B.cogTeeth, B.pitch, 0.00775, 0.012);
    const g = extrude(shape, 0.0022, 0.0003, 8);
    g.translate(0, 0, B.chainline);
    cb.add("darkSteel", tag(g, P.cog, (x, y) => Math.atan2(y, x)));
    cb.add("darkSteel", tag(rod(V(0, 0, B.chainline - 0.009), V(0, 0, B.chainline + 0.007), 0.018, 0.018, 32), P.cog, 0.5));
    cb.into(cog, "cog");
  }
  root.add(cog);

  // ---- cranks
  const cranks = new THREE.Group();
  cranks.position.copy(BB);
  root.add(cranks);
  const pedals = [];
  {
    const cb = new Bin(M);
    const { shape } = sprocketShape(B.ringTeeth, B.pitch, 0.00775, 0.0705);
    const ring = extrude(shape, 0.0024, 0.0003, 8);
    ring.rotateZ(chainPath().ringPhase); // valleys line up with the chain pins
    ring.translate(0, 0, B.chainline);
    cb.add("alu", tag(ring, P.crank, (x, y) => (Math.atan2(y, x) + TAU) % TAU));
    // 5-arm spider aligned with the drive crank
    const sp = new THREE.Shape();
    const steps = 360;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU;
      let arm = 0;
      for (let k = 0; k < 5; k++) {
        let d = a - (k * TAU) / 5;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        arm = Math.max(arm, Math.exp(-((d / 0.16) ** 2)));
      }
      const r = 0.027 + 0.053 * arm;
      if (i === 0) sp.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sp.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const spg = extrude(sp, 0.005, 0.0012, 4);
    spg.translate(0, 0, B.chainline + 0.0045);
    cb.add("alu", tag(spg, P.crank, 0.3));
    for (let k = 0; k < 5; k++) {
      const a = (k * TAU) / 5;
      const bp = V(Math.cos(a) * 0.072, Math.sin(a) * 0.072);
      cb.add("chrome", tag(rod(bp.clone().setZ(B.chainline - 0.004), bp.clone().setZ(B.chainline + 0.009), 0.0042, 0.0042, 12), P.crank, 0.6));
    }
    // crank arms (drive side points along +x at angle 0; left arm at +π)
    const armShape = () => {
      const s = new THREE.Shape();
      const L = B.crankLen;
      s.moveTo(0, -0.019);
      s.bezierCurveTo(0.05, -0.016, L - 0.04, -0.011, L, -0.0115);
      s.absarc(L, 0, 0.0115, -Math.PI / 2, Math.PI / 2, false);
      s.bezierCurveTo(L - 0.04, 0.011, 0.05, 0.016, 0, 0.019);
      s.absarc(0, 0, 0.019, Math.PI / 2, (3 * Math.PI) / 2, false);
      return s;
    };
    const armR = extrude(armShape(), 0.01, 0.0022, 12);
    armR.translate(0, 0, B.chainline + 0.017);
    cb.add("alu", tag(armR, P.crank, new THREE.Vector3(1, 0, 0)));
    const armL = extrude(armShape(), 0.01, 0.0022, 12);
    armL.rotateZ(Math.PI);
    armL.translate(0, 0, -0.064);
    cb.add("alu", tag(armL, P.crank, new THREE.Vector3(-1, 0, 0)));
    // crank bolts / dust caps
    cb.add("chrome", tag(rod(V(0, 0, B.chainline + 0.022), V(0, 0, B.chainline + 0.025), 0.011, 0.011, 24), P.crank, 0.0));
    cb.add("chrome", tag(rod(V(0, 0, -0.072), V(0, 0, -0.069), 0.011, 0.011, 24), P.crank, 0.0));
    cb.into(cranks, "cranks");
    for (const side of [1, -1]) {
      const pg = new THREE.Group();
      const a = side > 0 ? 0 : Math.PI;
      pg.position.set(Math.cos(a) * B.crankLen, Math.sin(a) * B.crankLen, side > 0 ? B.chainline + 0.022 : -0.069);
      buildPedal(M, side, P.pedals).into(pg, "pedal");
      cranks.add(pg);
      pedals.push(pg);
    }
  }

  // ---- chain (instanced)
  const chain = buildChain(M, P.chain);
  root.add(chain.group);

  const steerAxis = V(B.s.x, B.s.y, 0).normalize();
  const state = { crank: 0, wheel: 0, steer: 0 };
  const _q = new THREE.Quaternion();

  function update(st) {
    Object.assign(state, st);
    rearWheel.rotation.z = state.wheel;
    frontWheel.rotation.z = state.wheel;
    cranks.rotation.z = state.crank;
    for (let i = 0; i < 2; i++) {
      pedals[i].rotation.z = -state.crank + (st.pedalTilt ? st.pedalTilt[i] : 0);
    }
    const pinOffset = -state.crank * (B.ringTeeth / TAU);
    cog.rotation.z = -pinOffset * (TAU / B.cogTeeth) + chain.cogPhase0;
    steer.quaternion.copy(_q.setFromAxisAngle(steerAxis, state.steer));
    chain.update(pinOffset);
  }

  // world-space helpers in bike-root coordinates
  function pedalPoint(i, out = new THREE.Vector3()) {
    // centre of the pedal top surface
    const side = i === 0 ? 1 : -1;
    const a = state.crank + (i === 0 ? 0 : Math.PI);
    return out.set(B.BB.x + Math.cos(a) * B.crankLen, B.BB.y + Math.sin(a) * B.crankLen + 0.013, side * 0.118);
  }

  const info = {
    spokes: 64,
    links: B.links,
    teeth: B.ringTeeth + B.cogTeeth,
  };
  update(state);
  return { root, frame, steer, rearWheel, frontWheel, cranks, pedals, cog, chain, update, pedalPoint, info, P };
}

// side-pull caliper. `top` = pivot point, `axle` = wheel axle; side +1 front (in steer group), -1 rear
function buildCaliper(bin, top, axle, part, side, rel = (p) => p.clone()) {
  const toTop = dir(axle, top);
  const padC = axle.clone().addScaledVector(toTop, 0.288);
  const tangent = V(-toTop.y, toTop.x); // along the rim
  // pivot bolt
  bin.add("chrome", tag(rod(rel(top.clone().setZ(-0.012)), rel(top.clone().setZ(0.016)), 0.004, 0.004, 12), part, 0.0));
  bin.add("chrome", tag(rod(rel(top.clone().setZ(0.016)), rel(top.clone().setZ(0.022)), 0.006, 0.006, 6), part, 0.0));
  for (const sz of [-1, 1]) {
    const pts = curvePts([
      top.clone().setZ(sz * 0.006),
      top.clone().addScaledVector(toTop, -0.004).addScaledVector(tangent, 0.012 * sz).setZ(sz * 0.022),
      padC.clone().addScaledVector(toTop, 0.022).addScaledVector(tangent, 0.004 * sz).setZ(sz * 0.03),
      padC.clone().setZ(sz * 0.025),
    ].map(rel), 30);
    bin.add("chrome", tag(sweep(pts, (s, a) => {
      const ang = a * TAU;
      return [Math.cos(ang) * 0.0055, Math.sin(ang) * 0.0028];
    }, { radial: 12, caps: true, up: V(0, 0, 1) }), part));
    // pad
    const pad = new THREE.BoxGeometry(0.036, 0.008, 0.006);
    const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), tangent);
    place(pad, rel(padC.clone().setZ(sz * 0.0175)), q);
    bin.add("blackRubber", tag(pad, part, 0.95));
  }
  // spring wire
  const sp = curvePts([top.clone().setZ(0.02).addScaledVector(toTop, 0.004), top.clone().setZ(0.03).addScaledVector(toTop, 0.01), top.clone().setZ(0.024).addScaledVector(toTop, -0.012)].map(rel), 12);
  bin.add("chrome", tag(tube(sp, 0.0012, 6), part, 0.7));
  void side;
}

function buildSaddle(bin, part) {
  // saddle-local: x forward. Built in bike coords around the clamp.
  const base = B.SP.clone();
  const x0 = -0.105, x1 = 0.17; // rear, nose
  const topY = 0.052;
  const width = (x) => {
    const u = (x - x0) / (x1 - x0); // 0 rear → 1 nose
    const rear = 0.085 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, 0.13 - u) / 0.13, 2)));
    const w = THREE.MathUtils.lerp(0.085, 0.024, THREE.MathUtils.smoothstep(u, 0.25, 0.72));
    const nose = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, u - 0.92) / 0.08, 2)));
    return Math.min(rear, w) * nose + 0.0004;
  };
  const height = (x) => {
    const u = (x - x0) / (x1 - x0);
    return topY - 0.006 * u + 0.004 * Math.sin(u * Math.PI);
  };
  const skirt = (x) => {
    const u = (x - x0) / (x1 - x0);
    return THREE.MathUtils.lerp(0.032, 0.016, THREE.MathUtils.smoothstep(u, 0.2, 0.8));
  };
  const pts = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const e = 0.5 - 0.5 * Math.cos(t * Math.PI); // dense at both ends
    pts.push(V(base.x + x0 + (x1 - x0) * e, base.y, 0));
  }
  const g = sweep(pts, (s, a, i) => {
    const x = pts[i].x - base.x;
    const w = width(x), h = height(x), sk = skirt(x) * Math.min(1, w / 0.03);
    // a: 0..0.5 top skin left→right, 0.5..1 underside right→left
    const outer = a < 0.5;
    const t = outer ? a / 0.5 : (a - 0.5) / 0.5;
    const phi = (outer ? t - 0.5 : 0.5 - t) * Math.PI;
    const inset = outer ? 0 : 0.0035;
    const z = Math.sin(phi) * Math.max(0, w - inset);
    const yy = h - (1 - Math.cos(phi)) * (sk * 0.62) * 1.0 - (Math.abs(phi) > 1.2 ? (Math.abs(phi) - 1.2) * sk * 0.9 : 0) - inset;
    return [yy, z];
  }, { radial: 48, up: V(0, 1, 0) });
  bin.add("leather", tag(g, part, new THREE.Vector3(1, 0, 0)));
  // copper rivets along the rear arc and at the nose
  for (let k = 0; k < 5; k++) {
    const phi = (-0.9 + (1.8 * k) / 4);
    const x = x0 + 0.012 + 0.012 * (1 - Math.cos(phi));
    const w = width(x) * 0.98;
    const p = V(base.x + x - 0.004 * Math.cos(phi), base.y + height(x) - 0.018 - 0.004 * Math.abs(phi), Math.sin(phi) * w);
    const r = new THREE.SphereGeometry(0.0058, 16, 8, 0, TAU, 0, Math.PI / 2);
    r.scale(1, 0.55, 1);
    const nrm = V(-Math.cos(phi) * 0.7, 0.1, Math.sin(phi)).normalize();
    place(r, p, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), nrm));
    bin.add("copper", tag(r, part, 0.9));
  }
  {
    const p = V(base.x + x1 - 0.02, base.y + height(x1 - 0.02) - 0.004, 0);
    const r = new THREE.SphereGeometry(0.0035, 12, 8, 0, TAU, 0, Math.PI / 2);
    place(r, p);
    bin.add("copper", tag(r, part, 0.95));
  }
  // cantle plate under the rear skirt
  const cant = curvePts([0, 1, 2, 3, 4, 5, 6].map((k) => {
    const phi = -1.25 + (2.5 * k) / 6;
    return V(base.x + x0 + 0.02 + 0.012 * (1 - Math.cos(phi)), base.y + topY - 0.034, Math.sin(phi) * 0.07);
  }), 40);
  bin.add("chrome", tag(sweep(cant, (s, a) => {
    const ang = a * TAU;
    return [Math.sin(ang) * 0.007, Math.cos(ang) * 0.0012];
  }, { radial: 10, up: V(0, 1, 0) }), part, 0.6));
  // rails + coil springs (B66 style)
  for (const sz of [-1, 1]) {
    const rail = curvePts([
      V(base.x + x1 - 0.03, base.y + topY - 0.018, 0.006 * sz), V(base.x + 0.06, base.y + 0.012, 0.02 * sz),
      V(base.x - 0.01, base.y + 0.004, 0.022 * sz), V(base.x - 0.055, base.y + 0.006, 0.03 * sz),
      V(base.x - 0.075, base.y + 0.01, 0.045 * sz),
    ], 60);
    bin.add("chrome", tag(tube(rail, 0.0035, 10), part, 0.5));
    const hp = helixPts(0.0105, 0.0042, 6.5, 160).map((p) => p.add(V(base.x - 0.075, base.y + 0.006, 0.045 * sz)));
    bin.add("chrome", tag(tube(hp, 0.0018, 6), part, 0.7));
  }
  // clamp
  bin.add("chrome", tag(rod(V(base.x, base.y - 0.004, -0.028), V(base.x, base.y - 0.004, 0.028), 0.0075, 0.0075, 16), part, 0.4));
  bin.add("chrome", tag(rod(V(base.x - 0.012, base.y - 0.012, 0), V(base.x + 0.012, base.y + 0.006, 0), 0.0105, 0.0105, 16), part, 0.4));
}

function buildChain(M, part) {
  const path = chainPath();
  const N = B.links;
  const group = new THREE.Group();
  const plateShape = (r, waist) => {
    const s = new THREE.Shape();
    const p = B.pitch / 2;
    const a = Math.asin(waist / r);
    s.absarc(p, 0, r, -Math.PI + a, Math.PI - a, false);
    s.quadraticCurveTo(0, waist * 0.92, -p + Math.cos(a) * r, waist);
    s.absarc(-p, 0, r, a, TAU - a, false);
    s.quadraticCurveTo(0, -waist * 0.92, p - Math.cos(a) * r, -waist);
    return s;
  };
  const mk = (r, waist, zOff) => {
    const g1 = extrude(plateShape(r, waist), 0.0009, 0.0002, 8);
    g1.translate(0, 0, zOff);
    const g2 = extrude(plateShape(r, waist), 0.0009, 0.0002, 8);
    g2.translate(0, 0, -zOff);
    return merge([g1, g2]);
  };
  const outer = mk(0.0047, 0.0036, 0.0045);
  const inner = mk(0.0043, 0.0034, 0.0031);
  const roll = merge([
    rod(V(0, 0, -0.0026), V(0, 0, 0.0026), 0.0038, 0.0038, 14),
    rod(V(0, 0, -0.0056), V(0, 0, 0.0056), 0.00185, 0.00185, 8),
  ]);
  const half = N / 2;
  const seqHalf = (i) => (2 * i) / N;
  const geoTag = (g, count, f) => {
    g.setAttribute("aPart", new THREE.InstancedBufferAttribute(new Float32Array(count).fill(part), 1));
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) s[i] = Math.min(0.999, f(i));
    g.setAttribute("aSeq", new THREE.InstancedBufferAttribute(s, 1));
    return g;
  };
  const outerMesh = new THREE.InstancedMesh(geoTag(outer, half, seqHalf), M.chainPlate, half);
  const innerMesh = new THREE.InstancedMesh(geoTag(inner, half, seqHalf), M.chainPlate, half);
  const rollMesh = new THREE.InstancedMesh(geoTag(roll, N, (i) => i / N), M.darkSteel, N);
  for (const m of [outerMesh, innerMesh, rollMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const zAxis = new THREE.Vector3(0, 0, 1);
  function update(u0) {
    for (let i = 0; i < N; i++) {
      path.at(i + u0, pa);
      path.at(i + 1 + u0, pb);
      const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      q.setFromAxisAngle(zAxis, ang);
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      mtx.compose(mid, q, one);
      if (i % 2 === 0) outerMesh.setMatrixAt(i / 2, mtx);
      else innerMesh.setMatrixAt((i - 1) / 2, mtx);
      mtx.compose(pa, q, one);
      rollMesh.setMatrixAt(i, mtx);
    }
    outerMesh.instanceMatrix.needsUpdate = true;
    innerMesh.instanceMatrix.needsUpdate = true;
    rollMesh.instanceMatrix.needsUpdate = true;
  }
  return { group, update, cogPhase0: path.cogPhase, path, ringPhase: path.ringPhase };
}
