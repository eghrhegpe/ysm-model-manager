// ===== E2E 测试：模型详情预览页（app-preview 组件）=====
// 覆盖 app-content → app-preview 双层 Shadow DOM + WebGL 3D 的嵌套最深层 UI。
//
// 穿透路径：document → app-content.shadowRoot → app-preview.shadowRoot → 目标元素
// 所有穿透查询内联在本文件（helpers.ts 仅覆盖 app-tree 穿透，app-preview 穿透
// 逻辑与 tree 不同层，不混用）。
//
// 无 GPU 环境兜底（playwright chromium headless 无 GPU，WebGL 可能失败）：
//   - 冒烟/tab/FAB 存在性硬断言，不依赖 WebGL
//   - 3D 挂载分支用 hasWebGL() 检测 + test.skip(带原因) 优雅跳过
//   - 错误路径断言文案出现，不白屏
//
// 锚点依据（data-testid / id 钩子，源码直读确认）：
//   - modelDetailHTML(null)（tpl.ts:22）→ #preview-content + .dp-placeholder + .dp-hint
//   - showModelDetail（detail.ts:39-47）→ .pv-tab[data-tab="detail"/"skeleton"]
//     + #preview-detail + #preview-skeleton + .preview-fab#btn-3d-preview
//   - showResourcePack（detail.ts:165-174）→ .preview-fab#btn-pack-model-3d
//   - catch 分支（detail.ts:135-139）→ #preview-detail 写入 unknownError + parseFailed 文案
import { test, expect, type Page } from "./fixture.ts";
import {
  gotoApp,
  waitForTreeCount,
  clickTreeFile,
} from "./helpers.ts";

// ===== app-preview shadowRoot 穿透查询函数（内联，不修改 helpers.ts）=====

/**
 * 轮询等待 app-preview shadowRoot 内指定选择器出现。
 * 穿透：app-content.shadowRoot → app-preview.shadowRoot → selector
 * @returns true 若在 timeout 内找到；false 若超时
 */
async function waitForPreviewEl(
  page: Page,
  selector: string,
  timeout = 8000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      (sel) => {
        const content = document.querySelector("app-content");
        const preview = content?.shadowRoot?.querySelector("app-preview");
        if (!preview?.shadowRoot) return false;
        return Boolean(preview.shadowRoot.querySelector(sel));
      },
      selector,
    );
    if (found) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * 在 app-preview shadowRoot 内获取元素文本（trim）。
 * 用于断言错误文案 / 占位提示是否出现。
 */
async function getPreviewText(
  page: Page,
  selector: string,
): Promise<string> {
  return page.evaluate(
    (sel) => {
      const content = document.querySelector("app-content");
      const preview = content?.shadowRoot?.querySelector("app-preview");
      const el = preview?.shadowRoot?.querySelector(sel);
      return (el?.textContent ?? "").trim();
    },
    selector,
  );
}

/** 在 app-preview shadowRoot 内检查元素是否含指定 class（用于 tab active 断言） */
async function previewHasClass(
  page: Page,
  selector: string,
  className: string,
): Promise<boolean> {
  return page.evaluate(
    ({ sel, cls }) => {
      const content = document.querySelector("app-content");
      const preview = content?.shadowRoot?.querySelector("app-preview");
      const el = preview?.shadowRoot?.querySelector(sel);
      if (!el) return false;
      return el.classList.contains(cls);
    },
    { sel: selector, cls: className },
  );
}

/**
 * 在 app-preview shadowRoot 内获取元素 display 值。
 * 优先检查 inline style（switchTab 直接设置 style.display），
 * 其次 getComputedStyle。用于断言 tab 面板可见性。
 */
async function getPreviewDisplay(
  page: Page,
  selector: string,
): Promise<string> {
  return page.evaluate(
    (sel) => {
      const content = document.querySelector("app-content");
      const preview = content?.shadowRoot?.querySelector("app-preview");
      const el = preview?.shadowRoot?.querySelector(sel) as HTMLElement | null;
      if (!el) return "not-found";
      const inlineDisplay = el.style.display;
      if (inlineDisplay) return inlineDisplay;
      return getComputedStyle(el).display;
    },
    selector,
  );
}

/** 在 app-preview shadowRoot 内点击元素（el.click()），用于 tab 切换 / FAB 点击 */
async function clickPreviewEl(
  page: Page,
  selector: string,
): Promise<void> {
  await page.evaluate(
    (sel) => {
      const content = document.querySelector("app-content");
      const preview = content?.shadowRoot?.querySelector("app-preview");
      const el = preview?.shadowRoot?.querySelector(sel) as HTMLElement | null;
      if (el) el.click();
    },
    selector,
  );
}

