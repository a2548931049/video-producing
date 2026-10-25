// World A — Norilsk in the polar night. A snowy street of colour-blocked panel blocks on
// permafrost piles, sodium lamps, a heating-pipe overpass, a slab you fly under, then the
// smelter's red-and-white stacks and the plume that swallows the camera.
(function () {
  const NP = window.NP;
  const { hex, mix, mul, css, clamp, lerp, smoothstep, hash } = NP;
  const camA = NP.camTracks.A;

  const C = {
    fog: hex("#18242e"),
    snow: hex("#4f6474"),
    road: hex("#35353b"),
    rut: hex("#27262b"),
    bank: hex("#61778a"),
    pile: hex("#10171e"),
    plinth: hex("#232a31"),
    glass: hex("#18222c"),
    roofSnow: hex("#a3b6c4"),
    sodium: hex("#ffb054"),
    lampCore: hex("#fff0d0"),
    post: hex("#1e252c"),
    win: [hex("#ffc46b"), hex("#ffdc9e"), hex("#ff9f4a"), hex("#a9d8ff")],
    pipe: hex("#7f8a95"),
    pipeLit: hex("#a7b0b8"),
    pipeSnow: hex("#d6e0e7"),
    steel: hex("#262f37"),
    hall: hex("#1d252e"),
    stackRed: hex("#a3362c"),
    stackWhite: hex("#c9c2b6"),
    aviation: hex("#ff3b30"),
    plumeUnder: hex("#c4794f"),
    plumeBody: hex("#6c707c"),
    plumeTop: hex("#4b586b"),
    whiteout: hex("#ede3da"),
    mesa: hex("#0c141c"),
  };
  // Norilsk paints its panel blocks; at night, under sodium light, they read like this.
  const FACADES = ["#8e3b2e", "#a27a35", "#2a6b70", "#31508f", "#5a8f7e", "#9c9180", "#7e4d73", "#a9632b", "#b8a04a", "#3f7a9a"].map((h) => mul(hex(h), 0.66));

  const items = []; // vertical things, painted far to near by key
  const groundItems = []; // flat things on the snow, painted before anything stands on it
  const add = (it) => (items.push(it), it);

  const Z_GATE = camA.z(0.9);
  const Z_SLAB = 132;
  const SLAB_DEPTH = 12;

  // ---------------------------------------------------------------------------
  // Panel blocks
  const STILT = 2.4;
  const FLOOR = 2.8;
  const PLINTH = 0.7;

  function blockHeight(floors) {
    return STILT + PLINTH + floors * FLOOR + 0.9;
  }

  function panelBlock(o) {
    const rnd = NP.rng(o.seed);
    const w = o.xR - o.xL;
    const top = blockHeight(o.floors);
    const cols = Math.max(3, Math.round(w / 3.3));
    const pw = w / cols;
    const pal = o.palette;
    const parts = [];

    const piles = new Path2D();
    const pileStep = o.pileStep || 4.1;
    const pileOff = o.pileStep ? (((-o.xL - pileStep / 2) % pileStep) + pileStep) % pileStep : 1.4;
    for (let x = pileOff; x < w - 0.3; x += pileStep) piles.rect(x - 0.28, -0.2, 0.56, STILT + 0.3);
    parts.push({ path: piles, col: C.pile });

    const body = new Path2D();
    body.rect(0, STILT, w, top - STILT);
    parts.push({ path: body, col: pal[0] });

    // Supergraphics in the Norilsk manner: colour by panel column, by band, or a diagonal.
    const paint = [new Path2D(), new Path2D()];
    const y0 = STILT + PLINTH;
    const y1 = top - 0.9;
    if (o.style === "stripes") {
      let i = 0;
      while (i < cols) {
        const run = 1 + Math.floor(rnd() * 3);
        const which = Math.floor(rnd() * 3);
        if (which < 2) paint[which].rect(i * pw, y0, run * pw, y1 - y0);
        i += run;
      }
    } else if (o.style === "bands") {
      const split = y0 + Math.round(o.floors * (0.3 + rnd() * 0.3)) * FLOOR;
      paint[0].rect(0, y0, w, split - y0);
      paint[1].rect(0, split, w, FLOOR * 0.45);
    } else if (o.style === "diagonal") {
      const p = paint[0];
      const a = rnd() < 0.5;
      p.moveTo(0, a ? y0 : y1);
      p.lineTo(w * (0.55 + rnd() * 0.3), a ? y0 : y1);
      p.lineTo(0, a ? y1 : y0);
      p.closePath();
      paint[1].rect(w * 0.82, y0, w * 0.18, y1 - y0);
    } else if (o.style === "blocks") {
      for (let j = 0; j < o.floors; j++)
        for (let i = 0; i < cols; i++) {
          const r = hash(i * 31 + j * 7, o.seed);
          if (r < 0.22) paint[r < 0.11 ? 0 : 1].rect(i * pw, y0 + j * FLOOR, pw, FLOOR);
        }
    }
    parts.push({ path: paint[0], col: pal[1] });
    parts.push({ path: paint[1], col: pal[2] });

    // Panel seams and the dark plinth.
    const seams = new Path2D();
    for (let j = 1; j < o.floors; j++) seams.rect(0, y0 + j * FLOOR - 0.06, w, 0.12);
    for (let i = 1; i < cols; i++) seams.rect(i * pw - 0.05, y0, 0.1, y1 - y0);
    parts.push({ path: seams, col: mul(pal[0], 0.62), alpha: 0.55, minScale: 1.6 });
    const plinth = new Path2D();
    plinth.rect(0, STILT, w, PLINTH);
    parts.push({ path: plinth, col: C.plinth });

    // Windows: four lit colours, a dark glass, and a stair column lit on every half-landing.
    const lit = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const dark = new Path2D();
    const stair = new Set([Math.floor(cols * 0.25), Math.floor(cols * 0.72)]);
    const litRate = o.litRate || 0.44;
    const ww = Math.min(1.6, pw * 0.5);
    for (let j = 0; j < o.floors; j++) {
      for (let i = 0; i < cols; i++) {
        const cx = (i + 0.5) * pw;
        const h1 = hash(i * 131 + j * 17, o.seed + 5);
        if (stair.has(i)) {
          const y = y0 + j * FLOOR + 1.6;
          (h1 < 0.85 ? lit[1] : dark).rect(cx - 0.45, y, 0.9, 1.1);
          continue;
        }
        const y = y0 + j * FLOOR + 0.85;
        if (h1 < litRate) {
          const h2 = hash(i * 7 + j * 131, o.seed + 9);
          lit[h2 < 0.58 ? 0 : h2 < 0.8 ? 1 : h2 < 0.93 ? 2 : 3].rect(cx - ww / 2, y, ww, 1.45);
        } else dark.rect(cx - ww / 2, y, ww, 1.45);
      }
    }
    parts.push({ path: dark, col: C.glass });
    for (let k = 0; k < 4; k++) parts.push({ path: lit[k], col: C.win[k], glow: 0.75 });

    // Street light washes the lower floors; the aurora tints the top.
    const wash = new Path2D();
    wash.rect(0, STILT, w, top - STILT);
    parts.push({ path: wash, col: [0, 0, 0], comp: "lighter", grad: [STILT, STILT + 16, [96, 52, 16], [0, 0, 0]] });
    parts.push({ path: wash, col: [0, 0, 0], comp: "lighter", grad: [top - 10, top, [0, 0, 0], [6, 30, 22]] });

    // Snow on the roof and on the machine rooms.
    const roof = new Path2D();
    roof.rect(-0.2, top - 0.15, w + 0.4, 0.5);
    const mr = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < mr; k++) {
      const mx = w * (0.15 + 0.7 * rnd());
      roof.rect(mx - 2.2, top + 0.3, 4.4, 2.6);
    }
    parts.push({ path: roof, col: C.roofSnow });

    const card = NP.card(o.xL, 0, o.z, [-0.5, -0.5, w + 0.5, top + 3.5], parts);

    // The gable end facing the street, in true perspective, painted in three bands.
    if (o.endSide) {
      const xe = o.endSide === "L" ? o.xL : o.xR;
      const zb = o.z + o.depth;
      const cuts = [0, 0.3 + rnd() * 0.15, 0.62 + rnd() * 0.15, 1];
      const endCols = [pal[2], pal[1], pal[0]].map((c) => mix(mul(c, 0.82), C.sodium, 0.1));
      return {
        kind: "custom",
        key: o.z,
        draw(ctx, cam, env) {
          if (cam.z + NP.NEAR < zb) {
            for (let b = 0; b < 3; b++) {
              const za = o.z + (zb - o.z) * cuts[b];
              const zc = o.z + (zb - o.z) * cuts[b + 1];
              const d = Math.max(1, (za + zc) / 2 - cam.z);
              const col = mix(endCols[b], env.fogCol, env.fog(d));
              NP.fill3D(ctx, cam, [[xe, STILT, za], [xe, top, za], [xe, top, zc], [xe, STILT, zc]], css(col));
            }
            const d = Math.max(1, o.z + o.depth / 2 - cam.z);
            NP.fill3D(ctx, cam, [[xe, top - 0.15, o.z], [xe, top + 0.35, o.z], [xe, top + 0.35, zb], [xe, top - 0.15, zb]], css(mix(C.roofSnow, env.fogCol, env.fog(d))));
            NP.fill3D(ctx, cam, [[xe, STILT, o.z], [xe, STILT + PLINTH, o.z], [xe, STILT + PLINTH, zb], [xe, STILT, zb]], css(mix(C.plinth, env.fogCol, env.fog(d))));
          }
          NP.drawCard(ctx, cam, card, env);
        },
      };
    }
    return card;
  }

  // Front row along the street, staggered left / right, then the rows behind.
  const R = NP.rng(4401);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const STYLES = ["stripes", "bands", "diagonal", "blocks"];
  function palette() {
    const a = pick(FACADES);
    let b = pick(FACADES);
    let c = pick(FACADES);
    if (b === a) b = FACADES[(FACADES.indexOf(a) + 3) % FACADES.length];
    if (c === a || c === b) c = FACADES[(FACADES.indexOf(b) + 4) % FACADES.length];
    return [a, b, c];
  }
  const front = [
    { side: "L", z: 20, floors: 9, len: 70 },
    { side: "R", z: 36, floors: 5, len: 60 },
    { side: "L", z: 57, floors: 5, len: 64 },
    { side: "R", z: 74, floors: 9, len: 80 },
    { side: "L", z: 93, floors: 9, len: 76 },
    { side: "R", z: 110, floors: 5, len: 58 },
  ];
  front.forEach((b, i) => {
    const inner = 14 + R() * 3;
    const xL = b.side === "L" ? -inner - b.len : inner;
    const xR = b.side === "L" ? -inner : inner + b.len;
    add(panelBlock({ xL, xR, z: b.z, floors: b.floors, seed: 100 + i, palette: palette(), style: STYLES[i % 4], endSide: b.side === "L" ? "R" : "L", depth: 12 }));
  });
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 8 + R() * 120;
    const inner = 34 + R() * 70;
    const len = 50 + R() * 70;
    const floors = R() < 0.35 ? 12 : R() < 0.6 ? 9 : 5;
    const xL = side < 0 ? -inner - len : inner;
    add(panelBlock({ xL, xR: xL + len, z, floors, seed: 300 + i, palette: palette(), style: pick(STYLES), litRate: 0.35 }));
  }
  // The city continues out to the sides of the plant road.
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 170 + R() * 420;
    const inner = 120 + R() * 260;
    const len = 60 + R() * 90;
    const xL = side < 0 ? -inner - len : inner;
    add(panelBlock({ xL, xR: xL + len, z, floors: R() < 0.5 ? 9 : 12, seed: 600 + i, palette: palette(), style: pick(STYLES), litRate: 0.3 }));
  }

  // ---------------------------------------------------------------------------
  // The slab across the street: you fly under it, between its piles.
  const slabPal = [hex("#b04a2e"), hex("#c7953a"), hex("#2f5f9a")].map((c) => mul(c, 0.74));
  // Piles every 6 m at ±3, ±9 … so the flight line (x = 0) runs down the middle of a bay.
  const slabFront = panelBlock({ xL: -95, xR: 95, z: Z_SLAB, floors: 9, seed: 77, palette: slabPal, style: "stripes", litRate: 0.5, pileStep: 6 });
  const slabBack = panelBlock({ xL: -95, xR: 95, z: Z_SLAB + SLAB_DEPTH, floors: 9, seed: 78, palette: slabPal, style: "bands", litRate: 0.4, pileStep: 6 });
  const pileRows = [Z_SLAB + 0.6, Z_SLAB + 6, Z_SLAB + 11.4].map((z) => {
    const p = new Path2D();
    for (let x = -93; x <= 93; x += 6) p.rect(x - 0.3, -0.3, 0.6, STILT + 0.4);
    return NP.card(0, 0, z, [-94, -0.3, 94, STILT + 0.2], [{ path: p, col: C.pile }]);
  });
  add({
    kind: "custom",
    key: Z_SLAB + SLAB_DEPTH,
    draw(ctx, cam, env) {
      NP.drawCard(ctx, cam, slabBack, env);
      if (cam.y < STILT && cam.z + NP.NEAR < Z_SLAB + SLAB_DEPTH) {
        // The underside: almost black, a little sodium bounce near the far edge.
        const r = NP.path3D(ctx, cam, [[-95, STILT, Z_SLAB], [95, STILT, Z_SLAB], [95, STILT, Z_SLAB + SLAB_DEPTH], [-95, STILT, Z_SLAB + SLAB_DEPTH]]);
        if (r) {
          const g = ctx.createLinearGradient(0, r[0], 0, r[1]);
          g.addColorStop(0, "#07090c");
          g.addColorStop(1, "#2a1f19");
          ctx.fillStyle = g;
          ctx.fill();
        }
      }
      for (let i = pileRows.length - 1; i >= 0; i--) NP.drawCard(ctx, cam, pileRows[i], env);
      NP.drawCard(ctx, cam, slabFront, env);
    },
  });
  groundItems.push({
    draw(ctx, cam, env) {
      NP.fill3D(ctx, cam, [[-95, 0, Z_SLAB - 1.5], [95, 0, Z_SLAB - 1.5], [95, 0, Z_SLAB + SLAB_DEPTH + 1.5], [-95, 0, Z_SLAB + SLAB_DEPTH + 1.5]], css(mix(hex("#0b1015"), env.fogCol, env.fog(Math.max(1, Z_SLAB - cam.z)) * 0.6)));
    },
  });

  // ---------------------------------------------------------------------------
  // Sodium street lamps, both sides, every 25 m.
  const lampHeads = [];
  for (let z = 8; z < Z_SLAB - 4; z += 25) {
    for (const side of [-1, 1]) {
      const xp = side * 9.6;
      const xh = side * 6.9;
      lampHeads.push([xh, 9.3, z]);
      const p = new Path2D();
      p.rect(-0.14, 0, 0.28, 9.6);
      // arm reaching over the road
      const a0 = 0;
      const a1 = xh - xp;
      p.rect(Math.min(a0, a1), 9.45, Math.abs(a1 - a0), 0.16);
      const head = new Path2D();
      head.rect(a1 - 0.55, 9.18, 1.1, 0.3);
      const core = new Path2D();
      core.rect(a1 - 0.45, 9.12, 0.9, 0.12);
      add(
        NP.card(xp, 0, z, [Math.min(a0, a1) - 2, -0.2, Math.max(a0, a1) + 2, 10.2], [
          { path: p, col: C.post },
          { path: head, col: C.post },
          { path: core, col: C.lampCore, glow: 1 },
        ], {
          paint(ctx, cam, env, m) {
            // Halo in sodium haze: soft, small, additive.
            const r = 4.2;
            const g = ctx.createRadialGradient(a1, 9.1, 0, a1, 9.1, r);
            const a = 0.75 * (1 - m.k * 0.6) * m.fade;
            g.addColorStop(0, css(C.sodium, a));
            g.addColorStop(0.25, css(C.sodium, a * 0.45));
            g.addColorStop(1, css(C.sodium, 0));
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = g;
            ctx.fillRect(a1 - r, 9.1 - r, 2 * r, 2 * r);
            ctx.globalCompositeOperation = "source-over";
          },
        }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Heating pipes on low supports, and the overpass where they cross the street.
  function pipeRun(x, z0, z1, y, r, step) {
    for (let z = z0; z < z1; z += step) {
      const za = z;
      const zb = Math.min(z1, z + step);
      add({
        kind: "custom",
        key: zb,
        draw(ctx, cam, env) {
          if (zb <= cam.z + NP.NEAR) return;
          const d = Math.max(1, (za + zb) / 2 - cam.z);
          const k = env.fog(d);
          const side = cam.x > x ? 1 : -1;
          const xs = x + side * r;
          NP.fill3D(ctx, cam, [[xs, y - r, za], [xs, y + r, za], [xs, y + r, zb], [xs, y - r, zb]], css(mix(C.pipeLit, env.fogCol, k)));
          if (cam.y > y + r) NP.fill3D(ctx, cam, [[x - r, y + r, za], [x + r, y + r, za], [x + r, y + r, zb], [x - r, y + r, zb]], css(mix(C.pipeSnow, env.fogCol, k)));
          if (cam.y < y - r) NP.fill3D(ctx, cam, [[x - r, y - r, za], [x + r, y - r, za], [x + r, y - r, zb], [x - r, y - r, zb]], css(mix(C.pipe, env.fogCol, k)));
        },
      });
      const s = new Path2D();
      s.rect(-0.09, 0, 0.18, y - r);
      s.rect(-0.28, y - r - 0.1, 0.56, 0.1);
      add(NP.card(x, 0, za, [-0.6, 0, 0.6, y], [{ path: s, col: C.steel }]));
    }
  }
  pipeRun(-11.8, -10, Z_GATE, 1.25, 0.34, 6);
  pipeRun(-11.0, -10, Z_GATE, 1.25, 0.34, 6);
  pipeRun(11.0, Z_GATE + 0.8, Z_SLAB - 3, 1.25, 0.34, 6);
  pipeRun(11.8, Z_GATE + 0.8, Z_SLAB - 3, 1.25, 0.34, 6);
  // Plant corridor beyond the slab.
  for (const x of [17, 18, 19]) pipeRun(x, Z_SLAB + 16, 560, 1.6, 0.42, 9);
  for (const x of [-24, -23]) pipeRun(x, Z_SLAB + 16, 560, 1.4, 0.38, 9);

  (function gate() {
    const p = new Path2D();
    const top = 7.6;
    const r = 0.36;
    for (const off of [-0.45, 0.45]) {
      const x0 = -11.4 + off;
      const x1 = 11.4 - off;
      p.rect(x0 - r, 1.0, 2 * r, top - 1.0 + r + off * 0.2);
      p.rect(x1 - r, 1.0, 2 * r, top - 1.0 + r + off * 0.2);
      p.rect(x0 - r, top + off * 0.2 - r, x1 - x0 + 2 * r, 2 * r);
    }
    const truss = new Path2D();
    truss.rect(-12.4, top - 1.4, 24.8, 0.18);
    for (let x = -12; x < 12; x += 1.6) {
      truss.moveTo(x, top - 1.4);
      truss.lineTo(x + 0.18, top - 1.4);
      truss.lineTo(x + 0.98, top - 0.55);
      truss.lineTo(x + 0.8, top - 0.55);
      truss.closePath();
      truss.moveTo(x + 0.8, top - 0.55);
      truss.lineTo(x + 0.98, top - 0.55);
      truss.lineTo(x + 1.78, top - 1.4);
      truss.lineTo(x + 1.6, top - 1.4);
      truss.closePath();
    }
    for (const x of [-12.4, 12.1]) truss.rect(x, 0, 0.3, top - 1.2);
    const snow = new Path2D();
    snow.rect(-11.9, top + 0.4, 23.8, 0.32);
    const sign = new Path2D();
    sign.rect(-1.6, top - 2.3, 3.2, 0.8);
    add(
      NP.card(0, 0, Z_GATE, [-13, 0, 13, top + 1], [
        { path: truss, col: C.steel },
        { path: p, col: C.pipeLit },
        { path: snow, col: C.pipeSnow },
        { path: sign, col: hex("#e8c547") },
      ]),
    );
  })();

  // ---------------------------------------------------------------------------
  // The plant: dark halls with lit slits, three banded stacks, and the plume.
  const STACKS = [
    { x: -70, z: 600, h: 210, w0: 17, w1: 10 },
    { x: 26, z: 650, h: 250, w0: 19, w1: 11 },
    { x: 118, z: 690, h: 180, w0: 15, w1: 9 },
  ];
  for (let i = 0; i < 9; i++) {
    const x = -260 + i * 62 + R() * 20;
    const z = 540 + R() * 170;
    const w = 50 + R() * 70;
    const h = 18 + R() * 30;
    const body = new Path2D();
    body.rect(0, 0, w, h);
    body.rect(w * 0.2, h, w * 0.25, 6 + R() * 6);
    const lights = new Path2D();
    for (let j = 0; j < 3; j++) for (let k = 0; k < Math.floor(w / 6); k++) if (hash(i * 50 + j * 11 + k, 9) < 0.45) lights.rect(3 + k * 6, h * (0.25 + j * 0.22), 2.4, 1.2);
    add(NP.card(x, 0, z, [0, 0, w, h + 12], [{ path: body, col: C.hall }, { path: lights, col: C.win[2], glow: 0.9 }]));
  }
  for (const s of STACKS) {
    const shape = new Path2D();
    shape.moveTo(-s.w0 / 2, 0);
    shape.lineTo(s.w0 / 2, 0);
    shape.lineTo(s.w1 / 2, s.h);
    shape.lineTo(-s.w1 / 2, s.h);
    shape.closePath();
    const bands = new Path2D();
    const bh = s.h / 9;
    for (let j = 1; j < 9; j += 2) {
      const ya = j * bh;
      const yb = (j + 1) * bh;
      const wa = lerp(s.w0, s.w1, ya / s.h) / 2;
      const wb = lerp(s.w0, s.w1, yb / s.h) / 2;
      bands.moveTo(-wa, ya);
      bands.lineTo(wa, ya);
      bands.lineTo(wb, yb);
      bands.lineTo(-wb, yb);
      bands.closePath();
    }
    // The top band is always red.
    const wt = lerp(s.w0, s.w1, (s.h - bh) / s.h) / 2;
    bands.moveTo(-wt, s.h - bh);
    bands.lineTo(wt, s.h - bh);
    bands.lineTo(s.w1 / 2, s.h);
    bands.lineTo(-s.w1 / 2, s.h);
    bands.closePath();
    const shade = new Path2D();
    shade.moveTo(s.w0 * 0.12, 0);
    shade.lineTo(s.w0 / 2, 0);
    shade.lineTo(s.w1 / 2, s.h);
    shade.lineTo(s.w1 * 0.12, s.h);
    shade.closePath();
    add(
      NP.card(s.x, 0, s.z, [-s.w0, 0, s.w0, s.h + 4], [
        { path: shape, col: C.stackWhite },
        { path: bands, col: C.stackRed },
        { path: shade, col: [0, 0, 0], alpha: 0.35 },
      ], {
        paint(ctx, cam, env, m) {
          // Aviation lights, one blink a second, offset per stack.
          const on = 0.5 + 0.5 * Math.cos((env.t + s.x * 0.01) * Math.PI * 2);
          const a = (0.25 + 0.75 * on * on) * m.fade;
          for (const y of [s.h + 0.8, s.h * 0.66]) {
            const g = ctx.createRadialGradient(0, y, 0, 0, y, 7);
            g.addColorStop(0, css(C.aviation, a));
            g.addColorStop(0.2, css(C.aviation, a * 0.5));
            g.addColorStop(1, css(C.aviation, 0));
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = g;
            ctx.fillRect(-7, y - 7, 14, 14);
            ctx.globalCompositeOperation = "source-over";
          }
        },
      }),
    );
  }
  // Plant glow on the snow and on the underside of the plume.
  add({
    kind: "custom",
    key: 720,
    draw(ctx, cam, env) {
      const d = 640 - cam.z;
      if (d <= 1) return;
      const s = cam.f / d;
      const u = (20 - cam.x) * s;
      const v = -(10 - cam.y) * s;
      const r = 520 * s;
      ctx.save();
      ctx.translate(u, v);
      ctx.scale(1, 0.42);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, "rgba(255,150,70,0.30)");
      g.addColorStop(0.4, "rgba(220,110,50,0.10)");
      g.addColorStop(1, "rgba(200,90,40,0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    },
  });

  // Plume puffs: flat two-tone cut-paper clouds, under-lit by the plant.
  function puffPath(rnd, r) {
    const p = new Path2D();
    const n = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
      const rr = r * (0.42 + rnd() * 0.3);
      const cx = Math.cos(a) * r * 0.48;
      const cy = Math.sin(a) * r * 0.3;
      p.moveTo(cx + rr, cy);
      p.arc(cx, cy, rr, 0, Math.PI * 2);
    }
    p.moveTo(r * 0.62, 0);
    p.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    return p;
  }
  const PR = NP.rng(9090);
  const plume = [];
  // Along the drift path from the stacks toward the city, sinking and spreading.
  for (let i = 0; i < 70; i++) {
    const q = i / 69;
    const src = STACKS[i % 3];
    const z = lerp(src.z, 300, Math.pow(q, 0.8)) + (PR() - 0.5) * 30;
    const y = lerp(src.h + 6, 120, q) + (PR() - 0.5) * 30 * q;
    const x = lerp(src.x, -150, q) + (PR() - 0.5) * (30 + 90 * q);
    const r = lerp(10, 46, q) * (0.8 + PR() * 0.5);
    plume.push({ x, y, z, r, q, seed: i });
  }
  // The core the camera flies through: puffs that whip past on all sides, thickening
  // until the last ones swallow the lens right on the cut.
  for (let i = 0; i < 30; i++) {
    const q = i / 29;
    const z = 252 + q * 50 + PR() * 2;
    const tt = camA.z.timeOf(z);
    const a = PR() * Math.PI * 2;
    const off = lerp(26, 4, q * q) * (0.6 + PR() * 0.5);
    const x = camA.x(tt) + Math.cos(a) * off;
    const y = camA.y(tt) + Math.sin(a) * off * 0.7;
    plume.push({ x, y, z, r: lerp(9, 26, q) * (0.8 + PR() * 0.4), q: 1 + q, seed: 200 + i });
  }
  for (const p of plume) {
    const rnd = NP.rng(p.seed * 13 + 1);
    const base = puffPath(rnd, p.r);
    // Deeper in, the plume turns into the white-out we cut on.
    const deep = clamp(p.q - 0.85, 0, 1) * (0.45 + 0.3 * hash(p.seed, 61));
    const under = mix(C.plumeUnder, C.whiteout, deep * 0.9);
    const bodyC = mix(mix(C.plumeBody, hex("#9a8f8c"), hash(p.seed, 62)), C.whiteout, deep);
    const alpha = p.q < 1 ? 0.5 + 0.4 * p.q : 0.97;
    add(
      NP.card(p.x, p.y, p.z, [-p.r * 1.3, -p.r * 1.0, p.r * 1.3, p.r * 1.1], [
        // Under-lit by the plant: warm at the belly, grey above.
        { path: base, col: bodyC, alpha, grad: [-p.r * 0.75, p.r * 0.1, under, bodyC] },
      ], { nearFade: 2.2, vel: [-2.5, 1.2], t0: p.q >= 1 ? camA.z.timeOf(p.z) : 0 }),
    );
  }

  // ---------------------------------------------------------------------------
  // Putorana's first ramparts, black against the glow: flat tops, stepped flanks.
  function mesaShape(rnd, w, h, steps) {
    const p = new Path2D();
    let x = 0;
    let y = 0;
    p.moveTo(-w * 0.1, -5);
    p.lineTo(0, 0);
    for (let i = 0; i < steps; i++) {
      x += (w * 0.18) / steps + rnd() * 30;
      y += h / steps;
      p.lineTo(x, y - h / steps);
      p.lineTo(x + rnd() * 15, y);
    }
    const xr = w;
    p.lineTo(xr - x, h);
    let y2 = h;
    let x2 = xr - x;
    for (let i = 0; i < steps; i++) {
      x2 += (w * 0.18) / steps + rnd() * 30;
      y2 -= h / steps;
      p.lineTo(x2, y2 + h / steps);
      p.lineTo(x2 + rnd() * 15, y2);
    }
    p.lineTo(w * 1.1, -5);
    p.closePath();
    return p;
  }
  const MR = NP.rng(3131);
  for (let i = 0; i < 9; i++) {
    const z = 7000 + i * 1600 + MR() * 900;
    const w = 3000 + MR() * 5000;
    const h = 380 + MR() * 340;
    const x = -16000 + i * 3600 + MR() * 2000;
    const shape = mesaShape(MR, w, h, 3 + Math.floor(MR() * 3));
    const rim = new Path2D();
    rim.rect(w * 0.2, h - 6, w * 0.6, 6);
    add(NP.card(x, 0, z, [-w * 0.1, -5, w * 1.1, h], [
      { path: shape, col: C.mesa },
      { path: rim, col: hex("#2a6b5c"), alpha: 0.35 },
    ]));
  }

  items.sort((a, b) => b.key - a.key);

  // ---------------------------------------------------------------------------
  // Sky: polar-night gradient, city glow, a few stars, and the aurora curtains.
  const STARS = [];
  for (let i = 0; i < 110; i++) STARS.push([(hash(i, 1) - 0.5) * 3200, -60 - hash(i, 2) * 1300, 0.6 + hash(i, 3) * 1.4, 0.25 + hash(i, 4) * 0.6, hash(i, 5) * 6.28]);

  const CURTAINS = [
    { vb: -250, amp: 70, k1: 0.0021, w1: 0.55, k2: 0.0063, w2: 0.9, h: 560, u0: -900, u1: 1600, gain: 1.25, ph: 0.4 },
    { vb: -380, amp: 55, k1: 0.0017, w1: -0.42, k2: 0.0051, w2: 1.2, h: 460, u0: -1300, u1: 1400, gain: 0.85, ph: 2.1 },
    { vb: -190, amp: 40, k1: 0.0029, w1: 0.8, k2: 0.0091, w2: -1.4, h: 300, u0: 100, u1: 1700, gain: 0.6, ph: 4.0 },
  ];
  const AUR_H = 500;
  let aurGrad = null;
  function auroraGradient(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, -AUR_H);
    g.addColorStop(0, "rgba(89,242,182,0)");
    g.addColorStop(0.04, "rgba(120,255,200,0.95)");
    g.addColorStop(0.16, "rgba(76,232,170,0.62)");
    g.addColorStop(0.45, "rgba(31,168,140,0.26)");
    g.addColorStop(0.75, "rgba(108,91,214,0.10)");
    g.addColorStop(1, "rgba(108,91,214,0)");
    return g;
  }

  function drawSky(ctx, cam, t) {
    const [rx, ry, rw, rh] = NP.skyRect(cam);
    const g = ctx.createLinearGradient(0, -1300, 0, 0);
    g.addColorStop(0, "#03080e");
    g.addColorStop(0.45, "#081521");
    g.addColorStop(0.78, "#10263a");
    g.addColorStop(0.94, "#1d3443");
    g.addColorStop(1, "#2c3c44");
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
    // Sodium haze over the city and the plant, sitting on the horizon.
    ctx.save();
    ctx.scale(1, 0.32);
    const glow = ctx.createRadialGradient(80, 0, 0, 80, 0, 1300);
    glow.addColorStop(0, "rgba(150,96,60,0.55)");
    glow.addColorStop(0.5, "rgba(110,70,52,0.22)");
    glow.addColorStop(1, "rgba(60,50,50,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-1400, -1400, 2800, 2800);
    ctx.restore();

    for (const s of STARS) {
      const tw = 0.75 + 0.25 * Math.sin(t * 2.3 + s[4]);
      ctx.fillStyle = `rgba(220,235,255,${(s[3] * tw).toFixed(3)})`;
      ctx.fillRect(s[0] - s[2] / 2, s[1] - s[2] / 2, s[2], s[2]);
    }

    if (!aurGrad) aurGrad = auroraGradient(ctx);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const c of CURTAINS) {
      const step = 5;
      for (let u = c.u0; u < c.u1; u += step) {
        const base = c.vb + c.amp * Math.sin(u * c.k1 + t * c.w1 + c.ph) + c.amp * 0.45 * Math.sin(u * c.k2 - t * c.w2);
        const env1 = 0.5 + 0.5 * Math.sin(u * 0.0042 + t * 0.7 + c.ph);
        const rays = 0.62 + 0.38 * Math.sin(u * 0.19 + Math.sin(u * 0.031 + t * 1.6) * 3);
        const edge = smoothstep(c.u0, c.u0 + 400, u) * (1 - smoothstep(c.u1 - 400, c.u1, u));
        const a = c.gain * edge * (0.25 + 0.75 * env1 * env1) * rays * 0.34;
        if (a < 0.01) continue;
        const h = c.h * (0.7 + 0.3 * Math.sin(u * 0.009 + c.ph + t * 0.5));
        ctx.setTransform(1, 0, 0, 1, NP.W / 2, NP.H / 2);
        ctx.rotate(cam.roll);
        ctx.translate(cam.panX + u, cam.panY + base);
        ctx.scale(1, h / AUR_H);
        ctx.globalAlpha = a;
        ctx.fillStyle = aurGrad;
        ctx.fillRect(0, -AUR_H, step + 1.5, AUR_H * 1.04);
      }
    }
    ctx.restore();
    NP.applyCam(ctx, cam);
  }

  // ---------------------------------------------------------------------------
  // Ground: snow, the road and its ruts, snowbanks, sodium pools.
  function groundGrad(ctx, cam, colNear, fogDist) {
    const vMax = -cam.panY + NP.SCREEN_R + 40;
    const g = ctx.createLinearGradient(0, 0, 0, vMax);
    for (let i = 0; i <= 10; i++) {
      const q = i / 10;
      const v = vMax * q * q;
      const d = v > 0 ? (cam.f * cam.y) / v : 1e7;
      g.addColorStop(q * q, css(mix(colNear, C.fog, NP.fogK(d, fogDist))));
    }
    return g;
  }

  function drawGround(ctx, cam, env) {
    NP.drawGround(ctx, cam, (d) => mix(C.snow, C.fog, NP.fogK(d, 300)));
    if (cam.y <= 0.05) return;
    const zEnd = Z_SLAB - 1;
    const z0 = cam.z - 5;
    const road = groundGrad(ctx, cam, C.road, 300);
    if (NP.path3D(ctx, cam, [[-7, 0, z0], [7, 0, z0], [7, 0, zEnd], [-7, 0, zEnd]])) {
      ctx.fillStyle = road;
      ctx.fill();
    }
    const rut = groundGrad(ctx, cam, C.rut, 300);
    for (const x of [-5.3, -3.6, 1.7, 3.4]) {
      if (NP.path3D(ctx, cam, [[x, 0, z0], [x + 0.55, 0, z0], [x + 0.55, 0, zEnd], [x, 0, zEnd]])) {
        ctx.fillStyle = rut;
        ctx.fill();
      }
    }
    const bank = groundGrad(ctx, cam, C.bank, 300);
    for (const [xa, xb] of [[-9.2, -7], [7, 9.2]]) {
      if (NP.path3D(ctx, cam, [[xa, 0.35, z0], [xb, 0.35, z0], [xb, 0.35, zEnd], [xa, 0.35, zEnd]])) {
        ctx.fillStyle = bank;
        ctx.fill();
      }
    }
    // Snow drifts along the plant road read as speed lines when the camera climbs.
    const drift = groundGrad(ctx, cam, hex("#8597a7"), 420);
    for (let i = 0; i < 9; i++) {
      const x = -60 + i * 14 + hash(i, 77) * 6;
      const za = Z_SLAB + 20 + hash(i, 78) * 40;
      const zb = za + 120 + hash(i, 79) * 200;
      if (NP.path3D(ctx, cam, [[x, 0, za], [x + 1.6, 0, za], [x + 2.4, 0, zb], [x + 0.6, 0, zb]])) {
        ctx.fillStyle = drift;
        ctx.fill();
      }
    }
    for (const it of groundItems) it.draw(ctx, cam, env);
    // Sodium pools under each head.
    ctx.globalCompositeOperation = "lighter";
    for (const [xh, , zh] of lampHeads) {
      const d = zh - cam.z;
      if (d < 3) continue;
      const s = cam.f / d;
      const u = (xh - cam.x) * s;
      const v = cam.y * s;
      const rx = 10 * s;
      const ry = (cam.f * cam.y * 10) / (d * d);
      if (rx < 1) continue;
      ctx.save();
      ctx.translate(u, v);
      ctx.scale(1, Math.max(0.02, ry / rx));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      const a = 0.5 * (1 - NP.fogK(d, 260));
      g.addColorStop(0, css(C.sodium, a));
      g.addColorStop(0.5, css(C.sodium, a * 0.35));
      g.addColorStop(1, css(C.sodium, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---------------------------------------------------------------------------
  const env = {
    fogCol: C.fog,
    fog: (d) => NP.fogK(d, 380),
    t: 0,
  };

  function sky(ctx, cam, t) {
    env.t = t;
    NP.applyCam(ctx, cam);
    drawSky(ctx, cam, t);
  }

  function scene(ctx, cam, t) {
    env.t = t;
    NP.applyCam(ctx, cam);
    // Far ramparts stand on the horizon, before the ground covers their feet.
    let i = 0;
    while (i < items.length && items[i].key > 5000) NP.draw(ctx, cam, items[i++], env);
    drawGround(ctx, cam, env);
    for (; i < items.length; i++) NP.draw(ctx, cam, items[i], env);
  }

  // Falling snow, streaked by the camera's own motion during the shutter.
  const FLAKES = [];
  for (let i = 0; i < 340; i++) FLAKES.push([hash(i, 11), hash(i, 12), hash(i, 13), 0.012 + hash(i, 14) * 0.022, hash(i, 15) * 6.28]);
  function snow(ctx, cam, camPrev, t) {
    const BX = 26;
    const BY0 = -9;
    const BY1 = 22;
    const BZ = 90;
    const span = (cam.z - camPrev.z) || 0;
    NP.applyCam(ctx, cam);
    ctx.lineCap = "round";
    for (const f of FLAKES) {
      const fall = t * (1.1 + f[2] * 1.2);
      let wx = f[0] * 2 * BX - BX + 1.6 * t + Math.sin(t * 1.3 + f[4]) * 0.6;
      let wy = f[1] * (BY1 - BY0) + BY0 - fall;
      let wz = f[2] * BZ;
      // Wrap into the box that travels with the camera.
      let rx = (((wx - cam.x + BX) % (2 * BX)) + 2 * BX) % (2 * BX) - BX;
      let ry = (((wy - cam.y - BY0) % (BY1 - BY0)) + (BY1 - BY0)) % (BY1 - BY0) + BY0;
      let rz = (((wz - cam.z) % BZ) + BZ) % BZ;
      if (rz < 0.6) continue;
      const d = rz;
      const s = cam.f / d;
      const u = rx * s;
      const v = -ry * s;
      // Where this flake sat a shutter ago, relative to the earlier camera.
      const dx = cam.x - camPrev.x;
      const dy = cam.y - camPrev.y;
      const d0 = d + span;
      const s0 = camPrev.f / d0;
      const u0 = (rx + dx) * s0 + (camPrev.panX - cam.panX);
      const v0 = -(ry + dy) * s0 + (camPrev.panY - cam.panY);
      const size = Math.min(3.2, Math.max(0.9, f[3] * s * 2));
      const a = (1 - smoothstep(35, 90, d)) * smoothstep(1.2, 5, d) * 0.62;
      if (a < 0.02) continue;
      // Long streaks read as rain: keep the smear short.
      let sx = u0 - u;
      let sy = v0 - v;
      const len = Math.hypot(sx, sy);
      const cap = 18 + size * 4;
      if (len > cap) {
        sx *= cap / len;
        sy *= cap / len;
      }
      ctx.strokeStyle = `rgba(222,230,240,${(a * Math.min(1, 6 / Math.max(6, len * 0.5))).toFixed(3)})`;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(u + sx, v + sy);
      ctx.lineTo(u + 0.01, v);
      ctx.stroke();
    }
  }

  function overlay(ctx, cam, camPrev, t) {
    snow(ctx, cam, camPrev, t);
    const w = smoothstep(4.03, NP.T_CUT, t);
    if (w > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = css(C.whiteout, w);
      ctx.fillRect(0, 0, NP.W, NP.H);
    }
    NP.drawWisps(ctx, cam, t, smoothstep(3.92, NP.T_CUT, t), hex("#fff6ee"), hex("#8c7f7a"));
  }

  NP.city = { sky, scene, overlay, env };
})();
