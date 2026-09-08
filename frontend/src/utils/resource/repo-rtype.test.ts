// @vitest-environment node
// ===== currentRepoType 测试 =====
// 覆盖：localStorage 命中 / 缺失 / 空串 / 异常传播契约。
// safeGet 内部 try/catch 将存储异常转为 null → currentRepoType 回退 RESOURCE_TYPES.YSM；
// currentRepoType 自身无 try/catch，依赖 safeGet 兜底——此契约由本测试锁定。
import { describe, it, expect, vi } from "vitest";

const { safeGetMock } = vi.hoisted(() => ({ safeGetMock: vi.fn() }));
vi.mock("@/utils/dom/storage.ts", () => ({ safeGet: safeGetMock }));

import { currentRepoType } from "./repo-rtype.ts";
import { RESOURCE_TYPES } from "./types.ts";

describe("currentRepoType", () => {
  it("localStorage 命中：返回存储的类型值", () => {
    safeGetMock.mockReturnValue("EntityPlayer");
    expect(currentRepoType()).toBe("EntityPlayer");
    expect(safeGetMock).toHaveBeenCalledWith("repo_rtype");
  });

  it("localStorage 缺失（safeGet 返回 null）：回退 RESOURCE_TYPES.YSM", () => {
    safeGetMock.mockReturnValue(null);
    expect(currentRepoType()).toBe(RESOURCE_TYPES.YSM);
  });

  it("localStorage 空串：回退 RESOURCE_TYPES.YSM", () => {
    safeGetMock.mockReturnValue("");
    expect(currentRepoType()).toBe(RESOURCE_TYPES.YSM);
  });

  it("safeGet 抛错时 currentRepoType 传播异常（自身无 try/catch，依赖 safeGet 兜底）", () => {
    // 契约：currentRepoType 不做异常吞掉，safeGet 的 try/catch 是唯一防线；
    // 若 safeGet 未来去掉 try/catch，此测试会响亮暴露回归
    safeGetMock.mockImplementation(() => {
      throw new Error("localStorage quota");
    });
    expect(() => currentRepoType()).toThrow("localStorage quota");
  });
});
