// @vitest-environment node
// environment 存档迁移纯函数测试（ADR-292 §3.3 迁移语义）
// 零 THREE / 零运行时 envState（仅引 schema 值域做单一事实源对账）——纯函数层，node 环境直测
// （与 ground-migrations.test.ts 同口径）
import { describe, expect, it } from "vitest";
import { ENV_STATE_SCHEMA } from "@/preview-3d/state/env-state-schema.ts";
import {
  type EnvMigrationInput,
  type EnvSource,
  migrateEnvSource,
  normalizeEnvLegacyState,
} from "./environment-migrations.ts";

describe("migrateEnvSource — ADR-292 §3.3 三判据", () => {
  describe("① 强意图：env 关 + sky IBL 开 → sky", () => {
    it("envEnabled=false 且 skyEnvironment=true → sky（旧画面是天空烘的图，迁 preset 会丢画面）", () => {
      expect(migrateEnvSource({ envEnabled: false, skyEnvironment: true, preset: "sky" })).toBe("sky");
    });

    it("该判据优先级最高：即便 preset=custom 也取 sky（env 侧资源未被使用）", () => {
      expect(
        migrateEnvSource({ envEnabled: false, skyEnvironment: true, preset: "custom" }),
      ).toBe("sky");
    });

    it("该判据优先级最高：preset 为具体值时同样取 sky", () => {
      expect(
        migrateEnvSource({ envEnabled: false, skyEnvironment: true, preset: "sunset" }),
      ).toBe("sky");
    });
  });

  describe("② 显式自定义 HDR → custom", () => {
    it("preset=custom 且 env 未关 → custom", () => {
      expect(migrateEnvSource({ preset: "custom", envEnabled: true, skyEnvironment: true })).toBe(
        "custom",
      );
    });

    it("preset=custom 且 sky IBL 关 → 仍 custom（与 ① 的区别在 env 是否关）", () => {
      expect(migrateEnvSource({ preset: "custom", skyEnvironment: false })).toBe("custom");
    });
  });

  describe("③ 默认：env 侧胜出 → preset", () => {
    it("默认路径：preset=sky（默认值）+ sky IBL 开 + env 开 → preset（不得迁进 sky）", () => {
      // 这是**默认路径**：用户从未改过任何开关。旧世界 env cap 后写胜出 ⇒ 画面是 env 预设。
      // 把「没关默认开关」解读成「我要天空 IBL」会把所有默认用户迁进 sky 并改变画面。
      expect(migrateEnvSource({ preset: "sky", skyEnvironment: true, envEnabled: true })).toBe(
        "preset",
      );
    });

    it("sky IBL 关 + 具体 preset → preset", () => {
      expect(migrateEnvSource({ preset: "sunset", skyEnvironment: false })).toBe("preset");
    });

    it("sky IBL 开 + 具体 preset ≠ sky + env 开 → preset（旧世界 env 后写胜出）", () => {
      expect(migrateEnvSource({ preset: "forest", skyEnvironment: true })).toBe("preset");
    });

    it("preset=studio → preset", () => {
      expect(migrateEnvSource({ preset: "studio" })).toBe("preset");
    });
  });

  describe("缺字段 / 类型异常容错", () => {
    it("全缺失 → preset（安全默认）", () => {
      expect(migrateEnvSource({})).toBe("preset");
    });

    it("preset 非字符串 → 视为未设置，按默认路径判定为 preset", () => {
      expect(migrateEnvSource({ preset: 42, skyEnvironment: true })).toBe("preset");
      expect(migrateEnvSource({ preset: null })).toBe("preset");
    });

    it("skyEnvironment 非布尔 → 不视作开启（严格 === true）", () => {
      // 存档被手改成 "true" 字符串等异常值，不得误判为强意图
      expect(migrateEnvSource({ skyEnvironment: "true" as unknown, envEnabled: false })).toBe(
        "preset",
      );
    });

    it("envEnabled 非布尔 → 不视作关闭（严格 === false）", () => {
      expect(migrateEnvSource({ envEnabled: 0 as unknown, skyEnvironment: true })).toBe("preset");
    });
  });

  describe("返回值域（单一事实源 = schema envSource.values）", () => {
    const cases: EnvMigrationInput[] = [
      {},
      { preset: "sky" },
      { preset: "custom" },
      { skyEnvironment: true },
      { skyEnvironment: false, envEnabled: false },
      { preset: "custom", skyEnvironment: true, envEnabled: false },
      { preset: "custom", skyEnvironment: true, envEnabled: true },
    ];

    it("恒落在 ENV_STATE_SCHEMA.envSource.values 内（不再手抄字面量）", () => {
      // [锐评 P0-① 收口 2026-10-07] 原断言用本地手写 ["preset","sky","custom"]——与 schema 双写
      // 同一组字面量：schema 加第 4 个来源时此处**不转红**（正是双源漂移）。改读 schema 值域。
      const domain = ENV_STATE_SCHEMA.envSource.values as readonly string[];
      for (const c of cases) {
        expect(domain, `输入 ${JSON.stringify(c)} 的返回值应在 schema 值域内`).toContain(
          migrateEnvSource(c),
        );
      }
    });

    it("schema 值域恰为约定三值；EnvSource 仍是字面量联合而非 string（编译期双守卫）", () => {
      // ① 值域锚：schema 侧漏改（少值/多值）即转红。
      const domain: EnvSource[] = [...ENV_STATE_SCHEMA.envSource.values];
      expect([...domain].sort()).toEqual(["custom", "preset", "sky"]);
      // ② 编译期锚（本文件唯一 vitest 看不见的守卫）：若 env-state-schema.ts 的
      //    `values: [...] as const` 丢了 `as const`（退化成 string[]），`EnvState["envSource"]`
      //    会**静默退化**为 string，①②③ 全部断言仍绿（与 string 兼容）——只有编译期能拦。
      //    下面 @ts-expect-error 在退化后成为「未使用指令」⇒ `npm run typecheck` 报 TS2578 转红
      //    （vitest 不做类型检查，故该守卫依赖 typecheck 闸；见 reviewer 2026-10-07 T4）。
      // @ts-expect-error "nope" 不属于 EnvSource 字面量联合
      const rejected: EnvSource = "nope";
      expect(rejected).toBe("nope");
    });
  });
});

