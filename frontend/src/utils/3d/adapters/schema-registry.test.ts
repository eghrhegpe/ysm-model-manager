// ===== schema-registry 契约测试（[doc:adr-126-p5-a] 受控 builder 注册）=====
// 锁定三件事：
//   1. 注册 / 查询 / 枚举 / 清空 基本生命周期
//   2. 重复注册覆盖旧 builder（后注册者生效——多模型同框换菜单语义，非抛错）
//   3. builder 吃状态层快照（PreviewSnapshot）——与 P4-D visibleWhen 同构

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerSchema,
  getSchema,
  hasSchema,
  listSchemas,
  resetSchemas,
} from "./schema-registry.ts";
import type { PreviewMenuNode } from "./preview-menu/node-types.ts";

beforeEach(() => {
  resetSchemas();
});

describe("schema-registry 受控注册", () => {
  it("注册后可查询 / 枚举，builder 吃快照产出节点", () => {
    const builder = (snapshot: Record<string, unknown>): PreviewMenuNode[] => [
      { id: "field-a", kind: "field", labelKey: "preview.a", value: String(snapshot["render.maxFps"]) },
    ];
    registerSchema("test-panel", builder as never);

    expect(hasSchema("test-panel")).toBe(true);
    expect(listSchemas()).toContain("test-panel");
    const got = getSchema("test-panel")!({ "render.maxFps": 120 } as never);
    expect(got[0]).toMatchObject({ id: "field-a", value: "120" });
  });

  it("未注册 id 查询返回 undefined", () => {
    expect(getSchema("nope")).toBeUndefined();
    expect(hasSchema("nope")).toBe(false);
  });

  it("重复注册覆盖旧 builder（多模型同框换菜单语义）", () => {
    registerSchema("dup", () => [{ id: "a", kind: "field", value: "old" } as never]);
    registerSchema("dup", () => [{ id: "a", kind: "field", value: "new" } as never]);
    const got = getSchema("dup")!({} as never);
    expect(got[0]).toMatchObject({ value: "new" });
  });

  it("resetSchemas 清空全部", () => {
    registerSchema("a", () => []);
    registerSchema("b", () => []);
    resetSchemas();
    expect(listSchemas()).toEqual([]);
  });
});
