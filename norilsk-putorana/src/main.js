// Frame compositor: motion blur by sub-frame averaging, then snow, titles, grain, vignette.
// renderFrame(t) is a pure function of t, driven by the paused GSAP timeline in index.html.
(function () {
  const NP = window.NP;
  const { W, H } = NP;
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  const SHUTTER = 0.5 / 30; // 180°

  const worldOf = (cam) => (cam.world === "A" ? NP.city : NP.plateau);

  function reset(c) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    c.filter = "none";
  }

  // The sky (and anything pinned to it) is drawn once per frame and reused by every
  // sub-frame: it sits at infinity, so it barely moves within one shutter.
  const sky = document.createElement("canvas");
  sky.width = W;
  sky.height = H;
  const sctx = sky.getContext("2d");

  function renderWorld(c, t, skyReady) {
    const cam = NP.camAt(t);
    const world = worldOf(cam);
    reset(c);
    if (skyReady) c.drawImage(sky, 0, 0);
    else world.sky(c, cam, t);
    reset(c);
    world.scene(c, cam, t);
    reset(c);
  }

  // How far typical near things travel on screen during the shutter decides the sub-frames.
  const PROBES = {
    A: [[-12, 3, 14], [12, -3, 14], [0, 8, 10], [-6, -5, 8], [8, 6, 30]],
    B: [[-60, 20, 60], [60, -8, 60], [0, -8, 25], [-30, 40, 120], [0, 0, 400]],
  };
  function screenOf(cam, X, Y, Z) {
    const d = Z - cam.z;
    if (d < 0.5) return null;
    const s = cam.f / d;
    return NP.toScreen(cam, (X - cam.x) * s, -(Y - cam.y) * s);
  }
  function samplesAt(t) {
    const c0 = NP.camAt(t - SHUTTER / 2);
    const c1 = NP.camAt(t + SHUTTER / 2);
    if (c0.world !== c1.world) return 1;
    const c = NP.camAt(t);
    let D = 0;
    for (const [ox, oy, oz] of PROBES[c.world]) {
      const a = screenOf(c0, c.x + ox, c.y + oy, c.z + oz);
      const b = screenOf(c1, c.x + ox, c.y + oy, c.z + oz);
      if (a && b) D = Math.max(D, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    return NP.clamp(Math.ceil(D / 7), 1, 10);
  }

  // Film grain: four seeded tiles, re-dealt 15 times a second.
  const GRAIN = [];
  for (let k = 0; k < 4; k++) {
    const g = document.createElement("canvas");
    g.width = g.height = 256;
    const gc = g.getContext("2d");
    const img = gc.createImageData(256, 256);
    const rnd = NP.rng(500 + k);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 128 + (rnd() + rnd() + rnd() - 1.5) * 70;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    GRAIN.push(ctx.createPattern(g, "repeat"));
  }
  let vignette = null;
  function post(t) {
    reset(ctx);
    const step = Math.floor(t * 15);
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.085;
    ctx.translate(-Math.floor(NP.hash(step, 3) * 256), -Math.floor(NP.hash(step, 4) * 256));
    ctx.fillStyle = GRAIN[step % 4];
    ctx.fillRect(0, 0, W + 256, H + 256);
    reset(ctx);
    if (!vignette) {
      vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.34)");
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  NP.renderFrame = function (t) {
    const N = samplesAt(t);
    if (N > 1) {
      const cam = NP.camAt(t);
      reset(sctx);
      worldOf(cam).sky(sctx, cam, t);
    }
    for (let i = 0; i < N; i++) {
      const ts = N === 1 ? t : t + SHUTTER * ((i + 0.5) / N - 0.5);
      if (i === 0) {
        renderWorld(ctx, ts, N > 1);
        continue;
      }
      // Running average over opaque frames: static pixels stay exact, movers smear.
      renderWorld(tctx, ts, true);
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 1;
    }
    const cam = NP.camAt(t);
    const camPrev = NP.camAt(t - SHUTTER);
    reset(ctx);
    worldOf(cam).overlay(ctx, cam, camPrev.world === cam.world ? camPrev : cam, t);
    reset(ctx);
    NP.titles.drawCity(ctx, t);
    post(t);
    NP.lastSamples = N;
  };

  // Fonts load before the first real frame; index.html hands this to the runtime.
  NP.ready = Promise.all([
    document.fonts.load('700 100px "NP Title"', "诺里尔斯克普托拉纳高原"),
    document.fonts.load('700 28px "NP Sub"', "НОРИЛЬСК ПЛАТО ПУТОРАНА 69°"),
  ]);
})();