describe("normalizeEnvLegacyState — 键形归一", () => {
  it("旧存档（无 envSource）→ 补写 envSource", () => {
    const old = { enabled: true, preset: "sunset", intensity: 1.4 };
    const out = normalizeEnvLegacyState(old, { skyEnvironment: false });
    expect(out.envSource).toBe("preset");
    expect(out.preset).toBe("sunset");
    expect(out.intensity).toBe(1.4);
  });

  it("旧存档 + 强意图组合 → envSource=sky", () => {
    const out = normalizeEnvLegacyState(
      { enabled: false, preset: "sky" },
      { skyEnvironment: true, envEnabled: false },
    );
    expect(out.envSource).toBe("sky");
  });

  it("幂等：已含 envSource → 返回同一引用（零拷贝快路）", () => {
    const modern = { enabled: true, preset: "sky", envSource: "sky" };
    expect(normalizeEnvLegacyState(modern, { skyEnvironment: false })).toBe(modern);
  });

  it("不 mutate 入参", () => {
    const old = { enabled: true, preset: "studio" };
    const snapshot = JSON.stringify(old);
    normalizeEnvLegacyState(old, {});
    expect(JSON.stringify(old)).toBe(snapshot);
    expect("envSource" in old).toBe(false);
  });

  it("从 state.enabled 兜底读 envEnabled（调用方未显式传时）", () => {
    // env 槽的 enabled 本就在 state 里，不必要求调用方重复传
    expect(normalizeEnvLegacyState({ enabled: false, preset: "sky" }, { skyEnvironment: true }).envSource).toBe(
      "sky",
    );
  });

  it("从 state.preset 兜底读 preset（调用方未显式传时）", () => {
    expect(normalizeEnvLegacyState({ preset: "custom", enabled: true }, {}).envSource).toBe(
      "custom",
    );
  });

  it("显式传入的 input 优先于 state 内同名字段", () => {
    const out = normalizeEnvLegacyState(
      { preset: "sunset", enabled: true },
      { preset: "custom", envEnabled: true },
    );
    expect(out.envSource).toBe("custom");
  });
});
