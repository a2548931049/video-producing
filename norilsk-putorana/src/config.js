// Film-wide constants: frame, world layout, light. World units are metres; x = east, z = south, y = up.
import * as THREE from "three";

export const W = 1920, H = 1080, FPS = 30, DURATION = 10;

// The real terrain is the Lama massif's west end (Putorana Plateau, ~69.38°N 89.97°E).
// Norilsk itself lies ~120 km to the west; the film sets a Norilsk district on the lowland at the
// massif's foot so one continuous flight can join the two (distance compressed, terrain kept real).
export const CITY = {
  center: new THREE.Vector2(-3700, 0),
  // flattened footprint (x0, z0, x1, z1) and the fall-off back to the real ground
  rect: [-5600, -1150, -2700, 1200],
  falloff: 450,
  // the avenue runs due east, straight at the mouth of the valley that cuts the massif
  avenueZ: 0,
};

// Real coordinates shown on screen
export const GEO = {
  norilsk: { lat: 69.3333, lon: 88.2167 }, // 69°20′N 88°13′E
  origin: { lat: 69.38, lon: 89.97 },
};

function dirFromAzEl(azDeg, elDeg) {
  const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// Polar night: a low moon in the south-west lights the stepped faces; the aurora hangs overhead.
export const LIGHT = {
  moonDir: dirFromAzEl(214, 15),
  moonColor: new THREE.Color(0.62, 0.7, 0.92),
  moonIntensity: 0.95,
  skyZenith: new THREE.Color(0.004, 0.0075, 0.021),
  skyHorizon: new THREE.Color(0.02, 0.032, 0.068),
  ambientSky: new THREE.Color(0.03, 0.045, 0.095),
  ambientGround: new THREE.Color(0.01, 0.012, 0.02),
  auroraTint: new THREE.Color(0.01, 0.035, 0.02),
  cityGlow: new THREE.Color(1.0, 0.56, 0.24),
};

export const EARTH_R = 6371000;
