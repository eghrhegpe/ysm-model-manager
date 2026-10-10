// 一次性探针 2（S1-3 复核）：把「色带 + 刻度 + 太阳圆点」三者按渲染器的真实坐标公式合成一张图，
// 在几个时刻上验证「圆点 x 位置 = 刻度坐标系」且「圆点 y 高度 = 色带相位」讲同一个故事。
// 坐标公式逐字复刻 cap-controls.ts|renderCapTimeline（marker: x = h/24, y 由 sin 弧）。
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BAND = "frontend/src/preview-3d/menu/render/timeline-band.ts";
const SUN = "frontend/src/preview-3d/caps/sky-sun.ts";

const html = `<!doctype html><html><body style="margin:0;background:#111;font:12px system-ui;color:#ddd">
<div id="wrap"></div><div id="legend" style="padding:8px"></div>
<script type="module">
import { bandStops, bandColorAt, BAND_TICKS } from "/band";
import { computeHourToSun } from "/sun";

const wrap = document.getElementById("wrap");
const rows = [];
for (const h of [0, 6, 9, 12, 15, 18, 21]) {
  const bandH = 28, W = 480;
  const band = document.createElement("div");
  band.style.cssText = "position:relative;width:"+W+"px;border-radius:6px;overflow:hidden;margin:4px 0;";
  band.style.height = bandH + "px";
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = bandH;
  cv.style.cssText = "width:100%;height:100%;display:block";
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0,0,W,0);
  for (const s of bandStops()) g.addColorStop(s.t, s.c);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,bandH);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (const k of BAND_TICKS) ctx.fillRect(Math.round(k.t*W)+0.5, 0, 1, bandH);
  // 圆点：逐字复刻渲染器公式
  const hh = ((h % 24) + 24) % 24;
  const dayProg = Math.sin(((hh - 6) / 12) * Math.PI);
  const xPct = (hh / 24) * 100;
  const yPx = bandH / 2 - dayProg * (bandH / 2 - 4);
  const dot = document.createElement("div");
  dot.style.cssText = "position:absolute;width:10px;height:10px;border-radius:50%;background:#fff4c2;"+
    "border:1px solid rgba(0,0,0,.3);box-shadow:0 0 6px rgba(255,244,194,.8);transform:translate(-50%,-50%);"+
    "left:"+xPct+"%;top:"+yPx+"px";
  band.append(cv, dot);
  wrap.append(band);
  rows.push(h+"h 色="+bandColorAt(h)+"  el="+computeHourToSun(h).elevation.toFixed(1)+"  圆点x="+xPct.toFixed(1)+"%  y="+yPx.toFixed(1)+"px");
}
document.getElementById("legend").textContent = rows.join("  ||  ");
document.title = "ready";
window.__rows = rows;
</script></body></html>`;

writeFileSync("artifacts/audit-env-s13/probe2.html", html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 320 } });
await page.route("**/*", async (route) => {
  const url = route.request().url();
  const { readFileSync } = await import("node:fs");
  const { transform } = await import("esbuild");
  const serve = async (file) => {
    const raw = readFileSync(file, "utf8").replace(
      /from "@\/preview-3d\/caps\/sky-sun\.ts"/,
      'from "./sun"',
    );
    const { code } = await transform(raw, { loader: "ts", format: "esm" });
    return route.fulfill({ contentType: "application/javascript", body: code });
  };
  if (url.endsWith("/band")) return serve(BAND);
  if (url.endsWith("/sun")) return serve(SUN);
  return route.continue();
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("file://" + process.cwd().replace(/\\/g, "/") + "/artifacts/audit-env-s13/probe2.html");
await page.waitForFunction(() => document.title === "ready", null, { timeout: 15000 });
for (const r of await page.evaluate(() => window.__rows)) console.log("  " + r);
await page.locator("#wrap").screenshot({ path: "artifacts/audit-env-s13/band-with-marker.png" });
await browser.close();
console.log("OK -> band-with-marker.png");
