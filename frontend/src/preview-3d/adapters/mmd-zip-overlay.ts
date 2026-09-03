// ===== MMD ZIP Overlay Port：给 buildMmdScene 配一个「翻译官」=====
//
// 设计哲学（来自 CodeReview 反馈）：
//   不要让 800 行老将学新规矩，给它配一个翻译官（overlay port），
//   战场就只有一个入口哨卡。buildMmdScene 内部零改动，
//   所有磁盘 I/O 走 port → overlay 拦截 → zip entry 直取。
//
// 三条路由：
//   1. readFileBytes(p)          → p 在虚拟路径前缀内 → zip 查 entry
//   2. readFileBytesBatch([...])  → 逐条分流（zip 内 / zip 外）
//   3. listAllFilePaths(dir)      → dir 为虚拟目录 → 返回 zip 所有 entry 路径

import { b64ToBytes, bytesToBase64 } from "../base64.ts";
import { extractZip } from "../../parsers/extract.ts";
import type { MmdDataPort } from "./mmd-adapter.ts";

/** ZIP 解析产物（传给 overlay 的配置） */
export interface MmdZipConfig {
  /** 原 zip 文件路径（用作虚拟路径前缀的锚点） */
  zipPath: string;
  /** 选中模型的 zip 内相对路径（lowercase，如 "model.pmx"） */
  modelEntry: string;
  /** 选中模型的字节 */
  modelBytes: Uint8Array;
  /** 全部 zip entry：lowercase(relPath) → Uint8Array */
  entries: Map<string, Uint8Array>;
  /** 全部 zip entry 路径（lowercase） */
  entryPaths: string[];
  /** 模型 basename（如 "model.pmx"，用于 texMap keying） */
  modelBase: string;
  /** [doc:adr-132] zip 内全部 pmx/pmd 候选（排序后，第一个 = 默认选中）——供模型选择面板列出 */
  modelCandidates: Array<{ key: string; base: string }>;
}

/**
 * 解压 zip + 找 .pmx/.pmd 模型 → 返回 MmdZipConfig。
 * 优先 .pmx，兜底 .pmd；多模型按字典序取第一个（稳定选择）。
 */
export async function resolveMmdZipConfig(
  zipPath: string,
  port: MmdDataPort,
): Promise<MmdZipConfig> {
  const zipB64 = await port.readFileBytes(zipPath);
  if (!zipB64) throw new Error("ReadFileBytes 返回空（zip 文件）");
  const zipBytes = b64ToBytes(zipB64);
  const { entries, metas } = extractZip(zipBytes);

  // 构建「真实文件名 → 字节」映射（GBK 解码中文名）
  const entriesMap = new Map<string, Uint8Array>();
  const entryPaths: string[] = [];
  const seen = new Set<string>();

  for (const meta of metas) {
    // 前端无 GBK 码表：文件名以 fflateKey 原值（Latin-1 解码）直接使用
    const realName = meta.fflateKey;
    const fflateKey = meta.fflateKey;
    const bytes = entries[fflateKey];
    if (!bytes || !realName) continue;
    const key = realName.toLowerCase().replace(/\\/g, "/");
    if (seen.has(key)) continue;
    seen.add(key);
    entriesMap.set(key, bytes);
    entryPaths.push(key);
  }
  for (const [key, bytes] of Object.entries(entries)) {
    const k = key.toLowerCase().replace(/\\/g, "/");
    if (!seen.has(k)) {
      seen.add(k);
      entriesMap.set(k, bytes);
      entryPaths.push(k);
    }
  }

  // 找模型文件
  const MODEL_EXTS = [".pmx", ".pmd"];
  const candidates: Array<{ key: string; bytes: Uint8Array; base: string; ext: string }> = [];
  for (const [key, bytes] of entriesMap) {
    for (const ext of MODEL_EXTS) {
      if (key.endsWith(ext)) {
        candidates.push({ key, bytes, base: key.split("/").pop() || key, ext });
        break;
      }
    }
  }
  if (candidates.length === 0) throw new Error("ZIP 内未找到 .pmx / .pmd 模型文件");
  candidates.sort((a, b) => {
    const pa = a.ext === ".pmx" ? 0 : 1;
    const pb = b.ext === ".pmx" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.key.localeCompare(b.key);
  });
  const selected = candidates[0];
  // [doc:adr-132] 全部候选暴露（模型选择面板列出；第一个仍是默认）
  const modelCandidates = candidates.map((c) => ({ key: c.key, base: c.base }));

  return {
    zipPath,
    modelEntry: selected.key,
    modelBytes: selected.bytes,
    entries: entriesMap,
    entryPaths,
    modelBase: selected.base,
    modelCandidates,
  };
}

/**
 * 创建 ZIP Overlay Port：包装 MmdDataPort，
 * 将 zip 内路径前缀（如 "/repo/miku.zip!/"）路由到内存中的 zip entries。
 *
 * 返回值：
 *   port     — 包装后的 MmdDataPort（传给 buildMmdScene）
 *   rootPath — 虚拟根路径（如 "/repo/miku.zip!/"）
 *             buildMmdScene 内部 dirPath 计算会自动以此为基准
 * （模型本体 blob 由 buildMmdScene 自行构造并纳入 blobUrls 清理，
 *   此处不再创建 modelUrl——未消费的 blob URL 会随每次 zip 预览泄漏，code review P2）
 */
