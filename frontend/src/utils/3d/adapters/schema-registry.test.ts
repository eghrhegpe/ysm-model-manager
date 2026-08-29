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
  unregisterSchema,
  makeYsmModelSchemaId,
  YSM_MODEL_SCHEMA_ID,
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

describe("makeYsmModelSchemaId（per-scene key 工厂，YSM/maid 同框隔离）", () => {
  it("返回 `ysm-model-{sessionId}` 形态；YSM_MODEL_SCHEMA_ID 常量保留（旧全局 key 兼容）", () => {
    expect(makeYsmModelSchemaId("m1")).toBe("ysm-model-m1");
    expect(makeYsmModelSchemaId("scene-7")).toBe("ysm-model-scene-7");
    // 工厂产物与旧全局 key 不同——per-scene 注册不再静默覆盖 "ysm-model"
    expect(makeYsmModelSchemaId("m1")).not.toBe(YSM_MODEL_SCHEMA_ID);
  });

  it("per-scene key 并存：a/b 两个 builder 都注册，各自 getSchema 取到自己的（互不覆盖）", () => {
    const builderA = () => [{ id: "a", kind: "field" as const, value: "A" }];
    const builderB = () => [{ id: "b", kind: "field" as const, value: "B" }];
    registerSchema(makeYsmModelSchemaId("m1"), builderA);
    registerSchema(makeYsmModelSchemaId("m2"), builderB);

    // 两个 builder 都还在（Bug A：旧固定 key 第二次 build 会静默覆盖第一个）
    expect(hasSchema(makeYsmModelSchemaId("m1"))).toBe(true);
    expect(hasSchema(makeYsmModelSchemaId("m2"))).toBe(true);
    expect(listSchemas()).toEqual(
      expect.arrayContaining([makeYsmModelSchemaId("m1"), makeYsmModelSchemaId("m2")]),
    );
    // getSchema 各自取到各自的 builder（不再串数据）
    expect(getSchema(makeYsmModelSchemaId("m1"))!({} as never)[0]).toMatchObject({ value: "A" });
    expect(getSchema(makeYsmModelSchemaId("m2"))!({} as never)[0]).toMatchObject({ value: "B" });
  });

  it("注销一个 per-scene key 不影响另一个（dispose 精准清理）", () => {
    registerSchema(makeYsmModelSchemaId("m1"), () => []);
    registerSchema(makeYsmModelSchemaId("m2"), () => []);
    unregisterSchema(makeYsmModelSchemaId("m1"));
    expect(hasSchema(makeYsmModelSchemaId("m1"))).toBe(false);
    expect(hasSchema(makeYsmModelSchemaId("m2"))).toBe(true);
  });
});
