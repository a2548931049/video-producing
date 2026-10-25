// Render pipeline. One video frame = N sub-frames accumulated (motion blur, AA, depth of field),
// a separate sketch accumulation for the blueprint look, then bloom → tone map → grade.
import * as THREE from "three";
import { shared } from "./materials.js";

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function quadMat(frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
}

export class Pipeline {
  constructor(renderer, W, H) {
    this.r = renderer;
    this.W = W;
    this.H = H;
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace };
    this.rtScene = new THREE.WebGLRenderTarget(W, H, { ...hf, samples: 4, depthBuffer: true });
    this.rtSketchSrc = new THREE.WebGLRenderTarget(W, H, { ...hf, samples: 4, depthBuffer: true });
    this.rtAccum = new THREE.WebGLRenderTarget(W, H, { ...hf, depthBuffer: false });
    this.rtSketch = new THREE.WebGLRenderTarget(W, H, { ...hf, depthBuffer: false });
    this.bloom = [];
    let w = W >> 1, h = H >> 1;
    for (let i = 0; i < 6; i++) {
      this.bloom.push({
        down: new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false }),
        up: new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false }),
        w, h,
      });
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
    for (const t of [this.rtAccum, this.rtSketch, ...this.bloom.flatMap((b) => [b.down, b.up])]) {
      t.texture.minFilter = THREE.LinearFilter;
      t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
    }
    this.quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
    this.quad.geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.addMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc; uniform float uW; varying vec2 vUv;
      void main() { gl_FragColor = texture2D(tSrc, vUv) * uW; }`,
      { tSrc: { value: null }, uW: { value: 1 } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });

    // sketch: view-space normals (rgb) + view depth (a) → ink on paper (display-referred)
    this.sketchMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uRes; uniform float uW; uniform float uInk; uniform float uGrid;
      varying vec2 vUv;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
      vec4 S(vec2 o) { return texture2D(tSrc, vUv + o / uRes); }
      void main() {
        vec4 c = S(vec2(0.0));
        float far = 900.0;
        bool hit = c.a > 0.0 && c.a < far;
        float edge = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          vec2 o = vec2(cos(a), sin(a)) * 1.35;
          vec4 s = S(o);
          bool sh = s.a > 0.0 && s.a < far;
          float nd = hit && sh ? length(s.rgb - c.rgb) : (hit != sh ? 1.0 : 0.0);
          float dd = hit && sh ? abs(s.a - c.a) / max(c.a, 0.05) : 0.0;
          edge = max(edge, max(smoothstep(0.22, 0.5, nd), smoothstep(0.035, 0.09, dd)));
        }
        // paper
        vec2 px = vUv * uRes;
        float fib = n2(px * vec2(0.9, 0.08)) * 0.5 + n2(px * 0.35) * 0.5;
        vec3 paper = vec3(0.955, 0.94, 0.905) - 0.028 * fib;
        // faint drafting grid
        vec2 g = abs(fract(px / 48.0 + 0.5) - 0.5) * 48.0;
        float grid = (1.0 - smoothstep(0.0, 0.9, min(g.x, g.y))) * uGrid;
        paper = mix(paper, vec3(0.62, 0.72, 0.82), grid * 0.35);
        vec3 col = paper;
        if (hit) {
          // soft tone + hatching on the side away from the light
          vec3 n = normalize(c.rgb * 2.0 - 1.0);
          float lit = dot(n, normalize(vec3(-0.4, 0.6, 0.7))) * 0.5 + 0.5;
          float hatch = step(0.5, fract((px.x + px.y) / 5.0)) * (1.0 - smoothstep(0.25, 0.55, lit));
          col = mix(col, vec3(0.86, 0.85, 0.83), 0.35 + 0.2 * (1.0 - lit));
          col = mix(col, vec3(0.42, 0.44, 0.5), hatch * 0.18);
        }
        vec3 ink = vec3(0.13, 0.14, 0.19);
        col = mix(col, ink, edge * uInk);
        gl_FragColor = vec4(col * uW, uW);
      }`,
      { tSrc: { value: null }, uRes: { value: new THREE.Vector2(W, H) }, uW: { value: 1 }, uInk: { value: 1 }, uGrid: { value: 1 } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });

    this.brightMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc; uniform float uThresh; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb;
        float l = max(c.r, max(c.g, c.b));
        float k = max(l - uThresh, 0.0) / max(l, 1e-4);
        gl_FragColor = vec4(min(c * k, vec3(60.0)), 1.0);
      }`, { tSrc: { value: null }, uThresh: { value: 1.0 } });
    this.downMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 0.125;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1, -1)).rgb * 0.125;
        c += texture2D(tSrc, vUv + uTexel * vec2(1, -1)).rgb * 0.125;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1, 1)).rgb * 0.125;
        c += texture2D(tSrc, vUv + uTexel * vec2(1, 1)).rgb * 0.125;
        c += texture2D(tSrc, vUv + uTexel * vec2(-2, 0)).rgb * 0.0625;
        c += texture2D(tSrc, vUv + uTexel * vec2(2, 0)).rgb * 0.0625;
        c += texture2D(tSrc, vUv + uTexel * vec2(0, -2)).rgb * 0.0625;
        c += texture2D(tSrc, vUv + uTexel * vec2(0, 2)).rgb * 0.0625;
        gl_FragColor = vec4(c, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = quadMat(/* glsl */ `
      uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uMix; varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture2D(tSrc, vUv + uTexel * vec2(-1, -1)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(0, -1)).rgb * 2.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(1, -1)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1, 0)).rgb * 2.0;
        c += texture2D(tSrc, vUv).rgb * 4.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(1, 0)).rgb * 2.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1, 1)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(0, 1)).rgb * 2.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(1, 1)).rgb;
        gl_FragColor = vec4(c / 16.0 + texture2D(tBase, vUv).rgb * uMix, 1.0);
      }`, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });

    this.finalMat = quadMat(/* glsl */ `
      uniform sampler2D tColor; uniform sampler2D tBloom; uniform sampler2D tSketch;
      uniform float uExposure, uBloom, uSketchMix, uWipe, uWipeSoft, uGrain, uFrame, uVignette, uFade, uFlare;
      uniform vec2 uRes; uniform vec3 uSunScreen; uniform vec3 uLift, uGamma, uGain; uniform float uSat, uContrast;
      uniform vec3 uFadeColor;
      varying vec2 vUv;
      vec3 aces(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        vec2 uv = vUv;
        // slight chromatic aberration toward the edges
        vec2 dc = uv - 0.5;
        float ca = dot(dc, dc) * 0.0035;
        vec3 col;
        col.r = texture2D(tColor, uv - dc * ca).r;
        col.g = texture2D(tColor, uv).g;
        col.b = texture2D(tColor, uv + dc * ca).b;
        vec3 bl = texture2D(tBloom, uv).rgb;
        col += bl * uBloom;
        // sun flare: streak + halo + ghosts, gated by how much sun is actually visible
        if (uFlare > 0.0 && uSunScreen.z > 0.0) {
          vec2 sp = uSunScreen.xy;
          float vis = clamp(texture2D(tBloom, sp).r * 0.02, 0.0, 1.0) * uFlare;
          vec2 d = uv - sp;
          d.x *= uRes.x / uRes.y;
          float streak = exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 2.2);
          float halo = exp(-pow(length(d) - 0.22, 2.0) * 900.0) * 0.12;
          vec3 fl = vec3(1.0, 0.6, 0.3) * streak * 1.6 + vec3(0.6, 0.8, 1.0) * halo;
          for (int i = 1; i <= 4; i++) {
            vec2 gd = uv - (vec2(0.5) + (vec2(0.5) - sp) * (0.3 * float(i)));
            gd.x *= uRes.x / uRes.y;
            fl += vec3(0.9, 0.55, 0.3) * exp(-dot(gd, gd) * (3000.0 / float(i))) * 0.15;
          }
          col += fl * vis * 3.0;
        }
        col *= uExposure;
        col = aces(col);
        // grade: lift / gamma / gain, contrast, saturation (display-referred)
        col = pow(col, vec3(1.0 / 2.2));
        col = col * uGain + uLift * (1.0 - col);
        col = pow(max(col, 0.0), 1.0 / uGamma);
        col = (col - 0.5) * uContrast + 0.5;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        // vignette
        float v = smoothstep(1.15, 0.35, length(dc * vec2(1.0, 0.82)) * 1.35);
        col *= mix(1.0, v, uVignette);
        // sketch / paint wipe (sketch is already display-referred)
        vec4 sk = texture2D(tSketch, uv);
        vec3 skc = sk.a > 0.0 ? sk.rgb / sk.a : vec3(0.955, 0.94, 0.905);
        float w = uSketchMix;
        if (uWipe > -1.0) {
          // painted to the left of the wipe front, still sketch to the right; brushy edge
          float edge = uv.x + (n2(uv * vec2(3.0, 9.0)) - 0.5) * 0.05 + (n2(uv * vec2(60.0, 3.0)) - 0.5) * 0.012 + (uv.y - 0.5) * 0.16;
          w = smoothstep(uWipe - uWipeSoft, uWipe + uWipeSoft, edge);
        }
        col = mix(col, skc, clamp(w, 0.0, 1.0));
        // fade
        col = mix(col, uFadeColor, uFade);
        // grain
        float gr = h2(uv * uRes + vec2(uFrame * 17.31, uFrame * 9.17)) - 0.5;
        col += gr * uGrain * (0.6 + 0.4 * (1.0 - l));
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`,
      {
        tColor: { value: null }, tBloom: { value: null }, tSketch: { value: null },
        uExposure: { value: 1 }, uBloom: { value: 0.08 }, uSketchMix: { value: 0 }, uWipe: { value: -2 }, uWipeSoft: { value: 0.05 },
        uGrain: { value: 0.025 }, uFrame: { value: 0 }, uVignette: { value: 0.35 }, uFade: { value: 0 }, uFadeColor: { value: new THREE.Color(0, 0, 0) },
        uFlare: { value: 0 }, uRes: { value: new THREE.Vector2(W, H) }, uSunScreen: { value: new THREE.Vector3(0.5, 0.5, 0) },
        uLift: { value: new THREE.Vector3(0.02, 0.015, 0.035) }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
        uSat: { value: 1.06 }, uContrast: { value: 1.04 },
      });
  }

  pass(mat, target, clear = false) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    if (clear) this.r.clear(true, false, false);
    this.r.render(this.qScene, this.qCam);
  }

  // drawSub(k, n) must update the scene/camera for sub-frame k of n and return
  // { pbr: bool, sketch: bool }. The pipeline renders + accumulates each requested image.
  render(scene, camera, n, drawSub, post) {
    const r = this.r;
    const prevAuto = r.autoClear;
    r.autoClear = false; // accumulation passes must add, not overwrite
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rtAccum);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setRenderTarget(this.rtSketch);
    r.clear(true, false, false);
    let anyPbr = false, anySketch = false;
    for (let k = 0; k < n; k++) {
      const want = drawSub(k, n);
      if (want.pbr) {
        anyPbr = true;
        shared.uSketch.value = 0;
        if (want.beforePbr) want.beforePbr();
        r.setRenderTarget(this.rtScene);
        r.setClearColor(0x000000, 1);
        r.clear(true, true, true);
        r.render(scene, camera);
        this.addMat.uniforms.tSrc.value = this.rtScene.texture;
        this.addMat.uniforms.uW.value = 1 / n;
        this.pass(this.addMat, this.rtAccum);
      }
      if (want.sketch) {
        anySketch = true;
        shared.uSketch.value = 1;
        if (want.beforeSketch) want.beforeSketch();
        r.setRenderTarget(this.rtSketchSrc);
        r.setClearColor(0x000000, 0);
        r.clear(true, true, true);
        r.render(scene, camera);
        shared.uSketch.value = 0;
        if (want.afterSketch) want.afterSketch();
        this.sketchMat.uniforms.tSrc.value = this.rtSketchSrc.texture;
        this.sketchMat.uniforms.uW.value = 1 / n;
        this.sketchMat.uniforms.uInk.value = post.ink ?? 1;
        this.sketchMat.uniforms.uGrid.value = post.grid ?? 1;
        this.pass(this.sketchMat, this.rtSketch);
      }
    }
    // bloom
    const b = this.bloom;
    this.brightMat.uniforms.tSrc.value = this.rtAccum.texture;
    this.brightMat.uniforms.uThresh.value = post.bloomThreshold ?? 1.2;
    this.pass(this.brightMat, b[0].down);
    for (let i = 1; i < b.length; i++) {
      this.downMat.uniforms.tSrc.value = b[i - 1].down.texture;
      this.downMat.uniforms.uTexel.value.set(1 / b[i - 1].w, 1 / b[i - 1].h);
      this.pass(this.downMat, b[i].down);
    }
    let src = b[b.length - 1].down;
    for (let i = b.length - 2; i >= 0; i--) {
      this.upMat.uniforms.tSrc.value = src.texture;
      this.upMat.uniforms.tBase.value = b[i].down.texture;
      this.upMat.uniforms.uTexel.value.set(1 / b[i + 1].w, 1 / b[i + 1].h);
      this.upMat.uniforms.uMix.value = 1;
      this.pass(this.upMat, b[i].up);
      src = b[i].up;
    }
    const f = this.finalMat.uniforms;
    f.tColor.value = this.rtAccum.texture;
    f.tBloom.value = b[0].up.texture;
    f.tSketch.value = this.rtSketch.texture;
    f.uExposure.value = post.exposure ?? 1;
    f.uBloom.value = post.bloom ?? 0.12;
    f.uSketchMix.value = anySketch ? (post.sketchMix ?? (anyPbr ? 0 : 1)) : 0;
    f.uWipe.value = post.wipe ?? -2;
    f.uWipeSoft.value = post.wipeSoft ?? 0.06;
    f.uGrain.value = post.grain ?? 0.022;
    f.uFrame.value = post.frame ?? 0;
    f.uVignette.value = post.vignette ?? 0.35;
    f.uFade.value = post.fade ?? 0;
    if (post.fadeColor) f.uFadeColor.value.copy(post.fadeColor);
    f.uFlare.value = post.flare ?? 0;
    if (post.sunScreen) f.uSunScreen.value.copy(post.sunScreen);
    if (post.lift) f.uLift.value.copy(post.lift);
    if (post.gain) f.uGain.value.copy(post.gain);
    if (post.gamma) f.uGamma.value.copy(post.gamma);
    if (post.sat != null) f.uSat.value = post.sat;
    if (post.contrast != null) f.uContrast.value = post.contrast;
    this.pass(this.finalMat, null);
    r.setClearColor(prevClear, prevAlpha);
    r.autoClear = prevAuto;
  }
}
