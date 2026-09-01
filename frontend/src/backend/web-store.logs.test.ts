// @vitest-environment node
// ===== 日志 IDB 持久化测试（审核 B 缺口 #2）=====
// AddOpLog/AddImportLog → IDB 落库（web:runtime-logs/web:import-logs）；
// GetRuntimeLogs hydrate 恢复上会话日志；clear 删 IDB；push 先 hydrate 不覆盖旧。
// 共享 idb mock：setup 层 globalThis.__YSM_TEST_IDB__ 注入（isolate:false 穿透修复，2026-08-17）
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
const idbMock = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbGetAll: Mock;
    idbDel: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;
import { browserAdapter } from "./browser-adapter.ts";
import { __resetWebLogStateForTest } from "./web-store.ts";

// idb 层内存实现（对齐 browser-adapter.test.ts 的 mock 模式）

beforeEach(() => {
  idbMock._store.clear();
  vi.clearAllMocks();
  __resetWebLogStateForTest(); // 重置模块级 hydrated 标记（防测试间污染）
});

describe("日志 IDB 持久化（ADR-071 #8 + 审核 A #3 竞态修复）", () => {
  it("AddOpLog → 写入 IDB（web:runtime-logs），GetRuntimeLogs 读到", async () => {
    await browserAdapter.AddOpLog("import", "狐狸.ysm", "", "", 0, "ok", "");
    const logs = (await browserAdapter.GetRuntimeLogs()) as Array<{ Message: string }>;
    expect(logs.some((l) => l.Message.includes("狐狸.ysm"))).toBe(true);
    // IDB 落库（fire-and-forget 写，等 microtask）
    await Promise.resolve();
    expect(idbMock._store.has("web:runtime-logs")).toBe(true);
  });

  it("hydrate 恢复：IDB 预置上会话日志 → GetRuntimeLogs 读到（刷新不丢）", async () => {
    idbMock._store.set("web:runtime-logs", [
      { Message: "上一会话记录", Timestamp: 1 },
    ]);
    const logs = (await browserAdapter.GetRuntimeLogs()) as Array<{ Message: string }>;
    expect(logs.some((l) => l.Message === "上一会话记录")).toBe(true);
  });

  it("push 先 hydrate：预置旧日志 + AddOpLog → 新旧都在（不覆盖丢失）", async () => {
    idbMock._store.set("web:runtime-logs", [
      { Message: "旧日志", Timestamp: 1 },
    ]);
    await browserAdapter.AddOpLog("import", "新模型.ysm", "", "", 0, "ok", "");
    const logs = (await browserAdapter.GetRuntimeLogs()) as Array<{ Message: string }>;
    const msgs = logs.map((l) => l.Message);
    expect(msgs.some((m) => m.includes("旧日志"))).toBe(true);
    expect(msgs.some((m) => m.includes("新模型"))).toBe(true);
  });

  it("ClearRuntimeLogs → 内存清空 + IDB 删除（下次 hydrate 读到空）", async () => {
    await browserAdapter.AddOpLog("import", "狐狸.ysm", "", "", 0, "ok", "");
    await Promise.resolve();
    expect(idbMock._store.has("web:runtime-logs")).toBe(true);
    await browserAdapter.ClearRuntimeLogs();
    const logs = (await browserAdapter.GetRuntimeLogs()) as unknown[];
    expect(logs).toHaveLength(0);
    expect(idbMock._store.has("web:runtime-logs")).toBe(false);
  });

  it("导入日志：AddImportLog → 写入 IDB（web:import-logs）+ GetImportLogs 读到", async () => {
    await browserAdapter.AddImportLog("狐狸.ysm", "/a.ysm", "/web/ysm", 1024, "ok", "");
    const logs = (await browserAdapter.GetImportLogs()) as Array<{ ModelName?: string }>;
    expect(logs.some((l) => l.ModelName === "狐狸.ysm")).toBe(true);
    await Promise.resolve();
    expect(idbMock._store.has("web:import-logs")).toBe(true);
  });
});
