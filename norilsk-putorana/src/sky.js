// The polar-night sky: gradient, city light dome, stars, aurora; plus the fog every world shader shares.
import * as THREE from "three";
import { LIGHT } from "./config.js";
import { GLSL_NOISE } from "./util.js";

// Uniforms shared by all world materials (one object, referenced everywhere).
export const skyUniforms = {
  uTime: { value: 0 },
  uMoonDir: { value: LIGHT.moonDir.clone() },
  uZenith: { value: LIGHT.skyZenith.clone() },
  uHorizon: { value: LIGHT.skyHorizon.clone() },
  uDome: { value: 0 }, // city light-pollution dome, 1 in the streets → 0 over the plateau
  uDomeCol: { value: new THREE.Color(0.16, 0.075, 0.03) },
  uAurora: { value: 1 }, // aurora brightness
  // haze: density at base (1/m), height falloff (1/m), base height (m)
  uFog: { value: new THREE.Vector3(0.00006, 1 / 900, 150) },
  // low fog in the lake basins and valley floors: density, falloff, base height, onset x (east of the city)
  uValley: { value: new THREE.Vector4(0.00025, 1 / 100, 30, -1600) },
  uFogCol: { value: new THREE.Color(0.03, 0.042, 0.075) },
  uCityFog: { value: new THREE.Vector4(-3700, 0, 1500, 1) }, // centre xz, radius, strength
  uCityFogCol: { value: new THREE.Color(0.2, 0.095, 0.04) },
};

export const SKY_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uDome;
uniform vec3 uDomeCol;
uniform float uAurora;
uniform vec3 uFog;
uniform vec4 uValley;
uniform vec3 uFogCol;
uniform vec4 uCityFog;
uniform vec3 uCityFogCol;

vec3 skyGradient(vec3 D) {
  float e = max(D.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(e, 0.5));
  c += uHorizon * 0.5 * exp(-e * 30.0);
  float m = max(dot(D, uMoonDir), 0.0);
  c += vec3(0.03, 0.04, 0.07) * (pow(m, 5.0) * 0.7 + pow(m, 80.0));
  c += uDomeCol * uDome * exp(-e * 6.0);
  return c;
}

// colour scattered toward the eye by the haze along direction D (moonlit, warmed near the city)
vec3 fogColor(vec3 D, vec3 P) {
  float m = max(dot(D, uMoonDir), 0.0);
  vec3 c = uFogCol * (1.0 + 2.0 * pow(m, 4.0));
  float dc = length(P.xz - uCityFog.xy) / uCityFog.z;
  c += uCityFogCol * uCityFog.w / (1.0 + dc * dc * 2.5);
  return c;
}

// optical depth of an exponential height layer between C and P
float layerDepth(vec3 C, vec3 P, float dens, float fall, float base) {
  vec3 d = P - C;
  float L = length(d);
  float dy = d.y * fall;
  float a = dens * exp(-(C.y - base) * fall);
  return a * L * (abs(dy) > 1e-4 ? (1.0 - exp(-dy)) / dy : 1.0 - 0.5 * dy);
}

vec3 applyFog(vec3 col, vec3 P) {
  vec3 C = cameraPosition;
  vec3 D = normalize(P - C);
  float tau = layerDepth(C, P, uFog.x, uFog.y, uFog.z);
  float v = layerDepth(C, P, uValley.x, uValley.y, uValley.z);
  float pch = 0.3 + 1.1 * vnoise(P.xz * 0.0009 + vec2(uTime * 0.015, 0.0));
  v *= pch * smoothstep(uValley.w, uValley.w + 1500.0, P.x);
  float f = 1.0 - exp(-(tau + v));
  return mix(col, fogColor(D, P), f);
}
`;

const FS_VERT = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const DIR_GLSL = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
vec3 viewDir(vec2 ndc) {
  vec4 v = uProjInv * vec4(ndc, 1.0, 1.0);
  return normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
}`;

