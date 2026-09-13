// @vitest-environment node
// ===== utils/base/primitives/base64.ts 测试 =====
import { describe, it, expect } from "vitest";
import {
  arrayBufferToBase64,
  base64ToBytes,
  bytesToArrayBuffer,
  u8ToBase64,
} from "./base64.ts";

describe("arrayBufferToBase64 / base64ToBytes 往返", () => {
  it("二进制往返无损（含非 ASCII 字节）", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 65, 66]);
    const b64 = arrayBufferToBase64(bytes.buffer as ArrayBuffer);
    const back = base64ToBytes(b64);
    expect(back).not.toBeNull();
    expect(Array.from(back!)).toEqual(Array.from(bytes));
  });

  it("空 buffer 往返", () => {
    const b64 = arrayBufferToBase64(new Uint8Array(0).buffer as ArrayBuffer);
    expect(base64ToBytes(b64)).toEqual(new Uint8Array(0));
  });

  it("大 buffer 分块不炸（> 0x8000 chunk）", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const b64 = arrayBufferToBase64(bytes.buffer as ArrayBuffer);
    const back = base64ToBytes(b64);
    expect(back).not.toBeNull();
    expect(back!.length).toBe(200_000);
    expect(back![123456]).toBe(bytes[123456]);
  });

  it("非法 base64 → null", () => {
    expect(base64ToBytes("!!!not-base64!!!")).toBeNull();
  });

  it("u8ToBase64 与 arrayBufferToBase64 同值（拷贝入口不改变编码结果）", () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(u8ToBase64(bytes)).toBe(arrayBufferToBase64(bytes.buffer as ArrayBuffer));
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
