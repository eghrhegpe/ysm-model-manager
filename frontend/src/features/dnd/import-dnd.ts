// ===== 仓库页拖拽导入（组件级 — ADR-060）=====
// 从 document 级 registerDnD 收敛为 <app-tree> 容器内绑定，去掉全局遮罩。
// 收集器统一走 features/dnd-collector.ts，与导入页收集器一致。

import { isWebPlatform } from "@/backend/platform-web.ts";
import { t } from "@/core/i18n/t.ts";
import type { CollectedEntry } from "@/features/import/collector.ts";
import type { ImportBatchResult } from "@/features/import/executor.ts";
import { executeCollected, importWebFilesWithToast } from "@/features/import/executor.ts";
import { collectDropFiles, dropOversized } from "@/features/import/shared.ts";
import { swallowError } from "@/utils/base/primitives/async.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { isEditableTarget } from "@/utils/dom/editable-target.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { ALL_EXTS } from "@/utils/resource/extensions.ts";
import { isImportableFile } from "@/utils/resource/importable.ts";
import { dndGetApp } from "./dnd-deps.ts";
import { isTreeMoveDrag } from "./move-dnd.ts";

const DROP_EXTS_STR = ALL_EXTS.join(" ");

const isEditable = isEditableTarget;

/**
 * 任意节点是否落在 container/extraRoot 子树内（含 shadow 边界上溯）。
 * ⚠️ 必须用 parentNode 而非 parentElement：parentElement 遇 shadow 边界顶部
 * 返回 null（ShadowRoot 非 Element）；parentNode 会经 host 跨出 shadow root。
 */
function isNodeWithinSubtree(node: Node | null, container: Node, extraRoot: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === container || current === extraRoot) return true;
    if (current.parentNode) {
      current = current.parentNode;
      continue;
    }
    // ShadowRoot.parentNode is null in real browsers; cross the boundary via host.
    current = current instanceof ShadowRoot ? current.host : null;
  }
  return false;
}

/** 事件是否命中容器子树：composedPath 直达优先，target 上溯兜底。 */
function eventInSubtree(event: Event, container: Node, extraRoot: Node | null): boolean {
  if (event.composedPath().some((node) => node === container || node === extraRoot)) {
    return true;
  }
  return isNodeWithinSubtree(event.target as Node | null, container, extraRoot);
}

/** dragover 是否命中「可导入落点」：树内 + 非编辑目标 + 非树内移动 + 携带文件（ADR-336 双通道四判据）。 */
function isImportDropTarget(e: DragEvent, container: Node, extraRoot: Node | null): boolean {
  if (!eventInSubtree(e, container, extraRoot)) return false;
  if (isEditable(e.target)) return false;
  if (isTreeMoveDrag(e.dataTransfer?.types)) return false;
  return !!e.dataTransfer?.types?.includes("Files");
}

/** drop 事件的环形日志载荷（可观测性，与处理逻辑无关）。 */
function dropDebugInfo(e: DragEvent): Record<string, unknown> {
  const dt = e.dataTransfer;
  return {
    files: dt?.files?.length ?? 0,
    items: dt?.items?.length ?? 0,
    types: dt?.types ? [...dt.types] : [],
    hasFiles: !!(dt?.files && dt.files.length > 0),
  };
}

/** 惰性解析页面类型（P2 审核修复：按值捕获会切根后残留旧类型）。 */
function resolveRtype(rtype: string | (() => string)): string {
  return typeof rtype === "function" ? rtype() : rtype;
}

/** 环形日志面板写入器（Go AddOpLog）——非阻塞，失败经 swallowError 记录。 */
function makeDropLogger(): (msg: string) => void {
  return (msg: string) =>
    swallowError(dndGetApp().then((app) => app.AddOpLog?.("drop", msg, "", "", 0, "ok", "")));
}

/**
 * 网页版分支：无本地文件系统 → 拖入文件直接写入 IndexedDB 模型库。
 * @returns true = 本分支已处理（调用方必须收口返回，与原 if(isWebPlatform) 语义逐字一致）
 */
async function importViaWebPlatform(
  e: DragEvent,
  logDrop: (msg: string) => void,
): Promise<boolean> {
  if (!isWebPlatform()) return false;
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length === 0) {
    toast(t("import.webFolderDropUnsupported"), TOAST_MS.verbose, "warn");
    return true;
  }
  await importWebFilesWithToast(files);
  logDrop(`网页版导入 ${files.length} 个文件`);
  return true;
}

/** 结果各计数 → 「成功 N，失败 M，跳过 K」文案片段（0 计数项不进文案）。 */
function buildResultParts(r: ImportBatchResult): string[] {
  const parts: string[] = [`${t("import.success")}: ${r.imported}`];
  if (r.failed > 0) parts.push(`${t("import.failed")}: ${r.failed}`);
  if (r.skipped > 0) parts.push(t("import.skippedCount", { n: r.skipped }));
  return parts;
}

