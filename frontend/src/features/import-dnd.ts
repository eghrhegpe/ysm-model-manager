// ===== 仓库页拖拽导入（组件级 — ADR-060）=====
// 从 document 级 registerDnD 收敛为 <app-tree> 容器内绑定，去掉全局遮罩。
// 收集器统一走 features/dnd-collector.ts，与导入页收集器一致。

import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { getApp } from "../backend/app.ts";
import { isWebPlatform } from "../backend/platform-web.ts";
import { MAX_IMPORT_BYTES } from "../backend/browser-adapter.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { dbg } from "../utils/debug/debug.ts";
import { swallowError } from "../utils/core/async.ts";
import { logError } from "../utils/core/log.ts";
import { executeCollected, importWebFilesWithToast } from "./import-executor.ts";
import { collectFiles, type CollectedFile } from "./dnd-collector.ts";
import { isImportableFile } from "./dnd-shared.ts";

const DROP_EXTS_STR = ALL_EXTS.join(" ");

const isEditable = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  return Boolean(
    node &&
      (node.tagName === "INPUT" ||
        node.tagName === "TEXTAREA" ||
        node.isContentEditable),
  );
};

/**
 * 处理 drop 事件：收集文件 → 过滤 → 执行导入。
 * busy 状态由调用方（bindTreeDnD 闭包）传入，避免模块级状态跨实例污染。
 * rtype：页面上下文类型（当前树根属性）——非空时文件夹整组按该类型仓库根落盘。
 */
