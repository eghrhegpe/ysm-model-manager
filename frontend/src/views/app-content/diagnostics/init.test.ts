// ===== 诊断页测试 =====
// 覆盖：
//  - initDiagnostics：初始加载 / tab 切换（log/runtime/conflict/perf/health/sync-conflict）/
//    刷新 / 清空（含能力门禁与失败）/ 筛选 / 搜索防抖 / 复制面板与行内复制（含降级）/
//    同步冲突与体检扫描入口 / 查看器模式隐藏桌面专属入口
//  - 日志渲染：分组徽标 / 空态 / 抛错兜底（import + runtime）
//  - startDedup：单类型/全类型目录扫描 / 无目录 / 无重复 / exec 移入回收站 / 取消
//  - scanConflicts：无游戏目录 / 无实例 / 冲突渲染 / 无冲突 / 扫描失败
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "../../../test-utils/index.ts";
import { initDiagnostics, startDedup, getDedupConfig, resetDedupConfig } from "./init.ts";

const { busEmit, busOn, getApp, loadResourceRegistry, can, isViewerMode } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  busOn: vi.fn(() => () => {}),
  getApp: vi.fn(),
  loadResourceRegistry: vi.fn(() => ({})),
  can: vi.fn(() => true),
  isViewerMode: vi.fn(() => false),
}));

