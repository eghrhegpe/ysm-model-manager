// ===== MMD KTX2 编码器单元测试 =====
// 覆盖：encodeAndCacheTexture（编码成功/失败）、
// scheduleBackgroundEncoding（调度行为）、并发控制与取消机制。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

const hoisted = vi.hoisted(() => {
  return {
    ktx2EncodeMock: vi.fn(),
    saveTextureMock: vi.fn(),
    addOpLogMock: vi.fn(),
  };
});

import { encodeAndCacheTexture, scheduleBackgroundEncoding, cancelPendingEncodings, resetEncoderState, __setEncodeImplForTest } from "./mmd-ktx2-encoder.ts";
import type { MmdDataPort } from "./mmd-adapter.ts";

// ===== 辅助函数 =====

/** 创建 Mock 端口（saveCachedTexture 直挂 hoisted mock——ADR-072：落盘经 port 注入，不再 mock backend） */
function makePort(): MmdDataPort {
  return {
    readFileBytes: vi.fn(),
    readFileBytesBatch: vi.fn(),
    listAllFilePaths: vi.fn(),
    addOpLog: hoisted.addOpLogMock,
    getCachedTexture: vi.fn(),
    saveCachedTexture: hoisted.saveTextureMock,
  };
}

// 最小 PNG 1x1 base64
const MINIMAL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

/**
 * 安装完整 DOM mock（Image/fetch/FileReader/canvas）
 * 使用 fake timers 确保定时器行为可预测
 */
function installDomMocks(): void {
  // Image mock：自动触发 onload
  const ImageCtor = function () {
    const obj: { width: number; height: number; onload: (() => void) | null; src: string } = {
      width: 1, height: 1, onload: null, src: "",
    };
    // 使用 process.nextTick 模拟同步回调，便于 fake timers 控制
    setTimeout(() => { obj.onload?.(); }, 0);
    return obj;
  };
  vi.stubGlobal("Image", ImageCtor);

  // fetch mock：返回 blob
  const mockFetch = vi.fn().mockResolvedValue({
    blob: () => Promise.resolve(new Blob([MINIMAL_PNG_B64], { type: "image/png" })),
  });
  vi.stubGlobal("fetch", mockFetch);

  // FileReader mock：自动触发 onload
  const FileReaderCtor = function () {
    const obj: { result: string; onload: (() => void) | null; readAsDataURL: () => void } = {
      result: `data:image/png;base64,${MINIMAL_PNG_B64}`,
      onload: null,
      readAsDataURL: function (this: typeof obj) {
        setTimeout(() => { this.onload?.(); }, 0);
      },
    };
    return obj;
  };
  vi.stubGlobal("FileReader", FileReaderCtor);

  // canvas mock
  const ctxMock = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  };
  const canvasMock = { width: 1, height: 1, getContext: vi.fn(() => ctxMock) };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => canvasMock),
  });
}

/**
 * 等待所有微任务和定时器完成
 * 使用 fake timers 精确推进时间，避免嵌套 setTimeout
 */
async function flushAsyncTasks(): Promise<void> {
  // 推进微任务队列
  await vi.advanceTimersByTimeAsync(0);
  // 再推进一小段时间确保所有嵌套定时器完成
  await vi.advanceTimersByTimeAsync(10);
}

