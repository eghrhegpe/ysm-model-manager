// ===== context-menu-handlers.ts — instance/batch handler 表（ADR-040 P1 第2轮拆分）=====
// file/dir handler 已拆至 context-menu-file-handlers.ts / context-menu-dir-handlers.ts
import { bus } from "../bus.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { t } from "./i18n/t.ts";
import { getApp } from "../backend/app.ts";
import { modalConfirm, modalSelect } from "../utils/dom/dialogs/modal.ts";
import { showRenameDialog } from "../utils/dom/dialogs/rename.ts";
import { modalTagEditor } from "../utils/dom/dialogs/tag-editor.ts";
// P1 修复（ADR-040）：file/dir handler 已拆出，此处合并
import { FILE_HANDLERS } from "./context-menu-file-handlers.ts";
import { DIR_HANDLERS } from "./context-menu-dir-handlers.ts";
// 共享原语（toast/refreshUI/isUnsafeFolderName/resolveDstDir）下沉至
// context-menu-shared.ts，破除 handlers ↔ {file,dir}-handlers 循环依赖
import { refreshUI, toast, toastEmptyRtype, isUnsafeFolderName, resolveDstDir } from "./context-menu-shared.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { copyText } from "../utils/dom/clipboard.ts";

/** batch.move / batch.copy 共用模板。 */
let _batchBusy = false;

async function runBatchFileOp(
  ctx: MenuCtx,
  op: {
    verb: string;
    binding: "MoveModelFile" | "CopyModelFile";
    dialog: { title: string; icon: string; okText: string; emptyMsg: string };
    partialFailMsg: string;
    allFailMsg: string;
  },
): Promise<void> {
  if (_batchBusy) {
    toast("⏳ 操作进行中，请稍候", TOAST_MS.quick, "info");
    return;
  }
  _batchBusy = true;
  try {
    const resolved = await resolveDstDir(op.dialog, ctx.rtype);
    if (!resolved) return;
    const { folder, dstDir } = resolved;
    const app = await getApp();
    const fn = app[op.binding];
    toast(`📦 正在${op.verb} ${ctx.paths.length} 个文件到 ${folder}...`, TOAST_MS.normal);
    let ok = 0;
    let fail = 0;
    for (const p of ctx.paths) {
      try {
        await fn(p, dstDir);
        ok++;
      } catch (e) {
        fail++;
        console.error(`${op.verb}失败:`, p, e);
      }
    }
    if (ok > 0) {
      toast(fail > 0
          ? `✅ ${ok} 个已${op.verb} / ❌ ${fail} 失败${op.partialFailMsg ? `（${op.partialFailMsg}）` : ""}`
          : `✅ ${ok} 个文件已${op.verb}到 ${folder}`,
        4000,
      );
    } else {
      toast(`❌ ${op.allFailMsg}`, TOAST_MS.verbose, "error");
    }
    refreshUI();
  } catch (e) {
    toast(`❌ ${friendlyError(e)}`, TOAST_MS.verbose, "error");
  } finally {
    _batchBusy = false;
  }
}

export type MenuCtx = import("../bus.ts").CtxShowPayload & { paths: string[] };

/** 行为 handler 表（instance + batch + merge file/dir） */
export const HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  noop: () => {},
  ...FILE_HANDLERS,
  ...DIR_HANDLERS,

  // ── instance ──
  "instance.open-folder": async (ctx) => {
    if (!ctx.path) {
      toast("❌ 整合包目录未找到", TOAST_MS.normal, "error");
      return;
    }
    try {
      const { OpenInstanceFolder } = await getApp();
      // 扁平化架构下，打开精确到 {instanceDir}（如 3d-skin）；
      // subdir 参数保留为 Wails 绑定兼容，已不参与路由
      await OpenInstanceFolder(ctx.path, ctx.rtype || "", ctx.subdir || "");
    } catch (e) {
      toast(`❌ ${friendlyError(e, "打开文件夹失败")}`, TOAST_MS.normal, "error");
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
      verb: "移动",
      binding: "MoveModelFile",
      dialog: { title: "移动到文件夹", icon: "📂", okText: "移动", emptyMsg: "❌ 请先配置存储路径" },
      partialFailMsg: "",
      allFailMsg: "移动失败",
    }),
  "batch.copy": (ctx) =>
    runBatchFileOp(ctx, {
      verb: "复制",
      binding: "CopyModelFile",
      dialog: { title: "复制到文件夹", icon: "📋", okText: "复制", emptyMsg: "❌ 请先配置仓库目录" },
      partialFailMsg: "可能目标已存在",
      allFailMsg: "复制失败（可能目标已存在）",
    }),
  "batch.recycle": async (ctx) => {
    if (_batchBusy) {
      toast("⏳ 操作进行中，请稍候", TOAST_MS.quick, "info");
      return;
    }
    _batchBusy = true;
    try {
      const ok2 = await modalConfirm({
        title: "批量移入回收站",
        icon: "♻️",
        message: `确定将选中的 ${ctx.count || 0} 个文件移入回收站？`,
        okText: "♻️ 移入",
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
        toast(`❌ ${fail} 个文件移入回收站失败：${friendlyError(lastErr, "移动失败")}`, TOAST_MS.long, "error");
      } else {
        toast(`✅ ${ctx.paths.length} 个文件已移入回收站`, TOAST_MS.normal);
      }
      refreshUI();
    } catch (e) {
      toast(`❌ ${friendlyError(e)}`, TOAST_MS.long, "error");
    } finally {
      _batchBusy = false;
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
    toast(`✅ 已导出 ${ctx.paths.length} 个文件名`, TOAST_MS.success);
  },
};
