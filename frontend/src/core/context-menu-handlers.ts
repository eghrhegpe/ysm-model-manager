// ===== context-menu-handlers.ts — instance/batch handler 表（ADR-040 P1 第2轮拆分）=====
// file/dir handler 已拆至 context-menu-file-handlers.ts / context-menu-dir-handlers.ts
import { bus } from "../bus.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { t } from "./i18n/t.ts";
import { tr } from "./i18n/tr.ts";
import { getApp } from "../backend/app.ts";
import { modalConfirm } from "../utils/dom/dialogs/modal.ts";
// P1 修复（ADR-040）：file/dir handler 已拆出，此处合并
import { FILE_HANDLERS } from "./context-menu-file-handlers.ts";
import { DIR_HANDLERS } from "./context-menu-dir-handlers.ts";
// P2 收窄：HANDLERS 断言覆盖 MENU_ACTIONS（type-only，无运行时循环依赖）
import type { MenuAction } from "./menu-defs.ts";
// 共享原语（toast/refreshUI/isUnsafeFolderName/resolveDstDir）下沉至
// context-menu-shared.ts，破除 handlers ↔ {file,dir}-handlers 循环依赖
import { refreshUI, toast, toastError, toastEmptyRtype, resolveDstDir } from "./context-menu-shared.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { copyText } from "../utils/dom/clipboard.ts";
import { downloadTextFile } from "../utils/dom/download-text.ts";
import { dbg } from "../utils/debug/debug.ts";

/**
 * Busy flag 工厂（2026-XX 重构）：消除模块级 `let _batchBusy`——
 * 每个 handler 闭包持自己的 flag，互不耦合。
 * 原实现：模块单 flag → batch.move / batch.copy / batch.recycle 三选一互斥（过保守）
 * 新实现：按 verb 独立 busy → 同一 verb 连点互斥（保留原保护），不同 verb 可并发
 */
