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
import { test, expect, type Page } from "@playwright/test";

/** 页面内构造 DataTransfer + File 并注入 drop 事件（defineProperty 强制注入） */
async function dropFile(page: Page, fileName: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ name, body }) => {
      // 穿透双层 shadow DOM：document → app-content.shadowRoot → app-tree.shadowRoot → #tree。
      // 组件级 DnD 监听器挂在 #tree 上（import-dnd.ts bindTreeDnD），派发到 document 事件
      // 无法进入 shadow 边界——此前 web 导入 e2e 静默失效的根因。
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const tree = treeHost?.shadowRoot?.getElementById("tree");
      if (!tree) throw new Error("app-tree #tree 未就绪，无法派发组件级 DnD");
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

/** 清空 IndexedDB（用例间隔离：每个用例独立模型库） */
async function clearIdb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase("ysm-model-manager-web");
      r.onsuccess = () => res();
      r.onerror = () => res(); // 库不存在等错误照常继续
      r.onblocked = () => res();
    });
  });
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

test.describe("网页版主链路（ADR-049）", () => {
  // P1 修复（审核发现，陷阱 #16）：此前无 pageerror/console error 守卫，页面内 JS
  // 崩溃/报错时用例仍可能假绿。现在统一在 beforeEach 收集，每个用例末尾断言零错误。
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    (page as Page & { __webSmokeErrors?: string[] }).__webSmokeErrors = errors;
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console.error: " + m.text());
    });
    // P1 修复（code review 复查）：/wails/runtime 请求监听必须在 goto 之前注册——
    // 若放测试体内，启动期请求（正是本用例要抓的回归）已先行触发，断言恒过（假绿）。
    const wailsReqs: string[] = [];
    (page as Page & { __webSmokeWailsReqs?: string[] }).__webSmokeWailsReqs = wailsReqs;
    page.on("request", (req) => {
      if (req.url().includes("/wails/runtime")) wailsReqs.push(req.url());
    });
    // 先 goto（about:blank 是 opaque origin，IndexedDB 被禁会 SecurityError）
    await page.goto("/", { waitUntil: "networkidle" });
    await clearIdb(page);
    await page.reload({ waitUntil: "networkidle" });
  });

  test.afterEach(async ({ page }) => {
    const errors = (page as Page & { __webSmokeErrors?: string[] }).__webSmokeErrors ?? [];
    expect(errors, "页面出现 JS 错误（pageerror/console.error）").toEqual([]);
    // 断言放在 afterEach：覆盖启动期 + reload + 树渲染全程的 /wails/runtime 请求
    const wailsReqs = (page as Page & { __webSmokeWailsReqs?: string[] }).__webSmokeWailsReqs ?? [];
    expect(wailsReqs, "出现 /wails/runtime 请求（browserAdapter 未短路）").toEqual([]);
  });

  test("主 UI 加载：组件渲染 + 零 Wails runtime 请求", async ({ page }) => {
    await expect(page).toHaveTitle(/YSM 模型管理器/);
    await expect(page.locator("app-nav")).toHaveCount(1);
    await expect(page.locator("app-content")).toHaveCount(1);
    // 树渲染（repo 页默认 tree tab）——poll 等待组件挂载完成（locale=en-US）
    await expect.poll(async () => allShadowText(page), { timeout: 8000 }).toContain("Model Repository");
    // /wails/runtime 零请求断言由 afterEach 统一执行（全程监听，见 beforeEach 注释）
  });

  test("拖拽导入 → IndexedDB 双记录 + 树刷新显示模型", async ({ page }) => {
    await dropFile(page, "网页e2e.ysm", "YSM-E2E-BYTES");
    await expect(page.locator("app-toast")).toContainText("导入", { timeout: 5000 });
    // 落库验证（dir + file 双记录）
    await expect.poll(async () => idbKeys(page)).toMatchObject({
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
    await expect.poll(async () => idbKeys(page), { timeout: 8000 }).toMatchObject({
      files: expect.arrayContaining(["dir:ysm/幂等:", "file:ysm/幂等/幂等.ysm"]),
    });
    await expect.poll(async () => idbFileBody(page, "file:ysm/幂等/幂等.ysm"), { timeout: 8000 }).toBe("v1");
    await dropFile(page, "幂等.ysm", "v2");
    // 等覆盖完成：body 真变为 v2（真实校验覆盖写逻辑）
    await expect.poll(async () => idbFileBody(page, "file:ysm/幂等/幂等.ysm"), { timeout: 8000 }).toBe("v2");
    const keys = await idbKeys(page);
    const fileKeys = keys.files.filter((k) => k.startsWith("file:ysm/幂等/"));
    expect(fileKeys).toHaveLength(1);
  });
});
