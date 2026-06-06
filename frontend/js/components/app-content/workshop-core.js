// ===== 创意工坊纯数据层 =====

/**
 * 加载站点 + 创作者数据（纯数据，不碰 DOM）
 * @returns {{ sites: Array, creators: Array, authors: Array }}
 */
export async function loadWorkshopData() {
  const App = await import("../../../wailsjs/go/main/App.js");
  const [sites, creators, authors] = await Promise.all([
    App.LoadWorkshopSites(),
    App.LoadWorkshopCreators(),
    App.ListModelAuthors(),
  ]);
  return {
    sites: sites || [],
    creators: creators || [],
    authors: authors || [],
  };
}

/**
 * 替换 {{q}} 为查询词
 */
export const fillSearch = (tpl, q) =>
  tpl.replace(/\{\{q\}\}/g, encodeURIComponent(q));

/**
 * 获取仓库模型列表 + 本地映射
 */
export async function getRepoModelsData(repo, mirror) {
  const { tryFetchModels } = await import("./workshop-data.js");
  return tryFetchModels(repo, mirror);
}
