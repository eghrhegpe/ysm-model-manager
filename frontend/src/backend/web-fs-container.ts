// ===== web-fs 容器内条目枚举 + 体素读取（ADR-132 遗留 1，ADR-040 拆分延续）=====
// 从 web-fs.ts §6.5 拆出：蓝图/litematic zip 多 nbt 预览的容器条目枚举与容器内体素读取。
// 镜像 Go internal/app/container_entries.go 的 ListContainerEntries / GetVoxelDataInContainer：
// 读 IDB → base64 → 字节 → extractZip → 按扩展名白名单过滤（ListContainerEntries）；
// 容器内条目 → findZipEntry → 字节 → decodeVoxelNbt → voxelView（GetVoxelDataInContainer）。
// 失败契约对齐 Go：枚举失败 → "[]"；体素失败 → {"error": string}。
// 共享读取装配（readWebFile / readWebZipEntries / voxelFromBase64 / VOXEL_MAX_BLOCKS）
// 来自 web-fs-read.ts 叶子——断对 web-fs.ts 主文件的循环依赖。

import { base64ToBytes, u8ToBase64 } from "./web-common.ts";
import { extractZip } from "../parsers/extract.ts";
import { findZipEntry } from "../parsers/pack-meta.ts";
import { type VoxelData } from "../parsers/voxel-parse.ts";
import { readWebFile, readWebZipEntries, voxelFromBase64 } from "./web-fs-read.ts";

/** 镜像 Go parseContainerExts：逗号分隔扩展名白名单（无点前缀自动补；空 → 放行全部） */
function webParseContainerExts(exts: string): Set<string> {
  const out = new Set<string>();
  for (const e of exts.split(",")) {
    const e2 = e.trim().toLowerCase();
    if (!e2) continue;
    out.add(e2.startsWith(".") ? e2 : "." + e2);
  }
  return out;
}

/** 镜像 Go containerExtMatch：条目名扩展名是否在白名单内（大小写不敏感） */
function webContainerExtMatch(name: string, exts: Set<string>): boolean {
  if (exts.size === 0) return true;
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return exts.has(name.slice(i).toLowerCase());
}

/** 镜像 Go containerEntrySafe：禁 .. / 反斜杠 / 绝对路径（防穿越） */
function webContainerEntrySafe(name: string): boolean {
  if (!name) return false;
  if (name.startsWith("/")) return false;
  return !name.includes("..") && !name.includes("\\");
}

/** 容器内条目枚举：ListContainerEntries 镜像（exts 逗号分隔；失败 → []） */
export async function listWebContainerEntries(path: string, exts: string): Promise<string[]> {
  try {
    const entries = await readWebZipEntries(path);
    if (!entries) return [];
    const extSet = webParseContainerExts(exts);
    const out = Object.keys(entries)
      .filter((k) => !k.endsWith("/") && webContainerEntrySafe(k) && webContainerExtMatch(k, extSet))
      .sort();
    return out;
  } catch {
    return [];
  }
}

/** 容器内体素读取：GetVoxelDataInContainer 镜像（entry 为 zip 内条目路径，ext 决定视图分派） */
export async function readWebVoxelInContainer(
  path: string,
  entry: string,
  _ext: string,
  view: (root: Record<string, unknown>, maxBlocks: number) => VoxelData | null,
): Promise<VoxelData | null> {
  try {
    if (!webContainerEntrySafe(entry)) return null;
    const b64 = await readWebFile(path);
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    if (!bytes) return null;
    const { entries } = extractZip(bytes);
    const raw = findZipEntry(entries, entry);
    if (!raw) return null;
    const vd = voxelFromBase64(u8ToBase64(raw), view);
    return vd;
  } catch {
    return null;
  }
}