vi.mock("../../../bus.ts", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("../../../backend/app.ts", () => ({ getApp }));
vi.mock("../../../utils/resource/registry.ts", () => ({ loadResourceRegistry }));
vi.mock("../../../utils/dom/capabilities.ts", () => ({ can }));
vi.mock("../../../utils/dom/android-bridge.ts", () => ({
  isViewerMode,
  getAndroidBridge: () => null,
}));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function makeRoot(): { root: ShadowRoot; el: HTMLDivElement } {
  const el = document.createElement("div");
  el.innerHTML = `
    <div id="diag-refresh"></div>
    <div id="diag-clear"></div>
    <div id="diag-copy"></div>
    <div id="diag-scan-conflict"></div>
    <div id="diag-scan-sync-conflict"></div>
    <div id="diag-scan-health"></div>
    <button class="diag-btn" data-diag="log">日志</button>
    <button class="diag-btn" data-diag="runtime">运行时</button>
    <button class="diag-btn" data-diag="conflict">冲突</button>
    <button class="diag-btn" data-diag="perf">性能</button>
    <button class="diag-btn" data-diag="health">体检</button>
    <button class="diag-btn" data-diag="sync-conflict">同步</button>
    <div id="diag-log"><div id="diag-log-list"></div></div>
    <div id="diag-runtime"><div id="diag-runtime-list"></div></div>
    <div id="diag-conflict"><div id="diag-conflict-list"></div></div>
    <div id="diag-perf"><div id="diag-load-trace"></div></div>
    <div id="diag-health"><div id="diag-health-list"></div></div>
    <div id="diag-sync-conflict"><div id="diag-sync-conflict-list"></div></div>
    <button class="diag-log-fbtn" data-status="all">全部</button>
    <button class="diag-log-fbtn" data-status="success">成功</button>
    <input id="diag-log-search">
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => el.querySelector(`#${id}`);
  return { root: el as unknown as ShadowRoot, el };
}

function mockApp(overrides: Record<string, unknown> = {}) {
  getApp.mockResolvedValue({
    GetImportLogs: vi.fn(() => []),
    GetRuntimeLogs: vi.fn(() => []),
    ClearImportLogs: vi.fn(),
    FindDuplicateFiles: vi.fn(() => []),
    GetRepoRoot: vi.fn(() => "/repo"),
    MoveToRecycle: vi.fn(),
    LoadAppConfig: vi.fn(() => ({ mcRoot: "/mc" })),
    ListVersionInstances: vi.fn(() => []),
    ScanModelEntriesWithLabel: vi.fn(() => []),
    ...overrides,
  });
}

/** 替换全局 navigator（clipboard 注入；afterEach 统一 unstub） */
function stubClipboard(writeText: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}

/** 覆盖 document.execCommand（happy-dom 可能未实现，用 expando 赋值 + 还原） */
function overrideExecCommand(fn: (...args: unknown[]) => unknown): () => void {
  const doc = document as unknown as { execCommand?: unknown };
  const original = doc.execCommand;
  doc.execCommand = fn;
  return () => {
    doc.execCommand = original;
  };
}

/** 构造一份合法体检报告（对齐 health.test.ts） */
function buildReport() {
  return {
    timestamp: "2026-08-21T00:00:00Z",
    directory: "/repo",
    score: 85,
    completeness: { checked: 10, valid: 9, invalid: 1, percentage: 90 },
    cache: { cache_dir: "/cache", cache_files: 5, cache_size: 1024, hit_rate: 50 },
    resources: { total_files: 12, total_size: 2048, by_type: { model: 10, texture: 2 } },
    dedup: { groups: 1, extra_files: 2, reclaim_bytes: 4096 },
    warnings: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  loadResourceRegistry.mockResolvedValue({});
  can.mockReturnValue(true);
  isViewerMode.mockReturnValue(false);
  mockApp();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initDiagnostics — 日志面板", () => {
  it("初始加载：无日志 → 暂无日志占位", async () => {
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    await waitFor(() =>
      (root.getElementById("diag-log-list") as HTMLElement).textContent!.includes(
        "暂无日志",
      ),
    );
  });

  it("有日志 → 分组渲染（状态徽标 + 错误行换行 + 时间）", async () => {
    mockApp({
      GetImportLogs: vi.fn(() => [
        {
          Status: "failed",
          Operation: "import",
          ModelName: "a.ysm",
          Timestamp: 1700000000000,
          ErrorMsg: "权限不足 解决建议: 检查",
        },
        {
          Status: "success",
          Operation: "rename",
          ModelName: "b.ysm",
          Timestamp: 1700000000000,
        },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    // renderDisplayName 会剥扩展名（a.ysm → a），断言错误信息与分组徽标
    await waitFor(() => list.textContent!.includes("权限不足"));
    expect(list.textContent).toContain("a");
    expect(list.textContent).toContain("b");
    expect(list.innerHTML).toContain("❌");
    expect(list.innerHTML).toContain("✅");
    expect(list.textContent).toContain("解决建议"); // 错误信息换行格式化
  });

  it("筛选按钮 → 按 status 过滤（success 只显示成功）", async () => {
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "success", Operation: "import", ModelName: "ok.ysm" },
        { Status: "failed", Operation: "import", ModelName: "bad.ysm" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => list.textContent!.includes("ok"));
    // 切到 success 筛选
    (root.querySelector('.diag-log-fbtn[data-status="success"]') as HTMLElement).click();
    await waitFor(() => !list.textContent!.includes("bad"));
    expect(list.textContent).toContain("ok");
  });

  it("搜索输入 → 300ms 防抖重载", async () => {
    const fn = vi.fn(() => []);
    mockApp({ GetImportLogs: fn });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    await waitFor(() => fn.mock.calls.length >= 1);
    const input = root.getElementById("diag-log-search") as HTMLInputElement;
    input.value = "abc";
    input.dispatchEvent(new Event("input"));
    expect(fn.mock.calls.length).toBe(1); // 未到 300ms 不触发
    await new Promise((r) => setTimeout(r, 350));
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("GetImportLogs 抛错 → 加载日志失败占位", async () => {
    mockApp({ GetImportLogs: vi.fn(() => Promise.reject(new Error("boom"))) });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    await waitFor(() =>
      (root.getElementById("diag-log-list") as HTMLElement).textContent!.includes(
        "加载日志失败",
      ),
    );
  });

  it("刷新按钮：runtime tab 激活 → 加载运行时日志；否则重载导入日志", async () => {
    const runtimeFn = vi.fn(() => [{ Message: "watcher ok", Timestamp: 1700000000000 }]);
    mockApp({ GetRuntimeLogs: runtimeFn });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    // 切到 runtime tab
    (root.querySelector('.diag-btn[data-diag="runtime"]') as HTMLElement).click();
    await waitFor(() =>
      (root.getElementById("diag-runtime-list") as HTMLElement).textContent!.includes(
        "watcher ok",
      ),
    );
    (root.getElementById("diag-refresh") as HTMLElement).click();
    await waitFor(() => runtimeFn.mock.calls.length >= 2);
  });

  it("清空按钮 → ClearImportLogs + 重载 + toast", async () => {
    const clearFn = vi.fn();
    mockApp({ ClearImportLogs: clearFn });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-clear") as HTMLElement).click();
    await waitFor(() => clearFn.mock.calls.length === 1);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("日志已清空") }),
    );
  });

  it("tab 切换 → panel display 联动", () => {
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const logPanel = root.getElementById("diag-log") as HTMLElement;
    const runtimePanel = root.getElementById("diag-runtime") as HTMLElement;
    const conflictPanel = root.getElementById("diag-conflict") as HTMLElement;
    (root.querySelector('.diag-btn[data-diag="conflict"]') as HTMLElement).click();
    expect(logPanel.style.display).toBe("none");
    expect(runtimePanel.style.display).toBe("none");
    expect(conflictPanel.style.display).toBe("");
    expect(
      (root.querySelector('.diag-btn[data-diag="conflict"]') as HTMLElement).classList.contains(
        "active",
      ),
    ).toBe(true);
  });
});

describe("startDedup", () => {
  const groupJson = [
    {
      files: [
        { path: "/a/dup.ysm", name: "dup.ysm", size: 1024, modTime: 2000 },
        { path: "/b/dup.ysm", name: "dup.ysm", size: 2048, modTime: 1000 },
      ],
    },
  ];

  it("rtype 指定 → 单目录扫描 + 渲染组 + exec 移入回收站", async () => {
    loadResourceRegistry.mockResolvedValue({
      ysm: { id: "ysm", name: "模型", icon: "🧊" },
    });
    const moveFn = vi.fn();
    mockApp({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: moveFn,
    });
    const list = document.createElement("div");
    await startDedup(list, esc, "ysm");
    await waitFor(() => list.querySelector(".diag-dedup-group"));
    expect(list.textContent).toContain("组 1");
    // 默认保留策略 oldest → 保留最早修改的文件（b, modTime 1000 → index 1）
    const checked = list.querySelector(
      'input[name="dedup-keep-0"]:checked',
    ) as HTMLInputElement;
    expect(checked?.value).toBe("1");
    // 删除未选中的
    (list.querySelector("#diag-dedup-exec") as HTMLElement).click();
    await waitFor(() => moveFn.mock.calls.length > 0);
    expect(moveFn).toHaveBeenCalledWith("/a/dup.ysm");
    expect(busEmit).toHaveBeenCalledWith("stats:refresh");
    expect(list.textContent).toContain("去重完成");
  });

  it("rtype=all → 遍历所有注册类型目录", async () => {
    loadResourceRegistry.mockResolvedValue({
      ysm: { id: "ysm", name: "模型", icon: "🧊" },
      mmd: { id: "mmd", name: "MMD", icon: "🎭" },
    });
    const repoRoot = vi.fn(() => "/repo");
    mockApp({ GetRepoRoot: repoRoot });
    const list = document.createElement("div");
    await startDedup(list, esc, "all");
    expect(repoRoot).toHaveBeenCalledWith("ysm");
    expect(repoRoot).toHaveBeenCalledWith("mmd");
    await waitFor(() => list.textContent!.includes("没有重复文件"));
  });

  it("无目录 → 请先配置资源目录", async () => {
    mockApp({ GetRepoRoot: vi.fn(() => "") });
    const list = document.createElement("div");
    await startDedup(list, esc, "ysm");
    expect(list.textContent).toContain("请先配置资源目录");
  });

  it("无重复 → 没有重复文件", async () => {
    const list = document.createElement("div");
    await startDedup(list, esc, "ysm");
    await waitFor(() => list.textContent!.includes("没有重复文件"));
  });

  it("取消按钮 → 已取消去重", async () => {
    mockApp({ FindDuplicateFiles: vi.fn(() => groupJson) });
    const list = document.createElement("div");
    await startDedup(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-cancel"));
    (list.querySelector("#diag-dedup-cancel") as HTMLElement).click();
    expect(list.textContent).toContain("已取消去重");
  });

  it("FindDuplicateFiles 抛错 → 去重失败兜底", async () => {
    mockApp({
      FindDuplicateFiles: vi.fn(() => Promise.reject(new Error("磁盘错误"))),
    });
    const list = document.createElement("div");
    await startDedup(list, esc, "ysm");
    await waitFor(() => list.textContent!.includes("去重失败"));
  });

  it("文件名点击 → bus model:select", async () => {
    mockApp({ FindDuplicateFiles: vi.fn(() => groupJson) });
    const list = document.createElement("div");
    await startDedup(list, esc, "ysm");
    await waitFor(() => list.querySelector("[data-path]"));
    (list.querySelector("[data-path]") as HTMLElement).click();
    // 第一个 data-path 是组内第一个文件
    expect(busEmit).toHaveBeenCalledWith("model:select", {
      path: "/a/dup.ysm",
    });
  });

  it("重入守卫：并发调用仅首次执行，busy 期间第二次早退且不重复扫描", async () => {
    loadResourceRegistry.mockResolvedValue({
      ysm: { id: "ysm", name: "模型", icon: "🧊" },
    });
    mockApp({ FindDuplicateFiles: vi.fn(() => groupJson) });
    const list = document.createElement("div");
    // 同步双调用：首次在首个 await 前已置 _dedupBusy=true，第二次必命中守卫早退
    const p1 = startDedup(list, esc, "ysm");
    const p2 = startDedup(list, esc, "ysm");
    await Promise.all([p1, p2]);
    expect(loadResourceRegistry).toHaveBeenCalledTimes(1);
    expect(getApp).toHaveBeenCalledTimes(1);
    // 守卫已复位，后续可正常再次扫描
    const list2 = document.createElement("div");
    await startDedup(list2, esc, "ysm");
    expect(loadResourceRegistry).toHaveBeenCalledTimes(2);
  });
});

describe("scanConflicts（diag-scan-conflict 按钮）", () => {
  it("无 mcRoot → 请先配置游戏目录", async () => {
    mockApp({ LoadAppConfig: vi.fn(() => ({ mcRoot: "" })) });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-scan-conflict") as HTMLElement).click();
    await waitFor(() =>
      (root.getElementById("diag-conflict-list") as HTMLElement).textContent!.includes(
        "请先配置游戏目录",
      ),
    );
  });

  it("无实例 → 没有找到整合包", async () => {
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-scan-conflict") as HTMLElement).click();
    await waitFor(() =>
      (root.getElementById("diag-conflict-list") as HTMLElement).textContent!.includes(
        "没有找到整合包",
      ),
    );
  });

  it("有冲突 → 渲染冲突行 + 按钮复位", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true, CustomDir: "/mc/insA" },
        { Name: "insB", Exists: true, CustomDir: "/mc/insB" },
      ]),
      ScanModelEntriesWithLabel: vi.fn(() => [{ Name: "model.ysm" }]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-scan-conflict") as HTMLElement).click();
    const list = root.getElementById("diag-conflict-list") as HTMLElement;
    await waitFor(() => list.textContent!.includes("存在于多个整合包"));
    expect(list.textContent).toContain("model"); // renderDisplayName 剥扩展名
    expect(list.textContent).toContain("insA");
    expect(list.textContent).toContain("insB");
    expect(
      (root.getElementById("diag-scan-conflict") as HTMLElement).textContent,
    ).toBe("⚡ 开始扫描"); // 复位
  });

  it("无冲突 → 未检测到文件名冲突", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true, CustomDir: "/mc/insA" },
      ]),
      ScanModelEntriesWithLabel: vi.fn(() => [{ Name: "model.ysm" }]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-scan-conflict") as HTMLElement).click();
    await waitFor(() =>
      (root.getElementById("diag-conflict-list") as HTMLElement).textContent!.includes(
        "未检测到文件名冲突",
      ),
    );
  });

  it("扫描抛错 → 扫描失败兜底", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => Promise.reject(new Error("boom"))),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-scan-conflict") as HTMLElement).click();
    await waitFor(() =>
      (root.getElementById("diag-conflict-list") as HTMLElement).textContent!.includes(
        "扫描失败",
      ),
    );
  });
});

