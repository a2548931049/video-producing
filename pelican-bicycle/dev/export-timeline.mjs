// Dev-only: sample the story clock from the real modules and save it for the audio generator.
// usage: node dev/export-timeline.mjs <out.json>
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const PPTR = "C:/Users/luoli/AppData/Local/npm-cache/_npx/702923228c2ce1e6/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
const puppeteer = (await import(pathToFileURL(PPTR).href)).default;
const out = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const p = await browser.newPage();
await p.goto("http://127.0.0.1:8765/dev/film.html?q=1", { waitUntil: "load" });
await p.waitForFunction(() => document.title === "ready", { timeout: 90000 });
const data = await p.evaluate(() => {
  const S = window.__pel.STORY;
  const rows = [];
  for (let i = 0; i <= 40 * 200; i++) {
    const t = i / 200;
    const tau = S.storyTime(t);
    rows.push([+t.toFixed(4), +tau.toFixed(5), +S.bikeV(tau).toFixed(4), +S.crankAngle(tau).toFixed(5), +S.timeRate(t).toFixed(4)]);
  }
  return { T: S.T, rows };
});
fs.writeFileSync(out, JSON.stringify(data));
console.log("rows", data.rows.length);
await browser.close();
