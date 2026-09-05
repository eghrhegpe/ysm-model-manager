// @vitest-environment node
// ===== context-menus 测试共享基建（ADR-187 D5 修订：isolate:true 后拆分可行）=====
// vitest isolate:true（vitest.config.ts L26，2026-08-22 迁移）下每文件独立 worker + 模块图，
// 拆分无跨文件时序耦合。本模块是 mock 矩阵 + DOM stub + 收集数组的唯一事实源：
//   - vi.hoisted 变量不可跨文件 export（vitest 编译期拦截），故只 export getMocks() 访问器；
//     消费方 import 本模块（副作用：vi.mock 注册）后解构访问器使用。
//   - bus 订阅 / registerContextMenus 生命周期留在各消费测试文件（钩子不能在此模块注册）。
import { expect, vi } from "vitest";
import type { CtxShowPayload, MenuItem } from "../../bus";
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { getMenuDef } from "./menu-defs.ts";

// getApp 是动态 import（backend/app.ts），测试用 mock 替代
const mocks = vi.hoisted(() => ({
  openFolderMock: vi.fn(),
  // 异步 handler 依赖：dialogs + bindings 均为动态 import，用 mock 拦截
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
  // mock 查看器模式判定——默认桌面（false），查看器过滤用例 mockReturnValue(true)
  isViewerModeMock: vi.fn(() => false),
  // can() 能力探测（viewer-mode 守卫依赖）：默认 false
  canMock: vi.fn((_action: string) => false),
}));

/** mock 访问器——唯一对外取 mock 句柄的入口（不可直接 export hoisted 变量） */
export const getMocks = (): typeof mocks => mocks;

vi.mock("../dialogs/modal-prompt.ts", () => ({
  modalPrompt: mocks.modalPromptMock,
}));
vi.mock("../dialogs/modal-confirm.ts", () => ({
  modalConfirm: mocks.modalConfirmMock,
}));
vi.mock("../dialogs/modal-select.ts", () => ({
  modalSelect: mocks.modalSelectMock,
}));
vi.mock("../dialogs/rename.ts", () => ({ showRenameDialog: mocks.showRenameDialogMock }));
vi.mock("../dialogs/tag-editor.ts", () => ({ modalTagEditor: mocks.modalTagEditorMock }));
// handler 统一走 getApp()（ADR-012）：mock getApp 返回 bindings mock 对象
vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    OpenInstanceFolder: mocks.openFolderMock,
    GetRepoRoot: mocks.GetRepoRootMock,
    MoveModelFile: mocks.MoveModelFileMock,
    CopyModelFile: mocks.CopyModelFileMock,
    RenameFile: mocks.RenameFileMock,
    MoveToRecycle: mocks.MoveToRecycleMock,
    LoadAppConfig: mocks.LoadAppConfigMock,
    ListVersionInstances: mocks.ListVersionInstancesMock,
    InstallModelTo: mocks.InstallModelToMock,
    RevealInExplorer: mocks.RevealInExplorerMock,
  }),
}));
vi.mock("../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  GetRepoRoot: mocks.GetRepoRootMock,
  MoveModelFile: mocks.MoveModelFileMock,
  CopyModelFile: mocks.CopyModelFileMock,
  RenameFile: mocks.RenameFileMock,
  MoveToRecycle: mocks.MoveToRecycleMock,
  LoadAppConfig: mocks.LoadAppConfigMock,
  ListVersionInstances: mocks.ListVersionInstancesMock,
  InstallModelTo: mocks.InstallModelToMock,
  RevealInExplorer: mocks.RevealInExplorerMock,
}));
// mock 查看器模式（android-bridge）——context-menus.ts 的 viewer-mode 过滤分支测试依赖
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  isViewerMode: mocks.isViewerModeMock,
}));
// canWebAction = 纯前端恒可达 + binding 走 can() 探测，mock 同步该语义
vi.mock("../../utils/dom/capabilities.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/dom/capabilities.ts")>();
  return {
    ...actual,
    can: mocks.canMock,
    canWebAction: (action: string) =>
      actual.VIEWER_PURE_ACTIONS.has(action) || mocks.canMock(action),
  };
});

// ===== 收集 menu:show 与 handler 发出的业务事件（bus 每 worker 独立，数组随模块声明）=====
export const menuShows: Array<{ x: number; y: number; items: MenuItem[] }> = [];
export const emitted: Array<{ e: string; p: unknown }> = [];
/** 消费方 beforeAll 里 registerContextMenus(menuUnsubs)，afterAll 统一退订 */
export const menuUnsubs: Array<() => void> = [];

export const TRACKED = [
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

// ===== DOM stub（--environment node 下 document 不存在）=====
// 覆盖 context-menu-handlers 的 textarea fallback（copy-paths catch）与 anchor 下载（export-list）。
// happy-dom 下 vi.stubGlobal 叠加到已有 document 之上，createElement 被替换不影响其余测试。
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

/** 每个用例前重置共享态：document stub 重建 + 清收集数组 + openFolder 计数清零 */
export function resetForCase(): void {
  vi.stubGlobal("document", documentMock);
  menuShows.length = 0;
  emitted.length = 0;
  mocks.openFolderMock.mockClear();
}

/** 触发一次 ctx:show，返回对应的 menu:show 载荷 */
export function showMenu(type: CtxShowPayload["type"], overrides: Partial<CtxShowPayload> = {}) {
  bus.emit("ctx:show", { x: 10, y: 20, type, paths: ["/a.ysm"], ...overrides });
  expect(menuShows).toHaveLength(1);
  return menuShows[0];
}

/** 构造与声明 label 函数匹配的 ctx 上下文 */
export function payloadCtx(type: CtxShowPayload["type"]): CtxShowPayload {
  const base: CtxShowPayload = { x: 10, y: 20, type, paths: ["/a.ysm"] };
  if (type === "instance")
    return { ...base, instanceName: "测试整合包", rtype: RESOURCE_TYPES.YSM };
  if (type === "batch") return { ...base, count: 3 };
  return base;
}

/** 断言 items 载荷与声明逐条一致（结构 + label 求值） */
export function expectItemsMatchDef(
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
