// ===== context-menus 映射测试（ADR-021 A 层）=====
// 触发 ctx:show → 断言 menu:show 载荷与 menu-defs.ts 声明一致；
// 点击 item → 断言 handler 发出正确的 bus 事件 / getApp 调用。
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { bus } from "../bus.ts";
import { registerContextMenus } from "./context-menus.ts";
import { MENU_DEFS, getMenuDef } from "./menu-defs.ts";

// getApp 是动态 import（wails/app.ts），测试用 mock 替代
const { openFolderMock } = vi.hoisted(() => ({
  openFolderMock: vi.fn(),
}));
vi.mock("../wails/app.ts", () => ({
  getApp: () => Promise.resolve({ OpenInstanceFolder: openFolderMock }),
}));

// 异步 handler 依赖：dialogs + bindings 均为动态 import，用 mock 拦截
const {
  modalPromptMock,
  modalConfirmMock,
  modalSelectMock,
  showRenameDialogMock,
  modalTagEditorMock,
  GetRepoRootMock,
  MoveModelFileMock,
  CopyModelFileMock,
  RenameFileMock,
  MoveToRecycleMock,
  LoadAppConfigMock,
  ListVersionInstancesMock,
  InstallModelToMock,
  RevealInExplorerMock,
} = vi.hoisted(() => ({
  modalPromptMock: vi.fn(),
  modalConfirmMock: vi.fn(),
  modalSelectMock: vi.fn(),
  showRenameDialogMock: vi.fn(),
  modalTagEditorMock: vi.fn(),
  GetRepoRootMock: vi.fn(),
  MoveModelFileMock: vi.fn(),
  CopyModelFileMock: vi.fn(),
  RenameFileMock: vi.fn(),
  MoveToRecycleMock: vi.fn(),
  LoadAppConfigMock: vi.fn(),
  ListVersionInstancesMock: vi.fn(),
  InstallModelToMock: vi.fn(),
  RevealInExplorerMock: vi.fn(),
}));

vi.mock("../dialogs/modal.ts", () => ({
  modalPrompt: modalPromptMock,
  modalConfirm: modalConfirmMock,
  modalSelect: modalSelectMock,
}));
vi.mock("../dialogs/rename.ts", () => ({ showRenameDialog: showRenameDialogMock }));
vi.mock("../dialogs/tag-editor.ts", () => ({ modalTagEditor: modalTagEditorMock }));
vi.mock("../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  GetRepoRoot: GetRepoRootMock,
  MoveModelFile: MoveModelFileMock,
  CopyModelFile: CopyModelFileMock,
  RenameFile: RenameFileMock,
  MoveToRecycle: MoveToRecycleMock,
  LoadAppConfig: LoadAppConfigMock,
  ListVersionInstances: ListVersionInstancesMock,
  InstallModelTo: InstallModelToMock,
  RevealInExplorer: RevealInExplorerMock,
}));

// 收集 menu:show 与 handler 发出的业务事件
const menuShows = [];
const emitted = [];
const TRACKED = [
  "instance:export-list",
  "instance:clear",
  "batch:rename",
  "dir:rename",
  "dir:batch-rename",
  "dir:mkdir",
  "dir:recycle",
  "toast:show",
  "tree:reload",
  "stats:refresh",
];

beforeAll(() => {
  bus.on("menu:show", (p) => menuShows.push(p));
  TRACKED.forEach((e) => bus.on(e, (p) => emitted.push({ e, p })));
  registerContextMenus();
});

beforeEach(() => {
  menuShows.length = 0;
  emitted.length = 0;
  openFolderMock.mockClear();
});

/** 触发一次 ctx:show，返回对应的 menu:show 载荷 */
function showMenu(type, overrides = {}) {
  bus.emit("ctx:show", { x: 10, y: 20, type, paths: ["/a.ysm"], ...overrides });
  expect(menuShows).toHaveLength(1);
  return menuShows[0];
}

/** 断言 items 载荷与声明逐条一致（结构 + label 求值） */
function expectItemsMatchDef(payload, type) {
  const def = getMenuDef(type);
  expect(payload.x).toBe(10);
  expect(payload.y).toBe(20);
  expect(payload.items).toHaveLength(def.items.length);
  def.items.forEach((d, i) => {
    const item = payload.items[i];
    if (d.divider) {
      expect(item).toEqual({ divider: true });
      return;
    }
    expect(item.label).toBe(typeof d.label === "function" ? d.label(payloadCtx(type)) : d.label);
    expect(item.icon).toBe(d.icon);
    expect(item.danger).toBe(d.danger);
    expect(typeof item.onClick).toBe("function");
  });
}

