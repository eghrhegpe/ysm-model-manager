// ===== 诊断页：同步冲突（conflicts.ts）测试 =====
// ⚠️ locale 前提：本文件写死 zh-CN 文案断言，依赖 test-setup 把 t() 钉在 zhCN 查表；
// e2e（playwright.config 钉浏览器 locale en-US）走的是 en 包，勿以本文件为 e2e 文案参照。
// 覆盖：
//  - initSyncConflictPanel（常驻参数栏，ADR-288 D2/D3）：类型/实例下拉填充（Exists 过滤 +
//    默认选首）/ 无游戏目录 / 无可用实例 / 上下文读取失败（原因落结果区 + 按钮禁用）/ 缺元素静默
//  - runSyncConflictScan：web 门禁 / 重入守卫（并发第二次早退 + 禁用外观）/ 无冲突 / 有冲突渲染 /
//    error 通道 / 异常兜底 / **扫描后扫描按钮仍在且可复用**（ADR-288 §1 dead-end 墓碑）
//  - 同步冲突解决：ResolveConflicts 策略透传 + 结果计数 + 1.5s 自动复扫 / error / 异常
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@/test-utils/index.ts";
import { type DgCfScanTarget, initSyncConflictPanel, runSyncConflictScan } from "./conflicts.ts";

const { busEmit, busOn, getApp, isWebPlatform } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  busOn: vi.fn(() => () => {}),
  getApp: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/bus", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("@/backend/app.ts", () => ({ getApp }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * 夹具对齐**真实 tpl**（ADR-288 D2 两段式）：栏内含选择器与扫描按钮，结果区是栏的**兄弟**。
 *
 * ⚠️ 这里刻意复制真实父子/兄弟关系：旧夹具把按钮与结果容器建成**兄弟**（比真相宽松），
 * 因而漏掉了「按钮住在结果容器内 → 首次扫描的整块 innerHTML 把它抹掉」这条 dead-end
 * （ADR-288 §1）。下面的「扫描后按钮仍在」用例即以本夹具为墓碑。
 */
