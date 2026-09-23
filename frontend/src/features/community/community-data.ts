// ===== 创意工坊纯数据层 =====

import type {
  WorkshopCreator,
  WorkshopSite,
} from "@/bindings/ysm-model-manager/go/types/models.ts";
import { t } from "@/core/i18n/t.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { invalidateCache, withCached } from "@/utils/cache/with-cached.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { communityGetApp } from "./community-deps.ts";
// 远程拉取层（ADR-040 拆出）：本文件既在 tryAutoMergeCommunity 本地使用，又保留
// re-export 以维持 `import * as m from community-data.ts` 既有契约（site/edit.ts 零改动）
import {
  DEFAULT_COMMUNITY_URL,
  fetchCommunityCreators,
  fetchCommunitySites as fetchCommunitySitesRaw,
} from "./community-fetch.ts";

export { DEFAULT_COMMUNITY_URL, fetchCommunityCreators };

/** 站点索引拉取（数据层缓存壳）：30 分钟 TTL，拉取层本身零缓存（ADR-040 分层） */
export function fetchCommunitySites(mirror?: string): Promise<WorkshopSite[]> {
  return withCached(SITES_FETCH_KEY, SITES_FETCH_TTL_MS, () => _fetchCommunitySitesRaw(mirror));
}

/** 原始拉取（供 withCached 包裹；拉取层抛错 → 失败不缓存契约生效） */
function _fetchCommunitySitesRaw(mirror?: string): Promise<WorkshopSite[]> {
  return fetchCommunitySitesRaw(mirror);
}

/** 本地合并后的创作者（绑定 WorkshopCreator + 运行时附加字段） */
export interface LocalCreator extends WorkshopCreator {
  _fromLocal?: boolean;
  _fromCommunity?: boolean;
  type?: string;
  /** 行内编辑动态字段（fld 来自 dataset） */
  [key: string]: unknown;
}

/** 绑定 LocalAuthor（合并来源） */
export interface LocalAuthorLike {
  name?: string;
  desc?: string;
  type?: string;
}

/** 站点 + 创作者 + 作者 数据包 */
export interface CommunityData {
  sites: WorkshopSite[];
  creators: LocalCreator[];
  authors: unknown[];
  /** 加载是否失败（ADR-082 续：区分「真无数据」与「加载失败」，调用方据此占位提示） */
  failed?: boolean;
}

// ===== 社区索引拉取缓存 =====
// 使用 withCached 统一缓存：6h TTL，STALE 策略（过期返回空不阻塞渲染）
const COMMUNITY_MERGE_TTL_MS = 6 * 3600 * 1000; // 6 小时
const COMMUNITY_MERGE_KEY = "community-merge";

// 磁盘扫描 TTL：作者数据变更不频繁，5 分钟足够
const SCAN_AUTHORS_TTL_MS = 5 * 60 * 1000; // 5 分钟
const SCAN_AUTHORS_KEY = "scan-authors";

// ListModelAuthors 短 TTL：对齐原 Go scanCache 30s——重复工坊加载（tab 点击/页进入）
// 不再全量重扫大库（ScanEntriesLite 无 Go 侧缓存，scanner.go 注释：调用方自行决定复用策略）
const SCAN_LITE_AUTHORS_TTL_MS = 30 * 1000; // 30 秒
const SCAN_LITE_AUTHORS_KEY = "ListModelAuthors";

// 站点索引缓存：30 分钟 TTL（原 community-data 内置，544ae4b50 拆层时丢失——
// 拆层后 edit.ts 每次加载直连三路网络回退，且 clearAllCommunityCache 对站点键的
// invalidate 变死键。缓存壳留在数据层，拉取层保持零缓存）
const SITES_FETCH_TTL_MS = 30 * 60 * 1000; // 30 分钟
const SITES_FETCH_KEY = "community-sites";

/** 供测试强制刷新缓存 */
export function forceRefreshCommunityMerge(): void {
  invalidateCache(COMMUNITY_MERGE_KEY);
}

