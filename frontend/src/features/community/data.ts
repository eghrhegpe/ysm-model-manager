// ===== 创意工坊数据加载（类型化版 — ADR-014 P3 features）=====
// tryFetchModels + 进度条

import { hasRecycleSegment } from "@/utils/base/recycle-path.ts";
import { esc } from "@/utils/html/html.ts";

/**
 * 创建进度条 UI（插入到 searchResults 容器）
 */
export function showProgress(searchResults: HTMLElement, pct: number, label?: string): void {
  // P3 修复（审核发现）：pct 无钳制会输出 width:"NaN%"/"150%"/"-5%"——
  // 数值守卫范式（AGENTS §3.4 ②）拦截非有限值并钳制到 [0,100]
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0;
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

// 回收站段判定：[G5 收口] 由 utils/base/recycle-path.ts `hasRecycleSegment` 单一实现
// （命名对齐 Go sync.hasRecycleSegment；原本地 isRecyclePath 已删除）。
// 语义背景：仓库 index.json 可能把 `.recycle/…` 下已删/待清理文件也索引进列表——
// 加载端须过滤，否则文件出现在创意工坊下载列表；且 Go 下载器会 stripRecycleSegments
// 剥掉该段，剥后仅剩文件名者落到仓库根（观感即"下载平铺到根目录"）。

/** 单个镜像源抓取条目 */
type FetchAttempt = { name: string; url: string; label: string };

/** 单源失败的类型化记录（替代字符串消息嗅探：HTTP status 直判 + 网络层 TypeError 识别） */
type FetchFailKind = "http" | "network" | "timeout";
interface FetchFail {
  kind: FetchFailKind;
  status: number | null;
}

/** 竞速期间共享状态（fetchModelsOne 写，延时启动 / 汇总读） */
interface FetchRaceState {
  /** raw 源确定性 404（jsd/api 404 可能是 CDN 缓存未命中/限流，不算证据）：置位后 abort 整体 */
  rawNoIndex: boolean;
  failures: FetchFail[];
  /** 整体取消控制器：成功胜出 / raw404 早退时 abort（唤醒延时启动、终止在途 fetch） */
  ctrl: AbortController;
}

/**
 * 构造三个镜像源 attempts 数组，并按 mirror 策略调整请求顺序
 * （仅影响最先被展示的顺序，并发竞速时无实质区别）
 */
function buildFetchModelsAttempts(repo: string, mirror: MirrorStrategy): FetchAttempt[] {
  const attempts: FetchAttempt[] = [
    {
      name: "raw",
      url: `https://raw.githubusercontent.com/${repo}/main/index.json`,
      label: "⏳ 正在连接 raw.githubusercontent.com…",
    },
    {
      name: "jsd",
      url: `https://cdn.jsdelivr.net/gh/${repo}@main/index.json`,
      label: "⏳ 正在连接 cdn.jsdelivr.net…",
    },
    {
      name: "api",
      url: `https://api.github.com/repos/${repo}/contents/index.json`,
      label: "⏳ 正在连接 api.github.com…",
    },
  ];
  if (mirror === "jsdelivr") return [attempts[1], attempts[0], attempts[2]];
  if (mirror === "githubapi") return [attempts[2], attempts[0], attempts[1]];
  return attempts;
}

/**
 * 向单个镜像源发起 index.json 抓取：
 * - 双通道取消：本源超时（8s timer）+ 整体取消（raw404 早退 / 他人胜出，经 state.ctrl）；
 * - 失败按类型记录（http status / network TypeError / timeout），替代字符串嗅探；
 * - 404 判定：仅 raw 源 404 视为确定性证据（jsd/api 404 可能是 CDN 缓存未命中/限流），
 *   置 rawNoIndex 并 abort 整体终止在途与延时请求；其余源 404 仅记录、不误杀在途；
 * - api 源 base64 去 [\r\n\s] 再 atob + TextDecoder。
 */
async function fetchModelsOne(
  attempt: FetchAttempt,
  state: FetchRaceState,
  timeoutMs: number,
): Promise<FetchModelsResult> {
  const timeoutCtrl = new AbortController();
  // 整体取消转播到本源（fetch 只认 timeoutCtrl.signal，避免依赖 AbortSignal.any 运行环境）
  const onOuterAbort = (): void => timeoutCtrl.abort();
  state.ctrl.signal.addEventListener("abort", onOuterAbort);
  const tmr = setTimeout((): void => timeoutCtrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(attempt.url, { signal: timeoutCtrl.signal });
  } catch (err) {
    // 整体取消（他人已胜出 / raw404 早退）引发的连带失败不计入本源的失败记录
    if (state.ctrl.signal.aborted) throw err;
    state.failures.push(
      timeoutCtrl.signal.aborted
        ? { kind: "timeout", status: null }
        : { kind: "network", status: null },
    );
    throw err;
  } finally {
    clearTimeout(tmr);
    state.ctrl.signal.removeEventListener("abort", onOuterAbort);
  }
  if (!resp.ok) {
    // 404 处理：仅 raw 源 404 视为确定性证据（仓库确实无 index.json）——
    // jsd/api 404 可能是 CDN 缓存未命中/限流，误杀本可成功的在途请求
    if (resp.status === 404 && attempt.name === "raw") {
      state.rawNoIndex = true;
      state.ctrl.abort();
    } else {
      state.failures.push({ kind: "http", status: resp.status });
    }
    throw new Error(`HTTP ${resp.status}`);
  }
  let models: unknown;
  if (attempt.name === "api") {
    const data = (await resp.json()) as {
      encoding?: string;
      content?: string;
    };
    if (data.encoding !== "base64" || data.content == null) throw new Error("no content");
    // GitHub API base64 可能含 \r\n 换行——\r 残留令 atob 抛错 → 误判 AllFailed；统一去 [\r\n\s]
    const binary = atob(data.content.replace(/[\r\n\s]/g, ""));
    const bytes = Uint8Array.from(binary, (c): number => c.charCodeAt(0));
    models = JSON.parse(new TextDecoder().decode(bytes));
  } else {
    models = await resp.json();
  }
  if (Array.isArray(models)) {
    return { models, source: attempt.name };
  }
  // 无效载荷：本源失败（不 push 分类记录——汇总按 404/403/网络缺失自然落 AllFailed，与旧实现一致）
  throw new Error("invalid payload");
}

/** 延时（可被整体 ctrl abort 提前唤醒：成功胜出 / raw404 早退后不再启动下一源，杜绝孤儿请求） */
function delayUntil(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout((): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 全部源失败的汇总分类（类型化，替代字符串消息嗅探）：
 * raw 404（确定性早退）→ NoIndex；任一 404 → NoIndex；任一 403 → RateLimited；
 * 网络/超时 → NetworkOffline；其余（HTTP 500 / 无效载荷等）→ AllFailed。
 * 语义与旧实现对齐（404 优先于 403 优先于网络）；超时自「消息无关键词落 AllFailed」
 * 修正为网络类——嗅探缺陷：8s 无响应即网络不可达的强信号。
 */
function summarizeFetchFailures(state: FetchRaceState): never {
  if (state.rawNoIndex) throw new Error("NoIndex");
  if (state.failures.some((f) => f.status === 404)) throw new Error("NoIndex");
  if (state.failures.some((f) => f.status === 403)) throw new Error("RateLimited");
  if (state.failures.some((f) => f.kind === "network" || f.kind === "timeout"))
    throw new Error("NetworkOffline");
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

  // 竞速期间共享状态（fetchModelsOne 写 / 延时启动与汇总读）；整体 ctrl 统一取消：
  // 成功胜出与 raw404 确定性早退都走 ctrl.abort()，在途 fetch 与延时启动同步终止
  const state: FetchRaceState = {
    rawNoIndex: false,
    failures: [],
    ctrl: new AbortController(),
  };
  const TIMEOUT = 8000;

  if (onProgress) onProgress(10, "⏳ 发出首个请求…");

  // 延时并发：第一个请求立即发出，后续每 2 秒启动一个（不等前一个完成）
  // 兼顾速度（jsDelivr 可能 1 秒内响应）和带宽（不一次性发 3 个请求）
  const p1 = fetchModelsOne(sorted[0], state, TIMEOUT);
  // p2/p3 延 2/4 秒启动；期间若已成功或 raw404 早退（ctrl abort），delayUntil 立即
  // 唤醒且下方 aborted 检查拦截，不再发出迟到/孤儿请求
  const p2 = delayUntil(2000, state.ctrl.signal).then(() => {
    if (state.ctrl.signal.aborted) throw new Error("race settled");
    if (onProgress) onProgress(30, "⏳ 发出第二个请求…");
    return fetchModelsOne(sorted[1], state, TIMEOUT);
  });
  const p3 = delayUntil(4000, state.ctrl.signal).then(() => {
    if (state.ctrl.signal.aborted) throw new Error("race settled");
    if (onProgress) onProgress(50, "⏳ 发出第三个请求…");
    return fetchModelsOne(sorted[2], state, TIMEOUT);
  });

  // 用 Promise.any 取第一个成功的结果
  try {
    const result = await Promise.any([p1, p2, p3]);
    state.ctrl.abort(); // 胜出：终止仍在途/未启动的请求
    if (onProgress) onProgress(100, "✅ 加载完成");
    // 过滤回收站条目：.recycle 段下的"已删/待清理"文件不进下载列表（防下载剥段平铺根 + 语义上本就不该下载）
    return {
      models: (result.models as Array<{ path?: unknown }>).filter(
        (m) => !hasRecycleSegment(typeof m?.path === "string" ? m.path : ""),
      ),
      source: result.source,
    };
  } catch {
    // 全部源失败：类型化汇总分类（见 summarizeFetchFailures）
    summarizeFetchFailures(state);
  }
}