export function makeZipOverlayPort(
  inner: MmdDataPort,
  config: MmdZipConfig,
): { port: MmdDataPort; rootPath: string } {
  const ROOT = config.zipPath + "!/";

  const overlay: MmdDataPort = {
    // ---- readFileBytes：虚拟路径 → zip entry ----
    readFileBytes: async (p) => {
      if (p.startsWith(ROOT)) {
        const rel = p.slice(ROOT.length).toLowerCase();
        const bytes = config.entries.get(rel);
        return bytes ? bytesToBase64(bytes) : null;
      }
      return inner.readFileBytes(p);
    },

    // ---- readFileBytesBatch：逐条分流（zip 内走内存，zip 外委托 inner）----
    readFileBytesBatch: async (paths) => {
      const result: Record<string, string | null> = {};
      const realPaths: string[] = [];
      for (const p of paths) {
        if (p.startsWith(ROOT)) {
          const rel = p.slice(ROOT.length).toLowerCase();
          const bytes = config.entries.get(rel);
          result[p] = bytes ? bytesToBase64(bytes) : null;
        } else {
          realPaths.push(p);
        }
      }
      if (realPaths.length > 0) {
        Object.assign(result, await inner.readFileBytesBatch(realPaths));
      }
      return result;
    },

    // ---- listAllFilePaths：虚拟目录 → 返回 zip 全部 entry 路径（带前缀）----
    listAllFilePaths: async (dir) => {
      const d = dir.endsWith("/") ? dir : dir + "/";
      if (d === ROOT || d.startsWith(ROOT)) {
        const relDir = d.slice(ROOT.length);
        const all = config.entryPaths.map((p) => ROOT + p);
        if (relDir === "") return all;
        // 子目录过滤：只保留以 relDir 开头的条目
        return all.filter((p) => {
          const rel = p.slice(ROOT.length);
          return rel.startsWith(relDir);
        });
      }
      return inner.listAllFilePaths(dir);
    },

    // ---- addOpLog：透传 ----
    addOpLog: inner.addOpLog,

    // ---- readFileBytesBatchWithMeta：分流 + 无 hash（zip 内无 hash 概念）----
    readFileBytesBatchWithMeta: async (paths) => {
      const result: Record<string, { data: string | null; hash: string } | null> = {};
      const realPaths: string[] = [];
      for (const p of paths) {
        if (p.startsWith(ROOT)) {
          const rel = p.slice(ROOT.length).toLowerCase();
          const bytes = config.entries.get(rel);
          result[p] = bytes ? { data: bytesToBase64(bytes), hash: "" } : null;
        } else {
          realPaths.push(p);
        }
      }
      if (realPaths.length > 0 && inner.readFileBytesBatchWithMeta) {
        Object.assign(result, await inner.readFileBytesBatchWithMeta(realPaths));
      }
      return result;
    },

    // ---- getCachedTexture：透传（KTX2 缓存与 zip 无关）----
    getCachedTexture: inner.getCachedTexture,
    // ---- KTX2 缓存读/写通道：透传（zip 内纹理 hash 为空不命中，zip 外委托 inner）----
    getCachedTextureByHash: inner.getCachedTextureByHash,
    hasCachedTextures: inner.hasCachedTextures,
    saveCachedTexture: inner.saveCachedTexture,
  };

  return { port: overlay, rootPath: ROOT };
}

/**
 * 构造完整的 zip 包装流程：
 *   检测 zip → 解析 zip → 创建 overlay → 返回 { port, rootPath }
 * 调用方只需：
 *   const { port, rootPath } = await prepareMmdZipInput(path, port);
 *   const scene = await buildMmdScene(ctx, rootPath, port, panels);
 * （模型本体由 buildMmdScene 从 modelBytes 自建 blob URL，无需此处生成）
 */
export async function prepareMmdZipInput(
  path: string,
  port: MmdDataPort,
): Promise<{ port: MmdDataPort; rootPath: string; modelBytes: Uint8Array; modelBase: string; modelEntry: string; allModelEntries: string[] }> {
  const config = await resolveMmdZipConfig(path, port);
  const { port: overlay, rootPath } = makeZipOverlayPort(port, config);
  return {
    port: overlay,
    rootPath,
    modelBytes: config.modelBytes,
    modelBase: config.modelBase,
    modelEntry: config.modelEntry,
    allModelEntries: config.modelCandidates.map((c) => c.key),
  };
}

/** 从 zip entries 中按名称查找（大小写不敏感，basename 匹配） */
export function zipFindEntry(entries: Map<string, Uint8Array>, name: string): Uint8Array | null {
  const low = name.toLowerCase();
  if (entries.has(low)) return entries.get(low)!;
  for (const [key, bytes] of entries) {
    const base = key.split("/").pop() || key;
    if (base === low) return bytes;
  }
  return null;
}
