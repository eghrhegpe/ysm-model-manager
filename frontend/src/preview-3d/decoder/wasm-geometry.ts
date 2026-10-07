// ===== WASM 解码层 · 纯字节/几何 helper =====
// 来源：frontend/src/preview-3d/decoder/wasm-decode.ts（纯函数下沉，主文件保留 decodeYsmViaWasm 编排）
// 职责：解码过程中的纯字节判定 / 路径计算 / 纹理键匹配 / UV 占用包围盒估算 /
//       模型名抽取——均无 backend / WASM 依赖，仅依赖 geometry 类型 + 少量原生工具。
// 拆分日期：2026-10-07
// 红线：本文件严禁引入 getApp / readModelBytes / decodeYsmFile / parseYsmJsonDirect /
//       stripYsgpTextHeader 等 backend / WASM 依赖；只搬不改，行为与原实现一致。

import type { BedrockCube, BedrockGeometry } from "./geometry.ts";

/** 从模型路径剥离出所在目录（正/反斜杠统一为 `/`，无目录返回 `.`） */
export function getBaseDir(modelPath: string): string {
  const dir = modelPath.replace(/\\/g, "/");
  return dir.includes("/") ? dir.substring(0, dir.lastIndexOf("/")) : ".";
}

/**
 * 声明条目 → 路径字符串：字符串形态原样返回；对象形态取指定键
 * （modelFiles 取 `path` / texFiles 取 `uv`，对齐 parsers/ysm-json.ts normalizePlayerFiles 的三形态）；
 * 取不到 → ""（调用方跳过该条）。
 */
export function entryPathOf(entry: unknown, key: "path" | "uv"): string {
  if (typeof entry === "string") return entry;
  return (entry as Record<string, string> | null | undefined)?.[key] || "";
}

/** ZIP 本地文件头魔数（PK\x03\x04），与 YSGP "YSGP" 区分明文包 */
export function isPlainZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** 按相对路径在 zip entries 中查字节（大小写/反斜杠折叠，对齐 web-fs-bedrock findEntryByRel） */
export function findZipEntryByRel(
  entries: Record<string, Uint8Array>,
  rel: string,
): Uint8Array | null {
  const norm = rel
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
  for (const key of Object.keys(entries)) {
    if (key.replace(/\\/g, "/").toLowerCase() === norm) return entries[key];
  }
  return null;
}

/** 纹理键匹配：精确键优先，回退小写折叠映射 */
export function matchTexKey(
  tn: string,
  textures: Record<string, string>,
  texLowerMap: Record<string, string>,
): string | null {
  if (!tn) return null;
  if (textures[tn]) return tn;
  const lower = tn.toLowerCase();
  return texLowerMap[lower] || null;
}

export const FACE_KEYS = ["east", "west", "up", "down", "south", "north"] as const;

/**
 * faceUV 路径的 UV 占用端：各面取有符号 uv_size 的 min/max 包围盒（负尺寸 = 反向采样，
 * 真实占用区取 max(f.uv, f.uv+fw)），跨面按轴取最大值。无命中/解析失败返回 null → 回退 box 公式。
 */
export function faceUvEnd(c: BedrockCube): { uEnd: number; vEnd: number } | null {
  if (!c.faceUV) return null;
  let uEnd = 0;
  let vEnd = 0;
  let hit = false;
  try {
    const fd = JSON.parse(c.faceUV) as Record<string, { uv?: number[]; uv_size?: number[] }>;
    for (const fn of FACE_KEYS) {
      const f = fd[fn];
      if (!f?.uv) continue;
      hit = true;
      const fw = f.uv_size?.[0] ?? 0;
      const fh = f.uv_size?.[1] ?? 0;
      uEnd = Math.max(uEnd, Math.max(f.uv[0], f.uv[0] + fw));
      vEnd = Math.max(vEnd, Math.max(f.uv[1], f.uv[1] + fh));
    }
  } catch {
    return null; // faceUV 非法 → 回退 box（与 parseUV 同口径）
  }
  return hit ? { uEnd, vEnd } : null;
}

/** box 布局公式路径的 UV 占用端（faceUV 缺失/无可识别面时回退，对齐 cube-mesh parseUV） */
export function boxUvEnd(c: BedrockCube): { uEnd: number; vEnd: number } | null {
  if (!Array.isArray(c.uv) || c.uv.length < 2) return null;
  const [sx, sy, sz] = c.size;
  const [u, v] = c.uv;
  return { uEnd: u + 2 * (Math.abs(sx) + Math.abs(sz)), vEnd: v + Math.abs(sy) + Math.abs(sz) };
}

/**
 * 估算骨骼集合的 UV 占用包围盒（像素域）。
 * 仅用于诊断 _texWidth/_texHeight 与 texMappingLog 的 uvSize/finalSize；
 * 渲染 UV 归一化仍以 geometry 声明的 texture_width/height 为准。
 *
 * 口径对齐 cube-mesh parseUV：faceUV 非空走 per-face（uv_size 有符号——负尺寸
 * 表示该轴反向采样，真实占用区取 min/max 包围盒，foxcar down 面 544/551 负高；
 * 旧实现 Math.abs(fv+|fh|) 把范围反向高估，且 faceUV cube 的占位 box uv 还会让
 * 2*(sx+sz) 布局公式串扰）；faceUV 缺失/解析失败/无可识别面才回退 box 布局公式。
 */
export function computeBoneTexRange(bones: BedrockGeometry["bones"]): {
  uvMaxW: number;
  uvMaxH: number;
} {
  let uvMaxW = 2,
    uvMaxH = 2;
  const acc = (uEnd: number, vEnd: number): void => {
    if (uEnd > uvMaxW) uvMaxW = uEnd;
    if (vEnd > uvMaxH) uvMaxH = vEnd;
  };
  for (const b of bones) {
    for (const c of b.cubes || []) {
      const faceEnd = faceUvEnd(c);
      if (faceEnd) {
        acc(faceEnd.uEnd, faceEnd.vEnd);
        continue;
      }
      const boxEnd = boxUvEnd(c);
      if (boxEnd) acc(boxEnd.uEnd, boxEnd.vEnd);
    }
  }
  return { uvMaxW, uvMaxH };
}

/** 模型名抽取：字符串原样取 basename；对象形态取 path/name 的 basename */
export function getModelName(mp: unknown): string {
  return (
    (typeof mp === "string"
      ? mp
      : (mp as { path?: string; name?: string })?.path || (mp as { name?: string })?.name || ""
    )
      .split(/[/\\]/)
      .pop() || ""
  );
}
