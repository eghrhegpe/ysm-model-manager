// ===== 整合包卡片拖拽导入（先入仓库再推送）=====
// 拖模型文件/文件夹到实例卡片 → 入仓库（Go 类型路由）→ 同批推送进该实例
// （ysmsync.PushSingleResource 管线，硬链接模式由此成立）。
// 职责归属：前端只收集/分组/编排，类型判定与落点全在 Go 侧 binding；
// 收集口径与仓库页拖拽共用 dnd-shared.collectDropFiles。

import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { getApp } from "../backend/app.ts";
import { isWebPlatform } from "../backend/platform-web.ts";
import { MAX_IMPORT_BYTES } from "../backend/browser-adapter.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { dbg } from "../utils/debug/debug.ts";
import { logError } from "../utils/core/log.ts";
import { swallowError } from "../utils/core/async.ts";
import {
  collectDropFiles,
  groupCollected,
  isEditableTarget,
  type CollectedEntry,
} from "./dnd-shared.ts";
import { fileToBase64 } from "./import-executor.ts";

/** drop 处理期间的 busy 守卫（由绑定闭包持有，每组件实例独立） */
export interface PackDndBusy {
  isBusy: () => boolean;
  setBusy: (v: boolean) => void;
}

/** 卡片实例的最小形状（SidebarInstance 结构子集） */
export interface PackDndInstance {
  name: string;
}

const toast = (msg: string, type: "success" | "error" | "warn" | "info", duration: number = TOAST_MS.normal): void => {
  bus.emit("toast:show", { msg, duration, type });
};

/**
 * 处理整合包卡片 drop：收集 → oversize 过滤 → 分组 → 逐组「入仓库+推送」。
 * folderName/subpath 拆分与 importFolder 同口径（拖「分类1/狐狸」→ subpath=分类1）。
 * 单文件走 ImportFileAndPushToInstance（importer 类型路由）。
 */
export async function handleInstanceDrop(
  e: DragEvent,
  instanceName: string,
  busy: PackDndBusy,
): Promise<void> {
  e.preventDefault();
  dbg("pack-dnd", "handleInstanceDrop called", { instanceName, busy: busy.isBusy() });
  if (isEditableTarget(e.target)) return;

  if (busy.isBusy()) {
    toast("⏳ " + t("import.busyImporting"), "info", TOAST_MS.success);
    return;
  }
  busy.setBusy(true);

  // 写环形日志面板（Go AddOpLog）——非阻塞，失败经 swallowError 记录
  const logDrop = (msg: string) =>
    swallowError(getApp().then((app) => app.AddOpLog?.("pack-drop", msg, "", "", 0, "ok", "")));

  try {
    if (isWebPlatform()) {
      toast("⚠️ 网页版暂不支持拖入整合包，请在桌面端操作", "warn", TOAST_MS.verbose);
      return;
    }
    logDrop(`pack-drop: 目标实例 ${instanceName}`);

    const collected0: CollectedEntry[] = await collectDropFiles(e);
    // oversize 逐文件过滤（与仓库页拖拽同口径）
    const oversized = collected0.filter((c) => c.file.size > MAX_IMPORT_BYTES);
    if (oversized.length > 0) {
      toast(
        `⚠️ ${oversized.length} 个文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB 上限已跳过（${oversized[0].file.name}${oversized.length > 1 ? " 等" : ""}）`,
        "warn",
        TOAST_MS.long,
      );
    }
    const collected = collected0.filter((c) => c.file.size <= MAX_IMPORT_BYTES);
    if (collected.length === 0) {
      logDrop("pack-drop: 收集 0 文件");
      toast("📂 " + t("import.noSupportedFiles"), "info");
      return;
    }

    const { folders, singles: allSingles } = groupCollected(collected);
    // 光杆 ysm.json 散文件与 directImport 同款拦截（整组内 ysm.json 走文件夹路由不受影响）
    let ysmJsonHinted = false;
    const singles = allSingles.filter((c) => {
      if (c.file.name.toLowerCase() === "ysm.json") {
        if (!ysmJsonHinted) {
          ysmJsonHinted = true;
          toast(t("import.ysmJsonHint"), "warn", 4000);
        }
        return false;
      }
      return true;
    });
    logDrop(`pack-drop: 分组 folders=${folders.length} singles=${singles.length}`);

    const App = await getApp();
    let okUnits = 0;
    let attempted = 0;
    const failures: string[] = [];

    for (const g of folders) {
      attempted++;
      const parts = g.dir.split("/");
      const folderName = parts[parts.length - 1] || "模型";
      const subpath = parts.slice(0, -1).join("/");
      const items: Array<{ RelPath: string; Base64: string }> = [];
      for (const c of g.files) {
        const rel = c.relPath.startsWith(g.dir + "/")
          ? c.relPath.slice(g.dir.length + 1)
          : c.relPath;
        try {
          items.push({ RelPath: rel, Base64: await fileToBase64(c.file) });
        } catch (err) {
          console.warn("[pack-dnd] 跳过读取失败文件:", rel, err);
        }
      }
      if (!items.length) {
        failures.push(`${folderName}: ${t("import.emptyFolder")}`);
        continue;
      }
      try {
        await App.ImportFolderAndPushToInstance(folderName, subpath, items, instanceName);
        okUnits++;
        logDrop(`pack-drop: ${folderName} → ${instanceName} 成功`);
      } catch (err) {
        failures.push(`${folderName}: ${friendlyError(err)}`);
        logDrop(`pack-drop: ${folderName} → ${instanceName} 失败: ${String(err)}`);
      }
    }

    for (const s of singles) {
      attempted++;
      try {
        const b64 = await fileToBase64(s.file);
        await App.ImportFileAndPushToInstance(s.file.name, b64, instanceName);
        okUnits++;
        logDrop(`pack-drop: ${s.file.name} → ${instanceName} 成功`);
      } catch (err) {
        failures.push(`${s.file.name}: ${friendlyError(err)}`);
        logDrop(`pack-drop: ${s.file.name} → ${instanceName} 失败: ${String(err)}`);
      }
    }

    // 反馈：成功/部分失败/全失败三分；只要有调用即刷新（导入可能已落仓库，防陈旧）
    if (okUnits > 0 && failures.length === 0) {
      toast(`✅ 已导入仓库并推送到 ${instanceName}（${okUnits} 项）`, "success", TOAST_MS.success);
    } else if (okUnits > 0 && failures.length > 0) {
      toast(`⚠️ 推送完成 ${okUnits} 项，${failures.length} 项失败：${failures[0]}${failures.length > 1 ? " 等" : ""}`, "warn", TOAST_MS.verbose);
    } else if (failures.length > 0) {
      toast(`❌ 推送到 ${instanceName} 失败：${failures[0]}${failures.length > 1 ? " 等" : ""}`, "error", TOAST_MS.verbose);
    }
    if (attempted > 0) {
      bus.emit("stats:refresh");
      bus.emit("tree:reload");
    }
  } catch (err) {
    logError("pack-dnd", "拖放处理失败", err);
    toast(`❌ ${t("import.processError")}: ` + friendlyError(err), "error", TOAST_MS.verbose);
  } finally {
    busy.setBusy(false);
  }
}

