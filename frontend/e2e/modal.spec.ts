// ===== E2E 测试：modal 遮罩弹窗（ADR-037 + §19.1 testid）=====
// 走真实 modal.ts 路径（vite dev 动态 import），断言基于 data-testid 稳定钩子：
//   dlg-overlay（遮罩）/ dlg-input（输入框）/ dlg-select（下拉）/ dlg-ok / dlg-cancel
// 覆盖 modalConfirm / modalPrompt 的 打开 → 确认 / 取消 / Esc 关闭 全链路。
import { test, expect, type Page } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

/** 页面上挂结果的位置（window 自定义字段，e2e 专用） */
interface DlgResultHolder {
  _dlgPromise?: Promise<unknown>;
  _dlgResult?: unknown;
}

type DlgWindow = Window & DlgResultHolder;

/** 动态 import modal.ts 并打开弹窗，Promise 挂到 window._dlgPromise */
async function openModal(
  page: Page,
  kind: "confirm" | "prompt",
  opts: Record<string, unknown>,
): Promise<void> {
  const ok = await page.evaluate(
    async ({ kind: k, opts: o }) => {
      const mod = await import("../src/features/dialogs/modal.ts");
      const w = window as DlgWindow;
      w._dlgPromise =
        k === "confirm" ? mod.modalConfirm(o) : mod.modalPrompt(o);
      return true;
    },
    { kind, opts: { title: "E2E 遮罩测试", message: "确认要执行吗？", ...opts } },
  );
  expect(ok).toBe(true);
}

/** 读取弹窗 resolve 结果（等 Promise settle） */
async function dlgResult(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const w = window as DlgWindow;
    w._dlgResult = await w._dlgPromise;
    return w._dlgResult;
  });
}

test.describe("modal 遮罩弹窗", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("modalConfirm 打开 → 遮罩与标题可见", async ({ page }) => {
    await openModal(page, "confirm", {});
    const overlay = page.locator('[data-testid="dlg-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
    await expect(overlay).toContainText("E2E 遮罩测试");
    await expect(overlay.locator('[data-testid="dlg-ok"]')).toBeVisible();
    await expect(overlay.locator('[data-testid="dlg-cancel"]')).toBeVisible();
  });

  test("modalConfirm 点 dlg-ok → resolve true 且遮罩关闭", async ({ page }) => {
    await openModal(page, "confirm", {});
    const overlay = page.locator('[data-testid="dlg-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
    await overlay.locator('[data-testid="dlg-ok"]').click();
    expect(await dlgResult(page)).toBe(true);
    await expect(overlay).not.toBeVisible();
  });

  test("modalConfirm 点 dlg-cancel → resolve false 且遮罩关闭", async ({ page }) => {
    await openModal(page, "confirm", {});
    const overlay = page.locator('[data-testid="dlg-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
    await overlay.locator('[data-testid="dlg-cancel"]').click();
    expect(await dlgResult(page)).toBe(false);
    await expect(overlay).not.toBeVisible();
  });

  test("modalConfirm 按 Esc → resolve false", async ({ page }) => {
    await openModal(page, "confirm", {});
    const overlay = page.locator('[data-testid="dlg-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
    expect(await dlgResult(page)).toBe(false);
  });

  test("modalPrompt 输入值后点 dlg-ok → resolve 输入内容", async ({ page }) => {
    await openModal(page, "prompt", {});
    const overlay = page.locator('[data-testid="dlg-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
    await overlay.locator('[data-testid="dlg-input"]').fill("我的目录");
    await overlay.locator('[data-testid="dlg-ok"]').click();
    expect(await dlgResult(page)).toBe("我的目录");
  });

  test("modalPrompt 点 dlg-cancel → resolve null", async ({ page }) => {
    await openModal(page, "prompt", {});
    const overlay = page.locator('[data-testid="dlg-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
    await overlay.locator('[data-testid="dlg-cancel"]').click();
    expect(await dlgResult(page)).toBeNull();
  });
});
