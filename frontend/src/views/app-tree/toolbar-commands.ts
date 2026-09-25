// ===== 工具栏命令注册表（ADR-298 D1/D2）=====
//
// 是什么：app-tree 工具栏下拉命令的**行为层**（表现层在 toolbar-menus.ts，经
// `ToolbarMenuItem.action` 联合类型与本表编译期钉死）。范式对齐 features/context-menu/
// menu-defs.ts 的 `MENU_DEFS ⊂ MENU_ACTIONS ⊂ HANDLERS` 与 preview-3d 的 PreviewMenuNode
// ——「声明表 + 编译期 action 联合」，行为不再靠 `data-*` 裸字符串 if-else 散落分派。
//
// 落点为何是 view 本地而非 core/utils/dom：本表 import `AppTree` 与 backend seam，
// 不满足 core 准入三条（引擎无关 / 不依赖上层 / 无 Wails 可单测）。
//
// D2：同组件内唯一生产者的事件不上总线——`batch:enable-all` / `batch:disable-all`
// 曾由本视图 emit、又由同视图 bus-handlers 接收，纯绕路；现改命令直调。

import { resolveAndroidRepoDir } from "@/backend/directory-picker.ts";
import { isViewerMode } from "@/backend/platform.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { getExts } from "@/utils/resource/extensions.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { batchToggleAll } from "./bus-handlers.ts";
import type { AppTree } from "./index.ts";
import { pickWebFilesAndImport } from "./toolbar-search.ts";
import { spinnerHTML } from "./tpl.ts";

/** 命令执行上下文（表现层 tpl 产出的 DOM 句柄 + 树实例） */
export interface ToolbarCommandCtx {
  vm: AppTree;
  $: (id: string) => HTMLElement | null;
}

/**
 * 命令执行签名。
 * @param el 触发该项的菜单按钮（供 busy 态 / 内容复原，如 genindex 的 spinner）
 */
type ToolbarCommand = (ctx: ToolbarCommandCtx, el: HTMLElement) => void | Promise<void>;

/** 导入确认（文件/文件夹共用）：选择 → 导入 → 重载 → 成功 toast */
async function runImport(
  ctx: ToolbarCommandCtx,
  pick: () => Promise<string | null>,
  rtype: string,
  successMsg: string,
): Promise<void> {
  const { vm } = ctx;
  const path = await pick();
  if (!path) return;
  const { ImportByType } = await backendGetApp();
  try {
    await ImportByType(rtype, path);
  } catch (e) {
    // Go 侧 ImportByType 失败走 reject（@wailsio/runtime Call 语义），
    // 不能用 resolve 值判错（旧 string 签名时代的残留，失败路径永远进不去）
    const errMsg = e instanceof Error ? e.message : String(e);
    bus.emit("toast:show", {
      msg: t("tree.importFail", { msg: errMsg }),
      duration: TOAST_MS.verbose,
      type: "warn",
    });
    return;
  }
  const gen = vm._guard.current;
  await vm._load();
  if (vm._guard.stale(gen)) return;
  vm._renderTree();
  bus.emit("toast:show", { msg: successMsg, duration: TOAST_MS.success, type: "success" });
}

/**
 * 命令注册表：key = `ToolbarMenuItem.action` 的取值域（编译期唯一事实源）。
 * 新增命令 = 此表加一项 + toolbar-menus.ts 加一条表现声明（漏一处即 tsc 报错）。
 */
