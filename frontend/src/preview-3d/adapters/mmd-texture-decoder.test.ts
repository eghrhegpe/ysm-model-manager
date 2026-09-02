// ===== MMD 纹理解码器（Worker 池）单元测试 =====
// P2-4：Worker 崩溃 → fail-fast 清算在途任务 + 重建替补（不再空等 8s 超时）
// P2-5：closeUnusedDecodedBitmaps 只关 refCount<=0 的位图（未应用的不泄漏）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTextureDecoder,
  disposeTextureDecoder,
  closeUnusedDecodedBitmaps,
  type DecodedTexture,
} from "./mmd-texture-decoder.ts";

/** 可编程假 Worker：postMessage 后回包或触发崩溃 */
let respondWith: ((id: number) => "ok" | "fail" | "crash") | null = null;
let createdWorkers: FakeDecodeWorker[] = [];

class FakeDecodeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    createdWorkers.push(this);
  }
  postMessage(msg: { id: number; relPath: string }): void {
    setTimeout(() => {
      const r = respondWith?.(msg.id) ?? "ok";
      if (r === "crash") {
        this.onerror?.();
        return;
      }
      if (r === "fail") {
        this.onmessage?.({
          data: { id: msg.id, relPath: msg.relPath, ok: false, error: "decode fail" },
        });
        return;
      }
      // ok：回传假位图（带 close 间谍）
      const bitmap = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
      this.onmessage?.({
        data: { id: msg.id, relPath: msg.relPath, ok: true, bitmap, width: 1, height: 1 },
      });
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function installFakeWorker(): void {
  createdWorkers = [];
  respondWith = null;
  vi.stubGlobal("Worker", FakeDecodeWorker);
}

afterEach(() => {
  disposeTextureDecoder();
  vi.unstubAllGlobals();
  createdWorkers = [];
  respondWith = null;
});

describe("Worker 崩溃恢复（P2-4）", () => {
  beforeEach(() => {
    installFakeWorker();
  });

  it("正常解码 → 全部回包，bitmap 入结果", async () => {
    const decoder = getTextureDecoder();
    const results = await decoder.decodeAll([
      { relPath: "a.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "b.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    expect(results.size).toBe(2);
    expect(results.get("a.png")?.bitmap).toBeDefined();
    expect(results.get("b.png")?.bitmap).toBeDefined();
  });

  it("某 worker 崩溃 → 该 worker 名下任务 fail-fast 结算，decodeAll 不空等超时", async () => {
    // 4 个 worker，任务 0/1 归 worker0，2/3 归 worker1... 让 worker1 崩（任务 2、3）
    let call = 0;
    respondWith = () => {
      const n = call++;
      // worker0 收 id0/id1；worker1 收 id2/id3（round-robin：id → workerIdx%4）
      // 崩溃触发在 id2 归 worker1 的场景：让 id2、id3 全崩 → worker1.onerror 清算两者
      return n === 2 || n === 3 ? "crash" : "ok";
    };
    const decoder = getTextureDecoder();
    // 用真实超时兜底断言：若崩溃不 fail-fast，decodeAll 要等 8s 才 resolve
    const started = Date.now();
    const results = await decoder.decodeAll([
      { relPath: "0.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "1.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "2.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "3.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    const elapsed = Date.now() - started;
    // fail-fast：远小于 8s 超时（允许异步调度余量）
    expect(elapsed).toBeLessThan(2000);
    // 崩溃任务（2/3）无结果，正常任务（0/1）有结果
    expect(results.has("0.png")).toBe(true);
    expect(results.has("1.png")).toBe(true);
    expect(results.has("2.png")).toBe(false);
    expect(results.has("3.png")).toBe(false);
  });

  it("崩溃 worker 被 terminate 且池重建替补", async () => {
    let call = 0;
    respondWith = () => (call++ === 0 ? "crash" : "ok");
    const decoder = getTextureDecoder();
    await decoder.decodeAll([
      { relPath: "a.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    // worker0 崩 → 被 terminate → 重建（createdWorkers 会追加替补）
    expect(createdWorkers[0].terminated).toBe(true);
    expect(createdWorkers.length).toBeGreaterThanOrEqual(5); // 4 原始 + ≥1 替补
    // 替补 worker 可继续服务后续任务
    respondWith = () => "ok";
    const results = await decoder.decodeAll([
      { relPath: "b.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    expect(results.size).toBe(1);
  });
});

describe("closeUnusedDecodedBitmaps（P2-5）", () => {
  it("refCount=0 的位图被 close；refCount>0 的保留（由纹理 dispose 负责）", () => {
    const unused = { close: vi.fn() } as unknown as ImageBitmap;
    const used = { close: vi.fn() } as unknown as ImageBitmap;
    const decoded = new Map<string, DecodedTexture>([
      ["unused.png", { relPath: "unused.png", bitmap: unused, width: 1, height: 1, refCount: 0 }],
      ["used.png", { relPath: "used.png", bitmap: used, width: 1, height: 1, refCount: 2 }],
    ]);
    closeUnusedDecodedBitmaps(decoded);
    expect(unused.close).toHaveBeenCalledTimes(1);
    expect(used.close).not.toHaveBeenCalled();
    // 已应用的位图不动，refCount 保持
    expect(decoded.get("used.png")!.refCount).toBe(2);
  });

  it("重复调用幂等（已关的位图 refCount=-1 标记不再关）", () => {
    const bmp = { close: vi.fn() } as unknown as ImageBitmap;
    const decoded = new Map<string, DecodedTexture>([
      ["a.png", { relPath: "a.png", bitmap: bmp, width: 1, height: 1, refCount: 0 }],
    ]);
    closeUnusedDecodedBitmaps(decoded);
    closeUnusedDecodedBitmaps(decoded);
    expect(bmp.close).toHaveBeenCalledTimes(1);
  });
});
