// @vitest-environment happy-dom
// ===== mmd-ktx2-encoder 锐评补测（decoder 轮 F1，2026-10-10）=====
// F1：`cancelled` 是**永久闩锁**——cancelPendingEncodings() 置真后只有
// scheduleBackgroundEncoding() 入口复位；若此后**经公开 API** encodeAndCacheTexture
// 直接发起编码（不经过 schedule），acquire() 会把任务塞进 waitingQueue，
// 而 activeCount 已为 0 → 没有任何 release 会来唤醒 → promise 永久挂起。
//
// 既有回归测试（mmd-ktx2-encoder.test.ts:383-428）覆盖的是「取消时已在队者被 reject」，
// 且它在断言前重新 schedule（触发 resetCancelled），恰好绕过本缺陷。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  ktx2EncodeMock: vi.fn(),
  saveTextureMock: vi.fn(),
  addOpLogMock: vi.fn(),
}));

import {
  cancelPendingEncodings,
  encodeAndCacheTexture,
  resetEncoderState,
  scheduleBackgroundEncoding,
  __setEncodeImplForTest,
} from "./mmd-ktx2-encoder.ts";
import type { MmdDataPort } from "@/preview-3d/adapters/mmd/mmd-types.ts";

/** 挂起探测：返回 settle 结果；超时则返回 "HANG"（并清掉定时器，不留悬空 handle）。
 *  比 `Promise.race([..., new Promise(r => setTimeout(...))])` 严格——后者超时定时器
 *  永不清理，且「两侧都不 settle」时会让断言退化为空转。 */
