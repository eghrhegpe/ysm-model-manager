// 组件隔离渲染截图探针:起 vite dev(--port 0 随机端口,复用 e2e 的 wasm-stub 配置)
// → 逐组件打开 /harness/index.html?c=<name> → 等 body[data-ready=1] → 截图存 harness/_shots/
// → 对 PNG 做「不是一张纯色图」的内容闸门。
// 用法: node harness/shot.mjs [组件名...]   (无参 = REGISTRY 全量)
// 与 e2e 的分工:harness 管「单组件隔离视觉」,e2e 管「全 app 行为回归」。
//
// 三条硬规则(2026-10-24 锐评后重写,勿回退):
//  ① 端口不复用。旧实现固定 :5199 + --strictPort,端口被残留 server 占住时新 vite 秒退,
//     而探测 fetch 照样成功 → 全程对着**旧代码**截图且只 console.warn 一句(不阻断的警告
//     等于行为艺术)。现在 --port 0 由系统分配,真实 URL 只从 vite 自己的启动横幅里读;
//     读不到就抛错退出,不存在「猜一个端口试试看」。
//  ② 就绪看 probe 命中,不看「子元素非空」。判据在 main.ts 的 REGISTRY.probe 里,
//     命中不到会写 body[data-error],这里只负责把失败转成非零退出码。
//  ③ 不 sleep。动画由 main.ts 打的 <html class="no-animations"> 冻结(:host-context 命中),
//     固定 waitForTimeout 只会既慢又假绿。
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";
import { decodePng } from "../e2e-web/png-color-count.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(here, "_shots");

/** 内容闸门阈值:色桶数(5bit/通道分桶)与「非主色像素占比」。
 *  背景是整片深色,正常组件的覆盖率天然只有个位数百分比——故阈值必须压到极低,
 *  只拦「一张纯色图」这种极端(实测空壳截图 cov≈0.0% / buckets 64,正常组件
 *  cov 1~14% / buckets 120~580)。 */
const MIN_BUCKETS = 20;
const MIN_COVERAGE = 0.002;

const requested = process.argv.slice(2);

/** vite 可执行入口:走包解析而非 npx(免 shell,顺带消掉 DEP0190 的 shell+args 弃用警告)。 */
function resolveViteBin() {
  const req = createRequire(path.join(root, "noop.js"));
  return path.join(path.dirname(req.resolve("vite/package.json")), "bin", "vite.js");
}

/** 起 vite dev(--port 0):真实 URL 从启动横幅解析,失败即抛。 */
function startVite() {
  const proc = spawn(
    process.execPath,
    [
      resolveViteBin(),
      "--config",
      "vite.e2e.config.ts",
      "--port",
      "0",
      "--strictPort",
      "--host",
      "127.0.0.1",
      "--clearScreen",
      "false",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error(`vite dev server 30s 内未打印启动地址\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`));
    }, 30000);

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      // 横幅形态:"  ➜  Local:   http://127.0.0.1:52727/"
      const m = /Local:\s+(http:\/\/[^\s]+)/.exec(stdout);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ url: m[1].replace(/\/$/, ""), proc });
      }
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(`[vite] ${d}`);
    });
    proc.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`vite 在打印启动地址前退出(code=${code})\n${stderr}`));
    });
  });
}

/** 读组件清单:打开无参 harness 页,从 window.__harnessRegistry__ 取(清单单源在 main.ts)。 */
async function readRegistry(url) {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto(`${url}/harness/index.html`, { waitUntil: "domcontentloaded" });
  try {
    await p.waitForFunction(() => Array.isArray(window.__harnessRegistry__), null, {
      timeout: 15000,
    });
    return await p.evaluate(() => window.__harnessRegistry__);
  } finally {
    await b.close();
  }
}

/** 画面内容指标:主色占比 → coverage(非主色像素比例);色桶数 → buckets。
 *  零依赖解码器来自 e2e-web(同一套 PNG 工具,不为截图另加 sharp/pixelmatch)。 */
