// 2.5D multiplane renderer. The camera only translates, rolls and pans, so vertical world
// lines stay vertical and x-lines stay horizontal before the roll: every flat card is just
// a scaled copy of itself, and perspective comes from where things sit in depth.
(function () {
  const NP = window.NP;
  const W = NP.W;
  const H = NP.H;
  const NEAR = (NP.NEAR = 0.3);
  const SCREEN_R = Math.hypot(W, H) / 2 + 4;

  // screen = centre + R(roll) * (p + pan), p in camera units (u right, v down, px).
  NP.applyCam = function (ctx, cam) {
    ctx.setTransform(1, 0, 0, 1, W / 2, H / 2);
    ctx.rotate(cam.roll);
    ctx.translate(cam.panX, cam.panY);
  };

  NP.toScreen = function (cam, u, v) {
    const c = Math.cos(cam.roll);
    const s = Math.sin(cam.roll);
    const x = u + cam.panX;
    const y = v + cam.panY;
    return [W / 2 + c * x - s * y, H / 2 + s * x + c * y];
  };

  NP.onScreen = function (cam, u0, v0, u1, v1) {
    const cx = -cam.panX;
    const cy = -cam.panY;
    return !(u1 < cx - SCREEN_R || u0 > cx + SCREEN_R || v1 < cy - SCREEN_R || v0 > cy + SCREEN_R);
  };

  NP.project = function (cam, x, y, z) {
    const s = cam.f / (z - cam.z);
    return [(x - cam.x) * s, -(y - cam.y) * s];
  };

  NP.fogK = (d, dist) => 1 - Math.exp(-Math.max(0, d) / dist);

  // Sutherland–Hodgman against the near plane.
  NP.clipNear = function (pts, zn) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ina = a[2] >= zn;
      const inb = b[2] >= zn;
      if (ina) out.push(a);
      if (ina !== inb) {
        const k = (zn - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, zn]);
      }
    }
    return out;
  };

  // Projects a 3D polygon into the current path. Returns [vMin, vMax] or null when culled.
  NP.path3D = function (ctx, cam, pts) {
    const zn = cam.z + NEAR;
    let clipped = pts;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i][2] < zn) {
        clipped = NP.clipNear(pts, zn);
        break;
      }
    }
    if (clipped.length < 3) return null;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    const P = [];
    for (const p of clipped) {
      const s = cam.f / (p[2] - cam.z);
      const u = (p[0] - cam.x) * s;
      const v = -(p[1] - cam.y) * s;
      P.push(u, v);
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    if (!NP.onScreen(cam, u0, v0, u1, v1)) return null;
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 2; i < P.length; i += 2) ctx.lineTo(P[i], P[i + 1]);
    ctx.closePath();
    return [v0, v1, u0, u1];
  };

  NP.fill3D = function (ctx, cam, pts, style) {
    const r = NP.path3D(ctx, cam, pts);
    if (!r) return null;
    ctx.fillStyle = style;
    ctx.fill();
    return r;
  };

  // ---------------------------------------------------------------------------
  // Cards: flat cut-outs facing the camera. Parts are Path2D in local metres (y up).
  // part = { path, col, alpha?, glow? (0..1 resists fog), comp?, grad?: [y0, y1, colA, colB] }
  NP.card = function (x, y, z, bbox, parts, extra) {
    return Object.assign({ kind: "card", x, y, z, key: z, bbox, parts }, extra || {});
  };

  NP.drawCard = function (ctx, cam, card, env) {
    const d = card.z - cam.z;
    if (d <= NEAR) return;
    const s = cam.f / d;
    let cx = card.x;
    let cy = card.y;
    if (card.vel) {
      // Slow drift (plume, mist), anchored so the card sits where it was placed at t0.
      cx += card.vel[0] * (env.t - (card.t0 || 0));
      cy += card.vel[1] * (env.t - (card.t0 || 0));
    }
    const u = (cx - cam.x) * s;
    const v = -(cy - cam.y) * s;
    const b = card.bbox;
    if (!NP.onScreen(cam, u + b[0] * s, v - b[3] * s, u + b[2] * s, v - b[1] * s)) return;
    const k = env.fog(d, card);
    const fade = card.nearFade ? NP.smoothstep(NEAR, card.nearFade, d) : 1;
    if (fade <= 0.002) return;
    ctx.save();
    ctx.transform(s, 0, 0, -s, u, v);
    for (const p of card.parts) {
      if (p.minScale && s < p.minScale) continue;
      const glow = p.glow || 0;
      const col = NP.mix(p.col, env.fogCol, k * (1 - glow));
      let a = (p.alpha == null ? 1 : p.alpha) * fade;
      if (glow) a *= 1 - k * 0.8 * glow;
      if (a <= 0.002) continue;
      ctx.globalAlpha = a;
      if (p.comp) ctx.globalCompositeOperation = p.comp;
      if (p.grad) {
        const g = ctx.createLinearGradient(0, p.grad[0], 0, p.grad[1]);
        g.addColorStop(0, NP.css(NP.mix(p.grad[2], env.fogCol, k * (1 - glow))));
        g.addColorStop(1, NP.css(NP.mix(p.grad[3], env.fogCol, k * (1 - glow))));
        ctx.fillStyle = g;
      } else ctx.fillStyle = NP.css(col);
      ctx.fill(p.path);
      if (p.comp) ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
    if (card.paint) card.paint(ctx, cam, env, { d, s, u, v, k, fade });
    ctx.restore();
  };

  // ---------------------------------------------------------------------------
  // Lofts: a counter-clockwise profile in the x–y plane (y up) swept from za to zb while
  // it changes shape (A at za, B at zb, same vertex count). Faces are painted far to near;
  // a wall built from consecutive lofts has no seams between segments.
  NP.loft = function (A, B, za, zb, style, extra) {
    const n = A.length;
    const edges = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = A[j][0] - A[i][0] + B[j][0] - B[i][0];
      const dy = A[j][1] - A[i][1] + B[j][1] - B[i][1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = dy / len;
      const ny = -dx / len;
      let type = "riser";
      if (Math.abs(ny) > Math.abs(nx)) type = ny > 0 ? "ledge" : "under";
      edges.push({ i, j, type, nx, ny });
    }
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of A.concat(B)) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    return Object.assign({ kind: "loft", A, B, za, zb, key: zb, edges, style, box: [x0, y0, x1, y1] }, extra || {});
  };

  NP.drawLoft = function (ctx, cam, L, env) {
    if (L.zb <= cam.z + NEAR) return;
    const faces = [];
    for (const e of L.edges) {
      if (e.type === "under") continue;
      const a0 = L.A[e.i];
      const a1 = L.A[e.j];
      const b0 = L.B[e.i];
      // n = (a1 - a0) x (b0 - a0), outward for counter-clockwise profiles.
      const ux = a1[0] - a0[0];
      const uy = a1[1] - a0[1];
      const vx = b0[0] - a0[0];
      const vy = b0[1] - a0[1];
      const vz = L.zb - L.za;
      const nx = uy * vz;
      const ny = -ux * vz;
      const nz = ux * vy - uy * vx;
      if (nx * (cam.x - a0[0]) + ny * (cam.y - a0[1]) + nz * (cam.z - L.za) <= 0) continue;
      const mx = (a0[0] + a1[0] + b0[0] + L.B[e.j][0]) / 4;
      const my = (a0[1] + a1[1] + b0[1] + L.B[e.j][1]) / 4;
      const mz = Math.max(cam.z + 1, (L.za + L.zb) / 2);
      faces.push({ e, dist: Math.hypot(mx - cam.x, my - cam.y, mz - cam.z) });
    }
    faces.sort((p, q) => q.dist - p.dist);
    for (const f of faces) L.style(ctx, cam, env, f.e, f.dist, L);
  };

  NP.draw = function (ctx, cam, item, env) {
    if (item.kind === "card") NP.drawCard(ctx, cam, item, env);
    else if (item.kind === "loft") NP.drawLoft(ctx, cam, item, env);
    else item.draw(ctx, cam, env);
  };

  // ---------------------------------------------------------------------------
  // Ground plane y = 0: depth d sits at v = f * camY / d below the horizon.
  NP.drawGround = function (ctx, cam, colAt) {
    if (cam.y <= 0.02) return;
    const vMax = -cam.panY + SCREEN_R + 40;
    if (vMax <= 0) return;
    const g = ctx.createLinearGradient(0, 0, 0, vMax);
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const q = i / N;
      const v = vMax * q * q;
      const d = v > 0 ? (cam.f * cam.y) / v : 1e7;
      g.addColorStop(q * q, NP.css(colAt(d)));
    }
    ctx.fillStyle = g;
    const cx = -cam.panX;
    ctx.fillRect(cx - SCREEN_R - 40, 0, 2 * SCREEN_R + 80, vMax);
  };

  // A vertical sky gradient keyed to the horizon (v = 0) plus the region it must cover.
  NP.skyRect = function (cam) {
    const cx = -cam.panX;
    const cy = -cam.panY;
    return [cx - SCREEN_R - 40, cy - SCREEN_R - 40, 2 * SCREEN_R + 80, 2 * SCREEN_R + 80];
  };
  NP.SCREEN_R = SCREEN_R;

  // Cloud wisps streaming out of the vanishing point: the speed cue inside a white-out.
  NP.drawWisps = function (ctx, cam, t, strength, light, dark) {
    if (strength <= 0.01) return;
    NP.applyCam(ctx, cam);
    ctx.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const ang = NP.hash(i, 81) * Math.PI * 2;
      const ph = NP.hash(i, 82);
      const q = (ph + t * (1.6 + NP.hash(i, 83) * 1.4)) % 1;
      const r0 = 40 + q * q * 1300;
      const len = 30 + q * q * 520;
      const a = strength * Math.sin(Math.PI * q) * (0.08 + 0.14 * NP.hash(i, 84));
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      ctx.strokeStyle = NP.css(NP.hash(i, 85) < 0.7 ? light : dark, a);
      ctx.lineWidth = 2 + q * 26 * NP.hash(i, 86);
      ctx.beginPath();
      ctx.moveTo(c * r0, sn * r0 * 0.75);
      ctx.lineTo(c * (r0 + len), sn * (r0 + len) * 0.75);
      ctx.stroke();
    }
  };
})();
