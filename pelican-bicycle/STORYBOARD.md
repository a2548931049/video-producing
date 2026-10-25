---
title: 鹈鹕骑自行车 · A Pelican Riding a Bicycle
message: "大家都在画鹈鹕骑自行车；这一次，慢慢画到最精细。"
audience: 看过各家模型画"鹈鹕骑自行车"的人
duration: 40s
fps: 30
size: 1920x1080
mode: autonomous
rhythm: doodle-hook → slow-build → PAINT → ride → detail → detail → PEAK (slow-mo) → breathe → title
---

整部片是一个连续的 Three.js 世界（`src/main.js` 的 `renderAt(t)`），没有拆成子合成：所有镜头共用同一套鹈鹕、自行车、海岸。
镜头切点集中定义在 `src/story.js` 的 `T`，相机在 `src/shots.js`，文字和简笔画在 `src/overlay.js`。
配乐 120 BPM：巡航时踏频正好每秒一圈，每一次踩踏落在一拍上。

## Frame 1 — 简笔画（0–4.4s）
status: built
src: src/overlay.js (doodle), src/main.js (paper)
rules: svg-path-draw
大家熟悉的那种歪歪扭扭的 SVG 鹈鹕，在方格纸上一笔一笔画出来（15 笔，每笔配铅笔声）。
字幕："每个新模型，都要画一只骑自行车的鹈鹕。" → "这一次，慢慢画。"

## Frame 2 — 工程线稿组装（4.4–10.4s）
status: built
src: src/main.js (BUILD schedule), src/post.js (sketch pass)
rules: svg-path-draw, depth-scatter-assemble
简笔画溶解进同一位置的 3D 线稿：车架、接头、前叉、车把、轮圈、64 根三交叉辐条、牙盘、100 节链条……
再画鹕身、喙、腿，最后羽毛长出来。相机缓慢环绕。标注框写真实数字；右上角是工程图标题栏。

## Frame 3 — 上色（10.4–12.4s）
status: built
src: src/post.js (wipe)
rules: theme-crossfade-morph
笔刷从左向右扫过，线稿变成黄金时刻的海边公路；车同时起步。

## Frame 4 — 侧面跟拍（12.4–18.0s）
status: built
src: src/shots.js
blueprint: camera-journey
低机位侧跟，背后是护栏、草和海。踩踏与鼓点同步。

## Frame 5 — 传动特写（18.0–21.0s）
status: built
src: src/shots.js
rules: depth-of-field-blur
链条滚子卡进 48T 齿谷，蹼足踩着踏板；快门 45° 让链节保持清晰，浅景深。

## Frame 6 — 头部特写（21.0–24.0s）
status: built
src: src/shots.js, src/story.js (glance, blink)
rules: depth-of-field-blur
繁殖期的喙角、喉囊、眼周裸皮；鹈鹕转头看镜头，眨一次眼（第三眼睑横扫）。

## Frame 7 — 下坡与展翅（24.0–31.0s）
status: built
src: src/shots.js, src/story.js (coast, wing spread, slow motion)
rules: multi-phase-camera, ambient-glow-bloom
过坡顶，停止踩踏（飞轮棘轮声），双脚离开踏板，张开约 2.6 米的翅膀；
时间放慢到 0.32 倍，相机绕到海侧逆光，太阳在翅膀后面。

## Frame 8 — 航拍与鹈鹕群（31.0–35.6s）
status: built
src: src/shots.js, src/flock.js
blueprint: camera-journey
高处跟拍，长长的影子投在路上；镜头上摇到海上的满月，一列鹈鹕边扇边滑翔飞向月亮。

## Frame 9 — 片名（35.6–40.0s）
status: built
src: src/overlay.js (title)
rules: discrete-text-sequence
"鹈鹕骑自行车 / A PELICAN RIDING A BICYCLE / 慢慢画，不着急。"，车铃两声；画面最后淡回方格纸。
