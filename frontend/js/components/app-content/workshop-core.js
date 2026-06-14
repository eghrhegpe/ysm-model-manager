// ===== 创意工坊纯数据层 =====

/**
 * 加载站点 + 创作者数据（纯数据，不碰 DOM）
 * 自动合并本地仓库提取的作者
 * @returns {{ sites: Array, creators: Array, authors: Array }}
 */
export async function loadWorkshopData() {
  const App = await import("../../../wailsjs/go/main/App.js");
  const [sites, creators, authors, localAuthors] = await Promise.all([
    App.LoadWorkshopSites(),
    App.LoadWorkshopCreators(),
    App.ListModelAuthors(),
    App.ScanLocalAuthors().catch(() => []),
  ]);

  // 合并本地作者到创作者列表
  let merged = creators || [];
  const existingNames = new Set(merged.map((c) => c.name));
  if (localAuthors && localAuthors.length) {
    for (const la of localAuthors) {
      if (existingNames.has(la.name)) {
        const found = merged.find((c) => c.name === la.name);
        if (found && la.type && !found.type?.includes(la.type)) {
          found.type = found.type ? found.type + ";" + la.type : la.type;
        }
        found._fromLocal = true;
      } else {
        merged.push({
          name: la.name,
          desc: la.desc || "来自本地仓库",
          type: la.type || "",
          _fromLocal: true,
        });
      }
    }
  }

  // 自动拉取社区索引（静默，后台执行）
  tryAutoMergeCommunity(merged).catch(() => {});

  return {
    sites: sites || [],
    creators: merged,
    authors: authors || [],
  };
}

/** 后台静默拉取社区索引并合并 */
async function tryAutoMergeCommunity(creators) {
  let mirror = "";
  try {
    const { LoadAppConfig } = await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    mirror = cfg.mirror || "";
  } catch {}
  const community = await fetchCommunityCreators(DEFAULT_COMMUNITY_URL, mirror);
  if (!community.length) return;
  const { added } = mergeCommunityCreators(creators, community);
  if (added > 0) {
    try {
      const { SaveWorkshopCreators } =
        await import("../../../wailsjs/go/main/App.js");
      await SaveWorkshopCreators(creators);
    } catch {}
  }
}

/**
 * 替换 {{q}} 为查询词
 */
export const fillSearch = (tpl, q) =>
  tpl.replace(/\{\{q\}\}/g, encodeURIComponent(q));

/**
 * 从 GitHub 社区索引拉取 creators.json
 * @param {string} url - 社区索引 raw URL
 * @returns {Promise<Array>} 社区创作者列表
 */
export async function fetchCommunityCreators(url, mirror) {
  const attempts = [
    { name: "raw", url, label: "⏳ 社区索引: raw…" },
    { name: "jsd", url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-creator-index@main/creators.json", label: "⏳ 社区索引: jsdelivr…" },
    { name: "api", url: "https://api.github.com/repos/eghrhegpe/ysm-creator-index/contents/creators.json", label: "⏳ 社区索引: api…" },
  ];
  const sorted = mirror === "jsdelivr"
    ? [attempts[1], attempts[0], attempts[2]]
    : mirror === "githubapi"
    ? [attempts[2], attempts[0], attempts[1]]
    : attempts;

  for (const a of sorted) {
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(a.url, { signal: ctrl.signal });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      let data;
      if (a.name === "api") {
        const json = await resp.json();
        if (!json.content) throw new Error("no content");
        data = JSON.parse(atob(json.content.replace(/\\s/g, "")));
      } else {
        data = await resp.json();
      }
      if (Array.isArray(data)) return data;
    } catch (err) {
      console.debug("[community] " + a.name + " failed:", err?.message);
    } finally {
      clearTimeout(tmr);
    }
  }
  return [];
}

/**
 * 合并社区索引到本地 creators.json
 * @param {Array} local - 本地创作者列表
 * @param {Array} community - 社区创作者列表
 * @returns {{ merged: Array, added: number, updated: number }}
 */
export function mergeCommunityCreators(local, community) {
  const nameMap = new Map(local.map((c) => [c.name, c]));
  let added = 0,
    updated = 0;
  for (const cc of community) {
    const existing = nameMap.get(cc.name);
    if (existing) {
      // 补充缺失的字段
      let changed = false;
      if (cc.desc && !existing.desc) {
        existing.desc = cc.desc;
        changed = true;
      }
      if (cc.type && !existing.type) {
        existing.type = cc.type;
        changed = true;
      }
      if (cc.tag && !existing.tag) {
        existing.tag = cc.tag;
        changed = true;
      }
      if (changed) updated++;
    } else {
      local.push({ ...cc, _fromCommunity: true });
      nameMap.set(cc.name, local[local.length - 1]);
      added++;
    }
  }
  return { merged: local, added, updated };
}

/**
 * 社区索引的默认 URL（可配置为社区维护的独立 creators JSON）
 * 贡献通道：https://github.com/eghrhegpe/ysm-creator-index
 */
export const DEFAULT_COMMUNITY_URL =
  "https://raw.githubusercontent.com/eghrhegpe/ysm-creator-index/main/creators.json";

/**
 * 获取仓库模型列表 + 本地映射
 */
export async function getRepoModelsData(repo, mirror) {
  const { tryFetchModels } = await import("../../features/workshop/data.js");
  return tryFetchModels(repo, mirror);
}
