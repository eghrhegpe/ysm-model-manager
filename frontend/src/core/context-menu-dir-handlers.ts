// ===== context-menu-dir-handlers.ts — dir 类右键菜单 handler（从 context-menu-handlers.ts 拆出，ADR-040 P1）=====
import { bus } from "../bus.ts";
import { getApp } from "../backend/app.ts";
import { refreshUI, toast, toastError, resolveDstDir } from "./context-menu-shared.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import type { MenuCtx } from "./context-menu-handlers.ts";

/** dir 类 handler 子表 */
export const DIR_HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  "dir.rename": (ctx) => bus.emit("dir:rename", { dir: ctx.dir || "" }),
  "dir.batch-rename": (ctx) =>
    bus.emit("dir:batch-rename", { dir: ctx.dir || "" }),
  "dir.move": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "移动文件夹到",
        icon: "📂",
        okText: "移动",
        emptyMsg: "❌ 请先配置存储路径",
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { MoveModelFile } = await getApp();
      await MoveModelFile(ctx.dir || "", dstDir);
      toast(`✅ 已移动文件夹到 ${folder}`, TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, "移动失败");
    }
  },
  "dir.copy": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "复制文件夹到",
        icon: "📋",
        okText: "复制",
        emptyMsg: "❌ 请先配置仓库目录",
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { CopyModelFile } = await getApp();
      await CopyModelFile(ctx.dir || "", dstDir);
      toast(`✅ 已复制文件夹到 ${folder}`, TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, "复制失败");
    }
  },
  "dir.mkdir": (ctx) => bus.emit("dir:mkdir", { dir: ctx.dir || "" }),
  "dir.recycle": (ctx) => bus.emit("dir:recycle", { dir: ctx.dir || "" }),
};