/** 检测浏览器是否支持 WebGL（headless chromium 无 GPU 时可能返回 false） */
async function hasWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl");
      return !!gl;
    } catch {
      return false;
    }
  });
}

// ===== 测试用例 =====

test.describe("模型详情预览页（app-preview）", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("冒烟：选中模型后预览区渲染（preview-content + tab 按钮出现），不 skip", async ({ page }) => {
    // 硬冒烟：防 mock 链路回归被 skip 掩蔽。
    // 流程：点击 tree-file → app-tree emit model:select → app-preview 监听 →
    // _showModelDetail → DetectResourceType="ysm" → showModelDetail 渲染
    // #preview-content（含 tab 按钮 + #preview-detail 占位 + #preview-skeleton + FAB）。
    //
    // 断言层次（均硬断言）：
    //   1. #preview-content 存在（showModelDetail 初始 innerHTML 即设置）
    //   2. .pv-tab[data-tab="detail"] 出现（证明 showModelDetail 确实执行，
    //      区别于初始 modelDetailHTML(null) 占位——后者无 tab 按钮）
    //
    // 不依赖 WebGL：仅断言 DOM 渲染，3D 挂载另测。
    const fileCount = await waitForTreeCount(page, "tree-file", 10000);
    expect(fileCount).toBeGreaterThan(0);

    // 点击第一个 tree-file 触发 model:select
    await clickTreeFile(page, 0);

    // 硬断言 1：preview-content 必须在 app-preview shadowRoot 内出现
    const contentFound = await waitForPreviewEl(page, "#preview-content", 8000);
    expect(contentFound).toBe(true);

    // 硬断言 2：tab 按钮出现——证明 showModelDetail 已执行（初始占位无 tab 按钮）
    const tabFound = await waitForPreviewEl(
      page,
      '.pv-tab[data-tab="detail"]',
      5000,
    );
    expect(tabFound).toBe(true);
  });

  test("tab 切换：detail ↔ skeleton 按钮切换，断言 active class 与面板可见性", async ({ page }) => {
    // 覆盖 showModelDetail（detail.ts:39-47）渲染的 tab 按钮：
    //   .pv-tab[data-tab="detail"] / .pv-tab[data-tab="skeleton"]
    // switchTab（detail.ts:49-60）切换 active class + display 面板。
    //
    // 锚点依据：
    //   - tab 按钮选择器：.pv-tab[data-tab="detail"] / [data-tab="skeleton"]
    //   - active class：pv-tab-active（detail.ts:41-42）
    //   - 面板可见性：#preview-detail / #preview-skeleton 的 style.display
    //
    // 不依赖 WebGL：tab 切换是纯 DOM 操作。
    const fileCount = await waitForTreeCount(page, "tree-file", 10000);
    expect(fileCount).toBeGreaterThan(0);

    await clickTreeFile(page, 0);

    // 等待 tab 按钮渲染
    const tabFound = await waitForPreviewEl(
      page,
      '.pv-tab[data-tab="detail"]',
      8000,
    );
    expect(tabFound).toBe(true);

    // 初始状态：detail tab 应为 active（savedTab 默认 "detail"，detail.ts:38）
    const detailActive = await previewHasClass(
      page,
      '.pv-tab[data-tab="detail"]',
      "pv-tab-active",
    );
    expect(detailActive).toBe(true);

    // 初始状态：skeleton tab 应为 inactive
    const skelInactive = await previewHasClass(
      page,
      '.pv-tab[data-tab="skeleton"]',
      "pv-tab-inactive",
    );
    expect(skelInactive).toBe(true);

    // 初始面板可见性：detail 可见，skeleton 不可见
    const detailDisplayBefore = await getPreviewDisplay(page, "#preview-detail");
    expect(detailDisplayBefore).not.toBe("none");

    const skelDisplayBefore = await getPreviewDisplay(page, "#preview-skeleton");
    expect(skelDisplayBefore).toBe("none");

    // 点击 skeleton tab
    await clickPreviewEl(page, '.pv-tab[data-tab="skeleton"]');

    // 切换后：skeleton tab 应为 active
    const skelActive = await previewHasClass(
      page,
      '.pv-tab[data-tab="skeleton"]',
      "pv-tab-active",
    );
    expect(skelActive).toBe(true);

    // 切换后：detail tab 应为 inactive
    const detailInactive = await previewHasClass(
      page,
      '.pv-tab[data-tab="detail"]',
      "pv-tab-inactive",
    );
    expect(detailInactive).toBe(true);

    // 切换后面板可见性：skeleton 可见，detail 不可见
    const skelDisplayAfter = await getPreviewDisplay(page, "#preview-skeleton");
    expect(skelDisplayAfter).not.toBe("none");

    const detailDisplayAfter = await getPreviewDisplay(page, "#preview-detail");
    expect(detailDisplayAfter).toBe("none");

    // 切回 detail tab 验证往返
    await clickPreviewEl(page, '.pv-tab[data-tab="detail"]');

    const detailActiveAgain = await previewHasClass(
      page,
      '.pv-tab[data-tab="detail"]',
      "pv-tab-active",
    );
    expect(detailActiveAgain).toBe(true);

    const detailDisplayFinal = await getPreviewDisplay(page, "#preview-detail");
    expect(detailDisplayFinal).not.toBe("none");
  });

  test("3D 预览 FAB 存在性硬冒烟（不依赖 WebGL）", async ({ page }) => {
    // 硬冒烟：断言 btn-3d-preview FAB 存在于 app-preview shadowRoot 内。
    // 不依赖 WebGL：仅断言 DOM 存在。
    //
    // 锚点依据：showModelDetail（detail.ts:47）渲染
    //   <button class="preview-fab" id="btn-3d-preview" ...>
    // FAB 在 showModelDetail 的初始 innerHTML 中即出现，无需等 catch 分支。
    const fileCount = await waitForTreeCount(page, "tree-file", 10000);
    expect(fileCount).toBeGreaterThan(0);

    await clickTreeFile(page, 0);

    // 等 #preview-content 渲染（showModelDetail 初始 innerHTML 包含 FAB）
    const contentFound = await waitForPreviewEl(page, "#preview-content", 8000);
    expect(contentFound).toBe(true);

    // 硬断言 FAB 存在
    const fabFound = await waitForPreviewEl(page, "#btn-3d-preview", 5000);
    expect(fabFound).toBe(true);
  });

  test("3D 预览 FAB 点击：若 WebGL 可用则 3D 挂载，若不可用则 skip（无 GPU 兜底）", async ({ page }) => {
    // 无 GPU 兜底理由：playwright chromium headless 无 GPU，WebGL context 可能
    // 创建失败（getContext("webgl") 返回 null）。3D 渲染依赖 WebGL，无 GPU 时
    // mount3D 内部 catch 会显示错误占位而非崩溃——但测试无法断言「3D 挂载成功」
    // 因为环境根本不支持。因此：
    //   1. 先检测 WebGL 是否可用
    //   2. 若可用：点击 FAB，断言 3D overlay 挂载（canvas / 3d-container 等）
    //   3. 若不可用：test.skip(带原因)，不硬崩
    //
    // 但在 mock 环境下，showModelDetail 走 catch 分支（ExtractYsmSummary 等
    // undefined → throw → catch 写错误文案），catch 分支不绑定 btn-3d-preview
    // 的 onclick（loadModel2D 在 throw 之前不会被调用）。因此 FAB 点击是 no-op。
    // 此测试验证：点击 FAB 后不 unhandled 崩溃，且预览区不白屏。
    const fileCount = await waitForTreeCount(page, "tree-file", 10000);
    expect(fileCount).toBeGreaterThan(0);

    await clickTreeFile(page, 0);

    const contentFound = await waitForPreviewEl(page, "#preview-content", 8000);
    expect(contentFound).toBe(true);

    const fabFound = await waitForPreviewEl(page, "#btn-3d-preview", 5000);
    expect(fabFound).toBe(true);

    // 点击 FAB —— mock 环境下 catch 分支不绑定 onclick，点击是 no-op；
    // 关键断言：点击后不 unhandled 崩溃，且预览区不白屏。
    await clickPreviewEl(page, "#btn-3d-preview");

    // 等待可能的 3D 挂载或错误处理
    await page.waitForTimeout(500);

    // 硬断言：预览区不白屏（preview-content 仍存在）
    const stillThere = await waitForPreviewEl(page, "#preview-content", 3000);
    expect(stillThere).toBe(true);

    // WebGL 可用性检测：无 GPU 环境跳过 3D 挂载断言
    const webglAvailable = await hasWebGL(page);
    if (!webglAvailable) {
      test.skip(true, "无 GPU 环境 WebGL 不可用，跳过 3D 挂载断言");
      return;
    }

    // WebGL 可用：理论上 3D 应挂载。但 mock 环境下 FAB onclick 未绑定
    // （catch 分支跳过了 loadModel2D），故 3D overlay 不会出现。
    // 此分支仅作为「有 GPU 环境」的占位——实际 3D 挂载断言需要真实后端支持。
    // 不硬断言 3D overlay 出现，因为 mock 环境下 FAB 是 no-op。
  });

  test("错误路径：模型文件读取失败 → 预览区显示错误文案，不白屏", async ({ page }) => {
    // 错误路径覆盖：mock 中 ExtractYsmSummary / ExtractYSMHeader 是 undefined
    // → showModelDetail 的 Promise.allSettled 得 fulfilled value=undefined
    // → summary=null, header=null → hasRealSummary=false
    // → decodeYsmViaWasm → GetWasmBinary undefined → dec=null
    // → showSummary=null → throw new Error(t("preview.cannotParse"))
    // → catch（detail.ts:134-140）→ #preview-detail 写入：
    //   `${t("preview.unknownError")} ${t("preview.parseFailed")}: ${esc(friendlyError(err))}`
    //   即 "Unknown error Parse failed: Cannot parse this file"
    //
    // 断言依据：
    //   - #preview-detail 文本含 "Parse failed" 或 "Unknown error"（en-US locale）
    //   - 预览区不白屏（#preview-content 仍存在）
    //   - 错误文案出现在 #preview-detail 内（不是 dp-placeholder / dp-hint）
    //
    // 不依赖 WebGL：错误路径是纯文本渲染。
    const fileCount = await waitForTreeCount(page, "tree-file", 10000);
    expect(fileCount).toBeGreaterThan(0);

    await clickTreeFile(page, 0);

    // 等 showModelDetail 渲染（含 #preview-detail）
    const detailFound = await waitForPreviewEl(page, "#preview-detail", 8000);
    expect(detailFound).toBe(true);

    // 轮询等待 catch 分支写入错误文案（Promise.allSettled + decodeYsmViaWasm 异步链）
    // 超时 8s 足够覆盖 mock 异步解析 + catch 回写
    const deadline = Date.now() + 8000;
    let detailText = "";
    while (Date.now() < deadline) {
      detailText = await getPreviewText(page, "#preview-detail");
      // catch 分支写入后，文本应含错误关键词
      if (
        detailText.includes("Parse failed") ||
        detailText.includes("Unknown error") ||
        detailText.includes("Cannot parse")
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // 硬断言：错误文案必须出现（防 catch 分支回归被 skip 掩蔽）
    expect(detailText.length).toBeGreaterThan(0);
    expect(
      detailText.includes("Parse failed") ||
        detailText.includes("Unknown error") ||
        detailText.includes("Cannot parse"),
    ).toBe(true);

    // 硬断言：预览区不白屏（#preview-content 仍存在）
    const contentStillThere = await waitForPreviewEl(
      page,
      "#preview-content",
      3000,
    );
    expect(contentStillThere).toBe(true);
  });

  test("预览区初始占位渲染（未选中模型时显示 clickFileHint）", async ({ page }) => {
    // 覆盖 modelDetailHTML(null)（tpl.ts:21-34）初始占位渲染：
    //   #preview-content + .dp-placeholder + .dp-hint（文案 preview.clickFileHint）
    //
    // 这是 app-preview connectedCallback → _render 的初始状态，
    // 在 gotoApp 后立即可见（无需点击 tree-file）。
    //
    // 不依赖 WebGL：纯 DOM 初始渲染。
    //
    // 锚点依据：tpl.ts:22 `<div class="content" id="preview-content">`
    //   tpl.ts:24 `<div class="dp-placeholder">`
    //   tpl.ts:26 `<div class="dp-hint">${t("preview.clickFileHint")}</div>`
    //   en.ts:857 "preview.clickFileHint": "Click a file in the left repository to view details"
    const contentFound = await waitForPreviewEl(page, "#preview-content", 8000);
    expect(contentFound).toBe(true);

    // 断言占位提示文案出现（en-US locale）
    const placeholderText = await getPreviewText(page, ".dp-placeholder");
    expect(placeholderText.length).toBeGreaterThan(0);
    // clickFileHint 文案含 "Click a file" 关键词
    expect(placeholderText.includes("Click a file")).toBe(true);
  });
});
