// ===== 创意工坊批量下载队列 — 网页平台下载入库分支（ADR-208 D2 ≤400 行拆分自
// download-queue-store.ts）=====
// 网页版（ADR-123 P1）：下载与导入统一走 IndexedDB 入库——逐个 fetch(url) 转 File 复用
// browser-adapter.importWebFiles 落库（与拖拽导入同一条 IDB/刷新/反馈链路）。
// 回退分支：非 http(s) 协议、单文件超 50MB、fetch/HTTP 失败 → 浏览器直链 <a download>
// （用户仍拿到文件但不入库）。完成后置 idle 避免队列 UI 卡「下载中」。
//
// 单一写入纪律（store 文件头）：STATE 写入一律经 store 导出写函数——本模块经 ctx 注入
// 取得，对 store 零运行时依赖（DownloadTask 为 type-only，编译期擦除 → check-circular 无环）。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import type { DownloadTask } from "./download-queue-store.ts";

// ADR-123 P1：web 下载入库大小上限——超限回退浏览器直链（fetch 整文件进内存 +
// base64 转换对大文件内存压力大，web-common 的 DetectContainerType 同款 50MB 量级守卫）
const WEB_DOWNLOAD_IDB_LIMIT = 50 * 1024 * 1024;
/** 网页版单文件 fetch 超时（code_review P2）：挂起服务器不永久卡队列，超时走直链兜底 */
const WEB_DOWNLOAD_FETCH_TIMEOUT_MS = 15_000;

/** store 写函数注入（download-queue-store 导出写入口；调用点注入保持本模块零运行时依赖） */
export interface WebEnqueueCtx {
  /** 设当前下载文件并 notify */
  markCurrentFile: (name: string) => void;
  /** 剩余计数 -1 并 notify */
  decrementRemaining: () => void;
  /** 累积队列错误（notify 延迟到下一次 decrementRemaining） */
  addQueueError: (name: string, err: string) => void;
  /** 分支收尾置 idle（含失败路径，不留 downloading 残态） */
  rollbackToIdle: () => void;
}

/** 触发浏览器直链保存（web 下载回退分支：大文件 / 协议不符 / fetch 失败） */
function triggerAnchorDownload(url: string, name: string): void {
  if (!url) throw new Error("空下载地址");
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "";
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 网页版入队分支：逐任务 fetch→IDB 入库 / 直链兜底，汇总反馈与刷新广播。
 * 由 download-queue-store.enqueueDownloads 在 isWebPlatform() 时委托调用。
 */
export async function runWebEnqueue(tasks: DownloadTask[], ctx: WebEnqueueCtx): Promise<void> {
  let imported = 0;
  let failed = 0;
  let fallback = 0;
  // P2 修复（code_review）：fetch 无超时 → 挂起服务器可永久卡队列（downloading 态 +
  // 重入守卫丢弃后续入队 + web 模式无取消路径）。逐任务 AbortController 超时，
  // 超时走既有直链兜底；分支级 try/finally 保证任何意外异常都复位 idle。
  try {
    const { importWebFiles } = await import("@/backend/browser-adapter.ts");
    // 目标类型段：cmDqEnqueue 已把 GetRepoRoot 结果写入 saveDir，web 模式恒为
    // /web/<type>（web-fs.ts GetRepoRoot），从根反解即可，不改 enqueueDownloads 签名
    const webType = (tasks[0]?.saveDir || "").split("/")[2] || "";
    for (const task of tasks) {
      ctx.markCurrentFile(task.name);
      let handled = false;
      if (/^https?:\/\//i.test(task.url || "") && (task.size || 0) <= WEB_DOWNLOAD_IDB_LIMIT) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), WEB_DOWNLOAD_FETCH_TIMEOUT_MS);
        try {
          const resp = await fetch(task.url, { signal: ctrl.signal });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const r = await importWebFiles([new File([blob], task.name || "model")], webType);
          imported += r.imported;
          failed += r.failed; // 导入层的扩展名/大小校验跳过属预期过滤，不回退直链
          handled = true;
        } catch (e) {
          dbg("enqueue:web-idb-fail", task.url, e); // 超时/CORS/网络失败 → 直链兜底
        } finally {
          clearTimeout(timer);
        }
      }
      if (!handled) {
        try {
          triggerAnchorDownload(task.url, task.name);
          fallback++;
        } catch (e) {
          failed++;
          ctx.addQueueError(task.name, String((e as Error)?.message || e));
        }
      }
      ctx.decrementRemaining();
    }
    // 汇总反馈对齐导入链路语义（importWebFilesWithToast 同款 toast + 刷新广播）
    bus.emit("toast:show", {
      msg:
        failed > 0
          ? t("community.downloadQueue.webDlFailed", { imported, fallback, failed })
          : fallback > 0
            ? t("community.downloadQueue.webDlFallback", { imported, fallback })
            : t("community.downloadQueue.webDlOk", { imported }),
      duration: TOAST_MS.verbose,
      type: failed > 0 ? "warn" : "success",
    });
    bus.emit("tree:reload");
    bus.emit("stats:refresh");
  } catch (e) {
    dbg("enqueue:web-branch-fail", e); // 意外异常不留 downloading 残态
  } finally {
    ctx.rollbackToIdle();
  }
}
