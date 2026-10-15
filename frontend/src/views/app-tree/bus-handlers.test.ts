// @vitest-environment node
// ===== app-tree bus 事件处理测试（bindBusEvents）=====
// 覆盖：选仓库 / 去重占位 / 回收站占位 / 批量启用禁用（直调 batchToggleAll + 并发守卫 + 乐观与进度）/
//       文件夹重命名/新建/回收 / 批量重命名（空目录/成功/部分失败）/ tree:reload
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "@/bus";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import type { LoadGuard } from "@/utils/async/load-guard.ts";
import { type BusyLock, createBusyLock } from "@/utils/base/primitives/lock.ts";
import type { TreeEntry } from "./loader.ts";
import { stubConsoleWarn } from "@/test-utils/mock-log.ts";

const {
  SelectDirectoryMock,
  SaveAppConfigMock,
  LoadAppConfigMock,
  ToggleEnableMock,
  RenameDirMock,
  CreateDirMock,
  ListAllFilePathsMock,
  MoveToRecycleMock,
  RemoveDirMock,
  ScanModelEntriesMock,
  RenameFileMock,
  ClearScanCacheMock,
  InvalidateScanPathMock,
  modalPromptMock,
  modalConfirmMock,
  showBatchRenameDialogMock,
  loadEntriesMock,
} = vi.hoisted(() => ({
  SelectDirectoryMock: vi.fn(),
  SaveAppConfigMock: vi.fn(),
  LoadAppConfigMock: vi.fn(),
  ToggleEnableMock: vi.fn(),
  RenameDirMock: vi.fn(),
  CreateDirMock: vi.fn(),
  ListAllFilePathsMock: vi.fn(),
  MoveToRecycleMock: vi.fn(),
  RemoveDirMock: vi.fn(),
  ScanModelEntriesMock: vi.fn(),
  RenameFileMock: vi.fn(),
  ClearScanCacheMock: vi.fn(),
  InvalidateScanPathMock: vi.fn(),
  modalPromptMock: vi.fn(),
  modalConfirmMock: vi.fn(),
  showBatchRenameDialogMock: vi.fn(),
  initInstanceActionsMock: vi.fn(() => []),
  loadEntriesMock: vi.fn(),
}));

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    SelectDirectory: SelectDirectoryMock,
    SaveAppConfig: SaveAppConfigMock,
    LoadAppConfig: LoadAppConfigMock,
    ToggleEnable: ToggleEnableMock,
    RenameDir: RenameDirMock,
    CreateDir: CreateDirMock,
    ListAllFilePaths: ListAllFilePathsMock,
    MoveToRecycle: MoveToRecycleMock,
    RemoveDir: RemoveDirMock,
    ScanModelEntries: ScanModelEntriesMock,
    ScanModelEntriesFiltered: ScanModelEntriesMock,
    ScanModelEntriesForBrowse: ScanModelEntriesMock,
    RenameFile: RenameFileMock,
    ClearScanCache: ClearScanCacheMock,
    InvalidateScanPath: InvalidateScanPathMock,
    GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  }),
}));

// registry.ts 已删（架构锐评 P1-2 修正版）：loader mock 直供 loadEntries
vi.mock("./loader.ts", () => ({
  loadEntries: loadEntriesMock,
}));

vi.mock("@/utils/dom/modal-prompt.ts", () => ({
  modalPrompt: modalPromptMock,
}));
vi.mock("@/utils/dom/modal-confirm.ts", () => ({
  modalConfirm: modalConfirmMock,
}));

vi.mock("@/features/dialogs/batch-rename.ts", () => ({
  showBatchRenameDialog: showBatchRenameDialogMock,
}));

// node 环境无 window，capabilities.ts → android-bridge.ts 访问 window 会崩溃
vi.mock("@/backend/capabilities.ts", () => ({
  can: vi.fn(() => true),
}));

function makeEntry(over: Partial<TreeEntry> = {}): TreeEntry {
  return {
    name: "a.ysm",
    path: "a.ysm",
    fullPath: "/repo/a.ysm",
    type: "ysm",
    banned: false,
    size: 1,
    modTime: 0,
    ...over,
  };
}

