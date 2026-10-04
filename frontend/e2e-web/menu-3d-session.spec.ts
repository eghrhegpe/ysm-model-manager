// ===== E2E：真实 3D 会话内的菜单可达性（2026-10-04）=====
// 为什么需要本 spec：e2e/menu-visual.spec.ts 覆盖「菜单结构」，但它是**脱离 3D 会话**直接
// mountPreviewRootMenu——于是所有依赖 cap 的面板只能拿到「进 3D 后再开」的说明文本
// （实况：lighting / shadow / postproc 三项 0 控件），而 `environment` 组更是被
// `skyGroundCap` 门禁整组藏掉。本 spec 起**真 3D 会话**（真 WebGL2 + 真 caps）补上这一层。
//
// ⚠️ 关键陷阱（踩过，勿重蹈）：3D overlay 挂 document.body 且**带 Shadow DOM**
//   —— `document.querySelector(".preview-dock-nav")` **查不到**（querySelector 不穿透
//   shadow 边界），canvas 同理。本 spec 统一经 `overlayRoot(page)` 进 shadowRoot 取元素。
//   对照：Playwright 的 `page.screenshot` / `locator.click()` 拍的是渲染结果、能穿透，
//   只有页面内 `document.querySelector` 不穿透——两者混用正是「探测说没有、截图明明有」的
//   假阴性来源。
//
// 运行：
//   npx playwright test --config playwright.web.config.ts menu-3d-session
import { expect, type Page, test } from "@playwright/test";
import { pinnedChromiumOrThrow } from "../e2e/browser-path.ts";

// 本机探测不到即启动失败（有意，防全绿假死；旧 ${LOCALAPPDATA} 硬编码兜底已收口进 helper）
const CHROME = pinnedChromiumOrThrow();

// 软渲染（SwiftShader）：与 postprocessing.spec.ts 同款，headless 下 WebGL2 可用
test.use({
  launchOptions: {
    executablePath: CHROME,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  },
});

/** 3D overlay 元素（canvas / 菜单 dock 都在其 shadowRoot 内）。 */
function overlay(page: Page) {
  return page.locator(".mpc-overlay");
}

/**
 * 起真 3D 会话（空场景：sky + ground + light caps 齐备，不需模型文件）。
 * openEmpty3DFullscreen 即 nav-fab「无最近模型」时的真实路径（app-nav/index.test.ts 同款分派）。
 */
async function start3D(page: Page): Promise<void> {
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
  await expect(overlay(page), "3D overlay 应挂载").toBeVisible({ timeout: 15000 });
  // 等 rAF 循环跑起来（caps 注册在 build 之后，需等若干帧才有 skyGroundCap）
  await page.waitForTimeout(2500);
}

/** 读 shadowRoot 内的 dock 按钮 id 列表。 */
async function dockButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector(".mpc-overlay")?.shadowRoot;
    const dock = root?.querySelector(".preview-dock-nav");
    return Array.from(dock?.querySelectorAll("[data-testid^='dock-']") ?? []).map(
      (b) => (b as HTMLElement).dataset.testid ?? "",
    );
  });
}

