// ===== YSM 解码子系统共享工具（ADR-137 第五刀归位）=====
// 原 views/app-preview/utils.ts 的纯领域部分拆分至此（devLog / stripYsgpTextHeader / DecodedYsm）。
// 视图接口（PreviewRoot/YsmDecoder/PreviewCtx 等）与状态（getPrefer3D/setPrefer3D）仍留在
// views/app-preview/utils.ts——本文件不反向 import views。

import { dbg } from "@/utils/debug/debug.ts";
import type { BedrockGeometry } from "./geometry.ts";

/** DEV 模式下输出调试日志（走环形日志，tag = ysm-decode） */
export const devLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => dbg("ysm-decode", args.length === 1 ? args[0] : args)
  : () => {};

import type { DecodeSource } from "@/preview-3d/infra/load-trace.ts";

export { DECODE_SOURCE } from "@/preview-3d/infra/load-trace.ts";
// [ADR-270-d2 R10] 解码器来源码家族单一事实源迁至 infra 加载剖析值域（load-trace.ts）：
// views 入口面（tpl.ts / loader.ts）改引 infra/load-trace.ts（R10 白名单）。
// 本面仅再导出，内部消费者（wasm-decode.ts 等）零改动——射程收窄。
export type { DecodeSource };

/** WASM 解码结果（decodeYsmViaWasm 返回） */
export interface DecodedYsm {
  texture?: string | null;
  geometry?: BedrockGeometry | null;
  /** 首个成功解析的 geometry 文件原始 JSON 文本（Android 兜底通道：前端解码 → Go Build3DSpecFromGeometryJSON 用） */
  geometryRaw?: string;
  animations?: unknown[];
  avatars?: Record<string, string>;
  authors?: Array<{
    name: string;
    role?: string;
    avatarUrl?: string | null;
    avatarPath?: string;
  }>;
  /** 解码 ysm.json properties 提取的动画分组（其他动画），加密模型详情卡补显用 */
  animGroups?: Array<{ id?: string; name?: string; items?: string[] | null }>;
  /** 解码 ysm.json properties 提取的配置菜单（模型配置 / 自定义表情），加密模型详情卡补显用 */
  configMenus?: Array<{ id?: string; name?: string }>;
  /** 解码器来源码（DECODE_SOURCE，解码器盖章；缓存命中回读与统计卡徽标消费） */
  _decodedBy?: DecodeSource;
}

/**
 * 找文本头部结束位置（即二进制加密数据起点）。实际 YSGP 文本变体是「行式文本头 + 二进制加密数据」
 * （与 Go 端 header.go scanHeader 同口径）：
 *   - `===` 行终止当前节（header.go:73-74）
 *   - 连续 `---`（无 `[`，≥10 字符）分隔行后即二进制数据（header.go:76-85）
 * 原 regex 用 `(?:<\/ysm>|...|>)\s*$` 在解码文本上找闭合标签，
 * 要求标签后至 EOF 仅剩空白——但变体是文本头后紧跟二进制数据，`\s*$` 永不命中，
 * dataStart 落回 3（BOM 后），V2 重建时把整个文本头拼进加密载荷（payload 污染，
 * 解密产物错位）。用 Latin1 视图做字节级正则（1 字节=1 码位），索引直接映射回字节偏移。
 *
 * @param ascii bytes 前 4096B 的 Latin1 视图（调用方构造，避免重复切片）
 * @returns 数据起点字节偏移；哨兵 3（BOM 之后无进展）= 纯文本文件，非文本变体，调用方拒绝重建
 */
function findTextHeaderEnd(bytes: Uint8Array, ascii: string): number {
  const eqM = ascii.match(/\n===[^\n]*\n/);
  const eqEnd = eqM && typeof eqM.index === "number" ? eqM.index + eqM[0].length : -1;
  const dashM = ascii.match(/\n-{10,}[^[\n]*\n/);
  const dashEnd = dashM && typeof dashM.index === "number" ? dashM.index + dashM[0].length : -1;
  // 两个终止标记同时存在时取先出现者（短路顺序即契约，勿对调）
  if (eqEnd !== -1 && (dashEnd === -1 || eqEnd <= dashEnd)) return eqEnd;
  if (dashEnd !== -1) return dashEnd;
  // 无终止标记：尝试找二进制数据起始（非文本、非空白字符）
  for (let i = 3; i < bytes.length; i++) {
    if (bytes[i] < 0x20 && bytes[i] !== 0x09 && bytes[i] !== 0x0a && bytes[i] !== 0x0d) return i;
  }
  return 3; // skip BOM：全程无控制字节 → 纯文本，未找到数据起点
}

/**
 * 将带 UTF-8 BOM + 文本头部的 YSGP 变体重建为标准 YSGP 二进制格式
 * V2: 加密数据前有 16B 独立 hash 区
 * V3: 纯加密数据，无独立 hash 区
 */
function buildStdYsgpFromTextVariant(bytes: Uint8Array, forceVer?: number): Uint8Array | null {
  if (!bytes || bytes.length < 20) return null;
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) return null;

  const prefix = new TextDecoder("utf-8").decode(bytes.slice(0, 4096));
  const hashMatch = prefix.match(/<hash>([0-9a-f]{32})<\/hash>/i);
  if (!hashMatch) return null;
  const fileHash = hashMatch[1];

  // 文本头结束位置 → 二进制起点（判定顺序/短路语义见 findTextHeaderEnd）
  const ascii = String.fromCharCode(...bytes.slice(0, 4096));
  const dataStart = findTextHeaderEnd(bytes, ascii);
  if (dataStart === 3) return null;

  // guard 放宽——原 `bytes.length - 20` 会把「V2 16B hash 区 + 少量加密数据」
  // 的短变体误判为无载荷而原样返回（dataStart == length-20 恰好等于阈值）。
  // 改为要求闭合标记后至少剩 16B（V2 hash 区）+ 1B 加密数据。
  if (dataStart < 0 || dataStart >= bytes.length - 16) return null;

  const verNum = forceVer || 2;

  // V2: 二进制段 = 16B hash + 加密数据（hash 与 <hash> 标签值相同）
  // V3: 二进制段 = 纯加密数据（hash 仅在 <hash> 标签中）
  const encryptedStart = verNum >= 3 ? dataStart : dataStart + 16;
  const encrypted = bytes.slice(encryptedStart);
  const result = new Uint8Array(4 + 4 + 16 + encrypted.length);
  const magic = new Uint8Array([0x59, 0x53, 0x47, 0x50]); // "YSGP"
  result.set(magic, 0);
  const version = new Uint8Array([0, 0, 0, verNum]);
  result.set(version, 4);
  // 从 <hash> 标签取 16 字节 hash 二进制
  for (let i = 0; i < 16; i++) {
    result[8 + i] = parseInt(fileHash.substr(i * 2, 2), 16);
  }
  result.set(encrypted, 24);
  return result;
}

/**
 * 剥离 YSGP 文本头部，返回标准二进制格式
 */
export function stripYsgpTextHeader(bytes: Uint8Array, forceVer?: number): Uint8Array {
  const stdYsgp = buildStdYsgpFromTextVariant(bytes, forceVer);
  if (stdYsgp) return stdYsgp;
  if (!bytes || bytes.length < 10) return bytes;
  // 没有 BOM + 文本头部时原样返回
  return bytes;
}
