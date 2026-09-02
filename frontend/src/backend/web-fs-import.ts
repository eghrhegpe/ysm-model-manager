// ===== web-fs 导入分组（ADR-040 职责切分延续，自 web-fs.ts §15 拆出）=====
// 网页版导入：File API/拖拽 → IndexedDB（ADR-049 Phase 2 数据层）。
// UI 入口（拖拽区/导入按钮）由 Phase 3 能力门控接入；本模块独立可测。
// 返回 {imported, failed} 供调用方提示。
//
// 过滤与分组（对齐桌面 dnd-shared 白名单 + import-dnd 100MB 上限）：
// - 多文件模型按 stem 分组：文件夹拖入扁平化后，同 stem（webkitRelativePath 首段
//   或去扩展名 basename）的辅助文件（avatar.png / main.json / tex_*.png）并入该模型，
//   仅主文件建 dir 条目 → 消灭「每文件独立成模型」的碎片化
// - 组内须存在主文件（.ysm / ysm.json），否则整组失败（散落 .txt/.png/任意 json
//   无主文件 → 明确 failed 提示，而非假成功入库）
// - .zip 视为模型主文件（与 .ysm 同属 ZIP 容器，WASM 解码器直接处理），不拒绝
// - 超出 100MB 跳过（对齐 import-dnd oversize 过滤）
import { idbGet, idbSet, idbDel } from "./idb.ts";
import { MAX_IMPORT_BYTES } from "./web-common.ts";
// R2 导入增强：ZIP 解压（extractZip 解出文件；文件名以 fflateKey 入库——
// 前端无 GBK 码表，非 UTF-8 中文名降级透传 fflateKey，数据访问不受影响）
import { extractZip } from "./extract.ts";
import { dirKey, fileKey, mainFileRank, MAIN_FILE_RANK_TYPE } from "./web-fs-shared.ts";

/**
 * 检测 ZIP entries 是否共享公共顶层目录。
 * 例：["狐狸/ysm.json", "狐狸/models/main.json"] → "狐狸"
 *     ["ysm.json", "models/main.json"] → null（扁平，无公共顶层）
 */
function findCommonTopDir(metas: Array<{ fflateKey: string }>): string | null {
  const firstDir = metas[0]?.fflateKey.split("/")[0];
  if (!firstDir) return null;
  for (const m of metas) {
    const d = m.fflateKey.split("/")[0];
    if (d !== firstDir) return null;
  }
  return firstDir;
}

/**
 * 安全审计：zip entry 路径清洗——剥离路径穿越段（`..`）和空段，
 * 防止恶意 zip 条目名逃出 IndexedDB 模型组命名空间导致数据损坏。
 * 返回 null 表示路径全部由无效段组成（如纯 `../..`），调用方应跳过该条目。
 */
function sanitizeZipEntryPath(name: string): string | null {
  // 拆分路径段，过滤 `.` 和 `..`（`..` 为路径穿越攻击，必须拒绝）
  const parts = name.split(/[\/\\]/);
  const safe: string[] = [];
  for (const p of parts) {
    if (p === ".." || p === "") continue; // 跳过空段和父目录引用
    safe.push(p);
  }
  if (safe.length === 0) return null;
  return safe.join("/");
}

/**
 * R2 导入增强：把输入里的 .zip 文件解压展平成目录文件，返回新的 File[]。
 * - .zip → extractZip 解出 entries（带相对路径），转成带 webkitRelativePath 的 File[]，
 *   复用文件夹拖入的「同 stem 分组 + 主文件目录收敛」语义，rel 保留子目录层级
 * - 非 .zip / .ysm → 原样透传（.ysm 保持整体，WASM 解码器直接处理）
 * - 解压失败（非标准 zip / 超限）→ 保留原 zip 单个文件（走「zip 当主文件」兜底），不阻断
 * - ADR-066 审计缺口 #3：解压后**无主文件**（如资源包 zip 解出 pack.mcmeta + data/，
 *   均非主文件扩展名）→ 保留原 zip 整体当主文件（救回 resourcepack/shaderpack 导入，
 *   原实现整组 failed imported=0）
 */
