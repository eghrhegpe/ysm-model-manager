// @vitest-environment node
// ===== context-menus 映射测试（ADR-021 A 层）=====
// 触发 ctx:show → 断言 menu:show 载荷与 menu-defs.ts 声明一致；
// 点击 item → 断言 handler 发出正确的 bus 事件 / getApp 调用。
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import type { MenuItem, CtxShowPayload, ToastPayload } from "../bus";
import { registerContextMenus } from "./context-menus.ts";
import { MENU_DEFS, getMenuDef } from "./menu-defs.ts";
import { HANDLERS } from "./context-menu-handlers.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";

// getApp 是动态 import（backend/app.ts），测试用 mock 替代
// P4（审核发现）：此处曾被重复声明两次——第一个 vi.mock 被下方完整 mock（含全部
// bindings）覆盖为死代码；若误删下方完整 mock 所有异步 handler 测试静默失效，故删除冗余
const { openFolderMock } = vi.hoisted(() => ({
  openFolderMock: vi.fn(),
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
  isViewerModeMock,
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
  // P4（审核）：mock 查看器模式判定——默认桌面（false），查看器过滤用例 mockReturnValue(true)
  isViewerModeMock: vi.fn(() => false),
}));

vi.mock("../utils/dom/dialogs/modal.ts", () => ({
  modalPrompt: modalPromptMock,
  modalConfirm: modalConfirmMock,
  modalSelect: modalSelectMock,
}));
vi.mock("../utils/dom/dialogs/rename.ts", () => ({ showRenameDialog: showRenameDialogMock }));
vi.mock("../utils/dom/dialogs/tag-editor.ts", () => ({ modalTagEditor: modalTagEditorMock }));
// handler 统一走 getApp()（ADR-012）：mock getApp 返回 bindings mock 对象
vi.mock("../backend/app.ts", () => ({
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
// P4（审核）：mock 查看器模式（android-bridge）——context-menus.ts 的 viewer-mode
// 过滤分支此前零覆盖；默认 false 保持既有桌面用例行为不变
vi.mock("../utils/dom/android-bridge.ts", () => ({
  isViewerMode: isViewerModeMock,
}));

// can() / canWebAction() 能力探测 mock（viewer-mode 守卫依赖；P3 收敛后
// canWebAction = 纯前端恒可达 + binding 走 can() 探测，mock 同步该语义）
const { canMock } = vi.hoisted(() => ({ canMock: vi.fn((_action: string) => false) }));
vi.mock("../utils/dom/capabilities.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/dom/capabilities.ts")>();
  return {
    ...actual,
    can: canMock,
    canWebAction: (action: string) =>
      actual.VIEWER_PURE_ACTIONS.has(action) || canMock(action),
  };
});

// 收集 menu:show 与 handler 发出的业务事件
const menuShows: Array<{ x: number; y: number; items: MenuItem[] }> = [];
const emitted: Array<{ e: string; p: unknown }> = [];

// P5（2026-08-17）：--environment node 下 globalThis.document 不存在，
// context-menu-handlers.ts:161 的 textarea fallback（copy-paths catch 分支）
// 和 :191 的 anchor 下载（export-list）需 document.createElement。
// 此处 mock 覆盖两个 DOM 路径；happy-dom 环境下 vi.stubGlobal 会叠加到已有 document 之上，
// createElement 被替换不影响其他测试（其余测试不触发这两个 DOM 路径）。
const createElementMock = vi.fn((tag: string) => {
  if (tag === "textarea") {
    return {
      value: "",
      style: { position: "", opacity: "" },
      select: vi.fn(),
    };
  }
  if (tag === "a") {
    return { download: "", href: "", click: vi.fn() };
  }
  return {};
});
const documentMock = {
  createElement: createElementMock,
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
  execCommand: vi.fn(() => false),
};
// 2026-08-17 修复：document stub 从模块顶层移入 beforeEach——isolate:false 审核模式下
// 其他文件的 afterEach unstubAllGlobals 会清掉本文件顶层 stub（且 export-list 测试自身
// unstubAllGlobals 也清 document），导致后续 copy-paths 测试 document is not defined。
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
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // 2026-08-17：document stub 每次测试前重建（防跨文件 unstub 污染——见顶层注释）
  vi.stubGlobal("document", documentMock);
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

  it("MENU_DEFS 全部 action 均注册 handler（零失配警告）", async () => {
    // ADR-021 B 层：菜单即数据；测试应断言零警告——防新增菜单项忘挂 HANDLERS
    // 2026-XX 升级：除 spy 之外，直接 import HANDLERS 与声明表对账（更稳定，不依赖 warn）
    const { HANDLERS } = await import("./context-menu-handlers.ts");
    const declared = new Set<string>();
    for (const def of MENU_DEFS) {
      for (const it of def.items) {
        if (it.action) declared.add(it.action);
      }
    }
    const registered = new Set(Object.keys(HANDLERS));
    const missing = [...declared].filter((a) => !registered.has(a));
    expect(missing, `menu-defs.ts 声明但未挂 handler 的 action: ${missing.join(", ")}`).toEqual([]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      MENU_DEFS.forEach((def) => {
        menuShows.length = 0; // showMenu 断言每次触发恰好 1 条 menu:show
        const payload = showMenu(def.type, payloadCtx(def.type));
        expect(payload.items).toHaveLength(def.items.length);
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("查看器模式 → 仅保留纯前端动作（file 菜单只留 copy-path）", () => {
    isViewerModeMock.mockReturnValue(true);
    try {
      const payload = showMenu("file", payloadCtx("file"));
      const actions = payload.items.filter((i) => i.action).map((i) => i.action);
      expect(actions).toEqual(["file.copy-path"]);
    } finally {
      isViewerModeMock.mockReturnValue(false);
    }
  });

  it("查看器模式 → batch 菜单剔除调 Wails binding 的动作", () => {
    isViewerModeMock.mockReturnValue(true);
    try {
      const payload = showMenu("batch", payloadCtx("batch"));
      const actions = payload.items.filter((i) => i.action).map((i) => i.action);
      expect(actions).toEqual(["noop", "batch.copy-paths", "batch.export-list"]);
    } finally {
      isViewerModeMock.mockReturnValue(false);
    }
  });

  it("查看器模式 → web 已实现 binding 的移动/复制放行（can 探测 true，P0 翻案）", () => {
    isViewerModeMock.mockReturnValue(true);
    canMock.mockReturnValue(true);
    try {
      // file 菜单：file.move/file.copy（MoveModelFile/CopyModelFile binding 已实现）出现
      const filePayload = showMenu("file", payloadCtx("file"));
      const fileActions = filePayload.items.filter((i) => i.action).map((i) => i.action);
      expect(fileActions).toEqual(
        expect.arrayContaining([
          "file.move",
          "file.copy",
          "file.rename",
          "file.edit-tags",
          "file.copy-path",
        ]),
      );
      // batch 菜单：batch.move/batch.copy（runBatchFileOp 走同一 binding）出现
      menuShows.length = 0; // showMenu 断言每次恰好 1 条 menu:show，触发前清空
      const batchPayload = showMenu("batch", payloadCtx("batch"));
      const batchActions = batchPayload.items.filter((i) => i.action).map((i) => i.action);
      expect(batchActions).toEqual(
        expect.arrayContaining(["batch.move", "batch.copy", "noop", "batch.copy-paths", "batch.export-list"]),
      );
    } finally {
      canMock.mockReturnValue(false);
      isViewerModeMock.mockReturnValue(false);
    }
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
    const item = payload.items.find((i) => i.action === "instance.open-folder");
    item!.onClick!();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    // 阶段 1：subdir 透传（MMD 用途子目录；无则 ""）
    expect(openFolderMock).toHaveBeenCalledWith("/packs/x", RESOURCE_TYPES.YSM, "");
  });

  it("instance 打开文件夹 带 subdir → 透传到后端", async () => {
    const payload = showMenu("instance", {
      ...payloadCtx("instance"),
      path: "/packs/x",
      subdir: "SceneModel",
    });
    const item = payload.items.find((i) => i.action === "instance.open-folder");
    item!.onClick!();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    expect(openFolderMock).toHaveBeenCalledWith("/packs/x", RESOURCE_TYPES.YSM, "SceneModel");
  });

  it("batch 批量重命名 → batch:rename（paths 透传）", () => {
    clickItem("batch", "batch.rename", { paths: ["/a.ysm", "/b.ysm"] });
    expect(emitted).toContainEqual({
      e: "batch:rename",
      p: { paths: ["/a.ysm", "/b.ysm"] },
    });
  });

  it("dir 重命名 → dir:rename（dir 透传）", () => {
    clickItem("dir", "dir.rename", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:rename", p: { dir: "/packs/x" } });
  });

  it("dir 新建子文件夹 → dir:mkdir", () => {
    clickItem("dir", "dir.mkdir", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:mkdir", p: { dir: "/packs/x" } });
  });

  it("dir 移入回收站（danger）→ dir:recycle", () => {
    const item = clickItem("dir", "dir.recycle", { dir: "/packs/x" });
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({ e: "dir:recycle", p: { dir: "/packs/x" } });
  });

  it("dir 批量重命名 → dir:batch-rename", () => {
    clickItem("dir", "dir.batch-rename", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:batch-rename", p: { dir: "/packs/x" } });
  });

  it("instance 打开文件夹 无 path → error toast 且不调后端", () => {
    clickItem("instance", "instance.open-folder");
    expect(openFolderMock).not.toHaveBeenCalled();
    expect(
      emitted.some(
        (e) =>
          e.e === "toast:show" &&
          (e.p as ToastPayload).type === "error" &&
          (e.p as ToastPayload).msg.includes("整合包目录未找到"),
      ),
    ).toBe(true);
  });

  // P0 修复：多类型 rtype 菜单行为测试——防 fallback 到 YSM
  it("instance MMD 打开文件夹 → 透传 EntityPlayer rtype", async () => {
    const payload = showMenu("instance", {
      ...payloadCtx("instance"),
      rtype: RESOURCE_TYPES.MMD,
      path: "/packs/mmd-pack",
    });
    const item = payload.items.find((i) => i.action === "instance.open-folder");
    item!.onClick!();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    expect(openFolderMock).toHaveBeenCalledWith("/packs/mmd-pack", RESOURCE_TYPES.MMD, "");
  });

  it("instance 复制模型清单 → 透传 rtype", () => {
    clickItem("instance", "instance.export-list", {
      rtype: "EntityPlayer",
    });
    expect(emitted).toContainEqual({
      e: "instance:export-list",
      p: { name: "测试整合包", rtype: "EntityPlayer" },
    });
  });

  it("instance 清空模型 → 透传 rtype（非 YSM）", () => {
    clickItem("instance", "instance.clear", {
      rtype: "resourcepack",
    });
    expect(emitted).toContainEqual({
      e: "instance:clear",
      p: { name: "测试整合包", rtype: "resourcepack" },
    });
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

  // ── per-verb busy 守卫（P3 审核补测：全局单 flag → 按 verb 独立闭包，锁新契约）──
  it("batch.move 同 verb 连点 → 第二次只发「操作进行中」toast，MoveModelFile 只调一次", async () => {
    let resolvePrompt!: (v: string) => void;
    modalPromptMock.mockReturnValue(new Promise<string>((res) => (resolvePrompt = res)));
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);

    const payload = showMenu("batch", { ...payloadCtx("batch"), paths: ["/a.ysm"] });
    const item = payload.items.find((i) => i.action === "batch.move")!;
    const first = item.onClick!(); // 挂起在 resolveDstDir（modalPrompt pending）
    const second = item.onClick!(); // 同 verb 重入 → tryStart false
    await second;
    expect(toasts().some((t) => t.msg.includes("操作进行中"))).toBe(true);
    expect(MoveModelFileMock).not.toHaveBeenCalled();

    resolvePrompt("作者A");
    await first;
    expect(MoveModelFileMock).toHaveBeenCalledTimes(1);
  });

  it("batch.move 与 batch.copy 并发 → 互不发 busy toast（per-verb 独立）", async () => {
    let resolveMove!: (v: string) => void;
    let resolveCopy!: (v: string) => void;
    modalPromptMock
      .mockReturnValueOnce(new Promise<string>((r) => (resolveMove = r)))
      .mockReturnValueOnce(new Promise<string>((r) => (resolveCopy = r)));
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);
    CopyModelFileMock.mockResolvedValue(undefined);

    const payload = showMenu("batch", { ...payloadCtx("batch"), paths: ["/a.ysm"] });
    const moveItem = payload.items.find((i) => i.action === "batch.move")!;
    const copyItem = payload.items.find((i) => i.action === "batch.copy")!;
    const moveP = moveItem.onClick!(); // move 挂起
    const copyP = copyItem.onClick!(); // copy 挂起（不同 verb，不被 move 阻塞）
    await Promise.resolve();
    expect(toasts().some((t) => t.msg.includes("操作进行中"))).toBe(false);

    resolveMove("作者A");
    resolveCopy("备份");
    await Promise.all([moveP, copyP]);
    expect(MoveModelFileMock).toHaveBeenCalledTimes(1);
    expect(CopyModelFileMock).toHaveBeenCalledTimes(1);
  });

  it("batch.move 取消对话框 → finish() 复位 flag，同 verb 可立即重试", async () => {
    modalPromptMock.mockResolvedValueOnce(""); // 取消（空输入）→ finally finish()
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);

    const payload = showMenu("batch", { ...payloadCtx("batch"), paths: ["/a.ysm"] });
    const item = payload.items.find((i) => i.action === "batch.move")!;
    await item.onClick!();
    expect(MoveModelFileMock).not.toHaveBeenCalled();

    // 同 verb 立即重试 → 不再被 busy 拒绝
    modalPromptMock.mockResolvedValueOnce("作者A");
    await item.onClick!();
    expect(MoveModelFileMock).toHaveBeenCalledTimes(1);
  });

  // ── batch.copy ──
  it("batch.copy 部分失败 → 汇总 toast（成功+失败）", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("exists"));
    await clickAsync("batch", "batch.copy", { paths: ["/a.ysm", "/b.ysm"] });
    expect(CopyModelFileMock).toHaveBeenCalledTimes(2);
    expect(toasts().some((t) => t.msg.includes("已复制") && t.msg.includes("失败"))).toBe(true);
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

  it("batch.recycle 部分失败 → error toast 报告失败数", async () => {
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("EACCES"));
    await clickAsync("batch", "batch.recycle", { paths: ["/a.ysm", "/b.ysm"], count: 2 });
    expect(MoveToRecycleMock).toHaveBeenCalledTimes(2);
    expect(
      toasts().some((t) => t.type === "error" && t.msg.includes("1 个文件移入回收站失败")),
    ).toBe(true);
  });

  // ── batch.copy-paths ──
  it("batch.copy-paths 剪贴板成功 → toast", async () => {
    stubClipboard(() => Promise.resolve());
    await clickAsync("batch", "batch.copy-paths", { paths: ["/a.ysm", "/b.ysm"] });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/a.ysm\n/b.ysm");
    expect(toasts().some((t) => t.msg.includes("已复制"))).toBe(true);
  });

  it("batch.copy-paths 剪贴板被拒 → 兜底失败 toast（不抛）", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    await clickAsync("batch", "batch.copy-paths", { paths: ["/a.ysm"] });
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("复制失败"))).toBe(true);
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
    await clickAsync("file", "file.rename", { path: "/dir/旧.ysm" });
    expect(showRenameDialogMock).toHaveBeenCalledWith("/dir/旧.ysm", "旧.ysm");
    expect(RenameFileMock).toHaveBeenCalledWith("/dir/旧.ysm", "新名字.ysm");
    expect(reloaded()).toBe(true);
  });

  it("file.rename 取消 → 不调后端", async () => {
    showRenameDialogMock.mockResolvedValue("");
    await clickAsync("file", "file.rename", { path: "/dir/旧.ysm" });
    expect(RenameFileMock).not.toHaveBeenCalled();
  });

  it("file.rename 后端报错 → friendlyError toast", async () => {
    showRenameDialogMock.mockResolvedValue("新.ysm");
    RenameFileMock.mockRejectedValue(new Error("EACCES: permission denied"));
    await clickAsync("file", "file.rename", { path: "/dir/旧.ysm" });
    // ADR-051：裸 JS Error 无 AppError.Code → 走 fallback（不再按文本映射"权限不足"）
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("重命名失败"))).toBe(true);
  });

  // ── file.move ──
  it("file.move 成功 → MoveModelFile + toast + 刷新", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "file.move", { path: "/a.ysm" });
    expect(MoveModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/作者B");
    expect(toasts().some((t) => t.msg.includes("已移动到 作者B"))).toBe(true);
    expect(reloaded()).toBe(true);
  });

  it("file.move 未配置存储路径 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("");
    await clickAsync("file", "file.move", { path: "/a.ysm" });
    expect(MoveModelFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  // ── file.copy ──
  it("file.copy 成功 → CopyModelFile + toast", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValue(undefined);
    await clickAsync("file", "file.copy", { path: "/a.ysm" });
    expect(CopyModelFileMock).toHaveBeenCalledWith("/a.ysm", "/repo/models/备份");
    expect(toasts().some((t) => t.msg.includes("已复制"))).toBe(true);
  });

  it("file.copy 非法文件夹名 → error toast 且不调后端", async () => {
    modalPromptMock.mockResolvedValue("/abs");
    await clickAsync("file", "file.copy", { path: "/a.ysm" });
    expect(GetRepoRootMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  // ── ADR-038 D3：ysm.json 重命名护栏 + 文件夹整组操作 ──
  it("file.rename 对 ysm.json → warn toast 且不调 RenameFile", async () => {
    await clickAsync("file", "file.rename", { path: "/models/模型A/ysm.json" });
    expect(showRenameDialogMock).not.toHaveBeenCalled();
    expect(RenameFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "warn" && t.msg.includes("ysm.json"))).toBe(true);
  });

  it("dir.move 成功 → MoveModelFile(目录路径) + toast + 刷新", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    MoveModelFileMock.mockResolvedValue(undefined);
    await clickAsync("dir", "dir.move", { dir: "/repo/models/模型A" });
    expect(MoveModelFileMock).toHaveBeenCalledWith("/repo/models/模型A", "/repo/models/作者B");
    expect(toasts().some((t) => t.msg.includes("已移动文件夹到 作者B"))).toBe(true);
    expect(reloaded()).toBe(true);
  });

  it("dir.move 未配置存储路径 → error toast", async () => {
    modalPromptMock.mockResolvedValue("作者B");
    GetRepoRootMock.mockResolvedValue("");
    await clickAsync("dir", "dir.move", { dir: "/repo/models/模型A" });
    expect(MoveModelFileMock).not.toHaveBeenCalled();
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  it("dir.copy 成功 → CopyModelFile(目录路径) + toast", async () => {
    modalPromptMock.mockResolvedValue("备份");
    GetRepoRootMock.mockResolvedValue("/repo/models");
    CopyModelFileMock.mockResolvedValue(undefined);
    await clickAsync("dir", "dir.copy", { dir: "/repo/models/模型A" });
    expect(CopyModelFileMock).toHaveBeenCalledWith("/repo/models/模型A", "/repo/models/备份");
    expect(toasts().some((t) => t.msg.includes("已复制文件夹到 备份"))).toBe(true);
  });

  // ── file.push-to-pack ──
  it("file.push-to-pack 未配置游戏目录 → warn toast", async () => {
    LoadAppConfigMock.mockResolvedValue({ mcRoot: "" });
    await clickAsync("file", "file.push-to-pack", { path: "/a.ysm" });
    expect(toasts().some((t) => t.type === "warn" && t.msg.includes("请先配置游戏目录"))).toBe(true);
  });

  it("file.push-to-pack 无整合包 → warn toast", async () => {
    LoadAppConfigMock.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstancesMock.mockResolvedValue([]);
    await clickAsync("file", "file.push-to-pack", { path: "/a.ysm" });
    expect(toasts().some((t) => t.type === "warn" && t.msg.includes("未找到任何整合包"))).toBe(true);
  });

  it("file.push-to-pack 成功 → InstallModelTo + toast", async () => {
    LoadAppConfigMock.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstancesMock.mockResolvedValue([
      { Name: "包A", CustomDir: "/mc/versions/包A" },
    ]);
    modalSelectMock.mockResolvedValue("包A");
    InstallModelToMock.mockResolvedValue(undefined);
    await clickAsync("file", "file.push-to-pack", { path: "/dir/a.ysm" });
    // P2 修复：InstallModelTo → installer.Install 按仓库内绝对路径校验（IsInside），
    // 必须传完整路径而非 basename，否则「源文件不在仓库目录内」
    expect(InstallModelToMock).toHaveBeenCalledWith("/dir/a.ysm", "/mc/versions/包A");
    expect(toasts().some((t) => t.msg.includes("已推送"))).toBe(true);
  });

  it("file.push-to-pack 推送失败 → error toast", async () => {
    LoadAppConfigMock.mockResolvedValue({ mcRoot: "/mc" });
    ListVersionInstancesMock.mockResolvedValue([
      { Name: "包A", CustomDir: "/mc/versions/包A" },
    ]);
    modalSelectMock.mockResolvedValue("包A");
    InstallModelToMock.mockRejectedValue(new Error("disk full"));
    await clickAsync("file", "file.push-to-pack", { path: "/dir/a.ysm" });
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("推送失败"))).toBe(true);
  });

  // ── file.edit-tags ──
  it("file.edit-tags 保存 → toast 显示标签数", async () => {
    modalTagEditorMock.mockResolvedValue(["tag1", "tag2"]);
    await clickAsync("file", "file.edit-tags", { path: "/a.ysm" });
    expect(modalTagEditorMock).toHaveBeenCalledWith("/a.ysm");
    expect(toasts().some((t) => t.msg.includes("已保存 2 个标签"))).toBe(true);
  });

  // ── file.recycle ──
  it("file.recycle 确认 → MoveToRecycle + 刷新", async () => {
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock.mockResolvedValue(undefined);
    await clickAsync("file", "file.recycle", { path: "/a.ysm" });
    expect(MoveToRecycleMock).toHaveBeenCalledWith("/a.ysm");
    expect(reloaded()).toBe(true);
  });

  it("file.recycle 取消 → 不调后端", async () => {
    modalConfirmMock.mockResolvedValue(false);
    await clickAsync("file", "file.recycle", { path: "/a.ysm" });
    expect(MoveToRecycleMock).not.toHaveBeenCalled();
  });

  it("file.recycle 确认文案对 Windows 反斜杠路径取 basename（P4 修复）", async () => {
    modalConfirmMock.mockResolvedValue(true);
    MoveToRecycleMock.mockResolvedValue(undefined);
    await clickAsync("file", "file.recycle", {
      path: "C:\\Users\\me\\模型A\\foo.ysm",
    });
    const msg = (modalConfirmMock.mock.calls[0][0] as { message: string }).message;
    expect(msg).toContain("foo.ysm");
    expect(msg).not.toContain("Users");
  });

  // ── file.reveal ──
  it("file.reveal 成功 → RevealInExplorer", async () => {
    RevealInExplorerMock.mockResolvedValue(undefined);
    await clickAsync("file", "file.reveal", { path: "/a.ysm" });
    expect(RevealInExplorerMock).toHaveBeenCalledWith("/a.ysm");
  });

  it("file.reveal 后端报错 → friendlyError toast", async () => {
    RevealInExplorerMock.mockRejectedValue(new Error("ENOENT: no such file"));
    await clickAsync("file", "file.reveal", { path: "/a.ysm" });
    // ADR-051：裸 JS Error 无 AppError.Code → 走 fallback（不再按文本映射"文件或目录不存在"）
    expect(toasts().some((t) => t.type === "error")).toBe(true);
  });

  // ── file.copy-path ──
  it("file.copy-path 剪贴板成功 → toast", async () => {
    stubClipboard(() => Promise.resolve());
    await clickAsync("file", "file.copy-path", { path: "/a.ysm" });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/a.ysm");
    expect(toasts().some((t) => t.msg.includes("路径已复制"))).toBe(true);
  });

  it("file.copy-path 剪贴板被拒 → 兜底失败 toast（不抛）", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    await clickAsync("file", "file.copy-path", { path: "/a.ysm" });
    expect(toasts().some((t) => t.type === "error" && t.msg.includes("复制失败"))).toBe(true);
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
    const item = payload.items.find((i) => i.action === "batch.move");
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
    const { getApp } = await import("../backend/app.ts");
    vi.mocked(getApp).mockRejectedValueOnce(new Error("boom"));
    await clickMove(["/a.ysm"]);
    expect(allToasts().some((m) => m.includes("❌"))).toBe(true);
  });
});

