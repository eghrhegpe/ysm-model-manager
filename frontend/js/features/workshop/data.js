// ===== 创意工坊数据加载（tryFetchModels + 进度条） =====

/**
 * 创建进度条 UI（插入到 searchResults 容器）
 */
export function showProgress(searchResults, pct, label) {
  searchResults.innerHTML =
    '<div class="ws-progress-box">' +
    '<div class="ws-progress-label">' +
    '<span class="ws-progress-spin">⏳</span> ' +
    '<span class="ws-progress-text">' +
    (label || "") +
    "</span></div>" +
    '<div class="ws-progress-track">' +
    '<div class="ws-progress-fill" style="width:' +
    pct +
    "%;transition:width 0.3s" +
    (pct < 100 ? " ws-striped" : "") +
    '"></div>' +
    "</div>" +
    "</div>";
}

/**
 * 从 GitHub 获取 index.json（三重回退 + 进度条）
 * @param {string} repo - "owner/repo"
 * @param {string} mirror - 镜像策略 ("", "jsdelivr", "githubapi")
 * @param {Function} onProgress - (pct, label) => void 进度回调
 * @returns {{ models: Array, source: string }}
 */
export async function tryFetchModels(repo, mirror, onProgress) {
  const usedSource = "";

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

  // 按镜像策略排序
  const sorted =
    mirror === "jsdelivr"
      ? [attempts[1], attempts[0], attempts[2]]
      : mirror === "githubapi"
        ? [attempts[2], attempts[0], attempts[1]]
        : attempts;

  let countdownTimer = null;
  const startCountdown = (label) => {
    if (countdownTimer) clearInterval(countdownTimer);
    let p = 50;
    if (onProgress) onProgress(p, label || "");
    countdownTimer = setInterval(() => {
      p = Math.max(10, p - 10);
      if (onProgress) onProgress(p, label || "");
    }, 1000);
  };
  const stopCountdown = () => {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  };

  for (const attempt of sorted) {
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 5000);
    startCountdown(attempt.label);
    try {
      const resp = await fetch(attempt.url, { signal: ctrl.signal });
      clearTimeout(tmr);
      stopCountdown();
      if (resp.ok) {
        if (onProgress) onProgress(70, "⏳ 解析模型列表中…");
        let models;
        if (attempt.name === "api") {
          const data = await resp.json();
          if (data.encoding !== "base64" || !data.content) continue;
          const binary = atob(data.content.replace(/\n/g, ""));
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          const json = new TextDecoder().decode(bytes);
          models = JSON.parse(json);
        } else {
          models = await resp.json();
        }
        if (models && models.length) {
          return { models, source: attempt.name };
        }
      }
    } catch (_) {
      clearTimeout(tmr);
      stopCountdown();
    }
  }
  throw new Error("All sources failed");
}
