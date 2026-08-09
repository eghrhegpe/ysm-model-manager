// ===== app-tree bus 事件处理测试（bindBusEvents）=====
// 覆盖：选仓库 / 去重占位 / 回收站占位 / 批量启用禁用（前缀过滤+并发守卫）/
//       文件夹重命名/新建/回收 / 批量重命名（空目录/成功/部分失败）/ tree:reload
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import { selectState } from "./data.ts";
import type { TreeEntry } from "./loader.ts";

const {
  SelectDirectoryMock,
  SaveAppConfigMock,
  LoadAppConfigMock,
  ToggleModelEnableMock,
  RenameDirMock,
  CreateDirMock,
  ListAllFilePathsMock,
  MoveToRecycleMock,
  RemoveDirMock,
  ScanModelEntriesMock,
  RenameFileMock,
  ClearScanCacheMock,
  modalPromptMock,
  modalConfirmMock,
  showBatchRenameDialogMock,
  initInstanceActionsMock,
  getRegistryMock,
} = vi.hoisted(() => ({
  SelectDirectoryMock: vi.fn(),
  SaveAppConfigMock: vi.fn(),
  LoadAppConfigMock: vi.fn(),
  ToggleModelEnableMock: vi.fn(),
  RenameDirMock: vi.fn(),
  CreateDirMock: vi.fn(),
  ListAllFilePathsMock: vi.fn(),
  MoveToRecycleMock: vi.fn(),
  RemoveDirMock: vi.fn(),
  ScanModelEntriesMock: vi.fn(),
  RenameFileMock: vi.fn(),
  ClearScanCacheMock: vi.fn(),
  modalPromptMock: vi.fn(),
  modalConfirmMock: vi.fn(),
  showBatchRenameDialogMock: vi.fn(),
  initInstanceActionsMock: vi.fn(() => []),
  getRegistryMock: vi.fn(),
}));

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    SelectDirectory: SelectDirectoryMock,
    SaveAppConfig: SaveAppConfigMock,
    LoadAppConfig: LoadAppConfigMock,
    ToggleModelEnable: ToggleModelEnableMock,
    RenameDir: RenameDirMock,
    CreateDir: CreateDirMock,
    ListAllFilePaths: ListAllFilePathsMock,
    MoveToRecycle: MoveToRecycleMock,
    RemoveDir: RemoveDirMock,
    ScanModelEntries: ScanModelEntriesMock,
    RenameFile: RenameFileMock,
    ClearScanCache: ClearScanCacheMock,
    GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  }),
}));

vi.mock("../../services/registry.ts", () => ({
  get: getRegistryMock,
}));

vi.mock("../../utils/dom/dialogs/modal.ts", () => ({
  modalPrompt: modalPromptMock,
  modalConfirm: modalConfirmMock,
}));

vi.mock("../../utils/dom/dialogs/batch-rename.ts", () => ({
  showBatchRenameDialog: showBatchRenameDialogMock,
}));

import { bindBusEvents } from "./bus-handlers.ts";

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
  _rootAttr: string;
  _typeFilter: string | null;
  _batchBusy: boolean;
  _toggleBusy: boolean;
  _entries: TreeEntry[];
  _repoRoot: string | null;
  _renderTree: ReturnType<typeof vi.fn>;
  _load: ReturnType<typeof vi.fn>;
}

function makeVM(entries: TreeEntry[] = []): VM {
  return {
    _rootAttr: "ysm",
    _typeFilter: null,
    _batchBusy: false,
    _toggleBusy: false,
    _entries: entries,
    _repoRoot: null,
    _renderTree: vi.fn(),
    _load: vi.fn().mockResolvedValue(undefined),
  };
}

// bus 事件收集
const toasts: Array<{ msg: string; type: string }> = [];
const statsRefreshed: Array<boolean> = [];
const offs: Array<() => void> = [];
let unsubs: Array<() => void> = [];

beforeEach(() => {
  toasts.length = 0;
  statsRefreshed.length = 0;
  offs.forEach((fn) => fn());
  offs.length = 0;
  offs.push(bus.on("toast:show", (p) => toasts.push(p as never)));
  offs.push(bus.on("stats:refresh", () => statsRefreshed.push(true)));

  vi.clearAllMocks();
  SelectDirectoryMock.mockResolvedValue("/pick/x");
  SaveAppConfigMock.mockResolvedValue(undefined);
  LoadAppConfigMock.mockResolvedValue({ linkMode: "copy" });
  ToggleModelEnableMock.mockResolvedValue(undefined);
  RenameDirMock.mockResolvedValue(undefined);
  CreateDirMock.mockResolvedValue(undefined);
  ListAllFilePathsMock.mockResolvedValue(["/repo/a.ysm", "/repo/b.ysm"]);
  MoveToRecycleMock.mockResolvedValue(undefined);
  RemoveDirMock.mockResolvedValue(undefined);
  ScanModelEntriesMock.mockResolvedValue([]);
  RenameFileMock.mockResolvedValue(undefined);
  ClearScanCacheMock.mockResolvedValue(undefined);
  modalPromptMock.mockResolvedValue("");
  modalConfirmMock.mockResolvedValue(false);
  showBatchRenameDialogMock.mockResolvedValue(undefined);
  getRegistryMock.mockImplementation((name: string) =>
    name === "loadEntries"
      ? async () => ({ repoRoot: "/repo", entries: [] as TreeEntry[] })
      : undefined,
  );
  selectState.keys.clear();
  selectState.lastKey = null;
});

