// ===== preview-paths 不变量测试 =====
// 类型一致性（KNOWN_PATHS ⇄ PathValue）已由 typecheck 守护；此处锁 typecheck 查不出的
// 运行时不变量：无重复键、namespace.field 形态、六项横切键防整体误删、探针值域元组 ⇄ schema 同步。
import { describe, it, expect } from "vitest";
import { ENV_STATE_SCHEMA, type EnvStateKey } from "./env-state-schema.ts";
import { KNOWN_PATHS, PROBE_ENUM_VALUES } from "./preview-paths.ts";

// 同步设置契约形状：namespace.field（首段小写字母开头）
const PATH_RE = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/;

describe("preview-paths 不变量", () => {
  it("KNOWN_PATHS 非空且无重复键（typecheck 查不出重复）", () => {
    expect(KNOWN_PATHS.length).toBeGreaterThan(0);
    expect(new Set(KNOWN_PATHS).size).toBe(KNOWN_PATHS.length);
  });

  it("每个路径符合同步设置契约形状（namespace.field）", () => {
    for (const p of KNOWN_PATHS) {
      expect(p, `路径 "${p}" 应为 namespace.field 形式`).toMatch(PATH_RE);
    }
  });

  it("保留 ADR-125 横切路径（防整体误删）", () => {
    // [ADR-250] 原六项中的 `render.bloom` 已退场——后处理是视觉项（与 wireframe/pmrem 同类
    // 中的 bloom 例外曾被误列），其开关唯一入口 = cap 自报的 pp-enabled 控件（写 envState.ppEnabled）。
    const core = [
      "render.frustumCull",
      "render.maxFps",
      "render.maxPixelRatio",
      "render.wireframe",
      "env.pmrem",
    ];
    for (const c of core) {
      expect(KNOWN_PATHS, `缺核心横切键 ${c}`).toContain(c);
    }
    expect(KNOWN_PATHS as readonly string[]).not.toContain("render.bloom");
  });
});

// [锐评 F-3 家族收口 2026-09-23] PROBE_ENUM_VALUES 是「影子声明」：叶子零 import
// （ADR-168 断环纪律）决定它必须抄一份 schema 的 enum values——本用例就是抄件的对账闸：
// 任一侧漂移（schema 加成员忘同步叶子 / 叶子手滑打错字面量）当场红。
// 「首成员 = schema default」同时钉死 binding 归一回落（probeEnum → tuple[0]）与
// schema 默认值不脱钩——回落语义必须由默认值兜底，不能随便挑一个成员。
describe("PROBE_ENUM_VALUES ⇄ ENV_STATE_SCHEMA 值域同步（F-3 家族）", () => {
  const entries = Object.entries(PROBE_ENUM_VALUES) as Array<
    [keyof typeof PROBE_ENUM_VALUES, readonly string[]]
  >;

  it("每个探针路径都已落地于 KNOWN_PATHS，元组非空且无重复", () => {
    expect(entries.length, "探针值域表不应为空表（空表 = 对账闸空转）").toBeGreaterThan(0);
    for (const [path, values] of entries) {
      expect(KNOWN_PATHS, `探针 ${path} 未入 KNOWN_PATHS`).toContain(path);
      expect(values.length, `${path} 值域元组不得为空`).toBeGreaterThan(0);
      expect(new Set(values).size, `${path} 元组有重复成员`).toBe(values.length);
    }
  });

  it("元组成员 ≡ schema enum values（集合相等）且首成员 = schema default", () => {
    for (const [path, values] of entries) {
      const envKey = path.slice("env.".length) as EnvStateKey;
      const def = ENV_STATE_SCHEMA[envKey] as
        | { type?: string; values?: readonly string[]; default?: unknown }
        | undefined;
      expect(def, `schema 缺键 ${envKey}（探针 ${path} 悬空）`).toBeTruthy();
      expect(def!.type, `${envKey} 应为 enum 键（探针归一守卫的前提）`).toBe("enum");
      expect([...values].sort(), `${path} 与 schema ${envKey}.values 漂移`).toEqual(
        [...(def!.values ?? [])].sort(),
      );
      expect(values[0], `${path} 首成员（binding 回落缺省）≠ schema default`).toBe(def!.default);
    }
  });
});
