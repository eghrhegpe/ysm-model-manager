// ===== readModelBytes 平台分叉测试（ADR-228 / ADR-331-d1）=====
// 核心断言：网页版走 IDB ArrayBuffer 直出（**不碰** Wails 桥）；
// 桌面/Android 走 ReadFileBytesBatchWithMeta([path]) + base64 解码（切片 C 迁入，
// 一次 RPC 顺带拿回 ErrorCode/Reason 结构化错误通道）。
// 两条路径都返回独立 Uint8Array；失败统一 null。

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** 平台开关：true = 网页版 */
  isWeb: true,
  readAb: vi.fn<(path: string) => Promise<ArrayBuffer | null>>(),
  readMetaBatch: vi.fn<
    (paths: string[]) => Promise<Record<string, { data: string | null; hash: string; errorCode?: string; reason?: string } | null> | null>
  >(),
}));

vi.mock("@/backend/platform.ts", () => ({
  isWebPlatform: () => h.isWeb,
}));
vi.mock("@/backend/web-fs-read.ts", () => ({
  readWebFileArrayBuffer: h.readAb,
}));
vi.mock("@/backend/app.ts", () => ({
  getApp: async () => ({ ReadFileBytesBatchWithMeta: h.readMetaBatch }),
}));

import { readModelBytes } from "./read-model-bytes.ts";

/** 造一个恰好占满底层 buffer 的 ArrayBuffer */
const ab = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
/** 期望的 base64（与 base64ToBytes 逆操作一致） */
const b64 = (s: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

beforeEach(() => {
  h.isWeb = true;
  h.readAb.mockReset();
  h.readMetaBatch.mockReset();
});

describe("readModelBytes — 网页版路径（IDB ArrayBuffer 直出）", () => {
  it("返回 IDB 字节，且**不碰** Wails 桥（零 base64 往返）", async () => {
    h.readAb.mockResolvedValue(ab("HELLO"));
    const bytes = await readModelBytes("/web/ysm/a/a.ysm");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes!)).toBe("HELLO");
    expect(h.readAb).toHaveBeenCalledWith("/web/ysm/a/a.ysm");
    expect(h.readMetaBatch).not.toHaveBeenCalled();
  });

  it("文件不存在（IDB 返回 null）→ null", async () => {
    h.readAb.mockResolvedValue(null);
    expect(await readModelBytes("/web/ysm/无/a.ysm")).toBeNull();
  });

  it("网页版返回底层 buffer 的**视图**（零拷贝）——IDB 每次反序列化本就给新缓冲，别名安全", async () => {
    const src = ab("ABC");
    h.readAb.mockResolvedValue(src);
    const bytes = await readModelBytes("/web/ysm/a/a.ysm");
    // new Uint8Array(arrayBuffer) 是视图而非拷贝（拷贝要用 new Uint8Array(typedArray)）
    expect(bytes!.buffer).toBe(src);
    expect(bytes!.byteOffset).toBe(0);
    expect(bytes!.byteLength).toBe(3);
    // 与上面「独占底层缓冲」契约一致：byteLength === buffer.byteLength（Blob 构造依赖）
    expect(bytes!.byteLength).toBe((bytes!.buffer as ArrayBuffer).byteLength);
  });
});

describe("readModelBytes — 桌面 / Android 路径（base64 契约 + 结构化错误通道）", () => {
  beforeEach(() => {
    h.isWeb = false;
  });

  it("ReadFileBytesBatchWithMeta 的 base64 → 解码为字节，且**不碰** IDB", async () => {
    h.readMetaBatch.mockResolvedValue({ "/repo/ysm/a.ysm": { data: b64("DESKTOP"), hash: "h" } });
    const bytes = await readModelBytes("/repo/ysm/a.ysm");
    expect(new TextDecoder().decode(bytes!)).toBe("DESKTOP");
    expect(h.readMetaBatch).toHaveBeenCalledWith(["/repo/ysm/a.ysm"]);
    expect(h.readAb).not.toHaveBeenCalled();
  });

  it("条目缺失 / data 为 null（文件缺失/非路径）→ null", async () => {
    h.readMetaBatch.mockResolvedValue(null);
    expect(await readModelBytes("/repo/nope.ysm")).toBeNull();
    h.readMetaBatch.mockResolvedValue({ "/repo/nope.ysm": { data: null, hash: "", errorCode: "IO_ERROR", reason: "文件读取失败" } });
    expect(await readModelBytes("/repo/nope.ysm")).toBeNull();
  });

  it("非法 base64 → null（不抛，交由调用方按「读不到」处理）", async () => {
    h.readMetaBatch.mockResolvedValue({ "/repo/bad.ysm": { data: "!!!not-base64!!!", hash: "" } });
    expect(await readModelBytes("/repo/bad.ysm")).toBeNull();
  });

  it("空串 base64 → null（\"\" 是 falsy，空文件与缺失文件同路径）", async () => {
    h.readMetaBatch.mockResolvedValue({ "/repo/empty.ysm": { data: "", hash: "" } });
    const r = await readModelBytes("/repo/empty.ysm");
    expect(r).toBeNull(); // data ? ... : null 的 falsy 判定——勿改实现返回空数组，会绕过 !bytes?.length 守卫
  });

  it("桥抛错 → 原样上抛（由调用方 catch 决定降级）", async () => {
    h.readMetaBatch.mockRejectedValue(new Error("backend down"));
    await expect(readModelBytes("/repo/a.ysm")).rejects.toThrow("backend down");
  });

  it("切片 C 消费端：FILE_TOO_LARGE → throw AppError 形状 Error（cause.Code 命中 friendlyError）", async () => {
    h.readMetaBatch.mockResolvedValue({
      "/repo/huge.ysm": { data: null, hash: "", errorCode: "FILE_TOO_LARGE", reason: "文件超过读取上限" },
    });
    await expect(readModelBytes("/repo/huge.ysm")).rejects.toThrow("文件超过读取上限");
    // cause.Code 是 friendlyError 查 CODE_KEYS 的依据（ADR-331-d1 决策 #2）
    await expect(readModelBytes("/repo/huge.ysm")).rejects.toMatchObject({
      cause: { Code: "FILE_TOO_LARGE" },
    });
  });

  it("切片 C 消费端：INVALID_PATH → throw AppError 形状 Error（cause.Code 命中 friendlyError）", async () => {
    h.readMetaBatch.mockResolvedValue({
      "/repo/越权.ysm": { data: null, hash: "", errorCode: "INVALID_PATH", reason: "路径非法（越权读）" },
    });
    await expect(readModelBytes("/repo/越权.ysm")).rejects.toThrow("路径非法");
    await expect(readModelBytes("/repo/越权.ysm")).rejects.toMatchObject({
      cause: { Code: "INVALID_PATH" },
    });
  });

  it("切片 C 消费端：IO_ERROR → 仍返回 null（瞬时错误回退 Go，不 throw）", async () => {
    h.readMetaBatch.mockResolvedValue({
      "/repo/io.ysm": { data: null, hash: "", errorCode: "IO_ERROR", reason: "文件读取失败：xxx" },
    });
    expect(await readModelBytes("/repo/io.ysm")).toBeNull();
  });
});
