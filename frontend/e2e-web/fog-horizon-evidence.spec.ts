// ===== E2E 探针：雾单变量对照（地平线淡出 P0 取证，2026-10-04 拍板批）=====
// 目的：地面系统「网格切天边」真·距离淡出走**场景轻雾**路线前，先取证再定默认值——
//   ① 同机位、同模型（fixture 01_taisho_maid），只切 fogEnabled 开/关两张图；
//   ② 判据不是「雾好不好看」，而是**模型轮廓/阴影接触面是否还认得出来**——
//      雾伤模型可读性即当场否决，不要靠调密度去硬救；
//   ③ 雾参数走 envState schema 既有 fog 键（fogEnabled/fogMode/fogDensity/fogNear/fogFar，
//      值域归 ADR-283），地面 cap 不自持雾私有态；本探针只开 fogEnabled，
//      密度/近远端全用 schema 默认值（10/200，线性）——**取证的就是「默认值合不合理」**。
// 取证后：
//   - 证据过关（两图互异 + 模型可读性保持）→ 调 schema 默认（fogEnabled 或近远端）落 P0；
//   - 不过关 → 退「维持现状」，地平线硬切记「已知未收口」，不再加参数试。
// 防假绿灯：两图 sha256 互异闸 + fogEnabled 读回 + 场景级 scene.fog 落地断言（关→null/开→实例）。
// 定位纪律（ADR-133）：data-testid/class 通道 + evaluate 穿透 shadow DOM，不写 nth()/id/文本字面量。
// 运行：npx playwright test --config playwright.web.config.ts fog-horizon-evidence
// 截图进仓：e2e-web/_shots/fog-horizon/（证据可复查，读图回看是判据执行者）。

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { zipSync } from "fflate";
import { pinnedChromiumOrThrow } from "../e2e/browser-path.ts";

// 本机探测不到即启动失败（有意，防全绿假死；旧 ${LOCALAPPDATA} 硬编码兜底已收口进 helper）
const CHROME = pinnedChromiumOrThrow();

// 软渲染（SwiftShader）：headless 下 WebGL2 可用（与 water-wave-evidence.spec.ts 同款）
test.use({
  launchOptions: {
    executablePath: CHROME,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  },
});

const SHOTS = "e2e-web/_shots/fog-horizon";

/** 仓库已跟踪的 YSM fixture 目录 → 现场 zip 成 .ysm 字节 base64（CI 可复现，
 *  彩色棋盘格纹理防黑剪影假绿灯——与 web-ysm-3d 同源判据） */
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

/** 清空 IndexedDB（用例间隔离） */
async function clearIdb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((res) => {
      try {
        const r = indexedDB.deleteDatabase("ysm-model-manager-web");
        r.onsuccess = () => res();
        r.onerror = () => res();
        r.onblocked = () => res();
        setTimeout(() => res(), 1500);
      } catch {
        res();
      }
    });
  });
}

/** 组件级 DnD 派发 fixture .ysm 字节到 tree-root */
async function dropFixtureYsm(page: Page, fileName: string): Promise<void> {
  const bodyB64 = fixtureYsmBase64();
  await page.evaluate(
    async ({ name, b64 }) => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot
        ?.querySelector("app-tree")
        ?.shadowRoot?.querySelector('[data-testid="tree-root"]');
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

/** 展开首个目录并点击第 idx 个 tree-file（触发 model:select） */
async function clickTreeFile(page: Page, idx = 0): Promise<boolean> {
  return page.evaluate((i) => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    if (!tree?.shadowRoot) return false;
    const dir = tree.shadowRoot.querySelector('[data-testid="tree-dir"]') as HTMLElement | null;
    if (dir) dir.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    const rows = tree.shadowRoot.querySelectorAll('[data-testid="tree-file"]');
    const row = rows[i] as HTMLElement | undefined;
    if (!row) return false;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    return true;
  }, idx);
}

/** 点击左下角 3D 一键跳转入口 */
async function click3DFab(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nav = document.querySelector("app-nav");
    const btn = nav?.shadowRoot?.querySelector(".nav-viewer-fab") as HTMLElement | null;
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    return true;
  });
}

/** 读 3D overlay 内 canvas 尺寸（非零 = WebGL 真绘制） */
async function read3DCanvas(page: Page): Promise<{ found: boolean; w: number; h: number }> {
  return page.evaluate(() => {
    const overlay = document.querySelector(".mpc-overlay");
    const cvs = overlay?.shadowRoot?.querySelector("canvas");
    if (!cvs) return { found: false, w: 0, h: 0 };
    return { found: true, w: cvs.width, h: cvs.height };
  });
}

/** 经 env-state 单写入口切雾 + 读回（防「点了没变」假绿灯：写后读 envState 真值） */
async function setFogEnabled(page: Page, on: boolean): Promise<{ fogEnabled: boolean }> {
  return page.evaluate(async (flag) => {
    const mod = await import("/src/preview-3d/state/env-state.ts");
    mod.setEnvState({ fogEnabled: flag }, { source: "manual" });
    return { fogEnabled: mod.envState.fogEnabled as boolean };
  }, on);
}

