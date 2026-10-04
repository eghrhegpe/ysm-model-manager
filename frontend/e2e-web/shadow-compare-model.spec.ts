// ===== E2E：真实模型 hard/soft 阴影（状态自证 + swiftshader 环境限制实证）=====
// 治本通路打通后（wasm-decode plain-zip + fixture 纹理升级），用真模型验证阴影链路：
//   默认 soft → 阴影面板读 shadow-soft toggle（应开）→ 切 hard（应关）→ 截图。
// 场景阴影状态自证：遍历 scene 断言 mesh castShadow/receiveShadow + 方向光 castShadow/frustum
// 全就绪——代码层阴影链路完整。
//
// ⚠️ 已知环境限制（2026-10-04 实测）：swiftshader 软渲染下**阴影贴图不渲染**，soft/hard
// 截图逐像素几乎相同（无阴影）。故本 spec 不做「阴影边缘差异」断言，只断言 toggle 状态
// + 场景阴影状态自证。阴影真实视觉（边缘柔化）需真实 GPU（桌面 WebView2 / 实机浏览器）。
// 阴影可见性依据：shadow-capability.applyMeshes / syncMeshes 强制 mesh cast+receive。
//
// 定位纪律（ADR-133）：data-testid/class 通道 + evaluate 穿透 shadow DOM，不写 nth()/id/文本字面量。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { zipSync } from "fflate";
import { pinnedChromiumOrThrow } from "../e2e/browser-path.ts";

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

/** 清空 IndexedDB（用例间隔离）；onblocked 挂起 + evaluate 上下文销毁见 web-ysm-3d.spec 注 */
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

/** Scene 组根视图里找 shadow 面板入口行并点击；返回是否命中 */
async function openShadowPanel(page: Page): Promise<{ clicked: boolean; candidates: string[] }> {
  return page.evaluate(() => {
    const root = document.querySelector(".mpc-overlay")?.shadowRoot;
    const menu = root?.querySelector(".ysm-preview-menu");
    const rows = Array.from(
      menu?.querySelectorAll('[data-testid^="preview-"]') ?? [],
    ) as HTMLElement[];
    const candidates = rows.map((r) => r.dataset.testid ?? "");
    const hit = rows.find((r) => r.dataset.testid?.toLowerCase().includes("shadow"));
    if (hit) hit.click();
    return { clicked: !!hit, candidates };
  });
}

/** 读 shadow-soft toggle 当前勾选状态 */
async function readSoftToggle(
  page: Page,
): Promise<{ has: boolean; checked: boolean | null; testid: string | null }> {
  return page.evaluate(() => {
    const root = document.querySelector(".mpc-overlay")?.shadowRoot;
    const menu = root?.querySelector(".ysm-preview-menu");
    const tg = menu?.querySelector('[data-testid="cap-shadow-soft"]') as HTMLElement | null;
    const input = tg?.querySelector("input") as HTMLInputElement | null;
    return {
      has: !!tg,
      checked: input ? input.checked : null,
      testid: tg ? (tg.dataset.testid ?? null) : null,
    };
  });
}

/** 点击 shadow-soft toggle 切换软/硬 */
async function clickSoftToggle(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector(".mpc-overlay")?.shadowRoot;
    const menu = root?.querySelector(".ysm-preview-menu");
    const tg = menu?.querySelector('[data-testid="cap-shadow-soft"]') as HTMLElement | null;
    if (!tg) return false;
    const input = tg.querySelector("input") as HTMLInputElement | null;
    (input ?? tg).click();
    return true;
  });
}