/** 供测试清除扫描缓存 */
export function forceRefreshScanAuthors(): void {
  invalidateCache(SCAN_AUTHORS_KEY);
  invalidateCache(SCAN_LITE_AUTHORS_KEY);
}

/**
 * 统一失效入口：数据变更时一次性清除所有社区相关缓存
 * 供导入/同步/下载完成后调用，替代分散的 invalidateCache 调用
 */
export function clearAllCommunityCache(): void {
  invalidateCache(COMMUNITY_MERGE_KEY);
  invalidateCache(SCAN_AUTHORS_KEY);
  invalidateCache(SCAN_LITE_AUTHORS_KEY);
  invalidateCache(SITES_FETCH_KEY);
  dbg("cache", "all community cache cleared");
}

/**
 * 加载站点 + 创作者数据（纯数据，不碰 DOM）——首屏快路径。
 * 只拉配置类数据（sites/creators/authors 统计），**不含磁盘扫描的本地作者**：
 * 扫描曾坐在 Promise.all 里阻塞整个 tab 栏渲染（大库逐文件 SHA256 陪绑，秒级~分钟级），
 * 现拆为 loadLocalAuthors() 后台补充 + mergeLocalAuthorsInto() 合并，
 * 调用方在首屏渲染完成后异步 enrich 即可。
 * 网页版（ADR-049 桥接增强 Batch 2）：DefaultWorkshopSites/LoadWorkshopCreators 已由
 * browser-adapter 桥接（bundled JSON + localStorage 覆盖），与桌面共用同一条加载路径；
 * ListModelAuthors 属桌面专属、网页版未桥接，.catch(() => []) 降级为空
 * （与文件内既有 P2/P4 防御风格一致，避免单点 unbridged binding 拖垮整链）。
 */
export async function loadCommunityData(): Promise<CommunityData> {
  const App = await communityGetApp();
  let sites: WorkshopSite[] = [];
  let creators: WorkshopCreator[] = [];
  let authors: unknown[] = [];
  let failed = false;
  try {
    const results = await Promise.all([
      App.DefaultWorkshopSites(),
      App.LoadWorkshopCreators(),
      // 作者列表：Go 侧轻量遍历（ScanEntriesLite），只看文件名不算哈希；
      // withCached 30s 短 TTL——重复工坊加载不重走全库枚举（与 authors.ts 共享同 key）
      withCached(SCAN_LITE_AUTHORS_KEY, SCAN_LITE_AUTHORS_TTL_MS, () =>
        App.ListModelAuthors(),
      ).catch(() => []),
    ]);
    sites = results[0] || [];
    creators = results[1] || [];
    authors = results[2] || [];
  } catch (e) {
    // 显式化（ADR-082 续）：不再只 console.warn 静默——failed 标记让调用方
    // 区分「加载失败」（提示重试）与「真无数据」（显示空态），避免页面空白无感知
    failed = true;
    logWarn("community", "社区数据加载失败", e);
  }

  const merged = (creators || []) as LocalCreator[];

  // 自动拉取社区索引（静默，后台执行）——R3-P0 后网页版已桥接
  // 自动并入（网络拉取失败静默；ADR-172 下沉 Go：binding 内部原子并入 + 备份）
  tryAutoMergeCommunity().catch((e) => {
    dbg("tryAutoMergeCommunity failed", e);
  });

  return {
    sites: sites || [],
    creators: merged,
    authors: authors || [],
    failed,
  };
}

/**
 * 本地作者扫描（后台补充路径）：withCached STALE——过期先返旧值再后台刷新，
 * 不阻塞调用方；冷缓存时才真等扫描（Go 侧已轻量化为纯目录枚举）。
 * 失败降级空数组（与快路径 .catch 防御风格一致）。
 */
export async function loadLocalAuthors(): Promise<LocalAuthorLike[]> {
  const App = await communityGetApp();
  // 绑定签名允许 null（无数据）——与快路径 `results[i] || []` 同口径归一
  const authors = await withCached(
    SCAN_AUTHORS_KEY,
    SCAN_AUTHORS_TTL_MS,
    () => App.ScanLocalAuthors(""),
    "STALE",
  ).catch(() => []);
  return authors || [];
}

