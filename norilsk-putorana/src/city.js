// The Norilsk district: painted panel blocks on piles, lit windows, stairwells, shop fronts, the archway,
// snowy streets with sodium lamps. Facades are one merged mesh; every window is drawn by the shader.
import * as THREE from "three";
import { GLSL_NOISE, mulberry32 } from "./util.js";
import { SKY_GLSL, skyUniforms } from "./sky.js";
import { LIGHT, CITY } from "./config.js";
import { buildings, buildingHeight, streets, lamps, HERO, ZA, FLOOR_H, BASE_H, PANEL_W } from "./layout.js";

// Norilsk paint: saturated, a little chalky (sRGB hex → linear in the shader uniform)
const PALETTE = ["#c23b30", "#e07b29", "#e8b43a", "#efd45a", "#3e9b5c", "#1e8c88", "#3e86c6", "#2f4fa8", "#7a4fa3", "#d86a8e", "#b9bab4", "#dcdcd6"];

export const cityUniforms = {
  uG: { value: 0 },
  uPalette: { value: PALETTE.map((h) => new THREE.Color(h)) }, // THREE.Color(hex) is linear in r152+
  uEW: { value: [] },
  uEWg: { value: [] },
  uNEW: { value: 0 },
  uNS: { value: [] },
  uNSg: { value: [] },
  uNNS: { value: 0 },
  uLampCol: { value: new THREE.Color(1.0, 0.5, 0.18).multiplyScalar(70) },
  uYard: { value: [] }, // hero yard lamps: x, y, z, intensity
  uNYard: { value: 0 },
  uMoonCity: { value: LIGHT.moonColor.clone().multiplyScalar(0.16) },
  uAmbCity: { value: new THREE.Color(0.011, 0.014, 0.026) },
  uBounce: { value: new THREE.Color(0.03, 0.016, 0.007) },
  // open snow (yards, streets, roofs) takes the same moon and sky as the plateau around the town
  uMoonSnow: { value: LIGHT.moonColor.clone().multiplyScalar(LIGHT.moonIntensity) },
  uAmbSnow: { value: LIGHT.ambientSky.clone() },
  tMoonSh: { value: null }, // the blocks' moon shadows on the ground, baked in buildCity
  uShRect: { value: new THREE.Vector4() },
};

