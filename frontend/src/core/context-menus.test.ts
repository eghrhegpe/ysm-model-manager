// ===== context-menus 映射测试（ADR-021 A 层）=====
// 触发 ctx:show → 断言 menu:show 载荷与 menu-defs.ts 声明一致；
// 点击 item → 断言 handler 发出正确的 bus 事件 / getApp 调用。
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { bus } from "../bus.ts";
import type { MenuItem, CtxShowPayload, ToastPayload } from "../bus";
import { registerContextMenus } from "./context-menus.ts";
import { MENU_DEFS, getMenuDef } from "./menu-defs.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";

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

vi.mock("../utils/dom/dialogs/modal.ts", () => ({
  modalPrompt: modalPromptMock,
  modalConfirm: modalConfirmMock,
  modalSelect: modalSelectMock,
}));
vi.mock("../utils/dom/dialogs/rename.ts", () => ({ showRenameDialog: showRenameDialogMock }));
vi.mock("../utils/dom/dialogs/tag-editor.ts", () => ({ modalTagEditor: modalTagEditorMock }));
// handler 统一走 getApp()（ADR-012）：mock getApp 返回 bindings mock 对象
vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    OpenInstanceFolder: openFolderMock,
    GetRepoRoot: GetRepoRootMock,
    MoveModelFile: MoveModelFileMock,
    CopyModelFile: CopyModelFileMock,
    RenameFile: RenameFileMock,
    MoveToRecycle: MoveToRecycleMock,
    LoadAppConfig: LoadAppConfigMock,
    ListVersionInstances: ListVersionInstancesMock,
    InstallModelTo: InstallModelToMock,
    RevealInExplorer: RevealInExplorerMock,
  }),
}));
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
const menuShows: Array<{ x: number; y: number; items: MenuItem[] }> = [];
const emitted: Array<{ e: string; p: unknown }> = [];
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
] as const;

const menuUnsubs: Array<() => void> = [];

beforeAll(() => {
  bus.on("menu:show", (p) => menuShows.push(p));
  TRACKED.forEach((e) => bus.on(e, (p) => emitted.push({ e, p })));
  registerContextMenus(menuUnsubs);
});

afterAll(() => {
  menuUnsubs.forEach((fn) => fn());
});

beforeEach(() => {
  menuShows.length = 0;
  emitted.length = 0;
  openFolderMock.mockClear();
});

/** 触发一次 ctx:show，返回对应的 menu:show 载荷 */
function showMenu(type: CtxShowPayload["type"], overrides: Partial<CtxShowPayload> = {}) {
  bus.emit("ctx:show", { x: 10, y: 20, type, paths: ["/a.ysm"], ...overrides });
  expect(menuShows).toHaveLength(1);
  return menuShows[0];
}