interface VM {
  toggleLock: BusyLock;
  entries: TreeEntry[];
  _guard: LoadGuard;
  _renderTree: ReturnType<typeof vi.fn>;
  _load: ReturnType<typeof vi.fn>;
  selectState: { keys: Set<string>; lastKey: string | null };
  rootAttr: string;
  subdirAttr: string;
  filesRoot: string | null;
  setRootAttr: (v: string) => void;
  setSubdirAttr: (v: string) => void;
  setFilesRoot: (v: string | null) => void;
  snapshot: {
    readonly entries: TreeEntry[];
    readonly search: string;
    readonly sort: string;
    readonly dirOpen: Record<string, boolean>;
    readonly filterPaths: Set<string> | null;
    readonly renderMode: string;
    readonly rootAttr: string;
    readonly subdirAttr: string;
    readonly filesRoot: string;
  };
}

function makeVM(entries: TreeEntry[] = []): VM {
  let rootAttrVal = "ysm";
  let subdirAttrVal = "";
  let filesRootVal: string | null = null;
  const vm: VM = {
    toggleLock: createBusyLock(),
    entries: entries,
    _guard: createLoadGuard(),
    _renderTree: vi.fn(),
    _load: vi.fn().mockResolvedValue(undefined),
    selectState: { keys: new Set(), lastKey: null },
    // getter/setter（无下划线前缀）
    get rootAttr() { return rootAttrVal; },
    set rootAttr(v: string) { rootAttrVal = v; },
    get subdirAttr() { return subdirAttrVal; },
    set subdirAttr(v: string) { subdirAttrVal = v; },
    get filesRoot() { return filesRootVal; },
    set filesRoot(v: string | null) { filesRootVal = v; },
    setRootAttr(v: string) { rootAttrVal = v; },
    setSubdirAttr(v: string) { subdirAttrVal = v; },
    setFilesRoot(v: string | null) { filesRootVal = v; },
    get snapshot() {
      return {
        entries: vm.entries,
        search: "",
        sort: "name",
        dirOpen: {},
        filterPaths: null,
        renderMode: "grid",
        rootAttr: rootAttrVal,
        subdirAttr: subdirAttrVal,
        filesRoot: filesRootVal ?? "",
      };
    },
  };
  return vm;
}

// bus 事件收集
const toasts: Array<{ msg: string; type: string }> = [];
const statsRefreshed: Array<boolean> = [];
const syncToggles: Array<{ rtype?: string }> = [];
const offs: Array<() => void> = [];
let unsubs: Array<() => void> = [];

beforeEach(() => {
  toasts.length = 0;
  statsRefreshed.length = 0;
  syncToggles.length = 0;
  offs.forEach((fn) => fn());
  offs.length = 0;
  offs.push(bus.on("toast:show", (p) => toasts.push(p as { msg: string; type: string })));
  offs.push(bus.on("stats:refresh", () => statsRefreshed.push(true)));
  offs.push(bus.on("sync:toggle:status", (p) => syncToggles.push(p)));

  vi.clearAllMocks();
  SelectDirectoryMock.mockResolvedValue("/pick/x");
  SaveAppConfigMock.mockResolvedValue(undefined);
  LoadAppConfigMock.mockResolvedValue({ linkMode: "copy" });
  ToggleEnableMock.mockResolvedValue(undefined);
  RenameDirMock.mockResolvedValue(undefined);
  CreateDirMock.mockResolvedValue(undefined);
  ListAllFilePathsMock.mockResolvedValue(["/repo/a.ysm", "/repo/b.ysm"]);
  MoveToRecycleMock.mockResolvedValue(undefined);
  RemoveDirMock.mockResolvedValue(undefined);
  ScanModelEntriesMock.mockResolvedValue([]);
  RenameFileMock.mockResolvedValue(undefined);
  ClearScanCacheMock.mockResolvedValue(undefined);
  InvalidateScanPathMock.mockResolvedValue(undefined);
  modalPromptMock.mockResolvedValue("");
  modalConfirmMock.mockResolvedValue(false);
  showBatchRenameDialogMock.mockResolvedValue(undefined);
  loadEntriesMock.mockImplementation(async () => ({ filesRoot: "/repo", entries: [] as TreeEntry[] }));
});

