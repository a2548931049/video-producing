// A line of white pelicans gliding over the coast for the closing aerial shot.
// Pelicans flap in a wave that travels down the line, then glide together.
import * as THREE from "three";
import { patch } from "./materials.js";
import { T } from "./story.js";
import { seg, smoothstep, clamp, lerp, lin } from "./util.js";

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

function colorGeo(g, fn) {
  const p = g.attributes.position, n = p.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = lin(k[0]); c[i * 3 + 1] = lin(k[1]); c[i * 3 + 2] = lin(k[2]);
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

function wingGeo(len, chord0, chord1, outer) {
  // spans +Z, chord toward −X, slight camber; outer segment has black primaries + fingered tip
  const nS = 8, nC = 3;
  const P = [], I = [];
  for (let i = 0; i <= nS; i++) {
    const s = i / nS;
    const z = s * len;
    const chord = lerp(chord0, chord1, s) * (outer ? 1 - 0.35 * s * s : 1);
    const sweep = outer ? s * s * 0.12 : 0;
    for (let j = 0; j <= nC; j++) {
      const c = j / nC;
      P.push(-c * chord - sweep, 0.03 * Math.sin(c * Math.PI) * (1 - s * 0.5), z);
    }
  }
  for (let i = 0; i < nS; i++) for (let j = 0; j < nC; j++) {
    const a = i * (nC + 1) + j, b = a + 1, c = a + nC + 1, d = c + 1;
    I.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  const maxC = Math.max(chord0, chord1);
  return colorGeo(g, (x, y, z) => {
    const back = -x / maxC; // 0 leading edge → 1 trailing edge
    const black = outer ? smoothstep(0.15, 0.4, z / len + back * 0.6) : smoothstep(0.55, 0.75, back) * 0.95;
    const w = [0.95, 0.94, 0.9], b = [0.07, 0.065, 0.07];
    return w.map((v, i) => lerp(v, b[i], black));
  });
}

function buildBird() {
  const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), { aerial: true, translucency: 0.6, transColor: 0xffe0b0 });
  const bird = new THREE.Group();
  const body = new THREE.Mesh(colorGeo(new THREE.SphereGeometry(1, 16, 10).scale(0.42, 0.13, 0.15), () => [0.95, 0.94, 0.9]), mat);
  // neck tucked back, head on the shoulders, bill resting forward
  const head = new THREE.Mesh(colorGeo(new THREE.SphereGeometry(0.075, 10, 8), () => [0.95, 0.94, 0.9]), mat);
  head.position.set(0.34, 0.1, 0);
  const bill = new THREE.Mesh(colorGeo(new THREE.ConeGeometry(0.035, 0.36, 8).rotateZ(-Math.PI / 2).scale(1, 1.6, 0.8), () => [0.96, 0.62, 0.25]), mat);
  bill.position.set(0.56, 0.06, 0);
  bill.rotation.z = -0.12;
  const tail = new THREE.Mesh(colorGeo(new THREE.ConeGeometry(0.1, 0.22, 6).rotateZ(Math.PI / 2).scale(1, 0.3, 1), () => [0.95, 0.94, 0.9]), mat);
  tail.position.set(-0.48, 0, 0);
  const feet = new THREE.Mesh(colorGeo(new THREE.ConeGeometry(0.04, 0.16, 5).rotateZ(Math.PI / 2), () => [0.95, 0.55, 0.2]), mat);
  feet.position.set(-0.5, -0.06, 0);
  bird.add(body, head, bill, tail, feet);
  const wings = [];
  for (const s of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.1, 0.05, 0.08 * s);
    const inner = new THREE.Mesh(wingGeo(0.62, 0.36, 0.3, false), mat);
    const elbow = new THREE.Group();
    elbow.position.set(0, 0, 0.62);
    const outer = new THREE.Mesh(wingGeo(0.66, 0.3, 0.26, true), mat);
    if (s < 0) { inner.scale.z = -1; elbow.position.z = -0.62; outer.scale.z = -1; }
    elbow.add(outer);
    shoulder.add(inner, elbow);
    bird.add(shoulder);
    wings.push({ shoulder, elbow, s });
  }
  bird.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { bird, wings };
}

export function buildFlock() {
  const group = new THREE.Group();
  group.name = "flock";
  const birds = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const b = buildBird();
    // shallow echelon / loose V
    const side = i === 0 ? 0 : i % 2 ? 1 : -1;
    const rank = Math.ceil(i / 2);
    b.offset = V(-1.9 * rank + (i * 0.37) % 0.6, 0.18 * rank + ((i * 0.53) % 0.4), side * 1.6 * rank);
    b.phase = rank * 0.42 + (i % 2) * 0.1;
    b.scale = 0.95 + ((i * 0.31) % 0.12);
    b.bird.scale.setScalar(b.scale);
    group.add(b.bird);
    birds.push(b);
  }
  let anchor = null;
  const moonH = new THREE.Vector3();
  function update(t, bikePos, camPos, moonDir) {
    const t0 = 32.9;
    const on = t > t0 && camPos;
    group.visible = !!on;
    if (!on) return;
    const u = t - t0;
    moonH.set(moonDir.x, 0, moonDir.z).normalize();
    const side = new THREE.Vector3(-moonH.z, 0, moonH.x);
    const lead = camPos.clone().addScaledVector(moonH, 3 + 9.8 * u).add(new THREE.Vector3(0, 4.6 + 0.35 * u, 0)).addScaledVector(side, 1.5 + 0.3 * u);
    const heading = Math.atan2(-moonH.z, moonH.x);
    for (const b of birds) {
      const o = b.offset;
      const p = lead.clone().addScaledVector(moonH, o.x).addScaledVector(side, o.z).add(new THREE.Vector3(0, o.y + Math.sin(u * 0.6 + b.phase) * 0.25, 0));
      b.bird.position.copy(p);
      b.bird.rotation.set(0, heading, 0);
      b.bird.rotateX(0.05 * Math.sin(u * 0.7 + b.phase));
      // flap–glide cycle travelling down the line
      const cyc = (((u * 0.62 - b.phase * 0.45) % 2.0) + 2.0) % 2.0;
      const flapping = cyc < 1.05;
      const ph = (cyc / 1.05) * Math.PI * 2;
      const flap = flapping ? Math.sin(ph) : 0;
      for (const w of b.wings) {
        w.shoulder.rotation.x = -w.s * (-0.06 + 0.5 * flap);
        w.elbow.rotation.x = -w.s * (0.05 + 0.28 * Math.max(0, -flap));
        w.shoulder.rotation.y = w.s * (0.05 - 0.07 * flap);
      }
    }
  }
  function setAnchor(p) { anchor = p.clone(); }
  return { group, update, setAnchor };
}