function makePanel(): { bar: HTMLElement; list: HTMLElement; scanBtn: HTMLButtonElement } {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="diag-bar" id="diag-sync-bar">
      <div class="diag-bar-row">
        <select id="sync-rtype"></select>
        <select id="sync-instance"></select>
        <button id="diag-scan-sync-conflict">扫描同步冲突</button>
      </div>
    </div>
    <div id="diag-sync-conflict-list"><span class="sentinel">占位</span></div>
  `;
  // 挂进 document：`isConnected` 是真浏览器语义（面板缓存/复扫守卫都按它判「是否还在页面里」），
  // 分离 DOM 下断言会退化成恒 false（首版即踩）。
  document.body.appendChild(root);
  return {
    bar: root.querySelector("#diag-sync-bar") as HTMLElement,
    list: root.querySelector("#diag-sync-conflict-list") as HTMLElement,
    scanBtn: root.querySelector("#diag-scan-sync-conflict") as HTMLButtonElement,
  };
}

/** 扫描目标：默认 ysm + insA，无按钮引用（纯函数式调用）；需要按钮外观时传 scanBtn */
function target(overrides: Partial<DgCfScanTarget> = {}): DgCfScanTarget {
  return { rtype: "ysm", instance: "insA", scanBtn: null, ...overrides };
}

function mockApp(overrides: Record<string, unknown> = {}) {
  getApp.mockResolvedValue({
    LoadAppConfig: vi.fn(() => ({ mcRoot: "/mc" })),
    ListVersionInstances: vi.fn(() => []),
    DetectConflicts: vi.fn(() => ({ conflicts: [], totalConflicts: 0 })),
    ResolveConflicts: vi.fn(() => ({ resolved: 1, failed: 0, manual: 0 })),
    ...overrides,
  });
}

/** 供重入守卫测试用：首次 DetectConflicts 挂起，之后正常返回 */
function detectPendingThenOk(first: unknown) {
  let calls = 0;
  let release: (v: unknown) => void = () => {};
  const detect = vi.fn(() => {
    calls++;
    if (calls === 1) {
      return new Promise((res) => {
        release = res;
      });
    }
    return Promise.resolve(first);
  });
  return { detect, release: (v: unknown) => release(v) };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
  mockApp();
});

describe("initSyncConflictPanel（常驻参数栏）", () => {
  it("填充下拉：Exists 过滤 + 默认选中首个可用实例 + 按钮可用 + 结果区不动", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true },
        { Name: "insB", Exists: false },
        { Name: "insC", Exists: true },
      ]),
    });
    const { bar, list, scanBtn } = makePanel();
    await initSyncConflictPanel(bar, list, esc);

    const rtype = bar.querySelector("#sync-rtype") as HTMLSelectElement;
    const instance = bar.querySelector("#sync-instance") as HTMLSelectElement;
    expect(rtype.textContent).toContain("YSM 模型"); // RESOURCE_TYPE_LABELS 首项
    const optTexts = Array.from(instance.querySelectorAll("option")).map((o) => o.textContent);
    expect(optTexts).toContain("insA");
    expect(optTexts).toContain("insC");
    expect(optTexts).not.toContain("insB");
    expect(instance.value).toBe("insA"); // 默认选中首个可用实例
    expect(scanBtn.disabled).toBe(false);
    // 栏初始化只填充参数，**不写结果区**（结果区仍是引导空态）
    expect(list.innerHTML).toContain("sentinel");
  });

  it("无 mcRoot → 原因落结果区 + 扫描按钮禁用", async () => {
    mockApp({ LoadAppConfig: vi.fn(() => ({ mcRoot: "" })) });
    const { bar, list, scanBtn } = makePanel();
    await initSyncConflictPanel(bar, list, esc);
    expect(list.textContent).toContain("请先配置游戏目录");
    expect(scanBtn.disabled).toBe(true);
  });

  it("无可用实例（全 Exists=false）→ 「未找到可用整合包」+ 按钮禁用", async () => {
    mockApp({ ListVersionInstances: vi.fn(() => [{ Name: "insB", Exists: false }]) });
    const { bar, list, scanBtn } = makePanel();
    await initSyncConflictPanel(bar, list, esc);
    expect(list.textContent).toContain("未找到可用整合包");
    expect(scanBtn.disabled).toBe(true);
  });

  it("上下文读取抛错 → 扫描失败兜底 + 按钮禁用", async () => {
    mockApp({ ListVersionInstances: vi.fn(() => Promise.reject(new Error("boom"))) });
    const { bar, list, scanBtn } = makePanel();
    await initSyncConflictPanel(bar, list, esc);
    expect(list.textContent).toContain("扫描失败");
    expect(scanBtn.disabled).toBe(true);
  });

  it("栏/结果区缺失（查看器模式未渲染该 tab）→ 静默返回，不触达 Go 桥", async () => {
    await initSyncConflictPanel(null, null, esc);
    expect(getApp).not.toHaveBeenCalled();
  });

  it("点击栏内按钮 → 以栏内选中值调用 DetectConflicts（换选后再点用新值）", async () => {
    const detectFn = vi.fn(() => ({ conflicts: [], totalConflicts: 0 }));
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true },
        { Name: "insC", Exists: true },
      ]),
      DetectConflicts: detectFn,
    });
    const { bar, list, scanBtn } = makePanel();
    await initSyncConflictPanel(bar, list, esc);

    const rtype = bar.querySelector("#sync-rtype") as HTMLSelectElement;
    rtype.value = "EntityPlayer";
    rtype.dispatchEvent(new Event("change"));
    const instance = bar.querySelector("#sync-instance") as HTMLSelectElement;
    instance.value = "insC";
    instance.dispatchEvent(new Event("change"));

    scanBtn.click();
    await waitFor(() => expect(list.textContent).toContain("未检测到同步冲突"));
    expect(detectFn).toHaveBeenCalledWith("EntityPlayer", "insC");

    // 栏常驻：换回 insA 直接复扫（无需离开页面/重建面板）
    instance.value = "insA";
    instance.dispatchEvent(new Event("change"));
    scanBtn.click();
    await waitFor(() => expect(detectFn).toHaveBeenCalledTimes(2));
    expect(detectFn).toHaveBeenLastCalledWith("EntityPlayer", "insA");
  });
});

describe("runSyncConflictScan", () => {
  it("web 门禁：isWebPlatform → toast 警告，不触达 Go 桥，结果区不动", async () => {
    isWebPlatform.mockReturnValue(true);
    const list = document.createElement("div");
    list.innerHTML = '<span class="sentinel">占位</span>';
    await runSyncConflictScan(list, esc, target());
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: "网页版不支持同步冲突扫描", type: "warn" }),
    );
    expect(getApp).not.toHaveBeenCalled();
    expect(list.innerHTML).toContain("sentinel");
  });

  it("重入守卫：并发第二次早退，首次完成后复位可再扫（扫描期按钮禁用）", async () => {
    const { detect, release } = detectPendingThenOk({ conflicts: [], totalConflicts: 0 });
    mockApp({ DetectConflicts: detect });
    const list = document.createElement("div");
    const scanBtn = document.createElement("button");
    const t0 = target({ scanBtn });

    const p1 = runSyncConflictScan(list, esc, t0);
    const p2 = runSyncConflictScan(list, esc, t0);
    await p2;
    expect(detect).toHaveBeenCalledTimes(1); // 第二次被守卫吞掉
    expect(scanBtn.disabled).toBe(true); // 扫描期间禁用：给「正在跑」以可见反馈

    release({ conflicts: [], totalConflicts: 0 });
    await p1;
    await waitFor(() => expect(list.textContent).toContain("未检测到同步冲突"));
    expect(scanBtn.disabled).toBe(false); // 复位：后续可再扫
    await runSyncConflictScan(list, esc, t0);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("检测无冲突 → ✅ 未检测到同步冲突", async () => {
    const list = document.createElement("div");
    await runSyncConflictScan(list, esc, target());
    await waitFor(() => expect(list.textContent).toContain("未检测到同步冲突"));
  });

  it("DetectConflicts 拒绝（error 通道）→ 展示扫描失败", async () => {
    mockApp({
      DetectConflicts: vi.fn(() => Promise.reject(new Error("同步服务未启动"))),
    });
    const list = document.createElement("div");
    await runSyncConflictScan(list, esc, target());
    await waitFor(() => expect(list.textContent).toContain("同步服务未启动"));
    expect(list.innerHTML).toContain("diag-msg-error");
  });

  it("有冲突 → 渲染冲突行 + 类型标签 + 尺寸对比 + 策略建议 + 解决区", async () => {
    const conflicts = [
      {
        path: "a/模型.ysm",
        type: "content_modified",
        localModTime: "1",
        remoteModTime: "2",
        localSize: 100,
        remoteSize: 200,
        suggestedStrategy: "force_remote",
      },
      {
        path: "b/贴图.png",
        type: "size_mismatch",
        localModTime: "1",
        remoteModTime: "2",
        localSize: 1,
        remoteSize: 2,
        suggestedStrategy: "manual",
      },
      {
        path: "c/未知.bin",
        type: "size_mismatch",
        localModTime: "1",
        remoteModTime: "2",
        localSize: 3,
        remoteSize: 4,
        suggestedStrategy: "unknown" as "unknown",
      },
    ];
    mockApp({
      DetectConflicts: vi.fn(() => ({ conflicts, totalConflicts: 3 })),
    });
    const list = document.createElement("div");
    await runSyncConflictScan(list, esc, target());
    await waitFor(() => expect(list.textContent).toContain("发现 3 个同步冲突"));
    expect(list.textContent).toContain("a/模型.ysm");
    expect(list.textContent).toContain("内容修改冲突");
    expect(list.textContent).toContain("b/贴图.png");
    expect(list.textContent).toContain("双端新增冲突");
    expect(list.textContent).toContain("100 ↔ 200");
    expect(list.textContent).toContain("强制使用远端版本");
    // manual 与未知策略均落到「手动解决」
    expect(list.textContent).toContain("手动解决");
    expect(list.querySelector("#resolve-strategy")).toBeTruthy();
    expect(list.querySelector("#do-resolve-btn")).toBeTruthy();
  });

  /**
   * ADR-288 §1 dead-end 墓碑：结果渲染是**结果区**的整块 `innerHTML` 替换，
   * 而扫描按钮住在**栏**里 ⇒ 扫描后按钮必须仍在、仍可点。
   *
   * 旧实现把按钮放进结果容器内，且 app-content 按页缓存面板（`init` 仅 isNew 跑）
   * ⇒ 首次扫描后入口永久消失（换实例/复扫都不可达，只能重载应用）。
   * 若把按钮挪回结果容器，本用例立刻红。
   */
  it("扫描出结果后扫描按钮仍在栏内且可再次触发（结果替换不得吃掉入口）", async () => {
    const conflicts = [
      {
        path: "a/模型.ysm",
        type: "content_modified",
        localModTime: "1",
        remoteModTime: "2",
        localSize: 100,
        remoteSize: 200,
        suggestedStrategy: "force_remote",
      },
    ];
    const detectFn = vi.fn(() => ({ conflicts, totalConflicts: 1 }));
    mockApp({
      ListVersionInstances: vi.fn(() => [{ Name: "insA", Exists: true }]),
      DetectConflicts: detectFn,
    });
    const { bar, list, scanBtn } = makePanel();
    await initSyncConflictPanel(bar, list, esc);

    scanBtn.click();
    await waitFor(() => expect(list.textContent).toContain("发现 1 个同步冲突"));

    expect(scanBtn.isConnected).toBe(true); // 未被结果整块替换抹掉
    expect(bar.contains(scanBtn)).toBe(true); // 仍在常驻栏内
    scanBtn.click(); // 直接复扫（无需离页重载）
    await waitFor(() => expect(detectFn).toHaveBeenCalledTimes(2));
  });
});

describe("同步冲突解决（do-resolve-btn）", () => {
  function makeConflict() {
    return {
      path: "a/模型.ysm",
      type: "content_modified",
      localModTime: "1",
      remoteModTime: "2",
      localSize: 100,
      remoteSize: 200,
      suggestedStrategy: "force_remote",
    };
  }

  it("点击解决 → ResolveConflicts 透传冲突/策略/类型/实例 + 结果计数 + 1.5s 后自动复扫", async () => {
    const detectFn = vi.fn(() => ({
      conflicts: [makeConflict()],
      totalConflicts: 1,
    }));
    const resolveFn = vi.fn(() => ({ resolved: 2, failed: 1, manual: 1 }));
    mockApp({ DetectConflicts: detectFn, ResolveConflicts: resolveFn });
    const list = document.createElement("div");
    document.body.appendChild(list); // 复扫守卫要求 list 在文档中（isConnected）
    await runSyncConflictScan(list, esc, target());
    await waitFor(() => expect(list.querySelector("#do-resolve-btn")).toBeTruthy());
    (list.querySelector("#resolve-strategy") as HTMLSelectElement).value = "force_local";

    vi.useFakeTimers();
    try {
      (list.querySelector("#do-resolve-btn") as HTMLElement).click();
      // 先推进 0ms：仅冲刷微任务，让解决结果渲染，但 1.5s 复扫 timer 未触发
      await vi.advanceTimersByTimeAsync(0);
      expect(resolveFn).toHaveBeenCalledTimes(1);
      expect(resolveFn).toHaveBeenCalledWith(expect.any(String), "force_local", "ysm", "insA");
      const sentConflicts = JSON.parse(
        (resolveFn.mock.calls[0] as unknown as unknown[])[0] as string,
      );
      expect(sentConflicts[0].path).toBe("a/模型.ysm");
      expect(list.textContent).toContain("已解决 2");
      expect(list.textContent).toContain("失败 1");
      expect(list.textContent).toContain("需手动处理 1");
      // 成功后 1.5s 自动复扫（复扫会重渲染冲突列表，结果消息被替换）
      await vi.advanceTimersByTimeAsync(1500);
      expect(detectFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
    document.body.removeChild(list);
  });

  it("resolve 成功后 list 已分离（离开诊断页）→ 1.5s 复扫被守卫作废", async () => {
    const detectFn = vi.fn(() => ({
      conflicts: [makeConflict()],
      totalConflicts: 1,
    }));
    const resolveFn = vi.fn(() => ({ resolved: 1, failed: 0, manual: 0 }));
    mockApp({ DetectConflicts: detectFn, ResolveConflicts: resolveFn });
    const list = document.createElement("div");
    await runSyncConflictScan(list, esc, target());
    await waitFor(() => expect(list.querySelector("#do-resolve-btn")).toBeTruthy());
    (list.querySelector("#do-resolve-btn") as HTMLElement).click();
    await waitFor(() => expect(list.textContent).toContain("已解决 1"));
    list.remove(); // 模拟用户离开诊断页，面板 DOM 分离

    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(1500);
      expect(detectFn).toHaveBeenCalledTimes(1); // 迟到复扫未发生
    } finally {
      vi.useRealTimers();
    }
  });

  it("ResolveConflicts 拒绝 → 展示错误原文，不自动复扫", async () => {
    const detectFn = vi.fn(() => ({
      conflicts: [makeConflict()],
      totalConflicts: 1,
    }));
    const resolveFn = vi.fn(() => Promise.reject(new Error("网络中断")));
    mockApp({ DetectConflicts: detectFn, ResolveConflicts: resolveFn });
    const list = document.createElement("div");
    await runSyncConflictScan(list, esc, target());
    await waitFor(() => expect(list.querySelector("#do-resolve-btn")).toBeTruthy());
    (list.querySelector("#do-resolve-btn") as HTMLElement).click();
    await waitFor(() => expect(list.textContent).toContain("网络中断"));
    expect(list.innerHTML).toContain("❌");
    expect(detectFn).toHaveBeenCalledTimes(1); // 无复扫
  });

  it("ResolveConflicts 拒绝 → 追加错误行（异常兜底）", async () => {
    mockApp({
      DetectConflicts: vi.fn(() => ({
        conflicts: [makeConflict()],
        totalConflicts: 1,
      })),
      ResolveConflicts: vi.fn(() => Promise.reject(new Error("写入失败"))),
    });
    const list = document.createElement("div");
    await runSyncConflictScan(list, esc, target());
    await waitFor(() => expect(list.querySelector("#do-resolve-btn")).toBeTruthy());
    (list.querySelector("#do-resolve-btn") as HTMLElement).click();
    await waitFor(() => expect(list.textContent).toContain("写入失败"));
    expect(list.innerHTML).toContain("diag-msg-error");
  });
});
