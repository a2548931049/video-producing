// Dev-only: render chosen instants straight from the canvas, without the HyperFrames runtime.
//   node dev/shoot.cjs <outDir> 0,0.9,1.6 [--sheet name.jpg] [--cols 4] [--scale 0.5]
// Needs Playwright (preinstalled in the cloud container) and ffmpeg for --sheet.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2", ".wav": "audio/wav", ".json": "application/json" };

const args = process.argv.slice(2);
const outDir = path.resolve(args[0] || "snapshots/dev");
const times = (args[1] || "0").split(",").map(Number);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.evaluate(() => window.NP.ready);
  const files = [];
  for (const t of times) {
    const info = await page.evaluate((t) => {
      const t0 = performance.now();
      window.NP.renderFrame(t);
      const ms = performance.now() - t0;
      return { ms, n: window.NP.lastSamples, data: document.getElementById("stage").toDataURL("image/png") };
    }, t);
    const file = path.join(outDir, `t${t.toFixed(2).padStart(5, "0")}.png`);
    fs.writeFileSync(file, Buffer.from(info.data.split(",")[1], "base64"));
    files.push(file);
    console.log(`t=${t.toFixed(2)}  ${info.ms.toFixed(0)} ms  samples=${info.n}`);
  }
  await browser.close();
  server.close();
  const sheet = opt("--sheet");
  if (sheet) {
    const cols = Number(opt("--cols", 4));
    const scale = Number(opt("--scale", 0.5));
    const rows = Math.ceil(files.length / cols);
    const w = Math.round(1920 * scale);
    const h = Math.round(1080 * scale);
    const inputs = files.flatMap((f) => ["-i", f]);
    const filters = files.map((_, i) => `[${i}:v]scale=${w}:${h},drawtext=text='${times[i].toFixed(2)}s':x=12:y=10:fontsize=${Math.round(28 * scale * 1.6)}:fontcolor=white:box=1:boxcolor=black@0.5[v${i}]`);
    const pads = [];
    for (let i = files.length; i < rows * cols; i++) pads.push(`color=c=black:s=${w}x${h}:d=1[v${i}]`);
    const all = Array.from({ length: rows * cols }, (_, i) => `[v${i}]`).join("");
    const graph = [...filters, ...pads, `${all}xstack=inputs=${rows * cols}:layout=${Array.from({ length: rows * cols }, (_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`).join("|")}[out]`].join(";");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-q:v", "3", path.resolve(sheet)]);
    console.log("sheet:", path.resolve(sheet));
  }
})();