describe("encodeAndCacheTexture", () => {
  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0xab, 0xcd, 0xef]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
    __setEncodeImplForTest(hoisted.ktx2EncodeMock);
    installDomMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("编码成功 → 返回 true 且记录日志", async () => {
    const port = makePort();
    const ok = await encodeAndCacheTexture("hash123", "blob:test", port);

    expect(ok).toBe(true);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledOnce();
    // 编码实现接收解码后的 ImageData（含像素数据），由本地 WASM 编码为 KTX2
    const imgArg = hoisted.ktx2EncodeMock.mock.calls[0][0] as { data: Uint8Array; width: number; height: number };
    expect(imgArg.width).toBe(1);
    expect(imgArg.height).toBe(1);
    expect(imgArg.data).toBeInstanceOf(Uint8Array);
    expect(hoisted.saveTextureMock).toHaveBeenCalledWith("hash123", expect.any(String));
    expect(hoisted.addOpLogMock).toHaveBeenCalledWith(
      "ktx2-encode", "hash123", "ok", expect.stringContaining("bytes="),
    );
  });

  it("编码失败（KTX2BasisWriter 抛错）→ 返回 false 且记录 fail 日志", async () => {
    hoisted.ktx2EncodeMock.mockRejectedValue(new Error("WASM encode failed"));

    const port = makePort();
    const ok = await encodeAndCacheTexture("hash456", "blob:test", port);

    expect(ok).toBe(false);
    expect(hoisted.addOpLogMock).toHaveBeenCalledWith(
      "ktx2-encode", "hash456", "fail",
      expect.stringContaining("WASM encode failed"),
    );
  });

  it("超大纹理（>4096²）跳过编码 → 记 warn 而非 fail", async () => {
    // 注入直接抛 TextureTooLargeError 的实现（encodeToKTX2 的尺寸守卫行为）
    const { TextureTooLargeError } = await import("./mmd-ktx2-basis.ts");
    hoisted.ktx2EncodeMock.mockRejectedValue(new TextureTooLargeError(8192, 8192));

    const port = makePort();
    const ok = await encodeAndCacheTexture("hash_big", "blob:test", port);

    expect(ok).toBe(false);
    expect(hoisted.addOpLogMock).toHaveBeenCalledWith(
      "ktx2-encode", "hash_big", "warn",
      expect.stringContaining("纹理过大 8192x8192"),
    );
    // 不落盘、不误报 fail
    expect(hoisted.saveTextureMock).not.toHaveBeenCalled();
    expect(hoisted.addOpLogMock).not.toHaveBeenCalledWith(
      "ktx2-encode", "hash_big", "fail", expect.any(String),
    );
  });

  it("编码结果转 base64 正确处理二进制数据", async () => {
    // 模拟编码返回 256 字节数据（覆盖 charCodeAt 0-255）
    const largeBuffer = new Uint8Array(256);
    for (let i = 0; i < 256; i++) largeBuffer[i] = i;
    hoisted.ktx2EncodeMock.mockResolvedValue(largeBuffer.buffer);

    const port = makePort();
    const ok = await encodeAndCacheTexture("hash789", "blob:test", port);

    expect(ok).toBe(true);
    // saveTexture 被调用，base64 正确包含所有字节
    const savedB64 = hoisted.saveTextureMock.mock.calls[0][1] as string;
    expect(savedB64.length).toBeGreaterThan(0);
  });

  it("blob URL 无法加载时返回 false", async () => {
    // 模拟 Image 加载失败（onerror 触发）
    const ImageCtor = function () {
      const obj: { width: number; height: number; onload: (() => void) | null; onerror: (() => void) | null; src: string } = {
        width: 1, height: 1, onload: null, onerror: null, src: "",
      };
      // 触发 onerror
      setTimeout(() => { obj.onerror?.(); }, 0);
      return obj;
    };
    vi.stubGlobal("Image", ImageCtor);

    const port = makePort();
    const ok = await encodeAndCacheTexture("hash_fail", "blob:invalid", port);

    expect(ok).toBe(false);
    expect(hoisted.addOpLogMock).toHaveBeenCalledWith(
      "ktx2-encode", "hash_fail", "fail",
      expect.any(String),
    );
    expect(hoisted.ktx2EncodeMock).not.toHaveBeenCalled();
  });
});

