// ===== 预览模块共享工具函数 =====
// 从 index.js 拆分：模块级函数和状态

/** DEV 模式下输出调试日志 */
export const devLog = import.meta.env.DEV ? console.log : () => {};

/** 3D 偏好状态（跨模型切换保留） */
let _prefer3D = false;
export function getPrefer3D() {
  return _prefer3D;
}
export function setPrefer3D(v) {
  _prefer3D = v;
}

/**
 * 将带 UTF-8 BOM + 文本头部的 YSGP 变体重建为标准 YSGP 二进制格式
 * V2: 加密数据前有 16B 独立 hash 区
 * V3: 纯加密数据，无独立 hash 区
 */
export function buildStdYsgpFromTextVariant(bytes, forceVer) {
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
    dataStart = 3 + tagMatch.index + tagMatch[0].length;
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

  // 调试输出
  const debugBytes = Array.from(
    bytes.slice(dataStart, Math.min(bytes.length, dataStart + 35)),
  ).map((b) => b.toString(16).padStart(2, "0"));
  console.log(
    `[YSM] dataStart=${dataStart}, 前4字节: ${debugBytes.slice(0, 4).join(" ")}... 后24字节: ${debugBytes.slice(11).join(" ")}`,
  );
  const dump64 = Array.from(
    bytes.slice(dataStart, Math.min(bytes.length, dataStart + 64)),
  ).map((b) => b.toString(16).padStart(2, "0"));
  console.log(
    `[YSM] 二进制段头 64B: ${dump64.slice(0, 16).join(" ")} | ${dump64.slice(16, 32).join(" ")} | ${dump64.slice(32, 48).join(" ")} | ${dump64.slice(48, 64).join(" ")}`,
  );
  if (dataStart < 0 || dataStart >= bytes.length - 20) return null;

  let verNum = forceVer || 2;

  // V2: 二进制段 = 16B hash + 加密数据（hash 与 <hash> 标签值相同）
  // V3: 二进制段 = 纯加密数据（hash 仅在 <hash> 标签中）
  const encryptedStart = verNum >= 3 ? dataStart : dataStart + 16;
  const encrypted = bytes.slice(encryptedStart);
  console.log(
    `[YSM] V${verNum}: 加密数据偏移=${encryptedStart}, 大小=${encrypted.length}B`,
  );

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
  console.log(
    `[YSM] 构建标准 YSGP: 剥离 ${dataStart}B 文本头部, hash=${fileHash}, 加密数据=${encrypted.length}B`,
  );
  return result;
}

/**
 * 剥离 YSGP 文本头部，返回标准二进制格式
 */
export function stripYsgpTextHeader(bytes, forceVer) {
  const stdYsgp = buildStdYsgpFromTextVariant(bytes, forceVer);
  if (stdYsgp) return stdYsgp;
  if (!bytes || bytes.length < 10) return bytes;
  // 没有 BOM + 文本头部时原样返回
  return bytes;
}
