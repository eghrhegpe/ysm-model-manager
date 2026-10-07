// ===== e2e-web 共享就绪等待（2026-10 收口：固定 sleep 等待正向结果 → Playwright 轮询）=====
//
// 病根（CI 实测）：本目录多个 spec 用「`page.goto("/")` → `await page.waitForTimeout(2000~2500)`
// → 立刻动手」当启动等待。固定 sleep 是墙钟等待，只对「本机 GPU 机 vite 冷启动 < 2s」成立；
// CI runner 上 vite 首启 + 应用启动链 + WASM 初始化远慢于此，于是 DnD 派发时 `tree-root`
// 还没建出来 / `openEmpty3DFullscreen` 时 app 还没挂载 —— **真 flaky**，正是知识卡
// `docs/knowledge/test-utils.md`「禁止用固定 sleep 等待正向结果」的判据。
// 两个 CI 恒红（fog-horizon-evidence / menu-3d-session）同源，非产品缺陷。
//
// 修法（按「异步等待三分法」：正等结果 → 轮询）：把「等 app 起来」变成**显式、有超时的
// 就绪条件**，而不是猜一个毫秒数。等待长度不再随机器快慢变化，只随「条件何时成立」变化。
//
// 分层：本模块只放 e2e-web（真 WebGL/真 dev server 链路）共用件；e2e/（mock 桥链路）
// 的等价物在 `e2e/helpers.ts|gotoApp`。两侧等待语义不同（后者等 nav-item 可见 + shadowRoot），
// 刻意不合并——合并会把「web 链路期望真 init」的判据带回 mock 套件。
import { expect, type Page } from "@playwright/test";

/** 慢启动宽限（毫秒）：SwiftShader 软渲染 + CI 冷启动下单步就绪的自然时长量级。 */
export const WEB_READY_TIMEOUT = 60_000;

/** 3D overlay 首帧就绪宽限：空场景 build + caps 注册 + rAF 循环起步。 */
export const OVERLAY_READY_TIMEOUT = 30_000;

/** 3D 渲染循环踏帧宽限：caps 注册在 build 之后，需若干帧才齐备。 */
export const FRAMES_TIMEOUT = 30_000;

/**
 * 等 web 应用启动链**完全落定**：`app-content` 挂载 → 其 shadowRoot 就绪 → `app-tree`
 * 子组件 shadowRoot 内的 `[data-testid="tree-root"]`（树容器）真实存在，
 * **且此后一段时间内不再发生导航**。
 *
 * 为什么等这一条而不是别的：本目录多数用例的第一步都是「派发组件级 DnD / 点树行」，
 * 而那条链路要求 `document → app-content.shadowRoot → app-tree.shadowRoot → tree-root`
 * 四跳全通（`import-dnd.ts|bindTreeDnD` 挂在 tree-root 上）。这条就绪即「可以动手操作」的
 * 充要条件，等它一个就够，无需另设启动哨兵。
 *
 * ⚠️ 为什么还要「等不再导航」（2026-10 实测踩坑）：应用启动链自己会触发一次**同 URL 导航**
 * （多个 spec 头注记载的竞态）。`tree-root` 可能在**那次导航之前**就已建出来——于是只等
 * `tree-root` 会立刻返回，紧随其后的 `page.evaluate` 正好撞上导航 → 抛
 * "Execution context was destroyed"。原实现用 `networkidle + 固定 2s` 能侥幸躲过，
 * 就是因为那 2s 恰好盖住了导航窗口；换成轮询后等待变短，反而更容易撞上。
 * 故本函数在「条件首次成立」之后必须再观察一个**静默窗口**：窗口内发生过导航就重头再来。
 * 这不是「用 sleep 等正向结果」，而是「确认正向结果稳定」——等待仍由条件驱动，只是
 * 加了抗抖动（debounce）语义。
 *
 * 注：树容器存在 ≠ 树里已有数据行；数据行由导入/加载决定，各用例自己的 expect.poll 兜底。
 */