async function expandZipFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (!/\.zip$/i.test(f.name) || f.size > MAX_IMPORT_BYTES) {
      out.push(f);
      continue;
    }
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const { entries, metas } = extractZip(data);
      if (!metas.length) {
        out.push(f);
        continue;
      }
      // 安全审计：先用 sanitizeZipEntryPath 清洗路径，再判断公共前缀
      // 避免恶意 zip 的 `..` 段干扰 findCommonTopDir（CodeReview 第五轮发现）
      const sanitizedMetas = metas.map((m) => {
        // 文件名以 fflateKey 原值入库（前端无 GBK 码表，非 UTF-8 中文名降级透传）
        return { fflateKey: sanitizeZipEntryPath(m.fflateKey) ?? "", _meta: m };
      }).filter((m) => m.fflateKey !== "");
      // 检测 zip 内是否有公共顶层目录（如 "狐狸/ysm.json" → 公共前缀 "狐狸/"）
      // 扁平 zip（"ysm.json" + "models/main.json"）无公共前缀 → 用 zipStem 防碎片化
      const topLevelDir = findCommonTopDir(sanitizedMetas);
      const prefix = topLevelDir ? "" : f.name.replace(/\.zip$/i, "");
      const expanded: File[] = [];
      for (const sm of sanitizedMetas) {
        const m = sm._meta;
        const raw = entries[m.fflateKey];
        if (!raw) continue;
        const sanitized = sm.fflateKey; // 已清洗路径
        // webkitRelativePath：有公共前缀则保留原样；扁平 zip 用 zipStem 作公共前缀
        // slice() 两用：① TS 泛型 Uint8Array<ArrayBufferLike>→Uint8Array<ArrayBuffer> 过 BlobPart 类型关；
        // ② 隔离 entries[m.fflateKey] 底层 buffer，防 File 与 entries 共享后被改写（内容竞态）
        const wf = new File([raw.slice()], sanitized.split("/").pop() || sanitized, {
          type: "application/octet-stream",
        });
        Object.defineProperty(wf, "webkitRelativePath", { value: prefix ? `${prefix}/${sanitized}` : sanitized });
        expanded.push(wf);
      }
      // 解压空/无有效文件，或解压后无主文件（资源包/光影包 zip）→ 保留原 zip 整体当主文件
      if (expanded.length === 0 || !expanded.some((wf) => mainFileRank(wf.name) >= MAIN_FILE_RANK_TYPE)) {
        out.push(f);
      } else {
        out.push(...expanded);
      }
      // GBK 中文名降级提示：gpf 未设时 fflateKey 为 Latin-1 乱码，
      // 前端无 GBK 码表无法解码真名——仅提示，用户端用 modelPath 不影响预览
      if (metas.length > 0 && metas.some((m) => !m.gpfUtf8)) {
        console.warn("[web] ZIP 含非 UTF-8 文件名（可能为 GBK），解压后文件名以 fflateKey 原值入库（中文可能乱码）");
      }
    } catch {
      out.push(f); // 解压失败 → 降级为整体入库，不阻断
    }
  }
  return out;
}

// ===================================================================
// importWebFiles — 子函数类型与工具
// ===================================================================

/** 已写入 key + 先前是否存在（P3 回滚精度护栏） */
type WrittenKey = { key: string; preExisted: boolean };

/**
 * [子函数 1/6] .7z 过滤：网页版不支持 7z 解压，剔除并提示。
 * 返回过滤后的 File[]（不改入参 files）。
 */
function filterSevenZ(files: File[]): File[] {
  const sevenZCount = files.filter((f) => f.name.toLowerCase().endsWith(".7z")).length;
  if (sevenZCount > 0) {
    console.warn(`[web-fs] ${sevenZCount} 个 .7z 文件已跳过（网页版暂不支持 .7z 解压）`);
    return files.filter((f) => !f.name.toLowerCase().endsWith(".7z"));
  }
  return files;
}

/**
 * [子函数 2/6] 阶段1 粗分组：按 roughStemOf（首段目录或去扩展名 basename）聚堆。
 * 返回 { rough, failed }：无有效 stem / 抛异常的文件计入 failed。
 */