function makeBusy() {
  let busy = false;
  return {
    tryStart(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    finish() {
      busy = false;
    },
  };
}

/** batch 批量操作模板（i18n key 集中定义——toast/弹窗文案不再散落 handler 字面量） */
type BatchMode = "move" | "copy";
const BATCH_TPL: Record<BatchMode, {
  icon: string;
  progress: string;
  okAll: string;
  okPartial: string;
  failAll: string;
  dialogTitle: string;
  dialogOk: string;
  emptyMsg: string;
}> = {
  move: {
    icon: "📂",
    progress: "ctx.moveProgress",
    okAll: "ctx.moveOkAll",
    okPartial: "ctx.moveOkPartial",
    failAll: "ctx.moveFailAll",
    dialogTitle: "ctx.moveDialogTitle",
    dialogOk: "ctx.moveDialogOk",
    emptyMsg: "ctx.emptyMoveRoot",
  },
  copy: {
    icon: "📋",
    progress: "ctx.copyProgress",
    okAll: "ctx.copyOkAll",
    okPartial: "ctx.copyOkPartial",
    failAll: "ctx.copyFailAll",
    dialogTitle: "ctx.copyDialogTitle",
    dialogOk: "ctx.copyDialogOk",
    emptyMsg: "ctx.emptyCopyRoot",
  },
};

async function runBatchFileOp(
  ctx: MenuCtx,
  op: {
    mode: BatchMode;
    binding: "MoveModelFile" | "CopyModelFile";
    busy: ReturnType<typeof makeBusy>;
  },
): Promise<void> {
  if (!op.busy.tryStart()) {
    toast(tr("ctx.busyWait", "⏳ Operation in progress, please wait"), TOAST_MS.quick, "info");
    return;
  }
  const tpl = BATCH_TPL[op.mode];
  try {
    const resolved = await resolveDstDir({
      title: tr(tpl.dialogTitle, "Move to Folder"),
      icon: tpl.icon,
      okText: tr(tpl.dialogOk, "Move"),
      emptyMsg: tr(tpl.emptyMsg, "❌ Configure a storage path first"),
    }, ctx.rtype);
    if (!resolved) return;
    const { folder, dstDir } = resolved;
    const app = await getApp();
    const fn = app[op.binding];
    toast(tr(tpl.progress, "📦 Moving {n} files to {folder}...", { n: ctx.paths.length, folder }), TOAST_MS.normal);
    let ok = 0;
    let fail = 0;
    for (const p of ctx.paths) {
      try {
        await fn(p, dstDir);
        ok++;
      } catch (e) {
        fail++;
        dbg(`batch-${op.mode}-fail`, p, e);
      }
    }
    if (ok > 0) {
      toast(
        fail > 0
          ? tr(tpl.okPartial, "✅ {ok} moved / ❌ {fail} failed", { ok, fail })
          : tr(tpl.okAll, "✅ Moved {n} files to {folder}", { n: ctx.paths.length, folder }),
        4000,
      );
    } else {
      toast(tr(tpl.failAll, "❌ Move failed"), TOAST_MS.verbose, "error");
    }
    refreshUI();
  } catch (e) {
    toastError(e);
  } finally {
    op.busy.finish();
  }
}

// 模块初始化时为每个 verb 各创建独立 busy flag（move / copy / recycle 互不耦合）
const moveBusy = makeBusy();
const copyBusy = makeBusy();
const recycleBusy = makeBusy();

export type MenuCtx = import("../bus.ts").CtxShowPayload & { paths: string[] };

/** 行为 handler 表（instance + batch + merge file/dir）；satisfies 断言覆盖 MENU_ACTIONS，漏挂拼错即编译错误 */
export const HANDLERS = {
  noop: () => {},
  ...FILE_HANDLERS,
  ...DIR_HANDLERS,

  // ── instance ──
  "instance.open-folder": async (ctx) => {
    if (!ctx.path) {
      toast(tr("ctx.missingPath", "❌ Pack directory not found"), TOAST_MS.normal, "error");
      return;
    }
    try {
      const { OpenInstanceFolder } = await getApp();
      // 扁平化架构下，打开精确到 {instanceDir}（如 3d-skin）；
      // subdir 参数保留为 Wails 绑定兼容，已不参与路由
      await OpenInstanceFolder(ctx.path, ctx.rtype || "", ctx.subdir || "");
    } catch (e) {
      toastError(e, tr("ctx.openFolderFail", "Failed to open folder"));
    }
  },
  "instance.export-list": (ctx) => {
    // rtype 契约必填（bus.ts 收紧）：发射点编译期强制提供非空；
    // 运行期守卫与消费方（instance-ops）的 !rtype 失败守卫对称，双保险。
    if (!ctx.rtype) {
      toastEmptyRtype();
      return;
    }
    bus.emit("instance:export-list", {
      name: ctx.instanceName || "",
      rtype: ctx.rtype,
    });
  },
  "instance.clear": (ctx) => {
    if (!ctx.rtype) {
      toastEmptyRtype();
      return;
    }
    bus.emit("instance:clear", {
      name: ctx.instanceName || "",
      rtype: ctx.rtype,
    });
  },

  // ── batch ──
  "batch.rename": (ctx) => bus.emit("batch:rename", { paths: ctx.paths }),
  "batch.move": (ctx) =>
    runBatchFileOp(ctx, {
      mode: "move",
      binding: "MoveModelFile",
      busy: moveBusy,
    }),
  "batch.copy": (ctx) =>
    runBatchFileOp(ctx, {
      mode: "copy",
      binding: "CopyModelFile",
      busy: copyBusy,
    }),
  "batch.recycle": async (ctx) => {
    if (!recycleBusy.tryStart()) {
      toast(tr("ctx.busyWait", "⏳ Operation in progress, please wait"), TOAST_MS.quick, "info");
      return;
    }
    try {
      const ok2 = await modalConfirm({
        title: tr("ctx.recycleTitle", "Recycle Selected"),
        icon: "♻️",
        message: tr("ctx.recycleConfirm", "Move {n} selected files to recycle bin?", { n: ctx.count || 0 }),
        okText: tr("ctx.recycleOkText", "♻️ Recycle"),
        danger: true,
      });
      if (!ok2) return;
      const { MoveToRecycle } = await getApp();
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
        toast(tr("ctx.recycleFailN", "❌ Failed to recycle {fail} files: {err}", {
          fail,
          err: friendlyError(lastErr, tr("ctx.moveFail", "Move failed")),
        }), TOAST_MS.long, "error");
      } else {
        toast(tr("ctx.recycleOkN", "✅ Moved {n} files to recycle bin", { n: ctx.paths.length }), TOAST_MS.normal);
      }
      refreshUI();
    } catch (e) {
      toastError(e);
    } finally {
      recycleBusy.finish();
    }
  },
  "batch.copy-paths": async (ctx) => {
    // DOM 操作下沉 utils/dom（core 层不直接操作 document/navigator.clipboard）
    const ok = await copyText(ctx.paths.join("\n"));
    toast(
      ok
        ? t("ctx.copyPathsOk", { n: ctx.paths.length })
        : t("ctx.copyPathsFail"),
      ok ? 2000 : 3000,
      ok ? undefined : "error",
    );
  },
  "batch.export-list": (ctx) => {
    const names = ctx.paths
      .map((p) => p.split(/[/\\]/).pop())
      .filter(Boolean)
      .join("\n");
    // DOM 职责下沉（utils/dom/download-text.ts）——handler 不再直接操作 document/URL
    downloadTextFile(names, `model-list-${new Date().toISOString().slice(0, 10)}.txt`);
    toast(tr("ctx.exportListOk", "✅ Exported {n} file names", { n: ctx.paths.length }), TOAST_MS.success);
  },
} satisfies Record<MenuAction, (ctx: MenuCtx) => void>;
