// ===== 仓库模型显示（共享逻辑，供 init-workshop.ts 和 init-github.ts 复用）=====

import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import { getApp } from "../../backend/app.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { stripDisableSuffix } from "../../utils/dom/display.ts";
import { RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { currentRepoType } from "../repo/repo-rtype.ts";
import { bindRepoEvents } from "./events.ts";
import type { WorkshopModel } from "./render.ts";
import { countMissing, renderRepoHeaderHTML } from "./render.ts";

/**
 * 模块级仓库渲染代际 token：每次用户请求递增，await 后若已被更新调用超越
 *（快速切换仓库乱序）则丢弃过期结果。原实现用函数局部 `_currentRepo`
 * 在入口处赋值为 repo，`_currentRepo !== repo` 恒为 false——防竞态守卫是死代码。
 *
 * 代际只认「用户请求」（2026-09-05 code_review #3 收窄）：bindRepoEvents 内部
 * doneTimer 下载完成重秀（internalRefresh=true）不 bump 代际——否则用户切到
 * 新仓 A 的慢扫描在途期间，旧仓 B 迟到的 doneTimer 重秀会 bump 掉 A（A 永不
 * 渲染）。内部重秀仅当目标 repo 仍是最近用户请求的 repo 才继续渲染。
 */
let _repoRenderGen = 0;
let _userRequestedRepo = ""; // 最近一次用户请求的 repo（workshop 单容器场景）

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
  internalRefresh = false,
): Promise<void> {
  const effectiveRtype = rtype || currentRepoType();
  // 代际守卫：仅「用户请求」递增代际并更新目标 repo；内部 doneTimer 重秀
  //（bindRepoEvents 下载完成回跳）不 bump——避免旧仓迟到重秀杀掉用户新切仓的
  // 在途扫描（code_review #3）。内部重秀若目标已非最近用户请求的 repo → 直接
  // 退出（用户已切走，旧仓刷新作废）。
  if (internalRefresh) {
    if (repo !== _userRequestedRepo) return; // 用户已切到别的仓，旧仓重秀作废
  } else {
    _userRequestedRepo = repo;
    _repoRenderGen++;
  }
  const myGen = _repoRenderGen;

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
      const entries =
        (await AppM.ScanModelEntriesWithLabel(
          filesRoot,
          RESOURCE_TYPE_LABELS[effectiveRtype] ?? effectiveRtype,
        )) || [];
      entries.forEach((e) => {
        const n = stripDisableSuffix(e.Name || "");
        localMap.set(n, e.Hash || "");
      });
    }
  } catch (e) {
    // 加载失败不影响列表显示，但本地哈希对比会静默失效（「已安装」判断降级）——留痕
    console.warn("[community] 本地扫描失败，已安装对比降级:", e);
  }
  if (myGen !== _repoRenderGen) return; // 已有更新调用，丢弃过期结果

  // 下载 URL 统一用 raw 前缀：Go 端 downloadFileWithQueue 按 LoadAppConfig().Mirror
  // 重排 raw/jsd/api 顺序（jsdelivr 直通会令 ResolveSavePath 解析失败、回退失效、子目录被扁平化）
  const dlPrefix = "https://raw.githubusercontent.com/" + repo + "/main/";

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

  if (myGen !== _repoRenderGen) return; // 已有更新调用，丢弃
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
  if (myGen !== _repoRenderGen) return; // 清理期间已有更新调用，丢弃

  // 委托 bindRepoEvents 管理所有事件 + 内部状态 (showAll/selectedSet/renderList)
  const { renderList, cleanup } = bindRepoEvents(searchResults, {
    esc,
    models,
    dlPrefix,
    repo,
    source,
    showRepoModels: () =>
      showRepoModels(
        esc,
        repoEventsCleanup,
        setRepoEventsCleanup,
        currentSite,
        setCurrentSite,
        repo,
        models,
        source,
        searchResults,
        effectiveRtype,
        // 内部 doneTimer 重秀：不 bump 代际、仅当仍是最新用户目标时才渲染
        //（code_review #3：防止旧仓迟到重秀杀掉用户新切仓在途扫描）
        true,
      ),
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
