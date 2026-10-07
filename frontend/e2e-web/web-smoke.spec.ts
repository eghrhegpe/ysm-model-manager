// ===== E2E 测试：网页版（Web 版）主链路（ADR-049 Phase 3 固化）=====
// 真实 browserAdapter 链路（无 Wails 壳 / 无 mock）：vite dev --mode web →
// resolveWebMode true → getApp() 路由到 browserAdapter（IndexedDB 模型库）。
// 覆盖：
//   1. 主 UI 加载：app-nav/app-content 渲染，零 /wails/runtime 请求（无 Wails 壳）
//   2. 拖拽导入 → IndexedDB dir:/file: 双记录 + 树刷新显示模型 + toast
//   3. 配置写入 → config store 落库
//
// Chromium 陷阱（同 dnd.spec.ts）：new DragEvent({dataTransfer}) 构造器忽略
// dataTransfer（只读）→ 必须 Object.defineProperty 强制注入。
import { expect, type Page, test } from "@playwright/test";
import { clearIdbBestEffort, waitForAppReady } from "./web-ready.ts";

/** 页面内构造 DataTransfer + File 并注入 drop 事件（defineProperty 强制注入）。
 *  前置就绪由 beforeEach 的 `waitForAppReady` 轮询承担，本函数只负责派发本身。 */
async function dropFile(page: Page, fileName: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ name, body }) => {
      // 穿透双层 shadow DOM：document → app-content.shadowRoot → app-tree.shadowRoot → tree-root。
      // 组件级 DnD 监听器挂在 tree（data-testid="tree-root"，import-dnd.ts bindTreeDnD）上，
      // 派发到 document 事件无法进入 shadow 边界——此前 web 导入 e2e 静默失效的根因。
      // ADR-133 定位契约：tree 走 testid 通道（#tree id 无稳定钩子，门禁 ① 判 VIOLATION）。
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const tree = treeHost?.shadowRoot?.querySelector('[data-testid="tree-root"]');
      if (!tree) throw new Error("app-tree tree-root 未就绪，无法派发组件级 DnD");
      const dt = new DataTransfer();
      dt.items.add(new File([body], name, { type: "application/octet-stream" }));
      const ev = new DragEvent("drop", { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
      tree.dispatchEvent(ev);
    },
    { name: fileName, body: content },
  );
}

/** 递归穿透 shadow DOM 收集文本（document.querySelector 不穿透 open shadowRoot） */
async function allShadowText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const texts: string[] = [];
    const walk = (root: Document | ShadowRoot): void => {
      root.querySelectorAll("*").forEach((n) => {
        if (n.shadowRoot) walk(n.shadowRoot);
        // 跳过 script/style 自身（其文本是 JS/CSS 源码），父元素文本也会含其全文，
        // 故同时只收集叶子节点文本
        if (n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
        if (n.children.length === 0 && n.textContent?.trim()) texts.push(n.textContent.trim());
      });
    };
    walk(document);
    return texts.join(" | ");
  });
}

/** 读 IndexedDB 全部 store 的 key（真实验证落库，绕过 UI 间接断言） */
async function idbKeys(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("ysm-model-manager-web");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const per: Record<string, string[]> = {};
    for (const n of Array.from(db.objectStoreNames)) {
      const keys = await new Promise<string[]>((res, rej) => {
        const tx = db.transaction(n, "readonly");
        const req = tx.objectStore(n).getAllKeys();
        req.onsuccess = () => res(req.result.map(String));
        req.onerror = () => rej(req.error);
      });
      per[n] = keys;
    }
    db.close();
    return per;
  });
}

/** 清空 IndexedDB（用例间隔离：每个用例独立模型库）；撞应用启动导航时静默放行 */
async function clearIdb(page: Page): Promise<void> {
  await clearIdbBestEffort(page);
}

/** 读指定 file: 记录的内容（验证幂等覆盖写：body 应变 v2） */
async function idbFileBody(page: Page, key: string): Promise<string> {
  return page.evaluate(async (k) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("ysm-model-manager-web");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const body = await new Promise<string>((res, rej) => {
      const tx = db.transaction("files", "readonly");
      const req = tx.objectStore("files").get(k);
      req.onsuccess = () => {
        const v = req.result as { data?: ArrayBuffer } | undefined;
        res(v?.data ? new TextDecoder().decode(v.data) : "");
      };
      req.onerror = () => rej(req.error);
    });
    db.close();
    return body;
  }, key);
}

// 2026-10-08 实证：CI swiftshader 负载下 vite dev 页面导航偶发基础设施竞态——
// "Protocol error (Page.reload): Not attached to an active page" / "net::ERR_ABORTED;
// maybe frame was detached?"（HMR 全量重载与手动导航相撞）。仅对这两类已知抖动重试一次，
// 断言失败仍硬红（同 check-go-diff-coverage「瞬态失败重试一次」口径，不掩盖竞态）。
async function navOnce(nav: () => Promise<unknown>): Promise<void> {
  try {
    await nav();
  } catch (e) {
    if (!/Not attached to an active page|ERR_ABORTED|frame was detached/.test(String(e))) throw e;
    await nav();
  }
}

