// @vitest-environment node
// ===== 跨文件资源类型一致性契约（T2 归一前钉）=====
// 病灶：resource_types.json 被 types.ts / extensions.ts / registry.ts 各自以不同字段子集
// view 解析，三个文件之间从无一条断言互相咬合（各自只与 JSON 单向对账）。
// 本测试在归一前钉住「三文件派生必须互相一致」的不变量，归一后再跑防行为分叉。
import { describe, it, expect } from "vitest";
import { ALL_RESOURCE_TYPES, RESOURCE_TYPES } from "./types.ts";
import { RESOURCE_EXTS, ALL_EXTS } from "./extensions.ts";
import resourceTypesJson from "#root/resource_types.json" with { type: "json" };

const jsonTypes = (
  resourceTypesJson as { resourceTypes: Array<{ id: string; extensions?: string[] }> }
).resourceTypes;

describe("跨文件一致性：types.ts ↔ extensions.ts ↔ JSON", () => {
  it("id 集合全等（types.ts 与 extensions.ts 不得漂移）", () => {
    expect([...ALL_RESOURCE_TYPES].sort()).toEqual(Object.keys(RESOURCE_EXTS).sort());
  });

  it("id 集合与 JSON 双向全等（无缺失 / 无多余）", () => {
    const jsonIds = jsonTypes.map((t) => t.id).sort();
    expect([...ALL_RESOURCE_TYPES].sort()).toEqual(jsonIds);
    expect(Object.keys(RESOURCE_EXTS).sort()).toEqual(jsonIds);
  });

  it("ALL_EXTS = JSON 扩展名去重并集（两文件口径一致）", () => {
    const jsonAll = Array.from(
      new Set(jsonTypes.flatMap((t) => (t.extensions || []).map((e) => e.toLowerCase()))),
    ).sort();
    expect([...ALL_EXTS].sort()).toEqual(jsonAll);
  });

  it("RESOURCE_TYPES 标签值全部为真实类型 id（不指向幽灵类型）", () => {
    for (const [key, id] of Object.entries(RESOURCE_TYPES)) {
      expect(ALL_RESOURCE_TYPES, `RESOURCE_TYPES.${key} → ${id} 不在注册表`).toContain(id);
    }
  });
});