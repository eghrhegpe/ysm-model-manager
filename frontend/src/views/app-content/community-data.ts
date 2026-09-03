// ===== 创意工坊纯数据层 =====
import { t } from "../../core/i18n/t.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { withCached, invalidateCache } from "../../utils/cache/with-cached.ts";
import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import type { WorkshopSite, WorkshopCreator } from "../../../bindings/ysm-model-manager/go/types/models.ts";

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

// 站点索引 TTL：站点配置变更很少，30 分钟足够
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

/** 清除站点索引缓存 */
export function forceRefreshCommunitySites(): void {
  invalidateCache(SITES_FETCH_KEY);
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

// 解耦 features → views：features 层（download-queue）经 bus 触发社区缓存失效，
// 此处集中订阅（模块级注册一次，ESM 单例不会重复）。ADR-039 范式。
bus.on("community:clearCache", clearAllCommunityCache);

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
  const App = await getApp();
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
      withCached(SCAN_LITE_AUTHORS_KEY, SCAN_LITE_AUTHORS_TTL_MS, () => App.ListModelAuthors()).catch(() => []),
    ]);
    sites = results[0] || [];
    creators = results[1] || [];
    authors = results[2] || [];
  } catch (e) {
    // 显式化（ADR-082 续）：不再只 console.warn 静默——failed 标记让调用方
    // 区分「加载失败」（提示重试）与「真无数据」（显示空态），避免页面空白无感知
    failed = true;
    console.warn("[community] 社区数据加载失败:", e);
  }

  const merged = (creators || []) as LocalCreator[];

  // 自动拉取社区索引（静默，后台执行）——R3-P0 后网页版已桥接
  // 自动合并（网络拉取失败静默，保存到 localStorage）
  tryAutoMergeCommunity([...merged]).catch((e) => { dbg("tryAutoMergeCommunity failed", e); });

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
  const App = await getApp();
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
    if (la && la.name && existingNames.has(la.name)) {
      const found = creators.find((c) => c.name === la.name);
      // P4 修复：按分号分段比较 type，避免子串误判（"bilibili" 包含 "bili" 时丢类型）
      if (found && la.type) {
        const hasType = (found.type || "").split(";").some((t) => t.trim() === la.type);
        if (!hasType) {
          found.type = found.type ? found.type + ";" + la.type : la.type;
        }
      }
      if (found) found._fromLocal = true;
    } else if (la && la.name) {
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

/** 后台静默拉取社区索引并合并（withCached 6h TTL） */
async function tryAutoMergeCommunity(creators: LocalCreator[]): Promise<void> {
  const community = await withCached(COMMUNITY_MERGE_KEY, COMMUNITY_MERGE_TTL_MS, async () => {
    return fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
  }, "STALE");
  if (!community.length) return;
  const { added } = mergeCommunityCreators(creators, community);
  if (added > 0) {
    try {
      const { LoadWorkshopCreators, SaveWorkshopCreators } =
        await getApp();
      // 写回路径说明（2026-09-03 复核修正）：
      // 风险实为「前端逐站点循环调 SaveWorkshopCreatorsBySite N 次」的跨调用部分提交——
      // 第 k 次成功、第 k+1 次失败时前 k 个站点已落盘。BySite 自身（Go 侧 app_workshop.go）
      // 是单次 Load→过滤→SaveWorkshopCreators 的原子写，无内部部分提交。
      // 2026-08-16 审核为规避跨调用部分提交，选择「前端一次合并 + 单次整体保存」（原子）。
      // 代价：合并/去重派生逻辑落在 TS 侧（mergeLocalAuthorsInto/dedupeCreators），
      // 触及 AGENTS.md「Go 派生结果只读」红线。长治方案：下沉 Go——新增单次原子
      // 「多站点合并替换」binding（内部一次 Load→按 type 分号段过滤各 site→去重追加→
      // WriteFileAtomic），前端只传社区拉取结果、不重算。此项跨 Go 层，须开 ADR 后动。
      const all = (await LoadWorkshopCreators()) || [];
      // 按站点分组（type 分号段），对齐原 SaveWorkshopCreatorsBySite 语义
      const siteMap: Record<string, LocalCreator[]> = {};
      creators.forEach((c) => {
        const types = (c.type || "").split(";");
        types.forEach((t) => {
          if (!t) return;
          if (!siteMap[t]) siteMap[t] = [];
          siteMap[t].push(c);
        });
      });
      const siteIDs = Object.keys(siteMap);
      // 移除所有被更新站点的旧条目（type 精确/分号段匹配）
      const kept = all.filter((c) => {
        const t = c.type || "";
        return !siteIDs.some((sid) => t === sid || t.includes(sid + ";") || t.endsWith(";" + sid));
      });
      // 去重：多段 type（如 "bilibili;afdian"）会被 push 进多个 siteMap 组，
      // flat 后出现引用重复 + 可能的同名独立记录 → dedupeCreators 归一（type 分号段合并，不丢站点）
      const flat = Object.values(siteMap).flat();
      const merged = [...kept, ...dedupeCreators(flat)];
      await SaveWorkshopCreators(merged as WorkshopCreator[]);
    } catch (e) { dbg("SaveWorkshopCreators failed", e); }
  }
}

/**
 * 替换 &#123;&#123;q&#125;&#125; 为查询词
 */
export const fillSearch = (tpl: string, q: string): string =>
  tpl.replace(/\{\{q\}\}/g, encodeURIComponent(q));

/**
 * 三路回退拉取 JSON 数组（raw → jsdelivr → GitHub API）。
 * mirror 为 "jsdelivr" / "githubapi" 时调整优先级；api 源经 atob 解码 base64 内容。
 * 每路 8s 超时（AbortController）；全部失败返回 []。
 * @param attempts - 候选源列表（按尝试顺序）
 * @param mirror - 镜像配置，调整回退优先级
 * @param dbgTag - debug 日志模块标签（默认 "community"）
 */
async function fetchWithFallback<T>(
  attempts: Array<{ name: string; url: string; label: string }>,
  mirror?: string,
  dbgTag = "community",
): Promise<T[]> {
  // 防御：attempts 可能不足 3 项（本地 URL 场景），重排后滤掉缺失项，避免 undefined.url
  const order =
    mirror === "jsdelivr" ? [1, 0, 2]
      : mirror === "githubapi" ? [2, 0, 1]
        : null;
  const sorted = order
    ? order.map((i) => attempts[i]).filter((a): a is (typeof attempts)[number] => !!a)
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
      if (Array.isArray(data)) return data as T[];
    } catch (err) {
      if (err && (err as Error)?.name !== "AbortError") {
        dbg(dbgTag, a.name + " failed:", (err as Error)?.message);
      }
    } finally {
      clearTimeout(tmr);
    }
  }
  return [];
}