/**
 * 把本地扫描提取的作者合并进创作者列表（原地合并，返回同一引用）。
 * 幂等：重复调用不重复追加（同名去重 + type 分段精确比较防子串误判）。
 */
export function mergeLocalAuthorsInto(
  creators: LocalCreator[],
  localAuthors: LocalAuthorLike[],
): LocalCreator[] {
  const existingNames = new Set(creators.map((c) => c.name));
  for (const la of localAuthors || []) {
    if (la?.name && existingNames.has(la.name)) {
      const found = creators.find((c) => c.name === la.name);
      // P4 修复：按分号分段比较 type，避免子串误判（"bilibili" 包含 "bili" 时丢类型）
      if (found && la.type) {
        const hasType = (found.type || "").split(";").some((t) => t.trim() === la.type);
        if (!hasType) {
          found.type = found.type ? `${found.type};${la.type}` : la.type;
        }
      }
      if (found) found._fromLocal = true;
    } else if (la?.name) {
      creators.push({
        name: la.name,
        desc: la.desc || t("community.fromLocal"),
        type: la.type || "",
        _fromLocal: true,
      });
      existingNames.add(la.name);
    }
  }
  return creators;
}

/** 后台静默拉取社区索引并并入本地（withCached 6h TTL） */
async function tryAutoMergeCommunity(): Promise<void> {
  const community = await withCached(
    COMMUNITY_MERGE_KEY,
    COMMUNITY_MERGE_TTL_MS,
    async () => {
      return fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
    },
    "STALE",
  );
  if (!community.length) return;
  try {
    const { MergeCommunityCreatorsFromJSON } = await communityGetApp();
    // ADR-172：社区增量合并下沉 Go——合并/去重派生（Load 磁盘最新全量 → desc/role
    // 空补 + type 分号段并入 → 备份 → 单次 SaveWorkshopCreators 原子写）全部在 Go 侧，
    // 前端只传社区拉取结果、不重算。替代原 TS 写回链（mergeCommunityCreators +
    // siteMap 分组 / kept 过滤 / dedupeCreators 重建，2026-09-03 锐评复核判定踩
    // 「Go 派生结果只读」红线，ADR-172 §1）。
    // 原子性：Go 一次 Load→并入→写，无「逐站循环调 SaveWorkshopCreatorsBySite N 次」
    // 的跨调用部分提交窗口（2026-08-16 审核规避对象，见 ADR-172 §2 差异表）。
    await MergeCommunityCreatorsFromJSON(JSON.stringify(community));
  } catch (e) {
    dbg("MergeCommunityCreatorsFromJSON failed", e);
  }
}

/**
 * 替换 &#123;&#123;q&#125;&#125; 为查询词
 */
export const fillSearch = (tpl: string, q: string): string =>
  tpl.replace(/\{\{q\}\}/g, encodeURIComponent(q));

/**
 * 把 incoming 的 type 分号段并入 target（trim / 去空 / 去重），返回是否有变更。
 * 领域语义：name 是创作者唯一身份，type 是多站点集合（分号段）——
 * 与 mergeLocalAuthorsInto 的 P4 分号段精确比较同源，防子串/覆盖误判丢失站点。
 */
function mergeTypeSegments(target: { type?: string }, incoming?: string): boolean {
  if (!incoming) return false;
  const segs = (target.type || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  let changed = false;
  for (const seg of incoming.split(";")) {
    const s = seg.trim();
    if (!s) continue;
    if (!segs.includes(s)) {
      segs.push(s);
      changed = true;
    }
  }
  if (changed) target.type = segs.join(";");
  return changed;
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
      // type 是分号段集合而非单值：冲突时须并入而非跳过——否则社区侧新增站点静默丢
      if (cc.type && mergeTypeSegments(existing, cc.type)) {
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
