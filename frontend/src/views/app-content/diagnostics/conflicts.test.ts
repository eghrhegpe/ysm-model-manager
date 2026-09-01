// ===== 诊断页：冲突扫描（conflicts.ts）测试 =====
// 覆盖：
//  - scanConflicts：web 门禁 / list 缺失 / 重入守卫 / 无目录 / 无实例 /
//    冲突渲染（Exists 过滤 + .disabled/.ban 剥离）/ >50 截断 / 异常兜底
//  - scanSyncConflicts：web 门禁 / 重入守卫 / 无目录 / 配置面板渲染与交互 /
//    检测（error / 无冲突 / 有冲突渲染）/ 异常兜底
//  - 同步冲突解决：ResolveConflicts 策略透传 + 结果计数 + 1.5s 自动复扫 / error / 异常
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../../test-utils/index.ts";
import { scanConflicts, scanSyncConflicts } from "./conflicts.ts";

const { busEmit, busOn, getApp, isWebPlatform } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  busOn: vi.fn(() => () => {}),
  getApp: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("../../../bus.ts", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("../../../backend/app.ts", () => ({ getApp }));
vi.mock("../../../backend/platform-web.ts", () => ({ isWebPlatform }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function makeRoot(): { root: ShadowRoot; list: HTMLElement } {
  const el = document.createElement("div");
  el.innerHTML = `
    <div id="diag-scan-conflict"></div>
    <div id="diag-conflict-list"><span class="sentinel">占位</span></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => el.querySelector(`#${id}`);
  return {
    root: el as unknown as ShadowRoot,
    list: el.querySelector("#diag-conflict-list") as HTMLElement,
  };
}

function mockApp(overrides: Record<string, unknown> = {}) {
  getApp.mockResolvedValue({
    LoadAppConfig: vi.fn(() => ({ mcRoot: "/mc" })),
    ListVersionInstances: vi.fn(() => []),
    ScanModelEntriesWithLabel: vi.fn(() => []),
    DetectConflicts: vi.fn(() => ({ conflicts: [], totalConflicts: 0 })),
    ResolveConflicts: vi.fn(() => ({ resolved: 1, failed: 0, manual: 0 })),
    ...overrides,
  });
}

/** 供重入守卫测试用：首次调用挂起，之后正常返回 */
function loadCfgPendingThenOk() {
  let calls = 0;
  let release: (v: unknown) => void = () => {};
  const loadCfg = vi.fn(() => {
    calls++;
    if (calls === 1) {
      return new Promise((res) => {
        release = res;
      });
    }
    return Promise.resolve({ mcRoot: "/mc" });
  });
  return { loadCfg, release: (v: unknown) => release(v) };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
  mockApp();
});

describe("scanConflicts", () => {
  it("web 门禁：isWebPlatform → toast 警告，不触达 Go 桥，list 不动", async () => {
    isWebPlatform.mockReturnValue(true);
    const { root, list } = makeRoot();
    await scanConflicts(root, esc);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: "网页版不支持冲突扫描", type: "warn" }),
    );
    expect(getApp).not.toHaveBeenCalled();
    expect(list.innerHTML).toContain("sentinel");
  });

  it("diag-conflict-list 缺失 → 静默返回", async () => {
    const el = document.createElement("div");
    (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
      () => null;
    await scanConflicts(el as unknown as ShadowRoot, esc);
    expect(getApp).not.toHaveBeenCalled();
  });

  it("重入守卫：并发第二次早退，首次完成后复位可再扫", async () => {
    const { loadCfg, release } = loadCfgPendingThenOk();
    mockApp({ LoadAppConfig: loadCfg });
    const { root, list } = makeRoot();
    const p1 = scanConflicts(root, esc);
    // 同步段（gate/list/busy 置位/雷达占位）已在首个 await 前执行
    expect(list.innerHTML).toContain("scan-radar");
    const p2 = scanConflicts(root, esc);
    await p2;
    expect(getApp).toHaveBeenCalledTimes(1); // 第二次被守卫吞掉
    release({ mcRoot: "/mc" });
    await p1;
    await waitFor(() => expect(list.textContent).toContain("没有找到整合包"));
    // 守卫复位：后续可正常再次扫描
    await scanConflicts(root, esc);
    expect(getApp).toHaveBeenCalledTimes(2);
  });

  it("无 mcRoot → 请先配置游戏目录 + 扫描按钮复位", async () => {
    mockApp({ LoadAppConfig: vi.fn(() => ({ mcRoot: "" })) });
    const { root, list } = makeRoot();
    await scanConflicts(root, esc);
    await waitFor(() => expect(list.textContent).toContain("请先配置游戏目录"));
    const btn = root.getElementById("diag-scan-conflict") as HTMLElement;
    expect(btn.textContent).toBe("⚡ 开始扫描");
    expect(btn.classList.contains("scanning")).toBe(false);
  });

  it("无实例 → 没有找到整合包", async () => {
    const { root, list } = makeRoot();
    await scanConflicts(root, esc);
    await waitFor(() => expect(list.textContent).toContain("没有找到整合包"));
  });

  it("有冲突 → 渲染冲突行（Exists=false 实例跳过，.disabled/.ban 后缀剥离）", async () => {
    const entries: Record<string, { Name: string }[]> = {
      "/a": [{ Name: "model.ysm" }, { Name: "shared.ysm.disabled" }, { Name: "unique.ysm" }],
      "/b": [{ Name: "model.ysm.ban" }, { Name: "shared.ysm.disabled" }],
      "/c": [{ Name: "model.ysm" }],
    };
    const scanFn = vi.fn((dir: string) => entries[dir] || []);
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true, CustomDir: "/a" },
        { Name: "insB", Exists: true, CustomDir: "/b" },
        { Name: "insC", Exists: false, CustomDir: "/c" },
      ]),
      ScanModelEntriesWithLabel: scanFn,
    });
    const { root, list } = makeRoot();
    await scanConflicts(root, esc);
    await waitFor(() => expect(list.textContent).toContain("发现 2 个文件存在于多个整合包"));
    expect(list.textContent).toContain("model"); // renderDisplayName 剥扩展名
    expect(list.textContent).toContain("shared");
    expect(list.textContent).not.toContain("unique"); // 仅单实例存在，不冲突
    expect(list.textContent).toContain("insA");
    expect(list.textContent).toContain("insB");
    expect(list.textContent).toContain("2 个整合包");
    // Exists=false 的 insC 不扫描
    expect(scanFn).toHaveBeenCalledTimes(2);
    expect(scanFn).not.toHaveBeenCalledWith("/c");
  });

  it("超过 50 组冲突 → 只渲染前 50 行并提示剩余数量", async () => {
    const names = Array.from({ length: 51 }, (_, i) => `c${i}.ysm`);
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true, CustomDir: "/a" },
        { Name: "insB", Exists: true, CustomDir: "/b" },
      ]),
      ScanModelEntriesWithLabel: vi.fn(() => names.map((n) => ({ Name: n }))),
    });
    const { root, list } = makeRoot();
    await scanConflicts(root, esc);
    await waitFor(() => expect(list.textContent).toContain("发现 51 个"));
    expect(list.textContent).toContain("还有 1 个");
    expect(list.querySelectorAll(".conflict-row").length).toBe(50);
  });

  it("扫描抛错 → 扫描失败兜底（含错误原文转义）", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => Promise.reject(new Error("磁盘错误"))),
    });
    const { root, list } = makeRoot();
    await scanConflicts(root, esc);
    await waitFor(() => expect(list.textContent).toContain("扫描失败"));
    expect(list.textContent).toContain("磁盘错误");
  });
});

