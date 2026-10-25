// Bakes real elevation for the Putorana scenes into heightmap PNGs the film loads at build time.
//
//   node tools/bake-terrain.mjs            # writes assets/terrain/*.png + terrain.json
//
// Source: AWS Terrain Tiles (Mapzen "terrarium" encoding, https://registry.opendata.aws/terrain-tiles/),
// Web Mercator tiles resampled onto a local east/south metric grid (metres) around ORIGIN.
// Each output pixel stores elevation as round((h + 100) * 20): R = high byte, G = low byte (5 cm steps).
// Tiles are cached outside the repo; rendering never touches the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "./png.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "assets", "terrain");
const CACHE = path.join(os.tmpdir(), "norilsk-putorana-tiles");

// Local frame: x = metres east, z = metres south of ORIGIN (the west foot of the Lama massif).
export const ORIGIN = { lon: 89.97, lat: 69.38 };
const latR = (ORIGIN.lat * Math.PI) / 180;
export const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * latR) + 1.175 * Math.cos(4 * latR);
export const M_PER_DEG_LON = 111412.84 * Math.cos(latR) - 93.5 * Math.cos(3 * latR) + 0.118 * Math.cos(5 * latR);

const REGIONS = JSON.parse(process.env.REGIONS ?? "null") ?? {
  // the flight path: city lowland, the west face, the valley and the south ridge
  near: { x0: -6000, z0: -3000, dx: 12.5, nx: 1040, nz: 960, zoom: 12 },
  // what the reveal looks over: the escarpment, the frozen lake and the mesas beyond
  mid: { x0: -8000, z0: -10000, dx: 25, nx: 1280, nz: 1280, zoom: 12 },
  // the plateau to the horizon
  far: { x0: -40000, z0: -51200, dx: 100, nx: 1024, nz: 1024, zoom: 10 },
};

function lonLatAt(x, z) {
  return { lon: ORIGIN.lon + x / M_PER_DEG_LON, lat: ORIGIN.lat - z / M_PER_DEG_LAT };
}

function mercPx(lon, lat, zoom) {
  const n = 256 * 2 ** zoom;
  const r = (lat * Math.PI) / 180;
  return { X: ((lon + 180) / 360) * n, Y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

async function fetchTile(z, x, y) {
  fs.mkdirSync(CACHE, { recursive: true });
  const fn = path.join(CACHE, `${z}_${x}_${y}.png`);
  if (!fs.existsSync(fn)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        fs.writeFileSync(fn, Buffer.from(await res.arrayBuffer()));
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    if (lastErr) throw lastErr;
  }
  const { rgb } = decodePNG(fs.readFileSync(fn));
  const e = new Float32Array(256 * 256);
  for (let i = 0; i < e.length; i++) e[i] = rgb[i * 3] * 256 + rgb[i * 3 + 1] + rgb[i * 3 + 2] / 256 - 32768;
  return e;
}

// The coarse tiles carry a few single-pixel spikes (one reads 2.7 km on a 1.3 km plateau):
// replace any sample that sits far off its 3x3 median, until none are left.
function despike(H, nx, nz, limit) {
  let fixed = 0;
  const w = new Float32Array(9);
  for (let pass = 0; pass < 4; pass++) {
    let n = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let k = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++)
            w[k++] = H[Math.min(nz - 1, Math.max(0, j + dj)) * nx + Math.min(nx - 1, Math.max(0, i + di))];
        w.sort();
        const med = w[4];
        if (Math.abs(H[j * nx + i] - med) > limit) {
          H[j * nx + i] = med;
          n++;
        }
      }
    }
    fixed += n;
    if (!n) break;
  }
  return fixed;
}

async function bake(name, R) {
  // which tiles does the region touch?
  const corners = [lonLatAt(R.x0, R.z0), lonLatAt(R.x0 + R.dx * (R.nx - 1), R.z0 + R.dx * (R.nz - 1))];
  const a = mercPx(corners[0].lon, corners[0].lat, R.zoom), b = mercPx(corners[1].lon, corners[1].lat, R.zoom);
  const tx0 = Math.floor(a.X / 256) - 1, ty0 = Math.floor(a.Y / 256) - 1;
  const tx1 = Math.floor(b.X / 256) + 1, ty1 = Math.floor(b.Y / 256) + 1;
  const tiles = new Map();
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(async ([tx, ty]) => tiles.set(`${tx},${ty}`, await fetchTile(R.zoom, tx, ty))));
  }
  const at = (X, Y) => {
    const tx = Math.floor(X / 256), ty = Math.floor(Y / 256);
    const t = tiles.get(`${tx},${ty}`);
    return t[(Y - ty * 256) * 256 + (X - tx * 256)];
  };
  const H = new Float32Array(R.nx * R.nz);
  for (let j = 0; j < R.nz; j++) {
    for (let i = 0; i < R.nx; i++) {
      const { lon, lat } = lonLatAt(R.x0 + i * R.dx, R.z0 + j * R.dx);
      const { X, Y } = mercPx(lon, lat, R.zoom);
      const fx = X - 0.5, fy = Y - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0;
      H[j * R.nx + i] = (at(x0, y0) * (1 - u) + at(x0 + 1, y0) * u) * (1 - v) + (at(x0, y0 + 1) * (1 - u) + at(x0 + 1, y0 + 1) * u) * v;
    }
  }
  const fixed = despike(H, R.nx, R.nz, 120);
  const out = Buffer.alloc(R.nx * R.nz * 3);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < H.length; k++) {
    const h = H[k];
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    const q = Math.max(0, Math.min(65535, Math.round((h + 100) * 20)));
    out[k * 3] = q >> 8;
    out[k * 3 + 1] = q & 255;
    out[k * 3 + 2] = 0;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const file = `${name}.png`;
  fs.writeFileSync(path.join(OUT, file), encodePNG(R.nx, R.nz, out));
  console.log(`${name}: ${R.nx}x${R.nz} @ ${R.dx} m, z${R.zoom}, ${jobs.length} tiles, ${fixed} spikes fixed, elevation ${lo.toFixed(0)}..${hi.toFixed(0)} m`);
  return { x0: R.x0, z0: R.z0, dx: R.dx, nx: R.nx, nz: R.nz, zoom: R.zoom, file: `assets/terrain/${file}` };
}

const meta = {
  source: "AWS Terrain Tiles (terrarium), https://registry.opendata.aws/terrain-tiles/",
  encoding: "h = (R*256 + G) / 20 - 100 metres",
  origin: ORIGIN,
  mPerDegLon: M_PER_DEG_LON,
  mPerDegLat: M_PER_DEG_LAT,
  regions: {},
};
for (const [name, R] of Object.entries(REGIONS)) meta.regions[name] = await bake(name, R);
fs.writeFileSync(path.join(OUT, "terrain.json"), JSON.stringify(meta, null, 2) + "\n");
// the film imports the same description as a module (no fetch at render time)
fs.writeFileSync(path.join(HERE, "..", "src", "terrain-meta.js"), `// Generated by tools/bake-terrain.mjs — do not edit.\nexport default ${JSON.stringify(meta, null, 2)};\n`);
console.log("wrote", path.join(OUT, "terrain.json"), "and src/terrain-meta.js");