export const LIGHTS_GLSL = /* glsl */ `
uniform float uG;
uniform vec4 uEW[10];
uniform vec4 uEWg[10];
uniform int uNEW;
uniform vec4 uNS[24];
uniform vec4 uNSg[24];
uniform int uNNS;
uniform vec3 uLampCol;
uniform vec4 uYard[32];
uniform int uNYard;

// sodium street lamps: poles every gap metres on both sides; heads 9.5 m up, 1.5 m over the road.
// gloss > 0 also returns their reflections in polished snow seen along V (Blinn-Phong exponent gloss)
vec3 streetLamps(vec3 P, vec3 N, vec3 V, float gloss, out vec3 spec) {
  vec3 sum = vec3(0.0);
  float sp = 0.0;
  for (int i = 0; i < 10; i++) {
    if (i >= uNEW) break;
    vec4 s = uEW[i]; vec4 g = uEWg[i];
    if (abs(P.z - s.x) > 70.0 || P.x < s.y - 40.0 || P.x > s.z + 40.0) continue;
    for (int side = 0; side < 2; side++) {
      float zl = side == 0 ? s.x - s.w : s.x + s.w;
      float off = s.y + g.y + (side == 0 ? 0.0 : g.x * 0.5);
      float n0 = floor((P.x - off) / g.x);
      for (int k = -1; k <= 2; k++) {
        float xl = off + (n0 + float(k)) * g.x;
        if (xl < s.y || xl > s.z) continue;
        vec3 L = vec3(xl, uG + 9.5, zl) - P;
        float d2 = dot(L, L);
        vec3 l = L * inversesqrt(d2);
        float e = (0.12 + 0.88 * smoothstep(0.05, 0.6, l.y)) / (d2 + 6.0);
        sum += max(dot(N, l), 0.0) * e;
        if (gloss > 0.0) sp += pow(max(dot(N, normalize(l - V)), 0.0), gloss) * e;
      }
    }
  }
  for (int i = 0; i < 24; i++) {
    if (i >= uNNS) break;
    vec4 s = uNS[i]; vec4 g = uNSg[i];
    if (abs(P.x - s.x) > 70.0 || P.z < s.y - 40.0 || P.z > s.z + 40.0) continue;
    for (int side = 0; side < 2; side++) {
      float xl = side == 0 ? s.x - s.w : s.x + s.w;
      float off = s.y + g.y + (side == 0 ? 0.0 : g.x * 0.5);
      float n0 = floor((P.z - off) / g.x);
      for (int k = -1; k <= 2; k++) {
        float zl = off + (n0 + float(k)) * g.x;
        if (zl < s.y || zl > s.z) continue;
        vec3 L = vec3(xl, uG + 9.5, zl) - P;
        float d2 = dot(L, L);
        vec3 l = L * inversesqrt(d2);
        float e = (0.12 + 0.88 * smoothstep(0.05, 0.6, l.y)) / (d2 + 6.0);
        sum += max(dot(N, l), 0.0) * e;
        if (gloss > 0.0) sp += pow(max(dot(N, normalize(l - V)), 0.0), gloss) * e;
      }
    }
  }
  spec = sp * uLampCol;
  return sum * uLampCol;
}
vec3 streetLight(vec3 P, vec3 N) {
  vec3 spec;
  return streetLamps(P, N, vec3(0.0), 0.0, spec);
}
// how much lamp light reaches a point in the air (for ice crystals and plumes), no surface orientation
float lampAir(vec3 P) {
  float sum = 0.0;
  for (int i = 0; i < 10; i++) {
    if (i >= uNEW) break;
    vec4 s = uEW[i]; vec4 g = uEWg[i];
    if (abs(P.z - s.x) > 50.0 || P.x < s.y - 30.0 || P.x > s.z + 30.0) continue;
    for (int side = 0; side < 2; side++) {
      float zl = side == 0 ? s.x - s.w : s.x + s.w;
      float off = s.y + g.y + (side == 0 ? 0.0 : g.x * 0.5);
      float n0 = floor((P.x - off) / g.x);
      for (int k = 0; k <= 1; k++) {
        vec3 L = vec3(off + (n0 + float(k)) * g.x, uG + 9.5, zl) - P;
        sum += 1.0 / (dot(L, L) + 4.0);
      }
    }
  }
  for (int i = 0; i < 24; i++) {
    if (i >= uNNS) break;
    vec4 s = uNS[i]; vec4 g = uNSg[i];
    if (abs(P.x - s.x) > 50.0 || P.z < s.y - 30.0 || P.z > s.z + 30.0) continue;
    for (int side = 0; side < 2; side++) {
      float xl = side == 0 ? s.x - s.w : s.x + s.w;
      float off = s.y + g.y + (side == 0 ? 0.0 : g.x * 0.5);
      float n0 = floor((P.z - off) / g.x);
      for (int k = 0; k <= 1; k++) {
        vec3 L = vec3(xl, uG + 9.5, off + (n0 + float(k)) * g.x) - P;
        sum += 1.0 / (dot(L, L) + 4.0);
      }
    }
  }
  return sum;
}
// porch lamps over the entrances in the hero yard, and the lamp in the archway
vec3 yardLight(vec3 P, vec3 N) {
  vec3 sum = vec3(0.0);
  if (P.x < ${HERO.archX0 - 30}.0 || P.x > ${HERO.eastX1 + 10}.0 || P.z < ${HERO.blockZ0 - 10}.0 || P.z > ${HERO.blockZ1 + 10}.0) return sum;
  for (int i = 0; i < 32; i++) {
    if (i >= uNYard) break;
    vec3 L = uYard[i].xyz - P;
    float d2 = dot(L, L);
    sum += uYard[i].w * max(dot(N, L * inversesqrt(d2)), 0.0) / (d2 + 1.5);
  }
  return sum * vec3(1.0, 0.72, 0.42);
}`;

// open snow under the moon (facades and ground only; needs SKY_GLSL for uMoonDir)
const SNOW_GLSL = /* glsl */ `
uniform vec3 uMoonSnow, uAmbSnow;
uniform sampler2D tMoonSh;
uniform vec4 uShRect;
// moonlight reaching the ground between the blocks
float moonVis(vec3 P) { return 1.0 - texture2D(tMoonSh, (P.xz - uShRect.xy) * uShRect.zw).r; }
`;

const FACADE_VERT = /* glsl */ `
attribute vec2 aUV;
attribute vec4 aInfo;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUV;
varying vec4 vInfo;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normal;
  vUV = aUV;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// kinds: 0 street facade, 5 yard facade (entrances + stairwells), 6 avenue facade (shop fronts),
// 1 end wall, 2 roof, 3 archway, 4 roof machine room
const FACADE_FRAG = /* glsl */ `
uniform vec3 uPalette[12];
uniform vec3 uMoonCity, uAmbCity, uBounce;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUV;
varying vec4 vInfo;

float boxAA(float x, float a, float b, float fw) { return clamp(min(x - a, b - x) / max(fw, 1e-4) + 0.5, 0.0, 1.0); }

