// ===== E2E：默认软阴影实证（2026-10-04）=====
// 背景：`shadowType` 默认 hard→soft（地面 P1 收口），单测锁定 PCFSoftShadowMap。
// 本 spec 补「真 3D 会话」UI 实证：openEmpty3DFullscreen 起空场景 3D → 菜单 Scene→Shadow
// 面板读 shadow-soft toggle（默认应为开/soft）→ 点击切 hard，单变量对照 + 截图。
// 注：plain-zip fixture 现由 wasm-decode 明文 ZIP 通道（tryZipDispatch）支持，模型可进 3D；
// 但阴影视觉对比仍需模型 + 投影对象（web 模式 fixture 贴图上传仍是待验点），
// 故本 spec 用空场景稳定实证 toggle 默认态（阴影落地判据），视觉差异建议桌面实机看。
//
// 定位纪律（ADR-133）：统一 data-testid（② 通道）+ .mpc-overlay class（②）+ evaluate
// 穿透 shadow DOM 遍历（不写 nth()/id/文本字面量，规避 ①③④ 判违规）。

import { expect, type Page, test } from "@playwright/test";
import { pinnedChromiumOrThrow } from "../e2e/browser-path.ts";

const CHROME = pinnedChromiumOrThrow();

test.use({
  launchOptions: {
    executablePath: CHROME,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  },
});

/** 起真 3D 会话（空场景，走 nav-fab 无最近模型时的 openEmpty3DFullscreen 路径）。
 *  注：web 模式无 Go 桥，加载真实 fixture 模型 3D 常失败（preview.loadFailed: 3D spec），
 *  故本 spec 用空场景稳定起会话——阴影视觉受限于无模型投影对象，toggle 默认态实证不受限。 */
async function startEmpty3D(page: Page): Promise<void> {
  const err = await page.evaluate(async () => {
    try {
      const mod = await import("/src/views/app-preview/empty-3d.ts");
      await mod.openEmpty3DFullscreen();
      return null;
    } catch (e) {
      return String(e).slice(0, 300);
    }
  });
  expect(err, "openEmpty3DFullscreen 应成功").toBeNull();
  await expect(page.locator(".mpc-overlay"), "3D overlay 应挂载").toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(2500);
}

/** Scene 组根视图里找 shadow 面板入口行并点击；返回是否命中。 */
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

/** 读 shadow-soft toggle 的当前勾选状态（null = 面板未渲染该控件）。 */
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

/** 点击 shadow-soft toggle 切换软/硬。 */
async function clickSoftToggle(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector(".mpc-overlay")?.shadowRoot;
    const menu = root?.querySelector(".ysm-preview-menu");
    const tg = menu?.querySelector('[data-testid="cap-shadow-soft"]') as HTMLElement | null;
    if (!tg) return false;
    const input = tg.querySelector("input") as HTMLInputElement | null;
    const target = input ?? tg;
    target.click();
    return true;
  });
}

test("默认软阴影生效：shadow-soft toggle 默认开 + 菜单面板截图", async ({ page }) => {
  test.slow(); // 真 3D 会话（swiftshader）+ 菜单下钻，逐段放宽 20s 默认上限
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  await startEmpty3D(page);
  await page.screenshot({ path: "e2e-web/_shots/shadow-scene-empty.png" });

  // 菜单下钻：Scene → Shadow 面板
  await page.locator('.mpc-overlay >> [data-testid="dock-scene"]').click();
  await page.waitForTimeout(600);
  const opened = await openShadowPanel(page);
  test
    .info()
    .annotations.push({ type: "scene candidates", description: opened.candidates.join(", ") });
  await page.waitForTimeout(800);

  const soft = await readSoftToggle(page);
  test.info().annotations.push({
    type: "shadow-soft",
    description: `has=${soft.has} checked=${soft.checked} testid=${soft.testid}`,
  });
  expect(soft.has, "Shadow 面板应含 shadow-soft toggle").toBe(true);
  expect(soft.checked, "默认应为软阴影（toggle 开）").toBe(true);
  await page.screenshot({ path: "e2e-web/_shots/shadow-panel-soft.png" });

  // 切 hard 后截图（视觉对比）
  expect(await clickSoftToggle(page), "应能点击 shadow-soft toggle").toBe(true);
  await page.waitForTimeout(1200);
  const hard = await readSoftToggle(page);
  expect(hard.checked, "切换后 toggle 应为关（hard）").toBe(false);
  await page.screenshot({ path: "e2e-web/_shots/shadow-forced-hard.png" });
});
