// ===== base64 编码原语（自 backend/web-common.ts 下沉，ADR-170 二段收口 2026-09）=====
// 零依赖纯函数层（atob/btoa 为宿主全局）：parsers/pack-meta、parsers/voxel-io 此前
// 为这两个函数反向 import backend/web-common.ts，形成叶子层→装配层依赖（知识卡
// frontend_parsers 跨簇例外 2 处）。下沉 utils/base 后 parsers 回归真叶子，
// backend 消费方经 web-common.ts re-export 保持导出名/签名不变。
//
// 历史：code_review 494843c9 #2/#3 消双份全量拷贝（chunkedBase64 核心），此处原样平移。

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
