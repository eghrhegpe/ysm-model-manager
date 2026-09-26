// ===== context-menu-handlers.ts — instance/batch handler 表（ADR-040 P1 第2轮拆分）=====
// file/dir handler 已拆至 context-menu-file-handlers.ts / context-menu-dir-handlers.ts
//
// P0 整改：busy 锁移入 createContextMenuHandlers() 工厂闭包，消除模块级可变全局。
// 模块级 defaultHandlers 保持既有消费者零改动。

import { bus } from "@/bus";
import { t, tOf } from "@/core/i18n/t.ts";
import { type BusyLock, createBusyLock } from "@/utils/base/primitives/lock.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { copyText } from "@/utils/dom/clipboard.ts";
import { downloadTextFile } from "@/utils/dom/download-text.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { toast, toastEmptyRtype, toastError } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import type { UiIconName } from "@/utils/icon/ui-icons.ts";
import { contextMenuGetApp } from "./context-menu-deps.ts";
import { DIR_HANDLERS } from "./context-menu-dir-handlers.ts";
// P1 修复（ADR-040）：file/dir handler 已拆出，此处合并
import { FILE_HANDLERS } from "./context-menu-file-handlers.ts";
// 共享原语（refreshUI/isUnsafeFolderName/resolveDstDir）在 context-menu-shared.ts；
// 通知原语（toast 系）在 utils/dom/toast.ts（ADR-185 下沉，ADR-189 D3 归位）
import { refreshUI, resolveDstDir } from "./context-menu-shared.ts";
// P2 收窄：HANDLERS 断言覆盖 MENU_ACTIONS（type-only，无运行时循环依赖）
import type { MenuAction } from "./menu-defs.ts";

/** batch 批量操作模板（i18n key 集中定义——toast/弹窗文案不再散落 handler 字面量） */
type BatchMode = "move" | "copy";
const BATCH_TPL: Record<
  BatchMode,
  {
    icon: UiIconName;
    progress: string;
    okAll: string;
    okPartial: string;
    failAll: string;
    dialogTitle: string;
    dialogOk: string;
    emptyMsg: string;
  }
> = {
  move: {
    icon: "folderOpen",
    progress: "ctx.moveProgress",
    okAll: "ctx.moveOkAll",
    okPartial: "ctx.moveOkPartial",
    failAll: "ctx.moveFailAll",
    dialogTitle: "ctx.moveDialogTitle",
    dialogOk: "ctx.moveDialogOk",
    emptyMsg: "ctx.emptyMoveRoot",
  },
  copy: {
    icon: "clipboard",
    progress: "ctx.copyProgress",
    okAll: "ctx.copyOkAll",
    okPartial: "ctx.copyOkPartial",
    failAll: "ctx.copyFailAll",
    dialogTitle: "ctx.copyDialogTitle",
    dialogOk: "ctx.copyDialogOk",
    emptyMsg: "ctx.emptyCopyRoot",
  },
};

export type MenuCtx = import("@/bus").CtxShowPayload & { paths: string[] };

// P2-1 表级窄化：file/dir 两张表各拿掉对立字段，编译期防跨表误取——
//   file handler 读 ctx.dir / dir handler 读 ctx.path → 直接编译报错。
// 仅用 Omit 收窄"能读到哪几个字段"，不收紧运行时（发射端 dir 可缺席，见 app-tree/events.ts
// dir 发射的条件展开），因此 dir-handler 的 `ctx.dir || ""` 防守保留，行为与结构均不变。
export type FileCtx = Omit<MenuCtx, "dir">;
export type DirCtx = Omit<MenuCtx, "path">;
// P2-2 平权（锐评 #4 收口）：instance/batch 补与 file/dir 同构的表级窄化——
//   instance 归 path/rtype/subdir/instanceName（open-folder 与 file 家族共享 path 是既成事实），
//   不得读写 dir 域（dir）、batch 域（paths/count）、workshop 展示载荷；
//   batch 归 paths/count/rtype，不得读写 path/instanceName/subdir（instance/file 域）、
//   dir（dir 域）、workshop（展示载荷）。workshop 菜单 4 行全 kind:"header" 无 handler，无表可窄。
type InstanceCtx = Omit<MenuCtx, "dir" | "paths" | "count" | "workshop">;
type BatchCtx = Omit<MenuCtx, "dir" | "path" | "instanceName" | "subdir" | "workshop">;

/** 右键菜单 handler 表（instance + batch + merge file/dir） */
export type HandlerTable = Record<MenuAction, (ctx: MenuCtx) => void>;

/** 右键菜单 handlers 实例（busy 锁内聚于此） */
export interface ContextMenuHandlers {
  HANDLERS: HandlerTable;
}

/**
 * 创建独立的右键菜单 handlers 实例（busy 锁隔离，测试可注入）。
 * 生产代码使用模块级 defaultHandlers，无需手动创建。
 */
