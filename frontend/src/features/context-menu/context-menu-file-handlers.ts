// ===== context-menu-file-handlers.ts — file 类右键菜单 handler（从 context-menu-handlers.ts 拆出，ADR-040 P1）=====

import { t } from "@/core/i18n/t.ts";
import type { RenameTpl } from "@/features/dialogs/rename.ts";
import { showRenameDialog } from "@/features/dialogs/rename.ts";
import type { TagEditorTpl } from "@/features/dialogs/tag-editor.ts";
import { modalTagEditor } from "@/features/dialogs/tag-editor.ts";
import { copyText } from "@/utils/dom/clipboard.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { modalSelect } from "@/utils/dom/modal-select.ts";
import { toast, toastError } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { contextMenuGetApp } from "./context-menu-deps.ts";
import type { FileCtx } from "./context-menu-handlers.ts";
import { refreshUI, runSingleOp } from "./context-menu-shared.ts";
import type { MenuAction } from "./menu-defs.ts";

/** file handler 依赖注入契约（ADR-190 D1a：DOM 模板由组合根注入，features 不自渲染、不 import views） */
export interface FileDialogDeps {
  renameTpl: RenameTpl;
  tagEditorTpl: TagEditorTpl;
}

/** 组合根注入前的 fail-loud 占位：命中即提示注入遗漏（与 batchRenameTpl 编译期 fail-loud 同款语义，
 * 此处因 handler 表是模块级 const、由 bus 订阅单点消费，改走「组合根 setter + 运行期 fail-loud」） */
function dgTplMissing(which: string): string {
  throw new Error(
    `[context-menu] ${which} DOM 模板未注入：请在组合根经 injectFileDialogDeps 注入 views/app-tree/tpl-*`,
  );
}

const FAIL_LOUD_DEPS: FileDialogDeps = {
  renameTpl: { boxHTML: () => dgTplMissing("rename") },
  tagEditorTpl: {
    boxHTML: () => dgTplMissing("tag-editor"),
    tagsHTML: () => dgTplMissing("tag-editor"),
    suggestionsHTML: () => dgTplMissing("tag-editor"),
  },
};

let dialogDeps: FileDialogDeps = FAIL_LOUD_DEPS;

/** 组合根注入 DOM 模板（ADR-190 D1a）：唯一调用方 = views 层装配（app-content 的
 * connectedCallback 编排处），features 不 import views（R4 反向边禁令） */
export function injectFileDialogDeps(deps: FileDialogDeps): void {
  dialogDeps = deps;
}

/** file 类 handler 子表（精确 key 推断，供 HANDLERS satisfies 覆盖断言） */
export const FILE_HANDLERS = {
  "file.rename": async (ctx) => {
    try {
      const fileName = (ctx.path || "").split(/[/\\]/).pop() || "";
      // ysm.json 护栏已上移 menu-defs.ts visibleWhen（后端硬拒保留），此处不再 toast 教育
      const newName = await showRenameDialog(ctx.path || "", fileName, {
        tpl: dialogDeps.renameTpl,
      });
      if (!newName) return;
      const { RenameFile } = await contextMenuGetApp();
      await RenameFile(ctx.path || "", newName);
      refreshUI();
    } catch (e) {
      toastError(e, t("ctx.renameFail"));
    }
  },
  "file.move": (ctx) =>
    runSingleOp(ctx.path || "", ctx.rtype, "MoveModelFile", "move", {
      dialogTitle: "ctx.moveDialogTitle",
      okMsg: "ctx.fileMoveOk",
    }),
  "file.copy": (ctx) =>
    runSingleOp(ctx.path || "", ctx.rtype, "CopyModelFile", "copy", {
      dialogTitle: "ctx.copyDialogTitle",
      okMsg: "ctx.fileCopyOk",
    }),
  "file.push-to-pack": async (ctx) => {
    try {
      const { LoadAppConfig, ListVersionInstances, InstallModelTo } = await contextMenuGetApp();
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (!mcRoot) {
        toast(t("ctx.pushNoMcRoot"), TOAST_MS.info, "warn");
        return;
      }
      const instances = (await ListVersionInstances(mcRoot)) ?? [];
      if (!instances.length) {
        toast(t("ctx.pushNoInstances"), TOAST_MS.info, "warn");
        return;
      }
      const names = instances.map((i) => i.Name);
      const chosen = await modalSelect({
        title: t("ctx.pushDialogTitle"),
        titleIcon: "package",
        items: names,
        okText: t("ctx.pushOkText"),
        okIcon: "package",
      });
      if (!chosen) return;
      const match = instances.find((i) => i.Name === chosen);
      if (!match) return;
      try {
        await InstallModelTo(ctx.path || "", match.CustomDir);
        toast(t("ctx.pushOk", { pack: chosen }), TOAST_MS.success);
      } catch (e) {
        toastError(e, t("ctx.pushFail"));
      }
    } catch (e) {
      toastError(e, t("ctx.pushFail"));
    }
  },
  "file.edit-tags": async (ctx) => {
    try {
      const result = await modalTagEditor(ctx.path || "", { tpl: dialogDeps.tagEditorTpl });
      if (result) toast(t("ctx.tagsSaved", { n: result.length }), TOAST_MS.success);
    } catch (e) {
      toastError(e, t("ctx.tagsFail"));
    }
  },
  "file.recycle": async (ctx) => {
    try {
      const ok2 = await modalConfirm({
        title: t("ctx.fileRecycleTitle"),
        titleIcon: "recycle",
        message: t("ctx.fileRecycleConfirm", {
          name: (ctx.path || "").split(/[/\\]/).pop() || "",
        }),
        okText: t("ctx.recycleOkText"),
        okIcon: "recycle",
        danger: true,
      });
      if (!ok2) return;
      const { MoveToRecycle } = await contextMenuGetApp();
      try {
        await MoveToRecycle(ctx.path || "");
        refreshUI();
      } catch (e) {
        toastError(e, t("ctx.recycleFail"));
      }
    } catch (e) {
      toastError(e, t("ctx.recycleFail"));
    }
  },
  "file.reveal": async (ctx) => {
    try {
      const { RevealInExplorer } = await contextMenuGetApp();
      await RevealInExplorer(ctx.path || "");
    } catch (e) {
      toastError(e, t("ctx.revealFail"));
    }
  },
  "file.copy-path": async (ctx) => {
    // 复用 utils/dom/clipboard.ts copyText（Clipboard API + textarea fallback），
    // 与 batch.copy-paths 同一实现——不再手写 navigator/textarea 双路径
    const result = await copyText(ctx.path || "");
    toast(
      result.ok ? t("ctx.copyPathOk") : t("ctx.copyPathFail"),
      result.ok ? TOAST_MS.success : TOAST_MS.normal,
      result.ok ? undefined : "error",
    );
  },
} satisfies Record<Extract<MenuAction, `file.${string}`>, (ctx: FileCtx) => void>;
