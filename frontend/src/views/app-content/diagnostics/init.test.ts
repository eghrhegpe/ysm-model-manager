// ===== 诊断页测试 =====
// 覆盖：
//  - initDiagnostics：初始加载 / tab 切换（log/runtime/perf/health/sync-conflict）/
//    刷新 / 清空（含能力门禁与失败）/ 筛选 / 搜索防抖 / 复制面板与行内复制（含降级）/
//    扫描栏接线（ADR-288：挂载即备参数 + 栏内按钮触发）/ 查看器模式隐藏桌面专属入口
//  - 日志渲染：分组徽标 / 空态 / 抛错兜底（import + runtime）
//  - startDedup：单类型/全类型目录扫描 / 无目录 / 无重复 / exec 移入回收站 / 取消
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "@/test-utils/index.ts";
import { initDiagnostics, createDedupSession } from "./init.ts";
import { clearLoadTraces, recordLoadTrace } from "@/preview-3d/infra/load-trace.ts";
import { diagnosticsHTML } from "@/views/app-content/tpl.ts";

const { busEmit, busOn, getApp, can, isViewerMode } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  busOn: vi.fn(() => () => {}),
  getApp: vi.fn(),
  can: vi.fn(() => true),
  isViewerMode: vi.fn(() => false),
}));

