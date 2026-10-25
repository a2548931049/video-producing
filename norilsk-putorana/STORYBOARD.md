---
title: 诺里尔斯克 → 普托拉纳 · Norilsk → Putorana
message: "一镜到底：从极夜里的诺里尔斯克，穿进 2.5 亿年前的玄武岩台地。"
duration: 10s
fps: 30
size: 1920x1080
mode: autonomous
rhythm: street-rush → archway → climb → crest (breath) → SPEED RAMP → canyon → bank → REVEAL → hold
---

一个连续的 WebGL 世界（`src/main.js` 的 `renderAt(t)`）。镜头路径和节拍在 `src/camera.js`（`BEATS`），
城市布局在 `src/layout.js`，地形在 `src/heights.js` + `src/terrain.js`，天空与极光在 `src/sky.js`。
配乐 117 BPM（`tools/make-audio.mjs`）。

## 1 — 大街（0–2.0s）
status: built
src: src/camera.js, src/city.js, src/fx.js
离地 12 m、约 70 m/s 沿大街向东。两侧是涂成大色块的九、十二层板楼，钠灯一盏盏掠过，冰晶在灯下闪。
街的尽头横着一栋彩虹色的楼，中间一个亮着灯的门洞；更远处，台地的台阶状山壁和极光。
字幕卡：69°20′ N · 88°13′ E / НОРИЛЬСК / 诺里尔斯克 · 北极圈以北约 300 公里。

## 2 — 门洞（2.0s，第 4 拍）
status: built
降到 3.7 m 穿过门洞，声音一闷。字幕卡随之退场。

## 3 — 院子与拉升（2.0–3.6s）
status: built
穿过封闭院落，贴着对面十二层楼的楼面（8 m）抬头拉升，窗户成排向下流过。

## 4 — 楼顶（3.6s，第 7 拍）
status: built
翻过女儿墙，低头：整片街区的灯、月光下的院子和楼影、冶炼厂的三根烟囱和烟羽、光柱、台地和极光一次看全。
音乐屏住一口气。

## 5 — 加速（4.1–5.4s，第 8 拍）
status: built
速度从 40 m/s 拉到约 1.6 km/s，低空掠过屋顶和城边的雪原，广角张开到垂直 66°，运动模糊拉成光线。

## 6 — 山谷（5.4–6.9s）
status: built
冲进真实的山谷，贴着北侧的玄武岩台阶（离最低一级约 40 m）掠过，极光在头顶。

## 7 — 压坡与山脊（6.9–8.5s）
status: built
向右压坡约 20°，爬上南侧山脊，背光的坡面暗下来。

## 8 — 揭示（8.5–10s）
status: built
翻过山脊，地面落下去：阶梯状的台地、冰封的湖、地平线上的低空极光弧。焦距收到垂直 44°。
字幕卡：69°21′ N · 90°01′ E / ПЛАТО ПУТОРАНА / 普托拉纳高原 · 2.5 亿年前的玄武岩台地。最后 0.2 s 淡出。
