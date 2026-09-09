// @vitest-environment node
// ===== utils/base/base64.ts 测试 =====
import { describe, it, expect } from "vitest";
import { arrayBufferToBase64, base64ToBytes, u8ToBase64 } from "./base64.ts";

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