/** 场景级 fog 落地断言（cap 回调必须把 envState 写到 scene.fog：关→null / 开→Fog 实例） */
async function sceneFogState(
  page: Page,
): Promise<{ fog: "null" | "instance" | "err"; err?: string }> {
  return page.evaluate(async () => {
    try {
      const mod = await import("/src/preview-3d/adapters/shared-infra.ts");
      const scene = (mod as { sceneInfraHost?: { scene?: unknown } }).sceneInfraHost?.scene as
        | { fog?: unknown }
        | null
        | undefined;
      if (!scene) return { fog: "err", err: "no scene" };
      return { fog: scene.fog ? "instance" : "null" };
    } catch (e) {
      return { fog: "err", err: String(e).slice(0, 120) };
    }
  });
}

test("雾单变量对照：同机位同模型 fogEnabled 关/开两张图（判据=模型可读性）", async ({ page }) => {
  test.slow();
  // 单会话双场景 + 模型加载 + SwiftShader 截图成本（与六场景 spec 同量级放宽）
  test.setTimeout(150_000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  fs.mkdirSync(SHOTS, { recursive: true });
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await clearIdb(page);
  await page.waitForTimeout(2500);

  // 1. 导入真实 fixture 并选中（彩色棋盘格纹理：模型区域判据有饱和色可锚）
  await dropFixtureYsm(page, "01_taisho_maid.ysm");
  await expect.poll(async () => clickTreeFile(page, 0), { timeout: 15000 }).toBe(true);

  // 2. 进 3D + overlay 挂载 + canvas 非零
  await expect.poll(async () => click3DFab(page), { timeout: 10000 }).toBe(true);
  await expect(page.locator(".mpc-overlay"), "3D overlay 应挂载").toBeVisible({ timeout: 20000 });
  await expect
    .poll(async () => read3DCanvas(page), { timeout: 25000 })
    .toMatchObject({ found: true });
  const cvs = await read3DCanvas(page);
  expect(cvs.w, "canvas 宽度非零").toBeGreaterThan(0);
  await page.waitForTimeout(5000); // 模型/纹理/阴影贴图就绪，一帧稳定

  // 3. 不开面板（雾走 envState 直写，无 dock/panel 遮挡视口）——两图同机位同视口。
  //    注：`#preview-close-3d` 是根级 ✕（关整个 3D 会话），严禁在此误点。

  // ── S1 雾关（基线，schema 默认 fogEnabled=false）──
  let readback = await setFogEnabled(page, false);
  expect(readback.fogEnabled, "S1 雾应确为关").toBe(false);
  let fog = await sceneFogState(page);
  expect(fog.fog, "S1 场景雾应为 null").toBe("null");
  await page.waitForTimeout(1200); // 重绘一帧
  const s1 = `${SHOTS}/s1-fog-off.png`;
  await page.screenshot({ path: s1 });

  // ── S2 雾开（唯一变量 = fogEnabled；密度/近远端全 schema 默认 10/200 线性）──
  readback = await setFogEnabled(page, true);
  expect(readback.fogEnabled, "S2 雾应确为开").toBe(true);
  fog = await sceneFogState(page);
  expect(fog.fog, "S2 场景雾应为 Fog 实例（cap 回调落地）").toBe("instance");
  await page.waitForTimeout(1200);
  const s2 = `${SHOTS}/s2-fog-on.png`;
  await page.screenshot({ path: s2 });

  // 反假绿灯：两图 sha256 互异（相同 = 雾没进渲染，流程假动）；截图非零字节
  const h1 = createHash("sha256").update(fs.readFileSync(s1)).digest("hex");
  const h2 = createHash("sha256").update(fs.readFileSync(s2)).digest("hex");
  expect(fs.statSync(s1).size, "S1 截图应非空").toBeGreaterThan(10_000);
  expect(fs.statSync(s2).size, "S2 截图应非空").toBeGreaterThan(10_000);
  expect(h1 !== h2, "两图互异（雾没进渲染的假绿灯信号）").toBe(true);
  expect(
    consoleErrors.filter((e) => e.includes("3D spec 为空")),
    "不应出现 3D spec 为空 加载失败",
  ).toEqual([]);

  // 判据执行者 = 读图回看（AI 看不见浏览器窗口）：
  //   ① S1 网格是否「切天边」硬切（现状基线）；② S2 地平线是否软化融入天际；
  //   ③ S2 模型轮廓/阴影接触面是否仍认得出来——③ 不过关即否决「默认开」，
  //      退「维持现状 + 已知未收口」，不靠调密度硬救（2026-10-04 拍板纪律）。
  console.log(`FOG_OFF_SHOT=${s1}\nFOG_ON_SHOT=${s2}\nS1_SHA=${h1}\nS2_SHA=${h2}`);
});
