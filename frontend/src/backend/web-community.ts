// ===== 网页版社区数据持久化/头像/作者/仓库索引职责（ADR-040 拆分产物）=====
// 社区/工坊数据（bundled JSON 默认 + localStorage 覆盖层）、创作者头像批量提取、
// 本地作者扫描与仓库索引生成。文件系统访问（scanWebModels/readWebFile/
// collectAllWebEntries/typeFromWebDir）复用 web-fs.ts；browser-adapter.ts 从本文件
// import 组装 webImpls。
import type { WorkshopCreator, WorkshopSite, WorkshopPresetSearch, AuthorInfo } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 社区/工坊默认数据源（bundled JSON，build 期内联；与 resource_types.json 同源范式）
import creatorsJson from "../../../creators.json" with { type: "json" };
import workshopGithubJson from "../../../workshop-github.json" with { type: "json" };
import workshopSitesJson from "../../../workshop_sites.json" with { type: "json" };
// 网页版头像提取复用前端 YSM 解包能力（替代 Go ExtractAvatarURI，ADR-049 缺口补齐）
import { decodeYsmFile } from "../wasm/ysm-parser.ts";
import { safeErrorMessage } from "../utils/safe-error-msg.ts";
import { scanWebModels, readWebFile, collectAllWebEntries, typeFromWebDir } from "./web-fs.ts";
import { WEB_ROOT, arrayBufferToBase64, base64ToBytes } from "./web-common.ts";
import { safeGet, safeSet, safeRemove } from "../utils/dom/storage.ts";
import { stripDisableSuffix } from "../utils/dom/display.ts";
// i18n：错误消息统一走 t()（与 web-fs.ts 全量 t("webFs.*") 一致，避免硬编码中文
// 漏掉 en/ja 三语言同步——friendlyError 对含中文消息直接透传，硬编码会在英文/日文用户侧裸显）
import { t } from "../core/i18n/t.ts";

// --- 社区/工坊数据（ADR-049 桥接增强 Batch 2）---
// 网页版无 Go 侧磁盘配置文件：bundled JSON 作默认，localStorage 作用户覆盖层
// （覆盖优先于默认，对齐桌面 Save→Load 语义）。GitHub 仓库列表为只读 bundled。
const WEB_CREATORS_KEY = "web:workshop-creators";
const WEB_SITES_KEY = "web:workshop-sites";
const WEB_GITHUB_KEY = "web:github-repos";

// 模块级串行队列：MergeWorkshopCreatorsFromJSON 的读-改-写串行化，
// 防 localStorage 无事务锁导致的并发 lost update。
let mergeSeq: Promise<unknown> = Promise.resolve();

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function loadWebCreators(): WorkshopCreator[] {
  const ov = safeGet(WEB_CREATORS_KEY);
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopCreator[];
    } catch (e) {
      // 覆盖数据损坏则回退默认 bundled，避免整个社区加载崩溃
      console.warn("[web-community] 覆盖数据损坏，回退默认:", safeErrorMessage(e));
    }
  }
  return cloneJson(creatorsJson as unknown as WorkshopCreator[]);
}

function saveWebCreators(list: WorkshopCreator[] | null): void {
  // null → 清除覆盖层，下次 Load 回退默认（对齐桌面 Save(null) 重置语义）
  if (list === null) {
    safeRemove(WEB_CREATORS_KEY);
    return;
  }
  safeSet(WEB_CREATORS_KEY, JSON.stringify(list));
}

function loadWebSites(): WorkshopSite[] {
  const ov = safeGet(WEB_SITES_KEY);
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopSite[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled
    }
  }
  return cloneJson(workshopSitesJson as unknown as WorkshopSite[]);
}

function saveWebSites(sites: WorkshopSite[] | null): void {
  if (sites === null) {
    safeRemove(WEB_SITES_KEY);
    return;
  }
  safeSet(WEB_SITES_KEY, JSON.stringify(sites));
}

