// @vitest-environment node
// ===== 语言包一致性测试 =====
// zh-CN 为唯一编辑基准；en/ja 必须与其 key 集合逐一对齐，且占位符 {xxx} 不丢失。
// 防翻译 key 漂移（ADR-045：缺 key 时 t() 返回 key 本身，用户看到英文/日文串裸奔）。
// 注意：本文件放 locales/ 外（该目录禁止放 .test.ts，见 zh-CN.ts 头部注释）。
import { describe, it, expect } from "vitest";
import { zhCN } from "@/locales/zh-CN.ts";
import { en } from "@/locales/en.ts";
import { ja } from "@/locales/ja.ts";
import { extractPlaceholders } from "@/utils/base/pure/i18n-placeholder.ts";
import { BASE_LANG, FALLBACK_LANG, SUPPORTED_LANGS } from "./locale.ts";

const bundles: Array<[string, Record<string, string>]> = [
  ["en", en],
  ["ja", ja],
];

describe("语言包 key 对齐（基准 zh-CN）", () => {
  // zh-CN 无 index signature（keyof 类型化后），key 数组断言为 keyof 联合以便索引
  const zhKeys = Object.keys(zhCN) as Array<keyof typeof zhCN>;
  const zhSet = new Set<string>(zhKeys);

  it("三个语言包 key 总数一致", () => {
    expect(zhKeys.length).toBeGreaterThan(0);
    for (const [name, b] of bundles) {
      expect(Object.keys(b).length, `${name} key 数 != zh-CN`).toBe(zhKeys.length);
    }
  });

  it("en/ja 无缺失 key、无多余 key", () => {
    for (const [name, b] of bundles) {
      for (const k of Object.keys(b)) {
        expect(zhSet.has(k), `${name} 多余 key: ${k}`).toBe(true);
      }
      for (const k of zhKeys) {
        expect(k in b, `${name} 缺失 key: ${k}`).toBe(true);
      }
    }
  });

  it("所有翻译值非空", () => {
    for (const [name, b] of bundles) {
      for (const [k, v] of Object.entries(b)) {
        expect(v.trim().length, `${name}.${k} 为空`).toBeGreaterThan(0);
      }
    }
  });

  it("占位符参数集合与 zh-CN 一致（不丢参数）", () => {
    for (const [name, b] of bundles) {
      for (const k of zhKeys) {
        const zh = extractPlaceholders(zhCN[k]);
        const t = extractPlaceholders(b[k] ?? "");
        expect(t, `${name}.${k} 占位符不一致`).toEqual(zh);
      }
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