// Aurora: each curtain is a vertical sheet of light hanging from a meandering line ~100 km up. For every
// view ray we find where its ground track crosses each sheet; the crossing altitude sets the colour
// (oxygen green low, red/violet high, a pink fringe at the very bottom) and the brightness profile
// (a sharp lower edge, fading upward). Rays along the sheet give the vertical striations. Analytic, so
// no slicing artefacts. Direction-only (no parallax at our scale). Rendered once per frame at half resolution
// (the bilinear upscale is the softness a long exposure gives real auroras).
const AURORA_GLSL = /* glsl */ `
uniform float uSeed;
// centre line of curtain c (z0, amplitude, wavenumber) at x, phase ph (km)
float zLine(float x, vec3 c, float ph) {
  return c.x + c.y * sin(x * c.z + ph) + c.y * 0.5 * sin(x * c.z * 2.7 - ph * 1.3 + 1.1)
       + 26.0 * (vnoise(vec2(x * 0.009, ph * 0.7)) - 0.5);
}
// light where the view ray crosses the sheet sc km out
vec3 crossing(float sc, vec2 dh, float tanEl, vec3 c, float ph, float edge0, float decay, float seed) {
  vec2 p = sc * dh;
  float alt = sc * tanEl;
  float dz = (zLine(p.x + 2.0, c, ph) - zLine(p.x - 2.0, c, ph)) * 0.25;
  float cosA = abs(dot(dh, normalize(vec2(-dz, 1.0))));
  float path = 1.0 / max(cosA, 0.2);
  float edge = edge0 + 11.0 * vnoise(vec2(p.x * 0.018, seed));
  float prof = alt < edge ? exp(-pow((edge - alt) / 1.8, 2.0)) : exp(-(alt - edge) / decay);
  // rays: streaks fixed along the sheet, shimmering; folds brighten where the line bends
  // ray detail is scaled by distance so far sheets don't alias into stripes
  float lod = 1.0 / (1.0 + sc / 260.0);
  float r1 = vnoise(vec2(p.x * 0.3 * lod + seed * 7.0, uTime * 0.6));
  float r2 = vnoise(vec2(p.x * 0.9 * lod + seed * 3.0, uTime * 1.3));
  float rays = 0.4 + 1.0 * pow(r1 * 0.8 + r2 * 0.2, 1.8);
  float hRel = (alt - edge) / 150.0;
  vec3 col = mix(vec3(0.1, 1.0, 0.42), vec3(0.42, 0.1, 0.62), smoothstep(0.22, 0.85, hRel));
  col = mix(vec3(1.0, 0.25, 0.55), col, smoothstep(-0.03, 0.025, hRel));
  return col * prof * rays * path;
}
// where the ground track is s km out: its offset from the sheet's centre line, and how fast that changes with s
vec2 trackOffset(float s, vec2 dh, vec3 c, float ph) {
  float x = s * dh.x;
  float a1 = x * c.z + ph, a2 = x * c.z * 2.7 - ph * 1.3 + 1.1;
  float n0 = vnoise(vec2(x * 0.009, ph * 0.7)), n1 = vnoise(vec2((x + 1.0) * 0.009, ph * 0.7));
  float z = c.x + c.y * sin(a1) + c.y * 0.5 * sin(a2) + 26.0 * (n0 - 0.5);
  float dz = c.y * c.z * cos(a1) + c.y * 1.35 * c.z * cos(a2) + 26.0 * (n1 - n0);
  return vec2(s * dh.y - z, dh.y - dz * dh.x);
}
vec3 sheet(vec2 dh, float tanEl, vec3 c, float ph, float edge0, float decay, float seed) {
  vec3 acc = vec3(0.0);
  float s0 = 92.0 / tanEl, s1 = 330.0 / tanEl;           // horizontal span inside the aurora's altitudes
  // skip sheets this ray's ground track cannot reach
  float za = min(s0 * dh.y, s1 * dh.y), zb = max(s0 * dh.y, s1 * dh.y);
  float reach = c.y * 1.5 + 14.0;
  if (zb < c.x - reach || za > c.x + reach) return acc;
  float sp = s0;
  vec2 Fp = trackOffset(s0, dh, c, ph);
  for (int i = 1; i <= 28; i++) {
    float q = float(i) / 28.0;
    float s = mix(s0, s1, q * q);                         // finer near the bright lower edge
    vec2 F = trackOffset(s, dh, c, ph);
    if (Fp.x * F.x <= 0.0 && Fp.x != F.x) {
      acc += crossing(sp - Fp.x * (s - sp) / (F.x - Fp.x), dh, tanEl, c, ph, edge0, decay, seed);
    } else if (Fp.y * F.y < 0.0) {
      // a fold: the track turns back toward the sheet between two samples. Find the turning point;
      // if it reaches the sheet the ray goes in and out, if it nearly does the sheet's thickness still glows
      float se = sp - Fp.y * (s - sp) / (F.y - Fp.y);
      vec2 Fe = trackOffset(se, dh, c, ph);
      if (Fe.x * Fp.x < 0.0) {
        acc += crossing(sp - Fp.x * (se - sp) / (Fe.x - Fp.x), dh, tanEl, c, ph, edge0, decay, seed);
        acc += crossing(se - Fe.x * (s - se) / (F.x - Fe.x), dh, tanEl, c, ph, edge0, decay, seed);
      } else {
        acc += 2.0 * exp(-Fe.x * Fe.x) * crossing(se, dh, tanEl, c, ph, edge0, decay, seed);
      }
    }
    sp = s;
    Fp = F;
  }
  return acc;
}
vec3 aurora(vec3 D) {
  if (D.y <= 0.004) return vec3(0.0);
  float hl = length(D.xz);
  vec2 dh = D.xz / hl;
  float tanEl = D.y / hl;
  float t = uTime;
  // the whole pattern drifts slowly east; folds travel along the arcs
  vec3 acc = vec3(0.0);
  acc += 1.00 * sheet(dh, tanEl, vec3(-70.0, 22.0, 0.012), 0.8 + t * 0.09, 104.0, 40.0, 1.0);
  acc += 0.80 * sheet(dh, tanEl, vec3(10.0, 30.0, 0.0085), 2.4 - t * 0.06, 102.0, 46.0, 2.0);
  acc += 0.55 * sheet(dh, tanEl, vec3(120.0, 40.0, 0.0065), 4.0 + t * 0.05, 106.0, 52.0, 3.0);
  acc += 0.85 * sheet(dh, tanEl, vec3(430.0, 60.0, 0.0042), 5.3 - t * 0.04, 104.0, 58.0, 4.0);
  acc *= smoothstep(0.0, 0.06, D.y);
  return acc * 0.07 * uAurora;
}`;