afterEach(() => {
  vi.restoreAllMocks(); // 复位 stubConsoleWarn 的 console spy，防泄漏到后续用例
  offs.forEach((fn) => fn());
  offs.length = 0;
  unsubs?.forEach((fn) => fn());
  unsubs = [];
});

async function bind(vm: VM): Promise<void> {
  const { bindBusEvents } = await import("./bus-handlers.ts");
  unsubs = bindBusEvents(vm as unknown as Parameters<typeof bindBusEvents>[0]);
  await Promise.resolve();
}

// ADR-298 D2：batch 启停不再经 bus，测试直调导出函数（同一模块实例，走动态 import 取）
const { batchToggleAll } = await import("./bus-handlers.ts");

describe("batchToggleAll — 批量启用/禁用（ADR-298 D2：直调，不再经 bus 中转）", () => {
  it("enable=true → 只 toggle 当前禁用的条目", async () => {
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: true }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: false }),
    ]);
    await bind(vm);

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    // 仅 banned=true 的 a.ysm 被启用
    expect(ToggleEnableMock).toHaveBeenCalledTimes(1);
    expect(ToggleEnableMock).toHaveBeenCalledWith("/repo/a.ysm");
    expect(toasts.some((t) => t.msg.includes("全部启用: 1 成功"))).toBe(true);
  });

  it("enable=false → 只 toggle 当前启用的条目", async () => {
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: false }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: true }),
    ]);
    await bind(vm);

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], false);
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleEnableMock).toHaveBeenCalledTimes(1);
    expect(ToggleEnableMock).toHaveBeenCalledWith("/repo/a.ysm");
  });

  it("ToggleEnable 部分失败 → toast 报告成功/失败数", async () => {
    stubConsoleWarn(); // 静音生产 logWarn("bus","全部启用 失败: ${batch[j]}")
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: true }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: true }),
    ]);
    await bind(vm);
    ToggleEnableMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("EACCES"));

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("全部启用: 1 成功, 1 失败"))).toBe(true);
  });

  it("并发守卫：启停链锁在途 → 后续批量操作忽略", async () => {
    const vm = makeVM([makeEntry({ banned: true })]);
    await bind(vm);
    vm.toggleLock.tryStart(); // ADR-341：替身直持 BusyLock 模拟在途

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleEnableMock).not.toHaveBeenCalled();
  });

  it("19 条快照 → 按 BATCH=8 分批（在途峰值精确 =8，BATCH 常量行为锁）", async () => {
    stubConsoleWarn();
    const vm = makeVM(
      Array.from({ length: 19 }, (_, i) =>
        makeEntry({ name: `m${i}.ysm`, fullPath: `/repo/m${i}.ysm`, banned: true }),
      ),
    );
    await bind(vm);
    // 在途计数 + 逐波放行：批次常量被改大（峰值>8）或改小/改回串行（峰值<8）都红。
    // 首波 8 个 deferred 同步发射（Promise.allSettled map 同步段）故峰值恒 8。
    let inFlight = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    ToggleEnableMock.mockImplementation(
      () =>
        new Promise<void>((r) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          gates.push(() => {
            inFlight--;
            r();
          });
        }),
    );
    const done = batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    // 泵式放行：首波由生产代码异步发射（backendGetApp await 之后），测试须「等待发射 → 放行 ≤8 →
    // 再等下一波」交替进行；每轮放行 ≤8（与 BATCH 同宽）不掩盖真实并发
    let guard = 0;
    while (guard++ < 500) {
      gates.splice(0, 8).forEach((g) => g());
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      if (gates.length === 0 && ToggleEnableMock.mock.calls.length >= 19) break;
    }
    await done;
    expect(ToggleEnableMock).toHaveBeenCalledTimes(19);
    expect(peak, "波次超限/欠批（BATCH 常量回归）").toBe(8);
  });

  it("YSM 树 batch toggle 成功 → 发 sync:toggle:status（带 rtype=ysm）", async () => {
    const vm = makeVM([makeEntry({ fullPath: "/repo/a.ysm", banned: true })]);
    vm.setRootAttr("ysm"); // YSM 树（默认）
    await bind(vm);

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleEnableMock).toHaveBeenCalledTimes(1);
    expect(syncToggles.length).toBe(1);
    expect(syncToggles[0]).toEqual({ rtype: "ysm" });
  });

  it("非 YSM 树（resourcepack）batch toggle 成功 → 仍发（带 rtype=resourcepack），Go 侧按 dirLevelSync 过滤", async () => {
    // ADR-339：前端不再按类型门控（守「前端只读不判」）——总是带当前树类型发射，
    // 是否真正同步由 Go 的 SyncModelToggleStatusForType 按 IsDirLevelSync 决定
    //（resourcepack 非 dirLevelSync → 目标集为空 → no-op）。原「非 YSM 不发」的门控已退役。
    const vm = makeVM([makeEntry({ fullPath: "/repo/pack.zip", banned: true })]);
    vm.setRootAttr("resourcepack");
    await bind(vm);

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleEnableMock).toHaveBeenCalledTimes(1);
    expect(syncToggles.length).toBe(1);
    expect(syncToggles[0]).toEqual({ rtype: "resourcepack" });
  });

  // 2026-10-15 P1-C 第二处：整库批量是全仓最长批量链（数千 IPC），原实现等全部落定才动
  // UI（几十秒假死）+ 零进度。本组锁「乐观即时反馈 + 页脚可见进度 + 失败回滚 + 全失败不重扫」。
  it("乐观即时反馈 + 可见进度：IPC 挂起期条目已翻、进度已显示，结束隐藏", async () => {
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: true }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: true }),
    ]);
    const probe = progressProbe();
    (vm as unknown as Record<string, unknown>)["_root"] = probe.root;
    await bind(vm);
    const gates: Array<() => void> = [];
    ToggleEnableMock.mockImplementation(
      () =>
        new Promise<void>((r) => {
          gates.push(() => r());
        }),
    );

    const done = batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(gates).toHaveLength(2); // 两个 IPC 都没落定
    expect(vm.entries.every((e) => e.banned === false)).toBe(true); // 乐观已翻
    expect(vm._renderTree).toHaveBeenCalled();
    expect(probe.el.hidden).toBe(false);
    expect(probe.el.textContent).toBe("⏳ 启用中 0/2");

    gates.splice(0).forEach((g) => g());
    await done;
    expect(probe.el.hidden).toBe(true); // 四条出口都经 finally 清槽
  });

  it("部分失败 → 成功项保持翻转、失败项回滚原位", async () => {
    stubConsoleWarn(); // 静音生产 logWarn("bus","全部启用 失败: …")
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: true }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: true }),
    ]);
    await bind(vm);
    ToggleEnableMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("EACCES"));

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(vm.entries[0]!.banned).toBe(false); // 成功 → 已启用
    expect(vm.entries[1]!.banned).toBe(true); // 失败 → 回滚回禁用
    expect(toasts.some((t) => t.msg.includes("全部启用: 1 成功, 1 失败"))).toBe(true);
  });

  it("全失败 → 回滚且不付全库重扫（_load 不调）", async () => {
    stubConsoleWarn();
    const vm = makeVM([makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: true })]);
    await bind(vm);
    ToggleEnableMock.mockRejectedValue(new Error("EACCES"));

    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._load).not.toHaveBeenCalled(); // 磁盘无变化 → 本地回滚即真值
    expect(vm.entries[0]!.banned).toBe(true);
    expect(vm._renderTree).toHaveBeenCalled(); // 判别性：旧实现此处 0 次
    expect(syncToggles.length).toBe(0);
  });
  it("空集（无待翻项）→ 不产 IPC、不写 0/0 进度，沿用旧文案", async () => {
    const vm = makeVM([makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: false })]);
    const probe = progressProbe();
    (vm as unknown as Record<string, unknown>)["_root"] = probe.root;
    await bind(vm);

    // enable=true 而唯一项已启用 → targets 为空
    await batchToggleAll(vm as unknown as Parameters<typeof batchToggleAll>[0], true);
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleEnableMock).not.toHaveBeenCalled();
    expect(probe.el.hidden).toBe(true); // 从未显示过（0/0 闪烁窗口已堵）
    expect(toasts.some((t) => t.msg.includes("全部启用: 0 成功, 0 失败"))).toBe(true);
  });
});

