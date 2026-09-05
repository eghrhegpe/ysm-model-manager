// @vitest-environment node
// ===== context-menus 映射测试 — 异步 handler / 失败路径段（ADR-187 D5 修订拆分）=====
// 点击带动态 import 的 action（batch.move/copy/recycle、file.rename/move/copy/push/recycle/
// reveal/copy-path/edit-tags 等）→ await onClick → 断言 bindings mock 调用 + toast 载荷。
//
// ⚠️ ADR-187 D5 修订（2026-09-05）：见 context-menus.test.ts 头注释。本文件承接原
// 1076 行文件的「异步 handler」+「失败路径」两段，共享基建统一走 context-menus.setup.ts。
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
// ⚠️ setup 必须最先 import：其顶层 vi.mock 需在 context-menus.ts 树（静态加载
// backend/app.ts）之前注册，否则 mock 晚于真实解析而失效（vitest 不 hoist 非测试文件）。
import "./context-menus.setup.ts";
import { bus } from "../../bus.ts";
import type { CtxShowPayload, ToastPayload } from "../../bus";
import { registerContextMenus } from "./context-menus.ts";
import {
  getMocks,
  menuShows,
  emitted,
  menuUnsubs,
  TRACKED,
  resetForCase,
  showMenu,
  payloadCtx,
} from "./context-menus.setup.ts";

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
} = getMocks();

// bus 订阅 + 菜单注册（setup.ts 不持有生命周期钩子——vitest 钩子须在测试文件注册）
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
  resetForCase();
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
  ): Promise<void> {
    const payload = showMenu(type, { ...payloadCtx(type), ...overrides });
    const item = payload.items.find((i) => i.action === action);
    expect(item, `找不到菜单项: ${action}`).toBeTruthy();
    await item!.onClick!();
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
    const { getApp } = await import("../../backend/app.ts");
    vi.mocked(getApp).mockRejectedValueOnce(new Error("boom"));
    await clickMove(["/a.ysm"]);
    expect(allToasts().some((m) => m.includes("❌"))).toBe(true);
  });
});