vec3 paintOf(float scheme, float seed, float pc, float fl, float u, float floors) {
  float c0 = mod(seed, 10.0), c1 = mod(seed * 7.0 + 3.0, 10.0), c2 = mod(seed * 13.0 + 5.0, 10.0);
  float idx;
  if (scheme < 0.5) idx = mod(floor(u / 19.2), 3.0);                    // sections
  else if (scheme < 1.5) idx = mod(floor(fl / 3.0), 2.0) * 2.0;          // bands
  else if (scheme < 2.5) idx = floor(hash12(vec2(pc, fl) + seed) * 3.0); // mosaic
  else if (scheme < 3.5) idx = 0.0;                                       // solid
  else {                                                                  // rainbow
    float h = fract(pc / 24.0 + seed * 0.01);
    int k = int(h * 6.0);
    vec3 a = k == 0 ? uPalette[0] : k == 1 ? uPalette[1] : k == 2 ? uPalette[2] : k == 3 ? uPalette[4] : k == 4 ? uPalette[6] : uPalette[8];
    return a;
  }
  float ci = idx < 0.5 ? c0 : idx < 1.5 ? c1 : c2;
  int ii = int(ci);
  vec3 c = uPalette[0];
  for (int i = 1; i < 12; i++) if (i == ii) c = uPalette[i];
  return c;
}

