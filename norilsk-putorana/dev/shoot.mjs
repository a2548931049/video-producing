// Dev-only: open a page in headless Chrome (SwiftShader WebGL), run calls, save PNGs.
// usage: node dev/shoot.mjs <url> <outDir> '<json array of {name, call}>'
// The page must set document.title = "ready" once it can render. Each call is evaluated in the page.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/opt/node-tools/node_modules/playwright");

const [url, outDir, json] = process.argv.slice(2);
const shots = JSON.parse(json);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.HYPERFRAMES_BROWSER_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on("console", (m) => { if (!/GPU stall|GL Driver Message/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
try {
  await page.waitForFunction(() => document.title === "ready" || document.title.startsWith("error"), null, { timeout: 600000 });
} catch (e) {
  console.log(logs.join("\n"));
  await browser.close();
  process.exit(1);
}
console.log(`ready in ${Date.now() - t0} ms ${await page.title()}`);
for (const s of shots) {
  const t1 = Date.now();
  const r = await page.evaluate(s.call);
  await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
  console.log(`${s.name}: ${typeof r === "object" ? JSON.stringify(r) : r} (${Date.now() - t1} ms)`);
}
if (logs.length) console.log(logs.slice(0, 40).join("\n"));
await browser.close();