afterEach(() => {
  offs.forEach((fn) => fn());
  offs.length = 0;
  unsubs?.forEach((fn) => fn());
  unsubs = [];
});

async function bind(vm: VM): Promise<void> {
  const { bindBusEvents } = await import("./bus-handlers.ts");
  unsubs = bindBusEvents(vm as never);
  await Promise.resolve();
}

describe("bindBusEvents — 批量启用/禁用", () => {
  it("batch:enable-all → 只 toggle 当前禁用的条目", async () => {
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: true }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: false }),
    ]);
    await bind(vm);

    bus.emit("batch:enable-all");
    await new Promise((r) => setTimeout(r, 0));

    // 仅 banned=true 的 a.ysm 被启用
    expect(ToggleModelEnableMock).toHaveBeenCalledTimes(1);
    expect(ToggleModelEnableMock).toHaveBeenCalledWith("/repo/a.ysm");
    expect(toasts.some((t) => t.msg.includes("全部启用: 1 成功"))).toBe(true);
  });

  it("batch:disable-all → 只 toggle 当前启用的条目", async () => {
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: false }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: true }),
    ]);
    await bind(vm);

    bus.emit("batch:disable-all");
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleModelEnableMock).toHaveBeenCalledTimes(1);
    expect(ToggleModelEnableMock).toHaveBeenCalledWith("/repo/a.ysm");
  });

  it("batch:enable（目录前缀）→ 只处理该目录下条目", async () => {
    const vm = makeVM([
      makeEntry({ name: "a.ysm", path: "dir1/a.ysm", fullPath: "/repo/dir1/a.ysm", banned: true }),
      makeEntry({ name: "b.ysm", path: "dir2/b.ysm", fullPath: "/repo/dir2/b.ysm", banned: true }),
    ]);
    await bind(vm);

    bus.emit("batch:enable", { dir: "dir1" });
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleModelEnableMock).toHaveBeenCalledTimes(1);
    expect(ToggleModelEnableMock).toHaveBeenCalledWith("/repo/dir1/a.ysm");
  });

  it("ToggleModelEnable 部分失败 → toast 报告成功/失败数", async () => {
    const vm = makeVM([
      makeEntry({ name: "a.ysm", fullPath: "/repo/a.ysm", banned: true }),
      makeEntry({ name: "b.ysm", fullPath: "/repo/b.ysm", banned: true }),
    ]);
    await bind(vm);
    ToggleModelEnableMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("EACCES"));

    bus.emit("batch:enable-all");
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("全部启用: 1 成功, 1 失败"))).toBe(true);
  });

  it("并发守卫：_batchBusy 在途 → 后续批量操作忽略", async () => {
    const vm = makeVM([makeEntry({ banned: true })]);
    await bind(vm);
    vm._batchBusy = true;

    bus.emit("batch:enable-all");
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleModelEnableMock).not.toHaveBeenCalled();
  });

  it("目录下无待处理条目 → 不调后端不 toast", async () => {
    const vm = makeVM([makeEntry({ banned: false })]);
    await bind(vm);

    bus.emit("batch:enable", { dir: "dir1" });
    await new Promise((r) => setTimeout(r, 0));

    expect(ToggleModelEnableMock).not.toHaveBeenCalled();
  });
});

describe("bindBusEvents — 文件夹操作", () => {
  it("dir:rename 确认 → RenameDir + 清空选中态 + reload", async () => {
    const vm = makeVM();
    await bind(vm);
    modalPromptMock.mockResolvedValue("新名字");
    selectState.keys.add("/repo/旧");

    bus.emit("dir:rename", { dir: "旧" });
    await new Promise((r) => setTimeout(r, 0));

    expect(RenameDirMock).toHaveBeenCalledWith("/repo/旧", "新名字");
    expect(selectState.keys.size).toBe(0);
    expect(selectState.lastKey).toBeNull();
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
    selectState.keys.add("/repo/a.ysm");

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(ListAllFilePathsMock).toHaveBeenCalledWith("/repo/旧目录");
    expect(MoveToRecycleMock).toHaveBeenCalledTimes(2);
    expect(RemoveDirMock).toHaveBeenCalledWith("/repo/旧目录");
    expect(selectState.keys.size).toBe(0);
    expect(toasts.some((t) => t.msg.includes("已回收 2 个文件"))).toBe(true);
    expect(statsRefreshed).toHaveLength(1);
  });

  it("dir:recycle 部分失败 → toast 含失败数与文件名", async () => {
    const vm = makeVM();
    await bind(vm);
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));

    bus.emit("dir:recycle", { dir: "旧目录" });
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("已回收 1 个文件") && t.msg.includes("失败 1 个"))).toBe(true);
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
        onRenames = cb as never;
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
        onRenames = cb as never;
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
    );

    selectState.keys.add("/repo/x/a.ysm");
    await onRenames!([{ oldPath: "/repo/x/a.ysm", newName: "a2.ysm" }]);
    expect(selectState.keys.size).toBe(0);
    expect(toasts.some((t) => t.msg.includes("批量重命名完成：1 成功"))).toBe(true);
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
    expect(vm._repoRoot).toBe("/repo");
    expect(vm._renderTree).toHaveBeenCalled();
  });
});
