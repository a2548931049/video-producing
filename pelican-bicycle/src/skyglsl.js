// Analytic golden-hour sky shared by the sky dome, the sea reflection and aerial perspective.
// Sun low over the land (+Z), full moon rising over the sea (−Z). Linear HDR output.
import * as THREE from "three";

export const SKY = {
  sunDir: new THREE.Vector3(-0.85, 0.156, 0.504).normalize(),
  moonDir: new THREE.Vector3(0.83, 0.13, -0.54).normalize(),
};

export const skyUniforms = {
  uSunDir: { value: SKY.sunDir },
  uMoonDir: { value: SKY.moonDir },
  uSkyTime: { value: 0 },
  uSunBoost: { value: 1 },
};

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSkyTime;
uniform float uSunBoost;

float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}

// azimuthal closeness to the sun in [0,1]
float sunSide(vec3 d) {
  vec2 a = normalize(d.xz + 1e-5), b = normalize(uSunDir.xz);
  return clamp(dot(a, b) * 0.5 + 0.5, 0.0, 1.0);
}

vec3 skyBase(vec3 d) {
  float y = d.y;
  float yy = max(y, 0.0);
  float az = sunSide(d);
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 zenith = vec3(0.05, 0.11, 0.30);
  vec3 midSun = vec3(0.66, 0.46, 0.38);
  vec3 midAnti = vec3(0.24, 0.29, 0.5);
  vec3 horSun = vec3(1.45, 0.72, 0.34);
  vec3 horAnti = vec3(0.72, 0.56, 0.66);
  float sideK = pow(az, 2.2);
  vec3 hor = mix(horAnti, horSun, sideK);
  vec3 mid = mix(midAnti, midSun, sideK);
  float h1 = pow(1.0 - yy, 7.0);
  float h2 = pow(1.0 - yy, 2.2);
  vec3 col = mix(zenith, mid, h2);
  col = mix(col, hor, h1);
  // Belt of Venus over the anti-solar horizon, with the blue band of Earth's shadow beneath
  float anti = pow(1.0 - az, 1.6);
  float belt = smoothstep(0.015, 0.07, y) * (1.0 - smoothstep(0.1, 0.3, y));
  col = mix(col, vec3(0.98, 0.6, 0.62), belt * anti * 0.5);
  float shadow = (1.0 - smoothstep(-0.01, 0.045, y)) * anti;
  col = mix(col, vec3(0.30, 0.33, 0.52), shadow * 0.6);
  // forward scattering around the sun
  col += vec3(1.0, 0.55, 0.22) * (pow(sd, 6.0) * 0.75 + pow(sd, 40.0) * 1.4 + pow(sd, 400.0) * 3.0) * uSunBoost;
  // below the horizon: haze colour continues (for reflections)
  if (y < 0.0) col = mix(col, hor * 0.85, smoothstep(0.0, -0.1, y));
  return col;
}

vec3 cloudsOver(vec3 d, vec3 col) {
  if (d.y <= 0.004) return col;
  float t = 900.0 / (d.y + 0.035);
  vec2 p = d.xz * t * 0.00042;
  p += vec2(uSkyTime * 0.0035, uSkyTime * 0.0012);
  // stretched stratocumulus bands
  vec2 q = vec2(p.x * 0.55 + p.y * 0.3, p.y * 1.9 - p.x * 0.4);
  float n = fbm5(q * 1.6);
  float n2 = fbm5(q * 5.0 + 3.0);
  float cov = smoothstep(0.5, 0.78, n + 0.22 * n2 - 0.06);
  cov *= smoothstep(0.004, 0.09, d.y) * (1.0 - smoothstep(0.5, 0.9, d.y) * 0.6);
  float sd = max(dot(d, uSunDir), 0.0);
  float az = sunSide(d);
  vec3 lit = mix(vec3(0.95, 0.52, 0.6), vec3(1.9, 1.0, 0.45), pow(az, 3.0));
  vec3 shade = mix(vec3(0.34, 0.27, 0.42), vec3(0.75, 0.38, 0.28), pow(az, 2.0));
  float thick = smoothstep(0.55, 0.95, n + 0.15 * n2);
  vec3 cc = mix(lit, shade, thick * 0.7);
  cc += vec3(2.2, 1.2, 0.5) * pow(sd, 12.0) * (1.0 - thick) * 1.5; // silver-gold lining
  return mix(col, cc, cov * 0.92);
}

vec3 sunDisk(vec3 d) {
  float sd = dot(d, uSunDir);
  float r = acos(clamp(sd, -1.0, 1.0));
  float R = 0.0105;
  float disk = 1.0 - smoothstep(R * 0.92, R, r);
  float limb = 1.0 - 0.45 * pow(clamp(r / R, 0.0, 1.0), 2.0);
  // flatten near the horizon (refraction): squash using elevation
  return vec3(42.0, 24.0, 9.0) * disk * limb * uSunBoost;
}

vec3 moonDisk(vec3 d) {
  vec3 m = uMoonDir;
  float r = acos(clamp(dot(d, m), -1.0, 1.0));
  float R = 0.0135;
  if (r > R * 1.6) return vec3(0.0);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 ax = normalize(cross(up, m));
  vec3 ay = cross(m, ax);
  vec2 uv = vec2(dot(d - m, ax), dot(d - m, ay)) / R;
  float disk = 1.0 - smoothstep(0.93, 1.0, length(uv));
  float maria = fbm5(uv * 2.2 + 4.0);
  float shade = 0.78 + 0.22 * smoothstep(0.35, 0.65, maria);
  shade *= 1.0 - 0.15 * dot(uv, uv);
  vec3 mc = vec3(1.25, 1.02, 0.86) * shade * 1.6;
  float glow = exp(-r / (R * 0.9)) * 0.25;
  return mc * disk + vec3(0.9, 0.75, 0.75) * glow;
}

vec3 skyColor(vec3 d) {
  vec3 c = skyBase(d);
  c = cloudsOver(d, c);
  return c;
}

vec3 skyFull(vec3 d) {
  vec3 c = skyBase(d);
  c += moonDisk(d) * smoothstep(-0.01, 0.01, d.y);
  c = cloudsOver(d, c);
  c += sunDisk(d) * smoothstep(-0.005, 0.004, d.y);
  return c;
}

// colour toward which distant geometry fades
vec3 hazeColor(vec3 d) {
  vec3 h = skyBase(normalize(vec3(d.x, max(d.y, 0.0) * 0.3 + 0.02, d.z)));
  return h;
}
`;
