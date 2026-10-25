// DOM layer over the WebGL canvas: the opening doodle, captions, build callouts, the drafting
// title block and the end title. Every style is a pure function of t (set from renderAt).
import * as THREE from "three";
import { rng, clamp, lerp, smoothstep, seg, easeOutCubic, easeInOutSine, TAU } from "./util.js";
import { T } from "./story.js";

const SVGNS = "http://www.w3.org/2000/svg";
const INK = "#20223a";
let els = null;

function el(tag, attrs = {}, parent = null, ns = false) {
  const e = ns ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}

// wobbly hand-drawn path helpers (seeded, deterministic)
function wobblyCircle(cx, cy, r, R, turns = 1.06) {
  const pts = [];
  const n = 44;
  const ph = R() * TAU;
  for (let i = 0; i <= n * turns; i++) {
    const a = ph + (i / n) * TAU;
    const rr = r * (1 + 0.035 * Math.sin(a * 3 + R() * 0.4) + (R() - 0.5) * 0.02);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.97]);
  }
  return smoothPath(pts);
}
function wobblyLine(pts, R, j = 3) {
  const out = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 26));
    for (let i = 0; i < n; i++) {
      const u = i / n;
      out.push([lerp(x0, x1, u) + (R() - 0.5) * j, lerp(y0, y1, u) + (R() - 0.5) * j]);
    }
  }
  out.push(pts[pts.length - 1]);
  return smoothPath(out);
}
function smoothPath(p) {
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    d += ` Q${p[i][0].toFixed(1)},${p[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const l = p[p.length - 1];
  d += ` L${l[0].toFixed(1)},${l[1].toFixed(1)}`;
  return d;
}

// anchors: { rear:[x,y], front:[x,y], r, bb:[x,y], seat:[x,y], bar:[x,y], head:[x,y], tip:[x,y] } in px
export function initOverlay(root, anchors, info) {
  const ov = el("div", { id: "ov" }, root);
  // ---- doodle
  const svg = el("svg", { id: "doodle", viewBox: "0 0 1920 1080", width: "1920", height: "1080" }, ov, true);
  const R = rng(2025);
  const A = anchors;
  const strokes = [];
  const add = (d, w = 5.2) => {
    const p = el("path", { d, fill: "none", stroke: INK, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg, true);
    strokes.push(p);
    return p;
  };
  const r = A.r;
  add(wobblyCircle(A.rear[0], A.rear[1], r, R));
  add(wobblyCircle(A.front[0], A.front[1], r, R));
  // crude frame: chainstay, seat tube, top tube, down tube, fork
  add(wobblyLine([A.rear, A.bb, A.seat, A.rear], R));
  add(wobblyLine([A.seat, [A.bar[0] - 18, A.bar[1] + 22], A.bb], R));
  add(wobblyLine([[A.bar[0] - 18, A.bar[1] + 22], A.front], R));
  add(wobblyLine([[A.bar[0] - 30, A.bar[1] + 2], [A.bar[0] + 8, A.bar[1] - 14], [A.bar[0] + 30, A.bar[1] - 6]], R), 6);
  add(wobblyLine([[A.seat[0] - 34, A.seat[1] - 8], [A.seat[0] + 30, A.seat[1] - 6]], R), 8);
  // pelican: blob body, stick neck, round head, big triangle beak with a pouch, legs to the pedals
  const bx = A.seat[0] + 30, by = A.seat[1] - 70;
  const body = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * TAU * 1.04 + 0.4;
    body.push([bx + Math.cos(a) * 118 * (1 + (R() - 0.5) * 0.05), by + Math.sin(a) * 62 * (1 + (R() - 0.5) * 0.05)]);
  }
  add(smoothPath(body));
  add(wobblyLine([[bx - 40, by - 10], [bx + 10, by + 22], [bx + 70, by + 4]], R), 4.5); // wing
  const hx = A.head[0], hy = A.head[1];
  add(wobblyLine([[bx + 92, by - 30], [bx + 120, by - 120], [hx - 20, hy + 40], [hx - 4, hy + 18]], R));
  add(wobblyCircle(hx, hy, 34, R, 1.02));
  add(wobblyLine([[hx + 28, hy - 6], [A.tip[0], A.tip[1]], [hx + 30, hy + 16]], R), 5);
  add(wobblyLine([[hx + 30, hy + 16], [hx + 90, hy + 62], [A.tip[0] - 40, A.tip[1] + 10]], R), 4.5); // pouch
  const eye = el("circle", { cx: hx + 8, cy: hy - 8, r: 6, fill: INK }, svg, true);
  add(wobblyLine([[bx - 20, by + 50], [A.bb[0] - 30, A.bb[1] + 30]], R));
  add(wobblyLine([[bx + 30, by + 56], [A.bb[0] + 34, A.bb[1] - 26]], R));
  strokes.forEach((p) => {
    const L = p.getTotalLength();
    p.dataset.len = L;
    p.style.strokeDasharray = `${L} ${L}`;
    p.style.strokeDashoffset = `${L}`;
  });

  // ---- captions
  const cap1 = el("div", { class: "cap", id: "cap1", text: "每个新模型，都要画一只骑自行车的鹈鹕。" }, ov);
  const cap2 = el("div", { class: "cap cap-strong", id: "cap2", text: "这一次，慢慢画。" }, ov);

  // ---- build callouts (anchored to 3D points every frame)
  const lines = el("svg", { id: "leaders", viewBox: "0 0 1920 1080", width: "1920", height: "1080" }, ov, true);
  const callouts = [
    { key: "ring", text: "牙盘 48T · 飞轮 18T", t0: 7.2, dx: 170, dy: 120 },
    { key: "spoke", text: "辐条 64 根 · 三交叉编法", t0: 7.65, dx: -250, dy: 150 },
    { key: "chain", text: `链条 ${info.links} 节`, t0: 8.05, dx: -60, dy: 205 },
    { key: "horn", text: "繁殖期的喙角", t0: 9.15, dx: -230, dy: -70 },
    { key: "feather", text: `羽毛 ${info.feathers.toLocaleString("en-US")} 片`, t0: 9.75, dx: -300, dy: -150 },
  ].map((c) => {
    const box = el("div", { class: "callout" }, ov);
    el("span", { class: "dot-label", text: c.text }, box);
    const line = el("polyline", { fill: "none", stroke: INK, "stroke-width": "2.5", points: "0,0 0,0" }, lines, true);
    const dot = el("circle", { r: "6", fill: "none", stroke: INK, "stroke-width": "2.5" }, lines, true);
    return { ...c, box, line, dot };
  });

  // ---- drafting title block
  const tb = el("div", { id: "titleblock" }, ov);
  tb.innerHTML = `
    <div class="tb-row"><span class="tb-k">图号</span><span class="tb-v mono">PB-01</span><span class="tb-k">比例</span><span class="tb-v mono">1 : 8</span></div>
    <div class="tb-row"><span class="tb-k">名称</span><span class="tb-v wide">鹈鹕骑自行车</span></div>
    <div class="tb-row"><span class="tb-k">绘图</span><span class="tb-v wide mono">Claude Opus 5.5</span></div>
    <div class="tb-row"><span class="tb-k">日期</span><span class="tb-v wide mono">2026.10.08</span></div>`;

  // ---- end title
  const title = el("div", { id: "title" }, ov);
  const chars = "鹈鹕骑自行车".split("").map((ch) => el("span", { class: "tch", text: ch }, title));
  const en = el("div", { id: "title-en", class: "mono", text: "A PELICAN RIDING A BICYCLE" }, ov);
  const tag = el("div", { id: "title-tag", text: "慢慢画，不着急。" }, ov);
  const credit = el("div", { id: "credit", class: "mono", text: "prompt @AxtonLiu  ·  Claude Opus 5.5  ·  three.js + HyperFrames" }, ov);

  els = { ov, svg, strokes, eye, cap1, cap2, callouts, lines, tb, title, chars, en, tag, credit };
}

const fade = (t, a, b, c, d) => clamp(Math.min(seg(t, a, b), 1 - seg(t, c, d)));

export function overlay(t, ctx) {
  if (!els) return;
  const E = els;
  // ---- doodle: strokes draw in sequence, then the drawing bobs along, then dissolves into the 3D lines
  const n = E.strokes.length;
  E.strokes.forEach((p, i) => {
    const a = 0.35 + i * 0.17, b = a + 0.32;
    const k = easeOutCubic(seg(t, a, b));
    const L = +p.dataset.len;
    p.style.strokeDashoffset = `${(1 - k) * L}`;
  });
  E.eye.style.opacity = t > 0.35 + n * 0.17 ? 1 : 0;
  const bob = Math.sin(t * 7.5) * 3 * smoothstep(2.9, 3.3, t);
  const doodleA = 1 - smoothstep(4.25, 4.95, t);
  E.svg.style.opacity = doodleA;
  E.svg.style.transform = `translateY(${bob.toFixed(2)}px)`;
  E.svg.style.visibility = doodleA > 0.001 ? "visible" : "hidden";

  // ---- captions
  const c1 = fade(t, 0.75, 1.25, 3.05, 3.45);
  E.cap1.style.opacity = c1;
  E.cap1.style.transform = `translateY(${(1 - easeOutCubic(seg(t, 0.75, 1.35))) * 14}px)`;
  const c2 = fade(t, 3.35, 3.8, 5.6, 6.2);
  E.cap2.style.opacity = c2;
  E.cap2.style.transform = `translateY(${(1 - easeOutCubic(seg(t, 3.35, 3.95))) * 14}px)`;

  // ---- callouts
  const anyCallout = t > 7 && t < T.wipe0 + 0.5;
  E.lines.style.visibility = anyCallout ? "visible" : "hidden";
  for (const c of E.callouts) {
    const a = fade(t, c.t0, c.t0 + 0.35, T.wipe0 - 0.15, T.wipe0 + 0.2);
    if (a <= 0.001 || !ctx.anchorPx) {
      c.box.style.opacity = 0;
      c.line.style.opacity = 0;
      c.dot.style.opacity = 0;
      continue;
    }
    const p = ctx.anchorPx(c.key);
    const grow = easeOutCubic(seg(t, c.t0, c.t0 + 0.45));
    const lx = p[0] + c.dx * grow, ly = p[1] + c.dy * grow;
    const elbowX = lx - Math.sign(c.dx) * 0;
    c.line.setAttribute("points", `${p[0].toFixed(1)},${p[1].toFixed(1)} ${elbowX.toFixed(1)},${ly.toFixed(1)}`);
    c.dot.setAttribute("cx", p[0].toFixed(1));
    c.dot.setAttribute("cy", p[1].toFixed(1));
    c.line.style.opacity = a;
    c.dot.style.opacity = a;
    c.box.style.opacity = a * smoothstep(c.t0 + 0.15, c.t0 + 0.45, t);
    const right = c.dx > 0;
    c.box.style.left = `${(right ? lx + 10 : lx - 10).toFixed(1)}px`;
    c.box.style.top = `${ly.toFixed(1)}px`;
    c.box.style.transform = `translate(${right ? "0" : "-100%"}, -50%)`;
  }

  // ---- title block
  const tbA = fade(t, 5.1, 5.7, T.wipe0 - 0.1, T.wipe0 + 0.35);
  E.tb.style.opacity = tbA;
  E.tb.style.visibility = tbA > 0.001 ? "visible" : "hidden";

  // ---- end title
  E.chars.forEach((ch, i) => {
    const a0 = T.title + i * 0.12;
    const k = easeOutCubic(seg(t, a0, a0 + 0.7));
    ch.style.opacity = k;
    ch.style.transform = `translateY(${((1 - k) * 22).toFixed(1)}px)`;
    ch.style.filter = `blur(${((1 - k) * 6).toFixed(2)}px)`;
  });
  const enA = easeOutCubic(seg(t, T.title + 0.9, T.title + 1.6));
  E.en.style.opacity = enA;
  E.en.style.letterSpacing = `${lerp(0.62, 0.42, enA).toFixed(3)}em`;
  E.tag.style.opacity = easeOutCubic(seg(t, T.title + 1.6, T.title + 2.3));
  E.credit.style.opacity = easeOutCubic(seg(t, T.title + 2.4, T.title + 3.0));
  const titleOn = t > T.title - 0.1;
  for (const e of [E.title, E.en, E.tag, E.credit]) e.style.visibility = titleOn ? "visible" : "hidden";
}