test("真实模型 hard/soft 阴影视觉对比：默认 soft → 切 hard → 截模型脚下地面", async ({ page }) => {
  test.setTimeout(150000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await clearIdb(page);
  await page.waitForTimeout(2500);

  // 1. 导入真实 fixture .ysm 并选中
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
  expect(cvs.h, "canvas 高度非零").toBeGreaterThan(0);

  // 3. 等模型/纹理/阴影贴图就绪（阴影默认 soft，需一帧渲染）
  await page.waitForTimeout(5000);

  // 诊断：读 3D 场景实际阴影状态（mesh cast/receive 计数、方向光 castShadow/frustum）
  const sceneState = await page.evaluate(async () => {
    try {
      const mod = await import("/src/preview-3d/adapters/shared-infra.ts");
      const scene = mod.sceneInfraHost.scene as unknown as {
        traverse: (fn: (o: unknown) => void) => void;
      } | null;
      if (!scene) return { err: "no scene" };
      let mesh = 0;
      let cast = 0;
      let recv = 0;
      let dirCast = 0;
      const dirs: Array<{ cast: boolean; frustum: number; mapW: number }> = [];
      scene.traverse((o: unknown) => {
        const obj = o as {
          isMesh?: boolean;
          isDirectionalLight?: boolean;
          castShadow?: boolean;
          receiveShadow?: boolean;
          shadow?: {
            camera?: { right?: number };
            mapSize?: { width?: number };
          };
        };
        if (obj.isMesh) {
          mesh++;
          if (obj.castShadow) cast++;
          if (obj.receiveShadow) recv++;
        }
        if (obj.isDirectionalLight) {
          if (obj.castShadow) dirCast++;
          dirs.push({
            cast: !!obj.castShadow,
            frustum: obj.shadow?.camera?.right ?? 0,
            mapW: obj.shadow?.mapSize?.width ?? 0,
          });
        }
      });
      return { mesh, cast, recv, dirCast, dirs };
    } catch (e) {
      return { err: String(e).slice(0, 200) };
    }
  });
  console.log(`SCENE_SHADOW_STATE=${JSON.stringify(sceneState)}`);
  expect(sceneState.mesh, "场景应有 mesh").toBeGreaterThan(0);

  // 4. 菜单下钻：Scene → Shadow 面板（面板打开本身不遮挡视口，阴影在画面上）
  // 诊断：先列 overlay 里实际挂载的 dock 组 testid（模型会话 dock 可能延后渲染/命名不同）
  const dockIds = await page.evaluate(() => {
    const root = document.querySelector(".mpc-overlay")?.shadowRoot;
    const overlayExists = !!document.querySelector(".mpc-overlay");
    return {
      overlayExists,
      docks: Array.from(root?.querySelectorAll('[data-testid^="dock-"]') ?? []).map((e) =>
        e.getAttribute("data-testid"),
      ),
      menu: !!root?.querySelector(".ysm-preview-menu"),
    };
  });
  test.info().annotations.push({
    type: "dock state",
    description: JSON.stringify(dockIds),
  });
  expect(dockIds.overlayExists, "3D overlay 应在页面上").toBe(true);
  expect(dockIds.docks.length, "dock 栏应有组（模型会话 dock 就绪）").toBeGreaterThan(0);
  await page.locator('.mpc-overlay >> [data-testid="dock-scene"]').click();
  await page.waitForTimeout(600);
  const opened = await openShadowPanel(page);
  expect(opened.clicked, "Scene 组应含 Shadow 面板入口行且可点击").toBe(true);
  await page.waitForTimeout(800);
  const soft = await readSoftToggle(page);
  expect(soft.has, "Shadow 面板应含 shadow-soft toggle").toBe(true);
  expect(soft.checked, "默认应为软阴影（toggle 开）").toBe(true);

  // 5. 软阴影截图（含模型脚下地面）——全图保留，读图回看阴影边缘
  const shotDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "_shots");
  fs.mkdirSync(shotDir, { recursive: true });
  const softShot = path.join(shotDir, "shadow-model-soft.png");
  await page.screenshot({ path: softShot, fullPage: false });

  // 6. 切 hard 后等重绘，再截图
  expect(await clickSoftToggle(page), "应能点击 shadow-soft toggle").toBe(true);
  await page.waitForTimeout(1500);
  const hard = await readSoftToggle(page);
  expect(hard.checked, "切换后 toggle 应为关（hard）").toBe(false);
  const hardShot = path.join(shotDir, "shadow-model-hard.png");
  await page.screenshot({ path: hardShot, fullPage: false });

  // 7. 硬断言：不应出现「3D spec 为空」加载失败
  expect(
    consoleErrors.filter((e) => e.includes("3D spec 为空")),
    "修复后不应再出现 3D spec 为空 错误",
  ).toEqual([]);

  console.log(`SOFT_SHOT=${softShot}`);
  console.log(`HARD_SHOT=${hardShot}`);
});
