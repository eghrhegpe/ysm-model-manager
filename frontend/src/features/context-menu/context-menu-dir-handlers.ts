// ===== context-menu-dir-handlers.ts — dir 类右键菜单 handler（从 context-menu-handlers.ts 拆出，ADR-040 P1）=====

import { bus } from "../../bus.ts";
import type { DirCtx } from "./context-menu-handlers.ts";
import { runSingleOp } from "./context-menu-shared.ts";
import type { MenuAction } from "./menu-defs.ts";

/** dir 类 handler 子表（精确 key 推断，供 HANDLERS satisfies 覆盖断言） */
export const DIR_HANDLERS = {
  "dir.rename": (ctx) => bus.emit("dir:rename", { dir: ctx.dir || "" }),
  "dir.batch-rename": (ctx) => bus.emit("dir:batch-rename", { dir: ctx.dir || "" }),
  "dir.move": (ctx) =>
    runSingleOp(ctx.dir || "", ctx.rtype, "MoveModelFile", "move", {
      dialogTitle: "ctx.dirMoveDialogTitle",
      okMsg: "ctx.dirMoveOk",
    }),
  "dir.copy": (ctx) =>
    runSingleOp(ctx.dir || "", ctx.rtype, "CopyModelFile", "copy", {
      dialogTitle: "ctx.dirCopyDialogTitle",
      okMsg: "ctx.dirCopyOk",
    }),
  "dir.mkdir": (ctx) => bus.emit("dir:mkdir", { dir: ctx.dir || "" }),
  "dir.recycle": (ctx) => bus.emit("dir:recycle", { dir: ctx.dir || "" }),
} satisfies Record<Extract<MenuAction, `dir.${string}`>, (ctx: DirCtx) => void>;
