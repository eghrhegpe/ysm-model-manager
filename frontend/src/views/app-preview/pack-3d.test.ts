// pack-3d.ts 单元测试：[ADR-159] 容器语义（packModelsByType 候选源补丁已退役，
// resourcepack 类型 tab 回归 base 仓库扫描；包内切换由角色面板组件区承担）
import { describe, it, expect } from "vitest";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

describe("ADR-159 packModelsByType 退役回归", () => {
  it("RESOURCE_TYPES.PACK 常量仍为 resourcepack（候选源回归 base 扫描的前提契约）", () => {
    expect(RESOURCE_TYPES.PACK).toBe("resourcepack");
  });
});
