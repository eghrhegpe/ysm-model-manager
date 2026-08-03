// ===== 创意工坊纯数据层 =====
import { dbg } from "../../../utils/debug.ts";
import type { WorkshopSite, WorkshopCreator } from "../../../../bindings/ysm-model-manager/go/types/models.ts";

/** 本地合并后的创作者（绑定 WorkshopCreator + 运行时附加字段） */
export interface LocalCreator extends WorkshopCreator {
  _fromLocal?: boolean;
  _fromCommunity?: boolean;
  type?: string;
  /** 行内编辑动态字段（fld 来自 dataset） */
  [key: string]: unknown;
}

/** 绑定 LocalAuthor（合并来源） */
interface LocalAuthorLike {
  name?: string;
  desc?: string;
  type?: string;
}

/** 站点 + 创作者 + 作者 数据包 */
export interface CommunityData {
  sites: WorkshopSite[];
  creators: LocalCreator[];
  authors: unknown[];
}

/**
 * 加载站点 + 创作者数据（纯数据，不碰 DOM）
 * 自动合并本地仓库提取的作者
 */
export async function loadCommunityData(): Promise<CommunityData> {
  const App = await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
  const [sites, creators, authors, localAuthors] = await Promise.all([
    App.LoadWorkshopSites(),
    App.LoadWorkshopCreators(),
    App.ListModelAuthors(),
    App.ScanLocalAuthors().catch(() => []),
  ]);

  // 合并本地作者到创作者列表
  const merged = (creators || []) as LocalCreator[];
  const existingNames = new Set(merged.map((c) => c.name));
  const localAuthorsList: LocalAuthorLike[] = localAuthors || [];
  if (localAuthorsList.length) {
    for (const la of localAuthorsList) {
      if (la && la.name && existingNames.has(la.name)) {
        const found = merged.find((c) => c.name === la.name);
        if (found && la.type && !found.type?.includes(la.type)) {
          found.type = found.type ? found.type + ";" + la.type : la.type;
        }
        if (found) found._fromLocal = true;
      } else if (la && la.name) {
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
  tryAutoMergeCommunity(merged).catch((e) => { dbg("tryAutoMergeCommunity failed", e); });

  return {
    sites: sites || [],
    creators: merged,
    authors: authors || [],
  };
}

/** 后台静默拉取社区索引并合并 */
async function tryAutoMergeCommunity(creators: LocalCreator[]): Promise<void> {
  const community = await fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
  if (!community.length) return;
  const { added } = mergeCommunityCreators(creators, community);
  if (added > 0) {
    try {
      const { SaveWorkshopCreatorsBySite } =
        await import("../../../../bindings/ysm-model-manager/internal/app/app.js");
      // 按站点分组，逐站点原子保存
      const siteMap: Record<string, LocalCreator[]> = {};
      creators.forEach((c) => {
        const types = (c.type || "").split(";");
        types.forEach((t) => {
          if (!t) return;
          if (!siteMap[t]) siteMap[t] = [];
          siteMap[t].push(c);
        });
      });
      for (const [siteId, siteCreators] of Object.entries(siteMap)) {
        await SaveWorkshopCreatorsBySite(siteId, siteCreators);
      }
    } catch (e) { dbg("SaveWorkshopCreators failed", e); }
  }
}

/**
 * 替换 {{q}} 为查询词
 */
export const fillSearch = (tpl: string, q: string): string =>
  tpl.replace(/\{\{q\}\}/g, encodeURIComponent(q));

/**
 * 从 GitHub 社区索引拉取 creators.json
 * @param url - 社区索引 raw URL
 */
export async function fetchCommunityCreators(
  url: string,
  mirror?: string,
): Promise<WorkshopCreator[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    { name: "raw", url, label: "⏳ 社区索引: raw…" },
  ];
  // 仅在 raw URL 看起来有效时才加兜底
  if (url && !url.includes("localhost") && !url.includes("127.0.0.1")) {
    attempts.push(
      {
        name: "jsd",
        url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/creators.json",
        label: "⏳ 社区索引: jsdelivr…",
      },
      {
        name: "api",
        url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/creators.json",
        label: "⏳ 社区索引: api…",
      },
    );
  }
  const sorted =
    mirror === "jsdelivr"
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
      let data: unknown;
      if (a.name === "api") {
        const json = (await resp.json()) as { content?: string };
        if (!json.content) throw new Error("no content");
        data = JSON.parse(atob(json.content.replace(/\s/g, "")));
      } else {
        data = await resp.json();
      }
      if (Array.isArray(data)) return data as WorkshopCreator[];
    } catch (err) {
      if (err && (err as Error)?.name !== "AbortError") {
        dbg("community", a.name + " failed:", (err as Error)?.message);
      }
    } finally {
      clearTimeout(tmr);
    }
  }
  return [];
}

/**
 * 合并社区索引到本地 creators.json
 * @returns {{ merged: LocalCreator[]; added: number; updated: number }} 合并后的创作者列表、新增数、更新数
 */
export function mergeCommunityCreators(
  local: LocalCreator[],
  community: WorkshopCreator[],
): { merged: LocalCreator[]; added: number; updated: number } {
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
      if (cc.role && !existing.role) {
        existing.role = cc.role;
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
 * 从 GitHub 拉取 workshop_sites.json（三路回退）
 */
export async function fetchCommunitySites(mirror?: string): Promise<WorkshopSite[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    {
      name: "raw",
      url: "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/workshop_sites.json",
      label: "⏳ 站点索引: raw…",
    },
    {
      name: "jsd",
      url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/workshop_sites.json",
      label: "⏳ 站点索引: jsdelivr…",
    },
    {
      name: "api",
      url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/workshop_sites.json",
      label: "⏳ 站点索引: api…",
    },
  ];
  const sorted =
    mirror === "jsdelivr"
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
      let data: unknown;
      if (a.name === "api") {
        const json = (await resp.json()) as { content?: string };
        if (!json.content) throw new Error("no content");
        data = JSON.parse(atob(json.content.replace(/\s/g, "")));
      } else {
        data = await resp.json();
      }
      if (Array.isArray(data)) return data as WorkshopSite[];
    } catch (err) {
      if (err && (err as Error)?.name !== "AbortError") {
        dbg("community", "sites " + a.name + " failed:", (err as Error)?.message);
      }
    } finally {
      clearTimeout(tmr);
    }
  }
  return [];
}

/**
 * 合并社区站点到本地 workshop_sites.json
 */
export function mergeCommunitySites(
  local: WorkshopSite[],
  community: WorkshopSite[],
): { added: number } {
  const idMap = new Map(local.map((s) => [s.id, s]));
  let added = 0;
  for (const cs of community) {
    if (!cs.id) continue;
    if (!idMap.has(cs.id)) {
      local.push(cs);
      idMap.set(cs.id, cs);
      added++;
    }
  }
  return { added };
}

/**
 * 社区索引的默认 URL（可配置为社区维护的独立 creators JSON）
 * 贡献通道：https://github.com/eghrhegpe/ysm-model-manager（仓库根目录 creators.json）
 */
export const DEFAULT_COMMUNITY_URL =
  "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/creators.json";
