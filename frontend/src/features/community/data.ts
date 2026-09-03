// ===== 创意工坊数据加载（类型化版 — ADR-014 P3 features）=====
// tryFetchModels + 进度条
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { esc } from "../../utils/dom/html.ts";
import { hasRecycleSegment } from "../../utils/recycle-path.ts";

/**
 * 创建进度条 UI（插入到 searchResults 容器）
 */
export function showProgress(
  searchResults: HTMLElement,
  pct: number,
  label?: string,
): void {
  // P3 修复（审核发现）：pct 无钳制会输出 width:"NaN%"/"150%"/"-5%"——
  // 数值守卫范式（AGENTS §3.4 ②）拦截非有限值并钳制到 [0,100]
  const clamped = Number.isFinite(pct)
    ? Math.min(100, Math.max(0, Math.round(pct)))
    : 0;
  // P3 修复（审核发现）：label 未经转义直接拼入 innerHTML——当前调用方
  // 全部使用硬编码字符串（无 XSS 风险），但函数是 export 的公共 API，
  // 未来若传入用户可控数据即构成 XSS；统一转义（硬编码字符串转义无副作用）
  const safeLabel = esc(label || "");
  searchResults.innerHTML =
    '<div class="gh-progress-box">' +
    '<div class="gh-progress-label">' +
    '<span class="gh-progress-spin">⏳</span> ' +
    '<span class="gh-progress-text">' +
    safeLabel +
    "</span></div>" +
    '<div class="gh-progress-track">' +
    '<div class="gh-progress-fill' +
    (clamped < 100 ? " gh-striped" : "") +
    '" style="width:' +
    clamped +
    "%;transition:width 0.3s" +
    '"></div>' +
    "</div>" +
    "</div>";
}

/** 抓取结果 */
export interface FetchModelsResult {
  models: unknown[];
  source: string;
}

type MirrorStrategy = "" | "jsdelivr" | "githubapi";

// 回收站段判定：[G5 收口] 由 utils/recycle-path.ts `hasRecycleSegment` 单一实现
// （命名对齐 Go sync.hasRecycleSegment；原本地 isRecyclePath 已删除）。
// 语义背景：仓库 index.json 可能把 `.recycle/…` 下已删/待清理文件也索引进列表——
// 加载端须过滤，否则文件出现在创意工坊下载列表；且 Go 下载器会 stripRecycleSegments
// 剥掉该段，剥后仅剩文件名者落到仓库根（观感即"下载平铺到根目录"）。

/** 单个镜像源抓取条目 */
type FetchAttempt = { name: string; url: string; label: string };

/** 竞速期间共享的可变状态（fetchOne 写，waitForReady / 汇总读） */
interface FetchRaceState {
  earlyExitReason: string | null;
  succeeded: boolean;
  controllers: AbortController[];
}

/**
 * 构造三个镜像源 attempts 数组，并按 mirror 策略调整请求顺序
 * （仅影响最先被展示的顺序，并发竞速时无实质区别）
 */
function buildFetchModelsAttempts(
  repo: string,
  mirror: MirrorStrategy,
): FetchAttempt[] {
  const attempts: FetchAttempt[] = [
    {
      name: "raw",
      url: "https://raw.githubusercontent.com/" + repo + "/main/index.json",
      label: "⏳ 正在连接 raw.githubusercontent.com…",
    },
    {
      name: "jsd",
      url: "https://cdn.jsdelivr.net/gh/" + repo + "@main/index.json",
      label: "⏳ 正在连接 cdn.jsdelivr.net…",
    },
    {
      name: "api",
      url: "https://api.github.com/repos/" + repo + "/contents/index.json",
      label: "⏳ 正在连接 api.github.com…",
    },
  ];
  if (mirror === "jsdelivr") return [attempts[1], attempts[0], attempts[2]];
  if (mirror === "githubapi") return [attempts[2], attempts[0], attempts[1]];
  return attempts;
}