/** 汇总 toast 正文：计数行 +（失败缘由点名，前 3 条）。 */
function summaryToastText(r: ImportBatchResult): string {
  const errorsHint = r.errors.length > 0 ? `（${r.errors.join("；")}）` : "";
  return `📂 ${buildResultParts(r).join("，")}${errorsHint}`;
}

/**
 * quiet 批量结果汇总：逐条 toast 收拢为「N 成功 M 失败」一条（对接锐评 UX #2 收口，
 * 2026-10-14）——拖 50 文件不该 50 条连珠炮，失败要能点名（前 3 条缘由）。
 */
function reportDropResult(
  r: ImportBatchResult,
  total: number,
  logDrop: (msg: string) => void,
): void {
  if (r.folders === 0 && r.singles === 0 && total > 0) {
    logDrop("drop: execute 返回 0 成功但 total>0（全部被 filter 过滤）");
    toast(`📂 ${t("import.noSupportedFiles")}（${DROP_EXTS_STR}）`, TOAST_MS.normal, "info");
    return;
  }
  if (r.imported > 0 || r.failed > 0 || r.skipped > 0) {
    toast(
      summaryToastText(r),
      r.failed > 0 ? TOAST_MS.verbose : TOAST_MS.info,
      r.failed > 0 ? "warn" : "success",
    );
  }
}

/**
 * 处理 drop 事件：收集文件 → 过滤 → 执行导入。
 * busy 状态由调用方（bindTreeDnD 闭包）传入，避免模块级状态跨实例污染。
 * rtype：页面上下文类型（当前树根属性）——非空时文件夹整组按该类型仓库根落盘。
 * 三段可独立收口的逻辑（网页版分支 / oversize 过滤 / 结果汇总）各成模块级助手，
 * 本体只留「守卫 → 收集 → 执行 → 汇总」的编排骨架（认知复杂度 41 → yellow 以下）。
 */
export async function handleTreeDrop(
  e: DragEvent,
  isBusy: () => boolean,
  setBusy: (v: boolean) => void,
  rtype = "",
): Promise<void> {
  e.preventDefault();
  dbg("dnd", "handleTreeDrop called", {
    busy: isBusy(),
    targetTag: (e.target as HTMLElement)?.tagName,
  });
  if (isEditable(e.target)) return;

  if (isBusy()) {
    toast(`⏳ ${t("import.busyImporting")}`, TOAST_MS.success, "info");
    return;
  }
  setBusy(true);

  // 写环形日志面板（Go AddOpLog）——非阻塞，失败经 swallowError 记录
  const logDrop = makeDropLogger();

  try {
    if (await importViaWebPlatform(e, logDrop)) return;

    // 桌面版：收集口径收敛到 dnd-shared.collectDropFiles（files 优先 +
    // webkitGetAsEntry 补充目录 + 去重合并），与整合包卡片拖入共用
    const collected0: CollectedEntry[] = await collectDropFiles(e);
    // 「收集 0」只在真的没收集到文件时提示；因 oversize 被滤光的场景
    // 仅提示超限（避免 oversize toast 之后再误导性弹「未检测到支持文件」）
    if (collected0.length === 0) {
      logDrop("drop: 收集 0 文件（webkitGetAsEntry fallback 也空）");
      toast(`📂 ${t("import.noSupportedFiles")}（${DROP_EXTS_STR}）`, TOAST_MS.normal, "info");
      return;
    }
    const collected = dropOversized(collected0);
    if (collected.length === 0) return; // 全被 oversize 滤除：超限提示已足够
    const importableStr = (name: string) => (isImportableFile(name) ? "Y" : "N");
    logDrop(
      `drop: 收集 ${collected.length} 文件 [${collected.map((c) => `${c.file.name}(imp=${importableStr(c.file.name)})`).join(", ")}]`,
    );

    const total = collected.length;
    const r = await executeCollected(collected, rtype, { quiet: true });
    logDrop(
      `drop: 导入完成 folders=${r.folders} singles=${r.singles} imported=${r.imported} failed=${r.failed} skipped=${r.skipped}`,
    );
    reportDropResult(r, total, logDrop);
  } finally {
    setBusy(false);
  }
}

/**
 * 在目标容器上注册仓库页 DnD 事件。
 * 由 <app-tree> connectedCallback 调用，返回 cleanup 函数。
 * busy 状态随闭包隔离，每个 <app-tree> 实例独立守卫。
 * rtype：当前树根属性（本就派生自 Go 路由配置，前端只透传）——文件夹导入
 * 按该类型仓库根落盘，空串回退后端内容推断。
 * 支持传 getter（P2 审核修复）：root 属性支持动态切换（attributeChangedCallback），
 * 按值捕获会在切根后闭包残留旧类型 → 拖到 B 页落 A 根的静默错位；
 * drop 时惰性解析保证始终读最新树类型。
 */
