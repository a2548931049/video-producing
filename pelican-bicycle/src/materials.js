// Material library + one shader patch shared by every lit material in the film.
//
// The patch adds three things:
//  1. Build reveal: each vertex carries (aPart, aSeq). A fragment is discarded while
//     aSeq > uReveal[aPart]. That is how parts are "drawn in" during the blueprint section.
//  2. Sketch output: when uSketch = 1 the material writes view-space normal + depth instead of
//     colour; the post pass turns that into ink lines on paper.
//  3. Optional translucency (thin feathers, pouch, web): light passing through toward the eye.
import * as THREE from "three";
import { SKY_GLSL, skyUniforms } from "./skyglsl.js";

export const MAX_PARTS = 32;
export const shared = {
  uReveal: { value: new Array(MAX_PARTS).fill(1) },
  uSketch: { value: 0 },
  uTime: { value: 0 },
  uViewInv: { value: new THREE.Matrix4() },
  uFogDensity: { value: 0.00085 },
  uFogStart: { value: 40 },
};

const VERT_HEAD = /* glsl */ `
uniform mat4 uViewInv;
varying vec3 vWorldP;
attribute float aPart;
attribute float aSeq;
varying float vPart;
varying float vSeq;
varying float vViewDepth;
`;
const VERT_BODY = /* glsl */ `
vPart = aPart;
vSeq = aSeq;
vViewDepth = -mvPosition.z;
vWorldP = (uViewInv * mvPosition).xyz;
`;
const FRAG_HEAD = /* glsl */ `
varying vec3 vWorldP;
uniform float uFogDensity;
uniform float uFogStart;
uniform float uReveal[${MAX_PARTS}];
uniform float uSketch;
uniform vec3 uTransColor;
uniform float uTrans;
varying float vPart;
varying float vSeq;
varying float vViewDepth;
`;
const FRAG_DISCARD = /* glsl */ `
{
  float rv = uReveal[int(vPart + 0.5)];
  if (rv <= 0.0001 || vSeq >= rv) discard;
}
`;

export function patch(mat, opts = {}) {
  const trans = opts.translucency ?? 0;
  const aerial = opts.aerial ?? false;
  const transColor = new THREE.Color(opts.transColor ?? 0xffd9a8);
  mat.userData.patched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uReveal = shared.uReveal;
    sh.uniforms.uSketch = shared.uSketch;
    sh.uniforms.uTransColor = { value: transColor };
    sh.uniforms.uTrans = { value: trans };
    sh.uniforms.uViewInv = shared.uViewInv;
    sh.uniforms.uFogDensity = shared.uFogDensity;
    sh.uniforms.uFogStart = shared.uFogStart;
    if (aerial) Object.assign(sh.uniforms, skyUniforms);
    mat.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_HEAD)
      .replace("#include <project_vertex>", "#include <project_vertex>\n" + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_HEAD + (aerial ? SKY_GLSL : ""))
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + FRAG_DISCARD);
    if (trans > 0) {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 Ld = directionalLights[0].direction;
          vec3 V = normalize(vViewPosition);
          float back = max(0.0, dot(normal, -Ld)) * 0.6 + 0.4 * max(0.0, dot(-normal, -Ld));
          float through = pow(max(0.0, dot(V, -Ld)), 3.0);
          float wrap = max(0.0, dot(-geometryNormal, Ld));
          outgoingLight += uTrans * uTransColor * diffuseColor.rgb * directionalLights[0].color * (0.35 * wrap + through * (0.25 + back));
        }
        #endif
        #include <opaque_fragment>`,
      );
    }
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <dithering_fragment>",
      /* glsl */ `#include <dithering_fragment>
      ${aerial ? `{
        vec3 dv = vWorldP - cameraPosition;
        float dist = length(dv);
        float fog = 1.0 - exp(-max(dist - uFogStart, 0.0) * uFogDensity);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor(dv / dist), fog);
      }` : ""}
      if (uSketch > 0.5) {
        gl_FragColor = vec4(normalize(normal) * 0.5 + 0.5, vViewDepth);
      }`,
    );
  };
  // keep program cache keys distinct between translucent / opaque variants
  mat.customProgramCacheKey = () => `pel-${trans > 0 ? "t" : "o"}-${aerial ? "a" : "n"}`;
  return mat;
}