test.describe("网页版主链路（ADR-049）", () => {
  // P1 修复（审核发现，陷阱 #16）：此前无 pageerror/console error 守卫，页面内 JS
  // 崩溃/报错时用例仍可能假绿。现在统一在 beforeEach 收集，每个用例末尾断言零错误。
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    (page as Page & { __webSmokeErrors?: string[] }).__webSmokeErrors = errors;
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });
    // P1 修复（code review 复查）：/wails/runtime 请求监听必须在 goto 之前注册——
    // 若放测试体内，启动期请求（正是本用例要抓的回归）已先行触发，断言恒过（假绿）。
    const wailsReqs: string[] = [];
    (page as Page & { __webSmokeWailsReqs?: string[] }).__webSmokeWailsReqs = wailsReqs;
    page.on("request", (req) => {
      if (req.url().includes("/wails/runtime")) wailsReqs.push(req.url());
    });
    // 先 goto（about:blank 是 opaque origin，IndexedDB 被禁会 SecurityError）
    // waitUntil 用 domcontentloaded 而非 networkidle（2026-10-08 实证）：vite dev 冷启动 +
    // HMR websocket 下 networkidle 极难等定，首个用例 20s 测试超时内必挂（web-smoke 主 UI 加载
    // 在 CI 上 3/4 轮红），而其余 e2e-web spec 全部用 domcontentloaded 稳定通过（web-preview
    // 同负载下裸 domcontentloaded 也绿）。真正的就绪门槛是下方 waitForAppReady，
    // networkidle 的额外严格毫无收益、纯增抖动面。
    await navOnce(() => page.goto("/", { waitUntil: "domcontentloaded" }));
    await clearIdb(page);
    // clearIdb 后重新引导应用：用 goto("/") 而非 reload（2026-10-08 实证：reload 在
    // swiftshader 负载下偶发 "Not attached to an active page" / "frame was detached"——
    // HMR 全量重载与手动 reload 相撞；其余 e2e-web spec 均以 goto 引导，本处对齐）。
    await navOnce(() => page.goto("/", { waitUntil: "domcontentloaded" }));
    // 应用启动链落定（tree-root 就绪）再交棒用例——用例体内第一步就是派发 DnD，
    // 此前无任何启动等待，CI 慢启动下必撞「tree-root 未就绪」
    await waitForAppReady(page);
  });

  test.afterEach(async ({ page }) => {
    const errors = (page as Page & { __webSmokeErrors?: string[] }).__webSmokeErrors ?? [];
    expect(errors, "页面出现 JS 错误（pageerror/console.error）").toEqual([]);
    // 断言放在 afterEach：覆盖启动期 + reload + 树渲染全程的 /wails/runtime 请求
    const wailsReqs = (page as Page & { __webSmokeWailsReqs?: string[] }).__webSmokeWailsReqs ?? [];
    expect(wailsReqs, "出现 /wails/runtime 请求（browserAdapter 未短路）").toEqual([]);
  });

  test("主 UI 加载：组件渲染 + 零 Wails runtime 请求", async ({ page }) => {
    // locale=en-US 由配置钉定；标题是 static-a11y-labels 运行时用 i18n 值覆盖的 document.title，
    // en 语言包为 "YSM Model Manager"（zh 旧断言 /YSM 模型管理器/ 在 en-US 下确定性红 13 连败）。
    // 断言 en 精确值——与本例 "Model Repository" 的 en 精确文案惯例一致，locale 泄漏即翻红。
    await expect(page).toHaveTitle("YSM Model Manager");
    await expect(page.locator("app-nav")).toHaveCount(1);
    await expect(page.locator("app-content")).toHaveCount(1);
    // 树渲染（repo 页默认 tree tab）——poll 等待组件挂载完成（locale=en-US）
    await expect
      .poll(async () => allShadowText(page), { timeout: 8000 })
      .toContain("Model Repository");
    // /wails/runtime 零请求断言由 afterEach 统一执行（全程监听，见 beforeEach 注释）
  });

  test("拖拽导入 → IndexedDB 双记录 + 树刷新显示模型", async ({ page }) => {
    await dropFile(page, "网页e2e.ysm", "YSM-E2E-BYTES");
    await expect(page.locator("app-toast")).toContainText("导入", { timeout: 5000 });
    // 落库验证（dir + file 双记录）
    await expect
      .poll(async () => idbKeys(page))
      .toMatchObject({
        files: expect.arrayContaining(["dir:ysm/网页e2e:", "file:ysm/网页e2e/网页e2e.ysm"]),
      });
    // 树刷新显示模型（tree:reload → ScanModelEntries 重扫）
    await expect.poll(async () => allShadowText(page), { timeout: 5000 }).toContain("网页e2e");
  });

  test("重复导入同名模型 → 覆盖写（幂等）", async ({ page }) => {
    await dropFile(page, "幂等.ysm", "v1");
    // P2 修复（伪验证）：两次 drop 无等待会撞 _dropBusy（import-dnd.ts:127-133 busy
    // 短路），第二次仅首次导入落库 → 断言 1 条 key 恒通过，覆盖写坏了也测不出来。
    // 现在先等首次导入完成（dir 记录出现 + body 为 v1），再 drop v2。
    await expect
      .poll(async () => idbKeys(page), { timeout: 8000 })
      .toMatchObject({
        files: expect.arrayContaining(["dir:ysm/幂等:", "file:ysm/幂等/幂等.ysm"]),
      });
    await expect
      .poll(async () => idbFileBody(page, "file:ysm/幂等/幂等.ysm"), { timeout: 8000 })
      .toBe("v1");
    await dropFile(page, "幂等.ysm", "v2");
    // 等覆盖完成：body 真变为 v2（真实校验覆盖写逻辑）
    await expect
      .poll(async () => idbFileBody(page, "file:ysm/幂等/幂等.ysm"), { timeout: 8000 })
      .toBe("v2");
    const keys = await idbKeys(page);
    const fileKeys = keys.files.filter((k) => k.startsWith("file:ysm/幂等/"));
    expect(fileKeys).toHaveLength(1);
  });
});
