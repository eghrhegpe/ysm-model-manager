// ===== context-menu-file-handlers.ts — file 类右键菜单 handler（从 context-menu-handlers.ts 拆出，ADR-040 P1）=====
import { bus } from "../bus.ts";
import { getApp } from "../backend/app.ts";
import { modalConfirm, modalSelect } from "../utils/dom/dialogs/modal.ts";
import { showRenameDialog } from "../utils/dom/dialogs/rename.ts";
import { modalTagEditor } from "../utils/dom/dialogs/tag-editor.ts";
import { refreshUI, toast, toastError, resolveDstDir } from "./context-menu-shared.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { copyText } from "../utils/dom/clipboard.ts";
import type { MenuCtx } from "./context-menu-handlers.ts";

/** file 类 handler 子表 */
export const FILE_HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  "file.rename": async (ctx) => {
    try {
      const fileName = (ctx.path || "").split(/[/\\]/).pop() || "";
      if (fileName.toLowerCase() === "ysm.json") {
        toast("ysm.json 是模型目录清单，请右键所在文件夹「重命名」（整组操作）",
          4000,
          "warn",
        );
        return;
      }
      const newName = await showRenameDialog(ctx.path || "", fileName);
      if (!newName) return;
      const { RenameFile } = await getApp();
      await RenameFile(ctx.path || "", newName);
      refreshUI();
    } catch (e) {
      toastError(e, "重命名失败");
    }
  },
  "file.move": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "移动到文件夹",
        icon: "📂",
        okText: "移动",
        emptyMsg: "❌ 请先配置存储路径",
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { MoveModelFile } = await getApp();
      await MoveModelFile(ctx.path || "", dstDir);
      toast(`✅ 已移动到 ${folder}`, TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, "移动失败");
    }
  },
  "file.copy": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "复制到文件夹",
        icon: "📋",
        okText: "复制",
        emptyMsg: "❌ 请先配置仓库目录",
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { CopyModelFile } = await getApp();
      await CopyModelFile(ctx.path || "", dstDir);
      toast(`✅ 已复制到 ${folder}`, TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, "复制失败");
    }
  },
  "file.push-to-pack": async (ctx) => {
    try {
      const { LoadAppConfig, ListVersionInstances, InstallModelTo } = await getApp();
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (!mcRoot) {
        toast("请先配置游戏目录", TOAST_MS.success, "warn");
        return;
      }
      const instances = (await ListVersionInstances(mcRoot)) ?? [];
      if (!instances.length) {
        toast("未找到任何整合包", TOAST_MS.success, "warn");
        return;
      }
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
      try {
        await InstallModelTo(ctx.path || "", match.CustomDir);
        toast(`✅ 已推送到 ${chosen}`, TOAST_MS.success);
      } catch (e) {
        toastError(e, "推送失败");
      }
    } catch (e) {
      toastError(e, "推送失败");
    }
  },
  "file.edit-tags": async (ctx) => {
    try {
      const result = await modalTagEditor(ctx.path || "");
      if (result) toast(`🏷️ 已保存 ${result.length} 个标签`, TOAST_MS.success);
    } catch (e) {
      toastError(e, "标签编辑失败");
    }
  },
  "file.recycle": async (ctx) => {
    try {
      const ok2 = await modalConfirm({
        title: "移入回收站",
        icon: "♻️",
        message: `确定将 ${(ctx.path || "").split(/[/\\]/).pop()} 移入回收站？`,
        okText: "♻️ 移入",
        danger: true,
      });
      if (!ok2) return;
      const { MoveToRecycle } = await getApp();
      try {
        await MoveToRecycle(ctx.path || "");
        refreshUI();
      } catch (e) {
        toastError(e, "移入回收站失败");
      }
    } catch (e) {
      toastError(e, "移入回收站失败");
    }
  },
  "file.reveal": async (ctx) => {
    try {
      const { RevealInExplorer } = await getApp();
      await RevealInExplorer(ctx.path || "");
    } catch (e) {
      toastError(e, "打开失败");
    }
  },
  "file.copy-path": async (ctx) => {
    // 复用 utils/dom/clipboard.ts copyText（Clipboard API + textarea fallback），
    // 与 batch.copy-paths 同一实现——不再手写 navigator/textarea 双路径
    const ok = await copyText(ctx.path || "");
    toast(
      ok ? "✅ 路径已复制到剪贴板" : "❌ 复制失败，请手动复制路径",
      ok ? TOAST_MS.success : TOAST_MS.normal,
      ok ? undefined : "error",
    );
  },
};