export function makeSky() {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const camU = { uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() } };

  const auroraMat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, ...camU, uSeed: { value: 0 } },
    vertexShader: FS_VERT,
    fragmentShader: GLSL_NOISE + SKY_GLSL + DIR_GLSL + AURORA_GLSL + /* glsl */ `
      varying vec2 vNdc;
      void main() { gl_FragColor = vec4(aurora(viewDir(vNdc)), 1.0); }`,
    depthTest: false,
    depthWrite: false,
  });

  const skyMat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, ...camU, tAurora: { value: null }, uRes: { value: new THREE.Vector2(1920, 1080) } },
    vertexShader: FS_VERT,
    fragmentShader: GLSL_NOISE + SKY_GLSL + DIR_GLSL + /* glsl */ `
      uniform sampler2D tAurora;
      uniform vec2 uRes;
      varying vec2 vNdc;
      vec3 stars(vec3 D) {
        vec3 a = abs(D);
        vec2 uv; float face;
        if (a.x >= a.y && a.x >= a.z) { uv = D.yz / a.x; face = D.x > 0.0 ? 1.0 : 2.0; }
        else if (a.y >= a.z) { uv = D.xz / a.y; face = D.y > 0.0 ? 3.0 : 4.0; }
        else { uv = D.xy / a.z; face = D.z > 0.0 ? 5.0 : 6.0; }
        vec2 g = uv * 130.0;
        vec2 id = floor(g), f = fract(g);
        float px = max(length(fwidth(D)) * 130.0, 1e-3); // cells per pixel (continuous across cube faces)
        vec3 col = vec3(0.0);
        if (hash12(id + face * 131.7) > 0.8) {
          vec2 pos = 0.15 + 0.7 * hash22(id + face * 17.3);
          float mag = pow(hash12(id * 1.37 + face), 9.0);
          float r = length(f - pos) / max(px, 1e-4);
          float b = exp(-r * r * 1.3) * (0.025 + 2.4 * mag);
          col = b * mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.85, 0.68), hash12(id + 9.1));
        }
        return col * smoothstep(0.02, 0.3, D.y);
      }
      void main() {
        vec3 D = viewDir(vNdc);
        vec3 c = skyGradient(D);
        c += stars(D) * (1.0 - 0.8 * uDome);
        c += texture2D(tAurora, gl_FragCoord.xy / uRes).rgb;
        gl_FragColor = vec4(c, 1.0);
      }`,
    // drawn after the world, only where nothing else wrote depth
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });

  const auroraMesh = new THREE.Mesh(tri, auroraMat);
  const skyMesh = new THREE.Mesh(tri, skyMat);
  auroraMesh.frustumCulled = skyMesh.frustumCulled = false;
  const auroraScene = new THREE.Scene();
  auroraScene.add(auroraMesh);
  const skyScene = new THREE.Scene();
  skyScene.add(skyMesh);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    auroraScene,
    skyScene,
    orthoCam,
    skyMat,
    auroraMat,
    setCamera(cam) {
      camU.uProjInv.value.copy(cam.projectionMatrixInverse);
      camU.uCamWorld.value.copy(cam.matrixWorld);
    },
  };
}