export const TOOLBAR_COMMANDS = {
  // ── 批量 ──（直调 bus-handlers 执行函数，ADR-298 D2：同组件唯一生产者不上总线）
  "enable-all": (ctx) => {
    void batchToggleAll(ctx.vm, true);
  },
  "disable-all": (ctx) => {
    void batchToggleAll(ctx.vm, false);
  },

  // ── 更多 ──
  "open-folder": async (ctx) => {
    const { vm } = ctx;
    if (isViewerMode()) {
      await resolveAndroidRepoDir();
      return;
    }
    if (!vm.snapshot.filesRoot) return;
    const { OpenFolder } = await backendGetApp();
    await OpenFolder(vm.snapshot.filesRoot);
  },
  "import-file": async (ctx) => {
    const { vm } = ctx;
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    if (isViewerMode()) {
      await pickWebFilesAndImport(
        rtype,
        () => vm._load(),
        () => vm._renderTree(),
      );
      return;
    }
    const { SelectImportFile } = await backendGetApp();
    const exts = getExts(rtype);
    const extFilter = exts.length ? exts.map((e) => `*${e}`).join(";") : "*.*";
    await runImport(
      ctx,
      () =>
        SelectImportFile(
          `${t("tree.importFileFilter", { rtype })}|${extFilter}`,
          t("tree.selectFileTitle", { rtype }),
        ),
      rtype,
      t("tree.importOk"),
    );
  },
  "import-dir": async (ctx) => {
    const { vm } = ctx;
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    if (isWebPlatform()) {
      const gen = vm._guard.current;
      await pickWebFilesAndImport(
        rtype,
        () => vm._load(),
        () => {
          if (!vm._guard.stale(gen)) vm._renderTree();
        },
      );
      return;
    }
    if (isViewerMode()) {
      const dir = await resolveAndroidRepoDir();
      if (!dir) return;
      const gen = vm._guard.current;
      await vm._load();
      if (vm._guard.stale(gen)) return;
      vm._renderTree();
      return;
    }
    const { SelectDirectory } = await backendGetApp();
    await runImport(ctx, () => SelectDirectory(), rtype, t("tree.importDirOk"));
  },
  refresh: async (ctx) => {
    const { vm, $ } = ctx;
    const tree = $("tree");
    if (tree) tree.innerHTML = spinnerHTML();
    // 手动刷新就是为「外部改了文件」准备的：先清 Go 扫描缓存（30s TTL 内不清则
    // _load 拿到旧缓存，刷新无效），对齐 bus 事件链 reload() 的口径（2026-09 收债）
    try {
      const App = await backendGetApp();
      if (App.ClearScanCache) await App.ClearScanCache();
    } catch (e) {
      logWarn("tree", "refresh ClearScanCache:", e);
    }
    const gen = vm._guard.current;
    await vm._load();
    if (vm._guard.stale(gen)) return;
    vm._renderTree();
  },
  genindex: async (_ctx, el) => {
    const btn = el as HTMLButtonElement;
    // 捕获声明表渲染的完整内容（book 图标 + 文案）；finally 必须按原结构恢复，
    // 曾用 textContent 恢复会抹掉图标且菜单不重渲染永不归位（ADR-238 结案）
    const origHtml = btn.innerHTML;
    btn.innerHTML = UI_ICONS.refresh;
    btn.disabled = true;
    try {
      const { GenerateRepoIndex, GetRepoRoot } = await backendGetApp();
      const filesRoot = await GetRepoRoot(currentRepoType());
      if (!filesRoot) {
        bus.emit("toast:show", {
          msg: t("tree.needStoragePath"),
          duration: TOAST_MS.success,
          type: "warn",
        });
        return;
      }
      const idx = await GenerateRepoIndex(filesRoot);
      if (isWebPlatform() && typeof idx === "string") {
        const blob = new Blob([idx], { type: "application/json;charset=utf-8" });
        const a = document.createElement("a");
        a.download = "index.json";
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
      bus.emit("toast:show", {
        msg: t("tree.indexGenerated"),
        duration: TOAST_MS.normal,
        type: "success",
      });
    } finally {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  },
} satisfies Record<string, ToolbarCommand>;

/** 命令 id 联合（`ToolbarMenuItem.action` 的取值域，ADR-298 D1） */
export type ToolbarCommandId = keyof typeof TOOLBAR_COMMANDS;

/**
 * 统一分派器：`data-batch` / `data-more` 委托 → 命令表查找。
 * 替代原 ~80 行内联 async if-else 链；未知 action 静默 no-op（声明表已由类型兜底）。
 */
export function runToolbarCommand(action: string, ctx: ToolbarCommandCtx, el: HTMLElement): void {
  const cmd = (TOOLBAR_COMMANDS as Record<string, ToolbarCommand | undefined>)[action];
  if (!cmd) return;
  void Promise.resolve(cmd(ctx, el)).catch((err) => {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(err)}`,
      duration: TOAST_MS.verbose,
      type: "error",
    });
  });
}
