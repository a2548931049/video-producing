import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildBike, B } from "../src/bike.js";
import { makeMaterials } from "../src/materials.js";
import * as T from "../src/textures.js";
import { buildPelican } from "../src/pelican.js";
import { makeRig } from "../src/rig.js";

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(1280, 720, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa4b8);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xffe0b0, 3);
sun.position.set(-2, 3, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1.5; sun.shadow.camera.right = 1.5; sun.shadow.camera.top = 2; sun.shadow.camera.bottom = -1;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x554433, 0.6));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x6a6460, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const tex = {
  tyre: T.tyreTextures(),
  tape: T.barTapeTextures(),
  leather: T.leatherTextures(),
  brushed: T.brushedRoughness(),
};
const M = makeMaterials(tex);
const bike = buildBike(M);
scene.add(bike.root);
window.bike = bike;
const t0 = performance.now();
const pel = buildPelican(M);
const buildMs = performance.now() - t0;
const rig = makeRig(bike, pel);
window.pel = pel;
window.rig = rig;
window.B = B;

const camera = new THREE.PerspectiveCamera(30, 1280 / 720, 0.01, 100);
window.lab = {
  view(px, py, pz, tx, ty, tz, fov = 30, crank = 0, wheel = 0) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    rig.solve({ crank, wheel, t: 1, ...(window.labState || {}) });
    renderer.render(scene, camera);
    return "ok build " + buildMs.toFixed(0) + "ms feathers " + pel.info.feathers + " body " + pel.info.bodyFeathers;
  },
  scene, camera, renderer, THREE,
};
window.lab.view(0.1, 0.6, 3.2, 0.1, 0.5, 0);
document.title = "ready";
