// Render pipeline. One video frame = N jittered sub-frames; each sub-frame is rendered to HDR and smeared
// along the camera's own motion over its slice of the shutter (depth-based reprojection), then accumulated.
// Afterwards: bloom → exposure → filmic curve → grade → vignette, grain, dither.
import * as THREE from "three";

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function quadMat(frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
}
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };

export class Pipeline {
  constructor(renderer, W, H) {
    this.r = renderer;
    this.W = W;
    this.H = H;
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(W, H, { ...hf, depthBuffer: true });
    this.rtScene.depthTexture = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
    this.rtAurora = new THREE.WebGLRenderTarget(W >> 1, H >> 1, hf);
    this.rtAccum = new THREE.WebGLRenderTarget(W, H, hf);
    for (const t of [this.rtScene, this.rtAurora, this.rtAccum]) {
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
    }
    this.bloom = [];
    let w = W >> 1, h = H >> 1;
    for (let i = 0; i < 6; i++) {
      const mk = () => {
        const t = new THREE.WebGLRenderTarget(w, h, hf);
        t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
        return t;
      };
      this.bloom.push({ down: mk(), up: mk(), w, h });
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri, null);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // camera motion blur: reproject each pixel to where the shutter opened and closed, gather along that line
    this.blurMat = quadMat(/* glsl */ `
      uniform sampler2D tColor, tDepth;
      uniform mat4 uInvVP, uVP0, uVP1;
      uniform vec2 uRes;
      uniform float uW, uMaxPx, uSeed;
      varying vec2 vUv;
      vec2 toUv(vec4 c) { return c.xy / c.w * 0.5 + 0.5; }
      void main() {
        float d = texture2D(tDepth, vUv).r;
        vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        // sky pixels sit on the far plane (120 km): reprojecting that point is a pure rotation in practice
        vec4 wp = uInvVP * ndc;
        vec4 P = vec4(wp.xyz / wp.w, 1.0);
        vec4 c0 = uVP0 * P, c1 = uVP1 * P;
        vec2 a = (c0.w > 0.0 ? toUv(c0) : vUv) - vUv;
        vec2 b = (c1.w > 0.0 ? toUv(c1) : vUv) - vUv;
        vec2 v = (b - a) * uRes;
        float len = length(v);
        if (len > uMaxPx) v *= uMaxPx / len;
        v /= uRes;
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uSeed, vec2(0.06711056, 0.00583715))));
        // as many taps as the smear is long (2 px apart), at least one
        float lenPx = length(v * uRes);
        int n = int(clamp(ceil(lenPx * 0.5), 1.0, 16.0));
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 16; i++) {
          if (i >= n) break;
          float s = n == 1 ? 0.0 : (float(i) + ign) / float(n) - 0.5;
          acc += texture2D(tColor, vUv + v * s).rgb;
        }
        gl_FragColor = vec4(acc / float(n) * uW, uW);
      }`,
      { tColor: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uVP0: { value: new THREE.Matrix4() }, uVP1: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(W, H) }, uW: { value: 1 }, uMaxPx: { value: 160 }, uSeed: { value: 0 } },
      ADD);