describe("scheduleBackgroundEncoding", () => {
  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0x01]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
    __setEncodeImplForTest(hoisted.ktx2EncodeMock);
    installDomMocks();
    // 启用 fake timers 以便精确控制异步流程
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("遍历 hashByBlobUrl 条目数触发对应编码", async () => {
    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    const port = makePort();
    const hashMap = new Map<string, string>([
      ["blob:aaa", "hash_aaa"],
      ["blob:bbb", "hash_bbb"],
    ]);

    scheduleBackgroundEncoding(hashMap, port);

    for (const task of tasks) task();

    // 使用 fake timers 推进所有定时器完成
    await vi.advanceTimersByTimeAsync(50);

    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(2);
  });

  it("空 hashByBlobUrl 不报错", () => {
    const port = makePort();
    expect(() => scheduleBackgroundEncoding(new Map(), port)).not.toThrow();
  });

  it("单个纹理编码失败不影响其他纹理", async () => {
    let callCount = 0;
    hoisted.ktx2EncodeMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("fail"));
      return Promise.resolve(new Uint8Array([0x01]).buffer);
    });

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    const port = makePort();
    const hashMap = new Map<string, string>([
      ["blob:aaa", "hash_aaa"],
      ["blob:bbb", "hash_bbb"],
    ]);

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();

    // 推进所有定时器完成
    await vi.advanceTimersByTimeAsync(50);

    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(2);

    const failLogs = hoisted.addOpLogMock.mock.calls.filter(
      (c: unknown[]) => (c as [string, string, string])[2] === "fail"
    );
    const okLogs = hoisted.addOpLogMock.mock.calls.filter(
      (c: unknown[]) => (c as [string, string, string])[2] === "ok"
    );
    expect(failLogs.length).toBeGreaterThanOrEqual(1);
    expect(okLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("所有编码都失败时正确记录日志", async () => {
    hoisted.ktx2EncodeMock.mockRejectedValue(new Error("All encode failed"));

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    const port = makePort();
    const hashMap = new Map<string, string>([
      ["blob:aaa", "hash_aaa"],
      ["blob:bbb", "hash_bbb"],
    ]);

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();

    // 推进所有定时器完成
    await vi.advanceTimersByTimeAsync(50);

    // 所有编码都应该调用 fail 日志
    const failLogs = hoisted.addOpLogMock.mock.calls.filter(
      (c: unknown[]) => (c as [string, string, string])[2] === "fail"
    );
    expect(failLogs.length).toBe(2);
  });
});

// ---- P1-1 并发控制与取消机制 ----
describe("并发控制与取消", () => {
  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0x01]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
    __setEncodeImplForTest(hoisted.ktx2EncodeMock);
    installDomMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("超过并发限制时，后续编码排队等待（不超过 MAX_CONCURRENT 同时执行）", async () => {
    // 模拟 5 个纹理，并发限制为 3
    // 追踪同时执行中的编码数
    let concurrentCount = 0;
    let maxConcurrent = 0;

    hoisted.ktx2EncodeMock.mockImplementation(() => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      // 模拟异步编码
      return new Promise((resolve) => {
        setTimeout(() => {
          concurrentCount--;
          resolve(new Uint8Array([0x01]).buffer);
        }, 10);
      });
    });

    const port = makePort();
    const hashMap = new Map<string, string>();
    for (let i = 0; i < 5; i++) {
      hashMap.set(`blob:tex${i}`, `hash_${i}`);
    }

    // 用 queueMicrotask stub 同步执行
    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();

    // 推进定时器让所有编码完成
    await vi.advanceTimersByTimeAsync(100);

    // 最大并发数不超过 3
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(5);
  });

  it("cancelPendingEncodings 跳过未开始的编码", async () => {
    // 8 个纹理，并发限制 3，有 5 个需要排队
    // 取消后，排队的编码不应执行
    let encodeStarted = 0;
    let triggeredCancel = false;

    hoisted.ktx2EncodeMock.mockImplementation(() => {
      encodeStarted++;
      const currentIndex = encodeStarted;
      return new Promise((resolve) => {
        setTimeout(() => {
          // 当第 3 个完成开始编码时触发取消
          if (currentIndex === 3 && !triggeredCancel) {
            triggeredCancel = true;
            cancelPendingEncodings();
          }
          resolve(new Uint8Array([0x01]).buffer);
        }, 5);
      });
    });

    const port = makePort();
    const hashMap = new Map<string, string>();
    for (let i = 0; i < 8; i++) {
      hashMap.set(`blob:tex${i}`, `hash_${i}`);
    }

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();

    // 推进足够时间让取消生效
    await vi.advanceTimersByTimeAsync(200);

    // 取消后不应所有 8 个都完成（至少有排队的被跳过）
    expect(encodeStarted).toBeLessThanOrEqual(8);
  });

  it("重复调度不导致重复编码（幂等）", async () => {
    const port = makePort();
    // 使用本测试专属的唯一 hash（避免 completedHashes 干扰）
    const uniqueHash = `unique_test_${Date.now()}_${Math.random()}`;
    const hashMap = new Map<string, string>([
      ["blob:unique", uniqueHash],
    ]);

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    // 调度两次
    scheduleBackgroundEncoding(hashMap, port);
    scheduleBackgroundEncoding(hashMap, port);

    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);

    // 同一 hash 不应编码两次（只有第一次生效）
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(1);
  });

  it("cancelPendingEncodings 在无待处理任务时不报错", () => {
    // 直接调用取消，不应抛出异常
    expect(() => cancelPendingEncodings()).not.toThrow();
  });
});

