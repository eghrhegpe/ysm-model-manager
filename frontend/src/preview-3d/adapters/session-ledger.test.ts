// ===== 会话台账契约测试（ADR-227 P1 单例收敛）=====
// 覆盖：beginSession 代际/序号分配、invalidate 只动作废代际、activeHandle 表尾语义、
// snapshot 副本语义（cleanup 遍历期间句柄自我摘除不跳元素）、clear 数组身份保持、
// resetSeq 测试缝边界（只重置序号，不动代际/句柄表）。
// 这些不变量是 coop 多会话簿记的根因防线：台账换数组或错序会让消费方看到旧表/漏清会话。
import { describe, expect, it, beforeEach } from "vitest";
import { SessionLedgerHost, sessionLedger } from "./session-ledger.ts";

/** 假句柄：台账只按结构持有，不校验 PreviewHandle 全契约 */
const fakeHandle = (name: string) => ({ cleanup: () => undefined, name }) as never;

describe("SessionLedgerHost 单元契约", () => {
  let ledger: SessionLedgerHost;

  beforeEach(() => {
    ledger = new SessionLedgerHost();
  });

  it("beginSession 分配单调代际 + per-mount 稳定会话 id", () => {
    expect(ledger.gen()).toBe(0);
    expect(ledger.beginSession()).toEqual({ gen: 1, sessionId: "s1" });
    expect(ledger.beginSession()).toEqual({ gen: 2, sessionId: "s2" });
    // 代际与序号各自单调，不互相污染
    expect(ledger.gen()).toBe(2);
  });

  it("invalidate 只推进代际，不消耗会话序号", () => {
    ledger.beginSession();
    ledger.invalidate();
    ledger.invalidate();
    expect(ledger.gen()).toBe(3);
    // 序号未被 invalidate 影响：下一次 mount 仍是 s2
    expect(ledger.beginSession().sessionId).toBe("s2");
  });

  it("activeHandle 取表尾句柄；空表返回 null（无活跃会话 no-op 语义）", () => {
    expect(ledger.activeHandle()).toBeNull();
    expect(ledger.hasActive()).toBe(false);
    ledger.handles.push({ handle: fakeHandle("a"), gen: 1 });
    ledger.handles.push({ handle: fakeHandle("b"), gen: 2 });
    expect(ledger.activeHandle()).toBe(ledger.handles[1].handle);
    expect(ledger.hasActive()).toBe(true);
  });

  it("snapshot 是副本：遍历期间句柄摘除自身不跳元素（coop 多会话清全）", () => {
    ledger.handles.push({ handle: fakeHandle("a"), gen: 1 });
    ledger.handles.push({ handle: fakeHandle("b"), gen: 2 });
    const seen: string[] = [];
    for (const entry of ledger.snapshot()) {
      seen.push((entry.handle as unknown as { name: string }).name);
      // 模拟 fullCleanup 摘除自身
      const idx = ledger.handles.findIndex((h) => h.gen === entry.gen);
      if (idx >= 0) ledger.handles.splice(idx, 1);
    }
    expect(seen).toEqual(["a", "b"]);
    expect(ledger.handles).toHaveLength(0);
  });

  it("clear 原地清空保持数组身份（ctx.handles 已捕获引用不得换表）", () => {
    const ref = ledger.handles;
    ledger.handles.push({ handle: fakeHandle("a"), gen: 1 });
    ledger.clear();
    expect(ledger.handles).toHaveLength(0);
    expect(ledger.handles).toBe(ref);
  });

  it("resetSeq 只重置序号：代际与句柄表不动（测试缝不得改变运行态语义）", () => {
    ledger.beginSession();
    ledger.handles.push({ handle: fakeHandle("a"), gen: 1 });
    ledger.resetSeq();
    expect(ledger.beginSession().sessionId).toBe("s1");
    expect(ledger.gen()).toBe(2);
    expect(ledger.handles).toHaveLength(1);
  });
});

describe("sessionLedger 单例", () => {
  it("为全局唯一台账实例（代际/序号需全应用一致）", () => {
    expect(sessionLedger).toBeInstanceOf(SessionLedgerHost);
    expect(sessionLedger.handles).toEqual([]);
  });
});
