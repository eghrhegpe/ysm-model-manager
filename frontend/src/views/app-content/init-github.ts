// ===== GitHub 页初始化（为 app-content/index.ts 减负，ADR-040）=====
import { getApp } from "../../backend/app.ts";
import { swallowError } from "../../utils/core/async.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { stagger } from "../../utils/animation/stagger.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { countMissing, renderRepoHeaderHTML } from "../../features/community/render.ts";
import { bindRepoEvents } from "../../features/community/events.ts";
import { tryFetchModels } from "../../features/community/data.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { esc as escUtil } from "../../utils/dom/html.ts";
import type { WorkshopModel } from "../../features/community/render.ts";
import { stripBanSuffix } from "../../utils/dom/display.ts";
import type { AppContentHost } from "./init-workshop.ts";
import type { RepoCacheEntry } from "./state.ts";

/**
 * GitHub 社群页编排上下文——把 initGithubPage 各闭包捕获的共享状态显式注入，
 * 供 githubLoadRepos / githubShowRepo / githubRenderModels 三个包级函数复用。
 * 交叉引用字段（showRepo/loadRepos/renderModels）在创建后接线，保证同一代际。
 */
export interface GithubPageCtx {
  _root: ShadowRoot;
  _githubCache: () => Map<string, RepoCacheEntry> | null;
  _setGithubCache: (cache: Map<string, RepoCacheEntry> | null) => void;
  _repoEventsCleanup: () => (() => Promise<void>) | null;
  _setRepoEventsCleanup: (fn: (() => Promise<void>) | null) => void;
  grid: HTMLElement | null;
  resultsBody: HTMLElement | null;
  sourceInfo: HTMLElement | null;
  /** _currentRepo 竞态守卫：读写同一代际，防止多闭包异步响应乱序覆盖 */
  getCurrentRepo: () => string;
  setCurrentRepo: (repo: string) => void;
  showRepo: (repo: string) => Promise<void>;
  loadRepos: () => Promise<void>;
  renderModels: (
    repo: string,
    models: WorkshopModel[],
    source: string,
    localMap: Map<string, string>,
  ) => Promise<void>;
}

/**
 * 拉取仓库列表并渲染 gh-card（stagger 动画 + data-repo 标识），绑定点击切 active。
 */
async function githubLoadRepos(ctx: GithubPageCtx): Promise<void> {
  const grid = ctx.grid;
  const sourceInfo = ctx.sourceInfo;
  if (grid) {
    grid.innerHTML =
      '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' + t("downloads.loading") + "</div>";
  }
  try {
    const App = await getApp();
    const repos = await App.LoadGitHubRepos();
    const ghCreators = repos || [];
    if (sourceInfo)
      sourceInfo.textContent = t("downloads.repoCountDesc", { n: ghCreators.length });
    if (!ghCreators.length) {
      if (grid) {
        grid.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">' +
          t("downloads.noRepos") +
          "</div>";
      }
      return;
    }
    if (grid) {
      grid.innerHTML = ghCreators
        .map(
          (cr, idx) =>
            '<div class="gh-card gh-repo-card" style="animation-delay:' + stagger(idx, 30, 300) + 'ms" data-repo="' +
            escUtil(cr.name) +
            '">' +
            '<div class="gh-card-body">' +
            '<div class="ws-name" style="font-size:11px">🐙 ' +
            escUtil(cr.name) +
            "</div>" +
            '<div class="ws-desc" style="font-size:9px">' +
            escUtil(cr.desc) +
            "</div>" +
            "</div></div>",
        )
        .join("");
      // 点击仓库
      grid.querySelectorAll(".gh-repo-card").forEach((card) => {
        card.addEventListener("click", () => {
          grid
            .querySelectorAll(".gh-card")
            .forEach((c) => c.classList.remove("active"));
          card.classList.add("active");
          const repo = (card as HTMLElement).dataset.repo || "";
          ctx.showRepo(repo);
        });
      });
    }
  } catch (e) {
    if (grid) {
      grid.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">' +
        t("common.loadFailed") +
        "</div>";
    }
  }
}

