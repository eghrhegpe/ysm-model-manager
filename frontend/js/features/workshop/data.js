// ===== 创意工坊数据加载（tryFetchModels + 进度条） =====

/**
 * 创建进度条 UI（插入到 searchResults 容器）
 */
export function showProgress(searchResults, pct, label) {
  searchResults.innerHTML =
    '<div class="gh-progress-box">' +
    '<div class="gh-progress-label">' +
    '<span class="gh-progress-spin">⏳</span> ' +
    '<span class="gh-progress-text">' +
    (label || "") +
    "</span></div>" +
    '<div class="gh-progress-track">' +
    '<div class="gh-progress-fill" style="width:' +
    pct +
    "%;transition:width 0.3s" +
    (pct < 100 ? " gh-striped" : "") +
    '"></div>' +
    "</div>" +
    "</div>";
}

/**
 * 从 GitHub 获取 index.json（并发竞速：同时请求所有镜像源，取最快响应）
 * @param {string} repo - "owner/repo"
 * @param {string} mirror - 镜像策略 ("", "jsdelivr", "githubapi")
 * @param {Function} onProgress - (pct, label) => void 进度回调
 * @returns {{ models: Array, source: string }}
 */
export async function tryFetchModels(repo, mirror, onProgress) {
  const attempts = [
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

  const controllers = [];
  const TIMEOUT = 8000;
  // 共享标志：当某个请求明确返回 404 时，提前终止所有请求
  let _earlyExitReason = null;

  const fetchOne = async (attempt) => {
    // 如果已经提前退出，直接抛错
    if (_earlyExitReason) throw new Error(_earlyExitReason);
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const tmr = setTimeout(function () {
      ctrl.abort();
    }, TIMEOUT);
    try {
      const resp = await fetch(attempt.url, { signal: ctrl.signal });
      clearTimeout(tmr);
      if (!resp.ok) {
        // 404 是确定性证据——仓库没有 index.json，立即终止
        if (resp.status === 404) {
          _earlyExitReason = "NoIndex";
          controllers.forEach(function (c) {
            try {
              c.abort();
            } catch (_) {}
          });
        }
        throw new Error("HTTP " + resp.status);
      }
      let models;
      if (attempt.name === "api") {
        const data = await resp.json();
        if (data.encoding !== "base64" || !data.content)
          throw new Error("no content");
        const binary = atob(data.content.replace(/\n/g, ""));
        const bytes = Uint8Array.from(binary, function (c) {
          return c.charCodeAt(0);
        });
        models = JSON.parse(new TextDecoder().decode(bytes));
      } else {
        models = await resp.json();
      }
      if (Array.isArray(models)) return { models, source: attempt.name };
    } catch (err) {
      clearTimeout(tmr);
    }
  };

  // 延时并发：第一个请求立即发出，后续每 2 秒启动一个（不等前一个完成）
  // 兼顾速度（jsDelivr 可能 1 秒内响应）和带宽（不一次性发 3 个请求）
  if (onProgress) onProgress(10, "⏳ 发出首个请求…");

  // 启动第一个请求
  const p1 = fetchOne(sorted[0]);

  // 延迟 2 秒启动第二个，延迟 4 秒启动第三个（但若已提前退出则跳过）
  let p2Ready = false,
    p3Ready = false;
  setTimeout(function () {
    p2Ready = true;
  }, 2000);
  setTimeout(function () {
    p3Ready = true;
  }, 4000);

  const waitForReady = function (flagRef) {
    return new Promise(function (resolve) {
      var check = function () {
        if (_earlyExitReason) {
          resolve({ _earlyExit: true });
          return;
        }
        if (flagRef) {
          resolve({ _earlyExit: false });
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  };

  const p2 = waitForReady(p2Ready).then(function (r) {
    if (r._earlyExit) throw new Error(_earlyExitReason);
    if (onProgress) onProgress(30, "⏳ 发出第二个请求…");
    return fetchOne(sorted[1]);
  });

  const p3 = waitForReady(p3Ready).then(function (r) {
    if (r._earlyExit) throw new Error(_earlyExitReason);
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
    const reasons = aggErr.errors
      ? aggErr.errors.map(function (e) {
          return e.message || String(e);
        })
      : [aggErr.message || String(aggErr)];

    let has404 = false;
    let hasNetwork = false;
    let hasRateLimit = false;

    for (var i = 0; i < reasons.length; i++) {
      var msg = reasons[i];
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