/** 页脚进度槽替身（本文件是 node 环境，无 ShadowRoot）：只需 hidden/textContent 两字段 */
function progressProbe(): {
  root: { getElementById: (id: string) => unknown };
  el: { hidden: boolean; textContent: string };
} {
  const el = { hidden: true, textContent: "" };
  return {
    root: { getElementById: (id: string) => (id === "ftr-progress" ? el : null) },
    el,
  };
}

describe("bindBusEvents — 文件夹操作", () => {
  it("dir:rename 确认 → RenameDir + 清空选中态 + reload", async () => {
    const vm = makeVM();
    await bind(vm);
    modalPromptMock.mockResolvedValue("新名字");
    vm.selectState.keys.add("/repo/旧");

    bus.emit("dir:rename", { dir: "旧" });
    await new Promise((r) => setTimeout(r, 0));

    expect(RenameDirMock).toHaveBeenCalledWith("/repo/旧", "新名字");
    expect(vm.selectState.keys.size).toBe(0);
    expect(vm.selectState.lastKey).toBeNull();
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("dir:rename 取消 → 不调后端", async () => {
    const vm = makeVM();
    await bind(vm);

    bus.emit("dir:rename", { dir: "旧" });
    await new Promise((r) => setTimeout(r, 0));

    expect(RenameDirMock).not.toHaveBeenCalled();
  });

  it("dir:rename 失败 → error toast", async () => {
    const vm = makeVM();
    await bind(vm);
    modalPromptMock.mockResolvedValue("x");
    RenameDirMock.mockRejectedValue(new Error("boom"));

    bus.emit("dir:rename", { dir: "旧" });
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("boom"))).toBe(true);
  });

  it("dir:mkdir → CreateDir（拼接父目录）", async () => {
    const vm = makeVM();
    await bind(vm);
    modalPromptMock.mockResolvedValue("子目录");

    bus.emit("dir:mkdir", { dir: "父" });
    await new Promise((r) => setTimeout(r, 0));

    expect(CreateDirMock).toHaveBeenCalledWith("/repo/父/子目录");
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("dir:recycle 确认 → 逐个 MoveToRecycle + RemoveDir + 清选中态", async () => {
    const vm = makeVM();
    await bind(vm);
    modalConfirmMock.mockResolvedValue(true);
    vm.selectState.keys.add("/repo/a.ysm");

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(ListAllFilePathsMock).toHaveBeenCalledWith("/repo/旧目录");
    expect(MoveToRecycleMock).toHaveBeenCalledTimes(2);
    expect(RemoveDirMock).toHaveBeenCalledWith("/repo/旧目录");
    expect(vm.selectState.keys.size).toBe(0);
    expect(toasts.some((t) => t.msg.includes("已回收 2 个文件"))).toBe(true);
    expect(statsRefreshed).toHaveLength(1);
  });

  it("dir:recycle 部分失败 → toast 含失败数与文件名", async () => {
    const vm = makeVM();
    await bind(vm);
    modalConfirmMock.mockResolvedValue(true);
    vm.selectState.keys.add("/repo/旧目录/a.ysm");
    vm.selectState.keys.add("/repo/旧目录/b.ysm");
    MoveToRecycleMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("已回收 1 个文件") && t.msg.includes("失败 1 个"))).toBe(true);
    // P0 回归（审核 2026-10-15）：有失败文件残留时不能 RemoveDir——否则残留文件被
    // os.RemoveAll 永久删除（不进回收站），而 toast 仍报「已回收 N 个」误导用户重试。
    expect(RemoveDirMock).not.toHaveBeenCalled();
    // 部分失败仍清选中：已入回收站的文件路径不再存在，残留选中指向幽灵路径
    expect(vm.selectState.keys.size).toBe(0);
    expect(vm.selectState.lastKey).toBeNull();
  });

  it("dir:recycle 全部失败 → 不调 RemoveDir（防永久删除）", async () => {
    const vm = makeVM();
    await bind(vm);
    modalConfirmMock.mockResolvedValue(true);
    vm.selectState.keys.add("/repo/旧目录/a.ysm");
    vm.selectState.keys.add("/repo/旧目录/b.ysm");
    vm.selectState.lastKey = "/repo/旧目录/a.ysm";
    MoveToRecycleMock.mockRejectedValue(new Error("recycle root unavailable"));

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(MoveToRecycleMock).toHaveBeenCalledTimes(2);
    // 核心断言：失败不得升级为永久删除
    expect(RemoveDirMock).not.toHaveBeenCalled();
    expect(toasts.some((t) => t.msg.includes("已回收 0 个文件"))).toBe(true);
    // 连坐守卫（2026-10-15 审核统一）：全失败 → 文件全还在磁盘上、路径仍有效，
    // 清空只会让用户丢掉重试起点
    expect(vm.selectState.keys.size, "全失败不得清选中").toBe(2);
    expect(vm.selectState.lastKey, "全失败不得清 lastKey").toBe("/repo/旧目录/a.ysm");
  });

  it("dir:recycle RemoveDir 失败 → warn toast（回收成功但空壳残留）", async () => {
    const vm = makeVM();
    await bind(vm);
    modalConfirmMock.mockResolvedValue(true);
    RemoveDirMock.mockRejectedValue(new Error("permission denied"));

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(RemoveDirMock).toHaveBeenCalledTimes(1);
    expect(toasts.some((t) => t.type === "warn" && t.msg.includes("失败"))).toBe(true);
  });

  // 2026-10-15：整目录入回收站是最长的破坏性链，补可见进度——
  // 「移动在途可见 → 结束清槽」两端都要成立，否则用户面对的是无反馈的假死。
  it("dir:recycle 移动在途 → 页脚显示进度；结束后清槽", async () => {
    const vm = makeVM();
    const probe = progressProbe();
    (vm as unknown as Record<string, unknown>)["_root"] = probe.root;
    await bind(vm);
    modalConfirmMock.mockResolvedValue(true);
    const gates: Array<() => void> = [];
    MoveToRecycleMock.mockImplementation(
      () =>
        new Promise<void>((r) => {
          gates.push(() => r());
        }),
    );

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(gates).toHaveLength(2); // 两个移动都还挂起
    expect(probe.el.hidden).toBe(false);
    expect(probe.el.textContent).toBe("⏳ 移入回收站中 0/2");

    gates.splice(0).forEach((g) => g());
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(probe.el.hidden).toBe(true);
  });

  it("dir:recycle 取消 → 不调后端", async () => {
    const vm = makeVM();
    await bind(vm);

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(ListAllFilePathsMock).not.toHaveBeenCalled();
  });
});