export function bindTreeDnD(
  container: HTMLElement,
  rtype: string | (() => string) = "",
): () => void {
  let _dropBusy = false;
  const isBusy = () => _dropBusy;
  const setBusy = (v: boolean) => {
    _dropBusy = v;
  };

  // hint 与 #tree 同为 <app-tree> shadow root 的直接子节点：parentElement 对
  // shadow root 子节点返回 null（ShadowRoot 非 Element），必须从 getRootNode()
  // 查找，否则 hint 永远不显示（ADR-060 组件化回归）。
  const hintEl = (container.getRootNode() as ParentNode).querySelector<HTMLElement>(
    ".tree-drop-hint",
  );
  // 可放置态信号（2026-10-13 锐评）：container 即 #tree（.list）本体——
  // dragover 命中期间加 .droppable（accent 边框 + 轻微内发光，见 app-tree-styles），
  // 摘除单点 = hideHint()（dragleave/dragend/drop 三处收口共用，2026-09 滞留债教训继承：
  // 类切换若独立于 hideHint 必然复现同型滞留）。_renderLayout 重建 shadow 内容后
  // container 引用随 connectedCallback 重绑，无需跨重渲保活。
  const setDroppable = (on: boolean): void => {
    container.classList.toggle("droppable", on);
  };

  // 落点判定走模块级 isNodeWithinSubtree/eventInSubtree（hintEl 作 extraRoot 传入，
  // 语义与原闭包逐字一致）。WebView2 在 Shadow DOM 内的 drop 事件存在已知限制
  // （overflow:auto 容器吞 drop），因此在 document 层监听，通过 e.target 判断是否
  // 命中 app-tree 子树——drop 事件不受 ShadowRoot 边界影响，始终能触发。
  const isInTree = (event: Event): boolean =>
    eventInSubtree(event, container, hintEl as Node | null);
  const isNodeInTree = (node: Node | null): boolean =>
    isNodeWithinSubtree(node, container, hintEl as Node | null);

  const hideHint = (): void => {
    if (hintEl) hintEl.style.display = "none";
    setDroppable(false); // 摘除时机单点：任何收口路径同步摘除可放置态
  };

  const onDragOver = (e: DragEvent): void => {
    // 判据收口到 isImportDropTarget 后此处无窄化，沿用 ?. 空安全（命中判据已保证非空）
    if (!isImportDropTarget(e, container, hintEl as Node | null)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (hintEl && !_dropBusy) hintEl.style.display = "flex";
    setDroppable(true);
    dbg("dnd", "dragover OK", {
      types: [...(e.dataTransfer?.types || [])],
      target: (e.target as HTMLElement)?.tagName,
      isEditable: isEditable(e.target),
    });
  };

  const onDragLeave = (e: DragEvent): void => {
    // 去向（relatedTarget）仍落在树内 = 树内元素间移动 → 提示保持；
    // null（拖出窗口）或树外元素 = 真正离开 → 收提示。
    // 旧实现判定写反且用 closest（不跨 shadow 边界恒 null），叠加无 dragend 兜底，
    // 「拖过树再在外松手」提示永久滞留（2026-09 收债）。
    if (isNodeInTree(e.relatedTarget as Node | null)) return;
    hideHint();
  };

  const onDragEnd = (): void => {
    // 拖拽会话结束兜底（应用内拖源在源元素触发；OS 文件拖出窗口松手由
    // dragleave relatedTarget=null 收口，此处兜非标准时序）
    hideHint();
  };

  const onDrop = (e: DragEvent): void => {
    hideHint(); // 无论落点是否在树内都收提示（树外 drop 旧实现早退滞留）
    if (!isInTree(e)) return;
    // ADR-336 双通道分流（锐评 2026-10-13 P0-1）：本链与 move-dnd 的 onDrop 都注册在
    // document 上（WebView2 shadow drop 限制的同款绕道），addEventListener 不阻止同一
    // 事件的其它监听器执行 —— 树内移动的 dataTransfer 不带任何文件，必被下方 collect-0
    // 分支判成「收集 0」并弹「未检测到支持文件」，与「移动成功」toast 并排出双提示。
    // 判据与 move-dnd 共用 isTreeMoveDrag（单一事实源，两侧判据必须同源，勿只改一处）。
    if (isTreeMoveDrag(e.dataTransfer?.types)) return;
    dbg("dnd", "drop fired", dropDebugInfo(e));
    void handleTreeDrop(e, isBusy, setBusy, resolveRtype(rtype)).catch((err) => {
      logError("tree-dnd", "拖放处理失败", err);
      toast(`${t("import.processError")}: ${friendlyError(err)}`, TOAST_MS.verbose, "error");
    });
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  document.addEventListener("dragend", onDragEnd);
  dbg("dnd", "bound listeners to document");
  return () => {
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
    document.removeEventListener("dragend", onDragEnd);
  };
}
