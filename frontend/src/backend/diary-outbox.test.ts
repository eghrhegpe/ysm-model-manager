// ===== 日记第二通道 outbox 测试（ADR-322 D2）=====
// 覆盖三条契约：① 写入后可读回且保序 ② 损坏数据被逐条过滤（不放行脏数据）
// ③ drain 遇败即停、剩余原样留仓、整批成功后一次性抹除。
// 另有一条反向断言：模块内不得经由 logWarn/logError 逃逸（写失败必须静默），
// 这是「元失败的元失败无下游可报告」的实现约束，用 mock 拦住 sink 反证。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OUTBOX_KEY,
  __resetDiaryOutboxForTest,
  drainDiaryOutbox,
  enqueueDiaryOutbox,
  readDiaryOutbox,
} from "./diary-outbox.ts";

const { logWarnMock, logErrorMock } = vi.hoisted(() => ({
  logWarnMock: vi.fn(),
  logErrorMock: vi.fn(),
}));
vi.mock("@/utils/base/primitives/log.ts", () => ({
  logWarn: logWarnMock,
  logError: logErrorMock,
}));

beforeEach(() => {
  localStorage.clear();
  __resetDiaryOutboxForTest();
  logWarnMock.mockClear();
  logErrorMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("diary-outbox 读写（ADR-322 D2）", () => {
  it("enqueue → read 回本条，字段保真", () => {
    enqueueDiaryOutbox({ title: "保存失败", detail: "超时", status: "failed" });
    expect(readDiaryOutbox()).toEqual([{ title: "保存失败", detail: "超时", status: "failed" }]);
  });

  it("多条保序（最旧在前）", () => {
    enqueueDiaryOutbox({ title: "a", detail: "1", status: "warn" });
    enqueueDiaryOutbox({ title: "b", detail: "2", status: "failed" });
    enqueueDiaryOutbox({ title: "c", detail: "3", status: "warn" });
    expect(readDiaryOutbox().map((e) => e.title)).toEqual(["a", "b", "c"]);
  });

  it("超出 OUTBOX_MAX 丢最旧（主通道长期失效时防撑爆 localStorage 配额）", () => {
    for (let i = 0; i < 60; i++) {
      enqueueDiaryOutbox({ title: `t${i}`, detail: "d", status: "failed" });
    }
    const list = readDiaryOutbox();
    expect(list).toHaveLength(50);
    expect(list[0].title).toBe("t10");
    expect(list[49].title).toBe("t59");
  });

  it("损坏 JSON / 非数组 / 脏条目 → 返回空而不抛错（不让坏数据打断启动）", () => {
    localStorage.setItem(OUTBOX_KEY, "{不是 json");
    expect(readDiaryOutbox()).toEqual([]);
    localStorage.setItem(OUTBOX_KEY, '{"a":1}');
    expect(readDiaryOutbox()).toEqual([]);
    localStorage.setItem(OUTBOX_KEY, '[{"title":"ok","detail":"d","status":"failed"},null,{"detail":"无title"},7]');
    expect(readDiaryOutbox()).toEqual([{ title: "ok", detail: "d", status: "failed" }]);
  });

  it("未知 status 被过滤（status 是 closed union，非白名单即脏）", () => {
    localStorage.setItem(OUTBOX_KEY, '[{"title":"t","detail":"d","status":"info"}]');
    expect(readDiaryOutbox()).toEqual([]);
  });

  it("读 localStorage 抛错（隐私模式）→ 返回空，静默无告警", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readDiaryOutbox()).toEqual([]);
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it("写 localStorage 抛错 → 静默，且不经 logWarn 逃逸（防自指循环）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => enqueueDiaryOutbox({ title: "t", detail: "d", status: "failed" })).not.toThrow();
    expect(logWarnMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

describe("drainDiaryOutbox（ADR-322 D2）", () => {
  beforeEach(() => {
    enqueueDiaryOutbox({ title: "a", detail: "1", status: "failed" });
    enqueueDiaryOutbox({ title: "b", detail: "2", status: "warn" });
  });

  it("全部成功 → 按序投递 + 整批抹除（return=条数）", async () => {
    const seen: string[] = [];
    const n = await drainDiaryOutbox(async (e) => {
      seen.push(e.title);
    });
    expect(seen).toEqual(["a", "b"]);
    expect(n).toBe(2);
    expect(readDiaryOutbox()).toEqual([]);
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it("第 2 条失败 → 停止、失败条与后续原样留仓（不跳过不重排）", async () => {
    const seen: string[] = [];
    const n = await drainDiaryOutbox(async (e) => {
      seen.push(e.title);
      if (e.title === "b") throw new Error("bridge still down");
    });
    expect(seen).toEqual(["a", "b"]);
    expect(n).toBe(1);
    // 剩余必须是「未投出的 b」而不是「a 被重发」
    expect(readDiaryOutbox().map((e) => e.title)).toEqual(["b"]);
  });

  it("第 1 条即失败 → 原样全留、return 0", async () => {
    const n = await drainDiaryOutbox(async () => {
      throw new Error("bridge down");
    });
    expect(n).toBe(0);
    expect(readDiaryOutbox().map((e) => e.title)).toEqual(["a", "b"]);
  });

  it("空仓 → 直接返回 0，不调 emit（无谓的桥往返）", async () => {
    localStorage.clear();
    const emit = vi.fn(async () => {});
    const n = await drainDiaryOutbox(emit);
    expect(n).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});
