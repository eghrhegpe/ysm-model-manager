// ===== 预览模块共享工具函数 =====
// 从 index.ts 拆分：模块级函数和状态
import type { BedrockGeometry } from "./geometry.ts";

/** DEV 模式下输出调试日志 */
export const devLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? console.log
  : () => {};

/** WASM 解码结果（decodeYsmViaWasm 返回） */
export interface DecodedYsm {
  texture?: string | null;
  geometry?: BedrockGeometry | null;
  animations?: unknown[];
  avatars?: Record<string, string>;
  authors?: Array<{
    name: string;
    role?: string;
    avatarUrl?: string | null;
    avatarPath?: string;
  }>;
  _wasmTried?: boolean;
}

/** 预览上下文（index.ts AppPreview 类实现的接口，子模块以最小面引用） */
/** 渲染容器 + 生命周期（detail/litematic-meta/skeleton 消费 root，skeleton 消费 unsubs） */
export interface PreviewRoot {
  root: ShadowRoot;
  /** 组件销毁清理收集（可选：子模块可挂 window/document 监听清理函数） */
  unsubs?: Array<() => void>;
}

/** WASM 解码能力（loader/skeleton 消费） */
export interface YsmDecoder {
  decodeYsmViaWasm(path: string): Promise<DecodedYsm | null>;
}

/** 调试输出能力（loader/skeleton 消费） */
export interface PreviewDebugger {
  appendDebug(container: HTMLElement | null, msg: string): void;
}

/** 预览图加载能力（detail 消费） */
export interface PreviewImageLoader {
  loadPreviewImage(path: string): Promise<string | null>;
}

/** 组合接口：实现方（AppPreview）与兼容旧调用方的完整视图。
 * 消费方按需收窄参数到小接口（见 detail/litematic-meta/loader/skeleton），
 * 测试 mock 只需提供被测字段，消除「mock 全套」压力。 */
export interface PreviewCtx extends PreviewRoot, YsmDecoder, PreviewDebugger, PreviewImageLoader {}

/** 3D 偏好状态（跨模型切换保留） */
let _prefer3D = false;
export function getPrefer3D(): boolean {
  return _prefer3D;
}
export function setPrefer3D(v: boolean): void {
  _prefer3D = v;
}

/**
 * 将带 UTF-8 BOM + 文本头部的 YSGP 变体重建为标准 YSGP 二进制格式
 * V2: 加密数据前有 16B 独立 hash 区
 * V3: 纯加密数据，无独立 hash 区
 */
function buildStdYsgpFromTextVariant(
  bytes: Uint8Array,
  forceVer?: number,
): Uint8Array | null {
  if (!bytes || bytes.length < 20) return null;
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) return null;

  const prefix = new TextDecoder("utf-8").decode(bytes.slice(0, 4096));
  const hashMatch = prefix.match(/<hash>([0-9a-f]{32})<\/hash>/i);
  if (!hashMatch) return null;
  const fileHash = hashMatch[1];

  // 找到文本头部结束位置（从 "> 文件内容" 或 "</ysm>" 后）
  const tagMatch = prefix.match(
    /(?:<\/ysm>|<\/ysmp>|<\/file>|<\/data>|<\/ysm_data>|>)\s*$/,
  );
  let dataStart = 3; // skip BOM
  if (tagMatch) {
    dataStart = 3 + (tagMatch.index ?? 0) + tagMatch[0].length;
  } else {
    // 尝试找二进制数据起始（非文本、非空白字符）
    for (let i = 100; i < bytes.length; i++) {
      if (
        bytes[i] < 0x20 &&
        bytes[i] !== 0x09 &&
        bytes[i] !== 0x0a &&
        bytes[i] !== 0x0d
      ) {
        dataStart = i;
        break;
      }
    }
  }

  if (dataStart < 0 || dataStart >= bytes.length - 20) return null;

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
export function stripYsgpTextHeader(
  bytes: Uint8Array,
  forceVer?: number,
): Uint8Array {
  const stdYsgp = buildStdYsgpFromTextVariant(bytes, forceVer);
  if (stdYsgp) return stdYsgp;
  if (!bytes || bytes.length < 10) return bytes;
  // 没有 BOM + 文本头部时原样返回
  return bytes;
}