    this.brightMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc; uniform float uThresh; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(min(c * max(l - uThresh, 0.0) / max(l, 1e-4), vec3(40.0)), 1.0);
      }`, { tSrc: { value: null }, uThresh: { value: 1 } });
    this.downMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 0.25;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.1875;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb * 0.1875;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 0.1875;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb * 0.1875;
        gl_FragColor = vec4(c, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc, tBase; uniform vec2 uTexel; uniform float uMix; varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c * 0.25 * uMix, 1.0);
      }`, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });

    this.finalMat = quadMat(/* glsl */ `
      uniform sampler2D tHdr, tBloom;
      uniform vec2 uRes;
      uniform float uExposure, uBloom, uVignette, uGrain, uFrame, uFade, uCA, uLift, uSat;
      uniform vec3 uTint;
      varying vec2 vUv;
      float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 filmic(vec3 x) {
        // ACES (Narkowicz fit) with a gentler toe for night scenes
        x *= 0.85;
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      void main() {
        vec2 dc = vUv - 0.5;
        // radial chromatic aberration (subtle; rises with speed)
        vec2 off = dc * uCA;
        vec3 hdr;
        hdr.r = texture2D(tHdr, vUv - off).r;
        hdr.g = texture2D(tHdr, vUv).g;
        hdr.b = texture2D(tHdr, vUv + off).b;
        hdr += texture2D(tBloom, vUv).rgb * uBloom;
        hdr *= uExposure * uTint;
        vec3 c = filmic(hdr);
        // grade: cool the shadows a touch, keep highlights warm
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c += uLift * vec3(0.20, 0.32, 0.55) * (1.0 - smoothstep(0.0, 0.35, l));
        float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, length(dc * vec2(1.0, 0.82)) * 1.35);
        c *= vig;
        c = pow(max(c, 0.0), vec3(1.0 / 2.2));
        float g = h12(gl_FragCoord.xy + uFrame * 17.31) + h12(gl_FragCoord.xy * 1.37 - uFrame * 9.1) - 1.0;
        c += g * uGrain;
        c = mix(c, vec3(0.0), uFade);
        // dither before 8-bit quantisation (dark gradients band under H.264 otherwise)
        c += (h12(gl_FragCoord.xy + uFrame) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
      { tHdr: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2(W, H) }, uExposure: { value: 1 }, uBloom: { value: 0.1 }, uVignette: { value: 0.35 }, uGrain: { value: 0.02 }, uFrame: { value: 0 }, uFade: { value: 0 }, uCA: { value: 0 }, uLift: { value: 0.03 }, uSat: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) } });
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qScene, this.qCam);
  }

  // n sub-frames; drawSub(k, n) must render the HDR scene into this.rtScene and return { invVP, vp0, vp1 }
  render(n, drawSub, P) {
    const r = this.r;
    r.setRenderTarget(this.rtAccum);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    for (let k = 0; k < n; k++) {
      const m = drawSub(k, n);
      const b = this.blurMat.uniforms;
      b.tColor.value = this.rtScene.texture;
      b.tDepth.value = this.rtScene.depthTexture;
      b.uInvVP.value.copy(m.invVP);
      b.uVP0.value.copy(m.vp0);
      b.uVP1.value.copy(m.vp1);
      b.uW.value = 1 / n;
      b.uSeed.value = k * 7.3 + (P.frame % 64) * 1.7;
      b.uMaxPx.value = P.maxBlurPx ?? 160;
      this.pass(this.blurMat, this.rtAccum);
    }
    // bloom
    this.brightMat.uniforms.tSrc.value = this.rtAccum.texture;
    this.brightMat.uniforms.uThresh.value = P.bloomThreshold ?? 1.0;
    this.pass(this.brightMat, this.bloom[0].down);
    for (let i = 1; i < this.bloom.length; i++) {
      this.downMat.uniforms.tSrc.value = this.bloom[i - 1].down.texture;
      this.downMat.uniforms.uTexel.value.set(1 / this.bloom[i - 1].w, 1 / this.bloom[i - 1].h);
      this.pass(this.downMat, this.bloom[i].down);
    }
    let src = this.bloom[this.bloom.length - 1].down;
    for (let i = this.bloom.length - 2; i >= 0; i--) {
      this.upMat.uniforms.tSrc.value = src.texture;
      this.upMat.uniforms.tBase.value = this.bloom[i].down.texture;
      this.upMat.uniforms.uTexel.value.set(0.5 / this.bloom[i].w, 0.5 / this.bloom[i].h);
      this.upMat.uniforms.uMix.value = 1.0;
      this.pass(this.upMat, this.bloom[i].up);
      src = this.bloom[i].up;
    }
    const f = this.finalMat.uniforms;
    f.tHdr.value = this.rtAccum.texture;
    f.tBloom.value = src.texture;
    f.uExposure.value = P.exposure ?? 1;
    f.uBloom.value = P.bloom ?? 0.1;
    f.uVignette.value = P.vignette ?? 0.35;
    f.uGrain.value = P.grain ?? 0.02;
    f.uFrame.value = P.frame ?? 0;
    f.uFade.value = P.fade ?? 0;
    f.uCA.value = P.ca ?? 0;
    f.uLift.value = P.lift ?? 0.03;
    f.uSat.value = P.sat ?? 1;
    if (P.tint) f.uTint.value.copy(P.tint);
    this.pass(this.finalMat, null);
  }
}