function imageStats(buf) {
  const png = decodePng(buf);
  if (!png) return null;
  const { width, height, rgba } = png;
  const counts = new Map();
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const key = ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let top = 0;
  for (const n of counts.values()) if (n > top) top = n;
  const total = width * height;
  return { total, buckets: counts.size, coverage: 1 - top / total };
}

/** 清单完整性守卫:扫 src/views 下每个 index.ts 里的 customElements.define("tag"),
 *  与 REGISTRY 比对。锐评 P1-2 的教训是 context-menu 定义了却从没登记——组件
 *  存在但永远没人给它拍过一张图,这种漏登在运行期完全无声。故在起浏览器前先静态比对。 */
async function assertRegistryComplete(registry) {
  const viewsDir = path.join(root, "src", "views");
  const defined = new Set();
  const walk = async (dir) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.name === "index.ts") {
        const src = await readFile(full, "utf8");
        for (const m of src.matchAll(/customElements\.define\(\s*"([^"]+)"/g)) defined.add(m[1]);
      }
    }
  };
  await walk(viewsDir);
  const missing = [...defined].filter((tag) => !registry.includes(tag));
  if (missing.length > 0) {
    throw new Error(
      `harness REGISTRY 漏登组件: ${missing.join(", ")} —— 这些 custom element 已定义但没有任何截图条目,` +
        `请到 frontend/harness/main.ts 的 REGISTRY 补登记(含 probe 就绪判据)。`,
    );
  }
  return { defined: defined.size, registered: registry.length };
}

const { url, proc } = await startVite();
const registry = await readRegistry(url);
const coverage = await assertRegistryComplete(registry);
console.log(
  `REGISTRY 完整:已定义 ${coverage.defined} 个 custom element,登记 ${coverage.registered} 条截图条目`,
);
const names = requested.length > 0 ? requested : registry;
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => console.error(`[pageerror:${page.url()}] ${err.message}`));

let failed = 0;
for (const name of names) {
  await page.goto(`${url}/harness/index.html?c=${name}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
  } catch {
    console.error(`FAIL ${name}: data-ready 未出现(挂载卡死或 probe 永不命中)`);
    failed += 1;
    continue;
  }
  const err = await page.getAttribute("body", "data-error");
  if (err !== null) {
    console.error(`FAIL ${name}: ${err}`);
    failed += 1;
    continue;
  }
  const render = (await page.getAttribute("body", "data-render")) ?? "(no data-render)";
  const shot = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  // 内容闸门:probe 保证「该出现的元素出现了」,这里再兜一次「整张图是不是纯色」。
  const stats = imageStats(await readFile(shot));
  if (stats === null) {
    console.error(`FAIL ${name}: 截图不是可解码的 8bit RGB/RGBA PNG`);
    failed += 1;
    continue;
  }
  const covPct = (stats.coverage * 100).toFixed(2);
  if (stats.buckets < MIN_BUCKETS || stats.coverage < MIN_COVERAGE) {
    console.error(
      `FAIL ${name}: 截图近乎纯色(buckets=${stats.buckets} < ${MIN_BUCKETS} 或 coverage=${covPct}% < ${(MIN_COVERAGE * 100).toFixed(1)}%)`,
    );
    failed += 1;
    continue;
  }
  console.log(`SHOT ${name} -> ${shot}  [${render} cov=${covPct}% buckets=${stats.buckets}]`);
}

await browser.close();
// 树杀:即便已不用 shell,vite 仍会拉起 esbuild 子进程,只 kill 父进程会留下占端口的孤儿。
// Windows 走 taskkill /T /F 且必须同步等完再 exit(fire-and-forget 会被 process.exit 抢跑)。
if (process.platform === "win32") {
  if (proc.pid !== undefined) {
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  }
} else {
  proc.kill("SIGTERM");
}
process.exit(failed > 0 ? 1 : 0);
