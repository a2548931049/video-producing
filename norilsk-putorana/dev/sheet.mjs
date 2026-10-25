// Dev-only: render film times from dev/lab.html into PNGs + a labelled contact sheet.
// usage: node dev/sheet.mjs <outDir> <q> <t1,t2,...> [cols]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/opt/node-tools/node_modules/playwright");
const [outDir, q = "1", list, cols = "4"] = process.argv.slice(2);
const times = list.split(",").map(Number);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.HYPERFRAMES_BROWSER_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on("console", (m) => { if (!/GPU stall|GL Driver/.test(m.text())) logs.push(m.text()); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:8791/dev/lab.html?q=${q}`);
await page.waitForFunction(() => document.title === "ready" || document.title.startsWith("error"), null, { timeout: 600000 });
if ((await page.title()).startsWith("error")) { console.log(await page.title(), logs.join("\n")); process.exit(1); }
const files = [];
for (const t of times) {
  const t0 = Date.now();
  await page.evaluate((tt) => window.__np.renderAt(tt), t);
  const f = path.join(outDir, `t${t.toFixed(2).padStart(5, "0")}.png`);
  await page.screenshot({ path: f });
  files.push(f);
  console.log(`t=${t} ${Date.now() - t0} ms`);
}
if (logs.length) console.log(logs.slice(0, 20).join("\n"));
await browser.close();
// contact sheet via ffmpeg: scale to 480 wide, label, tile
const c = Number(cols), r = Math.ceil(files.length / c);
const inputs = files.flatMap((f) => ["-i", f]);
const chains = files.map((f, i) => `[${i}:v]scale=480:-1,drawtext=text='${path.basename(f, ".png").slice(1)}s':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.5[v${i}]`);
const pad = [];
for (let i = files.length; i < c * r; i++) pad.push(`color=black:s=480x270:d=1[v${i}]`);
const all = Array.from({ length: c * r }, (_, i) => `[v${i}]`).join("");
const graph = [...chains, ...pad, `${all}xstack=inputs=${c * r}:layout=${Array.from({ length: c * r }, (_, i) => `${(i % c) * 480}_${Math.floor(i / c) * 270}`).join("|")}[out]`].join(";");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", path.join(outDir, "sheet.jpg")]);
console.log("sheet:", path.join(outDir, "sheet.jpg"));