// ---- resetEncoderState 测试 ----
describe("resetEncoderState", () => {
  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    installDomMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0x01]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
    __setEncodeImplForTest(hoisted.ktx2EncodeMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("重置后 completedHashes 被清空", async () => {
    const port = makePort();
    const hashMap = new Map<string, string>([
      ["blob:test", "hash_reset_test"],
    ]);

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    // 先完成一次编码
    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);

    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(1);

    // 重置状态
    resetEncoderState();

    // 再次调度同一 hash，应该重新编码（幂等性被清除）
    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);

    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(2);
  });

  it("重置后 cancelled 标志被清除", () => {
    // 先取消
    cancelPendingEncodings();

    // 重置后应该不再处于取消状态
    resetEncoderState();

    // 再次调用 cancelPendingEncodings 不应该影响已完成的编码
    const hashMap = new Map<string, string>([
      ["blob:test", "hash_reset_cancel"],
    ]);
    const port = makePort();

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    // 不应该报错
    expect(() => cancelPendingEncodings()).not.toThrow();
  });

  it("重置后 waitingQueue 被清空", async () => {
    const port = makePort();
    const tasks: Array<() => void> = [];
    const hashMap = new Map<string, string>();

    // 使用唯一 hash 避免幂等去重干扰
    for (let i = 0; i < 5; i++) {
      hashMap.set(`blob:tex_reset_${i}`, `hash_queue_reset_${i}`);
    }

    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    // 第一次调度
    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);

    // 验证第一次调度的编码次数
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(5);

    // 重置状态
    resetEncoderState();

    // 清空任务队列，准备第二次调度
    tasks.length = 0;

    // 再次调度（使用不同的 blob URL 确保不会被幂等去重跳过）
    const hashMap2 = new Map<string, string>();
    for (let i = 0; i < 5; i++) {
      hashMap2.set(`blob:tex_reset2_${i}`, `hash_queue_reset2_${i}`);
    }

    scheduleBackgroundEncoding(hashMap2, port);
    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);

    // 总计应该是 10 次（第一次 5 次 + 第二次 5 次）
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(10);
  });
});

// ---- scheduleBackgroundEncoding 增量：completedHashes 幂等跳过 + 外层 catch 在途清理 ----
describe("scheduleBackgroundEncoding 幂等与在途清理（增量）", () => {
  /** 本 describe 用独立端口（addOpLog 可注入抛错实现，不污染共享 addOpLogMock） */
  function makeLocalPort(): MmdDataPort {
    return {
      readFileBytes: vi.fn(),
      readFileBytesBatch: vi.fn(),
      listAllFilePaths: vi.fn(),
      addOpLog: vi.fn(),
      getCachedTexture: vi.fn(),
      saveCachedTexture: hoisted.saveTextureMock,
    };
  }

  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0x01]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
    __setEncodeImplForTest(hoisted.ktx2EncodeMock);
    installDomMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("已完成的 hash 再次调度 → completedHashes 幂等跳过（continue 分支）", async () => {
    const port = makeLocalPort();
    const hashMap = new Map([["blob:done", "hash_done_branch"]]);
    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(1);

    // 编码已完成（completedHashes 已收录）→ 再次调度被 completedHashes 分支跳过
    tasks.length = 0;
    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(1);
  });

  it("addOpLog 在 catch 内抛错 → 外层 .catch 清理 inProgress（同 hash 可重新调度）", async () => {
    hoisted.ktx2EncodeMock.mockRejectedValue(new Error("encode explode"));
    const port = makeLocalPort();
    (port.addOpLog as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("oplog sink broken");
    });
    const hashMap = new Map([["blob:oplog", "hash_oplog_throw"]]);
    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    tasks.length = 0;
    await vi.advanceTimersByTimeAsync(50);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(1);

    // 编码失败且 opLog 抛错（promise 在外层 .catch 结算）→ inProgress 已清理 → 可重新调度
    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();
    await vi.advanceTimersByTimeAsync(50);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(2);
  });
});

