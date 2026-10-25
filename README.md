# Opus 5.5 做视频 · 云端工作台

这个仓库在 Claude Code 云端会话里使用：每次会话会把仓库克隆到一个临时 Linux 容器（`/home/user/video-producing`），会话结束后容器会被回收。**改动要提交并推送到 GitHub 才会保留**，渲染出的视频不进仓库，需要时重新渲染。

```
video-producing/
├─ pelican-bicycle/             ← 鹈鹕骑自行车（HyperFrames + Three.js，3D 示例）
│  ├─ BRIEF.md / STORYBOARD.md  ← 需求和分镜
│  ├─ src/                      ← 场景、模型、镜头、后期
│  ├─ tools/make-audio.mjs      ← 用代码合成配乐（生成 assets/score.wav）
│  └─ snapshots/                ← 检查用的拼图
├─ showreel/                    ← 样片项目（HyperFrames，2D）
│  ├─ index.html                ← 整个视频：HTML + GSAP 时间轴 + Canvas 的 draw(t)
│  ├─ tools/make-music.mjs      ← 用代码合成的 120 BPM 配乐（没用任何采样）
│  └─ snapshots/                ← 检查用的截帧和拼图
├─ norilsk-putorana/            ← 10 秒一镜到底：诺里尔斯克 → 普托拉纳高原（HyperFrames + Canvas，2.5D 剪纸）
│  ├─ BRIEF.md / STORYBOARD.md / REVIEW.md
│  ├─ src/                      ← 镜头轨道、2.5D 渲染器、城市、高原、片名、运动模糊合成
│  ├─ tools/make-audio.mjs      ← 风声、嗡声、呼啸和铺底和弦（生成 assets/score.wav）
│  └─ dev/shoot.cjs             ← 不经 HyperFrames 直接截任意时刻的帧、拼图
└─ prompt-collections/          ← 两个开源 prompt 合集（不在仓库里，按需 clone）
```

> 仓库不含视频、音频和 prompt 合集。音频用各项目 `tools/` 里的脚本重新生成（会写到 `assets/` 下，如 `assets/score.wav`、`assets/music.wav`），视频用 `npx hyperframes render` 重新渲染，成片放 `renders/`（已被 `.gitignore` 忽略）。prompt 合集需要时再 clone：
>
> ```bash
> git clone https://github.com/yihui-dev/awesome-opus5-5-videos prompt-collections/awesome-opus5-5-videos
> git clone https://github.com/guanmo-ai/awesome-ai-motion prompt-collections/awesome-ai-motion
> ```

新视频不一定要做 3D：用 HTML/CSS + GSAP + Canvas 的 2D 动效（像 `showreel`）渲染更快，也不依赖 WebGL。

## 云端容器里的环境

| 东西 | 状态 |
|---|---|
| FFmpeg / FFprobe | 容器预装，6.1.1 |
| Node.js | 容器预装，v22（HyperFrames 要求 22+） |
| HyperFrames CLI | 不用安装，`npx hyperframes@0.8.141 …` 首次运行时自动下载 |
| 渲染用浏览器 | 容器预装的 chrome-headless-shell，需设置 `HYPERFRAMES_BROWSER_PATH`（见下方备注） |
| GPU | 没有。WebGL 走软件渲染（SwiftShader），3D 场景渲染会比较慢 |
| 配音 / 转录 / AI 配乐 | 没装（可选：Kokoro TTS、whisper.cpp、MusicGen），需要时再装 |

> 容器是临时的：会话里另外安装的东西、设置的环境变量，会话结束后都会消失。需要每次都有的，可以写进云环境设置里的启动脚本。

## 做一个新视频（最省事的方式）

1. 在 Claude Code 云端会话里选中这个仓库，把 effort 调到 **max**（默认的 medium 效果明显差）。
2. 发一条这样的消息：

   ```text
   在仓库里用 npx hyperframes init 新建项目 my-video，
   做一个 15 秒、1920×1080 的动效视频，主题是 ……，给 …… 看。
   风格：……（配色 / 字体 / 节奏）。音乐用代码合成，画面切换卡在节拍上。
   先给我分镜和 4 个关键帧，我确认后再写，最后渲染成 MP4 发给我。
   ```

3. 它会自己写 `index.html`、跑 `check`、截帧检查，最后渲染。代码和分镜提交推送到 GitHub，MP4 直接发给你下载。

## 好用的 prompt 结构