function buildRoughGroups(expanded: File[]): { rough: Map<string, File[]>; failed: number } {
  const rough = new Map<string, File[]>();
  let failed = 0;
  for (const f of expanded) {
    try {
      const key = roughStemOf(f);
      if (!key) {
        failed++;
        continue;
      }
      const arr = rough.get(key);
      if (arr) arr.push(f);
      else rough.set(key, [f]);
    } catch {
      failed++;
    }
  }
  return { rough, failed };
}

/**
 * [子函数 3/6] 阶段2 细分组：粗组 → 主文件目录集合 → 按 assignMainDir 归属精分组。
 * 无目录主文件时回退「basenameStem 单文件分组」。
 */
function buildFinalGroups(rough: Map<string, File[]>): Map<string, File[]> {
  const groups = new Map<string, File[]>();
  for (const [, rg] of rough) {
    // 主文件目录集合（rank>=TYPE 且未超限，超限主文件不参与定组）
    const mainDirs = new Set<string>();
    for (const f of rg) {
      if (mainFileRank(f.name) >= MAIN_FILE_RANK_TYPE && f.size <= MAX_IMPORT_BYTES) {
        const d = fsaDirOf(f);
        if (d) mainDirs.add(d);
      }
    }
    if (mainDirs.size === 0) {
      // 无目录主文件（纯 basename 拖入 / 顶层文件）：退化单文件分组
      for (const f of rg) {
        const stem = basenameStem(f);
        const arr = groups.get(stem);
        if (arr) arr.push(f);
        else groups.set(stem, [f]);
      }
      continue;
    }
    for (const f of rg) {
      const d = assignMainDir(f, mainDirs);
      const stem = d ?? roughStemOf(f);
      const arr = groups.get(stem);
      if (arr) arr.push(f);
      else groups.set(stem, [f]);
    }
  }
  return groups;
}

/**
 * [子函数 4/6] 组有效性前置校验：
 *   - 组内存在任一主文件（散杂物→整组失败）
 *   - 至少有 1 个主文件未超限（全部超限→不写任何东西，防新旧混合）
 * 通过返回 true；失败时调用方负责把 group.length 计入 failed。
 */
function validateGroupHasUsableMain(group: File[]): boolean {
  let hasMain = false;
  for (const f of group) {
    if (mainFileRank(f.name) >= MAIN_FILE_RANK_TYPE) {
      hasMain = true;
      break;
    }
  }
  if (!hasMain) return false;
  return group.some(
    (f) => mainFileRank(f.name) >= MAIN_FILE_RANK_TYPE && f.size <= MAX_IMPORT_BYTES,
  );
}

/**
 * [子函数 5/6] 组写入主流程：遍历文件落 IDB → 写 dirKey 目录条目。
 * 返回 { success, fileFails }。success=false 表示无任何文件写入。
 * writtenKeys 为调用方传入的**累积器**（out-param）：每次写入成功即 push，
 * 中途抛错时调用方 catch 仍能拿到已落盘的 key 做回滚（若用局部数组只在成功路径
 * 返回，idbSet 中途抛错会丢——P2 回归：回滚 no-op 留下孤儿条目）。
 */
async function writeGroupFiles(
  group: File[],
  type: string,
  stem: string,
  writtenKeys: WrittenKey[],
): Promise<{ success: boolean; fileFails: number }> {
  let wrote = false;
  let fileFails = 0;

  for (const f of group) {
    if (f.size > MAX_IMPORT_BYTES) {
      fileFails++;
      continue;
    }
    const data = await f.arrayBuffer();
    const k = fileKey(type, stem, relOf(f, stem));
    const preExisted = (await idbGet("files", k)) !== undefined;
    await idbSet("files", k, {
      data,
      size: data.byteLength,
      mime: f.type || "application/octet-stream",
    });
    writtenKeys.push({ key: k, preExisted });
    wrote = true;
  }

  if (!wrote) return { success: false, fileFails };

  const dk = dirKey(type, stem);
  const dkPreExisted = (await idbGet("files", dk)) !== undefined;
  await idbSet("files", dk, { name: stem, addedAt: Date.now() });
  writtenKeys.push({ key: dk, preExisted: dkPreExisted });

  return { success: true, fileFails };
}

