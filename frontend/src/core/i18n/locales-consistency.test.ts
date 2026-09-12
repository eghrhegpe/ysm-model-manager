// @vitest-environment node
// ===== 语言包一致性测试 =====
// zh-CN 为唯一编辑基准；en/ja 必须与其 key 集合逐一对齐，且占位符 {xxx} 不丢失。
// 防翻译 key 漂移（ADR-045：缺 key 时 t() 返回 key 本身，用户看到英文/日文串裸奔）。
// 注意：本文件放 locales/ 外（该目录禁止放 .test.ts，见 zh-CN.ts 头部注释）。
import { describe, it, expect } from "vitest";
import { zhCN } from "@/locales/zh-CN.ts";
import { en } from "@/locales/en.ts";
import { ja } from "@/locales/ja.ts";
import { extractPlaceholders } from "./placeholder.ts";
import { BASE_LANG, FALLBACK_LANG, SUPPORTED_LANGS } from "./locale.ts";

const bundles: Array<[string, Record<string, string>]> = [
  ["en", en],
  ["ja", ja],
];

describe("语言包 key 对齐（基准 zh-CN）", () => {
  // zh-CN 无 index signature（keyof 类型化后），key 数组断言为 keyof 联合以便索引
  const zhKeys = Object.keys(zhCN) as Array<keyof typeof zhCN>;

  it("三个语言包 key 总数一致", () => {
    expect(zhKeys.length).toBeGreaterThan(0);
    for (const [name, b] of bundles) {
      expect(Object.keys(b).length, `${name} key 数 != zh-CN`).toBe(zhKeys.length);
    }
  });

  it("en/ja key 集合与 zh-CN 完全一致（无缺失、无多余）", () => {
    // 整体集合 toEqual（排序后逐位比对）：双向对齐一次判定；失败时 vitest diff 列出
    // 全部缺失/多余 key，不逐个 expect 挤牙膏（首个缺口即终止旧写法）。
    const zhSorted = [...zhKeys].sort();
    for (const [name, b] of bundles) {
      expect([...Object.keys(b)].sort(), `${name} key 集合 != zh-CN`).toEqual(zhSorted);
    }
  });

  it("所有翻译值非空", () => {
    for (const [name, b] of bundles) {
      for (const [k, v] of Object.entries(b)) {
        expect(v.trim().length, `${name}.${k} 为空`).toBeGreaterThan(0);
      }
    }
  });

  it("基准包 zh-CN 翻译值非空（基准误改空串会让用户裸奔）", () => {
    for (const [k, v] of Object.entries(zhCN)) {
      expect(v.trim().length, `zh-CN.${k} 为空`).toBeGreaterThan(0);
    }
  });

  it("占位符参数集合与 zh-CN 一致（不丢参数）", () => {
    // 收集成对象后整体 toEqual：一处不一致即一次 diff 列出全部 key 的占位符差异。
    for (const [name, b] of bundles) {
      const zhPH: Record<string, string[]> = {};
      const refPH: Record<string, string[]> = {};
      for (const k of zhKeys) {
        zhPH[k] = extractPlaceholders(zhCN[k]);
        refPH[k] = extractPlaceholders(b[k] ?? "");
      }
      expect(refPH, `${name} 占位符集合 != zh-CN`).toEqual(zhPH);
    }
  });
});

describe("兜底/基准语言单一事实源（ADR-210 D4 + BASE_LANG）", () => {
  it("FALLBACK_LANG ∈ SUPPORTED_LANGS codes（en 被移出支持列表时此测先红）", () => {
    expect(SUPPORTED_LANGS.map((l) => l.code)).toContain(FALLBACK_LANG);
  });

  it("BASE_LANG ∈ SUPPORTED_LANGS codes（zh-CN 被移出支持列表时此测先红）", () => {
    expect(SUPPORTED_LANGS.map((l) => l.code)).toContain(BASE_LANG);
  });
});