describe("dedup config（getDedupConfig / resetDedupConfig）", () => {
  it("getDedupConfig 返回冻结快照，调用方篡改不影响内部状态", () => {
    const cfg = getDedupConfig();
    expect(cfg.strategy).toBe("deep_hash");
    expect(cfg.keepPolicy).toBe("oldest");
    expect(cfg.priorityPath).toBe("");

    // 快照是 Object.freeze，篡改抛 TypeError（V8 消息为 "Cannot assign to read only property"，
    // 不含 "frozen" 子串，断言按错误类匹配而非引擎文本）
    expect(() => {
      (cfg as { strategy: string }).strategy = "quick_hash";
    }).toThrow(TypeError);

    // 内部状态不受影响
    expect(getDedupConfig().strategy).toBe("deep_hash");
  });

  it("多次调用 getDedupConfig 返回不同对象引用（快照独立）", () => {
    const cfg1 = getDedupConfig();
    const cfg2 = getDedupConfig();
    expect(cfg1).not.toBe(cfg2);
    expect(cfg1.strategy).toBe(cfg2.strategy);
  });

  it("resetDedupConfig 幂等：默认状态下 reset 不改变配置", () => {
    expect(getDedupConfig().strategy).toBe("deep_hash");
    resetDedupConfig();
    expect(getDedupConfig().strategy).toBe("deep_hash");
    expect(getDedupConfig().keepPolicy).toBe("oldest");
    expect(getDedupConfig().priorityPath).toBe("");
  });
});

