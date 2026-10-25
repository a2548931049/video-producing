// Camera direction. Each shot returns { pos, target, fov, focus, aperture } in world space.
// Cuts are declared once in story.T and read everywhere.
import * as THREE from "three";
import { T, storyTime } from "./story.js";
import { clamp, lerp, smoothstep, seg, easeInOutSine, easeInOutCubic, noise1, fbm1 } from "./util.js";
import { SKY } from "./skyglsl.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// gentle hand-held drift (deterministic)
function drift(t, amp, f = 0.6) {
  return V(fbm1(t * f + 1.3) * amp, fbm1(t * f + 7.7) * amp * 0.7, fbm1(t * f + 4.1) * amp);
}

export function shotAt(t, probe) {
  const bp = probe.bike; // world position of the bike root (ground under the BB)
  const head = probe.head; // world position of the pelican head centre
  const eye = probe.eye; // world position of the near eye
  let s;
  if (t < T.wipe1 + 0.6) {
    // ---- build: orbit a stationary bike, then hand over to the tracking shot as it rolls off
    const c = V(bp.x + 0.12, bp.y + 0.82, bp.z);
    const u = seg(t, T.build0, T.wipe0);
    const phi = lerp(0, 0.62, easeInOutSine(u)) * (1 - easeInOutSine(seg(t, T.wipe0 - 0.4, T.wipe1 + 0.6)));
    const dist = lerp(4.55, 4.1, easeInOutSine(u));
    const hgt = lerp(0.02, 0.32, easeInOutSine(u)) * (1 - easeInOutSine(seg(t, T.wipe0, T.wipe1 + 0.6))) + 0.12 * easeInOutSine(seg(t, T.wipe0, T.wipe1 + 0.6));
    const pos = c.clone().add(V(Math.sin(phi) * dist, hgt, Math.cos(phi) * dist));
    // ease into the tracking offset of the next shot
    const k = easeInOutSine(seg(t, T.wipe0 + 0.2, T.wipe1 + 0.6));
    const trackPos = V(bp.x - 0.55, bp.y + 0.82, bp.z + 5.4);
    pos.lerp(trackPos, k);
    const target = c.clone().lerp(V(bp.x + 0.15, bp.y + 0.88, bp.z), k);
    s = { pos, target, fov: lerp(28, 30, k), focus: pos.distanceTo(target), aperture: 0.0 };
  } else if (t < T.cutDrive) {
    // ---- wide tracking side shot: the bike drifts across the frame, sea and moon behind
    const u = seg(t, T.wipe1 + 0.6, T.cutDrive);
    const pos = V(bp.x - 0.55 - 0.9 * u, bp.y + 0.82, bp.z + 5.4).add(drift(t, 0.03));
    const target = V(bp.x + 0.15 - 0.4 * u, bp.y + 0.9, bp.z);
    s = { pos, target, fov: 30 - 2 * u, focus: 5.4, aperture: 0.004 };
  } else if (t < T.cutHead) {
    // ---- drivetrain macro: chain over the teeth, webbed foot on the pedal
    const u = seg(t, T.cutDrive, T.cutHead);
    const pos = V(bp.x + 0.42 - 0.18 * u, bp.y + 0.36 + 0.03 * u, bp.z + 0.72 - 0.05 * u).add(drift(t, 0.006, 1.1));
    const target = V(bp.x - 0.02 - 0.08 * u, bp.y + 0.28, bp.z + 0.06);
    s = { pos, target, fov: 30, focus: pos.distanceTo(V(bp.x + 0.0, bp.y + 0.27, bp.z + 0.08)), aperture: 0.016 };
  } else if (t < T.cutDescent) {
    // ---- head close-up, front three-quarter on the camera side; the bird glances at us
    const u = seg(t, T.cutHead, T.cutDescent);
    const pos = V(head.x + 0.66 - 0.06 * u, head.y + 0.05, head.z + 0.7 + 0.04 * u).add(drift(t, 0.006, 0.9));
    const target = V(head.x + 0.14, head.y - 0.06, head.z);
    s = { pos, target, fov: 26, focus: pos.distanceTo(eye), aperture: 0.012 };
  } else if (t < T.cutAerial) {
    // ---- the descent: crest the hill from behind, crane round to the sea side, look back into the sun
    const a = V(bp.x - 3.0, bp.y + 2.0, bp.z + 2.3);
    const b = V(bp.x + 3.3, bp.y + 0.55, bp.z - 1.6);
    // camera that sits on the sun line, low, looking back at the bird with the sun behind it
    const sunBack = SKY.sunDir.clone().multiplyScalar(-3.1);
    const c = V(bp.x + sunBack.x, bp.y + 0.42, bp.z + sunBack.z);
    let pos, target, fov;
    const k1 = easeInOutCubic(seg(t, 25.6, 27.4));
    const k2 = easeInOutSine(seg(t, 27.2, 28.4));
    pos = a.clone().lerp(b, k1);
    // swing wide on the way round (avoid passing through the rider)
    pos.z += -Math.sin(k1 * Math.PI) * 1.2;
    pos.y += Math.sin(k1 * Math.PI) * 0.6;
    pos.lerp(c, k2);
    const tA = V(bp.x + 3.5, bp.y + 0.2, bp.z - 0.8);
    const tB = V(bp.x + 0.2, bp.y + 1.1, bp.z);
    const tC = V(bp.x + 0.0, bp.y + 1.25, bp.z + 0.1);
    target = tA.clone().lerp(tB, k1).lerp(tC, k2);
    fov = lerp(44, 36, k1);
    fov = lerp(fov, 40, k2);
    // after the slow-motion: drift back and up
    const k3 = easeInOutSine(seg(t, 29.6, T.cutAerial));
    pos.add(V(-1.2 * k3, 0.9 * k3, -0.6 * k3));
    pos.add(drift(t, 0.02, 0.7));
    s = { pos, target, fov, focus: pos.distanceTo(V(bp.x, bp.y + 1.1, bp.z)), aperture: k2 * 0.006 };
  } else {
    // ---- aerial: high behind the rider and its long shadow, then rise and tilt up to the moon
    const u = seg(t, T.cutAerial, T.end);
    const e = easeInOutSine(u);
    const pos = V(bp.x - 13 - 10 * e, bp.y + 9 + 13 * e, bp.z + 6 + 3 * e).add(drift(t, 0.05, 0.3));
    const down = V(bp.x + 15, bp.y - 2, bp.z - 8);
    const moonPt = pos.clone().addScaledVector(SKY.moonDir, 400).add(V(0, -22, 0));
    const k = easeInOutCubic(seg(t, 32.6, 36.8));
    const target = down.lerp(moonPt, k);
    s = { pos, target, fov: lerp(42, 33, k), focus: 30, aperture: 0 };
  }
  return s;
}