void main() {
  vec3 N = normalize(vN);
  // per-building constants arrive as varyings: round them, or float drift scrambles every hash per pixel
  float seed = floor(vInfo.x + 0.5), floors = floor(vInfo.y + 0.5), scheme = floor(vInfo.z + 0.5), kind = floor(vInfo.w + 0.5);
  float u = vUV.x, v = vUV.y;
  vec3 V = normalize(vWorld - cameraPosition);
  float dist = length(vWorld - cameraPosition);
  vec3 T = abs(N.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);

  float fwu = fwidth(u), fwv = fwidth(v);
  vec3 alb = vec3(0.5);
  vec3 emit = vec3(0.0);
  float spec = 0.0;

  if (kind > 1.5 && kind < 2.5) {
    // roof: wind-packed snow
    float rn = vnoise(vWorld.xz * 0.4) * 0.6 + vnoise(vWorld.xz * 2.3) * 0.4;
    alb = vec3(0.8, 0.84, 0.92) * (0.86 + 0.14 * rn);
  } else if (kind > 3.5 && kind < 4.5) {
    alb = vec3(0.32, 0.31, 0.3) * (v > 0.0 ? 1.0 : 1.0);
  } else if (kind > 2.5 && kind < 3.5) {
    // archway: painted plaster, tiled skirting
    alb = v < 1.0 ? vec3(0.18, 0.17, 0.16) : vec3(0.62, 0.5, 0.36);
  } else {
    float top = ${BASE_H.toFixed(2)} + floors * ${FLOOR_H.toFixed(2)};
    float fl = floor((v - ${BASE_H.toFixed(2)}) / ${FLOOR_H.toFixed(2)});
    float yi = v - ${BASE_H.toFixed(2)} - fl * ${FLOOR_H.toFixed(2)};
    float pc = floor(u / ${PANEL_W.toFixed(2)});
    float xi = u - pc * ${PANEL_W.toFixed(2)};
    vec3 paint = paintOf(scheme, seed, pc, fl, u, floors);
    paint = mix(vec3(dot(paint, vec3(0.3, 0.55, 0.15))), paint, 0.82);
    if (v < ${BASE_H.toFixed(2)}) {
      // plinth over the piles: dark concrete, a vent every panel
      alb = vec3(0.09, 0.09, 0.095);
      float vent = boxAA(xi, 1.3, 1.9, fwu) * boxAA(v, 0.5, 0.9, fwv);
      alb = mix(alb, vec3(0.02), vent);
    } else if (v > top) {
      alb = paint * 0.8; // parapet
    } else if (kind > 0.5 && kind < 1.5) {
      // end wall: blank painted panels with joints
      alb = paint;
      float joint = 1.0 - boxAA(fract(v / ${FLOOR_H.toFixed(2)}), 0.02, 0.98, fwv / ${FLOOR_H.toFixed(2)});
      alb *= 1.0 - 0.25 * joint;
    } else {
      bool yard = kind > 4.5 && kind < 5.5;
      bool shops = kind > 5.5 && fl < 0.5;
      // stairwell: one column per 6-panel section on the yard side, windows at half-floor heights
      float sec = floor(u / 19.2);
      float uc = (sec + 0.5) * 19.2;
      bool stair = yard && abs(u - uc) < 1.6;
      float wx0 = 0.85, wx1 = 2.35, wy0 = 0.85, wy1 = 2.3;
      float cellX = pc, cellY = fl;
      float lx = xi, ly = yi;
      if (stair) {
        lx = u - (uc - 1.6);
        float yh = v - ${BASE_H.toFixed(2)} - ${(FLOOR_H / 2).toFixed(2)};
        float fh = floor(yh / ${FLOOR_H.toFixed(2)});
        ly = yh - fh * ${FLOOR_H.toFixed(2)};
        cellY = fh + 100.0;
        wx0 = 0.9; wx1 = 2.3; wy0 = 0.9; wy1 = 2.0;
      }
      if (shops) { wx0 = 0.25; wx1 = 2.95; wy0 = 0.35; wy1 = 2.55; }
      float inWin = boxAA(lx, wx0, wx1, fwu) * boxAA(ly, wy0, wy1, fwv);
      float frame = boxAA(lx, wx0 - 0.06, wx1 + 0.06, fwu) * boxAA(ly, wy0 - 0.06, wy1 + 0.06, fwv) - inWin;
      float sill = boxAA(lx, wx0 - 0.1, wx1 + 0.1, fwu) * boxAA(ly, wy0 - 0.2, wy0 - 0.09, fwv);
      // scheme 3 paints a white surround around each window
      float surround = scheme > 2.5 && scheme < 3.5 ? boxAA(lx, wx0 - 0.35, wx1 + 0.35, fwu) * boxAA(ly, wy0 - 0.3, wy1 + 0.3, fwv) : 0.0;
      alb = mix(paint, vec3(0.78, 0.78, 0.74), surround);
      // panel joints
      float jx = 1.0 - boxAA(xi, 0.03, ${(PANEL_W - 0.03).toFixed(2)}, fwu);
      float jy = 1.0 - boxAA(yi, 0.03, ${(FLOOR_H - 0.03).toFixed(2)}, fwv);
      alb *= 1.0 - 0.3 * max(jx, jy);
      alb = mix(alb, vec3(0.6, 0.6, 0.58), clamp(frame, 0.0, 1.0));
      alb = mix(alb, vec3(0.85, 0.88, 0.94), sill * 0.9);

      // window light: per window, seeded
      float h = hash12(vec2(cellX * 1.31 + seed, cellY * 2.17 - seed * 0.1));
      float h2 = hash12(vec2(cellY * 3.7 + seed * 0.3, cellX * 0.73));
      float lit = stair ? step(0.12, h) : shops ? 1.0 : step(h, 0.52);
      vec3 warm = mix(vec3(1.0, 0.42, 0.13), vec3(1.0, 0.64, 0.32), h2);
      vec3 cool = vec3(0.7, 0.82, 1.0);
      vec3 E = h2 > 0.86 ? cool : warm;
      if (stair) E = mix(vec3(0.85, 1.0, 0.8), warm, step(0.5, h2));
      if (shops) E = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.8, 0.55), step(0.5, h2)) * 1.4;
      float lum = (stair ? 1.3 : 1.7) * (0.5 + 0.9 * fract(h * 7.31));
      // close up: a room behind the glass (parallax back wall, ceiling lamp, curtains)
      if (lit > 0.5 && dist < 220.0 && inWin > 0.0) {
        vec2 w = vec2((lx - (wx0 + wx1) * 0.5) / ((wx1 - wx0) * 0.5), (ly - (wy0 + wy1) * 0.5) / ((wy1 - wy0) * 0.5));
        float vz = max(-dot(V, N), 0.05);
        vec2 vt = vec2(dot(V, T), dot(V, vec3(0.0, 1.0, 0.0)));
        // the room only reads face-on; at grazing angles it would alias into stripes
        vec2 back = w + clamp(vt / vz, -1.5, 1.5) * 0.7 * smoothstep(0.2, 0.5, vz);
        float room = 1.0 - 0.45 * smoothstep(0.5, 1.7, length(back * vec2(0.75, 1.0)));
        float lamp = exp(-dot(back - vec2(0.0, 0.8), back - vec2(0.0, 0.8)) * 2.5);
        vec3 tint = mix(vec3(1.0), uPalette[int(mod(h2 * 40.0, 10.0))] * 1.6, step(0.45, fract(h2 * 13.0)));
        float curtain = smoothstep(0.5, 0.72, abs(w.x));
        E *= room * (0.7 + 0.7 * lamp) * mix(vec3(1.0), tint * 0.7, curtain);
      }
      vec3 glass = vec3(0.02, 0.025, 0.04);
      float far = smoothstep(0.35, 1.1, max(fwu, fwv));      // windows smaller than a pixel: use the average
      float avgLit = stair ? 0.88 : shops ? 1.0 : 0.52;
      vec3 winCol = mix(glass * 0.6, E * lum, lit);
      vec3 avgCol = mix(glass * 0.6, warm * 2.6, avgLit);
      winCol = mix(winCol, avgCol, far);
      float cover = mix(inWin, 0.24, far);
      emit = winCol * cover;
      alb *= 1.0 - cover;
      spec = cover * (1.0 - lit) * (1.0 - far);
      // shop sign: a green pharmacy cross on some shop fronts
      if (shops && hash12(vec2(sec, seed)) > 0.7) {
        vec2 q = vec2(u - uc, v - 3.75);
        float cross = max(boxAA(q.x, -0.18, 0.18, fwu) * boxAA(q.y, -0.55, 0.55, fwv), boxAA(q.x, -0.55, 0.55, fwu) * boxAA(q.y, -0.18, 0.18, fwv));
        emit = mix(emit, vec3(0.1, 1.0, 0.3) * 6.0, cross);
      }
      // entrance on the yard side: door, and a bulb over it
      if (yard && abs(u - uc) < 0.8 && v < 3.6) { alb = vec3(0.22, 0.12, 0.07); emit = vec3(0.0); }
      if (yard) emit += vec3(1.0, 0.75, 0.45) * 30.0 * smoothstep(0.35, 0.0, length(vec2(u - uc, v - 3.85)));
    }
  }

  vec3 light = streetLight(vWorld, N) + yardLight(vWorld, N);
  light += uMoonCity * max(dot(N, uMoonDir), 0.0);
  light += uAmbCity * (0.5 + 0.5 * N.y);
  light += uBounce * clamp(1.0 - (vWorld.y - uG) / 45.0, 0.0, 1.0) * (1.0 - max(N.y, 0.0));
  // roofs are open to the sky: lit like the snow on the plateau
  if (kind > 1.5 && kind < 2.5) light = uMoonSnow * max(dot(N, uMoonDir), 0.0) + uAmbSnow + uDomeCol * uDome * 0.2;
  vec3 col = alb * light + emit;
  // dark glass mirrors the sky and the amber street
  col += spec * (vec3(0.03, 0.04, 0.08) + vec3(0.25, 0.12, 0.04) * pow(1.0 - max(-dot(V, N), 0.0), 3.0));
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

