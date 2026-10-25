// Norilsk district layout: street network, perimeter blocks, the hero block with the archway.
// Pure data (no three.js) so the camera path and every builder agree on positions.
import { CITY } from "./config.js";
import { mulberry32 } from "./util.js";

export const ZA = CITY.avenueZ; // avenue centre line
export const FLOOR_H = 2.8;
export const BASE_H = 1.6; // ventilated crawlspace + plinth (the blocks stand on piles in permafrost)
export const PANEL_W = 3.2;

// hero geometry along the flight path (x grows to the east)
export const HERO = {
  crossX: -3457, // the cross street the avenue ends at
  archX0: -3434, // arch building, west face
  archX1: -3420,
  archZ0: ZA - 5,
  archZ1: ZA + 5,
  archTop: 7.6,
  yardX1: -3328, // courtyard's east edge = west face of the tall building the camera climbs
  eastX1: -3314,
  blockZ0: ZA - 130,
  blockZ1: ZA + 130,
  eastFloors: 12,
};

export function buildingHeight(floors) {
  return BASE_H + floors * FLOOR_H + 0.9; // parapet
}

// E-W streets (x-extent) and N-S streets (z-extent). w = half-width to the building line, lamp = lamp offset from centre
export function streets() {
  const [x0, z0, x1, z1] = CITY.rect;
  const ew = [], ns = [];
  ew.push({ z: ZA, a: x0 + 40, b: HERO.crossX, w: 22, lamp: 13.5, gap: 34, phase: 7, avenue: true });
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue;
    const z = ZA + k * 255;
    if (z < z0 + 40 || z > z1 - 40) continue;
    ew.push({ z, a: x0 + 40, b: x1 - 40, w: 15, lamp: 8, gap: 36, phase: (k * 13) % 36 });
  }
  for (let x = HERO.crossX - 165 * 20; x <= x1 - 40; x += 165) {
    if (x < x0 + 40) continue;
    const cross = x === HERO.crossX;
    ns.push({ x, a: z0 + 40, b: z1 - 40, w: cross ? 23 : 16, lamp: cross ? 12 : 8.5, gap: 36, phase: ((x / 165) | 0) * 7 });
  }
  return { ew, ns };
}

// Buildings: axis-aligned boxes. long = "x" (slab runs east-west) or "z".
// scheme: facade paint pattern; seed: per-building randomness; arch: cut a passage.
export function buildings() {
  const { ew, ns } = streets();
  const rnd = mulberry32(69);
  const list = [];
  const pickFloors = () => [5, 9, 9, 9, 10, 10, 12, 12][Math.floor(rnd() * 8)];
  const add = (b) => {
    b.seed = Math.floor(rnd() * 1e6);
    b.scheme = b.scheme ?? Math.floor(rnd() * 5);
    list.push(b);
  };
  const zs = ew.filter((s) => !s.avenue).map((s) => s.z).sort((a, b) => a - b);
  const zLines = [CITY.rect[1], ...zs, CITY.rect[3]];
  const xLines = [CITY.rect[0], ...ns.map((s) => s.x), CITY.rect[2]];
  const nsW = (x) => ns.find((s) => s.x === x)?.w ?? 0;

  const yards = [];
  for (let i = 0; i < xLines.length - 1; i++) {
    for (let j = 0; j < zLines.length - 1; j++) {
      const cx0 = xLines[i] + (nsW(xLines[i]) || 10), cx1 = xLines[i + 1] - (nsW(xLines[i + 1]) || 10);
      const cz0 = zLines[j] + 15, cz1 = zLines[j + 1] - 15;
      if (cx1 - cx0 < 60 || cz1 - cz0 < 60) continue;
      const westOfCross = cx1 <= HERO.crossX + 1;
      const heroCell = !westOfCross && cx0 < HERO.eastX1 + 1 && cx1 > HERO.archX0 - 1 && cz0 < ZA && cz1 > ZA;
      if (heroCell) {
        heroBlock(add, cx0, cx1, cz0, cz1);
        continue;
      }
      // cells the avenue runs through are split in two
      if (westOfCross && cz0 < ZA && cz1 > ZA) {
        perimeter(add, rnd, pickFloors, cx0, cx1, cz0, ZA - 22, "south");
        perimeter(add, rnd, pickFloors, cx0, cx1, ZA + 22, cz1, "north");
        yards.push([cx0, cx1, cz0, ZA - 22], [cx0, cx1, ZA + 22, cz1]);
      } else {
        perimeter(add, rnd, pickFloors, cx0, cx1, cz0, cz1);
        yards.push([cx0, cx1, cz0, cz1]);
      }
    }
  }
  // inside the yards: a kindergarten or a school, two or three floors. Own random stream and appended last,
  // so the slabs around them keep their floors, paint and roofs.
  const rin = mulberry32(1953);
  for (const [x0, x1, z0, z1] of yards) {
    const m = 13 + 18; // slab depth + a margin of open snow
    const ix0 = x0 + m, ix1 = x1 - m, iz0 = z0 + m, iz1 = z1 - m;
    const W = ix1 - ix0, Dz = iz1 - iz0;
    if (W < 40 || Dz < 40) continue;
    const alongZ = Dz >= W;
    const span = alongZ ? Dz : W, across = alongZ ? W : Dz;
    const count = span > 240 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const len = Math.min(span / count - 20, 45 + rin() * 35), dep = Math.min(across - 10, 14 + rin() * 6);
      const c0 = (alongZ ? iz0 : ix0) + (span / count) * (k + 0.5) + (rin() - 0.5) * (span / count - len) * 0.6;
      const c1 = (alongZ ? ix0 : iz0) + across / 2 + (rin() - 0.5) * (across - dep) * 0.6;
      const floors = rin() < 0.6 ? 2 : 3;
      const seed = Math.floor(rin() * 1e6), scheme = Math.floor(rin() * 5);
      const facing = alongZ ? (rin() < 0.5 ? "east" : "west") : rin() < 0.5 ? "north" : "south";
      if (alongZ) list.push({ x0: c1 - dep / 2, x1: c1 + dep / 2, z0: c0 - len / 2, z1: c0 + len / 2, long: "z", floors, facing, seed, scheme });
      else list.push({ x0: c0 - len / 2, x1: c0 + len / 2, z0: c1 - dep / 2, z1: c1 + dep / 2, long: "x", floors, facing, seed, scheme });
    }
  }
  return list;
}