一句话 prompt 能出效果，但几百个人用同一句，做出来的配色、网格、结尾 logo 都差不多。想做得不一样，就把下面几项写清楚：

1. **时长 / 主题 / 观众**：做一个 N 秒关于 X 的视频，给 Y 看
2. **画幅**：1920×1080（横屏）或 1080×1920（竖屏）
3. **确定性**：画面只能由时间 t 决定，不用 `Date.now()`、不用无种子的随机数、不在渲染时联网
4. **风格**：3 种以内的强调色 + 1 种字体 + 一个运动关键词（弹性 / 硬切 / 丝滑）
5. **素材和事实**：只用我提供的文字、logo、截图
6. **声音**：BPM 多少，哪几拍硬切；或者给配音稿
7. **流程**：先分镜，确认后再写，渲染前先截帧自查

## 合集里值得一看的 prompt

去 `prompt-collections/awesome-opus5-5-videos/prompts/` 打开对应文件：

| 文件 | 类型 | 看点 |
|---|---|---|
| `ajith-io-890146.md` | 动效 | 原始的爆火一句话：15 秒 showreel，go all out |
| `heyiammallik-293397.md` | 动效 / Three.js | 让它先分析作品集、研究趋势，觉得不像专业水平就推翻重来 |
| `itsolelehmann-762215.md` | 动效 | 一句话描述场景：火车窗外四季流转，韦斯·安德森风格 |
| `ror-fly-880547.md` | 讲解 | 鸡尾酒配方动画，从空杯到成品，30 秒 |
| `linearuncle-971663.md` | 讲解 / Manim | 中文：用 Manim 讲导数，配 edge-tts 配音 |
| `axtonliu-290566.md` | 3D / Shader | 中文：画一个最精细的“鹈鹕骑自行车”动画，慢慢画不着急 |
| `michaelzsguo-782312.md` | 3D / Shader | 2 分钟沙画讲 250 年美国历史，带配乐 |
| `dannnnnok-716687.md` | 3D | “要给 1 万人看”式的激将法 prompt |

按类别看：`awesome-opus5-5-videos` 里有 motion 317、explainer 67、interactive 70、3d 59 条。`awesome-ai-motion` 的 `browse/` 目录按产品宣传、讲解、角色动画、音乐 MV 等分好了类。

## 常用命令（在项目目录里运行）

先设置渲染用的浏览器（每个新会话都要设一次）：

```bash
export HYPERFRAMES_BROWSER_PATH=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
```

```bash
npx hyperframes check            # 检查：lint + 运行时 + 版式 + 对比度
npx hyperframes snapshot --at 1,5,10   # 截指定时间点的帧（注意：会覆盖 snapshots/ 里已有的截帧）
npx hyperframes render --quality draft --output renders/draft.mp4      # 快速草稿
npx hyperframes render --quality delivery --output renders/final.mp4   # 成片
npx hyperframes catalog --query "reveal a headline one line at a time" # 找现成动效（用英文搜）
npx hyperframes doctor           # 检查环境缺什么
```

`npx hyperframes preview`（浏览器里的 Studio 时间轴编辑）需要在自己电脑上运行，云端容器里没法直接打开。

重新生成配乐：`node tools/make-music.mjs`（showreel）或 `node tools/make-audio.mjs`（pelican-bicycle）。

## 备注

- **`HYPERFRAMES_BROWSER_PATH`**：HyperFrames 默认会去 Google 下载 chrome-headless-shell，云端容器里不需要，直接指向容器预装的那个（上面的命令）。不设的话 `doctor` 会报 Chrome 缺失、渲染失败。
- **⚠️ GSAP 从 CDN 加载会失败**：两个项目的 `index.html` 都用 `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/...">` 加载 GSAP，但云端环境的网络屏蔽了 `cdn.jsdelivr.net`，页面报 `gsap is not defined`，截帧只有背景。npm 源是通的，解决办法是从 npm 下载 GSAP 放到 `assets/vendor/`，改成引用本地文件（同时也符合"渲染时不联网"的要求）。新项目也建议这样做。
- HyperFrames 默认会发送匿名使用统计，不想发可以运行 `npx hyperframes telemetry disable`。
- 配音（TTS）和转录是可选功能，没装。需要时让 Claude 用 `/media-use` 帮你配，或者按 `npx hyperframes doctor` 的提示安装。
- 合集里的 prompt 版权属于各自的原作者，自己玩随便用；要公开发布作品，最好注明出处。