/** 断言 items 载荷与声明逐条一致（结构 + label 求值） */
function expectItemsMatchDef(
  payload: { x: number; y: number; items: MenuItem[] },
  type: CtxShowPayload["type"],
) {
  const def = getMenuDef(type);
  expect(def).toBeTruthy();
  if (!def) throw new Error(`missing menu def: ${type}`);
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
function payloadCtx(type: CtxShowPayload["type"]): CtxShowPayload {
  const base: CtxShowPayload = { x: 10, y: 20, type, paths: ["/a.ysm"] };
  if (type === "instance") return { ...base, instanceName: "测试整合包", rtype: RESOURCE_TYPES.YSM };
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
  /** 取某类菜单中 action 匹配的 item，触发 onClick */
  function clickItem(
    type: CtxShowPayload["type"],
    action: string,
    overrides: Partial<CtxShowPayload> = {},
  ): MenuItem {
    const payload = showMenu(type, { ...payloadCtx(type), ...overrides });
    const item = payload.items.find((i) => i.action === action);
    expect(item, `找不到菜单项: ${action}`).toBeTruthy();
    item!.onClick!();
    return item!;
  }

  it("instance 复制模型清单 → instance:export-list", () => {
    clickItem("instance", "instance.export-list");
    expect(emitted).toContainEqual({
      e: "instance:export-list",
      p: { name: "测试整合包", rtype: RESOURCE_TYPES.YSM },
    });
  });

  it("instance 清空模型（danger）→ instance:clear", () => {
    const item = clickItem("instance", "instance.clear");
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({
      e: "instance:clear",
      p: { name: "测试整合包", rtype: RESOURCE_TYPES.YSM },
    });
  });

  it("instance 打开文件夹 → getApp().OpenInstanceFolder", async () => {
    const payload = showMenu("instance", { ...payloadCtx("instance"), path: "/packs/x" });
    const item = payload.items.find((i) => i.label === "打开文件夹");
    item!.onClick!();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    expect(openFolderMock).toHaveBeenCalledWith("/packs/x", RESOURCE_TYPES.YSM);
  });

  it("batch 批量重命名 → batch:rename（paths 透传）", () => {
    clickItem("batch", "batch.rename", { paths: ["/a.ysm", "/b.ysm"] });
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
    clickItem("dir", "dir.mkdir", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:mkdir", p: { dir: "/packs/x" } });
  });

  it("dir 移入回收站（danger）→ dir:recycle", () => {
    const item = clickItem("dir", "batch.recycle", { dir: "/packs/x" });
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

  /** 触发菜单并 await 指定 action 的 onClick（异步 handler） */
  async function clickAsync(
    type: CtxShowPayload["type"],
    action: string,
    overrides: Partial<CtxShowPayload> = {},
  ): Promise<MenuItem> {
    const payload = showMenu(type, { ...payloadCtx(type), ...overrides });
    const item = payload.items.find((i) => i.action === action);
    expect(item, `找不到菜单项: ${action}`).toBeTruthy();
    await item!.onClick!();
    return item!;
  }

  function toasts(): ToastPayload[] {
    return emitted
      .filter((e) => e.e === "toast:show")
      .map((e) => e.p as ToastPayload);
  }
  function reloaded() {
    return emitted.some((e) => e.e === "tree:reload");
  }
  function stubClipboard(impl: () => Promise<void>) {
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
    await clickAsync("batch", "batch.move", { paths: ["/a.ysm", "/b.ysm"] });
    expect(MoveModelFileMock).toHaveBeenCalledTimes(2);
    expect(MoveModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/作者A");
    expect(toasts().some((t) => t.msg.includes("已移动"))).toBe(true);
    expect(reloaded()).toBe(true);
  });

  it("batch.move 非法文件夹名（含 ..）→ error toast 且不调后端", async () => {
    modalPromptMock.mockResolvedValue("../evil");
    await clickAsync("batch", "batch.move", { paths: ["/a.ysm"] });
    expect(GetRepoRootMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("非法字符"))).toBe(true);
  });

  it("batch.move 未配置存储路径 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者A");
    GetRepoRootMock.mockResolvedValue("");
    await clickAsync("batch", "batch.move", { paths: ["/a.ysm"] });
    expect(MoveModelFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("请先配置存储路径"))).toBe(true);
  });

  it("batch.move 取消输入 → 不执行", async () => {
    modalPromptMock.mockResolvedValue("");
    await clickAsync("batch", "batch.move", { paths: ["/a.ysm"] });
    expect(GetRepoRootMock).not.toHaveBeenCalled();
    expect(MoveModelFileMock).not.toHaveBeenCalled();
  });

  // ── batch.copy ──
  it("batch.copy 部分失败 → 汇总 toast（成功+失败）", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("exists"));
    await clickAsync("batch", "batch.copy", { paths: ["/a.ysm", "/b.ysm"] });
    expect(CopyModelFileMock).toHaveBeenCalledTimes(2);
    expect(toasts().some((t) => t.msg.includes("复制成功") && t.msg.includes("失败"))).toBe(true);
  });

  it("batch.copy 取消输入 → 不执行", async () => {
    modalPromptMock.mockResolvedValue("");
    await clickAsync("batch", "batch.copy", { paths: ["/a.ysm"] });
    expect(CopyModelFileMock).not.toHaveBeenCalled();
  });

  // ── batch.recycle ──
  it("batch.recycle 确认 → MoveToRecycle 逐个 + 刷新", async () => {
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock.mockResolvedValue(undefined);
    await clickAsync("batch", "batch.recycle", { paths: ["/a.ysm", "/b.ysm"], count: 2 });
    expect(MoveToRecycleMock).toHaveBeenCalledTimes(2);
    expect(reloaded()).toBe(true);
  });

  it("batch.recycle 取消 → 不调后端", async () => {
    modalConfirmMock.mockResolvedValue(false);
    await clickAsync("batch", "batch.recycle", { paths: ["/a.ysm"] });
    expect(MoveToRecycleMock).not.toHaveBeenCalled();
  });

  // ── batch.copy-paths ──
  it("batch.copy-paths 剪贴板成功 → toast", async () => {
    stubClipboard(() => Promise.resolve());
    await clickAsync("batch", "batch.copy-paths", { paths: ["/a.ysm", "/b.ysm"] });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/a.ysm\n/b.ysm");
    expect(toasts().some((t) => t.msg.includes("已复制"))).toBe(true);
  });

  // ── batch.export-list ──
  it("batch.export-list → 生成 Blob 下载 + toast", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    await clickAsync("batch", "batch.export-list", { paths: ["/x/a.ysm", "/y/b.ysm"] });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(toasts().some((t) => t.msg.includes("已导出"))).toBe(true);
    vi.unstubAllGlobals();
  });

  // ── file.rename ──
  it("file.rename 成功 → RenameFile + 刷新", async () => {
    showRenameDialogMock.mockResolvedValue("新名字.ysm");
    RenameFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "重命名…", { path: "/dir/旧.ysm" });
    expect(showRenameDialogMock).toHaveBeenCalledWith("/dir/旧.ysm", "旧.ysm");
    expect(RenameFileMock).toHaveBeenCalledWith("/dir/旧.ysm", "新名字.ysm");
    expect(reloaded()).toBe(true);
  });

  it("file.rename 取消 → 不调后端", async () => {
    showRenameDialogMock.mockResolvedValue("");
    await clickAsync("file", "重命名…", { path: "/dir/旧.ysm" });
    expect(RenameFileMock).not.toHaveBeenCalled();
  });

  it("file.rename 后端报错 → friendlyError toast", async () => {
    showRenameDialogMock.mockResolvedValue("新.ysm");
    RenameFileMock.mockRejectedValue(new Error("EACCES: permission denied"));
    await clickAsync("file", "重命名…", { path: "/dir/旧.ysm" });
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("权限不足"))).toBe(true);
  });

  // ── file.move ──
  it("file.move 成功 → MoveModelFile + toast + 刷新", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "batch.move", { path: "/a.ysm" });
    expect(MoveModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/作者B");
    expect(toasts().some((t) => t.msg.includes("已移动到 作者B"))).toBe(true);
    expect(reloaded()).toBe(true);
  });

  it("file.move 未配置存储路径 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("");
    await clickAsync("file", "batch.move", { path: "/a.ysm" });
    expect(MoveModelFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  // ── file.copy ──
  it("file.copy 成功 → CopyModelFile + toast", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "batch.copy", { path: "/a.ysm" });
    expect(CopyModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/备份");
    expect(toasts().some((t) => t.msg.includes("已复制"))).toBe(true);
  });

  it("file.copy 非法文件夹名 → error toast 且不调后端", async () => {
    modalPromptMock.mockResolvedValue("/abs");
    await clickAsync("file", "batch.copy", { path: "/a.ysm" });
    expect(GetRepoRootMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  // ── ADR-038 D3：ysm.json 重命名护栏 + 文件夹整组操作 ──
  it("file.rename 对 ysm.json → warn toast 且不调 RenameFile", async () => {
    await clickAsync("file", "重命名…", { path: "/models/模型A/ysm.json" });
    expect(showRenameDialogMock).not.toHaveBeenCalled();
    expect(RenameFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "warn" && t.msg.includes("ysm.json"))).toBe(true);
  });

  it("dir.move 成功 → MoveModelFile(目录路径) + toast + 刷新", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);
    await clickAsync("dir", "batch.move", { dir: "/repo/models/模型A" });
    expect(MoveModelFileMock).toHaveBeenCalledWith("/repo/models/模型A", "/repo/models/作者B");
    expect(toasts().some((t) => t.msg.includes("已移动文件夹到 作者B"))).toBe(true);
    expect(reloaded()).toBe(true);
  });

  it("dir.move 未配置存储路径 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("");
    await clickAsync("dir", "batch.move", { dir: "/repo/models/模型A" });
    expect(MoveModelFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  it("dir.copy 成功 → CopyModelFile(目录路径) + toast", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValue(undefined);
    await clickAsync("dir", "batch.copy", { dir: "/repo/models/模型A" });
    expect(CopyModelFileMock).toHaveBeenCalledWith("/repo/models/模型A", "/repo/models/备份");
    expect(toasts().some((t) => t.msg.includes("已复制文件夹到 备份"))).toBe(true);
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
    // P2 修复：InstallModelTo → installer.Install 按仓库内绝对路径校验（IsInside），
    // 必须传完整路径而非 basename，否则「源文件不在仓库目录内」
    expect(InstallModelToMock).toHaveBeenCalledWith("/dir/a.ysm", "/mc/versions/包A");
    expect(toasts().some((t) => t.msg.includes("已推送"))).toBe(true);
  });

  // ── file.edit-tags ──
  it("file.edit-tags 保存 → toast 显示标签数", async () => {
    modalTagEditorMock.mockResolvedValue(["tag1", "tag2"]);
    await clickAsync("file", "编辑标签", { path: "/a.ysm" });
    expect(modalTagEditorMock).toHaveBeenCalledWith("/a.ysm");
    expect(toasts().some((t) => t.msg.includes("已保存 2 个标签"))).toBe(true);
  });

  // ── file.recycle ──
  it("file.recycle 确认 → MoveToRecycle + 刷新", async () => {
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock.mockResolvedValue(undefined);
    await clickAsync("file", "batch.recycle", { path: "/a.ysm" });
    expect(MoveToRecycleMock).toHaveBeenCalledWith("/a.ysm");
    expect(reloaded()).toBe(true);
  });

  it("file.recycle 取消 → 不调后端", async () => {
    modalConfirmMock.mockResolvedValue(false);
    await clickAsync("file", "batch.recycle", { path: "/a.ysm" });
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

describe("失败路径补强（batch.move 部分失败 / getApp reject 兜底）", () => {
  beforeEach(() => {
    modalPromptMock.mockReset();
    GetRepoRootMock.mockReset();
    MoveModelFileMock.mockReset();
  });

  function clickMove(paths: string[]) {
    const payload = showMenu("batch", { ...payloadCtx("batch"), paths, count: paths.length });
    const item = payload.items.find((i) => i.label === "batch.move");
    expect(item).toBeTruthy();
    return item!.onClick!();
  }
  function allToasts(): string[] {
    return emitted
      .filter((e) => e.e === "toast:show")
      .map((e) => (e.p as ToastPayload).msg);
  }

  it("batch.move 部分失败 → toast 同时报告成功与失败数", async () => {
    modalPromptMock.mockResolvedValue("作者A");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("EACCES"));
    await clickMove(["/a.ysm", "/b.ysm"]);
    expect(MoveModelFileMock).toHaveBeenCalledTimes(2);
    expect(allToasts().some((m) => m.includes("1 个已移动") && m.includes("1 失败"))).toBe(true);
  });

  it("batch.move 全部失败 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者A");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockRejectedValue(new Error("EACCES"));
    await clickMove(["/a.ysm"]);
    expect(allToasts().some((m) => m.includes("❌ 移动失败"))).toBe(true);
  });

  it("batch.move getApp 拒绝 → error toast 且 handler 不抛（P2 兜底）", async () => {
    modalPromptMock.mockResolvedValue("作者A");
    const { getApp } = await import("../wails/app.ts");
    vi.mocked(getApp).mockRejectedValueOnce(new Error("boom"));
    await clickMove(["/a.ysm"]);
    expect(allToasts().some((m) => m.includes("❌"))).toBe(true);
  });
});