test.describe("真实 3D 会话内的菜单", () => {
  test("空场景会话可起（canvas + 四分组 dock）", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    await start3D(page);

    // canvas 在真 WebGL2 上建起来了
    const canvasCount = await page.evaluate(
      () =>
        document.querySelector(".mpc-overlay")?.shadowRoot?.querySelectorAll("canvas").length ?? 0,
    );
    expect(canvasCount, "3D 会话应建出 canvas").toBe(1);
    await page.screenshot({ path: "e2e-web/_shots/3d-01-session.png" });

    // 四分组 dock 齐备——**含 environment**：它被 skyGroundCap 门禁，
    // 只有真会话（caps 已注册）才可见，这正是脱离会话挂菜单验不到的。
    const btns = await dockButtons(page);
    test.info().annotations.push({ type: "3D dock", description: btns.join(", ") });
    for (const gid of ["model", "env", "scene", "settings"]) {
      expect(btns, `3D 会话应含 dock-${gid}（env 受 skyGroundCap 门禁，真会话才可见）`).toContain(
        `dock-${gid}`,
      );
    }
  });

  test("会话内 Scene→Post-processing 面板不再空态（有真 cap 控件）", async ({ page }) => {
    test.slow(); // 同 spec 邻座：会话启动 + 面板下钻贴近 20s 默认上限，统一放宽（2026-10-04）
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    await start3D(page);

    // 进 Scene 组
    const sceneBtn = page.locator('.mpc-overlay >> [data-testid="dock-scene"]');
    await sceneBtn.click();
    const popup = page.locator(".mpc-overlay >> .ysm-preview-menu");
    await expect(popup, "Scene 根视图应弹出").toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(400);

    // 下钻 Post-processing
    const pp = page.locator('.mpc-overlay >> [data-testid="preview-postproc"]');
    await expect(pp, "Scene 组应含 Post-processing 行").toBeVisible({ timeout: 5000 });
    await pp.click();
    await page.waitForTimeout(600);

    // 硬断言：真会话下必须渲染出 cap 控件，不能还是「进 3D 后再开」的说明文本
    const state = await page.evaluate(() => {
      const root = document.querySelector(".mpc-overlay")?.shadowRoot;
      const p = root?.querySelector(".ysm-preview-menu");
      const text = (p?.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        controls:
          p?.querySelectorAll("[data-testid^='cap-'], [data-testid^='preview-']").length ?? 0,
        text: text.slice(0, 120),
        saysNeed3D: /after entering 3D|before opening|3D preview/i.test(text),
      };
    });
    test.info().annotations.push({
      type: "postproc 面板",
      description: `${state.controls} 控件 / 「${state.text}」`,
    });
    await page.screenshot({ path: "e2e-web/_shots/3d-02-postproc.png" });

    // 真会话的核心断言：不再是空态说明
    expect(state.saysNeed3D, "真 3D 会话内后处理面板不应再提示「进 3D 后再开」").toBe(false);
    expect(state.controls, "真 3D 会话内后处理面板应渲染出 cap 控件").toBeGreaterThan(0);
  });

  test("地面自证：默认 sourceKind=solid → 实体承接面默认可见、参考网格默认不亮（2026-10-04 翻转，开箱即认得出地面）", async ({
    page,
  }) => {
    test.slow(); // 会话启动 + 菜单下钻 + 两次截图，超 20s 默认上限（同 spec 前两用例贴近上限）
    // 开 devtools 让 app-modules 挂载 window.ysmGroundProbe 调试钩子（对齐 debugGetSpec 范式）。
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("_devtools", "1"));
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await start3D(page);

    // 探针只读返回地面真相：sourceKind + surface/grid 可见性。
    const probe = await page.evaluate(() =>
      (window as unknown as { ysmGroundProbe?: () => unknown }).ysmGroundProbe?.(),
    );
    expect(probe, "devtools 下 ysmGroundProbe 应挂载且返回非空").not.toBeNull();
    expect(probe, "地面探针应返回结构化状态").toMatchObject({
      sourceKind: "solid", // 默认开箱即有实体承接面（2026-10 收口）
      surfaceVisible: true, // 默认实体承接面可见 —— 地面一眼认得出
      gridVisible: false, // 2026-10-04 默认翻转：承接面已承担 y=0 锚点，参考网格默认不亮（菜单可手动开）
    });

    // 截图回看：默认场景有实体承接面（灰棕）、无参考网格线，与探针快照一致。
    await page.screenshot({ path: "e2e-web/_shots/3d-ground-default.png" });

    // ── 关闭路径：经真实菜单把地面来源切到 none → 探针应翻转 surfaceVisible=false ──
    // 路径：dock-env → preview-env-cap-ground（chevron 展开）→ 材质 folder → cap-ground-mat-source select
    await page.locator('.mpc-overlay >> [data-testid="dock-env"]').click();
    await page.waitForTimeout(400);
    const groundRow = page.locator('.mpc-overlay >> [data-testid="preview-env-cap-ground"]');
    await expect(groundRow, "Environment 组应含地面行").toBeVisible({ timeout: 5000 });
    await groundRow.locator('[data-testid="row-chevron"]').click();
    await page.waitForTimeout(400);

    const sourceSel = page.locator('.mpc-overlay >> [data-testid="cap-ground-mat-source"] select');
    await expect(sourceSel, "地面材质来源 select 应渲染").toBeVisible({ timeout: 5000 });
    await sourceSel.selectOption("none");
    await page.waitForTimeout(400);

    const after = await page.evaluate(() =>
      (window as unknown as { ysmGroundProbe?: () => unknown }).ysmGroundProbe?.(),
    );
    expect(after, "切换 none 后探针应仍可读").toMatchObject({
      sourceKind: "none",
      surfaceVisible: false, // 实体承接面已关 —— 回到无表面层的纯净态
      gridVisible: false, // 参考网格默认关（本用例未动过菜单开关），none 态 = 无表面亦无网格线
    });
    await page.screenshot({ path: "e2e-web/_shots/3d-ground-none.png" });
  });
});