const GROUND_FRAG = /* glsl */ `
varying vec3 vWorld;

// wheel tracks worn into a street's packed snow. c: offset from the centre line, a: distance along it,
// hw: half-width of the carriageway, fw: pixel footprint across the street
float wheelTracks(float c, float a, float hw, float sd, float fw) {
  float ac = abs(c) + 0.35 * (vnoise(vec2(a * 0.02, sd)) - 0.5);
  float lane = ac / 3.5;
  float x = fract(lane);
  float t = exp(-pow((x - 0.27) * 9.0, 2.0)) + exp(-pow((x - 0.73) * 9.0, 2.0));
  t = mix(t, 0.4, smoothstep(0.12, 0.45, fw));                          // too fine to resolve: the average
  t *= 1.0 - smoothstep(hw - 3.2, hw - 1.2, ac);                        // kerbside parking: no traffic
  t *= 0.3 + 0.7 * smoothstep(0.2, 0.7, vnoise(vec2(a * 0.018 + floor(lane) * 3.1, sd * 1.7)));  // fresh snow over some stretches
  return t;
}

void main() {
  vec3 P = vWorld;
  float dist = length(P - cameraPosition);
  float fwx = fwidth(P.x), fwz = fwidth(P.z);
  // streets: packed snow with wheel tracks; everything else soft snow
  float road = 0.0, ruts = 0.0;
  for (int i = 0; i < 10; i++) {
    if (i >= uNEW) break;
    vec4 s = uEW[i];
    if (P.x < s.y - 10.0 || P.x > s.z + 10.0) continue;
    float hw = uEWg[i].z, d = P.z - s.x;
    float r = 1.0 - smoothstep(hw - 0.6, hw + 0.6, abs(d));
    road = max(road, r);
    if (r > 0.0) ruts = max(ruts, r * wheelTracks(d, P.x, hw, s.x * 0.013, fwz));
  }
  for (int i = 0; i < 24; i++) {
    if (i >= uNNS) break;
    vec4 s = uNS[i];
    if (P.z < s.y - 10.0 || P.z > s.z + 10.0) continue;
    float hw = uNSg[i].z, d = P.x - s.x;
    float r = 1.0 - smoothstep(hw - 0.6, hw + 0.6, abs(d));
    road = max(road, r);
    if (r > 0.0) ruts = max(ruts, r * wheelTracks(d, P.z, hw, s.x * 0.013, fwx));
  }
  // drifted snow off the roads: low swells and wind ripples that the low moon picks out
  float n = vnoise(P.xz * 0.35) * 0.5 + vnoise(P.xz * 1.7) * 0.5;
  float h0 = vnoise(P.xz * 0.07);
  vec2 grad = vec2(vnoise(P.xz * 0.07 + vec2(0.07, 0.0)) - h0, vnoise(P.xz * 0.07 + vec2(0.0, 0.07)) - h0) * 3.0;
  float w = dot(P.xz, vec2(0.8, 0.6));
  grad += vec2(0.8, 0.6) * cos(w * 1.3 + vnoise(P.xz * 0.12) * 9.0) * 0.07 * (1.0 - smoothstep(0.08, 0.3, max(fwx, fwz)));
  grad *= 1.0 - road;
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec3 snow = vec3(0.8, 0.84, 0.92) * (0.9 + 0.1 * n);
  vec3 packed = vec3(0.5, 0.49, 0.48) * (0.85 + 0.3 * n);  // packed and greyed by exhaust
  vec3 slush = vec3(0.2, 0.18, 0.16);
  vec3 alb = mix(snow, packed, road);
  alb = mix(alb, slush, ruts * 0.5);
  vec3 gloss;
  vec3 light = streetLamps(P, N, normalize(P - cameraPosition), 90.0, gloss) + yardLight(P, N);
  light += uMoonSnow * max(dot(N, uMoonDir), 0.0) * moonVis(P);
  light += uAmbSnow * 0.7 + uDomeCol * uDome * 0.2;
  // the tracks are polished to ice: the lamps smear across them
  vec3 col = alb * light + gloss * road * (0.15 + 0.85 * ruts) * 1.2;
  // sparkle in the lamp light
  float sp = step(0.996, hash12(floor(P.xz * 6.0))) * (1.0 - smoothstep(10.0, 60.0, dist));
  col += sp * light * 0.6;
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

// convex hull of 2D points, counter-clockwise (monotone chain)
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function buildCity(TD) {
  const G = TD.cityGround;
  const U = cityUniforms;
  U.uG.value = G;
  const { ew, ns } = streets();
  // per street: (centre, from, to, lamp-head offset) and (lamp gap, phase, road half-width, -)
  // poles stand at ±lamp from the centre line; heads reach 1.5 m over the road; the road ends 1 m before the poles
  U.uEW.value = Array.from({ length: 10 }, (_, i) => (ew[i] ? new THREE.Vector4(ew[i].z, ew[i].a, ew[i].b, ew[i].lamp - 1.5) : new THREE.Vector4()));
  U.uEWg.value = Array.from({ length: 10 }, (_, i) => (ew[i] ? new THREE.Vector4(ew[i].gap, ew[i].phase, ew[i].lamp - 1, 0) : new THREE.Vector4(1, 0, 0, 0)));
  U.uNEW.value = ew.length;
  U.uNS.value = Array.from({ length: 24 }, (_, i) => (ns[i] ? new THREE.Vector4(ns[i].x, ns[i].a, ns[i].b, ns[i].lamp - 1.5) : new THREE.Vector4()));
  U.uNSg.value = Array.from({ length: 24 }, (_, i) => (ns[i] ? new THREE.Vector4(ns[i].gap, ns[i].phase, ns[i].lamp - 1, 0) : new THREE.Vector4(1, 0, 0, 0)));
  U.uNNS.value = ns.length;

  const list = buildings();
  // the blocks' shadows on the snow under the low moon, baked once: each box sweeps a hexagon away from
  // the moon. 1 m texels, edges anti-aliased by the distance to the hexagon's sides.
  {
    const [sx0, sz0, sx1, sz1] = CITY.rect;
    const nw = sx1 - sx0, nd = sz1 - sz0;
    const data = new Uint8Array(nw * nd);
    const md = LIGHT.moonDir, mh = Math.hypot(md.x, md.z);
    const ax = -md.x / mh, az = -md.z / mh, run = mh / md.y; // away from the moon; shadow length per metre of height
    for (const b of list) {
      const L = buildingHeight(b.floors) * run;
      const c = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
      const hull = convexHull([...c, ...c.map(([x, z]) => [x + ax * L, z + az * L])]);
      // inward edge normals: inside where nx*x + nz*z + k >= 0
      const edges = hull.map((p, i) => {
        const q = hull[(i + 1) % hull.length];
        const ex = q[0] - p[0], ez = q[1] - p[1], l = Math.hypot(ex, ez);
        return [-ez / l, ex / l, (ez * p[0] - ex * p[1]) / l];
      });
      const xs = hull.map((p) => p[0]), zs = hull.map((p) => p[1]);
      const i0 = Math.max(0, Math.floor(Math.min(...xs) - sx0 - 1)), i1 = Math.min(nw, Math.ceil(Math.max(...xs) - sx0 + 1));
      const j0 = Math.max(0, Math.floor(Math.min(...zs) - sz0 - 1)), j1 = Math.min(nd, Math.ceil(Math.max(...zs) - sz0 + 1));
      for (let j = j0; j < j1; j++) {
        const pz = sz0 + j + 0.5;
        for (let i = i0; i < i1; i++) {
          const px = sx0 + i + 0.5;
          let d = Infinity;
          for (const e of edges) d = Math.min(d, e[0] * px + e[1] * pz + e[2]);
          if (d <= -0.5) continue;
          const v = Math.min(255, Math.round((d + 0.5) * 255));
          if (v > data[j * nw + i]) data[j * nw + i] = v;
        }
      }
    }
    const tex = new THREE.DataTexture(data, nw, nd, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    U.tMoonSh.value = tex;
    U.uShRect.value.set(sx0, sz0, 1 / nw, 1 / nd);
  }
  const pos = [], nor = [], uv = [], info = [];
  const yardLamps = [];
  const rnd = mulberry32(7);
  const quad = (a, b, c, d, n, uva, uvb, uvc, uvd, inf) => {
    for (const [p, t] of [[a, uva], [b, uvb], [c, uvc], [a, uva], [c, uvc], [d, uvd]]) {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
      uv.push(t[0], t[1]);
      info.push(...inf);
    }
  };
  const yardDir = { north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0] };
  for (const b of list) {
    const seed = (b.seed0 ?? b.seed) % 997;
    const top = buildingHeight(b.floors);
    const y0 = G + (b.yFrom ?? 0), y1 = G + top;
    const v0 = b.yFrom ?? 0, v1 = top;
    const uo = b.uOrigin ?? (b.long === "x" ? b.x0 : b.z0);
    const yd = yardDir[b.facing] ?? [0, 0, 0];
    const kindFor = (n) => {
      const along = (b.long === "x" && n[2] !== 0) || (b.long === "z" && n[0] !== 0);
      if (!along) return 1;
      const intoYard = n[0] === yd[0] && n[2] === yd[2];
      if (intoYard) return 5;
      return b.shops ? 6 : 0;
    };
    const inf = (k) => [seed, b.floors, b.scheme, k];
    // walls: each wall's u runs along the building
    const walls = [
      { n: [0, 0, -1], a: [b.x1, y0, b.z0], bb: [b.x0, y0, b.z0], c: [b.x0, y1, b.z0], d: [b.x1, y1, b.z0], ua: b.x1, ub: b.x0 },
      { n: [0, 0, 1], a: [b.x0, y0, b.z1], bb: [b.x1, y0, b.z1], c: [b.x1, y1, b.z1], d: [b.x0, y1, b.z1], ua: b.x0, ub: b.x1 },
      { n: [-1, 0, 0], a: [b.x0, y0, b.z0], bb: [b.x0, y0, b.z1], c: [b.x0, y1, b.z1], d: [b.x0, y1, b.z0], ua: b.z0, ub: b.z1 },
      { n: [1, 0, 0], a: [b.x1, y0, b.z1], bb: [b.x1, y0, b.z0], c: [b.x1, y1, b.z0], d: [b.x1, y1, b.z1], ua: b.z1, ub: b.z0 },
    ];
    for (const w of walls) {
      let k = kindFor(w.n);
      // the archway: the bridge has no end walls; the side parts' walls facing the passage are tunnel walls
      if (b.part === "archBridge" && k === 1) continue;
      const isTunnelWall = (b.part === "archNorth" && w.n[2] === 1) || (b.part === "archSouth" && w.n[2] === -1);
      const ua = w.ua - uo, ub = w.ub - uo;
      if (isTunnelWall) {
        const ym = G + HERO.archTop;
        quad(w.a, w.bb, [w.bb[0], ym, w.bb[2]], [w.a[0], ym, w.a[2]], w.n, [ua, v0], [ub, v0], [ub, HERO.archTop], [ua, HERO.archTop], inf(3));
        continue;
      }
      quad(w.a, w.bb, w.c, w.d, w.n, [ua, v0], [ub, v0], [ub, v1], [ua, v1], inf(k));
    }
    // roof
    quad([b.x0, y1, b.z0], [b.x0, y1, b.z1], [b.x1, y1, b.z1], [b.x1, y1, b.z0], [0, 1, 0], [0, 0], [0, 1], [1, 1], [1, 0], inf(2));
    // archway ceiling
    if (b.part === "archBridge") {
      const yc = G + HERO.archTop;
      quad([b.x0, yc, b.z0], [b.x1, yc, b.z0], [b.x1, yc, b.z1], [b.x0, yc, b.z1], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1], inf(3));
    }
    // a machine room per stair section on the roof
    const len = b.long === "x" ? b.x1 - b.x0 : b.z1 - b.z0;
    if (!b.part || b.part === "east") {
      for (let s = 9.6; s < len - 5; s += 19.2) {
        if (rnd() < 0.35) continue;
        const cx = b.long === "x" ? b.x0 + s : (b.x0 + b.x1) / 2, cz = b.long === "x" ? (b.z0 + b.z1) / 2 : b.z0 + s;
        const hx = b.long === "x" ? 2.4 : 3, hz = b.long === "x" ? 3 : 2.4, mh = 2.6;
        const mb = { x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz };
        const yb = y1, yt = y1 + mh;
        quad([mb.x1, yb, mb.z0], [mb.x0, yb, mb.z0], [mb.x0, yt, mb.z0], [mb.x1, yt, mb.z0], [0, 0, -1], [0, 0], [1, 0], [1, 1], [0, 1], inf(4));
        quad([mb.x0, yb, mb.z1], [mb.x1, yb, mb.z1], [mb.x1, yt, mb.z1], [mb.x0, yt, mb.z1], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1], inf(4));
        quad([mb.x0, yb, mb.z0], [mb.x0, yb, mb.z1], [mb.x0, yt, mb.z1], [mb.x0, yt, mb.z0], [-1, 0, 0], [0, 0], [1, 0], [1, 1], [0, 1], inf(4));
        quad([mb.x1, yb, mb.z1], [mb.x1, yb, mb.z0], [mb.x1, yt, mb.z0], [mb.x1, yt, mb.z1], [1, 0, 0], [0, 0], [1, 0], [1, 1], [0, 1], inf(4));
        quad([mb.x0, yt, mb.z0], [mb.x0, yt, mb.z1], [mb.x1, yt, mb.z1], [mb.x1, yt, mb.z0], [0, 1, 0], [0, 0], [0, 1], [1, 1], [1, 0], inf(2));
      }
    }
    // porch lamps on the hero yard facades
    const heroYard = b.x0 >= HERO.archX0 - 1 && b.x1 <= HERO.eastX1 + 1 && b.z0 >= HERO.blockZ0 - 1 && b.z1 <= HERO.blockZ1 + 1;
    if (heroYard && b.part !== "archBridge") {
      for (let s = 9.6; s < len; s += 19.2) {
        const u = (b.long === "x" ? b.x0 : b.z0) - uo + s;
        void u;
        let lx, lz;
        if (b.long === "x") { lx = b.x0 + s; lz = yd[2] > 0 ? b.z1 + 1.0 : b.z0 - 1.0; }
        else { lz = b.z0 + s; lx = yd[0] > 0 ? b.x1 + 1.0 : b.x0 - 1.0; }
        if (yardLamps.length < 31) yardLamps.push(new THREE.Vector4(lx, G + 3.85, lz, 14));
      }
    }
  }
  yardLamps.push(new THREE.Vector4((HERO.archX0 + HERO.archX1) / 2, G + HERO.archTop - 0.6, ZA, 22));
  U.uYard.value = Array.from({ length: 32 }, (_, i) => yardLamps[i] ?? new THREE.Vector4());
  U.uNYard.value = yardLamps.length;

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aUV", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aInfo", new THREE.Float32BufferAttribute(info, 4));
  const facadeMat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, ...U },
    vertexShader: FACADE_VERT,
    fragmentShader: GLSL_NOISE + SKY_GLSL + LIGHTS_GLSL + SNOW_GLSL + FACADE_FRAG,
  });
  const facades = new THREE.Mesh(g, facadeMat);
  facades.frustumCulled = false;
  facades.renderOrder = -100;

  // ground: one plane over the flattened footprint, drawn on top of the terrain under it
  const [rx0, rz0, rx1, rz1] = CITY.rect;
  const gg = new THREE.PlaneGeometry(rx1 - rx0, rz1 - rz0, 1, 1);
  gg.rotateX(-Math.PI / 2);
  gg.translate((rx0 + rx1) / 2, G, (rz0 + rz1) / 2);
  const groundMat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, ...U },
    vertexShader: /* glsl */ `varying vec3 vWorld; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: GLSL_NOISE + SKY_GLSL + LIGHTS_GLSL + SNOW_GLSL + GROUND_FRAG,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const ground = new THREE.Mesh(gg, groundMat);
  ground.renderOrder = -90;

  const group = new THREE.Group();
  group.add(facades, ground);
  return { group, G, list, lamps: lamps(), yardLamps };
}
