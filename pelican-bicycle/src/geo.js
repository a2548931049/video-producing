// Geometry builders: sweeps, lathes, gears. All procedural, all deterministic.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export { mergeGeometries, mergeVertices };

const tmpV = new THREE.Vector3();

// Frames along a polyline. If `up` is given the normal tries to stay aligned with it,
// otherwise parallel transport keeps the frame from twisting.
export function frames(points, up = null) {
  const n = points.length;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  if (up) {
    for (let i = 0; i < n; i++) {
      const u = typeof up === "function" ? up(i / (n - 1)) : up;
      const nn = u.clone().addScaledVector(T[i], -u.dot(T[i]));
      if (nn.lengthSq() < 1e-10) nn.set(1, 0, 0);
      nn.normalize();
      N.push(nn);
      B.push(new THREE.Vector3().crossVectors(T[i], nn));
    }
    return { T, N, B };
  }
  // initial normal: least aligned axis
  const t0 = T[0];
  const ax = Math.abs(t0.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  let nPrev = ax.addScaledVector(t0, -ax.dot(t0)).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const s = axis.length();
      if (s > 1e-8) {
        axis.divideScalar(s);
        const ang = Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1));
        nPrev = nPrev.clone().applyAxisAngle(axis, ang);
      }
      nPrev.addScaledVector(T[i], -nPrev.dot(T[i])).normalize();
    }
    N.push(nPrev.clone());
    B.push(new THREE.Vector3().crossVectors(T[i], nPrev));
  }
  return { T, N, B };
}

// General sweep: profile(s, a) returns [x, y] in the (N, B) plane, where s ∈ [0,1] along the
// path and a ∈ [0,1) around the section. Returns an indexed BufferGeometry with UVs.
export function sweep(points, profile, opts = {}) {
  const radial = opts.radial ?? 16;
  const fr = opts.frames ?? frames(points, opts.up ?? null);
  const n = points.length;
  const pos = [], uv = [], idx = [];
  // arc length for v
  const len = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + points[i].distanceTo(points[i - 1]));
  const L = len[n - 1] || 1;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial;
      const [x, y] = profile(s, a % 1, i);
      tmpV.copy(points[i]).addScaledVector(fr.N[i], x).addScaledVector(fr.B[i], y);
      pos.push(tmpV.x, tmpV.y, tmpV.z);
      uv.push(a, opts.vByLength ? len[i] : len[i] / L);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const capStart = opts.caps === true || opts.caps === "start";
  const capEnd = opts.caps === true || opts.caps === "end";
  const addCap = (i, flip) => {
    const center = pos.length / 3;
    const c = points[i];
    // centroid of the ring
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < radial; j++) {
      const k = (i * row + j) * 3;
      cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2];
    }
    pos.push(cx / radial, cy / radial, cz / radial);
    uv.push(0.5, i === 0 ? 0 : 1);
    // duplicate ring for a crisp cap edge
    const ringStart = pos.length / 3;
    for (let j = 0; j <= radial; j++) {
      const k = (i * row + j) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
      uv.push(j / radial, i === 0 ? 0 : 1);
    }
    for (let j = 0; j < radial; j++) {
      if (flip) idx.push(center, ringStart + j, ringStart + j + 1);
      else idx.push(center, ringStart + j + 1, ringStart + j);
    }
    void c;
  };
  if (capStart) addCap(0, true);
  if (capEnd) addCap(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Tube along points with radius r(s).
export function tube(points, r, radial = 12, opts = {}) {
  const rf = typeof r === "function" ? r : () => r;
  return sweep(
    points,
    (s, a) => {
      const ang = a * Math.PI * 2;
      const rr = rf(s);
      return [Math.cos(ang) * rr, Math.sin(ang) * rr];
    },
    { radial, ...opts },
  );
}

// Sample a CatmullRom curve through control points.
export function curvePts(ctrl, samples = 48, type = "centripetal", tension = 0.5) {
  const c = new THREE.CatmullRomCurve3(ctrl, false, type, tension);
  return c.getSpacedPoints(samples);
}

// Straight cylinder from a to b (open-ended unless caps).
export function rod(a, b, r1, r2 = r1, radial = 16, caps = true) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, radial, 1, !caps);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

// Lathe around the local Z axis. profile: array of [radius, z].
export function latheZ(profile, segments = 64, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-5), z));
  const g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  g.rotateX(Math.PI / 2);
  return g;
}

// Sprocket outline as a THREE.Shape. Roller-seat valleys sit on the pitch circle.
export function sprocketShape(teeth, pitch = 0.0127, rollerD = 0.00775, holeR = 0) {
  const R = pitch / (2 * Math.sin(Math.PI / teeth));
  const seat = rollerD * 0.505;
  const tipR = R + pitch * 0.32;
  const shape = new THREE.Shape();
  const per = 14;
  let first = true;
  const valleyW = Math.min(0.42, seat / pitch); // valley half-width in tooth units
  for (let k = 0; k < teeth; k++) {
    for (let j = 0; j < per; j++) {
      const p = j / per; // 0 = valley centre, 0.5 = tooth tip
      const ang = ((k + p) / teeth) * Math.PI * 2;
      const d = Math.min(p, 1 - p); // distance from the valley, in tooth units
      let r;
      if (d < valleyW) {
        // roller seat: circle of radius `seat` centred on the pitch circle
        const x = d * pitch;
        r = R - Math.sqrt(Math.max(0, seat * seat - x * x));
      } else {
        const u = (d - valleyW) / (0.5 - valleyW); // 0..1 toward the tip
        r = R + (tipR - R) * Math.pow(Math.sin(u * Math.PI * 0.5), 0.8);
      }
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      if (first) { shape.moveTo(x, y); first = false; } else shape.lineTo(x, y);
    }
  }
  shape.closePath();
  if (holeR > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  return { shape, R };
}

export function extrude(shape, depth, bevel = 0, curveSegments = 24) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Ellipsoid helper
export function ellipsoid(rx, ry, rz, ws = 24, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

// Apply a matrix built from position / quaternion / scale to a geometry (returns it).
export function place(g, pos, quat = null, scale = null) {
  const m = new THREE.Matrix4().compose(
    pos ?? new THREE.Vector3(),
    quat ?? new THREE.Quaternion(),
    scale ?? new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

// Helix (for saddle springs)
export function helixPts(radius, pitch, turns, samples = 120) {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, t * pitch * turns, Math.sin(a) * radius));
  }
  return pts;
}

// Strip all attributes except position/normal/uv so geometries can merge.
export function clean(g) {
  if (g.index === null) g = mergeVertices(g, 1e-7);
  for (const k of Object.keys(g.attributes)) {
    if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
  }
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

const KEEP = new Set(["position", "normal", "uv", "aPart", "aSeq"]);
export function merge(list) {
  const gs = list.map((g) => {
    let gg = g;
    if (!gg.attributes.normal) gg.computeVertexNormals();
    if (gg.index) gg = gg.toNonIndexed();
    for (const k of Object.keys(gg.attributes)) if (!KEEP.has(k)) gg.deleteAttribute(k);
    const n = gg.attributes.position.count;
    if (!gg.attributes.uv) gg.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!gg.attributes.aPart) gg.setAttribute("aPart", new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    if (!gg.attributes.aSeq) gg.setAttribute("aSeq", new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    return gg;
  });
  return mergeGeometries(gs, false);
}
