// ===== 体素 IO 解耦（base64 字节 → NBT root）=====
// 纯函数：输入 b64 字符串，输出解析后的 root 对象；无任何 IO。
// 装配层（web-fs-read.ts）只负责「读文件 → 调本函数 → 视图」。

import { base64ToBytes } from "@/utils/base/primitives/base64.ts";
import { parseNbtRootExact } from "./nbt-parse.ts";

/**
 * 纯函数：base64 字节 → NBT root（IO 与解码解耦——本函数无任何 IO，输入 b64 字符串
 * 输出解析后的 root 对象；readVoxelJson 等装配层只负责「读文件 → 调本函数 → 视图」）。
 * 任一环节失败（非法 base64 / NBT 解析失败）返回 null，错误语义由调用方契约化。
 */
export function decodeVoxelNbt(b64: string): Record<string, unknown> | null {
  if (!b64) return null;
  const bytes = base64ToBytes(b64);
  if (!bytes) return null;
  // 契约：解析失败返回 null（parseNbtRootExact 对畸形 NBT 会抛错，此处兜底）
  try {
    return parseNbtRootExact(bytes);
  } catch {
    return null;
  }
}