export async function waitForAppReady(page: Page, timeout = WEB_READY_TIMEOUT): Promise<void> {
  const deadline = Date.now() + timeout;
  const settleMs = 800; // 静默窗口：窗口内无导航才认定启动链彻底停稳
  for (;;) {
    // 阶段一：条件轮询到 tree-root 出现（探针自身对导航容错，见 probeRaw）
    await expect
      .poll(() => treeRootFound(page), {
        timeout: Math.max(1, deadline - Date.now()),
        message: "应用启动链未落定（app-content → app-tree → tree-root 未就绪）",
      })
      .toBe(true);

    // 阶段二：静默窗口内若发生导航，说明启动链还没停稳，重新轮询
    const navSeen = await watchForNavigation(page, settleMs);
    if (!navSeen) return;
    if (Date.now() >= deadline) {
      throw new Error(`应用启动链在 ${timeout}ms 内未停稳（持续触发同 URL 导航）`);
    }
  }
}

/** 在 ms 毫秒窗口内是否观察到页面导航（含启动链的自发同 URL reload）。 */
async function watchForNavigation(page: Page, ms: number): Promise<boolean> {
  let navigated = false;
  const onNav = (): void => {
    navigated = true;
  };
  page.on("framenavigated", onNav);
  try {
    await new Promise((r) => setTimeout(r, ms));
  } finally {
    page.off("framenavigated", onNav);
  }
  return navigated;
}

/**
 * 等 `.mpc-overlay`（3D 会话 overlay）挂载且**内容已渲染**。
 *
 * 为什么需要它而不是裸 `expect(overlay).toBeVisible()`：overlay 宿主是容器，它在 3D 场景
 * build 完成前就可能已可见——那时它的 shadowRoot 里既没有 canvas 也没有菜单 dock，
 * 后续 `dock-*` 点击必然扑空。故就绪的判据取「**下一层**已渲染」：shadowRoot 内至少出现
 * 一个 canvas 或 `.preview-dock-nav`（真会话才有的两个子结构）。
 *
 * 注：这里刻意只判「下一层已渲染」，不递归进更深子树——深子树属被测对象自身结构，
 * 断言它等于把测试耦合到实现细节（知识卡「禁止 waitFor 条件耦合组件内部实现」）。
 */
export async function waitForOverlayReady(
  page: Page,
  timeout = OVERLAY_READY_TIMEOUT,
): Promise<void> {
  await expect
    .poll(() => probeBoolean(page, OVERLAY_RENDERED_FN), {
      timeout,
      message: "3D overlay 未渲染出 canvas/dock",
    })
    .toBe(true);
}

/**
 * 等 rAF 渲染循环真的在跑（连续两帧的「画布尺寸 + 帧计数」都一致且非零）。
 *
 * 取代 `start3D()` 尾部的 `waitForTimeout(2500)`：caps（如 `skyGroundCap`）在场景 build
 * 之后才注册，需要若干帧才齐备。轮询「帧计数增长且尺寸稳定」比固定 2.5s 更能反映
 * 「循环已稳定」，且慢机上会自动多等。
 */
export async function waitForRenderFrames(page: Page, timeout = FRAMES_TIMEOUT): Promise<void> {
  await expect
    .poll(() => framesStable(page), { timeout, message: "3D rAF 循环未稳定出帧" })
    .toBe(true);
}

/** 连续两次采样：尺寸非零且帧计数在增长（无探针时以「尺寸非零」保守放行）。 */
async function framesStable(page: Page): Promise<boolean> {
  const a = await frameSnapshot(page);
  if (a.w <= 0 || a.h <= 0) return false;
  if (!a.probe) return true; // 无帧探针：尺寸非零即认（保守不误杀）
  const b = await frameSnapshot(page);
  return b.w === a.w && b.h === a.h && b.count > a.count;
}

/** 跨两次 rAF 取一帧快照（等浏览器真画过这一帧，而非猜时长）。 */
async function frameSnapshot(
  page: Page,
): Promise<{ count: number; w: number; h: number; probe: boolean }> {
  const val = await probeRaw(page, FRAMES_STABLE_FN);
  if (val && typeof val === "object") {
    return val as { count: number; w: number; h: number; probe: boolean };
  }
  return { count: 0, w: 0, h: 0, probe: false };
}

