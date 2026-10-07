// ===== E2E：web 模式加载真实 fixture 模型 → 进 3D → 截图回看（治本视觉验证路径）=====
// 背景：web 模式无 Go 桥，GetModel3DSpec 恒 null → fetchSpecViaWasmFallback → decodeYsmViaWasm。
// 曾长期失败（preview.loadFailed: 3D spec 为空），根因两条 web 缺口：
//   1) 明文 ZIP（开源 wine_fox 解压目录被 zip 回 .ysm）无 YSGP 魔数，WASM YSMParser 只认
//      YSGP V1/V2/V3 → 四条策略全 miss；web/Android 缺 Go 的「.zip 当容器」通道。
//   2) ysm.json `files.player.model` 对象映射形态（{main,arm}）被包成 [{main,arm}]，
//      下游取 mf.path 得 undefined → 0 骨骼、无 geometryRaw。
// 修复后 fixture 走 plain-zip→JSON 分派 → buildSpecFromGeometryJSON → 真 3D 渲染。
// 本 spec 是视觉验证主通路：真模型落 3D overlay + 截图存 _shots/ 供读图回看。
//
// 定位纪律（ADR-133）：data-testid/class 通道 + evaluate 穿透 shadow DOM，不写 nth()/id/文本字面量。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { zipSync } from "fflate";
import { pinnedChromiumOrThrow } from "../e2e/browser-path.ts";
import { decodePng } from "./png-color-count.ts";
import { clearIdbBestEffort, waitForAppReady } from "./web-ready.ts";

const CHROME = pinnedChromiumOrThrow();

test.use({
  launchOptions: {
    executablePath: CHROME,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  },
});

/** 仓库已跟踪的 YSM fixture 目录 → 现场 zip 成 .ysm 字节 base64（CI 可复现） */
function fixtureYsmBase64(): string {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "tests",
    "fixtures",
    "ysm",
    "01_taisho_maid",
  );
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, base: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.join(base, ent.name).replace(/\\/g, "/");
      if (ent.isDirectory()) walk(full, rel);
      else files[rel] = new Uint8Array(fs.readFileSync(full));
    }
  };
  walk(root, "");
  return Buffer.from(zipSync(files)).toString("base64");
}

/**
 * 清空 IndexedDB（用例间隔离）。
 * ⚠️ deleteDatabase 在 app 已持有连接时会触发 onversionchange → 应用自动重开同版本
 * 数据库，导致 deleteDatabase 被 onblocked 挂起、Playwright evaluate 上下文被后续
 * 页面导航销毁（真实 flake 源——实测失败于 `clearIdb` 自身的 evaluate，见 web-ready 注释）。
 * Playwright 每个测试使用全新 browser context（IDB 天然隔离），故本步是「尽力清」：
 * 撞导航不阻断测试（库真没清成由用例自身的 IDB 断言兜底）。
 */
async function clearIdb(page: Page): Promise<void> {
  await clearIdbBestEffort(page);
}

/** 像 dropFile 一样派发真实 fixture .ysm 字节（tree-root 组件级 DnD，双层 shadow 穿透）。
 *  前置就绪由 `waitForAppReady` 轮询承担，本函数只负责派发本身。 */
async function dropFixtureYsm(page: Page, fileName: string): Promise<void> {
  const bodyB64 = fixtureYsmBase64();
  await page.evaluate(
    async ({ name, b64 }) => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const tree = treeHost?.shadowRoot?.querySelector('[data-testid="tree-root"]');
      if (!tree) throw new Error("app-tree tree-root 未就绪，无法派发组件级 DnD");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: "application/octet-stream" }));
      const ev = new DragEvent("drop", { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
      tree.dispatchEvent(ev);
    },
    { name: fileName, b64: bodyB64 },
  );
}

/** 展开首个目录并点击其中第 idx 个 tree-file（触发 model:select） */
async function clickTreeFile(page: Page, idx = 0): Promise<boolean> {
  return page.evaluate((i) => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    if (!tree?.shadowRoot) return false;
    const dirs = tree.shadowRoot.querySelectorAll('[data-testid="tree-dir"]');
    const dir = dirs[0] as HTMLElement | undefined;
    if (dir) dir.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    const rows = tree.shadowRoot.querySelectorAll('[data-testid="tree-file"]');
    const row = rows[i] as HTMLElement | undefined;
    if (!row) return false;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    return true;
  }, idx);
}

