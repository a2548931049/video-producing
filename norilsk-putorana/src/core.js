// Shared, pure helpers: seeded randomness, easing, colour, keyframe tracks.
(function () {
  const NP = (window.NP = window.NP || {});
  NP.W = 1920;
  NP.H = 1080;
  NP.DURATION = 10;

  NP.clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  NP.lerp = (a, b, k) => a + (b - a) * k;
  NP.smoothstep = (a, b, x) => {
    const k = NP.clamp((x - a) / (b - a));
    return k * k * (3 - 2 * k);
  };

  // Seeded PRNG: the same seed builds the same city every render.
  NP.rng = function (seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // Stateless hash in [0, 1) for per-index choices (windows, strokes, particles).
  NP.hash = function (n, salt = 0) {
    let x = Math.imul((n | 0) ^ Math.imul(salt | 0, 0x27d4eb2d), 0x9e3779b1);
    x ^= x >>> 15;
    x = Math.imul(x, 0x85ebca77);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae3d);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };

  NP.hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  NP.mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  NP.mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  NP.css = (c, alpha = 1) => {
    const r = Math.round(NP.clamp(c[0], 0, 255));
    const g = Math.round(NP.clamp(c[1], 0, 255));
    const b = Math.round(NP.clamp(c[2], 0, 255));
    return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${NP.clamp(alpha).toFixed(4)})`;
  };

  // Cubic Hermite through [t, value, slope?] keys. Missing slopes are Catmull-Rom;
  // `monotone` uses Fritsch–Carlson so a position track never runs backwards.
  // Outside the keys the track continues along its end slope.
  NP.track = function (keys, monotone = false) {
    const n = keys.length;
    const T = keys.map((k) => k[0]);
    const V = keys.map((k) => k[1]);
    const M = new Array(n);
    const d = [];
    for (let i = 0; i < n - 1; i++) d.push((V[i + 1] - V[i]) / (T[i + 1] - T[i]));
    for (let i = 0; i < n; i++) {
      if (keys[i].length > 2) M[i] = keys[i][2];
      else if (i === 0) M[i] = d[0];
      else if (i === n - 1) M[i] = d[n - 2];
      else if (monotone) M[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      else M[i] = (V[i + 1] - V[i - 1]) / (T[i + 1] - T[i - 1]);
    }
    if (monotone) {
      for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) {
          if (keys[i].length < 3) M[i] = 0;
          if (keys[i + 1].length < 3) M[i + 1] = 0;
          continue;
        }
        const a = M[i] / d[i];
        const b = M[i + 1] / d[i];
        const s = a * a + b * b;
        if (s > 9) {
          const tau = 3 / Math.sqrt(s);
          M[i] = tau * a * d[i];
          M[i + 1] = tau * b * d[i];
        }
      }
    }
    const f = function (t) {
      if (t <= T[0]) return V[0] + M[0] * (t - T[0]);
      if (t >= T[n - 1]) return V[n - 1] + M[n - 1] * (t - T[n - 1]);
      let i = 0;
      while (t > T[i + 1]) i++;
      const h = T[i + 1] - T[i];
      const s = (t - T[i]) / h;
      const s2 = s * s;
      const s3 = s2 * s;
      return (
        (2 * s3 - 3 * s2 + 1) * V[i] +
        (s3 - 2 * s2 + s) * h * M[i] +
        (-2 * s3 + 3 * s2) * V[i + 1] +
        (s3 - s2) * h * M[i + 1]
      );
    };
    // Inverse for monotone tracks: the time at which the track reaches `v`.
    f.timeOf = function (v) {
      let lo = T[0] - 5;
      let hi = T[n - 1] + 5;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < v) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    return f;
  };
})();