describe("scanSyncConflicts", () => {
  it("web 门禁：isWebPlatform → toast 警告，不触达 Go 桥", async () => {
    isWebPlatform.mockReturnValue(true);
    const list = document.createElement("div");
    list.innerHTML = '<span class="sentinel">占位</span>';
    await scanSyncConflicts(list, esc);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: "网页版不支持同步冲突扫描", type: "warn" }),
    );
    expect(getApp).not.toHaveBeenCalled();
    expect(list.innerHTML).toContain("sentinel");
  });

  it("重入守卫：并发第二次早退，首次完成后复位可再扫", async () => {
    const { loadCfg, release } = loadCfgPendingThenOk();
    mockApp({ LoadAppConfig: loadCfg });
    const list = document.createElement("div");
    const p1 = scanSyncConflicts(list, esc);
    const p2 = scanSyncConflicts(list, esc);
    await p2;
    expect(getApp).toHaveBeenCalledTimes(1);
    release({ mcRoot: "/mc" });
    await p1;
    await waitFor(() => expect(list.querySelector("#sync-scan-btn")).toBeTruthy());
    await scanSyncConflicts(list, esc);
    expect(getApp).toHaveBeenCalledTimes(2);
  });

  it("无 mcRoot → 请先配置游戏目录", async () => {
    mockApp({ LoadAppConfig: vi.fn(() => ({ mcRoot: "" })) });
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc);
    expect(list.textContent).toContain("请先配置游戏目录");
  });

  it("缺 rtype/instance → 渲染配置面板（类型选项 + Exists 实例过滤 + 默认选中首个）", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true },
        { Name: "insB", Exists: false },
        { Name: "insC", Exists: true },
      ]),
    });
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc);
    const rtype = list.querySelector("#sync-rtype") as HTMLSelectElement;
    const instance = list.querySelector("#sync-instance") as HTMLSelectElement;
    expect(rtype).toBeTruthy();
    expect(instance).toBeTruthy();
    expect(rtype.textContent).toContain("YSM 模型"); // RESOURCE_TYPE_LABELS 首项
    const optTexts = Array.from(instance.querySelectorAll("option")).map((o) => o.textContent);
    expect(optTexts).toContain("insA");
    expect(optTexts).toContain("insC");
    expect(optTexts).not.toContain("insB");
    expect(instance.value).toBe("insA"); // 默认选中首个可用实例
    expect(list.querySelector("#sync-scan-btn")).toBeTruthy();
  });

  it("全部实例 Exists=false → 配置面板仍渲染（实例下拉为空）", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [{ Name: "insB", Exists: false }]),
    });
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc);
    const instance = list.querySelector("#sync-instance") as HTMLSelectElement;
    expect(instance).toBeTruthy();
    expect(instance.querySelectorAll("option").length).toBe(0);
  });

  it("配置面板交互：change 选中值 → 点击扫描 → DetectConflicts 以选中值调用", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true },
        { Name: "insC", Exists: true },
      ]),
      DetectConflicts: vi.fn(() => ({ conflicts: [], totalConflicts: 0 })),
    });
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc);
    const rtype = list.querySelector("#sync-rtype") as HTMLSelectElement;
    rtype.value = "EntityPlayer";
    rtype.dispatchEvent(new Event("change"));
    const instance = list.querySelector("#sync-instance") as HTMLSelectElement;
    instance.value = "insC";
    instance.dispatchEvent(new Event("change"));
    (list.querySelector("#sync-scan-btn") as HTMLElement).click();
    await waitFor(() => expect(list.textContent).toContain("未检测到同步冲突"));
    const app = await getApp();
    expect(app.DetectConflicts).toHaveBeenCalledWith("EntityPlayer", "insC");
  });

  it("DetectConflicts 拒绝（error 通道）→ 展示扫描失败", async () => {
    mockApp({
      DetectConflicts: vi.fn(() => Promise.reject(new Error("同步服务未启动"))),
    });
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc, "ysm", "insA");
    await waitFor(() => expect(list.textContent).toContain("同步服务未启动"));
    expect(list.innerHTML).toContain("diag-msg-error");
  });

  it("检测无冲突 → ✅ 未检测到同步冲突", async () => {
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc, "ysm", "insA");
    await waitFor(() => expect(list.textContent).toContain("未检测到同步冲突"));
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
    await scanSyncConflicts(list, esc, "ysm", "insA");
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

  it("加载上下文抛错 → 扫描失败兜底", async () => {
    mockApp({
      ListVersionInstances: vi.fn(() => Promise.reject(new Error("boom"))),
    });
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc, "ysm", "insA");
    await waitFor(() => expect(list.textContent).toContain("扫描失败"));
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
    await scanSyncConflicts(list, esc, "ysm", "insA");
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
  });

  it("ResolveConflicts 拒绝 → 展示错误原文，不自动复扫", async () => {
    const detectFn = vi.fn(() => ({
      conflicts: [makeConflict()],
      totalConflicts: 1,
    }));
    const resolveFn = vi.fn(() => Promise.reject(new Error("网络中断")));
    mockApp({ DetectConflicts: detectFn, ResolveConflicts: resolveFn });
    const list = document.createElement("div");
    await scanSyncConflicts(list, esc, "ysm", "insA");
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
    await scanSyncConflicts(list, esc, "ysm", "insA");
    await waitFor(() => expect(list.querySelector("#do-resolve-btn")).toBeTruthy());
    (list.querySelector("#do-resolve-btn") as HTMLElement).click();
    await waitFor(() => expect(list.textContent).toContain("写入失败"));
    expect(list.innerHTML).toContain("diag-msg-error");
  });
});