/**
 * 向单个镜像源发起 index.json 抓取（AbortController 超时 + 404 只认 raw 确定性
 * + GitHub API base64 去 [\r\n\s] 再 atob）
 */
async function fetchModelsOne(
  attempt: FetchAttempt,
  state: FetchRaceState,
  timeoutMs: number,
): Promise<FetchModelsResult> {
  // 如果已经提前退出或已有成功结果，直接抛错（不再发请求）
  if (state.earlyExitReason) throw new Error(state.earlyExitReason);
  if (state.succeeded) throw new Error("already succeeded");
  const ctrl = new AbortController();
  state.controllers.push(ctrl);
  const tmr = setTimeout(function (): void {
    ctrl.abort();
  }, timeoutMs);
  try {
    const resp = await fetch(attempt.url, { signal: ctrl.signal });
    clearTimeout(tmr);
    if (!resp.ok) {
      // 404 处理：仅 raw 源 404 视为确定性证据（仓库确实无 index.json）——
      // jsd/api 404 可能是 CDN 缓存未命中/限流，误杀本可成功的在途请求
      // （P2 修复：原实现任一源 404 即 abort 全部）
      if (resp.status === 404 && attempt.name === "raw") {
        state.earlyExitReason = "NoIndex";
        state.controllers.forEach(function (c): void {
          // P4：abort 在规范中不抛错，此处 try/catch 仅为防御（无需上报）
          try {
            c.abort();
          } catch (_) {
            /* abort 防御性保护 */
          }
        });
      }
      throw new Error("HTTP " + resp.status);
    }
    let models: unknown;
    if (attempt.name === "api") {
      const data = (await resp.json()) as {
        encoding?: string;
        content?: string;
      };
      if (data.encoding !== "base64" || data.content == null)
        throw new Error("no content");
      // P2 修复（审核发现）：GitHub API base64 可能含 \r\n 换行——原只去 \n，
      // \r 残留令 atob 抛错 → 误判 AllFailed；统一去 [\r\n\s]
      const binary = atob(data.content.replace(/[\r\n\s]/g, ""));
      const bytes = Uint8Array.from(binary, function (c): number {
        return c.charCodeAt(0);
      });
      models = JSON.parse(new TextDecoder().decode(bytes));
    } else {
      models = await resp.json();
    }
    if (Array.isArray(models)) {
      state.succeeded = true;
      return { models, source: attempt.name };
    }
  } catch (err) {
    clearTimeout(tmr);
    throw err;
  }
  throw new Error("invalid payload");
}

/**
 * 轮询等待延时到位（每 200ms 检查一次）；若竞速期间已提前退出或有成功结果，
 * 立即以 _earlyExit 标记返回，避免 p2/p3 发出迟到/孤儿请求（P2 修复）
 */