/**
 * 展示仓库模型列表：本地扫描 + 缓存命中即渲染；未命中走镜像竞速（onProgress 更新加载态、
 * fetchDone 去重）。_currentRepo 竞态守卫在每次异步边界后检查。
 */
async function githubShowRepo(ctx: GithubPageCtx, repo: string): Promise<void> {
  ctx.setCurrentRepo(repo);
  const resultsBody = ctx.resultsBody;
  const repoModelCache = ctx._githubCache()!;
  if (resultsBody) {
    resultsBody.innerHTML =
      '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' +
      t("downloads.loadingModels") +
      "</div>";
  }
  // 使用缓存
  if (repoModelCache.has(repo)) {
    const cached = repoModelCache.get(repo);
    if (cached) {
      const { models, source, localMap } = cached;
      if (ctx.getCurrentRepo() !== repo) return; // 已切换，丢弃
      ctx.renderModels(repo, models, source, localMap || new Map());
      return;
    }
  }
  let mirror = "";
  try {
    const { LoadAppConfig, ScanModelEntriesWithLabel, GetRepoRoot } =
      await getApp();
    const cfg = await LoadAppConfig();
    mirror = cfg.mirror || "";
    const filesRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
    const localMap = new Map<string, string>();
    if (filesRoot) {
      const entries = (await ScanModelEntriesWithLabel(filesRoot, RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
      entries.forEach((e) => {
        const n = stripBanSuffix(e.Name || "");
        localMap.set(n, e.Hash || "");
      });
    }
    let fetchDone = false;
    const result = await tryFetchModels(repo, (mirror || "") as "" | "jsdelivr" | "githubapi", (pct, label) => {
      if (fetchDone || ctx.getCurrentRepo() !== repo) return;
      if (resultsBody) {
        resultsBody.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' +
          (label || t("common.loading")) +
          "</div>";
      }
    });
    fetchDone = true;
    if (result && result.models) {
      repoModelCache.set(repo, {
        models: result.models as WorkshopModel[],
        source: result.source,
        localMap,
      });
      if (ctx.getCurrentRepo() !== repo) return;
      ctx.renderModels(repo, result.models as WorkshopModel[], result.source, localMap);
    } else {
      if (ctx.getCurrentRepo() !== repo) return;
      if (resultsBody) {
        resultsBody.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ ' +
          t("downloads.noModelList") +
          "</div>" +
          '<div style="text-align:center;padding:8px"><button class="btn-base sm ws-btn-txt" id="gh-open-repo-dl">↗ ' +
          t("downloads.openInGithub") +
          "</button></div>";
      }
    }
  } catch (e) {
    const err = e as Error;
    if (ctx.getCurrentRepo() !== repo) return;
    const msg =
      err.message === "NetworkOffline"
        ? t("workshop.networkOffline")
        : err.message === "NoIndex"
          ? t("workshop.githubNoIndex")
          : err.message === "RateLimited"
            ? t("workshop.rateLimitedGithub")
            : t("workshop.githubLoadFailed");
    if (resultsBody) {
      resultsBody.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ ' +
        escUtil(msg) +
        "</div>" +
        '<div style="text-align:center;padding:8px"><button class="btn-base sm ws-btn-txt" id="gh-open-repo">↗ ' +
        t("downloads.openInGithub") +
        "</button></div>";
    }
  }
  // 绑定打开 GitHub 按钮
  const openBtn = resultsBody?.querySelector("#gh-open-repo, #gh-open-repo-dl");
  if (openBtn)
    openBtn.addEventListener("click", () => {
      swallowError(getApp().then(({ OpenInBrowser }) =>
        OpenInBrowser("https://github.com/" + repo),
      ));
    });
}

/**
 * 渲染仓库模型表头：dlPrefix/sourceLabel/countMissing + renderRepoHeaderHTML，
 * 清理前次 _repoEventsCleanup（失败 dbg 不阻断），bindRepoEvents 委托 + renderList。
 */
async function githubRenderModels(
  ctx: GithubPageCtx,
  repo: string,
  models: WorkshopModel[],
  source: string,
  localMap: Map<string, string>,
): Promise<void> {
  try {
    const resultsBody = ctx.resultsBody;
    // 同上：下载 URL 统一 raw，镜像优先级由 Go 端 mirror 配置统一重排
    const dlPrefix =
      "https://raw.githubusercontent.com/" + repo + "/main/";
    const sourceLabel =
      source === "raw"
        ? '<span class="link-badge link-badge-raw">raw</span>'
        : source === "jsd"
          ? '<span class="link-badge link-badge-jsd">⚡jsd</span>'
          : source === "api"
            ? '<span class="link-badge link-badge-api">API</span>'
            : "";
    const missingCount = countMissing(models, localMap);
    if (resultsBody) {
      resultsBody.innerHTML = renderRepoHeaderHTML({
        esc: (s) => escUtil(s),
        repo,
        sourceLabel,
        modelsLength: models.length,
        missingCount,
      });
      // 清理前一次绑定
      const prevCleanup = ctx._repoEventsCleanup();
      if (prevCleanup) {
        try {
          await prevCleanup();
        } catch (e) {
          // 与 init-workshop 同模式（c7cd6363 漏修此处）：cleanup（含 queue.cancel）
          // 失败不阻断新仓库绑定——裸 await 会把 reject 逸出成 unhandled rejection
          dbg("repo-events", "清理旧仓库事件失败:", (e as Error)?.message);
        }
      }
      const { renderList, cleanup } = bindRepoEvents(resultsBody, {
        esc: (s) => escUtil(s),
        models,
        dlPrefix,
        repo,
        source,
        showRepoModels: () => ctx.showRepo(repo),
        backToSite: () => ctx.loadRepos(),
        localMap,
      });
      ctx._setRepoEventsCleanup(cleanup);
      // 初始渲染（renderList 内部经虚拟列表写入 #gh-repo-list）
      renderList();
    }
  } catch (e) {
    // P3 修复（审核）：renderModels 是 fire-and-forget async（showRepo 不 await），
    // bindRepoEvents/renderList 同步抛错会逸出成 unhandled rejection 且用户零反馈；
    // 统一 catch 出口留痕（dbg），不阻断页面其余功能
    dbg("github-render", "渲染仓库模型失败:", (e as Error)?.message);
  }
}

/**
 * 初始化 GitHub 页（纯分派：创建 ctx + 初始化缓存 + 触发 loadRepos）
 */
export function initGithubPage(host: AppContentHost): void {
  if (!host._githubCache) host._setGithubCache(new Map());
  // _currentRepo 用于检测过时的异步响应（竞态防护），多闭包共享同一代际
  let _currentRepo = "";
  const ctx = {
    _root: host._root,
    _githubCache: () => host._githubCache,
    _setGithubCache: (cache: Map<string, RepoCacheEntry> | null) => host._setGithubCache(cache),
    _repoEventsCleanup: () => host._repoEventsCleanup,
    _setRepoEventsCleanup: (fn: (() => Promise<void>) | null) => host._setRepoEventsCleanup(fn),
    grid: host._root.getElementById("gh-grid") as HTMLElement | null,
    resultsBody: host._root.getElementById("gh-results-body") as HTMLElement | null,
    sourceInfo: host._root.getElementById("gh-source-info") as HTMLElement | null,
    getCurrentRepo: () => _currentRepo,
    setCurrentRepo: (repo: string): void => {
      _currentRepo = repo;
    },
  } as GithubPageCtx;
  ctx.showRepo = (repo) => githubShowRepo(ctx, repo);
  ctx.loadRepos = () => githubLoadRepos(ctx);
  ctx.renderModels = (repo, models, source, localMap) =>
    githubRenderModels(ctx, repo, models, source, localMap);
  ctx.loadRepos();
}