vi.mock("@/bus", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("@/backend/app.ts", () => ({ getApp }));
vi.mock("@/backend/capabilities.ts", () => ({ can }));
vi.mock("@/backend/platform.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/platform.ts")>();
  return {
    ...actual,
    isViewerMode,
    getAndroidBridge: () => null,
  };
});

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function makeRoot(): { root: ShadowRoot; el: HTMLDivElement } {
  const el = document.createElement("div");
  // ADR-300 §2.2 同形：logs 组 = 子 pill 行（bindSubBar 的唯一接线面）+ 门控工具栏 + 三态面板。
  // 工具栏 data-sub-pane="op runtime"（trace 下整体退场）、清空 data-sub-pane="op"（可见集合语义）。
  el.innerHTML = `
    <button class="repo-tab" data-tab="logs">日志</button>
    <button class="repo-tab" data-tab="bench">基准</button>
    <button class="repo-tab" data-tab="audit">体检</button>
    <div class="diag-sub-bar" data-sub-bar="logs" data-active-sub="op">
      <button class="diag-sub-tab active" data-sub="op">操作</button>
      <button class="diag-sub-tab" data-sub="runtime">运行时</button>
      <button class="diag-sub-tab" data-sub="trace">剖析</button>
    </div>
    <div class="diag-bar" data-sub-group="logs" data-sub-pane="op runtime">
      <button id="diag-refresh"></button>
      <button id="diag-copy"></button>
      <button id="diag-clear" data-sub-group="logs" data-sub-pane="op"></button>
      <input id="diag-log-search">
      <select id="diag-log-op-filter">
        <option value="all">全部操作</option>
        <option value="import">导入</option>
        <option value="scan">扫描</option>
        <option value="download">下载</option>
        <option value="sync">同步</option>
        <option value="rename">重命名</option>
        <option value="delete">删除</option>
        <option value="ui">界面</option>
      </select>
      <button class="diag-log-fbtn active" data-status="all">全部</button>
      <button class="diag-log-fbtn" data-status="success">成功</button>
      <button class="diag-log-fbtn" data-status="failed">失败</button>
      <button class="diag-log-fbtn" data-status="warn">警告</button>
      <button class="diag-log-fbtn" data-status="skipped">跳过</button>
    </div>
    <div id="diag-log-list" data-sub-group="logs" data-sub-pane="op"></div>
    <div id="diag-runtime-list" data-sub-group="logs" data-sub-pane="runtime" style="display:none"></div>
    <div class="diag-pane" data-sub-group="logs" data-sub-pane="trace" style="display:none">
      <button id="diag-trace-refresh"></button>
      <div id="diag-load-trace"></div>
    </div>
    <div id="diag-tab-audit"><div class="diag-bar" id="diag-health-bar"><div class="diag-bar-row"><button id="diag-scan-health"></button></div></div><div id="diag-health-list"></div><div class="diag-bar" id="diag-sync-bar"><div class="diag-bar-row"><select id="sync-rtype"></select><select id="sync-instance"></select><button id="diag-scan-sync-conflict"></button></div></div><div id="diag-sync-conflict-list"></div></div>
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
    cache: { cache_dir: "/cache", cache_files: 5, cache_size: 1024 },
    resources: { total_files: 12, total_size: 2048, by_type: { model: 10, texture: 2 } },
    dedup: { groups: 1, extra_files: 2, reclaim_bytes: 4096 },
    warnings: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
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
    // ADR-238 收债：状态图标为 UI_ICONS SVG（.log-status 下 .ws-icon），不再是 emoji 文本
    expect(list.querySelector(".log-status.failed .ws-icon")).not.toBeNull();
    expect(list.querySelector(".log-status.success .ws-icon")).not.toBeNull();
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

  it("警告 chip → 单独筛出 warn 状态（扫描/界面提示，不会被成功/失败吞掉）", async () => {
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "success", Operation: "scan", ModelName: "ok.ysm" },
        { Status: "warn", Operation: "scan", ModelName: "warn.ysm", ErrorMsg: "部分文件跳过" },
        { Status: "failed", Operation: "import", ModelName: "bad.ysm" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => list.textContent!.includes("ok"));
    // 切到 warn：只留 warn，success/failed 都消失（renderDisplayName 剥扩展名：ok/bad）
    (root.querySelector('.diag-log-fbtn[data-status="warn"]') as HTMLElement).click();
    await waitFor(() => list.textContent!.includes("部分文件跳过"));
    expect(list.textContent).toContain("warn");
    expect(list.textContent).not.toContain("ok");
    expect(list.textContent).not.toContain("bad");
    // 徽标按 Level（warn→warning 图标）渲染
    expect(list.querySelector(".log-status.warn .ws-icon")).not.toBeNull();
  });

  it("操作类型下拉 → 单独筛出某一类操作（与状态 chips 正交叠加）", async () => {
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "success", Operation: "import", ModelName: "imp.ysm" },
        { Status: "success", Operation: "scan", ModelName: "scn.ysm" },
        { Status: "warn", Operation: "ui", ModelName: "uimsg.ysm" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => list.textContent!.includes("imp"));
    // 选「扫描」：只剩 scan 行（import / ui 都消失）
    const sel = root.getElementById("diag-log-op-filter") as HTMLSelectElement;
    sel.value = "scan";
    sel.dispatchEvent(new Event("change"));
    await waitFor(() => !list.textContent!.includes("imp"));
    expect(list.textContent).toContain("scn");
    expect(list.textContent).not.toContain("uimsg");
    // 正交叠加：再选「警告」状态 chip → scan 里没有 warn，应为空态
    (root.querySelector('.diag-log-fbtn[data-status="warn"]') as HTMLElement).click();
    await waitFor(() => !list.textContent!.includes("scn"));
    expect(list.textContent).not.toContain("imp");
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

  it("搜索命中报错内容 / 目标路径（不再只匹配模型名）", async () => {
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "failed", Operation: "import", ModelName: "a.ysm", ErrorMsg: "权限不足" },
        { Status: "success", Operation: "scan", ModelName: "b.ysm", TargetDir: "/mc/versions/1.20" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() => list.textContent!.includes("权限不足"));
    const input = root.getElementById("diag-log-search") as HTMLInputElement;
    // 报错内容可命中（旧实现只匹配 ModelName，此处必然空手）
    input.value = "权限不足";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => list.textContent!.includes("权限不足") && !list.textContent!.includes("1.20"));
    // 目标路径同样可命中
    input.value = "1.20";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => list.textContent!.includes("1.20") && !list.textContent!.includes("权限不足"));
  });

  it("运行时子 tab：搜索按 Message 过滤，且不回落拉取操作日志", async () => {
    const opFn = vi.fn(() => []);
    const rtFn = vi.fn(() => [
      { Message: "sync failed: timeout", Timestamp: 1700000000001 },
      { Message: "watcher started", Timestamp: 1700000000000 },
    ]);
    mockApp({ GetImportLogs: opFn, GetRuntimeLogs: rtFn });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const rtList = root.getElementById("diag-runtime-list") as HTMLElement;
    (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).click();
    await waitFor(() => rtList.textContent!.includes("watcher started"));
    const opCalls = opFn.mock.calls.length;
    const input = root.getElementById("diag-log-search") as HTMLInputElement;
    input.value = "timeout";
    input.dispatchEvent(new Event("input"));
    await waitFor(
      () => rtList.textContent!.includes("timeout") && !rtList.textContent!.includes("watcher started"),
    );
    expect(opFn.mock.calls.length).toBe(opCalls); // 搜索分派到运行时列表，不再白跑 GetImportLogs
  });

  it("运行时子 tab：搜索无命中 → 「无匹配日志」占位", async () => {
    mockApp({ GetRuntimeLogs: vi.fn(() => [{ Message: "watcher started", Timestamp: 1 }]) });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const rtList = root.getElementById("diag-runtime-list") as HTMLElement;
    (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).click();
    await waitFor(() => rtList.textContent!.includes("watcher started"));
    const input = root.getElementById("diag-log-search") as HTMLInputElement;
    input.value = "zzz-nothing";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => rtList.textContent!.includes("无匹配日志"));
  });

  it("运行时子 tab：chips 按推断 Level 生效（ADR-289），且仍不回落拉操作日志", async () => {
    const opFn = vi.fn(() => []);
    mockApp({
      GetImportLogs: opFn,
      GetRuntimeLogs: vi.fn(() => [
        { Message: "[watcher] 自动同步完成: 禁用 3 启用 2", Timestamp: 1, Level: "info" },
        { Message: "[installer] 安装文件 x.ysm 失败: boom", Timestamp: 2, Level: "error" },
        { Message: "[sync] 警告: 冲突处理未在锁内", Timestamp: 3, Level: "warn" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).click();
    const rtList = root.getElementById("diag-runtime-list") as HTMLElement;
    await waitFor(() => rtList.textContent!.includes("自动同步完成"));
    const opCalls = opFn.mock.calls.length;
    // 点「失败」→ 只留 error 行（ADR-289 前 chips 在运行时子 tab 下不生效）
    (root.querySelector('.diag-log-fbtn[data-status="failed"]') as HTMLElement).click();
    await waitFor(() => !rtList.textContent!.includes("自动同步完成"));
    expect(rtList.textContent).toContain("boom");
    expect(rtList.textContent).not.toContain("冲突处理未在锁内");
    // 既有不变量仍成立：chips 不回落拉操作日志
    expect(opFn.mock.calls.length).toBe(opCalls);
    // 徽标按 Level 渲染（error → error 图标），不再是固定 joystick
    expect(rtList.querySelector(".log-status.error .ws-icon")).not.toBeNull();
  });

  it("运行时子 tab：搜索命中 Tag（ADR-289 结构化字段并入命中域）", async () => {
    mockApp({
      GetRuntimeLogs: vi.fn(() => [
        { Message: "[watcher] 已启动: /root", Timestamp: 1, Level: "info", Tag: "watcher" },
        { Message: "[queue] emit queue:status done", Timestamp: 2, Level: "info", Tag: "queue" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).click();
    const rtList = root.getElementById("diag-runtime-list") as HTMLElement;
    await waitFor(() => rtList.textContent!.includes("已启动"));
    // 搜 tag 名（消息里也含，但 Tag 字段独立并入命中域后语义更明确）
    const input = root.getElementById("diag-log-search") as HTMLInputElement;
    input.value = "queue";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => !rtList.textContent!.includes("已启动"));
    expect(rtList.textContent).toContain("queue:status");
  });

  it("运行时子 tab：点状态 chips 仅更新选中态，不回落拉取操作日志", async () => {
    const opFn = vi.fn(() => []);
    mockApp({ GetImportLogs: opFn, GetRuntimeLogs: vi.fn(() => [{ Message: "ok", Timestamp: 1 }]) });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).click();
    await waitFor(() =>
      (root.getElementById("diag-runtime-list") as HTMLElement).textContent!.includes("ok"),
    );
    const opCalls = opFn.mock.calls.length;
    const chip = root.querySelector('.diag-log-fbtn[data-status="success"]') as HTMLElement;
    chip.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(opFn.mock.calls.length).toBe(opCalls);
    expect(chip.classList.contains("active")).toBe(true);
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

  it("刷新按钮：runtime 子 tab 激活 → 加载运行时日志；否则重载导入日志", async () => {
    const runtimeFn = vi.fn(() => [{ Message: "watcher ok", Timestamp: 1700000000000 }]);
    mockApp({ GetRuntimeLogs: runtimeFn });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    // 切到 runtime 子 tab
    (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).click();
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

  it("日志子屏切换（ADR-300 §2.2）→ op/runtime/trace 三态：列表显隐 + 工具栏与清空联动", () => {
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const opList = root.getElementById("diag-log-list") as HTMLElement;
    const rtList = root.getElementById("diag-runtime-list") as HTMLElement;
    const clearBtn = root.getElementById("diag-clear") as HTMLElement;
    const toolbar = root.querySelector('[data-sub-group="logs"][data-sub-pane="op runtime"]') as HTMLElement;
    const tracePane = root.querySelector('[data-sub-pane="trace"]') as HTMLElement;
    // 初始：op 激活，runtime 隐藏，清空可见
    expect(opList.style.display).not.toBe("none");
    expect(rtList.style.display).toBe("none");
    expect(clearBtn.style.display).not.toBe("none");
    // 切到 runtime 子屏
    (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).click();
    expect(opList.style.display).toBe("none");
    expect(rtList.style.display).not.toBe("none");
    expect(clearBtn.style.display).toBe("none"); // 运行时日志无清空能力
    expect(toolbar.style.display).not.toBe("none"); // 工具栏归 op+runtime 常驻
    expect(tracePane.style.display).toBe("none");
    expect(
      (root.querySelector('.diag-sub-tab[data-sub="runtime"]') as HTMLElement).classList.contains(
        "active",
      ),
    ).toBe(true);
    // 切到 trace：工具栏（连带刷新/复制/清空/搜索/筛选）整体退场——trace 有自己的刷新按钮
    (root.querySelector('.diag-sub-tab[data-sub="trace"]') as HTMLElement).click();
    expect(toolbar.style.display).toBe("none");
    expect(clearBtn.style.display).toBe("none");
    expect(tracePane.style.display).not.toBe("none");
    expect(root.querySelector<HTMLElement>('.diag-sub-bar[data-sub-bar="logs"]')!.dataset.activeSub).toBe("trace");
    // 切回 op：一切恢复（激活是幂等迁移，不是一次性改动）
    (root.querySelector('.diag-sub-tab[data-sub="op"]') as HTMLElement).click();
    expect(toolbar.style.display).not.toBe("none");
    expect(clearBtn.style.display).not.toBe("none");
    expect(opList.style.display).not.toBe("none");
  });
});
describe("startDedup（会话工厂 createDedupSession）", () => {
  const dedup = createDedupSession();
  const groupJson = [
    {
      files: [
        { path: "/a/dup.ysm", name: "dup.ysm", size: 1024, modTime: 2000 },
        { path: "/b/dup.ysm", name: "dup.ysm", size: 2048, modTime: 1000 },
      ],
    },
  ];

  it("rtype 指定 → 单目录扫描 + 渲染组 + exec 移入回收站", async () => {
    const moveFn = vi.fn();
    mockApp({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: moveFn,
    });
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
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
    // ADR-269 D3④：collectTargets 现遍历真 SSOT（resourceTypesById），非 mock 子集——
    // 抽两个真实类型 id 验证「all 分支逐类型取目录」，其余类型同样被覆盖。
    const repoRoot = vi.fn(() => "/repo");
    mockApp({ GetRepoRoot: repoRoot });
    const list = document.createElement("div");
    await dedup.start(list, esc, "all");
    expect(repoRoot).toHaveBeenCalledWith("ysm");
    expect(repoRoot).toHaveBeenCalledWith("EntityPlayer");
    await waitFor(() => list.textContent!.includes("没有重复文件"));
  });

  it("无目录 → 请先配置资源目录", async () => {
    mockApp({ GetRepoRoot: vi.fn(() => "") });
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    expect(list.textContent).toContain("请先配置资源目录");
  });

  it("无重复 → 没有重复文件", async () => {
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.textContent!.includes("没有重复文件"));
  });

  it("取消按钮 → 已取消去重", async () => {
    mockApp({ FindDuplicateFiles: vi.fn(() => groupJson) });
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-cancel"));
    (list.querySelector("#diag-dedup-cancel") as HTMLElement).click();
    expect(list.textContent).toContain("已取消去重");
  });

  it("FindDuplicateFiles 抛错 → 去重失败兜底", async () => {
    mockApp({
      FindDuplicateFiles: vi.fn(() => Promise.reject(new Error("磁盘错误"))),
    });
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.textContent!.includes("去重失败"));
  });

  it("文件名点击 → bus model:select", async () => {
    mockApp({ FindDuplicateFiles: vi.fn(() => groupJson) });
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("[data-path]"));
    (list.querySelector("[data-path]") as HTMLElement).click();
    // 第一个 data-path 是组内第一个文件
    expect(busEmit).toHaveBeenCalledWith("model:select", {
      path: "/a/dup.ysm",
    });
  });

  it("重入守卫：并发调用仅首次执行，busy 期间第二次早退且不重复扫描", async () => {
    mockApp({ FindDuplicateFiles: vi.fn(() => groupJson) });
    const list = document.createElement("div");
    // 同步双调用：首次在首个 await 前已置 _dedupBusy=true，第二次必命中守卫早退
    // ADR-269 D3④：类型元数据已同步（无 RPC 计点），改以 getApp 调用次数佐证「第二次未进入扫描」
    const p1 = dedup.start(list, esc, "ysm");
    const p2 = dedup.start(list, esc, "ysm");
    await Promise.all([p1, p2]);
    expect(getApp).toHaveBeenCalledTimes(1);
    // 守卫已复位，后续可正常再次扫描
    const list2 = document.createElement("div");
    await dedup.start(list2, esc, "ysm");
    expect(getApp).toHaveBeenCalledTimes(2);
  });
});

describe("dedup config（getConfig / resetConfig）", () => {
  const dedup = createDedupSession();
  it("getConfig 返回冻结快照，调用方篡改不影响内部状态", () => {
    const cfg = dedup.getConfig();
    expect(cfg.strategy).toBe("deep_hash");
    expect(cfg.keepPolicy).toBe("oldest");
    expect(cfg.priorityPath).toBe("");

    // 快照是 Object.freeze，篡改抛 TypeError（V8 消息为 "Cannot assign to read only property"，
    // 不含 "frozen" 子串，断言按错误类匹配而非引擎文本）
    expect(() => {
      (cfg as { strategy: string }).strategy = "quick_hash";
    }).toThrow(TypeError);

    // 内部状态不受影响
    expect(dedup.getConfig().strategy).toBe("deep_hash");
  });

  it("多次调用 getConfig 返回不同对象引用（快照独立）", () => {
    const cfg1 = dedup.getConfig();
    const cfg2 = dedup.getConfig();
    expect(cfg1).not.toBe(cfg2);
    expect(cfg1.strategy).toBe(cfg2.strategy);
  });

  it("resetConfig 幂等：默认状态下 reset 不改变配置", () => {
    expect(dedup.getConfig().strategy).toBe("deep_hash");
    dedup.resetConfig();
    expect(dedup.getConfig().strategy).toBe("deep_hash");
    expect(dedup.getConfig().keepPolicy).toBe("oldest");
    expect(dedup.getConfig().priorityPath).toBe("");
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

  it("diag-copy：加载完成为空（列表只剩占位文案）→ 仍不复制、弹「当前无日志可复制」", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    mockApp({ GetImportLogs: vi.fn(() => []) });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const list = root.getElementById("diag-log-list") as HTMLElement;
    // 等空态渲染完成：此时列表文本**非空**（占位文案），但没有任何 .log-row
    await waitFor(() => expect(list.textContent).toContain("暂无日志"));
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
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "success", Operation: "import", ModelName: "fallback.ysm", Timestamp: 1700000000000 },
      ]),
    });
    const execSpy = vi.fn(() => true);
    const restore = overrideExecCommand(execSpy);
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    // 必须有真实 .log-row 才算「可复制内容」——占位文案（「暂无日志」）不是日志；
    // 拿它当内容复制并弹「已复制」正是 2026-09 修掉的谎报（见「加载完成为空」回归锁）。
    const list = root.getElementById("diag-log-list") as HTMLElement;
    await waitFor(() =>
      expect(list.querySelector(".log-row")).toBeTruthy(),
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

  // ===== 复制回执诚实性墓碑（诊断页重复实现审计 C5）=====
  // 立因：本页曾自写 textarea 降级（返回 void）并无条件弹「已复制」——剪贴板被拒且 execCommand
  // 也失败时界面在撒谎。这两条把「失败就说失败」钉在**入口层**（单点测试只盖得住 copyWithToast，
  // 盖不住「入口有没有去消费它的结果」）。任何退回「不看 copyText 返回值」的写法都会立刻红。

  it("diag-copy：写入与降级全失败 → ❌ 复制失败，绝不弹「已复制」", async () => {
    stubClipboard(vi.fn(() => Promise.reject(new Error("denied"))));
    const restore = overrideExecCommand(vi.fn(() => false)); // 降级也失败
    mockApp({
      GetImportLogs: vi.fn(() => [
        { Status: "success", Operation: "import", ModelName: "fail.ysm", Timestamp: 1700000000000 },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    await waitFor(() =>
      expect(
        (root.getElementById("diag-log-list") as HTMLElement).querySelector(".log-row"),
      ).toBeTruthy(),
    );
    (root.getElementById("diag-copy") as HTMLElement).click();
    await waitFor(() =>
      expect(busEmit).toHaveBeenCalledWith(
        "toast:show",
        expect.objectContaining({ msg: expect.stringContaining("复制失败") }),
      ),
    );
    restore();
    const copyToasts = busEmit.mock.calls.filter(
      (c) => c[0] === "toast:show" && (c[1] as { msg?: string }).msg?.includes("复制"),
    );
    for (const [, payload] of copyToasts) {
      expect((payload as { msg: string }).msg).not.toContain("已复制");
    }
  });

  it(".log-copy 行点击：写入与降级全失败 → ❌ 复制失败，绝不弹「已复制」", async () => {
    stubClipboard(vi.fn(() => Promise.reject(new Error("denied"))));
    const restore = overrideExecCommand(vi.fn(() => false));
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
    await waitFor(() =>
      expect(busEmit).toHaveBeenCalledWith(
        "toast:show",
        expect.objectContaining({ msg: expect.stringContaining("复制失败") }),
      ),
    );
    restore();
    const failed = busEmit.mock.calls.find(
      (c) => c[0] === "toast:show" && (c[1] as { msg?: string }).msg?.includes("复制失败"),
    );
    expect((failed?.[1] as { type?: string }).type).toBe("error"); // 失败不许标成 success
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

describe("initDiagnostics — 扫描栏接线（ADR-288 D2/D3：进页面即备好参数，扫描仍显式点击）", () => {
  it("挂载即填充同步冲突参数栏（Exists 实例过滤 + 默认选首）——无需先点一次按钮", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true, CustomDir: "/a" },
        { Name: "insB", Exists: false, CustomDir: "/b" },
      ]),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const bar = root.getElementById("diag-sync-bar") as HTMLElement;
    await waitFor(() =>
      expect(bar.querySelectorAll("#sync-instance option").length).toBeGreaterThan(0),
    );
    const optTexts = Array.from(bar.querySelectorAll("#sync-instance option")).map(
      (o) => o.textContent,
    );
    expect(optTexts).toContain("insA");
    expect(optTexts).not.toContain("insB"); // Exists=false 不入选项
    expect((bar.querySelector("#sync-instance") as HTMLSelectElement).value).toBe("insA");
    // 结果区未被初始化改写（仍是引导空态），栏与结果区两段式
    const list = root.getElementById("diag-sync-conflict-list") as HTMLElement;
    expect(list.textContent).not.toContain("insA");
  });

  it("栏内体检按钮点击 → 报告渲染到结果区，且按钮仍在栏内（不被结果替换吃掉）", async () => {
    mockApp({
      RepoHealthAudit: vi.fn(() => buildReport()),
      GetRepoRoot: vi.fn(async () => "/repo"),
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const bar = root.getElementById("diag-health-bar") as HTMLElement;
    const list = root.getElementById("diag-health-list") as HTMLElement;
    (bar.querySelector("#diag-scan-health") as HTMLElement).click();
    await waitFor(() => expect(list.innerHTML).toContain("85"));
    expect(list.innerHTML).toContain("健康");
    // ADR-288 §1：按钮住栏内，结果整块替换不得把入口一起抹掉
    expect(bar.querySelector("#diag-scan-health")).toBeTruthy();
  });
});

describe("initDiagnostics — 日志子屏与查看器降级", () => {
  it("查看器模式（isViewerMode=true）→ 桌面专属组整块不渲染，扫描/基准入口缺席", () => {
    isViewerMode.mockReturnValue(true);
    const { root, el } = makeRoot();
    // 降级已下沉模板层：用**真实成品模板**覆盖夹具，钉 renderTabs(viewerMode, desktopOnly)
    // 新链——手拼夹具测不到「声明处即真相」（旧测试只验 init 事后改 style）。
    el.innerHTML = diagnosticsHTML();
    initDiagnostics(root, esc);
    // ADR-300 §2.1/§2.5：desktopOnly 收口到组级——基准组（含 single/conc/scan 三 pill）与
    // 体检组（health/sync 二 pill）整块缺席，旧六 tab 时代的散点名单退役
    for (const name of ["bench", "audit"]) {
      expect(root.querySelector(`.repo-tab[data-tab="${name}"]`)).toBeNull();
      expect(root.getElementById(`diag-tab-${name}`)).toBeNull();
    }
    // 跨模式可用项照常在场：logs 组 + 其第三子屏 trace（加载剖析读内存 store，豁免随迁）。
    // viewer 退化态（声明 3 组 / 可见 1 组）顶层 tab 栏整块缺席（renderTabs degrade-only 判据）：
    // logs 按钮随之不在 DOM——缺席的是**栏**不是内容，面板与组内子 pill 照常产出
    expect(root.querySelector('.repo-tab[data-tab="logs"]')).toBeNull();
    expect(root.getElementById("diag-tab-logs")).not.toBeNull();
    expect(root.querySelector('.diag-sub-tab[data-sub="trace"]')).not.toBeNull();
    // 扫描入口是**常驻栏**（ADR-288 D2）：栏本体在缺席面板内同样不存在
    // （组级 desktopOnly 让整块面板不渲染，栏随面板一起消失，无需再按 id 逐个隐）
    for (const id of ["diag-health-bar", "diag-sync-bar", "diag-perf-scan-bench"]) {
      expect(root.getElementById(id)).toBeNull();
    }
    // 加载剖析读内存 store、零 Go/CLI 依赖 → 跨模式可用，入口不得隐藏（ADR-278 §2.5）
    expect(
      (root.getElementById("diag-trace-refresh") as HTMLElement).style.display,
    ).not.toBe("none");
    // ADR-300 §2.5（D3）：web 端「沉默消失」变「可见缺席」——告知行在成品里存在
    expect(root.querySelector(".repo-tabs-notice")).not.toBeNull();
  });

  it("桌面模式（isViewerMode=false）→ 桌面专属组面板照常渲染（desktopOnly 仅在 viewer 生效）", () => {
    const { root, el } = makeRoot();
    // 与 viewer 测试互为镜像：钉的是**同一 renderTabs 声明**的另一半——desktopOnly 是
    // 「isViewerMode 才裁」的条件声明，桌面端三组齐在。旧版此测试验 init 事后不改 style，
    // 是重言式（没有东西会去改）；改锚真实模板的正向不变量才有判别力。
    el.innerHTML = diagnosticsHTML();
    initDiagnostics(root, esc);
    for (const name of ["logs", "bench", "audit"]) {
      expect(root.querySelector(`.repo-tab[data-tab="${name}"]`), `桌面缺 ${name} tab`).not.toBeNull();
      expect(root.getElementById(`diag-tab-${name}`), `桌面缺 ${name} 面板`).not.toBeNull();
    }
    // 桌面端不出告知行（renderTabs 只在真藏了东西的 viewer 模式产出 notice）
    expect(root.querySelector(".repo-tabs-notice")).toBeNull();
  });
});

describe("initDiagnostics — trace 面板进入语义（2026-09）", () => {
  beforeEach(() => {
    clearLoadTraces();
  });

  it("init 即渲染：有记录时渲染进 #diag-load-trace，未记录时呈现引导空态", async () => {
    // 前半：有记录 → renderLoadTraceSection 渲染卡片
    recordLoadTrace({
      ts: Date.now(),
      format: "mmd",
      path: "./ysm/player.ysm",
      stages: [{ name: "读取", ms: 12, status: "ok" }],
      ok: true,
    });
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    await waitFor(() => expect(out.textContent).toContain("player.ysm"));
    clearLoadTraces();
    // 后半：记录清空 → 切进 trace 子屏（bindSubBar onSwitch 链路）重渲出引导空态
    //（进即渲染是渲染调用，不是状态缓存；ADR-300 §2.1：record 降级为 logs 组第三 pill）
    (root.querySelector('.diag-sub-tab[data-sub="trace"]') as HTMLElement).click();
    await waitFor(() => expect(out.textContent).toContain("暂无加载记录"));
  });

  it("进 trace 取最新快照：pill 切换与 logs 组重进两个载体都吃「最新一份」（ADR-300 §2.6 红线）", async () => {
    // 锁「每次进子屏取最新快照」语义——init.ts 注释写明的与 TAB_INIT 懒加载表的核心区别。
    // 旧载体 .repo-tab[data-tab="record"] 已随降级消失；若迁移时漏接 logs 顶层 tab 这一半，
    // optional-chain 会静默失灵（点 tab 不再重渲），此测试即它的墓碑。
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    // 此刻 store 为空：先确认渲染的是空态（非「init 后未渲染」）
    await waitFor(() => expect(out.textContent).toContain("暂无加载记录"));
    // 载体一：pill 切换（3D 适配器在 init 之后写入 store → 切进 trace 看到 vrm）
    recordLoadTrace({
      ts: Date.now(),
      format: "vrm",
      path: "./vrmodel/test.vrm",
      stages: [{ name: "加载", ms: 8, status: "ok" }],
      ok: true,
    });
    (root.querySelector('.diag-sub-tab[data-sub="trace"]') as HTMLElement).click();
    await waitFor(() => expect(out.textContent).toContain("test.vrm"));
    // 载体二：trace 已激活时点 logs 顶层 tab（重进页面组）→ 再写入的 pmx 也要可见
    recordLoadTrace({
      ts: Date.now(),
      format: "pmx",
      path: "./pmx/dance.pmx",
      stages: [{ name: "加载", ms: 5, status: "ok" }],
      ok: true,
    });
    (root.querySelector('.repo-tab[data-tab="logs"]') as HTMLElement).click();
    await waitFor(() => expect(out.textContent).toContain("dance.pmx"));
  });

  it("查看器模式：trace 刷新入口不隐藏（纯内存 store，不依赖 Go/CLI）", () => {
    isViewerMode.mockReturnValue(true);
    const { root } = makeRoot();
    initDiagnostics(root, esc);
    expect(
      (root.getElementById("diag-trace-refresh") as HTMLElement).style.display,
    ).not.toBe("none");
  });
});
