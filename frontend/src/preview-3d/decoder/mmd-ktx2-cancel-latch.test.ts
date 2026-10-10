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
  __setEncodeImplForTest,
} from "./mmd-ktx2-encoder.ts";
import type { MmdDataPort } from "@/preview-3d/adapters/mmd/mmd-types.ts";

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
    const result = await Promise.race([
      encodeAndCacheTexture("hash_after_cancel", "blob:tx", port),
      new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), 300)),
    ]);

    expect(
      result,
      "取消是『一次性事件』语义而非持久状态——取消后的新编码请求必须被结算（拒绝或执行），不得挂在 waitingQueue 永不结算",
    ).not.toBe("TIMEOUT");
  });

  it("取消后编码被拒绝（而非执行）——语义：该会话已放弃编码", async () => {
    const port = makePort();
    cancelPendingEncodings();
    const ok = await Promise.race([
      encodeAndCacheTexture("hash_rejected", "blob:tx", port),
      new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), 300)),
    ]);
    // 取消路径应静默返回 false（不抛、不记失败）
    expect(ok, "取消后应结算为 false 而非挂起").toBe(false);
    expect(hoisted.saveTextureMock).not.toHaveBeenCalled();
  });

  it("幂等：取消两次后仍可正常结算（不累积副作用）", async () => {
    const port = makePort();
    cancelPendingEncodings();
    cancelPendingEncodings();
    const ok = await Promise.race([
      encodeAndCacheTexture("hash_twice", "blob:tx", port),
      new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), 300)),
    ]);
    expect(ok).toBe(false);
  });
});