// ===== 节点级 visibleWhen（ADR-021 B 层扩展，与 PreviewMenuNode.visibleWhen 同构）=====
// 通过临时 push 一条带 visibleWhen 的项验证 filter 行为，测完 pop 保持全局清洁。
// MENU_DEFS 是普通 const 数组（TS 未加 readonly），可运行时 mutate。
// HANDLERS 同理：临时塞 dummy handler 让 action 不触发 console.warn（filter 测试只关心 items）。
describe("声明式菜单节点级 visibleWhen（菜单即数据 P1 扩展）", () => {
  const PROBE_ACTION = "__test_probe_visibleWhen__";
  const PROBE_DEF_TYPE = "batch" as const;
  let probeIndex = -1;

  function pushProbe(visibleWhen: ((ctx: CtxShowPayload) => boolean) | undefined) {
    const def = MENU_DEFS.find((d) => d.type === PROBE_DEF_TYPE);
    if (!def) throw new Error("missing batch def");
    def.items.push({
      action: PROBE_ACTION,
      label: () => "probe",
      icon: "🧪",
      visibleWhen,
    });
    probeIndex = def.items.length - 1;
    // 占位 handler：消除 filter 链路里 action 失配警告，filter 测试只关心 items 是否出现
    (HANDLERS as Record<string, unknown>)[PROBE_ACTION] = () => {};
  }

  function popProbe() {
    const def = MENU_DEFS.find((d) => d.type === PROBE_DEF_TYPE);
    if (def && probeIndex >= 0) {
      def.items.splice(probeIndex, 1);
      probeIndex = -1;
    }
    // 直接操作 HANDLERS：不在模块顶层捕获 originalHandler（加载时 probe 未注入，恒为 undefined）
    delete (HANDLERS as Record<string, unknown>)[PROBE_ACTION];
  }

  function actionsOf(payload: { items: MenuItem[] }): string[] {
    return payload.items.filter((i) => i.action).map((i) => i.action!);
  }

  afterEach(popProbe);

  it("visibleWhen 返回 false → 该 item 不出现", () => {
    pushProbe(() => false);
    const payload = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(payload)).not.toContain(PROBE_ACTION);
  });

  it("visibleWhen 返回 true → 该 item 出现", () => {
    pushProbe(() => true);
    const payload = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(payload)).toContain(PROBE_ACTION);
  });

  it("visibleWhen 未定义 → 行为不变（保留项，与既有契约一致）", () => {
    pushProbe(undefined);
    const payload = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(payload)).toContain(PROBE_ACTION);
  });

  it("visibleWhen 吃 ctx 快照 → count=0 时隐藏、count=3 时显示", () => {
    pushProbe((ctx) => (ctx.count ?? 0) > 1);
    const hidden = showMenu("batch", { x: 10, y: 20, type: "batch", paths: [], count: 0 });
    expect(actionsOf(hidden)).not.toContain(PROBE_ACTION);
    menuShows.length = 0;
    const shown = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(shown)).toContain(PROBE_ACTION);
  });

  it("visibleWhen 与 viewer-mode 守卫 AND：visibleWhen=true 但 viewer-mode 拒 → 仍被拒（验证第二关独立生效）", () => {
    // pushProbe(action=__test_probe...) 不在 VIEWER_OK_ACTIONS 白名单也不在
    // VIEWER_WEB_ACTION_BINDINGS；visibleWhen=true（放行）+ viewer=true + can=false
    // → 仅 viewer-mode 守卫能拒；若仍被拒 = AND 关系正确（两关都生效）。
    pushProbe(() => true);
    isViewerModeMock.mockReturnValue(true);
    canMock.mockReturnValue(false);
    try {
      const payload = showMenu("batch", payloadCtx("batch"));
      expect(actionsOf(payload)).not.toContain(PROBE_ACTION);
    } finally {
      isViewerModeMock.mockReturnValue(false);
    }
  });
});