/** 点击左下角 3D 一键跳转入口（app-nav shadowRoot 内 .nav-viewer-fab） */
async function click3DFab(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nav = document.querySelector("app-nav");
    const btn = nav?.shadowRoot?.querySelector(".nav-viewer-fab") as HTMLElement | null;
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    return true;
  });
}

/** 读 3D overlay shadow 内是否渲染出 canvas 且尺寸非零（WebGL 真绘制证据） */
async function read3DCanvas(page: Page): Promise<{ found: boolean; w: number; h: number }> {
  return page.evaluate(() => {
    const overlay = document.querySelector(".mpc-overlay");
    const cvs = overlay?.shadowRoot?.querySelector("canvas");
    if (!cvs) return { found: false, w: 0, h: 0 };
    return { found: true, w: cvs.width, h: cvs.height };
  });
}

/**
 * 统计 PNG buffer 中「显著饱和色」像素数（max(R,G,B) > 100 且 max-min > 60）。
 * 判据：天空/地面/灰阶背景不含这种饱和色；纯黑剪影也不含（R/G/B 都低）。
 * 只有真实上传并映射的彩色纹理才会贡献这类像素。
 * 注：WebGL readPixels 在 preserveDrawingBuffer=false 下帧间返回全 0，故改用
 * Playwright 截图 buffer（经极简 PNG 解码，见 png-color-count.ts）。
 */
function countSaturatedPixelsFromBuf(buf: Buffer): number {
  let png: ReturnType<typeof decodePng> = null;
  try {
    png = decodePng(buf);
  } catch {
    return -1;
  }
  if (!png) return -1;
  const { width, height, rgba } = png;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    if (hi > 100 && hi - lo > 60) count++; // 饱和色：任一通道显著高于其余
  }
  return count;
}

test("web 模式：真实 fixture 模型进入 3D 并渲染（治本视觉验证）", async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await clearIdb(page);
  // 启动就绪等待（取代固定 2500ms sleep——CI 慢启动下 DnD 会撞「tree-root 未就绪」）
  await waitForAppReady(page);

  // 1. 导入真实 fixture .ysm（明文 ZIP 形态）
  await dropFixtureYsm(page, "01_taisho_maid.ysm");
  await expect.poll(async () => clickTreeFile(page, 0), { timeout: 15000 }).toBe(true);

  // 2. 点 nav-fab 进 3D
  await expect.poll(async () => click3DFab(page), { timeout: 10000 }).toBe(true);

  // 3. 3D overlay 挂载
  await expect(page.locator(".mpc-overlay"), "3D overlay 应挂载").toBeVisible({ timeout: 20000 });

  // 4. 真渲染证据：canvas 尺寸非零（WebGL context 已初始化并绘制）
  await expect
    .poll(async () => read3DCanvas(page), { timeout: 25000 })
    .toMatchObject({
      found: true,
    });
  const cvs = await read3DCanvas(page);
  expect(cvs.w, "3D canvas 应有非零宽度").toBeGreaterThan(0);
  expect(cvs.h, "3D canvas 应有非零高度").toBeGreaterThan(0);

  // 5. 等模型纹理/骨骼加载完成（解码 + 上传有耗时，给足余量）
  await page.waitForTimeout(4000);

  // 6. 截图到 _shots/ 供读图回看（地面/天空/阴影/模型本体可见性实证）；
  //    只裁模型区域（视口中央），排除天空/地面干扰，同一 buffer 直接喂色相断言
  const shotDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "_shots");
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = path.join(shotDir, "web-ysm-3d-fixture.png");
  const clip = {
    x: Math.round(cvs.w * 0.3),
    y: Math.round(cvs.h * 0.25),
    width: Math.round(cvs.w * 0.4),
    height: Math.round(cvs.h * 0.6),
  };
  const shotBuf = await page.screenshot({ path: shot, fullPage: false, clip });

  // 7. 硬断言：不应再出现「3D spec 为空」加载失败
  expect(
    consoleErrors.filter((e) => e.includes("3D spec 为空")),
    "修复后不应再出现 3D spec 为空 错误",
  ).toEqual([]);

  // 8. 硬断言：模型不是纯黑剪影——fixture 使用真实纹理（多色相棋盘格），
  //    模型区域应出现显著饱和色像素（黑剪影不含；天空/地面已被 clip 排除）
  const saturated = countSaturatedPixelsFromBuf(shotBuf);
  console.log(`SATURATED_PIXELS=${saturated}`);
  expect(saturated, "3D 画面应出现显著饱和色像素（fixture 真实纹理已上传并映射）").toBeGreaterThan(
    200,
  );

  console.log(`SCREENSHOT=${shot}`);
});
