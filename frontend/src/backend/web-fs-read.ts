// ===== web-fs 共享读取装配层（ADR-040 拆分延续：web-fs.ts 上帝文件瘦身）=====
// 存放 §5/§6 的读取装配原语——web-fs.ts 主文件、web-fs-container.ts、web-fs-pack.ts、
// web-fs-bedrock.ts 四方共用。立此叶子断 container/pack/bedrock ↔ web-fs 主文件 的
// 值级循环依赖（与 web-fs-shared.ts 同模式）。
// 只做「读 IDB → base64 → 字节 → 解码 → 视图」装配，不触碰文件系统/IDB key 规约之外
// 的语义（key 规约见 web-fs-shared.ts）。

import { idbGet, idbKeys } from "./idb.ts";
import { parseWebPath, parseWebDirPath, arrayBufferToBase64, base64ToBytes, WEB_ROOT } from "./web-common.ts";
import { extractZip } from "../parsers/extract.ts";
import { dirKey } from "./web-fs-shared.ts";
import { decodeVoxelNbt, type VoxelData } from "../parsers/voxel-parse.ts";

// ===== §5 文件读取 =====
/** 读文件（/web/<type>/<rest> → IDB → base64；wasm.ts 解码链零改动复用）
 *  模型组 name 与组内 rel 在 file key 中无缝拼接（file:<type>/<name>/<rel>），
 *  多段 name（目录树，如 /web/ysm/分类1/狐狸/狐狸.ysm）无需拆分边界：
 *  直接以 <type> 后全部路径段作 key（对齐 MikuMikuAR dir key 匹配模式）。 */
export async function readWebFile(path: string): Promise<string | null> {
  const pm = parseWebPath(path);
  if (!pm) return null;
  const f = await idbGet<{ data: ArrayBuffer }>("files", `file:${pm.type}/${pm.rest}`);
  if (!f) return null;
  return arrayBufferToBase64(f.data);
}

/** 体素渲染上限对齐 internal/app/resource_bindings.go voxelMaxBlocks 默认 200000 */
const VOXEL_MAX_BLOCKS = 200000;

/** 体素装配：b64 → 解码 → 视图 → typed VoxelData（readVoxelJson / readWebVoxelInContainer 共用段）。
 *  失败返回 null（解码失败 / 视图判定无效），消除两处重复（jscpd）。 */
export function voxelFromBase64(
  b64: string,
  view: (root: Record<string, unknown>, maxBlocks: number) => VoxelData | null,
): VoxelData | null {
  const root = decodeVoxelNbt(b64);
  if (!root) return null;
  return view(root, VOXEL_MAX_BLOCKS);
}

/** zip 容器读取装配：readWebFile → base64 → extractZip（失败返回 null，调用方转 "[]"）。
 *  listWebContainerEntries / listWebPackModels 共用前缀，消除重复（jscpd）。 */
export async function readWebZipEntries(path: string): Promise<ReturnType<typeof extractZip>["entries"] | null> {
  const b64 = await readWebFile(path);
  if (!b64) return null;
  const bytes = base64ToBytes(b64);
  if (!bytes) return null;
  return extractZip(bytes).entries;
}

/**
 * ADR-070 M2：蓝图/投影 voxel binding 公共读取骨架（TS 平移 go/litematic/voxel.go 的
 * openGzRoot + BuildVoxelData/BuildNbtVoxelData/BuildSchematicVoxelData + internal/app
 * marshalVoxelData）。读 IDB → base64 → 字节 → parseNbtRootExact → voxelView → JSON 字符串。
 * 任何一步失败（文件缺失 / 畸形 NBT / 视图判定无效）→ "{}"（对齐 Go binding 契约：
 * marshalVoxelData error → "{}"）。
 * 体素渲染上限对齐 internal/app/resource_bindings.go voxelMaxBlocks 默认 200000。
 */
export async function readVoxelJson(
  path: string,
  view: (root: Record<string, unknown>, maxBlocks: number) => VoxelData | null,
): Promise<VoxelData | null> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return null;
    // IO（读文件）与解码（b64 → NBT root）解耦：decodeVoxelNbt 为纯函数
    // （voxel-parse.ts），此处只做装配——读文件 → 纯解码 → 纯视图 → typed VoxelData
    return voxelFromBase64(b64, view);
  } catch {
    // ADR-143 P1：失败走 null（error 通道语义由 binding 层处理）
    return null;
  }
}

// ===== §8 路径反解（web-fs.ts §8 移入：bedrock fallback 链依赖，须与读取装配同层
//       断 bedrock ↔ 主文件 循环）=====
/**
 * /web/<type>/<rest> 反解出 {type, name, rel}（最具体的 dir key 前缀匹配）。
 * 精确路径（scanWebModels/listWebModelDirFiles 产物）段前缀探测一次命中；
 * 模糊输入回退全库 dir: 前缀反查。
 */
export async function parseWebModelPath(p: string): Promise<{ type: string; name: string; rel: string } | null> {
  const pm = parseWebPath(p);
  if (!pm) return null;
  const { type, rest } = pm;
  const prefix = `dir:${type}/`;
  // ① 精确探测：从最长段前缀开始逐段试 dir key（name 可含多段路径）
  const segments = rest.split("/");
  for (let i = segments.length; i >= 1; i--) {
    const name = segments.slice(0, i).join("/");
    if (await idbGet("files", dirKey(type, name))) {
      const rel = i === segments.length ? "" : segments.slice(i).join("/");
      return { type, name, rel };
    }
  }
  // ② 回退：全库 dir: 前缀反查（模糊输入，与旧实现同语义）
  const dirKeys = await idbKeys("files", prefix);
  let best = "";
  for (const dk of dirKeys) {
    const name = dk.slice(prefix.length, -1); // 去尾 ':'
    if (name && (rest === name || rest.startsWith(`${name}/`)) && name.length > best.length) {
      best = name;
    }
  }
  if (!best) return null;
  return { type, name: best, rel: rest.slice(best.length + 1) };
}

/**
 * 递归列出指定 /web 目录下全部文件完整路径（对齐桌面 ListAllFilePaths：
 * 递归完整路径、不限制扩展名）。支持多段 name（目录树）与组内子目录（rel 含 /）。
 * 目录形态路径（/web/<type>/<name> 或 /web/<type>/<name>/<subdir>）经
 * parseWebModelPath 反解出 {type, name, rel}，再枚举 file:<type>/<name>/ 前缀，
 * 过滤 rel.startsWith(目录rel + "/") 归入该子树。非 /web 路径返回 []。
 */
export async function listWebModelDirFiles(p: string): Promise<string[]> {
  const pm = await parseWebModelPath(p);
  if (!pm) return [];
  const { type, name, rel } = pm;
  const prefix = `file:${type}/${name}/`;
  const keys = await idbKeys("files", prefix);
  const out: string[] = [];
  // 目录 rel 为空 = 整个模型组；否则只取 rel 子树（rel 或其子目录）
  const dirPrefix = rel ? `${rel}/` : "";
  for (const k of keys) {
    const fileRel = k.slice(prefix.length);
    if (!dirPrefix || fileRel === rel || fileRel.startsWith(dirPrefix)) {
      out.push(`${WEB_ROOT}/${type}/${name}/${fileRel}`);
    }
  }
  return out;
}

/** /web/<type>/<name> → 类型+模型名（目录形态；name 可含多段路径） */
export function parseWebModelDir(p: string): { type: string; name: string } | null {
  return parseWebDirPath(p);
}
