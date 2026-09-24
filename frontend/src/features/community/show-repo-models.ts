// ===== 仓库模型显示（共享逻辑，供 init-workshop.ts 和 init-github.ts 复用）=====
//
// P0 整改：代际守卫封装为 createRepoRenderGuard() 工厂，消除模块级可变全局。
// 模块级 defaultRepoGuard 保持既有消费者零改动。
// ADR-190 D1a / R8 销账：头部 HTML 模板归 views/app-content/tpl-workshop.ts，经 tpl 参数注入；
// init-github.ts 同属 views，直接消费同一模板。

import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { stripDisableSuffix } from "@/utils/model-name/display.ts";
import { RESOURCE_TYPE_LABELS } from "@/utils/resource/types.ts";
import { communityGetApp } from "./community-deps.ts";
import { bindRepoEvents } from "./events.ts";
import { countMissing, type RepoTpl, type WorkshopModel } from "./render.ts";

/**
 * 仓库渲染代际守卫：每次用户请求递增，await 后若已被更新调用超越
 *（快速切换仓库乱序）则丢弃过期结果。
 *
 * 代际只认「用户请求」（2026-09-05 code_review #3 收窄）：bindRepoEvents 内部
 * doneTimer 下载完成重秀（internalRefresh=true）不 bump 代际——否则用户切到
 * 新仓 A 的慢扫描在途期间，旧仓 B 迟到的 doneTimer 重秀会 bump 掉 A（A 永不
 * 渲染）。内部重秀仅当目标 repo 仍是最近用户请求的 repo 才继续渲染。
 */
export interface RepoRenderGuard {
  /** 用户请求时调用：递增代际并更新目标 repo */
  bump(repo: string): void;
  /** 内部重秀时调用：检查目标 repo 是否仍是最新用户请求 */
  isCurrent(repo: string): boolean;
  /** 获取当前代际 token */
  readonly generation: number;
}

/**
 * 创建独立的仓库渲染代际守卫（测试可注入）。
 * 生产代码使用模块级 defaultRepoGuard，无需手动创建。
 */
export function createRepoRenderGuard(): RepoRenderGuard {
  let repoRenderGen = 0;
  let userRequestedRepo = "";

  return {
    bump(repo: string): void {
      userRequestedRepo = repo;
      repoRenderGen++;
    },
    isCurrent(repo: string): boolean {
      return repo === userRequestedRepo;
    },
    get generation(): number {
      return repoRenderGen;
    },
  };
}

/** 模块级默认代际守卫（生产代码消费方零改动） */
const defaultRepoGuard = createRepoRenderGuard();

/**
 * 显示 GitHub 仓库模型列表（比对本地已有文件）
 * 包含：本地扫描、mirror 读取、countMissing、tpl.repoHeaderHTML、bindRepoEvents
 *
 * @param esc - HTML 转义函数
 * @param prevRepoEventsCleanup - 读「前一次绑定清理」的 getter（页内可替换槽，ADR-260）
 * @param setRepoEventsCleanup - 写回新清理（同槽 setter）
 * @param currentSite - 当前站点（用于 backToSite）
 * @param setCurrentSite - 设置当前站点
 * @param repo - 仓库名称（如 "user/repo"）
 * @param models - 模型列表
 * @param source - 数据源标识（"raw" | "jsd" | "api"）
 * @param searchResults - 搜索结果容器 DOM 元素
 * @param tpl - 仓库页 DOM 模板（ADR-190 D1a，组合根注入 workshopTpl；内部重秀原样透传）
 * @param rtype - 资源类型（缺省取 currentRepoType()，GitHub 页显式传 YSM）
 * @param internalRefresh - 是否内部重秀（doneTimer 回跳）
 * @param guard - 代际守卫（缺省走模块级 defaultRepoGuard）
 */
export async function showRepoModels(
  esc: (s: unknown) => string,
  prevRepoEventsCleanup: (() => Promise<void>) | null,
  setRepoEventsCleanup: (fn: (() => Promise<void>) | null) => void,
  currentSite: WorkshopSite | null,
  setCurrentSite: (site: WorkshopSite | null) => void,
  repo: string,
  models: WorkshopModel[],
  source: string,
  searchResults: HTMLElement,
  tpl: RepoTpl,
  rtype?: string,
  internalRefresh = false,
  guard: RepoRenderGuard = defaultRepoGuard,
): Promise<void> {
  const effectiveRtype = rtype || currentRepoType();
  // 代际守卫：仅「用户请求」递增代际并更新目标 repo；内部 doneTimer 重秀不 bump
  if (internalRefresh) {
    if (!guard.isCurrent(repo)) return; // 用户已切到别的仓，旧仓重秀作废
  } else {
    guard.bump(repo);
  }
  const myGen = guard.generation;

  // 加载本地仓库已有文件列表 + 镜像配置
  const localMap = new Map<string, string>();
  let mirror = "";
  try {
    const AppM = await communityGetApp();
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
  if (myGen !== guard.generation) return; // 已有更新调用，丢弃过期结果

  // 下载 URL 统一用 raw 前缀：Go 端 downloadFileWithQueue 按 LoadAppConfig().Mirror
  // 重排 raw/jsd/api 顺序（jsdelivr 直通会令 ResolveSavePath 解析失败、回退失效、子目录被扁平化）
  const dlPrefix = `https://raw.githubusercontent.com/${repo}/main/`;

  const missingCount = countMissing(models, localMap);

  if (myGen !== guard.generation) return; // 已有更新调用，丢弃
  // 头部模板归 views（ADR-190 D1a）：source/mirror 作纯数据传入，徽章派生在 tpl 内收口
  searchResults.innerHTML = tpl.repoHeaderHTML({
    repo,
    source,
    mirror,
    modelsLength: models.length,
    missingCount,
  });

  // 清理前一次绑定
  if (prevRepoEventsCleanup) {
    try {
      await prevRepoEventsCleanup();
    } catch (e) {
      // P3 修复（审核）：cleanup（含 queue.cancel）失败不阻断新仓库绑定——
      // 原裸 await 会把 reject 逸出成 unhandled rejection，且中断 showRepoModels
      dbg("repo-events", "清理旧仓库事件失败:", (e as Error)?.message);
    }
  }
  if (myGen !== guard.generation) return; // 清理期间已有更新调用，丢弃

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
        prevRepoEventsCleanup,
        setRepoEventsCleanup,
        currentSite,
        setCurrentSite,
        repo,
        models,
        source,
        searchResults,
        tpl,
        effectiveRtype,
        // 内部 doneTimer 重秀：不 bump 代际、仅当仍是最新用户目标时才渲染
        //（code_review #3：防止旧仓迟到重秀杀掉用户新切仓在途扫描）
        true,
        guard,
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