/** 构造与声明 label 函数匹配的 ctx 上下文 */
function payloadCtx(type) {
  const base = { paths: ["/a.ysm"] };
  if (type === "instance") return { ...base, instanceName: "测试整合包", rtype: "ysm" };
  if (type === "batch") return { ...base, count: 3 };
  return base;
}

describe("registerContextMenus 四类菜单声明", () => {
  it("instance：items 载荷与 MENU_DEFS 一致（含动态标题）", () => {
    const payload = showMenu("instance", payloadCtx("instance"));
    expectItemsMatchDef(payload, "instance");
  });

  it("batch：items 载荷与 MENU_DEFS 一致（含 count 动态标题）", () => {
    const payload = showMenu("batch", payloadCtx("batch"));
    expectItemsMatchDef(payload, "batch");
  });

  it("file：items 载荷与 MENU_DEFS 一致", () => {
    const payload = showMenu("file", payloadCtx("file"));
    expectItemsMatchDef(payload, "file");
  });

  it("dir：items 载荷与 MENU_DEFS 一致", () => {
    const payload = showMenu("dir", payloadCtx("dir"));
    expectItemsMatchDef(payload, "dir");
  });

  it("MENU_DEFS 覆盖全部四种类型", () => {
    const types = MENU_DEFS.map((d) => d.type);
    expect(types.sort()).toEqual(["batch", "dir", "file", "instance"]);
  });
});

