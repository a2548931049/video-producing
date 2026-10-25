# Opus 5.5 做视频 · 本地工作台

所有东西都放在 `D:\opus-video`，和 Civ6 Mods 文件夹分开。

```
D:\opus-video
├─ pelican-bicycle\             ← 鹈鹕骑自行车（HyperFrames + Three.js）
│  ├─ BRIEF.md / STORYBOARD.md  ← 需求和分镜
│  ├─ src\                      ← 场景、模型、镜头、后期
│  ├─ tools\make-audio.mjs      ← 用代码合成配乐（生成 assets\score.wav）
│  └─ snapshots\                ← 检查用的拼图
├─ showreel\                    ← 样片项目（HyperFrames）
│  ├─ index.html                ← 整个视频：HTML + GSAP 时间轴 + Canvas 的 draw(t)
│  ├─ tools\make-music.mjs      ← 用代码合成的 120 BPM 配乐（没用任何采样）
│  ├─ assets\music.wav          ← 上面脚本生成的音频
│  ├─ renders\showreel.mp4      ← 成片
│  └─ snapshots\                ← 检查用的截帧和拼图
└─ prompt-collections\          ← 两个开源 prompt 合集（只拉了文字，没有视频）
   ├─ awesome-opus5-5-videos\   ← 513 条，prompts\*.md，data\videos.json（MIT）
   └─ awesome-ai-motion\        ← 1162 个案例，cases\*.md，中文 README（脚本是 MIT，作品版权归原作者）
```

> 这个仓库不含视频、音频和 prompt 合集。音频用各项目 `tools\` 里的脚本重新生成，视频用 `npx hyperframes render` 重新渲染。prompt 合集自己 clone：
>
> ```bash
> git clone https://github.com/yihui-dev/awesome-opus5-5-videos prompt-collections/awesome-opus5-5-videos
> git clone https://github.com/guanmo-ai/awesome-ai-motion prompt-collections/awesome-ai-motion
> ```

## 已经装好的东西

| 东西 | 位置 / 版本 |
|---|---|
| FFmpeg | 9.0.2（winget） |
| Node.js | 24.19（HyperFrames 要求 22+） |
| HyperFrames Claude Code 插件 | `hyperframes@hyperframes` 0.8.141，用户级 |
| HyperFrames 核心 skills | `~\.claude\skills\hyperframes*`、`media-use`（`init` 时自动装的） |
| 渲染用浏览器 | 系统的 Chrome，GPU 是 GTX 1650（硬件加速） |

> Skills 要**新开一个 Claude Code 会话**才会加载。

## 做一个新视频（最省事的方式）

1. 在 `D:\opus-video` 里打开终端，新建项目：

   ```bash
   npx hyperframes init my-video
   ```

2. 在 Claude 桌面版里新建一个 Code 会话，工作目录选 `D:\opus-video\my-video`，把 effort 调到 **max**（默认的 medium 效果明显差）。
3. 发一条这样的消息：

   ```text
   /hyperframes 做一个 15 秒、1920×1080 的动效视频，主题是 ……，给 …… 看。
   风格：……（配色 / 字体 / 节奏）。音乐用代码合成，画面切换卡在节拍上。
   先给我分镜和 4 个关键帧，我确认后再写，最后渲染成 MP4。
   ```

4. 它会自己写 `index.html`、跑 `check`、截帧检查，最后渲染。

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

去 `prompt-collections\awesome-opus5-5-videos\prompts\` 打开对应文件：

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

按类别看：`awesome-opus5-5-videos` 里有 motion 317、explainer 67、interactive 70、3d 59 条。`awesome-ai-motion` 的 `browse\` 目录按产品宣传、讲解、角色动画、音乐 MV 等分好了类。

## 常用命令（在项目目录里运行）

```bash
npx hyperframes preview          # 浏览器里预览 + 时间轴编辑（Studio）
npx hyperframes check            # 检查：lint + 运行时 + 版式 + 对比度
npx hyperframes snapshot --at 1,5,10   # 截指定时间点的帧
npx hyperframes render --quality draft --output renders/draft.mp4      # 快速草稿
npx hyperframes render --quality delivery --output renders/final.mp4   # 成片
npx hyperframes catalog --query "reveal a headline one line at a time" # 找现成动效（用英文搜）
```

重新生成样片的配乐：`node tools\make-music.mjs`

## 备注

- **渲染卡在 “Checking browser”**：HyperFrames 默认会去 Google 下载固定版本的 chrome-headless-shell，国内网络下会一直卡住。已经设好用户环境变量 `HYPERFRAMES_BROWSER_PATH`，指向系统 Chrome（截图模式，450 帧大约 45 秒）。新开的终端会自动生效；不想要了可以在“系统属性 → 环境变量”里删掉。

- HyperFrames 默认会发送匿名使用统计，不想发可以运行 `npx hyperframes telemetry disable`。
- 配音（TTS）和转录是可选功能，没装。需要时让 Claude 用 `/media-use` 帮你配，或者按 `npx hyperframes doctor` 的提示安装。
- 合集里的 prompt 版权属于各自的原作者，自己玩随便用；要公开发布作品，最好注明出处。
