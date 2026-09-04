// ===== 仓库模型显示（共享逻辑，供 init-workshop.ts 和 init-github.ts 复用）=====
import { getApp } from "../../backend/app.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { currentRepoType } from "../repo-rtype.ts";
import { countMissing, renderRepoHeaderHTML } from "./render.ts";
import { bindRepoEvents } from "./events.ts";
import type { WorkshopModel } from "./render.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import { stripDisableSuffix } from "../../utils/dom/display.ts";

/**
 * 显示 GitHub 仓库模型列表（比对本地已有文件）
 * 包含：本地扫描、sourceLabel构建、countMissing、renderRepoHeaderHTML、bindRepoEvents
 *
 * @param esc - HTML 转义函数
 * @param repoEventsCleanup - 前一次绑定清理函数
 * @param setRepoEventsCleanup - 设置清理函数
 * @param currentSite - 当前站点（用于 backToSite）
 * @param setCurrentSite - 设置当前站点
 * @param repo - 仓库名称（如 "user/repo"）
 * @param models - 模型列表
 * @param source - 数据源标识（"raw" | "jsd" | "api"）
 * @param searchResults - 搜索结果容器 DOM 元素
 * @param rtype - 资源类型（缺省取 currentRepoType()，GitHub 页显式传 YSM）
 */
export async function showRepoModels(
  esc: (s: unknown) => string,
  repoEventsCleanup: (() => Promise<void>) | null,
  setRepoEventsCleanup: (fn: (() => Promise<void>) | null) => void,
  currentSite: WorkshopSite | null,
  setCurrentSite: (site: WorkshopSite | null) => void,
  repo: string,
  models: WorkshopModel[],
  source: string,
  searchResults: HTMLElement,
  rtype?: string,
): Promise<void> {
  const effectiveRtype = rtype || currentRepoType();
  // _currentRepo 检测过时的异步响应（防快速切换乱序覆盖）
  let _currentRepo = "";
  _currentRepo = repo;

  // 加载本地仓库已有文件列表 + 镜像配置
  const localMap = new Map<string, string>();
  let mirror = "";
  try {
    const AppM = await getApp();
    const cfg = await AppM.LoadAppConfig();
    mirror = cfg.mirror || "";
    const filesRoot = AppM.GetRepoRoot ? await AppM.GetRepoRoot(effectiveRtype) : "";
    if (filesRoot) {
      if (AppM.ClearScanCache) await AppM.ClearScanCache();
      const entries = (await AppM.ScanModelEntriesWithLabel(filesRoot, RESOURCE_TYPE_LABELS[effectiveRtype] ?? effectiveRtype)) || [];
      entries.forEach((e) => {
        const n = stripDisableSuffix(e.Name || "");
        localMap.set(n, e.Hash || "");
      });
    }
  } catch (e) {
    // 加载失败不影响列表显示，但本地哈希对比会静默失效（「已安装」判断降级）——留痕
    console.warn("[community] 本地扫描失败，已安装对比降级:", e);
  }
  if (_currentRepo !== repo) return; // 已切换仓库，丢弃过期结果

  // 下载 URL 统一用 raw 前缀：Go 端 downloadFileWithQueue 按 LoadAppConfig().Mirror
  // 重排 raw/jsd/api 顺序（jsdelivr 直通会令 ResolveSavePath 解析失败、回退失效、子目录被扁平化）
  const dlPrefix =
    "https://raw.githubusercontent.com/" + repo + "/main/";

  const sourceLabel =
    (source === "raw"
      ? '<span class="link-badge link-badge-raw">raw</span>'
      : source === "jsd"
        ? '<span class="link-badge link-badge-jsd">⚡jsd</span>'
        : source === "api"
          ? '<span class="link-badge link-badge-api">API</span>'
          : "") +
    (mirror === "jsdelivr"
      ? '<span class="link-badge link-badge-cdn">⚡CDN</span>'
      : mirror === "githubapi"
        ? '<span class="link-badge link-badge-ghapi">🐙API</span>'
        : "");

  const missingCount = countMissing(models, localMap);

  if (_currentRepo !== repo) return; // 已切换，丢弃
  searchResults.innerHTML = renderRepoHeaderHTML({
    esc,
    repo,
    sourceLabel,
    modelsLength: models.length,
    missingCount,
  });

  // 清理前一次绑定
  if (repoEventsCleanup) {
    try {
      await repoEventsCleanup();
    } catch (e) {
      // P3 修复（审核）：cleanup（含 queue.cancel）失败不阻断新仓库绑定——
      // 原裸 await 会把 reject 逸出成 unhandled rejection，且中断 showRepoModels
      dbg("repo-events", "清理旧仓库事件失败:", (e as Error)?.message);
    }
  }
  if (_currentRepo !== repo) return; // 清理期间已切换，丢弃

  // 委托 bindRepoEvents 管理所有事件 + 内部状态 (showAll/selectedSet/renderList)
  const { renderList, cleanup } = bindRepoEvents(searchResults, {
    esc,
    models,
    dlPrefix,
    repo,
    source,
    showRepoModels: () => showRepoModels(esc, repoEventsCleanup, setRepoEventsCleanup, currentSite, setCurrentSite, repo, models, source, searchResults, effectiveRtype),
    backToSite: () => {
      if (currentSite) {
        setCurrentSite(currentSite); // 触发重新渲染
      }
    },
    localMap,
  });
  setRepoEventsCleanup(cleanup);

  // 初始渲染（renderList 内部经虚拟列表写入 #gh-repo-list）
  renderList();
}
