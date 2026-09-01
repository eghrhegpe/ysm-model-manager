// @vitest-environment node
// ===== web-common.ts 测试（补盲区：路径解析 / 编码原语）=====
// 纯函数无 IO；isWebPath / parseWebPath / parseWebDirPath / webDirType 是
// web-fs 全链路的路径语义单点（web-common.ts:18-49），锁定防回归。
import { describe, it, expect } from "vitest";
import {
  isWebPath,
  parseWebPath,
  parseWebDirPath,
  webDirType,
  arrayBufferToBase64,
  base64ToBytes,
  WEB_ROOT,
  MAX_IMPORT_BYTES,
} from "./web-common.ts";

describe("isWebPath", () => {
  it("合法 /web/<type>/<rest> → true", () => {
    expect(isWebPath("/web/ysm/狐狸/狐狸.ysm")).toBe(true);
  });
  it("缺 rest 段 → false", () => {
    expect(isWebPath("/web/ysm")).toBe(false);
  });
  it("非 /web 前缀 → false", () => {
    expect(isWebPath("C:/models/狐狸.ysm")).toBe(false);
    expect(isWebPath("ysm/狐狸.ysm")).toBe(false);
  });
  it("空串 → false", () => {
    expect(isWebPath("")).toBe(false);
  });
});

describe("parseWebPath", () => {
  it("拆出 type 与 rest（rest 可含多段）", () => {
    expect(parseWebPath("/web/ysm/狐狸/狐狸.ysm")).toEqual({ type: "ysm", rest: "狐狸/狐狸.ysm" });
  });
  it("type 段不含 /", () => {
    expect(parseWebPath("/web/ysm/狐狸.ysm")?.type).toBe("ysm");
    expect(parseWebPath("/web/ysm/狐狸.ysm")?.rest).toBe("狐狸.ysm");
  });
  it("非 /web 前缀 → null", () => {
    expect(parseWebPath("/foo/ysm/狐狸.ysm")).toBeNull();
    expect(parseWebPath("ysm/狐狸.ysm")).toBeNull();
  });
});

describe("parseWebDirPath", () => {
  it("目录形态拆出 type 与 name", () => {
    expect(parseWebDirPath("/web/ysm/狐狸")).toEqual({ type: "ysm", name: "狐狸" });
  });
  it("多段 name（目录树）", () => {
    expect(parseWebDirPath("/web/ysm/分类1/狐狸")).toEqual({ type: "ysm", name: "分类1/狐狸" });
  });
  it("末尾斜杠容忍", () => {
    expect(parseWebDirPath("/web/ysm/狐狸/")).toEqual({ type: "ysm", name: "狐狸" });
  });
  it("非 /web 前缀 → null", () => {
    expect(parseWebDirPath("/foo/ysm/狐狸")).toBeNull();
  });
});

describe("webDirType", () => {
  it("取 /web/ 后首段", () => {
    expect(webDirType("/web/ysm/狐狸.ysm")).toBe("ysm");
  });
  it("非 /web 前缀 → null", () => {
    expect(webDirType("ysm/狐狸.ysm")).toBeNull();
  });
});

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
});

describe("常量", () => {
  it("WEB_ROOT 为 /web", () => {
    expect(WEB_ROOT).toBe("/web");
  });
  it("MAX_IMPORT_BYTES 为 100MB（对齐 import-dnd 桌面上限）", () => {
    expect(MAX_IMPORT_BYTES).toBe(100 * 1024 * 1024);
  });
});
