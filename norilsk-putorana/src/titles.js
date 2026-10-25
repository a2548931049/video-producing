// The two place names. Copy comes from the root's composition variables, so it can be
// changed in Studio's Variables panel. Drawn in screen space; the plateau title is drawn
// right after the sky, so the canyon walls hide it until the camera climbs past them.
(function () {
  const NP = window.NP;
  const { clamp, smoothstep } = NP;

  const DEFAULTS = {
    "city-title": "诺里尔斯克",
    "city-sub": "НОРИЛЬСК · 69°20′N 88°13′E",
    "plateau-title": "普托拉纳高原",
    "plateau-sub": "ПЛАТО ПУТОРАНА · 69°03′N 94°09′E",
  };
  let vars = null;
  function copy(id) {
    if (!vars) {
      try {
        vars = (window.__hyperframes && window.__hyperframes.getVariables && window.__hyperframes.getVariables()) || {};
      } catch (e) {
        vars = {};
      }
    }
    const v = vars[id];
    return typeof v === "string" && v.length ? v : DEFAULTS[id];
  }

  const X = 192;
  const TITLE_Y = 186;
  const SUB_Y = 318;
  const TITLE_FONT = '700 100px "NP Title", "Noto Sans SC", sans-serif';
  const SUB_FONT = '700 28px "NP Sub", "PT Sans Narrow", sans-serif';
  const INK = "rgb(246,239,230)";
  const DAY_INK = "rgb(33,27,62)";
  const TRACK = 8;

  function layout(ctx, text) {
    ctx.font = TITLE_FONT;
    const chars = Array.from(text);
    let x = X;
    return chars.map((ch) => {
      const w = ctx.measureText(ch).width;
      const at = x;
      x += w + TRACK;
      return [ch, at];
    });
  }

  function drawSub(ctx, text, alpha, blur) {
    if (alpha <= 0.003) return;
    ctx.font = SUB_FONT;
    ctx.letterSpacing = "6.7px";
    ctx.globalAlpha = alpha * 0.86;
    ctx.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
    ctx.fillText(text, X + 2, SUB_Y);
    ctx.letterSpacing = "0px";
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }

  function prep(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.shadowColor = "rgba(6,10,20,0.42)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 2;
  }
  function done(ctx) {
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }

  // Norilsk: letters arrive one by one out of a blur, hold dead still,
  // and blur out just before the camera ducks under the slab.
  const CITY_IN = 0.7;
  const CITY_OUT = 2.5;
  NP.titles = {
    drawCity(ctx, t) {
      if (t < CITY_IN - 0.01 || t > CITY_OUT + 0.4) return;
      prep(ctx);
      const glyphs = layout(ctx, copy("city-title"));
      glyphs.forEach(([ch, x], i) => {
        const p = clamp((t - CITY_IN - i * 0.07) / 0.22);
        const q = clamp((t - CITY_OUT - i * 0.03) / 0.2);
        const a = (1 - Math.pow(1 - p, 3)) * (1 - q);
        if (a <= 0.003) return;
        const blur = 10 * (1 - p) + 8 * q;
        ctx.font = TITLE_FONT;
        ctx.globalAlpha = a;
        ctx.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
        ctx.fillText(ch, x, TITLE_Y);
      });
      const ps = clamp((t - CITY_IN - 0.45) / 0.22);
      const qs = clamp((t - CITY_OUT) / 0.18);
      drawSub(ctx, copy("city-sub"), (1 - Math.pow(1 - ps, 3)) * (1 - qs), 8 * (1 - ps) + 6 * qs);
      done(ctx);
    },

    // Putorana: no entrance of its own — the terrain falling away reveals it.
    // Night was paper-white on dark; the day is dark ink on a luminous sky.
    drawPlateau(ctx, t) {
      const a = smoothstep(6.75, 6.95, t);
      if (a <= 0) return;
      prep(ctx);
      ctx.fillStyle = DAY_INK;
      ctx.shadowColor = "rgba(255,236,220,0.35)";
      ctx.shadowBlur = 26;
      ctx.globalAlpha = a;
      ctx.font = TITLE_FONT;
      for (const [ch, x] of layout(ctx, copy("plateau-title"))) ctx.fillText(ch, x, TITLE_Y);
      drawSub(ctx, copy("plateau-sub"), a, 0);
      done(ctx);
    },
  };
})();
