// @vitest-environment node
// ===== 语言包一致性测试 =====
// zh-CN 为唯一编辑基准；en/ja 必须与其 key 集合逐一对齐，且占位符 {xxx} 不丢失。
// 防翻译 key 漂移（ADR-045：缺 key 时 t() 返回 key 本身，用户看到英文/日文串裸奔）。
// 注意：本文件放 locales/ 外（该目录禁止放 .test.ts，见 zh-CN.ts 头部注释）。
import { describe, it, expect } from "vitest";
import { zhCN } from "./locales/zh-CN.ts";
import { en } from "./locales/en.ts";
import { ja } from "./locales/ja.ts";

const bundles: Array<[string, Record<string, string>]> = [
  ["en", en],
  ["ja", ja],
];

/** 提取字符串中的插值占位符 {n} / {path} 等 */
function placeholders(s: string): string[] {
  const out: string[] = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out.sort();
}

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
        const zh = placeholders(zhCN[k]);
        const t = placeholders(b[k] ?? "");
        expect(t, `${name}.${k} 占位符不一致`).toEqual(zh);
      }
    }
  });
});