/**
 * 在 document 层注册整合包卡片 DnD（WebView2 ShadowRoot drop 限制，
 * 与 bindTreeDnD 同款范式：document 监听 + composedPath/parentNode 跨界识别）。
 * 由 <app-sidebar> connectedCallback 调用，返回 cleanup。
 * getInstances 惰性读取最新实例列表（卡片 data-idx ↔ 数组下标）。
 */
export function bindPackCardDnD(
  root: ShadowRoot,
  getInstances: () => PackDndInstance[],
): () => void {
  let _dropBusy = false;
  const busy: PackDndBusy = {
    isBusy: () => _dropBusy,
    setBusy: (v: boolean) => { _dropBusy = v; },
  };
  let _lastCard: Element | null = null;

  const clearHighlight = (): void => {
    if (_lastCard) {
      _lastCard.classList.remove("dnd-over");
      _lastCard = null;
    }
  };

  // composedPath 扫描优先（外部监听可见 shadow 内部路径），target 沿
  // parentNode 上溯兜底（跨 shadow 边界经 host，bindTreeDnD 同款范式）
  const cardFromEvent = (e: Event): HTMLElement | null => {
    for (const node of e.composedPath()) {
      if (node instanceof Element && node.classList?.contains("instance-card")) {
        return node as HTMLElement;
      }
    }
    let current: Node | null = e.target as Node | null;
    while (current) {
      if (current instanceof Element) {
        const card = current.closest(".instance-card") as HTMLElement | null;
        if (card) return card;
      }
      current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
    }
    return null;
  };

  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    if (isEditableTarget(e.target)) return;
    const card = cardFromEvent(e);
    if (!card) return;
    // 只响应本组件 shadow 内的卡片（多实例并存防串扰）
    if (!root.contains(card) && card.getRootNode() !== root) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (_lastCard !== card) {
      clearHighlight();
      _lastCard = card;
      card.classList.add("dnd-over");
    }
  };

  const onDragLeave = (e: DragEvent): void => {
    const card = cardFromEvent(e);
    if (card && card === _lastCard) clearHighlight();
  };

  const onDrop = (e: DragEvent): void => {
    const card = cardFromEvent(e);
    if (!card) return;
    if (!root.contains(card) && card.getRootNode() !== root) return;
    clearHighlight();
    const idx = parseInt(card.dataset.idx || "", 10);
    const ins = getInstances()[idx];
    if (!ins?.name) return;
    dbg("pack-dnd", "drop on instance card", { idx, name: ins.name });
    void handleInstanceDrop(e, ins.name, busy).catch((err) => {
      logError("pack-dnd", "拖放处理失败", err);
      toast(`❌ ${t("import.processError")}: ` + friendlyError(err), "error", TOAST_MS.verbose);
    });
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  return () => {
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
    clearHighlight();
  };
}