// B2 契约修复：网页版 GitHub 仓库列表补覆盖层（对齐 Go workshop-github.json 用户覆盖语义）。
// 此前为纯 bundled 只读，与 Go「用户配置优先」契约不一致（contract-b2 测试暴露）。
function loadWebGitHubRepos(): WorkshopCreator[] {
  const ov = safeGet(WEB_GITHUB_KEY);
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopCreator[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled
    }
  }
  return cloneJson(workshopGithubJson as unknown as WorkshopCreator[]);
}


// --- 网页版创作者头像批量提取（替代 Go BatchExtractCreatorAvatars）---
// 复用已桥的 ScanModelEntries + ReadFileBytes + 前端 ysm-parser 解包，从 IndexedDB 模型库
// 真实提取头像（ADR-049 能力门控缺口补齐）。单模型失败不中断、返回可能为空 map。
// ADR-066 审计缺口 #8：提取成功后落 localStorage 缓存（CachedCreatorAvatar 读），
// 避免每次进工坊页重复 WASM 解码全模型库提取（原实现无缓存，日志反复"提取了 N 个头像"）。
const WEB_AVATAR_KEY = (author: string) => `web:avatar:${author}`;

function saveAvatarCache(author: string, dataUri: string): void {
  safeSet(WEB_AVATAR_KEY(author), dataUri);
}

/** CachedCreatorAvatar：读头像缓存（Go 读 cacheDir/safe.png；web 用 localStorage，由批量提取落缓存） */
async function cachedCreatorAvatar(authorName: string): Promise<string> {
  return safeGet(WEB_AVATAR_KEY(authorName)) || "";
}

/** CacheModelAvatars：web no-op——模型库头像已由 BatchExtractCreatorAvatars 批量覆盖，
 *  单模型缓存无独立语义（对齐桌面提取到 cacheDir；loader.ts 回填链路依赖它先通过） */
async function cacheModelAvatars(_path: string): Promise<void> {}