/**
 * 应用启动链自己会触发一次同 URL 导航（应用启动时的一次 reload；本目录多个 spec 头注都
 * 记载了这个竞态）。导航会把 evaluate 上下文销毁，`page.evaluate` 随即抛
 * "Execution context was destroyed"——对一个**轮询**（= 会重复调用）的就绪探针来说，
 * 这不是失败，只是「时机未到」。故探针必须容错：捕获后当作 false，交给下一轮。
 *
 * 注意容错范围刻意收窄：只吞「上下文销毁」这一类导航竞态。其余 evaluate 错误
 * （选择器写错、真异常）必须原样抛出——否则就绪等待会退化成「永远 false 直到超时」，
 * 把真实故障伪装成慢启动（假绿的前身）。
 */
async function probeBoolean(page: Page, fn: string): Promise<boolean> {
  return Boolean(await probeRaw(page, fn));
}

/** 探针执行壳：注入函数体 → 求值；只吞「导航销毁上下文」这类竞态（见上）。 */
async function probeRaw(page: Page, fn: string): Promise<unknown> {
  try {
    const body = `return (${fn})();`;
    return await page.evaluate(new Function(body) as () => unknown);
  } catch (err) {
    const msg = String(err);
    if (/Execution context was destroyed|most likely because of a navigation/i.test(msg)) {
      return null;
    }
    throw err;
  }
}

/** 穿透双层 shadow DOM 查 `tree-root` 是否存在（不返回元素引用，避免跨 evaluate 句柄开销）。 */
export async function treeRootFound(page: Page): Promise<boolean> {
  return probeBoolean(
    page,
    `() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      return Boolean(treeHost?.shadowRoot?.querySelector('[data-testid="tree-root"]'));
    }`,
  );
}

/**
 * 清空 IndexedDB（用例间隔离，本目录 5 个 spec 同构重复）。
 *
 * ⚠️ 必须容错「导航销毁上下文」：应用启动链自己会触发一次同 URL 导航，若清库的
 * `page.evaluate` 恰好撞上它，`deleteDatabase` 那个 Promise 连同上下文一起消失，
 * Playwright 抛 "Execution context was destroyed, most likely because of a navigation"。
 * **原始 5 份内联实现全部裸抛**——在慢机/CI 上这会让整条用例死在「清库」这一步，
 * 报错却指向一个与断言毫无关系的函数（本目录 CI 失败名单里就有）：
 *   `at clearIdb (web-ysm-3d.spec.ts:63:14)`
 *
 * 语义上「清库没清成」本就不该是致命错：Playwright 每个测试用全新 browser context，
 * IndexedDB 天然隔离（web-ysm-3d 头注已写明这点），清库是「尽力而为」的额外保险。
 * 故撞导航 → 静默放行，让后续就绪等待去发现真正的问题；其余错误仍照常抛。
 */
export async function clearIdbBestEffort(page: Page): Promise<void> {
  await probeRaw(
    page,
    `async () => {
      await new Promise((res) => {
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
    }`,
  );
}

/**
 * overlay 是否已挂载且其 shadowRoot 内已渲染 canvas 或菜单 dock（= 真会话已 build）。
 * 注意：overlay 挂 document.body 且**带 Shadow DOM**，`document.querySelector` 不穿透
 * shadow 边界——故先取宿主再进其 shadowRoot（同 menu-3d-session 头注的陷阱，勿混用）。
 */
const OVERLAY_RENDERED_FN = `() => {
  const root = document.querySelector(".mpc-overlay")?.shadowRoot;
  if (!root) return false;
  return Boolean(root.querySelector("canvas") ?? root.querySelector(".preview-dock-nav"));
}`;

/**
 * 抓两次「画布尺寸 + rAF 帧计数」快照，返回是否已进入稳定出帧态。
 * 帧计数取 `window.__ysmFrameProbe`（若生产侧未暴露则退化为「尺寸非零即视为出帧」——
 * 判据不因探针缺失而恒假，避免把「没探针」误判成「没渲染」）。
 *
 * 用**连续两帧的差分**而不是「等若干个墙钟毫秒」：想验的是「rAF 循环在跑」，
 * 那就直接观察帧计数增长，不以时长代替观察。
 */
const FRAMES_STABLE_FN = `() => new Promise((res) => {
  const probe = window.__ysmFrameProbe;
  const read = () => {
    const cvs = document.querySelector(".mpc-overlay")?.shadowRoot?.querySelector("canvas");
    res({ count: probe ? probe() : 0, w: cvs?.width ?? 0, h: cvs?.height ?? 0, probe: Boolean(probe) });
  };
  requestAnimationFrame(() => requestAnimationFrame(read));
})`;