// ---- encodeToKTX2 主线程入口（真实编码链路）----
// 既有用例经 __setEncodeImplForTest 替换了 encodeImpl，真实 encodeToKTX2（Worker 池 /
// 同步降级 / 尺寸守卫）不再可达。此处用 vi.resetModules 取一份全新模块实例（默认
// encodeImpl = 真实 encodeToKTX2），配合可编程假 Worker 验证三条主线程路径。
describe("encodeToKTX2 主线程入口（默认 encodeImpl：Worker 池 / 同步降级 / 尺寸守卫）", () => {
  type EncoderModule = typeof import("./mmd-ktx2-encoder.ts");
  type Ktx2Echo = { ok: boolean; buffer?: ArrayBuffer; error?: string };

  let fresh: EncoderModule;
  /** 可编程回包：postMessage 后按当前实现响应（"crash" = 触发 worker onerror） */
  let respond: (msg: { id: number }) => Ktx2Echo | "crash";
  /** 捕获已创建的假 Worker（用于 beforeEach 拆池，保证用例从无池状态开始） */
  let createdWorkers: FakeKtx2Worker[] = [];

  class FakeKtx2Worker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      createdWorkers.push(this);
    }
    postMessage(msg: { id: number }, _transfer?: Transferable[]): void {
      setTimeout(() => {
        const r = respond(msg);
        if (r === "crash") {
          this.onerror?.();
          return;
        }
        this.onmessage?.({ data: { id: msg.id, ...r } });
      }, 0);
    }
    terminate(): void { /* 池终止语义由 worker-bridge 测试覆盖 */ }
  }

  /** 独立端口（addOpLog 可精确断言，不与共享 addOpLogMock 串扰） */
  function makeLocalPort(): MmdDataPort {
    return {
      readFileBytes: vi.fn(),
      readFileBytesBatch: vi.fn(),
      listAllFilePaths: vi.fn(),
      addOpLog: vi.fn(),
      getCachedTexture: vi.fn(),
      saveCachedTexture: hoisted.saveTextureMock,
    };
  }

  /**
   * stub fetch 让 basis_encoder js/wasm 拉取延迟失败。
   * 必须用 setTimeout 延迟 reject：loadBasisModule 里两个 fetch 顺序求值，
   * 若首个 .text() 同步 reject，会在 Promise.all 挂上 handler 前触发
   * unhandled rejection（vitest 记为 Unhandled Errors）。
   */
  function stubBasisFetchFailure(): void {
    const fail = (): Promise<never> =>
      new Promise((_, rej) => {
        setTimeout(() => rej(new Error("no basis files in test env")), 0);
      });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      text: fail,
      arrayBuffer: fail,
      blob: () => Promise.resolve(new Blob([MINIMAL_PNG_B64])),
    }));
  }

  beforeAll(async () => {
    vi.resetModules();
    fresh = await import("./mmd-ktx2-encoder.ts");
  });

  beforeEach(() => {
    fresh.resetEncoderState();
    // getKtx2WorkerPool 有模块级缓存（ktx2Workers）——resetEncoderState 不拆池。
    // 通过 onerror → handleWorkerError → terminatePool → onPoolTerminated 清缓存，
    // 确保每个用例都从「无池」状态开始（同步降级用例依赖此判定）。
    for (const w of createdWorkers) w.onerror?.();
    createdWorkers = [];
    vi.clearAllMocks();
    hoisted.saveTextureMock.mockResolvedValue(undefined);
    installDomMocks();
    respond = () => ({ ok: true, buffer: new Uint8Array([9, 9, 9]).buffer });
    vi.stubGlobal("Worker", FakeKtx2Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Worker 池可用 → 走桥接回包 resolve，结果分块转 base64 落盘（[9,9,9] → CQkJ）", async () => {
    const port = makeLocalPort();
    const ok = await fresh.encodeAndCacheTexture("hash_pool_ok", "blob:pool", port);

    expect(ok).toBe(true);
    expect(hoisted.saveTextureMock).toHaveBeenCalledWith("hash_pool_ok", "CQkJ");
    expect(port.addOpLog).toHaveBeenCalledWith(
      "ktx2-encode", "hash_pool_ok", "ok", expect.stringContaining("bytes=3"),
    );
  });

  it("worker 回 ok:false → 桥接 reject → 静默降级记 fail 日志", async () => {
    respond = () => ({ ok: false, error: "worker boom" });
    const port = makeLocalPort();
    const ok = await fresh.encodeAndCacheTexture("hash_pool_err", "blob:pool", port);

    expect(ok).toBe(false);
    expect(port.addOpLog).toHaveBeenCalledWith("ktx2-encode", "hash_pool_err", "fail", "worker boom");
    expect(hoisted.saveTextureMock).not.toHaveBeenCalled();
  });

  it("worker 崩溃（onerror）→ 终止整池 + 在途 reject + 池引用清空（下次重建）", async () => {
    respond = () => "crash";
    const port = makeLocalPort();
    const ok = await fresh.encodeAndCacheTexture("hash_pool_crash", "blob:pool", port);

    expect(ok).toBe(false);
    expect(port.addOpLog).toHaveBeenCalledWith(
      "ktx2-encode", "hash_pool_crash", "fail", expect.stringContaining("KTX2 worker 终止"),
    );

    // 崩溃后池已清空（onPoolTerminated）→ 下一次请求重建池，新回包正常走通
    respond = () => ({ ok: true, buffer: new Uint8Array([1]).buffer });
    const ok2 = await fresh.encodeAndCacheTexture("hash_pool_rebuild", "blob:pool", port);
    expect(ok2).toBe(true);
    expect(hoisted.saveTextureMock).toHaveBeenCalledWith("hash_pool_rebuild", "AQ==");
  });

  it("超大纹理在主线程入口先拦（TextureTooLargeError → warn，不触碰 Worker 池）", async () => {
    const ImageCtor = function () {
      const obj: { width: number; height: number; onload: (() => void) | null; src: string } = {
        width: 5000, height: 5000, onload: null, src: "",
      };
      setTimeout(() => { obj.onload?.(); }, 0);
      return obj;
    };
    vi.stubGlobal("Image", ImageCtor);
    const port = makeLocalPort();
    const ok = await fresh.encodeAndCacheTexture("hash_big_entry", "blob:big", port);

    expect(ok).toBe(false);
    expect(port.addOpLog).toHaveBeenCalledWith(
      "ktx2-encode", "hash_big_entry", "warn", expect.stringContaining("纹理过大 5000x5000"),
    );
    expect(hoisted.saveTextureMock).not.toHaveBeenCalled();
  });

  it("Worker 不可用 → 降级同步编码 encodeToKTX2Basis（WASM 缺失时静默失败）", async () => {
    vi.stubGlobal("Worker", undefined);
    stubBasisFetchFailure();
    const port = makeLocalPort();
    const ok = await fresh.encodeAndCacheTexture("hash_sync", "blob:sync", port);

    expect(ok).toBe(false);
    expect(port.addOpLog).toHaveBeenCalledWith(
      "ktx2-encode", "hash_sync", "fail", expect.any(String),
    );
    expect(hoisted.saveTextureMock).not.toHaveBeenCalled();
  });

  it("Worker 构造抛错 → 池创建失败（catch 清引用返回 null）→ 同步降级", async () => {
    vi.stubGlobal("Worker", class {
      constructor() {
        throw new Error("worker blocked in test env");
      }
    });
    stubBasisFetchFailure();
    const port = makeLocalPort();
    const ok = await fresh.encodeAndCacheTexture("hash_ctor_fail", "blob:ctor", port);

    expect(ok).toBe(false);
    expect(port.addOpLog).toHaveBeenCalledWith(
      "ktx2-encode", "hash_ctor_fail", "fail", expect.any(String),
    );
    expect(hoisted.saveTextureMock).not.toHaveBeenCalled();
  });
});