async function batchExtractCreatorAvatars(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const entries = await scanWebModels(`${WEB_ROOT}/ysm`);
    for (const e of entries) {
      // 作者名取自 [作者]模型 命名（对齐 Go app_avatar.go:38 解析口径）
      const base = e.Name.replace(/\.(ysm|zip|7z|json|ban)$/i, "");
      if (!base.startsWith("[")) continue;
      const idx = base.indexOf("]");
      if (idx <= 0) continue;
      const author = base.slice(1, idx).trim();
      if (!author || result[author]) continue;

      const b64 = await readWebFile(e.Path);
      if (!b64) continue;
      // base64 → 字节统一走 web-common.base64ToBytes（非法输入返回 null → 跳过该模型）
      const bytes = base64ToBytes(b64);
      if (!bytes) continue;
      try {
        const files = await decodeYsmFile(bytes);
        // 优先找 avatar/ 目录下首张图（对齐 Go ExtractAvatarURI 降级分支）
        for (const f of files) {
          const low = f.path.toLowerCase();
          if (!(low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg"))) continue;
          if (!low.startsWith("avatar/") && !low.includes("/avatar/")) continue;
          const mime = low.endsWith(".png") ? "image/png" : "image/jpeg";
          result[author] = `data:${mime};base64,${arrayBufferToBase64(
            f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer,
          )}`;
          saveAvatarCache(author, result[author]);
          break;
        }
      } catch {
        // 单模型解码失败：跳过，不中断批量（降级为无头像）
      }
    }
  } catch {
    // 模型库不可用：返回空 map（前端 index.ts 已处理空结果，无红错）
  }
  return result;
}

// --- 作者扫描 / 仓库索引（ADR-049 桥接增强 Batch 3）---
// 纯前端可复现：基于 IDB 模型库（scanWebModels）推导，与桌面 scanner.go 同口径
// （[作者] 前缀提取、计数降序、类型合并）。网页版无磁盘，GenerateRepoIndex 返回
// index.json 内容字符串（调用方在 web 模式触发下载，对齐桌面写盘语义）。
/** 从文件名提取 [作者] 前缀（去除 .disabled/.ban 后缀）；非括号名返回 null */
function extractBracketAuthor(name: string): string | null {
  const n = stripDisableSuffix(name);
  if (!n.startsWith("[")) return null;
  const idx = n.indexOf("]");
  if (idx <= 0) return null;
  const author = n.slice(1, idx);
  return author || null;
}

/** ListModelAuthors 网页版：从模型名 [作者] 前缀统计（计数降序），对齐 scanner.go:265 */
async function listWebAuthors(): Promise<AuthorInfo[]> {
  const entries = await collectAllWebEntries();
  const m = new Map<string, { count: number; sample: string }>();
  for (const e of entries) {
    const a = extractBracketAuthor(e.Name);
    if (!a) continue;
    const cur = m.get(a);
    if (cur) cur.count++;
    else m.set(a, { count: 1, sample: e.Path });
  }
  const result: AuthorInfo[] = [...m.entries()].map(([name, v]) => ({
    Name: name,
    Count: v.count,
    SampleFile: v.sample,
  }));
  result.sort((x, y) => y.Count - x.Count);
  return result;
}

/** ScanLocalAuthors 网页版：按 [作者] 提取并合并类型标签，对齐 scanner.go:297 */
async function scanWebLocalAuthors(): Promise<WorkshopCreator[]> {
  const entries = await collectAllWebEntries();
  const seen = new Set<string>();
  const result: WorkshopCreator[] = [];
  for (const e of entries) {
    const a = extractBracketAuthor(e.Name);
    if (!a) continue;
    const rtype = typeFromWebDir(e.Path);
    const key = `${a}@${rtype}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = result.find((c) => c.name === a);
    if (existing) {
      if (!existing.type?.includes(rtype)) {
        existing.type = existing.type ? `${existing.type};${rtype}` : rtype;
      }
    } else {
      result.push({ name: a, desc: "来自本地仓库", type: rtype });
    }
  }
  return result;
}

/** 相对路径是否含回收站目录段 .recycle（大小写不敏感，对齐 Go fsutil.IsRecycleDir） */
function isRecycleRel(rel: string): boolean {
  return rel.split("/").some((seg) => seg && seg.toLowerCase() === ".recycle");
}

/** GenerateRepoIndex 网页版：扫描虚拟根生成 index.json 内容（路径相对 repoPath，正斜杠） */
async function generateWebRepoIndex(repoPath: string): Promise<string> {
  const entries = repoPath && repoPath.startsWith(WEB_ROOT)
    ? await scanWebModels(repoPath)
    : await collectAllWebEntries();
  // 过滤 .recycle 段：回收站目录下的"已删/待清理"条目不进 index（对齐 Go 桌面 scanner 的 IsRecycleDir 跳过）
  const list = entries
    .map((e) => {
      let rel = e.Path;
      if (repoPath && e.Path.startsWith(repoPath)) {
        rel = e.Path.slice(repoPath.length).replace(/^[/\\]/, "");
      } else if (e.Path.startsWith(WEB_ROOT)) {
        rel = e.Path.slice(WEB_ROOT.length).replace(/^[/\\]/, "");
      }
      return { e, rel: rel.replace(/\\/g, "/") };
    })
    .filter(({ rel }) => !isRecycleRel(rel))
    .map(({ e, rel }) => {
      // 对齐 go/scanner/scanner.go indexEntry json tag：小写 name/path/size + hash,omitempty
      const entry: { name: string; path: string; size: number; hash?: string } = {
        name: e.Name,
        path: rel,
        size: e.Size,
      };
      if (e.Hash) entry.hash = e.Hash;
      return entry;
    });
  return JSON.stringify(list, null, 2);
}

// ===== 社区/头像/作者/仓库索引类 binding 片段（Top 6 注册表驱动：browser-adapter.ts 只做 {...} 装配）=====
// 收敛自 browser-adapter.ts webImpls 的 community 类条目（创作者/工坊站点/GitHub 仓库/
// 本地作者扫描/仓库索引）。
export const webCommunityBindings = {
  // 网页版创作者头像批量提取（复用 ScanModelEntries + ReadFileBytes + ysm-parser）
  BatchExtractCreatorAvatars: () => batchExtractCreatorAvatars(),
  // ADR-066 审计缺口 #8：头像缓存读取（批量提取落 localStorage）+ 单模型缓存 no-op
  CachedCreatorAvatar: (authorName: string) => cachedCreatorAvatar(authorName),
  CacheModelAvatars: (path: string) => cacheModelAvatars(path),
  ListModelAuthors: () => Promise.resolve(listWebAuthors()),
  ScanLocalAuthors: () => Promise.resolve(scanWebLocalAuthors()),
  GenerateRepoIndex: (repoPath: string) => Promise.resolve(generateWebRepoIndex(repoPath)),
  // bundled 默认 + localStorage 覆盖（对齐桌面 Save→Load 语义）；GitHub 仓库列表只读
  LoadWorkshopCreators: () => Promise.resolve(loadWebCreators()),
  SaveWorkshopCreators: (list: WorkshopCreator[] | null) => {
    saveWebCreators(list);
    return Promise.resolve();
  },
  LoadGitHubRepos: () => Promise.resolve(loadWebGitHubRepos()),
  DefaultWorkshopSites: () => Promise.resolve(loadWebSites()),
  SaveWorkshopSites: (sites: WorkshopSite[] | null) => {
    saveWebSites(sites);
    return Promise.resolve();
  },
  // R3-P0（web-edition.md）：站点级编辑保存 + JSON 合并——与 Go 同语义，基于
  // localStorage 覆盖层（"编辑站点→保存"恢复可用；原 web 未桥接恒抛
  // WebUnsupportedError，community-data.ts 有对应门控，现已移除）
  SaveWorkshopCreatorsBySite: (siteID: string, siteCreators: WorkshopCreator[]) => {
    const all = loadWebCreators();
    // 移除该站点旧条目（type 分号分隔精确段匹配，对齐 Go app_workshop.go
    // inTypeSegments——原 includes(siteID + ";") 会把 "ba;c" 误配 siteID="a"）
    const kept = all.filter((c) => {
      const t = c.type || "";
      return !t.split(";").includes(siteID);
    });
    saveWebCreators([...kept, ...siteCreators]);
    return Promise.resolve();
  },
  SaveWorkshopPresetsBySite: (siteID: string, presets: WorkshopPresetSearch[]) => {
    const sites = loadWebSites();
    const s = sites.find((x) => x.id === siteID);
    if (s) {
      s.presetSearches = presets;
      saveWebSites(sites);
    }
    return Promise.resolve();
  },
  MergeWorkshopCreatorsFromJSON: (jsonContent: string): Promise<[number, number]> => {
    let imported: WorkshopCreator[];
    try {
      imported = JSON.parse(jsonContent) as WorkshopCreator[];
    } catch (e) {
      return Promise.reject(new Error(t("webCommunity.importJsonParseFailed", { err: safeErrorMessage(e) })));
    }
    const MIN_IMPORT = 20;
    if (!Array.isArray(imported) || imported.length < MIN_IMPORT) {
      return Promise.reject(new Error(t("webCommunity.importTooFew", { count: imported.length, min: MIN_IMPORT })));
    }
    // 逐字段校验：cr.name 必须是非空字符串，非法元素跳过（防 __proto__ 注入 / 畸形数据污染）
    imported = imported.filter((cr): cr is WorkshopCreator =>
      cr != null && typeof cr === "object" && typeof cr.name === "string" && cr.name.length > 0
    );
    if (imported.length < MIN_IMPORT) {
      return Promise.reject(new Error(t("webCommunity.importTooFew", { count: imported.length, min: MIN_IMPORT })));
    }
    // 串行化读-改-写：localStorage 无事务锁，并发 merge 各自读到同一份 existing，
    // 后写者覆盖先写者的 added 条目 → lost update。模块级 Promise 链串行排队。
    const runMerge = (): Promise<[number, number]> => {
      const existing = loadWebCreators();
      const existMap = new Map<string, number>();
      existing.forEach((c, i) => existMap.set(c.name, i));
      let added = 0;
      let updated = 0;
      for (const cr of imported) {
        const idx = existMap.get(cr.name);
        if (idx !== undefined) {
          const e = existing[idx]!;
          if (cr.desc && !e.desc) e.desc = cr.desc;
          if (cr.type) e.type = cr.type;
          if (cr.role) e.role = cr.role;
          updated++;
        } else {
          existing.push(cr);
          existMap.set(cr.name, existing.length - 1);
          added++;
        }
      }
      if (existing.length < 100) {
        return Promise.reject(new Error(t("webCommunity.mergeTooFew", { count: existing.length })));
      }
      saveWebCreators(existing);
      return Promise.resolve([added, updated]);
    };
    const result = mergeSeq.then(runMerge);
    // 链回序列：无论成功/失败，都释放 token 让下一次 merge 进队
    mergeSeq = result.then(() => undefined, () => undefined);
    return result;
  },
  // ADR-172：社区索引增量并入（web 桥）——语义镜像 Go MergeCommunityCreatorsFromJSON：
  // desc/role 空补 + type 分号段并入（非覆盖，不丢站点）+ 幂等短路（无变更不写覆盖层）。
  // 与 MergeWorkshopCreatorsFromJSON（手动导入：type 覆盖 + ≥20/≥100 硬校验）刻意区分，
  // 前端自动/手动同步共用此 binding（community-data.ts tryAutoMergeCommunity / site edit.ts）。
  MergeCommunityCreatorsFromJSON: (communityJSON: string): Promise<[number, number]> => {
    let imported: WorkshopCreator[];
    try {
      imported = JSON.parse(communityJSON) as WorkshopCreator[];
    } catch (e) {
      return Promise.reject(new Error(t("webCommunity.importJsonParseFailed", { err: safeErrorMessage(e) })));
    }
    // 逐字段净化：name 必须非空字符串（对齐 Go 净化口径，防畸形数据污染覆盖层）
    if (!Array.isArray(imported)) {
      return Promise.reject(new Error(t("webCommunity.communityEmpty")));
    }
    imported = imported.filter((cr): cr is WorkshopCreator =>
      cr != null && typeof cr === "object" && typeof cr.name === "string" && cr.name.length > 0
    );
    if (imported.length === 0) {
      return Promise.reject(new Error(t("webCommunity.communityEmpty")));
    }
    // 串行化读-改-写：localStorage 无事务锁，与 MergeWorkshopCreatorsFromJSON 共用
    // mergeSeq 队列（两类合并都写 WEB_CREATORS_KEY，须互斥防 lost update）
    const runMerge = (): Promise<[number, number]> => {
      const existing = loadWebCreators();
      const existMap = new Map<string, number>();
      existing.forEach((c, i) => existMap.set(c.name, i));
      let added = 0;
      let updated = 0;
      for (const cr of imported) {
        const idx = existMap.get(cr.name);
        if (idx === undefined) {
          existing.push(cr);
          existMap.set(cr.name, existing.length - 1);
          added++;
          continue;
        }
        const e = existing[idx]!;
        let changed = false;
        if (cr.desc && !e.desc) {
          e.desc = cr.desc;
          changed = true;
        }
        // type 分号段并入（trim/去空/去重，镜像 Go mergeTypeSegments）
        const segs = (e.type || "")
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const s of (cr.type || "").split(";")) {
          const seg = s.trim();
          if (seg && !segs.includes(seg)) {
            segs.push(seg);
            changed = true;
          }
        }
        if (changed) e.type = segs.join(";");
        if (cr.role && !e.role) {
          e.role = cr.role;
          changed = true;
        }
        if (changed) updated++;
      }
      // 幂等短路：本地已含社区全部条目 → 不写覆盖层（对齐 Go 无变更不落盘）
      if (added === 0 && updated === 0) {
        return Promise.resolve([0, 0]);
      }
      saveWebCreators(existing);
      return Promise.resolve([added, updated]);
    };
    const result = mergeSeq.then(runMerge);
    // 链回序列：无论成功/失败，都释放 token 让下一次 merge 进队
    mergeSeq = result.then(() => undefined, () => undefined);
    return result;
  },
} satisfies Record<string, (...args: never[]) => Promise<unknown>>;
