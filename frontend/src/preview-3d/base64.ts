// ===== base64.ts — base64/字节桥共享工具 =====
// 收编 fbx/mmd/vrm/pack 各适配器曾各自复制的 b64ToBytes（Go ReadFileBytes
// 返回 Go []byte 的 base64 序列化，前端统一在此解码）。

/** base64 → Uint8Array（Go []byte 的 base64 序列化） */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Uint8Array → ArrayBuffer（Blob 构造要求 ArrayBufferView<ArrayBuffer>，规避 SharedArrayBuffer 泛型）。
 * P3-8（审核）：仅在偏移视图（byteOffset≠0 或覆盖不全）时才 slice 复制——b64ToBytes 产出的
 * 专用 ArrayBuffer 视图（offset 0 全长）直接返回 buffer，零拷贝。原实现无条件 slice 整份复制，
 * 每个纹理在 blob/解码两条路径各瞬时空付一份内存。
 */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  // 整视图覆盖底层 buffer → 直接复用（无拷贝）；偏移/截断视图才需 slice 收窄
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer as ArrayBuffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

/** Uint8Array → base64（分块防栈溢出，对齐 atob 解码口径） */
export function bytesToBase64(bytes: Uint8Array): string {
  const view = bytes.length === bytes.byteLength
    ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    const sub = view.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}