describe("initDiagnostics — 复制面板与行内复制", () => {
  it("diag-copy：无日志 → toast「当前无日志可复制」，不碰剪贴板", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-copy") as HTMLElement).click();
    await waitFor(() =>
      expect(busEmit).toHaveBeenCalledWith(
        "toast:show",
        expect.objectContaining({ msg: expect.stringContaining("当前无日志可复制") }),
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("diag-copy：有日志 → 剪贴板写入剔除 .log-copy 后的文本 + toast 已复制提示", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "success", Operation: "import", ModelName: "ok.ysm", Timestamp: 1700000000000 },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => expect(list.textContent).toContain("ok"));
    (root.getElementById("diag-copy") as HTMLElement).click();
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = (writeText.mock.calls[0] as unknown as unknown[])[0] as string;
    expect(copied).toContain("ok");
    expect(copied).not.toContain("📋"); // .log-copy 按钮已从克隆中剔除
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已复制") }),
    );
  });

  it("diag-copy：clipboard 拒绝 → execCommand textarea 降级 + toast 已复制", async () => {
    stubClipboard(vi.fn(() => Promise.reject(new Error("denied"))));
    const execSpy = vi.fn(() => true);
    const restore = overrideExecCommand(execSpy);
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    // 先等日志列表渲染出占位文本，保证有可复制内容（否则撞「无日志」早退分支）
    await waitFor(() =>
      expect((root.getElementById("diag-log-list") as HTMLElement).textContent).toContain("暂无日志"),
    );
    (root.getElementById("diag-copy") as HTMLElement).click();
    await waitFor(() => expect(execSpy).toHaveBeenCalledWith("copy"));
    restore();
    // 面板路径：降级后仍发 copiedLogPrivacy 提示（成功/降级同款文案）
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已复制") }),
    );
  });

  it(".log-copy 行点击：写入该行 .log-msg 文本 + toast", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "failed", Operation: "import", ModelName: "bad.ysm", ErrorMsg: "磁盘已满" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => expect(list.querySelector(".log-copy")).toBeTruthy());
    (list.querySelector(".log-copy") as HTMLElement).click();
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0] as unknown as unknown[])[0]).toBe("bad磁盘已满"); // .log-msg 文本 trim
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已复制") }),
    );
  });

  it(".log-copy 行点击：写入失败 → execCommand 降级 + toast 已复制", async () => {
    stubClipboard(vi.fn(() => Promise.reject(new Error("denied"))));
    const execSpy = vi.fn(() => true);
    const restore = overrideExecCommand(execSpy);
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "success", Operation: "import", ModelName: "ok.ysm" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => expect(list.querySelector(".log-copy")).toBeTruthy());
    (list.querySelector(".log-copy") as HTMLElement).click();
    await waitFor(() => expect(execSpy).toHaveBeenCalledWith("copy"));
    restore();
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("日志已复制到剪贴板") }),
    );
  });

  it(".log-copy 行点击：行内无文本 → 早退不碰剪贴板", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    mockApp({
      GetImportLogs: vi.fn(() => [{ Status: "success", Operation: "import" }]), // 无 ModelName/ErrorMsg/路径
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => expect(list.querySelector(".log-copy")).toBeTruthy());
    (list.querySelector(".log-copy") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("initDiagnostics — 清空日志门禁与失败", () => {
  it("can(ClearImportLogs)=false → warn toast，不调用 ClearImportLogs", async () => {
    const clearFn = vi.fn();
    mockApp({ ClearImportLogs: clearFn });
    can.mockReturnValue(false);
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-clear") as HTMLElement).click();
    await waitFor(() =>
      expect(busEmit).toHaveBeenCalledWith(
        "toast:show",
        expect.objectContaining({ msg: "网页版不支持清除日志", type: "warn" }),
      ),
    );
    expect(clearFn).not.toHaveBeenCalled();
  });

  it("ClearImportLogs 拒绝 → ❌ 清除失败 error toast", async () => {
    mockApp({ ClearImportLogs: vi.fn(() => Promise.reject(new Error("boom"))) });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-clear") as HTMLElement).click();
    await waitFor(() =>
      expect(busEmit).toHaveBeenCalledWith(
        "toast:show",
        expect.objectContaining({
          msg: expect.stringContaining("清除日志失败"),
          type: "error",
        }),
      ),
    );
    const call = busEmit.mock.calls.find((c) => (c[1] as { msg: string }).msg.includes("清除日志失败"));
    expect((call![1] as { msg: string }).msg.startsWith("❌")).toBe(true);
  });
});

describe("initDiagnostics — 同步冲突与体检扫描入口", () => {
  it("diag-scan-sync-conflict 点击 → 同步冲突配置面板渲染（Exists 实例过滤）", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true, CustomDir: "/a" },
        { Name: "insB", Exists: false, CustomDir: "/b" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-scan-sync-conflict") as HTMLElement).click();
    const list = root.getElementById("diag-sync-conflict-list") as HTMLElement;
    await waitFor(() => expect(list.querySelector("#sync-scan-btn")).toBeTruthy());
    const optTexts = Array.from(list.querySelectorAll("#sync-instance option")).map((o) => o.textContent);
    expect(optTexts).toContain("insA");
    expect(optTexts).not.toContain("insB");
  });

  it("diag-scan-health 点击 → 体检报告渲染到 diag-health-list", async () => {
    mockApp({
      RepoHealthAudit: vi.fn(() => JSON.stringify(buildReport())),
      GetRepoRoot: vi.fn(async () => "/repo"),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.getElementById("diag-scan-health") as HTMLElement).click();
    const list = root.getElementById("diag-health-list") as HTMLElement;
    await waitFor(() => expect(list.innerHTML).toContain("85"));
    expect(list.innerHTML).toContain("健康");
  });
});

describe("initDiagnostics — tab 联动扩展与查看器降级", () => {
  it("tab 切到 perf → perf 面板显示 + 加载剖析空态渲染", () => {
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.querySelector('.diag-btn[data-diag="perf"]') as HTMLElement).click();
    expect((root.getElementById("diag-perf") as HTMLElement).style.display).toBe("");
    expect((root.getElementById("diag-log") as HTMLElement).style.display).toBe("none");
    expect((root.getElementById("diag-load-trace") as HTMLElement).textContent).toContain(
      "暂无加载记录",
    );
  });

  it("tab 切到 health / sync-conflict → 对应面板 display 联动", () => {
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.querySelector('.diag-btn[data-diag="health"]') as HTMLElement).click();
    expect((root.getElementById("diag-health") as HTMLElement).style.display).toBe("");
    expect((root.getElementById("diag-runtime") as HTMLElement).style.display).toBe("none");
    (root.querySelector('.diag-btn[data-diag="sync-conflict"]') as HTMLElement).click();
    expect((root.getElementById("diag-sync-conflict") as HTMLElement).style.display).toBe("");
    expect((root.getElementById("diag-health") as HTMLElement).style.display).toBe("none");
  });

  it("查看器模式（isViewerMode=true）→ 隐藏桌面专属 tab 与扫描入口", () => {
    isViewerMode.mockReturnValue(true);
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    // 桌面专属 tab 按钮
    for (const name of ["conflict", "health", "sync-conflict"]) {
      expect(
        (root.querySelector(`.diag-btn[data-diag="${name}"]`) as HTMLElement).style.display,
      ).toBe("none");
    }
    // 扫描与 perf 桌面按钮
    for (const id of ["diag-scan-conflict", "diag-scan-health", "diag-scan-sync-conflict"]) {
      expect((root.getElementById(id) as HTMLElement).style.display).toBe("none");
    }
  });

  it("桌面模式（isViewerMode=false）→ 桌面专属入口保持可见", () => {
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    expect(
      (root.getElementById("diag-scan-conflict") as HTMLElement).style.display,
    ).not.toBe("none");
  });
});
