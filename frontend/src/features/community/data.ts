// ===== 创意工坊数据加载（类型化版 — ADR-014 P3 features）=====
// tryFetchModels + 进度条

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
  searchResults.innerHTML =
    '<div class="gh-progress-box">' +
    '<div class="gh-progress-label">' +
    '<span class="gh-progress-spin">⏳</span> ' +
    '<span class="gh-progress-text">' +
    (label || "") +
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
  const attempts: Array<{ name: string; url: string; label: string }> = [
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

  // 按镜像策略调整顺序（仅影响 which 最先被展示，并发竞速时无实质区别）
  const sorted =
    mirror === "jsdelivr"
      ? [attempts[1], attempts[0], attempts[2]]
      : mirror === "githubapi"
        ? [attempts[2], attempts[0], attempts[1]]
        : attempts;

  if (onProgress) onProgress(10, "⏳ 连接镜像源…");

  const controllers: AbortController[] = [];
  const TIMEOUT = 8000;
  // 共享标志：当某个请求明确返回 404 时，提前终止所有请求
  let _earlyExitReason: string | null = null;
  // P2 修复：某个源已成功返回后置位，p2/p3 的延迟定时器到点时不再发出迟到请求，
  // 避免「首源快速成功仍烧带宽/限流」的孤儿请求
  let _succeeded = false;

  const fetchOne = async (
    attempt: { name: string; url: string; label: string },
  ): Promise<FetchModelsResult> => {
    // 如果已经提前退出或已有成功结果，直接抛错（不再发请求）
    if (_earlyExitReason) throw new Error(_earlyExitReason);
    if (_succeeded) throw new Error("already succeeded");
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const tmr = setTimeout(function (): void {
      ctrl.abort();
    }, TIMEOUT);
    try {
      const resp = await fetch(attempt.url, { signal: ctrl.signal });
      clearTimeout(tmr);
      if (!resp.ok) {
        // 404 处理：仅 raw 源 404 视为确定性证据（仓库确实无 index.json）——
        // jsd/api 404 可能是 CDN 缓存未命中/限流，误杀本可成功的在途请求
        // （P2 修复：原实现任一源 404 即 abort 全部）
        if (resp.status === 404 && attempt.name === "raw") {
          _earlyExitReason = "NoIndex";
          controllers.forEach(function (c): void {
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
        _succeeded = true;
        return { models, source: attempt.name };
      }
    } catch (err) {
      clearTimeout(tmr);
      throw err;
    }
    throw new Error("invalid payload");
  };

  // 延时并发：第一个请求立即发出，后续每 2 秒启动一个（不等前一个完成）
  // 兼顾速度（jsDelivr 可能 1 秒内响应）和带宽（不一次性发 3 个请求）
  if (onProgress) onProgress(10, "⏳ 发出首个请求…");

  // 启动第一个请求
  const p1 = fetchOne(sorted[0]);

  // 延迟 2 秒启动第二个，延迟 4 秒启动第三个（但若已提前退出则跳过）
  let p2Ready = false;
  let p3Ready = false;
  setTimeout(function (): void {
    p2Ready = true;
  }, 2000);
  setTimeout(function (): void {
    p3Ready = true;
  }, 4000);

  const waitForReady = function (
    getReady: () => boolean,
  ): Promise<{ _earlyExit: boolean }> {
    return new Promise(function (resolve): void {
      const check = function (): void {
        // 已有成功结果也算提前退出：p2/p3 不再发出（P2 修复）
        if (_earlyExitReason || _succeeded) {
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
  };

  const p2 = waitForReady(() => p2Ready).then(function (r) {
    if (r._earlyExit) throw new Error(_earlyExitReason || "early exit");
    if (onProgress) onProgress(30, "⏳ 发出第二个请求…");
    return fetchOne(sorted[1]);
  });

  const p3 = waitForReady(() => p3Ready).then(function (r) {
    if (r._earlyExit) throw new Error(_earlyExitReason || "early exit");
    if (onProgress) onProgress(50, "⏳ 发出第三个请求…");
    return fetchOne(sorted[2]);
  });

  // 用 Promise.any 取第一个成功的结果
  try {
    const result = await Promise.any([p1, p2, p3]);
    controllers.forEach((c) => c.abort());
    if (onProgress) onProgress(100, "✅ 加载完成");
    return result;
  } catch (aggErr) {
    // 如果提前退出抛出的明确错误，直接透传
    if (_earlyExitReason) throw new Error(_earlyExitReason);
    // 全部失败 — 诊断根因
    const reasons = (aggErr as { errors?: Array<{ message?: string }> }).errors
      ? (aggErr as { errors: Array<{ message?: string }> }).errors.map(
          function (e): string {
            return e.message || String(e);
          },
        )
      : [(aggErr as Error).message || String(aggErr)];

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
}
