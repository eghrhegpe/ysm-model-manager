// ===== sync-flow 静默等待（waitBusQuiet）直测 =====
// 背景（2026-10 锐评修复）：原实现静默期只剩 30s 超时兜底——done 先于订阅发出
// 即错过，一条已死在途能把多包推送循环卡满半分钟。修复后双轨：非 skipped done
// 即 resolve；宽限期（2s）内零 done 判定通道空闲放行。
// 本文件用真实定时器验语义分支（断言窗口与 30s 旧超时量级可分，2s 宽限不拖慢套件）。
import { describe, it, expect, vi, afterEach } from "vitest";

// 隔离 backend 桥（launcher-detect.test.ts 同款）：sync-flow 模块图经
// directory-picker / backend-deps 触到 Wails 绑定，本文件只锁 bus 静默等待逻辑
vi.mock("@/backend/app.ts", () => ({ getApp: vi.fn() }));
vi.mock("@/backend/directory-picker.ts", () => ({ pickDirectory: vi.fn() }));

import { bus } from "@/bus";
import { waitBusQuiet } from "./sync-flow.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("waitBusQuiet", () => {
  it("收到非 skipped done → 立即 resolve", async () => {
    const p = waitBusQuiet();
    bus.emit("sync:download:done", { token: "t1" });
    await expect(p).resolves.toBeUndefined();
  });

  it("skipped done 不解除等待，后续非 skipped done 才 resolve", async () => {
    const p = waitBusQuiet();
    bus.emit("sync:download:done", { token: "t2", skipped: true });
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // skipped 被忽略且宽限（2s）未到
    bus.emit("sync:download:done", { token: "t3" });
    await expect(p).resolves.toBeUndefined();
  });

  it("静默（done 竞态错过）→ 宽限期放行，不干等 30s 旧超时", async () => {
    const start = Date.now();
    await waitBusQuiet(); // 无任何 done 事件 → 只能走宽限期分支
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000); // 远小于旧 SYNC_TIMEOUT_MS=30s（2s 宽限 + 调度余量）
  });
});