describe("菜单项点击行为", () => {
  /** 取某类菜单中 label 匹配的 item，触发 onClick */
  function clickItem(type, labelText, overrides = {}) {
    const payload = showMenu(type, { ...payloadCtx(type), ...overrides });
    const item = payload.items.find((i) => i.label === labelText);
    expect(item, `找不到菜单项: ${labelText}`).toBeTruthy();
    item.onClick();
    return item;
  }

  it("instance 复制模型清单 → instance:export-list", () => {
    clickItem("instance", "复制模型清单");
    expect(emitted).toContainEqual({
      e: "instance:export-list",
      p: { name: "测试整合包", rtype: "ysm" },
    });
  });

  it("instance 清空模型（danger）→ instance:clear", () => {
    const item = clickItem("instance", "清空此整合包的模型");
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({
      e: "instance:clear",
      p: { name: "测试整合包", rtype: "ysm" },
    });
  });

  it("instance 打开文件夹 → getApp().OpenInstanceFolder", async () => {
    const payload = showMenu("instance", { ...payloadCtx("instance"), path: "/packs/x" });
    const item = payload.items.find((i) => i.label === "打开文件夹");
    item.onClick();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    expect(openFolderMock).toHaveBeenCalledWith("/packs/x", "ysm");
  });

  it("batch 批量重命名 → batch:rename（paths 透传）", () => {
    clickItem("batch", "批量重命名...", { paths: ["/a.ysm", "/b.ysm"] });
    expect(emitted).toContainEqual({
      e: "batch:rename",
      p: { paths: ["/a.ysm", "/b.ysm"] },
    });
  });

  it("dir 重命名 → dir:rename（dir 透传）", () => {
    clickItem("dir", "重命名…", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:rename", p: { dir: "/packs/x" } });
  });

  it("dir 新建子文件夹 → dir:mkdir", () => {
    clickItem("dir", "新建子文件夹…", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:mkdir", p: { dir: "/packs/x" } });
  });

  it("dir 移入回收站（danger）→ dir:recycle", () => {
    const item = clickItem("dir", "移入回收站", { dir: "/packs/x" });
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({ e: "dir:recycle", p: { dir: "/packs/x" } });
  });
});

describe("异步 handler（batch / file 动态 import 分支）", () => {
  const DIALOG_MOCKS = [
    modalPromptMock,
    modalConfirmMock,
    modalSelectMock,
    showRenameDialogMock,
    modalTagEditorMock,
  ];
  const BINDING_MOCKS = [
    GetRepoRootMock,
    MoveModelFileMock,
    CopyModelFileMock,
    RenameFileMock,
    MoveToRecycleMock,
    LoadAppConfigMock,
    ListVersionInstancesMock,
    InstallModelToMock,
    RevealInExplorerMock,
  ];

  beforeEach(() => {
    [...DIALOG_MOCKS, ...BINDING_MOCKS].forEach((m) => m.mockReset());
  });

  /** 触发菜单并 await 指定 label 的 onClick（异步 handler） */
  async function clickAsync(type, labelText, overrides = {}) {
    const payload = showMenu(type, { ...payloadCtx(type), ...overrides });
    const item = payload.items.find((i) => i.label === labelText);
    expect(item, `找不到菜单项: ${labelText}`).toBeTruthy();
    await item.onClick();
    return item;
  }

  function toasts() {
    return emitted.filter((e) => e.e === "toast:show").map((e) => e.p);
  }
  function reloaded() {
    return emitted.some((e) => e.e === "tree:reload");
  }
  function stubClipboard(impl) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(impl) },
      configurable: true,
    });
  }

  // ── batch.move ──
  it("batch.move 成功 → MoveModelFile 逐个 + toast + 刷新", async () => {
    modalPromptMock.mockResolvedValue("作者A");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);
    await clickAsync("batch", "移动到…", { paths: ["/a.ysm", "/b.ysm"] });
    expect(MoveModelFileMock).toHaveBeenCalledTimes(2);
    expect(MoveModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/作者A");
    expect(toasts().some((t) => t.msg.includes("已移动"))).toBe(true);
    expect(reloaded()).toBe(true);
  });

  it("batch.move 非法文件夹名（含 ..）→ error toast 且不调后端", async () => {
    modalPromptMock.mockResolvedValue("../evil");
    await clickAsync("batch", "移动到…", { paths: ["/a.ysm"] });
    expect(GetRepoRootMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("非法字符"))).toBe(true);
  });

  it("batch.move 未配置存储路径 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者A");
    GetRepoRootMock.mockResolvedValue("");
    await clickAsync("batch", "移动到…", { paths: ["/a.ysm"] });
    expect(MoveModelFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("请先配置存储路径"))).toBe(true);
  });

  it("batch.move 取消输入 → 不执行", async () => {
    modalPromptMock.mockResolvedValue("");
    await clickAsync("batch", "移动到…", { paths: ["/a.ysm"] });
    expect(GetRepoRootMock).not.toHaveBeenCalled();
    expect(MoveModelFileMock).not.toHaveBeenCalled();
  });

  // ── batch.copy ──
  it("batch.copy 部分失败 → 汇总 toast（成功+失败）", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("exists"));
    await clickAsync("batch", "复制到…", { paths: ["/a.ysm", "/b.ysm"] });
    expect(CopyModelFileMock).toHaveBeenCalledTimes(2);
    expect(toasts().some((t) => t.msg.includes("复制成功") && t.msg.includes("失败"))).toBe(true);
  });

  it("batch.copy 取消输入 → 不执行", async () => {
    modalPromptMock.mockResolvedValue("");
    await clickAsync("batch", "复制到…", { paths: ["/a.ysm"] });
    expect(CopyModelFileMock).not.toHaveBeenCalled();
  });

  // ── batch.recycle ──
  it("batch.recycle 确认 → MoveToRecycle 逐个 + 刷新", async () => {
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock.mockResolvedValue(undefined);
    await clickAsync("batch", "移入回收站", { paths: ["/a.ysm", "/b.ysm"], count: 2 });
    expect(MoveToRecycleMock).toHaveBeenCalledTimes(2);
    expect(reloaded()).toBe(true);
  });

  it("batch.recycle 取消 → 不调后端", async () => {
    modalConfirmMock.mockResolvedValue(false);
    await clickAsync("batch", "移入回收站", { paths: ["/a.ysm"] });
    expect(MoveToRecycleMock).not.toHaveBeenCalled();
  });

  // ── batch.copy-paths ──
  it("batch.copy-paths 剪贴板成功 → toast", async () => {
    stubClipboard(() => Promise.resolve());
    await clickAsync("batch", "复制文件路径列表", { paths: ["/a.ysm", "/b.ysm"] });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/a.ysm\n/b.ysm");
    expect(toasts().some((t) => t.msg.includes("已复制"))).toBe(true);
  });

  // ── batch.export-list ──
  it("batch.export-list → 生成 Blob 下载 + toast", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    await clickAsync("batch", "导出文件名清单 (.txt)", { paths: ["/x/a.ysm", "/y/b.ysm"] });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(toasts().some((t) => t.msg.includes("已导出"))).toBe(true);
    vi.unstubAllGlobals();
  });

  // ── file.rename ──
  it("file.rename 成功 → RenameFile + 刷新", async () => {
    showRenameDialogMock.mockResolvedValue("新名字.ysm");
    RenameFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "重命名", { path: "/dir/旧.ysm" });
    expect(showRenameDialogMock).toHaveBeenCalledWith("/dir/旧.ysm", "旧.ysm");
    expect(RenameFileMock).toHaveBeenCalledWith("/dir/旧.ysm", "新名字.ysm");
    expect(reloaded()).toBe(true);
  });

  it("file.rename 取消 → 不调后端", async () => {
    showRenameDialogMock.mockResolvedValue("");
    await clickAsync("file", "重命名", { path: "/dir/旧.ysm" });
    expect(RenameFileMock).not.toHaveBeenCalled();
  });

  it("file.rename 后端报错 → friendlyError toast", async () => {
    showRenameDialogMock.mockResolvedValue("新.ysm");
    RenameFileMock.mockRejectedValue(new Error("EACCES: permission denied"));
    await clickAsync("file", "重命名", { path: "/dir/旧.ysm" });
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("权限不足"))).toBe(true);
  });

  // ── file.move ──
  it("file.move 成功 → MoveModelFile + toast + 刷新", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "移动到…", { path: "/a.ysm" });
    expect(MoveModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/作者B");
    expect(toasts().some((t) => t.msg.includes("已移动到 作者B"))).toBe(true);
    expect(reloaded()).toBe(true);
  });

  it("file.move 未配置存储路径 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("");
    await clickAsync("file", "移动到…", { path: "/a.ysm" });
    expect(MoveModelFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  // ── file.copy ──
  it("file.copy 成功 → CopyModelFile + toast", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "复制到…", { path: "/a.ysm" });
    expect(CopyModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/备份");
    expect(toasts().some((t) => t.msg.includes("已复制"))).toBe(true);
  });

  it("file.copy 非法文件夹名 → error toast 且不调后端", async () => {
    modalPromptMock.mockResolvedValue("/abs");
    await clickAsync("file", "复制到…", { path: "/a.ysm" });
    expect(GetRepoRootMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  // ── file.push-to-pack ──
  it("file.push-to-pack 未配置游戏目录 → warn toast", async () => {
    LoadAppConfigMock.mockResolvedValue({ mcRoot: "" });
    await clickAsync("file", "推送到整合包…", { path: "/a.ysm" });
    expect(toasts().some((t) => t.type === "warn" && t.msg.includes("请先配置游戏目录"))).toBe(true);
  });

  it("file.push-to-pack 无整合包 → warn toast", async () => {
    LoadAppConfigMock.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstancesMock.mockResolvedValue([]);
    await clickAsync("file", "推送到整合包…", { path: "/a.ysm" });
    expect(toasts().some((t) => t.type === "warn" && t.msg.includes("未找到任何整合包"))).toBe(true);
  });

  it("file.push-to-pack 成功 → InstallModelTo + toast", async () => {
    LoadAppConfigMock.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstancesMock.mockResolvedValue([
      { Name: "包A", CustomDir: "/mc/versions/包A" },
    ]);
    modalSelectMock.mockResolvedValue("包A");
    InstallModelToMock.mockResolvedValue(undefined);
    await clickAsync("file", "推送到整合包…", { path: "/dir/a.ysm" });
    expect(InstallModelToMock).toHaveBeenCalledWith("a.ysm", "/mc/versions/包A");
    expect(toasts().some((t) => t.msg.includes("已推送"))).toBe(true);
  });

  // ── file.edit-tags ──
  it("file.edit-tags 保存 → toast 显示标签数", async () => {
    modalTagEditorMock.mockResolvedValue(["tag1", "tag2"]);
    await clickAsync("file", "🏷️ 编辑标签", { path: "/a.ysm" });
    expect(modalTagEditorMock).toHaveBeenCalledWith("/a.ysm");
    expect(toasts().some((t) => t.msg.includes("已保存 2 个标签"))).toBe(true);
  });

  // ── file.recycle ──
  it("file.recycle 确认 → MoveToRecycle + 刷新", async () => {
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock.mockResolvedValue(undefined);
    await clickAsync("file", "移入回收站", { path: "/a.ysm" });
    expect(MoveToRecycleMock).toHaveBeenCalledWith("/a.ysm");
    expect(reloaded()).toBe(true);
  });

  it("file.recycle 取消 → 不调后端", async () => {
    modalConfirmMock.mockResolvedValue(false);
    await clickAsync("file", "移入回收站", { path: "/a.ysm" });
    expect(MoveToRecycleMock).not.toHaveBeenCalled();
  });

  // ── file.reveal ──
  it("file.reveal 成功 → RevealInExplorer", async () => {
    RevealInExplorerMock.mockResolvedValue(undefined);
    await clickAsync("file", "打开文件位置", { path: "/a.ysm" });
    expect(RevealInExplorerMock).toHaveBeenCalledWith("/a.ysm");
  });

  it("file.reveal 后端报错 → friendlyError toast", async () => {
    RevealInExplorerMock.mockRejectedValue(new Error("ENOENT: no such file"));
    await clickAsync("file", "打开文件位置", { path: "/a.ysm" });
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("文件或目录不存在"))).toBe(true);
  });

  // ── file.copy-path ──
  it("file.copy-path 剪贴板成功 → toast", async () => {
    stubClipboard(() => Promise.resolve());
    await clickAsync("file", "复制文件路径", { path: "/a.ysm" });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/a.ysm");
    expect(toasts().some((t) => t.msg.includes("路径已复制"))).toBe(true);
  });
});