// A closed perimeter of slabs around a yard, with corner gaps — Norilsk's wind-proof courtyards.
// avenueSide: which edge of this cell fronts the avenue (its street facade gets shop fronts)
function perimeter(add, rnd, pickFloors, x0, x1, z0, z1, avenueSide) {
  const D = 13;
  const slabRun = (a, b, fixed, along, facing) => {
    // one or two slabs along [a, b]
    const len = b - a;
    if (len < 40) return;
    if (len > 150 && rnd() < 0.8) {
      const cut = a + len * (0.4 + 0.2 * rnd());
      const g = 14 + rnd() * 8;
      slabRun(a, cut - g / 2, fixed, along, facing);
      slabRun(cut + g / 2, b, fixed, along, facing);
      return;
    }
    const floors = pickFloors();
    const shops = facing === avenueSide;
    if (along === "x") add({ x0: a, x1: b, z0: fixed, z1: fixed + D, long: "x", floors, facing, shops });
    else add({ x0: fixed, x1: fixed + D, z0: a, z1: b, long: "z", floors, facing, shops });
  };
  const cg = 12; // corner gaps
  slabRun(x0, x1, z0, "x", "north");
  slabRun(x0, x1, z1 - D, "x", "south");
  slabRun(z0 + D + cg, z1 - D - cg, x0, "z", "west");
  slabRun(z0 + D + cg, z1 - D - cg, x1 - D, "z", "east");
}

function heroBlock(add, cx0, cx1, cz0, cz1) {
  const H = HERO;
  // arch building: three boxes so the passage is a real hole; one seed so the facade lines up
  const archSeed = 1935;
  add({ x0: H.archX0, x1: H.archX1, z0: H.blockZ0, z1: H.archZ0, long: "z", floors: 10, scheme: 4, seed0: archSeed, uOrigin: H.blockZ0, part: "archNorth", facing: "west" });
  add({ x0: H.archX0, x1: H.archX1, z0: H.archZ1, z1: H.blockZ1, long: "z", floors: 10, scheme: 4, seed0: archSeed, uOrigin: H.blockZ0, part: "archSouth", facing: "west" });
  add({ x0: H.archX0, x1: H.archX1, z0: H.archZ0, z1: H.archZ1, long: "z", floors: 10, scheme: 4, seed0: archSeed, uOrigin: H.blockZ0, part: "archBridge", yFrom: H.archTop, facing: "west" });
  // the tall east building the camera climbs, and the yard's north/south sides
  add({ x0: H.yardX1, x1: H.eastX1, z0: H.blockZ0, z1: H.blockZ1, long: "z", floors: H.eastFloors, scheme: 2, part: "east", facing: "east" });
  add({ x0: H.archX1 + 12, x1: H.yardX1 - 12, z0: H.blockZ0, z1: H.blockZ0 + 13, long: "x", floors: 9, scheme: 0, facing: "north" });
  add({ x0: H.archX1 + 12, x1: H.yardX1 - 12, z0: H.blockZ1 - 13, z1: H.blockZ1, long: "x", floors: 9, scheme: 3, facing: "south" });
  // the rest of the cell, north and south of the hero block
  if (H.blockZ0 - cz0 > 60) add({ x0: cx0, x1: cx1, z0: cz0, z1: cz0 + 13, long: "x", floors: 9, facing: "north" });
  if (cz1 - H.blockZ1 > 60) add({ x0: cx0, x1: cx1, z0: cz1 - 13, z1: cz1, long: "x", floors: 10, facing: "south" });
}

// Lamps along every street: { x, z, h }
export function lamps() {
  const { ew, ns } = streets();
  const out = [];
  for (const s of ew)
    for (let x = s.a + s.phase; x <= s.b; x += s.gap) {
      out.push({ x, z: s.z - s.lamp, h: 9.5, dir: [0, 1] });
      out.push({ x: x + s.gap / 2, z: s.z + s.lamp, h: 9.5, dir: [0, -1] });
    }
  for (const s of ns)
    for (let z = s.a + s.phase; z <= s.b; z += s.gap) {
      out.push({ x: s.x - s.lamp, z, h: 9.5, dir: [1, 0] });
      out.push({ x: s.x + s.lamp, z: z + s.gap / 2, h: 9.5, dir: [-1, 0] });
    }
  return out;
}
