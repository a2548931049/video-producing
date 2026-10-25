// Couples the pelican to the bicycle: pedals → feet (leg IK), hoods → wrists (wing IK),
// pedal phase → body bob, pouch sway, head stabilisation.
import * as THREE from "three";
import { B } from "./bike.js";
import { clamp, lerp, TAU } from "./util.js";

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

export function makeRig(bike, pel) {
  const seat = V(B.SP.x - 0.012, B.SP.y + 0.05, 0);
  pel.root.position.copy(seat);
  bike.root.add(pel.root);
  const tmp = V();

  // st: { t, crank, wheel, steer, wingSpread, feetOff, headYaw, headPitch, headRoll, blink, wind, featherGrow, pedaling }
  function solve(st) {
    const crank = st.crank ?? 0;
    // pedals stay near level with a little ankling (toe down at the back of the stroke)
    const tiltR = 0.12 * Math.sin(crank - 0.6) - 0.05;
    const tiltL = 0.12 * Math.sin(crank + Math.PI - 0.6) - 0.05;
    bike.update({ crank, wheel: st.wheel ?? 0, steer: st.steer ?? 0, pedalTilt: [tiltR, tiltL] });

    // body bob: two pushes per revolution, largest at the down-stroke
    const push = st.pedaling ?? 1;
    const bob = (0.006 * Math.cos(2 * crank) + 0.002) * push;
    const roll = 0.025 * Math.sin(crank) * push; // sway toward the pushing leg
    pel.root.position.set(seat.x, seat.y + bob, seat.z);
    pel.root.rotation.set(roll, 0, (st.lean ?? 0) * 1.0);
    pel.root.updateMatrix();
    const inv = new THREE.Matrix4().compose(pel.root.position, pel.root.quaternion, V(1, 1, 1)).invert();

    // feet
    const feetOff = clamp(st.feetOff ?? 0);
    const foot = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const pp = bike.pedalPoint(i, tmp.clone());
      const tilt = i === 0 ? tiltR : tiltL;
      const pLocal = pp.clone().add(V(-0.008, 0.002, 0)).applyMatrix4(inv);
      // legs out to the side when coasting
      const out = V(0.16, -0.4, side * 0.27).add(V(0.02 * Math.sin((st.t ?? 0) * 3 + i), 0.015 * Math.sin((st.t ?? 0) * 2.3 + i * 2), 0));
      const p = pLocal.clone().lerp(out, feetOff * feetOff * (3 - 2 * feetOff));
      const yaw = side * 0.12;
      const fwd = V(Math.cos(tilt) * Math.cos(yaw), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
      const up = V(-Math.sin(tilt), Math.cos(tilt), 0);
      const fwdOff = V(0.9, -0.35 + 0.0, side * 0.3).normalize();
      fwd.lerp(fwdOff, feetOff).normalize();
      up.lerp(V(0.3, 0.8, side * 0.3).normalize(), feetOff).normalize();
      fwd.applyQuaternion(pel.root.quaternion.clone().invert());
      up.applyQuaternion(pel.root.quaternion.clone().invert());
      foot.push({ p, fwd, up, pole: V(-1, -0.15 + feetOff * 0.6, side * (0.45 + feetOff * 0.8)) });
    }

    // hoods (wrists rest on the brake hoods); ignore the tiny steering angle
    const hoodR = V(B.hoodR.x + 0.01, B.hoodR.y + 0.03, B.hoodR.z).applyMatrix4(inv);
    const hoodL = V(B.hoodL.x + 0.01, B.hoodL.y + 0.03, B.hoodL.z).applyMatrix4(inv);

    // pouch: lags the body bob like a damped spring
    const pouchSag = push * Math.sin(2 * crank - 1.1) + (st.pouchExtra ?? 0);
    const pouchSway = push * 0.6 * Math.sin(crank - 0.9) + (st.pouchSwayExtra ?? 0);

    // head stabilisation: counter the bob so the head holds its line
    const headOffset = V(0, -bob * 0.85, 0).add(st.headOffset ?? V());

    pel.update({
      t: st.t ?? 0,
      wind: st.wind ?? 0.5,
      featherGrow: st.featherGrow ?? 1,
      wingSpread: st.wingSpread ?? 0,
      wingFlap: st.wingFlap ?? 0,
      hoodR, hoodL,
      footR: foot[0], footL: foot[1],
      pouchSag, pouchSway,
      headYaw: st.headYaw ?? 0,
      headPitch: st.headPitch ?? 0,
      headRoll: (st.headRoll ?? 0) - roll * 0.9,
      headOffset,
      blink: st.blink ?? 0,
      tailLift: st.tailLift ?? 0,
    });
  }
  return { solve, seat };
}

export { TAU, lerp };
