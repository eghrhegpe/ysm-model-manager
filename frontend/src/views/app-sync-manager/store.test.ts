// ===== store.ts 纯逻辑单测（applyFilter / tabStatus / loadData 契约）=====
// 锐评 P2「子模块靠 index.test.ts 间接覆盖」补强：store 的筛选递归
// （keep-ancestors + forceOpen）与数据加载降级路径在此直测。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/views/backend-deps.ts", () => ({ backendGetApp: vi.fn() }));
vi.mock("@/bus", () => ({ bus: { emit: vi.fn() } }));

import { bus } from "@/bus";
import { backendGetApp } from "@/views/backend-deps.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import type { SyncManagerSelf } from "./self-type.ts";
import type { SyncItem } from "./tpl.ts";
import { applyFilter, loadData, loadTypeConfig, tabStatus } from "./store.ts";

const busEmit = vi.mocked(bus.emit);
const getAppMock = vi.mocked(backendGetApp);

function makeSelf(over: Partial<SyncManagerSelf> = {}): SyncManagerSelf {
  return {
    _guard: createLoadGuard(),
    _instance: "inst1",
    _subtype: "",
    _selectedType: "",
    _statusFilter: "all",
    _singleBusy: new Set<string>(),
    _allItems: [],
    _filteredItems: [],
    _typeConfig: [],
    _loading: false,
    _dirOpen: {},
    _filesRoots: {},
    _scanDirs: {},
    isConnected: true,
    ...over,
  } as unknown as SyncManagerSelf;
}

const item = (over: Partial<SyncItem> & { path: string }): SyncItem =>
  ({ name: over.path, status: "synced", type: "ysm", ...over }) as SyncItem;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("store.tabStatus", () => {
  it("diverged 折叠进 missing，其余状态直通", () => {
    expect(tabStatus(item({ path: "a", status: "diverged" }))).toBe("missing");
    expect(tabStatus(item({ path: "a", status: "synced" }))).toBe("synced");
    expect(tabStatus(item({ path: "a", status: "missing" }))).toBe("missing");
  });
});

describe("store.applyFilter", () => {
  it("type 筛选：不命中类型整枝丢弃", () => {
    const self = makeSelf({ _selectedType: "ysm" });
    self._allItems = [item({ path: "v.vrm", type: "vrm" }), item({ path: "a.ysm" })];
    applyFilter(self);
    expect(self._filteredItems.map((i) => i.path)).toEqual(["a.ysm"]);
  });

  it("status 筛选：命中后代保留父链，父目录记入 forceOpenPaths", () => {
    const self = makeSelf({ _statusFilter: "missing" });
    self._allItems = [
      item({
        path: "dir",
        children: [item({ path: "dir/miss", status: "missing" }), item({ path: "dir/ok" })],
      }),
      item({ path: "clean", children: [item({ path: "clean/ok" })] }),
    ];
    applyFilter(self);
    expect(self._filteredItems).toHaveLength(1);
    expect(self._filteredItems[0].path).toBe("dir");
    // 不变量：父目录自身未命中但子命中 → children 重建为仅命中项
    expect(self._filteredItems[0].children!.map((c) => c.path)).toEqual(["dir/miss"]);
    expect(self._forceOpenPaths).toEqual(new Set(["dir"]));
  });

  it("status=all 时即使有目录结构也不产生 forceOpen", () => {
    const self = makeSelf();
    self._allItems = [item({ path: "dir", children: [item({ path: "dir/x" })] })];
    applyFilter(self);
    expect(self._forceOpenPaths).toEqual(new Set());
  });

  it("自身命中但子全不命中 → children 重建为空数组（不露出未筛选项）", () => {
    const self = makeSelf({ _statusFilter: "missing" });
    self._allItems = [
      item({ path: "miss", status: "missing", children: [item({ path: "miss/ok" })] }),
    ];
    applyFilter(self);
    expect(self._filteredItems[0].children).toEqual([]);
  });
});

describe("store.loadTypeConfig", () => {
  it("成功 → 只保留前端所需字段子集", async () => {
    getAppMock.mockResolvedValue({
      LoadResourceTypes: vi.fn().mockResolvedValue({
        resourceTypes: [
          { id: "ysm", name: "YSM", icon: "i", dirLevelSync: true, extra: "drop-me" },
        ],
      }),
    } as never);
    const self = makeSelf();
    await loadTypeConfig(self);
    expect(self._typeConfig).toEqual([{ id: "ysm", name: "YSM", icon: "i", dirLevelSync: true }]);
  });

  it("失败 → 空数组降级 + warn toast", async () => {
    getAppMock.mockRejectedValue(new Error("boom"));
    const self = makeSelf();
    await loadTypeConfig(self);
    expect(self._typeConfig).toEqual([]);
    expect(busEmit).toHaveBeenCalledTimes(1);
    expect(busEmit.mock.calls[0][0]).toBe("toast:show");
  });
});

describe("store.loadData", () => {
  it("成功 → children null 归一为 undefined；selectedType 存在时顺带取扫描目录", async () => {
    const app = {
      GetInstanceSyncStatus: vi.fn().mockResolvedValue([
        { path: "a", name: "a", status: "synced", type: "ysm", children: null },
      ]),
      GetSyncScanDirs: vi.fn().mockResolvedValue({
        global: "/g",
        instance: "/i",
        warningCode: "scan_dir_wide",
        warningParams: { label: "L", dir: "D", subDir: "S" },
      }),
    };
    getAppMock.mockResolvedValue(app as never);
    const self = makeSelf({ _selectedType: "ysm" });
    await loadData(self);
    expect(self._allItems[0].children).toBeUndefined();
    expect(self._scanDirs["ysm"]).toEqual({
      global: "/g",
      instance: "/i",
      warningCode: "scan_dir_wide",
      warningParams: { label: "L", dir: "D", subDir: "S" },
    });
  });

  it("GetSyncScanDirs 失败 → 静默降级不 toast，主数据仍在", async () => {
    const app = {
      GetInstanceSyncStatus: vi.fn().mockResolvedValue([{ path: "a", name: "a", status: "synced", type: "ysm" }]),
      GetSyncScanDirs: vi.fn().mockRejectedValue(new Error("boom")),
    };
    getAppMock.mockResolvedValue(app as never);
    const self = makeSelf({ _selectedType: "ysm" });
    await loadData(self);
    expect(busEmit).not.toHaveBeenCalled();
    expect(self._allItems).toHaveLength(1);
  });

  it("主加载失败 → 空数组降级 + warn toast", async () => {
    getAppMock.mockRejectedValue(new Error("boom"));
    const self = makeSelf({ _selectedType: "ysm" });
    await loadData(self);
    expect(self._allItems).toEqual([]);
    expect(busEmit).toHaveBeenCalledTimes(1);
  });
});