describe("bindBusEvents — 批量重命名", () => {
  it("dir:batch-rename 空目录 → warn toast", async () => {
    const vm = makeVM();
    await bind(vm);

    bus.emit("dir:batch-rename", { dir: "空目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("文件夹为空"))).toBe(true);
    expect(showBatchRenameDialogMock).not.toHaveBeenCalled();
  });

  it("dir:batch-rename 有条目 → 打开弹窗 + 重命名回调执行 RenameFile", async () => {
    const vm = makeVM();
    await bind(vm);
    ScanModelEntriesMock.mockResolvedValue([
      { Name: "a.ysm", Path: "/repo/目录/a.ysm" },
      { Name: "b.ysm", Path: "/repo/目录/b.ysm" },
    ]);
    let onRenames: ((r: Array<{ oldPath: string; newName: string }>) => Promise<void>) | undefined;
    showBatchRenameDialogMock.mockImplementation(
      async (_dir: string, _entries: unknown, cb: (r: never) => Promise<void>) => {
        onRenames = cb as unknown as (r: Array<{ oldPath: string; newName: string }>) => Promise<void>;
      },
    );

    bus.emit("dir:batch-rename", { dir: "目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(showBatchRenameDialogMock).toHaveBeenCalledWith(
      "/repo/目录",
      [
        { Name: "a.ysm", Path: "/repo/目录/a.ysm" },
        { Name: "b.ysm", Path: "/repo/目录/b.ysm" },
      ],
      expect.any(Function),
      expect.anything(), // ADR-208 D2：第 4 参 = DOM 模板注入（views/app-tree/tpl-batch-rename.ts）
    );

    RenameFileMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("x"));
    await onRenames!([
      { oldPath: "/repo/目录/a.ysm", newName: "a2.ysm" },
      { oldPath: "/repo/目录/b.ysm", newName: "b2.ysm" },
    ]);

    expect(RenameFileMock).toHaveBeenCalledTimes(2);
    expect(toasts.some((t) => t.msg.includes("批量重命名完成：1 成功，失败 1"))).toBe(true);
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("batch:rename（多选）→ 弹窗 + 重命名回调", async () => {
    const vm = makeVM();
    await bind(vm);
    let onRenames: ((r: Array<{ oldPath: string; newName: string }>) => Promise<void>) | undefined;
    showBatchRenameDialogMock.mockImplementation(
      async (_dir: string, _entries: unknown, cb: (r: never) => Promise<void>) => {
        onRenames = cb as unknown as (r: Array<{ oldPath: string; newName: string }>) => Promise<void>;
      },
    );

    bus.emit("batch:rename", { paths: ["/repo/x/a.ysm", "/repo/x/b.ysm"] });
    await new Promise((r) => setTimeout(r, 0));

    expect(showBatchRenameDialogMock).toHaveBeenCalledWith(
      "批量重命名",
      [
        { Name: "a.ysm", Path: "/repo/x/a.ysm" },
        { Name: "b.ysm", Path: "/repo/x/b.ysm" },
      ],
      expect.any(Function),
      expect.anything(), // ADR-208 D2：第 4 参 = DOM 模板注入（views/app-tree/tpl-batch-rename.ts）
    );

    vm.selectState.keys.add("/repo/x/a.ysm");
    await onRenames!([{ oldPath: "/repo/x/a.ysm", newName: "a2.ysm" }]);
    expect(vm.selectState.keys.size).toBe(0);
    expect(toasts.some((t) => t.msg.includes("批量重命名完成：1 成功"))).toBe(true);
  });

  // 连坐守卫（2026-10-15 审核统一）：全失败 → 磁盘上一个路径都没变 → 选中集仍全有效，
  // 清空只会让用户丢掉重试起点。部分失败仍清（原路径已不存在）。
  // 回归锁：原实现无条件 keys.clear()，全失败也清空。
  it("batch:rename 全部失败 → 选中集保留（不丢重试起点）", async () => {
    const vm = makeVM();
    await bind(vm);
    let onRenames: ((r: Array<{ oldPath: string; newName: string }>) => Promise<void>) | undefined;
    showBatchRenameDialogMock.mockImplementation(
      async (_dir: string, _entries: unknown, cb: (r: never) => Promise<void>) => {
        onRenames = cb as unknown as (r: Array<{ oldPath: string; newName: string }>) => Promise<void>;
      },
    );
    vm.selectState.keys.add("/repo/x/a.ysm");
    vm.selectState.keys.add("/repo/x/b.ysm");
    vm.selectState.lastKey = "/repo/x/a.ysm";

    bus.emit("batch:rename", { paths: ["/repo/x/a.ysm", "/repo/x/b.ysm"] });
    await new Promise((r) => setTimeout(r, 0));

    RenameFileMock.mockRejectedValue(new Error("disk full"));
    await onRenames!([
      { oldPath: "/repo/x/a.ysm", newName: "a2.ysm" },
      { oldPath: "/repo/x/b.ysm", newName: "b2.ysm" },
    ]);

    expect(vm.selectState.keys.size, "全失败不得清选中").toBe(2);
    expect(vm.selectState.lastKey, "全失败不得清 lastKey").toBe("/repo/x/a.ysm");
    expect(toasts.some((t) => t.type === "warn" && t.msg.includes("批量重命名完成：0 成功"))).toBe(true);
  });

  it("batch:rename 空 paths → 直接返回", async () => {
    const vm = makeVM();
    await bind(vm);

    bus.emit("batch:rename", { paths: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(showBatchRenameDialogMock).not.toHaveBeenCalled();
  });
});

describe("bindBusEvents — 树刷新", () => {
  it("tree:reload → 清扫描缓存 + 重新加载 + 渲染", async () => {
    const vm = makeVM();
    await bind(vm);

    bus.emit("tree:reload");
    await new Promise((r) => setTimeout(r, 0));

    expect(ClearScanCacheMock).toHaveBeenCalled();
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("tree:reload → 保留 _subdirAttr（ADR-094，不丢失子目录上下文）", async () => {
    const vm = makeVM();
    vm.setRootAttr("EntityPlayer");
    vm.setSubdirAttr("EntityPlayer");
    // 加载段已收敛走 vm._load()（2026-10-13 reload 四胞胎收口）：subdir 透传语义上移
    // 到 _load（index.ts 按 snapshot.subdirAttr 传 (rtype, subdir) 双参），本用例改为
    // 断言 _load 被调（subdir 参数断言归 index.extra.test.ts 的 loader 观察点）
    await bind(vm);

    bus.emit("tree:reload");
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._load).toHaveBeenCalled();
  });
});

describe("bindBusEvents — 卡片密度变更", () => {
  it("ui:card-density → 重新渲染树（行高变化需重排虚拟滚动）", async () => {
    const vm = makeVM();
    await bind(vm);

    bus.emit("ui:card-density", { density: "normal" });

    expect(vm._renderTree).toHaveBeenCalled();
  });
});

// ===== repo:fs-changed（止血 2026-10-15 A3：watcher 直通 UI）=====
describe("bindBusEvents — 文件系统变更自动重载", () => {
  it("repo:fs-changed → 定向失效当前树根 + _load + 渲染", async () => {
    const vm = makeVM();
    vm.setFilesRoot("/repo/ysm");
    await bind(vm);

    bus.emit("repo:fs-changed");
    await new Promise((r) => setTimeout(r, 0));

    expect(InvalidateScanPathMock).toHaveBeenCalledWith("/repo/ysm");
    expect(vm._load).toHaveBeenCalledTimes(1);
    expect(vm._renderTree).toHaveBeenCalledTimes(1);
    // 定向失效链不触发全局 ClearScanCache（A2 语义：FS 变更不核平他类型缓存）
    expect(ClearScanCacheMock).not.toHaveBeenCalled();
  });

  it("树根未配置（filesRoot 空）→ 跳过失效 binding，仍重载", async () => {
    const vm = makeVM(); // filesRoot = ""
    await bind(vm);

    bus.emit("repo:fs-changed");
    await new Promise((r) => setTimeout(r, 0));

    expect(InvalidateScanPathMock).not.toHaveBeenCalled();
    expect(vm._load).toHaveBeenCalledTimes(1);
  });

  it("代际守卫：_load 在途期间类型切换推进代数 → 迟到的 FS 重载不渲染（防幽灵写入）", async () => {
    const vm = makeVM();
    vm.setFilesRoot("/repo/ysm");
    let resolveLoad: (() => void) | undefined;
    vm._load.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveLoad = r;
        }),
    );
    await bind(vm);

    bus.emit("repo:fs-changed");
    // 等处理器走到 _load 挂起态（backendGetApp / InvalidateScanPath 的 microtask 链）
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveLoad, "_load 应已进入挂起态").toBeTypeOf("function");
    vm._guard.next(); // 模拟切类型链推进代数（FS 重载的在途 _load 变 stale）
    resolveLoad!();
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._renderTree).not.toHaveBeenCalled();
  });
});
