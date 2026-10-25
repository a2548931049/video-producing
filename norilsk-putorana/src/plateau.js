// World B — the Putorana Plateau at the first sunrise after the polar night.
// A frozen fjord-lake between stepped basalt walls (the strata run level for kilometres),
// snow on every ledge, alpenglow on the rims, an icefall, bare larches; then the canyon
// opens onto a frozen basin ringed by flat-topped mesas, and the sun.
(function () {
  const NP = window.NP;
  const { hex, mix, mul, css, clamp, lerp, smoothstep, hash } = NP;
  const camB = NP.camTracks.B;

  const C = {
    fog: hex("#b4a1c6"),
    rockTop: hex("#4c4479"),
    rockBot: hex("#2a2550"),
    rockAlt: hex("#352f61"),
    litTop: hex("#e3967f"),
    litBot: hex("#a8677a"),
    ledge: hex("#b9c0e3"),
    ledgeLit: hex("#ffcfb3"),
    lip: hex("#c8cee9"),
    lipLit: hex("#ffe1c8"),
    table: hex("#cfc6e6"),
    tableLit: hex("#ffcdb0"),
    lake: hex("#c4bedd"),
    lakeFar: hex("#e7c2c2"),
    iceDark: hex("#56679a"),
    crack: hex("#e8ecfa"),
    icefall: hex("#9fd4ec"),
    icefallHi: hex("#e8f8ff"),
    larch: hex("#2b2236"),
    cloudUnder: hex("#e9a99d"),
    cloudBody: hex("#e7deec"),
    cloudTop: hex("#f8f3f5"),
    whiteout: hex("#ede3da"),
  };

  const items = [];
  const add = (it) => (items.push(it), it);

  // ---------------------------------------------------------------------------
  // Canyon plan: centre line, half-width at the lake, and strata that run level.
  const PH = [1.3, 4.1, 2.2, 5.3, 0.7, 3.3, 2.8, 0.2];
  const noise = (x, k) => 0.5 + 0.26 * Math.sin(x * 1.0 + PH[k % 8]) + 0.16 * Math.sin(x * 2.3 + PH[(k + 3) % 8]) + 0.08 * Math.sin(x * 5.7 + PH[(k + 5) % 8]);
  const centre = (z) => 34 * smoothstep(300, 900, z) * Math.sin((z - 300) / 260);
  const halfW = (z) => 122 + 22 * Math.sin(z / 230 + 1.1) - 56 * Math.exp(-Math.pow((z - 195) / 55, 2));
  const outerW = (z, side) => 420 + 520 * noise(z * 0.0021, side < 0 ? 1 : 4);
  const LEVELS = [22, 60, 118, 150, 212, 258, 300, 356];
  const TOP = 356;
  const Z_MOUTH = 900;

  function wallEdge(z, side) {
    const k = side < 0 ? 0 : 3;
    const xin = centre(z) + side * halfW(z);
    const pts = [[xin - side * 8, -40], [xin, 0]];
    let e = 12 + 14 * noise(z * 0.004, k);
    pts.push([xin + side * e, LEVELS[0]]);
    for (let i = 1; i < LEVELS.length; i++) {
      const rise = 2 + 7 * noise(z * 0.006 + i * 1.3, k + i);
      const jit = 2.2 * (noise(z * 0.05 + i * 2.1, k + i + 1) - 0.5);
      pts.push([xin + side * (e + jit), LEVELS[i] - rise]);
      e += i === LEVELS.length - 1 ? 2 : 5 + 26 * noise(z * 0.0045 + i * 0.9, k + i);
      pts.push([xin + side * (e + jit), LEVELS[i]]);
    }
    return { pts, xin };
  }
  function wallProfile(z, side) {
    const { pts, xin } = wallEdge(z, side);
    const far = xin + side * outerW(z, side);
    return side < 0 ? [[far, -40], ...pts, [far, TOP]] : [[far, -40], [far, TOP], ...pts.slice().reverse()];
  }

  // Sun and light: the rims catch the first sun; the line slides down as it rises.
  const env = {
    fogCol: C.fog,
    fog: (d) => NP.fogK(d, 5600),
    t: 0,
    sun: 0,
    lightY: 300,
    sunU: 262,
    sunV: -24,
  };

  // Points on a profile edge at height y, at both ends of the loft.
  function onEdge(p0, p1, y) {
    const k = (y - p0[1]) / (p1[1] - p0[1] || 1);
    return [p0[0] + (p1[0] - p0[0]) * k, y];
  }
  function at(L, P, Q, z) {
    const k = (z - L.za) / (L.zb - L.za);
    return [P[0] + (Q[0] - P[0]) * k, P[1] + (Q[1] - P[1]) * k, z];
  }

  function wallFace(ctx, cam, env, e, dist, L) {
    const A = L.A;
    const B = L.B;
    const a0 = A[e.i];
    const a1 = A[e.j];
    const b0 = B[e.i];
    const b1 = B[e.j];
    const k = env.fog(dist);
    const zb = L.zb + 0.8;
    const quad = (p0, p1, q1, q0) => [[p0[0], p0[1], L.za], [p1[0], p1[1], L.za], [q1[0], q1[1], zb], [q0[0], q0[1], zb]];
    if (e.type === "ledge") {
      const y = (a0[1] + a1[1]) / 2;
      let col;
      if (y >= TOP - 1) col = mix(C.table, C.tableLit, env.sun);
      else col = mix(C.ledge, C.ledgeLit, y > env.lightY ? 0.65 : 0);
      NP.fill3D(ctx, cam, quad(a0, a1, b1, b0), css(mix(col, env.fogCol, k)));
      if (L.icefall) iceOver(ctx, cam, env, L, a0, a1, b0, b1, k, true);
      return;
    }
    const lo = a0[1] < a1[1] ? [a0, a1, b0, b1] : [a1, a0, b1, b0];
    const yBot = lo[0][1];
    const yTop = lo[1][1];
    const sunSide = L.side < 0;
    const ySplit = sunSide ? clamp(env.lightY, yBot, yTop) : yTop;
    const part = (y0, y1, col) => {
      const pa0 = onEdge(lo[0], lo[1], y0);
      const pa1 = onEdge(lo[0], lo[1], y1);
      const pb0 = onEdge(lo[2], lo[3], y0);
      const pb1 = onEdge(lo[2], lo[3], y1);
      NP.fill3D(ctx, cam, quad(pa0, pa1, pb1, pb0), css(mix(col, env.fogCol, k)));
    };
    // One flat ink per stratum: the higher, the more sky it sees.
    const level = Math.max(0, LEVELS.findIndex((v) => v >= yTop - 12));
    const shade = mix(level % 2 ? C.rockAlt : C.rockBot, C.rockTop, 0.18 + 0.5 * (level / (LEVELS.length - 1)));
    if (ySplit > yBot + 0.3) part(yBot, ySplit, shade);
    if (ySplit < yTop - 0.3) part(ySplit, yTop, mix(C.litBot, C.litTop, 0.35 + 0.4 * env.sun));
    // Snow lip on the ledge above, its thickness drifting along the wall.
    if (yTop - yBot > 4) {
      const lit = sunSide && yTop > env.lightY;
      const lvl = Math.max(0, LEVELS.findIndex((v) => v >= yTop - 12));
      const thick = (z) => 0.8 + 3.2 * noise(z * 0.011 + lvl * 1.7, lvl + 2);
      const l0 = onEdge(lo[0], lo[1], yTop - thick(L.za));
      const l2 = onEdge(lo[2], lo[3], yTop - thick(L.zb));
      NP.fill3D(ctx, cam, quad(l0, [lo[1][0], yTop + 0.5], [lo[3][0], yTop + 0.5], l2), css(mix(lit ? C.lipLit : C.lip, env.fogCol, k)));
    }
    if (L.icefall) iceOver(ctx, cam, env, L, lo[0], lo[1], lo[2], lo[3], k, false);
  }

  // The frozen waterfall: an ice ribbon laid over every face it crosses.
  function iceOver(ctx, cam, env, L, a0, a1, b0, b1, k, flat) {
    const z0 = Math.max(L.za, L.icefall[0]);
    const z1 = Math.min(L.zb, L.icefall[1]);
    if (z1 <= z0) return;
    const P = [at(L, a0, b0, z0), at(L, a1, b1, z0), at(L, a1, b1, z1), at(L, a0, b0, z1)];
    for (const p of P) p[0] -= 0.6;
    const r = NP.path3D(ctx, cam, P);
    if (!r) return;
    const g = ctx.createLinearGradient(r[2], 0, r[3], 0);
    const ice = flat ? C.icefallHi : C.icefall;
    g.addColorStop(0, css(mix(mul(ice, 0.8), env.fogCol, k)));
    g.addColorStop(0.42, css(mix(C.icefallHi, env.fogCol, k)));
    g.addColorStop(0.58, css(mix(ice, env.fogCol, k)));
    g.addColorStop(1, css(mix(mul(ice, 0.72), env.fogCol, k)));
    ctx.fillStyle = g;
    ctx.fill();
  }

  const Z_ICE = camB.z(6.08) + 16;
  for (const side of [-1, 1]) {
    let z = 0;
    while (z < Z_MOUTH) {
      const len = 40;
      const A = wallProfile(z, side);
      const B = wallProfile(z + len, side);
      const L = NP.loft(A, B, z, z + len, wallFace, { side });
      if (side > 0 && Z_ICE + 12 > z && Z_ICE - 12 < z + len) L.icefall = [Z_ICE - 12, Z_ICE + 12];
      add(L);
      z += len;
    }
  }
  // Ice cone at the foot of the icefall.
  (function () {
    const x = centre(Z_ICE) + halfW(Z_ICE) + 3;
    const p = new Path2D();
    p.ellipse(0, -1, 26, 15, 0, Math.PI, 0, true);
    p.closePath();
    const hi = new Path2D();
    hi.ellipse(-4, -1, 9, 13, 0, Math.PI, 0, true);
    hi.closePath();
    add(NP.card(x, 0, Z_ICE, [-27, -1, 27, 15], [{ path: p, col: C.icefall }, { path: hi, col: C.icefallHi, alpha: 0.85 }]));
  })();

  // ---------------------------------------------------------------------------
  // Mesas: stacks of slabs, each set back a little — the trap staircase on all sides.
  function mesa(rnd, xc, z, w, dep, h, nLayers) {
    const boxes = [];
    let x0 = xc - w / 2;
    let x1 = xc + w / 2;
    let z0 = z;
    let z1 = z + dep;
    let y = -40;
    // Uneven strata: cut the cliff band into nLayers pieces of random size.
    const cuts = [];
    let acc = 0;
    for (let i = 0; i < nLayers; i++) cuts.push((acc += 0.5 + rnd()));
    const base = h * (0.16 + rnd() * 0.12);
    for (let i = 0; i < nLayers; i++) {
      const yTop = i === nLayers - 1 ? h : base + ((h - base) * cuts[i]) / acc;
      boxes.push({ x0, x1, y0: y, y1: yTop, z0, z1 });
      const m = Math.min(x1 - x0, z1 - z0);
      const inset = (i === 0 ? 0.07 + rnd() * 0.05 : 0.012 + rnd() * 0.035) * m;
      x0 += inset * (0.4 + rnd() * 1.2);
      x1 -= inset * (0.4 + rnd() * 1.2);
      z0 += inset * (0.4 + rnd() * 1.2);
      z1 -= inset * (0.3 + rnd() * 0.5);
      y = yTop;
      if (x1 - x0 < 60 || z1 - z0 < 60) break;
    }
    return boxes;
  }

  function drawBox(ctx, cam, b, env, isTop) {
    const xm = Math.max(b.x0, Math.min(cam.x, b.x1));
    const zm = Math.max(b.z0, Math.min(cam.z, b.z1));
    const k = env.fog(Math.hypot(xm - cam.x, zm - cam.z, (b.y0 + b.y1) / 2 - cam.y));
    const lit = b.y1 > env.lightY + 260;
    const riser = (pts, warm) => {
      const r = NP.path3D(ctx, cam, pts);
      if (!r) return;
      const g = ctx.createLinearGradient(0, r[0], 0, r[1]);
      g.addColorStop(0, css(mix(mix(C.rockTop, C.litTop, warm), env.fogCol, k)));
      g.addColorStop(1, css(mix(mix(C.rockBot, C.litBot, warm * 0.5), env.fogCol, k)));
      ctx.fillStyle = g;
      ctx.fill();
    };
    const L = isTop ? 7 : 4;
    const lipCol = css(mix(isTop ? mix(C.lip, C.lipLit, env.sun) : C.lip, env.fogCol, k));
    if (cam.z < b.z0) {
      riser([[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]], 0);
      NP.fill3D(ctx, cam, [[b.x0, b.y1 - L, b.z0], [b.x1, b.y1 - L, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]], lipCol);
    }
    if (cam.x < b.x0) {
      riser([[b.x0, b.y0, b.z0], [b.x0, b.y0, b.z1], [b.x0, b.y1, b.z1], [b.x0, b.y1, b.z0]], 0);
      NP.fill3D(ctx, cam, [[b.x0, b.y1 - L, b.z0], [b.x0, b.y1 - L, b.z1], [b.x0, b.y1, b.z1], [b.x0, b.y1, b.z0]], lipCol);
    } else if (cam.x > b.x1) {
      // Faces turned toward the sun pick up the alpenglow.
      riser([[b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0]], lit ? 0.55 * (0.4 + 0.6 * env.sun) : 0.12);
      NP.fill3D(ctx, cam, [[b.x1, b.y1 - L, b.z0], [b.x1, b.y1 - L, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0]], lipCol);
    }
    if (cam.y > b.y1) {
      const col = isTop ? mix(C.table, C.tableLit, env.sun) : C.ledge;
      NP.fill3D(ctx, cam, [[b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], css(mix(col, env.fogCol, k)));
    }
  }

  function addMesa(rnd, xc, z, w, dep, h, layers) {
    const boxes = mesa(rnd, xc, z, w, dep, h, layers);
    add({
      kind: "custom",
      key: z + dep,
      draw(ctx, cam, env) {
        const order = boxes.map((b, i) => [Math.abs((b.y0 + b.y1) / 2 - cam.y), i]).sort((p, q) => q[0] - p[0]);
        for (const [, i] of order) drawBox(ctx, cam, boxes[i], env, i === boxes.length - 1);
      },
    });
  }

  // Where the camera ends up, the sun's bearing from there, and the basin it looks across.
  const END = { x: camB.x(10), z: camB.z(10) };
  const SUN_BEARING = Math.atan2(env.sunU, 980);
  const BASIN = { x: 40, z: 2100, rx: 1150, rz: 1250 };
  const MR = NP.rng(8282);
  let zRow = 1500;
  while (zRow < 52000) {
    const spread = zRow * 1.2 + 1500;
    let x = -spread + MR() * zRow * 0.2;
    while (x < spread) {
      const w = (0.16 + MR() * 0.3) * zRow + 350;
      const xc = x + w / 2;
      const zz = zRow + MR() * zRow * 0.15;
      const dep = (0.12 + MR() * 0.16) * zRow + 300;
      const inBasin = Math.pow((xc - BASIN.x) / (BASIN.rx + w / 2), 2) + Math.pow((zz + dep / 2 - BASIN.z) / (BASIN.rz + dep / 2), 2) < 1;
      const bearing = Math.atan2(xc - END.x, zz - END.z);
      const inNotch = Math.abs(bearing - SUN_BEARING) < 0.05 + (w / 2) / (zz - END.z) && zz < 17000;
      if (!inBasin && !inNotch) {
        const h = 720 + (MR() - 0.5) * 160 - (zz > 15000 ? 80 : 0);
        addMesa(MR, xc, zz, w, dep, h, zz < 8000 ? 5 : zz < 20000 ? 4 : 2);
      }
      x += w + (0.05 + MR() * 0.12) * zRow;
    }
    zRow *= 1.2;
  }
  // Mesas beside the canyon, behind its walls: they frame the view once the camera is up.
  for (const side of [-1, 1]) {
    let z = -400;
    while (z < 1600) {
      const w = 500 + MR() * 700;
      const dep = 380 + MR() * 500;
      const xin = centre(z) + side * (halfW(z) + outerW(z, side) + 180 + MR() * 200);
      const xc = xin + side * w / 2;
      addMesa(MR, xc, z, w, dep, 700 + MR() * 140, 5);
      z += dep + 120 + MR() * 200;
    }
  }

  // ---------------------------------------------------------------------------
  // Bare winter larches on the talus, and a stand on the spit at the narrows.
  const LR = NP.rng(1212);
  function larchPath(rnd, h) {
    const p = new Path2D();
    p.moveTo(-0.22, 0);
    p.lineTo(0.22, 0);
    p.lineTo(0.03, h);
    p.lineTo(-0.03, h);
    p.closePath();
    const n = Math.floor(h * 1.6);
    for (let i = 2; i < n; i++) {
      const y = (i / n) * h;
      const len = (1 - i / n) * h * 0.24 * (0.6 + rnd() * 0.6);
      const dir = i % 2 ? 1 : -1;
      p.moveTo(0, y);
      p.lineTo(dir * len, y + len * 0.35);
      p.lineTo(dir * len, y + len * 0.35 + 0.12);
      p.lineTo(0, y + 0.22);
      p.closePath();
    }
    return p;
  }
  for (let i = 0; i < 200; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 30 + LR() * (Z_MOUTH - 60);
    const off = LR() * 20;
    const x = centre(z) + side * (halfW(z) + off);
    const y = (off / 20) * LEVELS[0] * 0.85;
    const h = 7 + LR() * 9;
    add(NP.card(x, y, z, [-h * 0.3, 0, h * 0.3, h], [{ path: larchPath(LR, h), col: C.larch }], { nearFade: 1.5 }));
  }
  for (let i = 0; i < 9; i++) {
    const z = 178 + i * 5 + LR() * 4;
    const x = centre(z) - halfW(z) + 16 + LR() * 14;
    const h = 8 + LR() * 6;
    add(NP.card(x, 0, z, [-h * 0.3, 0, h * 0.3, h], [{ path: larchPath(LR, h), col: C.larch }], { nearFade: 1.5 }));
  }

  // ---------------------------------------------------------------------------
  // The cloud deck the camera falls out of: flat stratus, lit pink from below.
  const CR = NP.rng(4646);
  function stratus(x, y, z, w, h, seed, alpha) {
    const rnd = NP.rng(seed);
    const p = new Path2D();
    const n = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const cx = (i / (n - 1) - 0.5) * w * 0.8 + (rnd() - 0.5) * w * 0.1;
      const rx = w * (0.14 + rnd() * 0.12);
      const ry = h * (0.45 + rnd() * 0.5);
      const cy = (rnd() - 0.3) * h * 0.4;
      p.moveTo(cx + rx, cy);
      p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }
    add(NP.card(x, y, z, [-w * 0.65, -h * 1.2, w * 0.65, h * 1.4], [
      { path: p, col: C.cloudBody, alpha, grad: [-h * 0.9, h * 0.9, C.cloudUnder, C.cloudTop] },
    ], { nearFade: 3 }));
  }
  // Thick at the cut, then torn: the last sheets pass above the diving camera.
  for (let i = 0; i < 14; i++) {
    const q = i / 13;
    const z = 1 + q * 40 + CR() * 2;
    const tt = camB.z.timeOf(z);
    const lift = lerp(-6, 22, q) + (CR() - 0.5) * 14;
    stratus(camB.x(tt) + (CR() - 0.5) * lerp(20, 90, q), camB.y(tt) + lift, z, 50 + CR() * 60, 9 + CR() * 9, 900 + i, 0.96);
  }
  // Mist lying over the far basin.
  for (let i = 0; i < 4; i++) stratus(BASIN.x + (CR() - 0.5) * 1600, 30 + i * 18, 1500 + i * 700, 2600 + CR() * 1500, 30 + CR() * 20, 950 + i, 0.18);

  items.sort((a, b) => b.key - a.key);

  // ---------------------------------------------------------------------------
  // The lake: snow on ice, wind-scoured dark patches with white cracks, sastrugi.
  const PATCHES = [];
  const PR = NP.rng(7070);
  for (let i = 0; i < 46; i++) {
    const z = 60 + i * 13 + PR() * 9;
    const x = centre(z) + (PR() - 0.5) * halfW(z) * 1.3;
    const rx = 2 + PR() * 4;
    const rz = 9 + PR() * 22;
    const pts = [];
    for (let j = 0; j < 14; j++) {
      const a = (j / 14) * Math.PI * 2;
      const rr = 0.75 + 0.25 * hash(i * 31 + j, 3);
      pts.push([x + Math.cos(a) * rx * rr, 0, z + Math.sin(a) * rz * rr]);
    }
    const cracks = [];
    for (let c = 0; c < 3; c++) {
      let px = x + (PR() - 0.5) * rx;
      let pz = z + (PR() - 0.5) * rz;
      const line = [[px, 0, pz]];
      for (let s = 0; s < 4; s++) {
        px += (PR() - 0.5) * rx * 0.7;
        pz += (PR() - 0.5) * rz * 0.7;
        line.push([px, 0, pz]);
      }
      cracks.push(line);
    }
    PATCHES.push({ z, pts, cracks });
  }

  function drawGround(ctx, cam, env) {
    NP.drawGround(ctx, cam, (d) => mix(mix(C.lake, C.lakeFar, NP.fogK(d, 2500) * 0.75), env.fogCol, NP.fogK(d, 12000) * 0.8));
    if (cam.y <= 0.05) return;
    // The sun's path on the ice.
    const su = env.sunU;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.scale(1, 0.55);
    const g = ctx.createRadialGradient(su, 0, 0, su, 0, 480);
    g.addColorStop(0, `rgba(255,196,150,${(0.12 + 0.3 * env.sun).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,170,130,0)");
    ctx.fillStyle = g;
    ctx.fillRect(su - 480, 0, 960, 900);
    ctx.restore();
    for (const p of PATCHES) {
      const d = p.z - cam.z;
      if (d < -30 || d > 650) continue;
      const k = env.fog(Math.max(1, d));
      NP.fill3D(ctx, cam, p.pts, css(mix(C.iceDark, env.fogCol, k), 0.16));
      ctx.strokeStyle = css(mix(C.crack, env.fogCol, k), 0.65);
      ctx.lineWidth = clamp((cam.f / Math.max(4, d)) * 0.12, 0.6, 3);
      for (const line of p.cracks) {
        const pts = line.filter((q) => q[2] > cam.z + 1);
        if (pts.length < 2) continue;
        ctx.beginPath();
        pts.forEach((q, i) => {
          const s = cam.f / (q[2] - cam.z);
          const u = (q[0] - cam.x) * s;
          const v = -(q[1] - cam.y) * s;
          i ? ctx.lineTo(u, v) : ctx.moveTo(u, v);
        });
        ctx.stroke();
      }
    }
    // Sastrugi: wind ridges that stream past at low altitude.
    if (cam.y < 120) {
      const z0 = Math.floor((cam.z + 1) / 5) * 5;
      for (let zi = 0; zi < 56; zi++) {
        const z = z0 + zi * 5;
        const d = z - cam.z;
        if (d < 1) continue;
        const k = env.fog(d);
        const row = Math.round(z / 5);
        for (let xi = -8; xi <= 8; xi++) {
          const h = hash(row * 64 + xi, 21);
          if (h < 0.5) continue;
          const x = centre(z) + xi * 15 + (hash(row * 64 + xi, 22) - 0.5) * 10;
          const len = 6 + h * 9;
          const light = hash(row * 64 + xi, 23) < 0.5;
          NP.fill3D(ctx, cam, [[x, 0, z], [x + len * 0.5, 0, z + 0.2], [x + len, 0, z + 0.05]], css(mix(light ? hex("#f4f1fa") : hex("#9b94c0"), env.fogCol, k), 0.8));
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sky: a luminous dawn (the title is printed on it in dark ink), the low sun.
  function drawSky(ctx, cam, t, env) {
    const [rx, ry, rw, rh] = NP.skyRect(cam);
    const g = ctx.createLinearGradient(0, -1300, 0, 60);
    g.addColorStop(0, "#2a3768");
    g.addColorStop(0.3, "#4f5690");
    g.addColorStop(0.55, "#8f80b0");
    g.addColorStop(0.75, "#c79fb4");
    g.addColorStop(0.88, "#eeb3a2");
    g.addColorStop(0.955, "#f8c3a2");
    g.addColorStop(1, "#fbcfae");
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
    const su = env.sunU;
    const sv = env.sunV;
    ctx.save();
    ctx.scale(1, 0.3);
    const band = ctx.createRadialGradient(su, 0, 0, su, 0, 1500);
    band.addColorStop(0, `rgba(255,218,172,${(0.4 + 0.35 * env.sun).toFixed(3)})`);
    band.addColorStop(0.5, "rgba(250,176,146,0.16)");
    band.addColorStop(1, "rgba(240,160,140,0)");
    ctx.fillStyle = band;
    ctx.fillRect(su - 1500, -1500, 3000, 3000);
    ctx.restore();
    const halo = ctx.createRadialGradient(su, sv, 0, su, sv, 280);
    halo.addColorStop(0, `rgba(255,240,206,${(0.55 + 0.4 * env.sun).toFixed(3)})`);
    halo.addColorStop(0.16, `rgba(255,214,166,${(0.28 + 0.25 * env.sun).toFixed(3)})`);
    halo.addColorStop(1, "rgba(255,190,150,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(su - 280, sv - 280, 560, 560);
    ctx.fillStyle = "#fff6e2";
    ctx.beginPath();
    ctx.arc(su, sv, 23, 0, Math.PI * 2);
    ctx.fill();
  }

  function setTime(t) {
    env.t = t;
    env.sun = smoothstep(6.9, 8.4, t);
    env.lightY = 300 - 50 * smoothstep(4.2, 9.5, t);
    env.sunV = -22 - 20 * smoothstep(7.0, 10.5, t);
  }

  function sky(ctx, cam, t) {
    setTime(t);
    NP.applyCam(ctx, cam);
    drawSky(ctx, cam, t, env);
    // The title sits in the sky: every piece of terrain can cover it.
    NP.titles.drawPlateau(ctx, t);
  }

  function scene(ctx, cam, t) {
    setTime(t);
    NP.applyCam(ctx, cam);
    drawGround(ctx, cam, env);
    for (const it of items) NP.draw(ctx, cam, it, env);
  }

  function overlay(ctx, cam, camPrev, t) {
    const w = 1 - smoothstep(NP.T_CUT, NP.T_CUT + 0.17, t);
    if (w > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = css(C.whiteout, w);
      ctx.fillRect(0, 0, NP.W, NP.H);
    }
    NP.drawWisps(ctx, cam, t, 1 - smoothstep(NP.T_CUT + 0.05, NP.T_CUT + 0.3, t), hex("#fff3ef"), hex("#c79a9c"));
  }

  NP.plateau = { sky, scene, overlay, env };
})();
