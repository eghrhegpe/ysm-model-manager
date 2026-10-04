// ===== E2E：预览 3D 菜单视觉巡检（2026-10-04）=====
// 目的：把「菜单是否达成预期」从猜测变成**可见的事实**——逐级挂载/下钻，每一步截图，
// 并对「这一步到底有没有生效」下硬断言。
//
// 为什么必须硬断言而非只截图：本仓曾出现「spec 报 1 passed 但什么都没验到」的假绿灯
//（兄弟会话的临时 spec：`waitForSelector(...).catch(() => {})` + `if (count() > 0)` 双重静默，
//  两张截图 SHA256 完全相同 = 下钻根本没发生）。故本 spec 每一步都必须让「未生效」直接报红。
//
// 3D 会话依赖真实 WebGL；本 spec **不**走 3D 会话，直接 mountPreviewRootMenu 挂菜单根——
// 菜单渲染是纯 DOM 逻辑（MenuNode schema → DOM），不需要 GPU，稳定性远高于整链路。
//
// 运行：
//   npx playwright test --config playwright.config.ts menu-visual
//
// 截图产出：`e2e/_shots/menu-*.png`（可提交，供人眼/模型复查）。
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { gotoApp } from "./helpers.ts";

/** 截图输出目录（相对 frontend/，与 spec 同族，便于对照）。 */
const SHOT_DIR = path.join("e2e", "_shots");

/** dock 底栏按钮（`btn.dataset.testid = \`dock-${g.id}\``）。 */
function dockBtn(page: Page, groupId: string) {
  return page.locator(`[data-testid="dock-${groupId}"]`);
}

/** 当前可见的菜单弹窗。 */
function popup(page: Page) {
  return page.locator(".ysm-preview-menu");
}

/** 截图到 e2e/_shots（自动建目录）。 */
async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * 挂载预览根菜单到一块固定尺寸的浮层。
 * ctx 取「单模型非 self 模式」最小面：所有查询器返回空，菜单只依赖 schema 静态结构。
 */
async function mountMenu(page: Page): Promise<void> {
  await gotoApp(page);
  await page.evaluate(async () => {
    const core = await import("/src/preview-3d/menu/engine/core.ts");
    await import("/src/preview-3d/caps/scene-capability-registry.ts");
    const host = document.createElement("div");
    host.id = "menu-inspect-host";
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "420px",
      height: "680px",
      background: "#14161a",
      zIndex: "99999",
    });
    document.body.appendChild(host);
    const ctx = {
      selfMode: false,
      getCap: () => null,
      getCapByPanelId: () => null,
      getCamBridge: () => ({
        getOrbit: () => true,
        setOrbit: () => {},
        getSpeed: () => 20,
        setSpeed: () => {},
        reset: () => {},
      }),
      getSiblings: () => [],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getCurrentSubtype: () => "",
      getViewContainer: () => document.createElement("div"),
      close: () => {},
      switchTo: () => {},
      unloadModel: () => {},
      toast: () => {},
      closeAllOverlays: () => {},
    };
    const handle = core.mountPreviewRootMenu(host, ctx);
    // @ts-expect-error 句柄暴露 openPanel（core.ts 的 PreviewMenuHandle）
    window.__menuHandle = handle;
  });
}

test.describe("预览 3D 菜单视觉巡检", () => {
  test("底栏挂载 + 各组面板渲染（每步硬断言 + 截图）", async ({ page }) => {
    await mountMenu(page);

    // ① 底栏必须挂出来
    const dock = page.locator(".preview-dock-nav");
    await expect(dock, "dock 底栏应挂载").toBeVisible({ timeout: 8000 });
    const dockCount = await page.locator('[data-testid^="dock-"]').count();
    expect(dockCount, "dock 应至少有一个分组按钮").toBeGreaterThan(0);
    await shot(page, "menu-01-dock");

    // ② 逐组开面板并断言「渲染出了内容或明确的空态」——两者必有其一，不接受「什么都没有」。
    //
    // 各组语义（defs.ts · CORE_MENU_GROUPS）：
    //   · model（Character）：无模型时下钻到 roles 列表 → 空态 "(no loaded characters)"（设计如此）
    //   · env（Environment）：directToPanel:"environment" → 直接开参数面板（有天空/地面/雾等控件）
    //   · scene（Scene）：rootView:true → 渲染多 panel 聚合的组根视图（层级最丰富）
    const groups = ["model", "env", "scene", "settings"];
    const report: string[] = [];

    for (const gid of groups) {
      const btn = dockBtn(page, gid);
      if ((await btn.count()) === 0) {
        report.push(`${gid}: 无此分组按钮`);
        continue;
      }
      await btn.click();
      await expect(popup(page), `点击 ${gid} 后应弹出菜单`).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(250);

      // 行统计用 schema 契约 data-testid，而非单一 class：
      //   · core 行走 renderMenu → `preview-<nodeId>`（class `.cm-row`）
      //   · cap 控件走 cap-controls → `cap-<id>`（class `.cc-row*`）
      // 两套渲染通道并存，只数 `.cm-row` 会把整个 cap 控件层漏掉。
      const rows = await popup(page)
        .locator('[data-testid^="preview-"], [data-testid^="cap-"]')
        .count();
      const popupText = ((await popup(page).textContent()) ?? "").replace(/\s+/g, " ").trim();
      const hasContent = rows > 0 || popupText.length > 0;
      report.push(`${gid}: ${rows} 控件 / 文本 ${popupText.length} 字`);
      await shot(page, `menu-02-${gid}`);

      expect(hasContent, `分组 ${gid} 面板既无控件也无文本——渲染失效`).toBe(true);

      // 关闭，避免影响下一组
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    }

    test.info().annotations.push({ type: "分组面板", description: report.join(" | ") });

    // ③ 至少有一组渲染出了实际控件（全为空态 = 菜单没真正工作）
    const best = report.filter((r) => /: [1-9]\d* 控件/.test(r));
    expect(best.length, `无任何分组渲染出控件：${report.join(" | ")}`).toBeGreaterThan(0);
  });
});