// Attach (aPart, aSeq) to a geometry. seq: "v" uses uv.y, a Vector3 projects along it,
// a function(x,y,z) returns a value; everything is normalised to [0,1].
export function tag(g, part, seq = "v", seqRange = null) {
  const pos = g.attributes.position;
  const n = pos.count;
  const parts = new Float32Array(n).fill(part);
  const s = new Float32Array(n);
  if (seq === "v" && g.attributes.uv) {
    for (let i = 0; i < n; i++) s[i] = g.attributes.uv.getY(i);
  } else if (seq instanceof THREE.Vector3) {
    for (let i = 0; i < n; i++) s[i] = pos.getX(i) * seq.x + pos.getY(i) * seq.y + pos.getZ(i) * seq.z;
  } else if (typeof seq === "function") {
    for (let i = 0; i < n; i++) s[i] = seq(pos.getX(i), pos.getY(i), pos.getZ(i), i);
  } else if (typeof seq === "number") {
    s.fill(seq);
  }
  if (typeof seq !== "number") {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, s[i]); hi = Math.max(hi, s[i]); }
    if (seqRange) { lo = seqRange[0]; hi = seqRange[1]; }
    const d = hi - lo || 1;
    for (let i = 0; i < n; i++) s[i] = THREE.MathUtils.clamp((s[i] - lo) / d, 0, 1) * 0.999;
  }
  g.setAttribute("aPart", new THREE.BufferAttribute(parts, 1));
  g.setAttribute("aSeq", new THREE.BufferAttribute(s, 1));
  return g;
}

export function tagInstanced(g, count, part, seqFn = (i) => i / count) {
  const p = new Float32Array(count).fill(part);
  const s = new Float32Array(count);
  for (let i = 0; i < count; i++) s[i] = Math.min(0.999, seqFn(i));
  g.setAttribute("aPart", new THREE.InstancedBufferAttribute(p, 1));
  g.setAttribute("aSeq", new THREE.InstancedBufferAttribute(s, 1));
  return g;
}

// ----- material library -----
export function makeMaterials(tex) {
  const M = {};
  M.paint = patch(new THREE.MeshPhysicalMaterial({
    color: 0x14525c, metalness: 0.35, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.04,
  }));
  M.chrome = patch(new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1.0, roughness: 0.07 }));
  M.alu = patch(new THREE.MeshStandardMaterial({ color: 0xd0d2d6, metalness: 1.0, roughness: 0.24, roughnessMap: tex.brushed }));
  M.darkSteel = patch(new THREE.MeshStandardMaterial({ color: 0x3b3c40, metalness: 0.9, roughness: 0.38 }));
  M.chainPlate = patch(new THREE.MeshStandardMaterial({ color: 0xb3b5ba, metalness: 1.0, roughness: 0.3 }));
  M.gold = patch(new THREE.MeshStandardMaterial({ color: 0xd9a54a, metalness: 1.0, roughness: 0.25 }));
  M.brass = patch(new THREE.MeshStandardMaterial({ color: 0xc8924a, metalness: 1.0, roughness: 0.3 }));
  M.copper = patch(new THREE.MeshStandardMaterial({ color: 0xc27a4a, metalness: 1.0, roughness: 0.28 }));
  M.tyre = patch(new THREE.MeshStandardMaterial({ map: tex.tyre.map, normalMap: tex.tyre.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.82, metalness: 0 }));
  M.tape = patch(new THREE.MeshStandardMaterial({ map: tex.tape.map, normalMap: tex.tape.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.86 }));
  M.leather = patch(new THREE.MeshPhysicalMaterial({ map: tex.leather.map, normalMap: tex.leather.normal, normalScale: new THREE.Vector2(0.12, 0.12), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 }));
  M.gum = patch(new THREE.MeshPhysicalMaterial({ color: 0xa8743e, roughness: 0.55, transmission: 0, sheen: 0.3 }), { translucency: 0.5, transColor: 0xffb060 });
  M.blackRubber = patch(new THREE.MeshStandardMaterial({ color: 0x1e1c1b, roughness: 0.7 }));
  M.cable = patch(new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.45 }));
  M.glass = patch(new THREE.MeshPhysicalMaterial({ color: 0x2c2a26, metalness: 0.2, roughness: 0.03, clearcoat: 1, emissive: 0xffc070, emissiveIntensity: 0 }));
  M.reflectorRed = patch(new THREE.MeshPhysicalMaterial({ color: 0xb01010, roughness: 0.15, clearcoat: 1, emissive: 0x200000 }));
  return M;
}
