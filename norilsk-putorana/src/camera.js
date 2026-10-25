// The one camera move. World A (Norilsk) runs until T_CUT, world B (Putorana) after it;
// the switch is hidden inside the smelter plume's white-out.
// Units: metres and seconds. roll > 0 banks left (the picture turns clockwise),
// panY > 0 tilts up (the horizon drops), panX > 0 yaws left.
(function () {
  const NP = window.NP;
  const T_CUT = (NP.T_CUT = 4.15);
  const tr = NP.track;

  // ---------------- World A: the city ----------------
  const A = {
    z: tr([[0, 0], [0.9, 40], [2.0, 92], [2.82, 132], [3.0, 145], [3.5, 190], [4.15, 300], [4.45, 372]], true),
    x: tr([[0, 1.5], [0.6, 2.4], [1.5, -1.6], [2.25, 0.9], [2.7, 0, 0], [3.05, 0, 0], [3.6, 4], [4.15, 9], [4.45, 10]]),
    y: tr([[0, 6.2], [0.8, 6.6], [1.6, 6.0], [2.15, 4.4], [2.55, 1.7], [2.8, 1.05, 0], [3.0, 1.15, 5], [3.2, 4.5], [3.5, 26], [3.85, 66], [4.15, 100], [4.45, 118]]),
    tilt: tr([[0, 55], [1.2, 45], [1.95, 5], [2.45, -45], [2.85, -20], [3.1, 40], [3.45, 140], [3.85, 170], [4.15, 120], [4.45, 100]]),
    f: tr([[0, 1060], [3.0, 1060, 0], [3.6, 1000], [4.15, 860], [4.45, 830]]),
    bank: tr([[0, 0], [2.8, 0], [3.5, 0.03], [4.15, -0.05], [4.45, -0.06]]),
  };

  // ---------------- World B: the plateau ----------------
  const B = {
    z: tr([[4.15, 0], [4.4, 46], [4.8, 105], [5.4, 190], [6.0, 275], [6.6, 360], [7.1, 420], [7.6, 452], [8.2, 468], [9.0, 477], [10.0, 484], [10.5, 486]], true),
    x: tr([[4.15, 0], [4.8, 6], [5.5, -12], [6.1, 16], [6.65, -5], [7.4, 0], [10.5, 6]]),
    y: tr([[4.15, 150], [4.45, 105], [4.8, 32], [5.1, 9, -15], [5.6, 7], [6.0, 8], [6.6, 10, 30], [6.8, 40], [7.0, 130], [7.2, 240], [7.45, 330], [7.75, 385], [8.2, 412], [9.0, 428], [10.0, 436], [10.5, 438]]),
    tilt: tr([[4.15, -60], [4.5, -240], [4.9, -190], [5.25, -110], [6.6, -110], [6.95, -60], [7.3, 0], [7.7, 20], [10.5, 20]]),
    f: tr([[4.15, 860], [4.9, 960], [5.2, 980], [10.5, 980]]),
    bank: tr([[4.15, -0.04], [4.5, 0.05], [5.0, 0], [6.6, 0], [7.4, 0, 0], [10.5, 0]]),
  };

  function lateral(track, t) {
    const h = 1 / 60;
    const v = (track(t + h) - track(t - h)) / (2 * h);
    const a = (track(t + h) - 2 * track(t) + track(t - h)) / (h * h);
    return { v, a };
  }

  function sample(W, t, world) {
    const lat = lateral(W.x, t);
    // FPV banking: roll into lateral acceleration, yaw slightly into the turn.
    const roll = NP.clamp(-0.0042 * lat.a, -0.16, 0.16) + W.bank(t);
    return {
      world,
      t,
      x: W.x(t),
      y: W.y(t),
      z: W.z(t),
      f: W.f(t),
      roll,
      panX: NP.clamp(-7 * lat.v, -60, 60),
      panY: W.tilt(t),
    };
  }

  NP.camAt = function (t) {
    return t < T_CUT ? sample(A, t, "A") : sample(B, t, "B");
  };
  NP.camTracks = { A, B };
})();
