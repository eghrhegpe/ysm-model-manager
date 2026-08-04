// ===== 右键菜单映射（类型化版 — ADR-014 P3 core 收官；ADR-021 B 层声明式化）=====
// 将 ctx:show 事件转换为新版组件使用的 menu:show 事件
// 菜单结构来自 menu-defs.ts（唯一事实来源），此处只保留行为 handler 表。
import { bus, type ToastPayload, type CtxShowPayload, type MenuItem } from "../bus.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { getApp } from "../wails/app.ts";
import { getMenuDef } from "./menu-defs";

type ToastType = NonNullable<ToastPayload["type"]>;

/** 通知树组件和统计面板刷新 */
function refreshUI(): void {
  bus.emit("tree:reload");
  bus.emit("stats:refresh");
}

/** 显示 toast 通知 */
function toast(msg: string, duration = 3000, type: ToastType = "success"): void {
  bus.emit("toast:show", { msg, duration, type });
}

/** 路径安全过滤：禁止包含 .. 或绝对路径 */
function isUnsafeFolderName(folder: string): boolean {
  return /\.\./.test(folder) || /^[/\\]/.test(folder);
}

/**
 * 解析「移动/复制到文件夹」的目标路径（batch.move / batch.copy / file.move / file.copy 共用）：
 * 弹窗输入 → 安全检查 → 取仓库根 → 拼目标目录。
 * 用户取消或校验失败时返回 null（已 toast 告知）。
 */
async function resolveDstDir(opts: {
  title: string;
  icon: string;
  okText: string;
  emptyMsg: string;
}): Promise<{ folder: string; dstDir: string } | null> {
  const { modalPrompt } = await import("../widgets/dialogs/modal.ts");
  const folder = await modalPrompt({
    title: opts.title,
    icon: opts.icon,
    placeholder: "输入目标文件夹名，如 [作者名]",
    okText: opts.okText,
  });
  if (!folder) return null;
  if (isUnsafeFolderName(folder)) {
    bus.emit("toast:show", {
      msg: "❌ 文件夹名包含非法字符",
      duration: 3000,
      type: "error",
    });
    return null;
  }
  const { GetRepoRoot } = await getApp();
  const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
  if (!repoRoot) {
    bus.emit("toast:show", {
      msg: opts.emptyMsg,
      duration: 3000,
      type: "error",
    });
    return null;
  }
  return { folder, dstDir: repoRoot + "/" + folder.replace(/\\/g, "/") };
}

// ── 行为 handler 表：action id → (ctx) => void ──────────
// 与 menu-defs.ts 的 MenuItemDef.action 一一对应；测试遍历声明断言完整性。
// MenuCtx 保证 paths 已归一化为数组（buildMenuItems 兜底）。
type MenuCtx = CtxShowPayload & { paths: string[] };

/** 批量移动/复制在途守卫：连点右键菜单时只执行一轮（同 _importing 模式） */
let _batchBusy = false;

const HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  noop: () => {},

  // ── instance ──
  "instance.open-folder": (ctx) => {
    if (!ctx.path) {
      toast("❌ 整合包目录未找到", 3000, "error");
      return;
    }
    getApp()
      .then((App) => App.OpenInstanceFolder(ctx.path || "", ctx.rtype || ""))
      .catch(() => toast("❌ 打开文件夹失败", 3000, "error"));
  },
  "instance.export-list": (ctx) =>
    bus.emit("instance:export-list", {
      name: ctx.instanceName || "",
      rtype: ctx.rtype,
    }),
  "instance.clear": (ctx) =>
    bus.emit("instance:clear", {
      name: ctx.instanceName || "",
      rtype: ctx.rtype || undefined,
    }),

  // ── batch ──
  "batch.rename": (ctx) => bus.emit("batch:rename", { paths: ctx.paths }),
  "batch.move": async (ctx) => {
    if (_batchBusy) return;
    _batchBusy = true;
    try {
      const resolved = await resolveDstDir({
        title: "移动到文件夹",
        icon: "📂",
        okText: "移动",
        emptyMsg: "❌ 请先配置存储路径",
      });
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { MoveModelFile } = await getApp();
      toast(`📦 正在移动 ${ctx.paths.length} 个文件到 ${folder}...`, 3000);
      let ok = 0;
      let fail = 0;
      for (const p of ctx.paths) {
        try {
          await MoveModelFile(p, dstDir);
          ok++;
        } catch (e) {
          fail++;
          console.error("移动失败:", p, e);
        }
      }
      toast(ok > 0 ? `✅ ${ok} 个文件已移动到 ${folder}` : "❌ 移动失败", 4000);
      refreshUI();
    } finally {
      _batchBusy = false;
    }
  },
  "batch.copy": async (ctx) => {
    if (_batchBusy) return;
    _batchBusy = true;
    try {
      const resolved = await resolveDstDir({
        title: "复制到文件夹",
        icon: "📋",
        okText: "复制",
        emptyMsg: "❌ 请先配置仓库目录",
      });
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { CopyModelFile } = await getApp();
      toast(`📦 正在复制 ${ctx.paths.length} 个文件到 ${folder}...`, 3000);
      let ok = 0;
      let fail = 0;
      for (const p of ctx.paths) {
        try {
          await CopyModelFile(p, dstDir);
          ok++;
        } catch (e) {
          fail++;
          console.error("复制失败:", p, e);
        }
      }
      if (ok > 0) {
        toast(
          fail > 0
            ? `✅ ${ok} 复制成功 / ❌ ${fail} 失败（可能目标已存在）`
            : `✅ ${ok} 个文件已复制到 ${folder}`,
          4000,
        );
      } else {
        toast("❌ 复制失败（可能目标已存在）", 4000, "error");
      }
      refreshUI();
    } finally {
      _batchBusy = false;
    }
  },
  "batch.recycle": async (ctx) => {
    const { modalConfirm } = await import("../widgets/dialogs/modal.ts");
    const ok2 = await modalConfirm({
      title: "批量移入回收站",
      icon: "♻️",
      message: `确定将选中的 ${ctx.count || 0} 个文件移入回收站？`,
      okText: "♻️ 移入",
      danger: true,
    });
    if (!ok2) return;
    const { MoveToRecycle } =
      await getApp();
    let fail = 0;
    let lastErr: unknown = null;
    for (const p of ctx.paths) {
      try {
        await MoveToRecycle(p);
      } catch (e) {
        fail++;
        lastErr = e;
      }
    }
    if (fail > 0) {
      toast(`❌ ${fail} 个文件移入回收站失败：${friendlyError(lastErr, "移动失败")}`, 5000, "error");
    }
    refreshUI();
  },
  "batch.copy-paths": async (ctx) => {
    try {
      await navigator.clipboard.writeText(ctx.paths.join("\n"));
      toast(`✅ 已复制 ${ctx.paths.length} 个路径`, 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = ctx.paths.join("\n");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast(`✅ 已复制 ${ctx.paths.length} 个路径`, 2000);
    }
  },
  "batch.export-list": (ctx) => {
    const names = ctx.paths
      .map((p) => p.split(/[/\\]/).pop())
      .filter(Boolean)
      .join("\n");
    const blob = new Blob([names], {
      type: "text/plain;charset=utf-8",
    });
    const a = document.createElement("a");
    a.download = `model-list-${new Date().toISOString().slice(0, 10)}.txt`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast(`✅ 已导出 ${ctx.paths.length} 个文件名`, 2000);
  },

  // ── file ──
  "file.rename": async (ctx) => {
    try {
      const { showRenameDialog } = await import("../widgets/dialogs/rename.ts");
      const fileName = (ctx.path || "").split(/[/\\]/).pop() || "";
      const newName = await showRenameDialog(ctx.path || "", fileName);
      if (!newName) return;
      const { RenameFile } =
        await getApp();
      await RenameFile(ctx.path || "", newName);
      refreshUI();
    } catch (e) {
      toast("❌ " + friendlyError(e, "重命名失败"), 4000, "error");
    }
  },
  "file.move": async (ctx) => {
    const resolved = await resolveDstDir({
      title: "移动到文件夹",
      icon: "📂",
      okText: "移动",
      emptyMsg: "❌ 请先配置存储路径",
    });
    if (!resolved) return;
    const { folder, dstDir } = resolved;
    const { MoveModelFile } = await getApp();
    try {
      await MoveModelFile(ctx.path || "", dstDir);
      toast(`✅ 已移动到 ${folder}`, 3000);
      refreshUI();
    } catch (e) {
      toast("❌ " + friendlyError(e, "移动失败"), 4000, "error");
    }
  },
  "file.copy": async (ctx) => {
    const resolved = await resolveDstDir({
      title: "复制到文件夹",
      icon: "📋",
      okText: "复制",
      emptyMsg: "❌ 请先配置仓库目录",
    });
    if (!resolved) return;
    const { folder, dstDir } = resolved;
    const { CopyModelFile } = await getApp();
    try {
      await CopyModelFile(ctx.path || "", dstDir);
      refreshUI();
      toast(`✅ 已复制到 ${folder}`, 3000);
    } catch (e) {
      toast("❌ " + friendlyError(e, "复制失败"), 4000, "error");
    }
  },
  "file.push-to-pack": async (ctx) => {
    const { LoadAppConfig, ListVersionInstances, InstallModelTo } =
      await getApp();
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || "";
    if (!mcRoot) {
      toast("请先配置游戏目录", 2000, "warn");
      return;
    }
    const instances = (await ListVersionInstances(mcRoot)) ?? [];
    if (!instances.length) {
      toast("未找到任何整合包", 2000, "warn");
      return;
    }
    const { modalSelect } = await import("../widgets/dialogs/modal.ts");
    const names = instances.map((i) => i.Name);
    const chosen = await modalSelect({
      title: "推送到整合包",
      icon: "📦",
      items: names,
      okText: "📦 推送",
    });
    if (!chosen) return;
    const match = instances.find((i) => i.Name === chosen);
    if (!match) return;
    // 传完整路径：InstallModelTo → installer.Install 内部按仓库内绝对路径校验（IsInside），
    // 传 basename 会被 cleanAbs 解析到 CWD 下导致「源文件不在仓库目录内」
    try {
      await InstallModelTo(ctx.path || "", match.CustomDir);
      toast(`✅ 已推送到 ${chosen}`, 2000);
    } catch (e) {
      toast("❌ " + friendlyError(e, "推送失败"), 3000, "error");
    }
  },
  "file.edit-tags": async (ctx) => {
    const { modalTagEditor } = await import("../widgets/dialogs/tag-editor.ts");
    const result = await modalTagEditor(ctx.path || "");
    if (result) toast(`🏷️ 已保存 ${result.length} 个标签`, 2000);
  },
  "file.recycle": async (ctx) => {
    const { modalConfirm } = await import("../widgets/dialogs/modal.ts");
    const ok2 = await modalConfirm({
      title: "移入回收站",
      icon: "♻️",
      message: `确定将 ${(ctx.path || "").split("/").pop()} 移入回收站？`,
      okText: "♻️ 移入",
      danger: true,
    });
    if (!ok2) return;
    const { MoveToRecycle } =
      await getApp();
    try {
      await MoveToRecycle(ctx.path || "");
      refreshUI();
    } catch (e) {
      toast("❌ " + friendlyError(e, "移入回收站失败"), 3000, "error");
    }
  },
  "file.reveal": async (ctx) => {
    const { RevealInExplorer } =
      await getApp();
    try {
      await RevealInExplorer(ctx.path || "");
    } catch (e) {
      toast("❌ " + friendlyError(e, "打开失败"), 3000, "error");
    }
  },
  "file.copy-path": async (ctx) => {
    try {
      await navigator.clipboard.writeText(ctx.path || "");
      toast("✅ 路径已复制到剪贴板", 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = ctx.path || "";
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("✅ 路径已复制到剪贴板", 2000);
    }
  },

  // ── dir ──
  "dir.rename": (ctx) => bus.emit("dir:rename", { dir: ctx.dir || "" }),
  "dir.batch-rename": (ctx) =>
    bus.emit("dir:batch-rename", { dir: ctx.dir || "" }),
  "dir.mkdir": (ctx) => bus.emit("dir:mkdir", { dir: ctx.dir || "" }),
  "dir.recycle": (ctx) => bus.emit("dir:recycle", { dir: ctx.dir || "" }),
};

/** 从声明生成 menu:show 载荷（结构来自 menu-defs.ts，行为查 handler 表） */
function buildMenuItems(ctx: CtxShowPayload): MenuItem[] {
  const def = getMenuDef(ctx.type);
  if (!def) return [];
  const paths = ctx.paths || [];
  const norm: MenuCtx = { ...ctx, paths };
  return def.items.map((item) => {
    if (item.divider) return { divider: true };
    const label = typeof item.label === "function" ? item.label(norm) : item.label;
    const action = item.action;
    const handler = action ? HANDLERS[action] : undefined;
    if (action && !handler) {
      // menu-defs.ts 的 action 与 HANDLERS 表键失配（测试应断言零警告）
      console.warn(`[context-menus] 未注册 action: ${action}（见 menu-defs.ts）`);
    }
    const out: MenuItem = {
      label,
      onClick: handler ? () => handler(norm) : undefined,
    };
    if (item.icon) out.icon = item.icon;
    if (item.danger) out.danger = true;
    return out;
  });
}

/** 注册右键菜单映射（ctx:show → menu:show）；由 registerGlobalHandlers 统一调用，unsub 收集进 unsubs 清理 */
export function registerContextMenus(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("ctx:show", (payload) => {
      bus.emit("menu:show", {
        x: payload.x,
        y: payload.y,
        items: buildMenuItems(payload),
      });
    }),
  );
}