/**
 * [子函数 6/6] 组失败回滚（P2/P3 精度护栏）：
 * 仅删 preExisted=false 的本次新建 key；回滚失败静默——已处于失败路径，不改变结局。
 */
async function rollbackWrittenKeys(writtenKeys: WrittenKey[]): Promise<void> {
  for (const { key, preExisted } of writtenKeys) {
    if (preExisted) continue;
    try {
      await idbDel("files", key);
    } catch {
      /* best-effort */
    }
  }
}

// ===================================================================
// importWebFiles — 主函数
// ===================================================================

/**
 * 导入主流程：.7z 过滤 → ZIP 展平 → 粗分组 → 细分组 → 逐组 校验/写入/回滚。
 */
export async function importWebFiles(
  files: File[],
  type: string,
): Promise<{ imported: number; failed: number }> {
  // 阶段1：.7z 过滤（网页版不支持）+ ZIP 展平为目录文件数组
  const cleanFiles = filterSevenZ(files);
  let imported = 0;
  let failed = 0;
  const expanded = await expandZipFiles(cleanFiles);

  // 阶段2：粗分组（按 top-dir / basename 首段）
  const { rough, failed: roughFailed } = buildRoughGroups(expanded);
  failed += roughFailed;

  // 阶段3：细分组（按主文件目录收敛，最长匹配胜）
  const groups = buildFinalGroups(rough);

  // 阶段4-6：逐组 校验 → 写入 → 回滚
  for (const [stem, group] of groups) {
    if (!validateGroupHasUsableMain(group)) {
      failed += group.length;
      continue;
    }
    // writtenKeys 累积器传入 writeGroupFiles（out-param）：每次写入成功即 push，
    // 中途抛错时 catch 仍能拿到已落盘的 key 做回滚（若在 writeGroupFiles 内用局部
    // 数组只在成功路径返回，idbSet 中途抛错会丢——P2 回归：回滚 no-op 留下孤儿条目）。
    const writtenKeys: WrittenKey[] = [];
    try {
      const result = await writeGroupFiles(group, type, stem, writtenKeys);
      if (!result.success) {
        failed += group.length;
        continue;
      }
      imported++;
      failed += result.fileFails;
    } catch (e) {
      // P2/P3 护栏：回滚 writtenKeys 中「本次新建」的条目，保留旧数据不被误删。
      // 不静默吞错：记录真实原因（quota 超限 / IDB 异常等）供诊断，失败计数照常累加
      console.error(`[web-fs-import] 组「${stem}」写入失败:`, e);
      await rollbackWrittenKeys(writtenKeys);
      failed += group.length;
    }
  }

  return { imported, failed };
}

/**
 * 粗分组键（阶段1）：webkitRelativePath 首段（文件夹拖入）或去扩展名 basename（单文件拖入）。
 */
function roughStemOf(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel) {
    const top = rel.split("/")[0];
    if (top) return top;
  }
  return basenameStem(f);
}

/** 去扩展名 basename（纯 basename 分组 / 单文件拖入场景的组名） */
function basenameStem(f: File): string {
  return f.name.replace(/\.\w+$/, "");
}

/** 文件所在目录（webkitRelativePath 去文件名，可多段）；无相对路径或顶层文件 → null */
function fsaDirOf(f: File): string | null {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!rel) return null;
  const dir = rel.split("/").slice(0, -1).join("/");
  return dir || null;
}

/** 归属判定（阶段2）：文件所在目录包含于某主文件目录 → 归该组（最长者胜）；否则 null */
function assignMainDir(f: File, mainDirs: Set<string>): string | null {
  const d = fsaDirOf(f);
  if (!d) return null;
  let best: string | null = null;
  for (const m of mainDirs) {
    if (d === m || d.startsWith(`${m}/`)) {
      if (!best || m.length > best.length) best = m;
    }
  }
  return best;
}

/** 组内文件相对模型目录的路径：webkitRelativePath 去掉 stem 前缀（保留子目录层级）；无相对路径时用 basename */
function relOf(f: File, stem: string): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel && rel.startsWith(`${stem}/`)) return rel.slice(stem.length + 1);
  return f.name;
}
