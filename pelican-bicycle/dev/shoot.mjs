// Dev-only: open a lab page in headless Chrome, run view calls, save PNGs.
// usage: node dev/shoot.mjs <page> <outDir> '<json array of {name, call}>'
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const PPTR = "C:/Users/luoli/AppData/Local/npm-cache/_npx/702923228c2ce1e6/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
const puppeteer = (await import(pathToFileURL(PPTR).href)).default;

const [page, outDir, json] = process.argv.slice(2);
const shots = JSON.parse(fs.readFileSync(json, "utf8").replace(/^﻿/, ""));
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const p = await browser.newPage();
const logs = [];
p.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await p.setViewport({ width: 1920, height: 1080 });
await p.goto(`http://127.0.0.1:8765/${page}`, { waitUntil: "load" });
try {
  await p.waitForFunction(() => document.title === "ready", { timeout: 60000 });
} catch (e) {
  console.log(logs.join("\n"));
  await browser.close();
  process.exit(1);
}
for (const s of shots) {
  const t0 = Date.now();
  const r = await p.evaluate(s.call);
  const el = (await p.$("#root")) ?? (await p.$("canvas"));
  await el.screenshot({ path: path.join(outDir, `${s.name}.png`) });
  console.log(`${s.name}: ${r} (${Date.now() - t0}ms)`);
}
if (logs.length) console.log(logs.slice(0, 30).join("\n"));
await browser.close();
