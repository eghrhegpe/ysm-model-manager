// 一次性探针（S1-3 昼夜色带视觉验证）：在真实 Chromium 里跑 timeline-band 的派生色标，
// 画成 PNG 供读图回看；同时把逐小时采样色打印成表，可与单元测试断言交叉核对。
// 用完即弃（artifacts/ 下不承担提交归属）——非 CI 资产，仅本地视觉证据。
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BAND_PATH = "frontend/src/preview-3d/menu/render/timeline-band.ts";
const SUN_PATH = "frontend/src/preview-3d/caps/sky-sun.ts";

const html = `<!doctype html><html><body style="margin:0;background:#111;font:12px system-ui">
<canvas id="c" width="960" height="120"></canvas>
<div id="legend" style="color:#ddd;padding:8px"></div>
<script type="module">
import { bandStops, bandColorAt, BAND_TICKS } from "/${BAND_PATH}";
import { computeHourToSun } from "/${SUN_PATH}";
const c = document.getElementById("c");
const ctx = c.getContext("2d");
const grad = ctx.createLinearGradient(0, 0, c.width, 0);
for (const s of bandStops()) grad.addColorStop(s.t, s.c);
ctx.fillStyle = grad;
ctx.fillRect(0, 0, c.width, c.height);
ctx.fillStyle = "rgba(255,255,255,0.55)";
for (const k of BAND_TICKS) ctx.fillRect(Math.round(k.t * c.width) + 0.5, 0, 1, c.height);
// 标注 6/12/18
ctx.fillStyle = "#fff"; ctx.font = "12px system-ui";
for (const k of BAND_TICKS) ctx.fillText(k.hour + "h", k.t * c.width - 8, c.height - 6);
const table = [];
for (let h = 0; h <= 24; h += 3) {
  table.push(h + "h " + bandColorAt(h) + " (el=" + computeHourToSun(h).elevation.toFixed(1) + ")");
}
document.getElementById("legend").textContent = table.join(" | ");
document.title = "ready";
window.__probe = { stops: bandStops().length, colors: table };
</script></body></html>`;

mkdirSync("artifacts/audit-env-s13", { recursive: true });
writeFileSync("artifacts/audit-env-s13/probe.html", html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 220 } });
await page.route("**/*", async (route) => {
  const url = route.request().url();
  const { readFileSync } = await import("node:fs");
  const { transform } = await import("esbuild");
  // 源码是 TS：浏览器不能直接跑，经 esbuild 转译为 JS 后喂给页面。
  // 按 URL 尾部匹配源文件（Windows file:// 路径不可直接喂 fs，故映射回仓库相对路径）。
  const serve = async (file) => {
    const raw = readFileSync(file, "utf8").replace(
      /from "@\/preview-3d\/caps\/sky-sun\.ts"/,
      'from "./sky-sun.ts"',
    );
    const { code } = await transform(raw, { loader: "ts", format: "esm" });
    return route.fulfill({ contentType: "application/javascript", body: code });
  };
  if (url.endsWith("timeline-band.ts")) return serve(BAND_PATH);
  if (url.endsWith("sky-sun.ts")) return serve(SUN_PATH);
  return route.continue();
});
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("file://" + process.cwd().replace(/\\/g, "/") + "/artifacts/audit-env-s13/probe.html");
await page.waitForFunction(() => document.title === "ready", null, { timeout: 15000 });
const probe = await page.evaluate(() => window.__probe);
console.log("stops =", probe.stops);
for (const line of probe.colors) console.log("  " + line);
await page.locator("#c").screenshot({ path: "artifacts/audit-env-s13/band.png" });
await page.locator("#legend").screenshot({ path: "artifacts/audit-env-s13/legend.png" });
await browser.close();
console.log("OK -> artifacts/audit-env-s13/band.png");
