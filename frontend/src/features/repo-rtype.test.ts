// ===== repo-rtype 单元测试（P3 审计补盲：当前仓库资源类型订阅）=====
// 覆盖 currentRepoType（localStorage 兜底）/ useCurrentResourceType（订阅 + 同值去重 + cleanup）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";

// safeGet 隔离 localStorage 真实状态（隐私模式 / 并发写入不影响断言）
vi.mock("../utils/dom/storage.ts", () => ({
  safeGet: vi.fn(),
}));

import { currentRepoType, useCurrentResourceType } from "./repo-rtype.ts";
import { safeGet } from "../utils/dom/storage.ts";

const offs: Array<() => void> = [];

beforeEach(() => {
  vi.clearAllMocks();
  offs.length = 0;
});

afterEach(() => {
  offs.forEach((o) => o());
  offs.length = 0;
});

describe("currentRepoType", () => {
  it("localStorage 有值 → 返回该值", () => {
    vi.mocked(safeGet).mockReturnValue("EntityPlayer");
    expect(currentRepoType()).toBe("EntityPlayer");
  });

  it("localStorage 为空 → 回退 RESOURCE_TYPES.YSM", () => {
    vi.mocked(safeGet).mockReturnValue(null);
    expect(currentRepoType()).toBe(RESOURCE_TYPES.YSM);
  });
});

describe("useCurrentResourceType", () => {
  it("初值取 localStorage，get() 返回初值", () => {
    vi.mocked(safeGet).mockReturnValue("maid-model");
    const sub = useCurrentResourceType(() => {});
    offs.push(sub.cleanup);
    expect(sub.get()).toBe("maid-model");
  });

  it("事件类型变化 → onChange 触发且 get() 更新", () => {
    vi.mocked(safeGet).mockReturnValue("maid-model");
    const onChange = vi.fn();
    const sub = useCurrentResourceType(onChange);
    offs.push(sub.cleanup);
    bus.emit("repo:rtype-changed", "EntityPlayer");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(sub.get()).toBe("EntityPlayer");
  });

  it("事件类型与当前相同 → onChange 不触发（防重复加载）", () => {
    vi.mocked(safeGet).mockReturnValue("maid-model");
    const onChange = vi.fn();
    const sub = useCurrentResourceType(onChange);
    offs.push(sub.cleanup);
    bus.emit("repo:rtype-changed", "maid-model");
    expect(onChange).not.toHaveBeenCalled();
    expect(sub.get()).toBe("maid-model");
  });

  it("cleanup 后不再响应类型变更", () => {
    vi.mocked(safeGet).mockReturnValue("maid-model");
    const onChange = vi.fn();
    const sub = useCurrentResourceType(onChange);
    sub.cleanup();
    bus.emit("repo:rtype-changed", "EntityPlayer");
    expect(onChange).not.toHaveBeenCalled();
  });
});
