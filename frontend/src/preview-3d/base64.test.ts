// @vitest-environment node
// ===== base64.test.ts — 共享 base64/字节桥工具（收编 5 份 b64ToBytes 重复实现）=====
// 覆盖：全字节域往返、空串、已知向量、bytesToArrayBuffer 偏移视图。

import { describe, it, expect } from "vitest";
import { b64ToBytes, bytesToArrayBuffer } from "./base64.ts";

describe("b64ToBytes", () => {
  it("全字节域 0..255 往返一致（覆盖高位字节 charCodeAt 路径）", () => {
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    const b64 = btoa(String.fromCharCode(...src));
    expect(b64ToBytes(b64)).toEqual(src);
  });

  it("空串返回空数组", () => {
    expect(b64ToBytes("")).toEqual(new Uint8Array(0));
  });

  it("已知向量（PNG 魔数头）解码正确", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const b64 = btoa(String.fromCharCode(...png));
    expect(b64ToBytes(b64)).toEqual(png);
  });
});

describe("bytesToArrayBuffer", () => {
  it("返回与源字节一致的独立 ArrayBuffer", () => {
    const src = new Uint8Array([1, 2, 3, 255]);
    const buf = bytesToArrayBuffer(src);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(buf)).toEqual(src);
  });

  it("P3-8 整视图（offset 0 全长）直接复用底层 buffer，零拷贝", () => {
    const src = new Uint8Array([1, 2, 3, 255]);
    const buf = bytesToArrayBuffer(src);
    // 整覆盖视图：直接返回 buffer（同一引用），不产生 slice 复制
    expect(buf).toBe(src.buffer);
  });

  it("偏移视图（subarray）只切出视图范围，不带前缀脏数据", () => {
    const full = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = full.subarray(2, 5);
    const buf = bytesToArrayBuffer(view);
    expect(buf.byteLength).toBe(3);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
    // 偏移视图才复制：不与底层 buffer 同引用
    expect(buf).not.toBe(full.buffer);
  });
});