function fetchModelsWaitForReady(
  getReady: () => boolean,
  state: FetchRaceState,
): Promise<{ _earlyExit: boolean }> {
  return new Promise(function (resolve): void {
    const check = function (): void {
      // 已有成功结果也算提前退出：p2/p3 不再发出（P2 修复）
      if (state.earlyExitReason || state.succeeded) {
        resolve({ _earlyExit: true });
        return;
      }
      if (getReady()) {
        resolve({ _earlyExit: false });
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

/**
 * 全部源失败的根因诊断（404→NoIndex / 403→RateLimited / 网络→NetworkOffline，
 * 否则 AllFailed）；提前退出原因优先透传
 */
function classifyFetchModelsError(
  aggErr: unknown,
  earlyExitReason: string | null,
): never {
  if (earlyExitReason) throw new Error(earlyExitReason);
  // 全部失败 — 诊断根因
  const reasons = (aggErr as { errors?: Array<{ message?: string }> }).errors
    ? (aggErr as { errors: Array<{ message?: string }> }).errors.map(
        function (e): string {
          return safeErrorMessage(e);
        },
      )
    : [safeErrorMessage(aggErr)];

  let has404 = false;
  let hasNetwork = false;
  let hasRateLimit = false;

  for (let i = 0; i < reasons.length; i++) {
    const msg = reasons[i];
    if (msg.indexOf("HTTP 404") >= 0) has404 = true;
    else if (msg.indexOf("HTTP 403") >= 0) hasRateLimit = true;
    else if (
      msg.indexOf("fetch") >= 0 ||
      msg.indexOf("network") >= 0 ||
      msg.indexOf("NetworkError") >= 0
    )
      hasNetwork = true;
  }

  // 只要有一个 404，就认为是仓库缺少索引文件（jsDelivr 的 404 是确定性证据）
  if (has404) throw new Error("NoIndex");
  if (hasRateLimit) throw new Error("RateLimited");
  if (hasNetwork) throw new Error("NetworkOffline");
  throw new Error("AllFailed");
}

/**
 * 从 GitHub 获取 index.json（并发竞速：同时请求所有镜像源，取最快响应）
 * @param repo "owner/repo"
 * @param mirror 镜像策略 ("", "jsdelivr", "githubapi")
 * @param onProgress 进度回调 (pct, label)
 */
export async function tryFetchModels(
  repo: string,
  mirror: MirrorStrategy,
  onProgress?: (pct: number, label: string) => void,
): Promise<FetchModelsResult> {
  // 构造三个镜像源并按策略排序
  const sorted = buildFetchModelsAttempts(repo, mirror);
  if (onProgress) onProgress(10, "⏳ 连接镜像源…");

  // 竞速期间共享的可变状态（fetchOne 写 / 汇总读）
  const state: FetchRaceState = {
    earlyExitReason: null,
    succeeded: false,
    controllers: [],
  };
  const TIMEOUT = 8000;

  if (onProgress) onProgress(10, "⏳ 发出首个请求…");

  // 延时并发：第一个请求立即发出，后续每 2 秒启动一个（不等前一个完成）
  // 兼顾速度（jsDelivr 可能 1 秒内响应）和带宽（不一次性发 3 个请求）
  const p1 = fetchModelsOne(sorted[0], state, TIMEOUT);

  // 延迟 2 秒启动第二个，延迟 4 秒启动第三个（但若已提前退出则跳过）
  let p2Ready = false;
  let p3Ready = false;
  setTimeout(function (): void {
    p2Ready = true;
  }, 2000);
  setTimeout(function (): void {
    p3Ready = true;
  }, 4000);

  const p2 = fetchModelsWaitForReady(() => p2Ready, state).then(function (r) {
    if (r._earlyExit) throw new Error(state.earlyExitReason || "early exit");
    if (onProgress) onProgress(30, "⏳ 发出第二个请求…");
    return fetchModelsOne(sorted[1], state, TIMEOUT);
  });

  const p3 = fetchModelsWaitForReady(() => p3Ready, state).then(function (r) {
    if (r._earlyExit) throw new Error(state.earlyExitReason || "early exit");
    if (onProgress) onProgress(50, "⏳ 发出第三个请求…");
    return fetchModelsOne(sorted[2], state, TIMEOUT);
  });

  // 用 Promise.any 取第一个成功的结果
  try {
    const result = await Promise.any([p1, p2, p3]);
    state.controllers.forEach((c) => c.abort());
    if (onProgress) onProgress(100, "✅ 加载完成");
    // 过滤回收站条目：.recycle 段下的"已删/待清理"文件不进下载列表（防下载剥段平铺根 + 语义上本就不该下载）
    return {
      models: (result.models as Array<{ path?: unknown }>).filter(
        (m) => !hasRecycleSegment(typeof m?.path === "string" ? m.path : ""),
      ),
      source: result.source,
    };
  } catch (aggErr) {
    // 如果提前退出抛出的明确错误直接透传，否则诊断根因
    classifyFetchModelsError(aggErr, state.earlyExitReason);
  }
}
