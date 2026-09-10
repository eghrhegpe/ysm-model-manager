// ===== base64 编码原语（零依赖纯函数层，atob/btoa 为宿主全局）=====
// parsers/pack-meta、parsers/voxel-io 等叶子经本层取 base64（避免叶子层反向依赖
// backend 装配层）；backend 消费方经 web-common.ts re-export 保持导出名/签名不变。

/** 分块 base64 核心（操作调用方私有的 bytes 视图，不再拷贝）。
 *  假设入参独占（调用方负责隔离），公开入口的防御拷贝各自保留。 */
function chunkedBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** ArrayBuffer → base64（分块，大文件避免栈溢出；强制拷贝隔离底层 buffer，防并发读写竞态） */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const copy = buf.slice(0);
  return chunkedBase64(new Uint8Array(copy));
}

/** base64 → Uint8Array（arrayBufferToBase64 逆操作；非法输入返回 null） */
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Uint8Array → base64（先拷贝隔离 view 偏移共享 buffer；直接走 chunkedBase64 核心——
 *  copy 是刚创建的私有副本，不再叠一次 arrayBufferToBase64 的无谓 slice） */
export function u8ToBase64(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return chunkedBase64(copy);
}

/** Uint8Array → ArrayBuffer（Blob 构造要求 ArrayBufferView<ArrayBuffer>，规避 SharedArrayBuffer 泛型）。
 *  仅偏移视图（byteOffset≠0 或覆盖不全）才 slice 复制——整视图（offset 0 全长）直接返回底层
 *  buffer（零拷贝别名），避免每个纹理在 blob/解码两条路径各瞬时空付一份内存。
 *  ⚠ 所有权契约：整视图路径返回的是底层 `buffer` 本身的**别名**，不是独立副本。调用方若需
 *  独立副本请自行 `bytes.slice()`。特别当返回值会传入 Worker `postMessage(msg, transfer)`
 *  的 transfer list 时——transfer 会**同步 detach** 底层 buffer，之后任何引用同一
 *  `Uint8Array.buffer` 的消费者拿到的都是 `byteLength === 0` 的已失效 buffer。
 *  规则：若 buffer 需被两个消费者先后使用，且其中之一会 transfer/detach/modify，
 *  传给 transfer 的那份必须用 `.slice()` 独立拷贝。 */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  // 整视图覆盖底层 buffer → 直接复用（无拷贝）；偏移/截断视图才需 slice 收窄
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer as ArrayBuffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}