async function settlesWithin(p: Promise<unknown>, ms = 300): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<string>((r) => {
        timer = setTimeout(() => r("HANG"), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

describe("mmd-ktx2-encoder — 取消闩锁后的再发起（F1）", () => {
  beforeEach(() => {
    resetEncoderState();
    hoisted.ktx2EncodeMock.mockReset();
    hoisted.saveTextureMock.mockReset();
    hoisted.addOpLogMock.mockReset();
    // 编码实现直接走注入点，不触碰 Worker
    __setEncodeImplForTest(() => Promise.resolve(new Uint8Array([1, 2, 3]).buffer));
    // Image / canvas 最小替身：blobUrlToImageData 需要能跑完
    vi.stubGlobal(
      "Image",
      function () {
        const o: { width: number; height: number; onload: (() => void) | null; src: string } = {
          width: 1,
          height: 1,
          onload: null,
          src: "",
        };
        setTimeout(() => o.onload?.(), 0);
        return o;
      },
    );
    const ctxStub = {
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctxStub as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetEncoderState();
  });

  it("取消后（无在途编码）直接调 encodeAndCacheTexture 仍应结算，不得永久挂起", async () => {
    const port = makePort();

    // 用户关闭预览 → 会话 dispose 调 cancel；此时 activeCount = 0，无在途
    cancelPendingEncodings();

    // 此后经公开 API 直接发起一次编码（不经过 scheduleBackgroundEncoding，
    // 故不会触发 resetCancelled）
    const result = await settlesWithin(encodeAndCacheTexture("hash_after_cancel", "blob:tx", port));

    expect(
      result,
      "取消是『一次性事件』语义而非持久状态——取消后的新编码请求必须被结算（拒绝或执行），不得挂在 waitingQueue 永不结算",
    ).not.toBe("HANG");
  });

  it("取消后编码被拒绝（而非执行）——语义：该会话已放弃编码", async () => {
    const port = makePort();
    cancelPendingEncodings();
    const ok = await settlesWithin(encodeAndCacheTexture("hash_rejected", "blob:tx", port));
    // 取消路径应静默返回 false（不抛、不记失败）
    expect(ok, "取消后应结算为 false 而非挂起").toBe(false);
    expect(hoisted.saveTextureMock).not.toHaveBeenCalled();
  });

  it("幂等：取消两次后仍可正常结算（不累积副作用）", async () => {
    const port = makePort();
    cancelPendingEncodings();
    cancelPendingEncodings();
    expect(await settlesWithin(encodeAndCacheTexture("hash_twice", "blob:tx", port))).toBe(false);
  });

  it("cancelled 不是永久闩锁：新一轮调度入口复位后可正常编码", async () => {
    const port = makePort();
    cancelPendingEncodings(); // 置闩锁
    // 编码实现用 hoisted mock 本身（与既有 encoder.test.ts 同法），才能观测「真的启动了编码」
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([1, 2]).buffer);
    __setEncodeImplForTest(hoisted.ktx2EncodeMock);
    // scheduleBackgroundEncoding 入口同步 resetCancelled() → 本批应真的启动编码
    scheduleBackgroundEncoding(new Map([["blob:z1", "reset_h1"]]), port);
    await vi.waitFor(() => expect(hoisted.ktx2EncodeMock).toHaveBeenCalled(), { timeout: 2000 });
  });
});

// ===== 生产竞态：cancel 落在 schedule 入口与它的微任务体之间（对抗性验证指出的缺口）=====
// `scheduleBackgroundEncoding` 在**入口同步**调 resetCancelled()，而真正派发在
// queueMicrotask 体内（L348 vs L351）。生产里「用户关闭预览」恰好落在这两点之间是可达的
// ——此时微任务体看到 cancelled=true，本批全部立即被拒（返回 false），**不得**有任何任务
// 滞留 waitingQueue（那正是 F1 的挂起形态），也不得产生 unhandled rejection。
describe("mmd-ktx2-encoder — 取消与调度交错的竞态（生产可达）", () => {
  beforeEach(() => {
    resetEncoderState();
    hoisted.ktx2EncodeMock.mockReset();
    hoisted.saveTextureMock.mockReset();
    hoisted.addOpLogMock.mockReset();
    __setEncodeImplForTest(() => Promise.resolve(new Uint8Array([1, 2, 3]).buffer));
    vi.stubGlobal(
      "Image",
      function () {
        const o: { width: number; height: number; onload: (() => void) | null; src: string } = {
          width: 1,
          height: 1,
          onload: null,
          src: "",
        };
        setTimeout(() => o.onload?.(), 0);
        return o;
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetEncoderState();
  });

  it("cancel 落在 schedule 入口与微任务体之间 → 本批全部立即结算，无滞留无挂起", async () => {
    const port = makePort();
    const hashMap = new Map([["blob:r1", "race_h1"], ["blob:r2", "race_h2"]]);
    // 捕获微任务体，制造「入口已 reset、体还未跑」的窗口
    const pending: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => pending.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    // 窗口内取消（此时 cancelled 由入口置 false → 现被置真）
    cancelPendingEncodings();
    // 体开始跑：本批 acquire 应全部立即 reject（不得入队滞留）
    for (const cb of pending) cb();
    await new Promise((r) => setTimeout(r, 10));

    // 关键断言：取消窗口内的批次不得启动任何编码。
    // 判别力说明：F1 旧实现在此会把任务塞进 waitingQueue → 无 release 唤醒 → 永不启动，
    // 但「没启动」本身不足以区分「被静默拒绝」与「卡住」，故并用 opLog 佐证：
    // 取消是**静默**退出，不得记 fail（区分「取消」与「失败」两条语义）。
    expect(
      hoisted.ktx2EncodeMock,
      "取消窗口内的批次不得启动编码（入队滞留则永不启动）",
    ).not.toHaveBeenCalled();
    expect(hoisted.addOpLogMock, "取消不是失败：不得记 fail 日志").not.toHaveBeenCalled();
  });

  it("取消路径不产生 unhandled rejection（EncodeCancelledError 必须被调用方消化）", async () => {
    const port = makePort();
    const seen: unknown[] = [];
    const onUnhandled = (e: unknown): void => {
      seen.push(e);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      cancelPendingEncodings();
      // 直接走公开 API：取消态下必然 reject(EncodeCancelledError)
      const ok = await encodeAndCacheTexture("hash_ur", "blob:tx", port);
      expect(ok).toBe(false);
      // 给拒绝派发留一个宏任务
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(seen, "取消不得泄漏 unhandled rejection").toEqual([]);
  });
});