/**
 * 从 GitHub 拉取 creators.json（三路回退）
 */
export async function fetchCommunityCreators(
  url: string,
  mirror?: string,
): Promise<WorkshopCreator[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    { name: "raw", url, label: t("workshop.communityIndexLoading", { source: "raw" }) },
  ];
  // 仅在 raw URL 看起来有效时才加兜底
  if (url && !url.includes("localhost") && !url.includes("127.0.0.1")) {
    attempts.push(
      {
        name: "jsd",
        url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/creators.json",
        label: t("workshop.communityIndexLoading", { source: "jsdelivr" }),
      },
      {
        name: "api",
        url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/creators.json",
        label: t("workshop.communityIndexLoading", { source: "api" }),
      },
    );
  }
  return fetchWithFallback<WorkshopCreator>(attempts, mirror);
}

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
 * 保存前兜底去重：同 name 条目归一为一条（分号段 type 合并），不丢任何站点。
 * flat 里重复有两种来源：① 同一对象因多段 type 进多个 siteMap 组的引用重复（跳过）；
 * ② 历史/输入脏数据中同名不同站点的独立记录（并入 type 段保留先者）。
 */
export function dedupeCreators(flat: LocalCreator[]): LocalCreator[] {
  const seen = new Map<string, LocalCreator>();
  for (const c of flat) {
    if (!c.name) continue;
    const existing = seen.get(c.name);
    if (existing) {
      if (existing !== c) mergeTypeSegments(existing, c.type);
    } else {
      seen.set(c.name, c);
    }
  }
  return [...seen.values()];
}

/**
 * 从 GitHub 拉取 workshop_sites.json（三路回退，withCached 30min TTL）
 */
export async function fetchCommunitySites(mirror?: string): Promise<WorkshopSite[]> {
  return withCached(SITES_FETCH_KEY, SITES_FETCH_TTL_MS, () => _fetchCommunitySitesRaw(mirror));
}

/** 原始拉取实现（供 withCached 包裹） */
async function _fetchCommunitySitesRaw(mirror?: string): Promise<WorkshopSite[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    {
      name: "raw",
      url: "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/workshop_sites.json",
      label: t("workshop.siteIndexLoading", { source: "raw" }),
    },
    {
      name: "jsd",
      url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/workshop_sites.json",
      label: t("workshop.siteIndexLoading", { source: "jsdelivr" }),
    },
    {
      name: "api",
      url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/workshop_sites.json",
      label: t("workshop.siteIndexLoading", { source: "api" }),
    },
  ];
  const sites = await fetchWithFallback<WorkshopSite>(attempts, mirror);
  // 全部源失败 → fetchWithFallback 返回 []
  // 抛错让 withCached 不缓存失败结果（失败不缓存契约）
  if (sites.length === 0) {
    throw new Error("fetchCommunitySites: all sources failed");
  }
  return sites;
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