export function createContextMenuHandlers(): ContextMenuHandlers {
  // 每个 verb 各创建独立 busy flag（move / copy / recycle 互不耦合）
  const moveBusy = createBusyLock();
  const copyBusy = createBusyLock();
  const recycleBusy = createBusyLock();

  async function runBatchFileOp(
    ctx: BatchCtx,
    op: {
      mode: BatchMode;
      binding: "MoveModelFile" | "CopyModelFile";
      busy: BusyLock;
    },
  ): Promise<void> {
    if (!op.busy.tryStart()) {
      toast(t("ctx.busyWait"), TOAST_MS.quick, "info");
      return;
    }
    const tpl = BATCH_TPL[op.mode];
    try {
      const resolved = await resolveDstDir(
        {
          title: tOf(tpl.dialogTitle),
          icon: tpl.icon,
          okText: tOf(tpl.dialogOk),
          emptyMsg: tOf(tpl.emptyMsg),
        },
        ctx.rtype,
      );
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const app = await contextMenuGetApp();
      toast(
        tOf(tpl.progress, {
          n: ctx.paths.length,
          folder,
        }),
        TOAST_MS.normal,
      );
      let ok = 0;
      let fail = 0;
      for (const p of ctx.paths) {
        try {
          // 方法调用形态保持 this 绑定（const fn = app[op.binding] 解绑后调用有 this 风险）
          await app[op.binding](p, dstDir);
          ok++;
        } catch (e) {
          fail++;
          dbg(`batch-${op.mode}-fail`, p, e);
        }
      }
      if (ok > 0) {
        toast(
          fail > 0
            ? tOf(tpl.okPartial, { ok, fail })
            : tOf(tpl.okAll, {
                n: ctx.paths.length,
                folder,
              }),
          TOAST_MS.verbose,
        );
      } else {
        toast(tOf(tpl.failAll), TOAST_MS.verbose, "error");
      }
      refreshUI();
    } catch (e) {
      toastError(e);
    } finally {
      op.busy.finish();
    }
  }

  /** instance 类子表（P2-2：InstanceCtx 编译期防跨表误读 dir/paths/count/workshop 字段） */
  const INSTANCE_HANDLERS = {
    "instance.open-folder": async (ctx) => {
      if (!ctx.path) {
        toast(t("ctx.missingPath"), TOAST_MS.normal, "error");
        return;
      }
      try {
        const { OpenInstanceFolder } = await contextMenuGetApp();
        await OpenInstanceFolder(ctx.path, ctx.rtype || "", ctx.subdir || "");
      } catch (e) {
        toastError(e, t("ctx.openFolderFail"));
      }
    },
    "instance.export-list": (ctx) => {
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
  } satisfies Record<Extract<MenuAction, `instance.${string}`>, (ctx: InstanceCtx) => void>;

  /** batch 类子表（P2-2：BatchCtx 编译期防跨表误读 path/instanceName/subdir/dir/workshop 字段） */
  const BATCH_HANDLERS = {
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
        toast(t("ctx.busyWait"), TOAST_MS.quick, "info");
        return;
      }
      try {
        const ok2 = await modalConfirm({
          title: t("ctx.recycleTitle"),
          titleIcon: "recycle",
          message: t("ctx.recycleConfirm", {
            n: ctx.paths.length,
          }),
          okText: t("ctx.recycleOkText"),
          okIcon: "recycle",
          danger: true,
        });
        if (!ok2) return;
        const { MoveToRecycle } = await contextMenuGetApp();
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
          toast(
            t("ctx.recycleFailN", {
              fail,
              err: friendlyError(lastErr, t("ctx.moveFail")),
            }),
            TOAST_MS.long,
            "error",
          );
        } else {
          toast(t("ctx.recycleOkN", { n: ctx.paths.length }), TOAST_MS.normal);
        }
        refreshUI();
      } catch (e) {
        toastError(e);
      } finally {
        recycleBusy.finish();
      }
    },
    "batch.copy-paths": async (ctx) => {
      const result = await copyText(ctx.paths.join("\n"));
      toast(
        result.ok ? t("ctx.copyPathsOk", { n: ctx.paths.length }) : t("ctx.copyPathsFail"),
        result.ok ? TOAST_MS.success : TOAST_MS.normal,
        result.ok ? undefined : "error",
      );
    },
    "batch.export-list": (ctx) => {
      const names = ctx.paths
        .map((p) => p.split(/[/\\]/).pop())
        .filter(Boolean)
        .join("\n");
      downloadTextFile(names, `model-list-${new Date().toISOString().slice(0, 10)}.txt`);
      toast(t("ctx.exportListOk", { n: ctx.paths.length }), TOAST_MS.success);
    },
  } satisfies Record<Extract<MenuAction, `batch.${string}`>, (ctx: BatchCtx) => void>;

  /** 行为 handler 表（instance + batch + file + dir 四子表合并）；HandlerTable 注解覆盖
   *  MENU_ACTIONS 全集，漏挂拼错即编译错误。noop 假动作已退役（标题项 kind:"header" 无行为） */
  const HANDLERS: HandlerTable = {
    ...FILE_HANDLERS,
    ...DIR_HANDLERS,
    ...INSTANCE_HANDLERS,
    ...BATCH_HANDLERS,
  };

  return { HANDLERS };
}

/** 模块级默认 handlers（生产代码消费方零改动） */
const defaultHandlers = createContextMenuHandlers();

/** 模块级共享 handler 表：生产走单一实例（busy 锁 moveBusy/copyBusy/recycleBusy 全进程共享）；
 * 测试文件向此表注入/清理探针 action（防止泄漏进后续用例）。
 * 需要独立实例（隔离 busy 锁、测试注入互不干扰）时用 createContextMenuHandlers() 创建。 */
export const HANDLERS = defaultHandlers.HANDLERS;