export async function handleTreeDrop(
  e: DragEvent,
  isBusy: () => boolean,
  setBusy: (v: boolean) => void,
  rtype = "",
): Promise<void> {
  e.preventDefault();
  dbg("dnd", "handleTreeDrop called", { busy: isBusy(), targetTag: (e.target as HTMLElement)?.tagName });
  if (isEditable(e.target)) return;

  if (isBusy()) {
    bus.emit("toast:show", {
      msg: "⏳ " + t("import.busyImporting"),
      duration: TOAST_MS.success,
      type: "info",
    });
    return;
  }
  setBusy(true);

  // 写环形日志面板（Go AddOpLog）——非阻塞，失败经 swallowError 记录
  const logDrop = (msg: string) =>
    swallowError(getApp().then((app) => app.AddOpLog?.("drop", msg, "", "", 0, "ok", "")));

  try {
    // 网页版：无本地文件系统 → 拖入文件直接写入 IndexedDB 模型库
    if (isWebPlatform()) {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) {
        bus.emit("toast:show", {
          msg: "⚠️ 网页版暂不支持文件夹导入，请拖入 .ysm 等模型文件",
          duration: TOAST_MS.verbose,
          type: "warn",
        });
        return;
      }
      await importWebFilesWithToast(files);
      logDrop(`网页版导入 ${files.length} 个文件`);
      return;
    }

    // 桌面版：优先用 dataTransfer.files（WebView2 可靠）；
    // webkitGetAsEntry 在 WebView2 中对文件条目可能返回 null，仅作为目录收集的补充。
    // 策略：先用 files 收集所有散文件，再尝试 items → webkitGetAsEntry 补充目录条目。
    const baseFiles: CollectedFile[] = Array.from(e.dataTransfer?.files || []).map((f) => ({
      file: f,
      relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    }));

    const items = Array.from(e.dataTransfer?.items || []);
    let collected: CollectedFile[];
    if (items.length > 0) {
      const viaItems = await collectFiles(items, false);
      // 合并：items 路径来的补充到 baseFiles，去重
      const seen = new Set(baseFiles.map((c) => c.file.name + ":" + c.file.size + ":" + c.file.lastModified));
      for (const c of viaItems) {
        const key = c.file.name + ":" + c.file.size + ":" + c.file.lastModified;
        if (!seen.has(key)) {
          seen.add(key);
          baseFiles.push(c);
        }
      }
      collected = baseFiles;
    } else {
      collected = baseFiles;
    }
    if (collected.length === 0) {
      logDrop("drop: 收集 0 文件（webkitGetAsEntry fallback 也空）");
      bus.emit("toast:show", {
        msg: "📂 " + t("import.noSupportedFiles") + "（" + DROP_EXTS_STR + "）",
        duration: TOAST_MS.normal,
        type: "info",
      });
      return;
    }
    const importableStr = (name: string) => isImportableFile(name) ? "Y" : "N";
    logDrop(`drop: 收集 ${collected.length} 文件 [${collected.map((c) => `${c.file.name}(imp=${importableStr(c.file.name)})`).join(", ")}]`);

    // oversize 逐文件过滤
    const oversized = collected.filter((c) => c.file.size > MAX_IMPORT_BYTES);
    if (oversized.length > 0) {
      bus.emit("toast:show", {
        msg: `⚠️ ${oversized.length} 个文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB 上限已跳过（${oversized[0].file.name}${oversized.length > 1 ? " 等" : ""}）`,
        duration: TOAST_MS.long,
        type: "warn",
      });
      collected = collected.filter((c) => c.file.size <= MAX_IMPORT_BYTES);
      if (collected.length === 0) return;
    }

    const total = collected.length;
    const r = await executeCollected(collected, rtype);
    logDrop(`drop: 导入完成 folders=${r.folders} singles=${r.singles}`);
    if (r.folders === 0 && r.singles === 0 && total > 0) {
      logDrop("drop: execute 返回 0 成功但 total>0（全部被 filter 过滤）");
      bus.emit("toast:show", {
        msg: "📂 " + t("import.noSupportedFiles") + "（" + DROP_EXTS_STR + "）",
        duration: TOAST_MS.normal,
        type: "info",
      });
    }
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
export function bindTreeDnD(container: HTMLElement, rtype: string | (() => string) = ""): () => void {
  let _dropBusy = false;
  const isBusy = () => _dropBusy;
  const setBusy = (v: boolean) => { _dropBusy = v; };

  // hint 与 #tree 同为 <app-tree> shadow root 的直接子节点：parentElement 对
  // shadow root 子节点返回 null（ShadowRoot 非 Element），必须从 getRootNode()
  // 查找，否则 hint 永远不显示（ADR-060 组件化回归）。
  const hintEl = (container.getRootNode() as ParentNode).querySelector<HTMLElement>(".tree-drop-hint");

  // WebView2 在 Shadow DOM 内的 drop 事件存在已知限制（overflow:auto 容器吞 drop），
  // 因此在 document 层监听，通过 e.target 判断是否命中 app-tree 子树。
  // 这样 drop 事件不受 ShadowRoot 边界影响，始终能触发。
  const isInTree = (event: Event): boolean => {
    if (event.composedPath().some((node) => node === container || node === hintEl)) {
      return true;
    }
    const el = event.target;
    if (!el) return false;
    const node = el as Node;
    // 向上遍历 shadow boundary。⚠️ 必须用 parentNode 而非 parentElement：
    // parentElement 遇 shadow 边界顶部返回 null（ShadowRoot 非 Element），
    // 对 shadow DOM 内任何深层目标都判 false → 真实拖放永不触发。
    // parentNode 会经 host 跨出 shadow root，继续上溯到容器。
    let current: Node | null = node;
    while (current) {
      if (current === container || current === hintEl) return true;
      if (current.parentNode) {
        current = current.parentNode;
        continue;
      }
      // ShadowRoot.parentNode is null in real browsers; cross the boundary via host.
      current = current instanceof ShadowRoot ? current.host : null;
    }
    return false;
  };

  const onDragOver = (e: DragEvent): void => {
    if (!isInTree(e)) return;
    if (isEditable(e.target)) return;
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (hintEl && !_dropBusy) hintEl.style.display = "flex";
    dbg("dnd", "dragover OK", { types: [...(e.dataTransfer.types || [])], target: (e.target as HTMLElement)?.tagName, isEditable: isEditable(e.target) });
  };

  const onDragLeave = (e: DragEvent): void => {
    if (!isInTree(e)) return;
    if (!(e.currentTarget === e.relatedTarget || (e.relatedTarget as HTMLElement | null)?.closest?.(container.tagName === "APP-TREE" ? "app-tree" : ".list"))) return;
    if (hintEl) hintEl.style.display = "none";
  };

  const onDrop = (e: DragEvent): void => {
    if (!isInTree(e)) return;
    dbg("dnd", "drop fired", {
      files: e.dataTransfer?.files?.length ?? 0,
      items: e.dataTransfer?.items?.length ?? 0,
      types: e.dataTransfer?.types ? [...e.dataTransfer.types] : [],
      hasFiles: !!(e.dataTransfer?.files && e.dataTransfer.files.length > 0),
    });
    if (hintEl) hintEl.style.display = "none";
    const rt = typeof rtype === "function" ? rtype() : rtype;
    void handleTreeDrop(e, isBusy, setBusy, rt).catch((err) => {
      logError("tree-dnd", "拖放处理失败", err);
      bus.emit("toast:show", {
        // 显式化：friendlyError 展示 Go 结构化错误（ADR-082 续），
        // 未归类 Code 透传 Reason/Suggestion 并剥离内部路径
        msg: `❌ ${t("import.processError")}: ` + friendlyError(err),
        duration: TOAST_MS.verbose,
        type: "error",
      });
    });
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  dbg("dnd", "bound listeners to document");
  return () => {
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
  };
}
