// ===== 搜索关键词匹配单口径测试（ADR-343-d1 C1）=====
// 金样例 tests/fixtures/search-golden.json 双读对账（TS 面）——Go 面
// go/pinyin/pinyin_test.go|TestMatchKeyword_Golden 读同一 fixture，跨语言判据漂移在此拦下。
import { describe, it, expect } from "vitest";
import { keywordMatches, isLatins } from "./match.ts";
import { PINYIN_BY_CODE } from "./pinyin-table.ts";
import golden from "../../../../tests/fixtures/search-golden.json" with { type: "json" };

type GoldenCase = { name: string; relPath: string; keyword: string; hit: boolean };

describe("keywordMatches — 金样例对账（与 Go go/pinyin 同判据）", () => {
  it("全部金样例命中口径一致", () => {
    const cases = golden.cases as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(20);
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      expect(keywordMatches(c.name, c.relPath, c.keyword), `case ${i}: ${JSON.stringify(c)}`).toBe(c.hit);
    }
  });
});

describe("keywordMatches — 面语义单测", () => {
  it("CJK 直接面：name / relPath 子串", () => {
    expect(keywordMatches("狐狸.ysm", "组A/狐狸.ysm", "狐狸")).toBe(true);
    expect(keywordMatches("狐狸.ysm", "组A/狐狸.ysm", "组A")).toBe(true);
    expect(keywordMatches("狐狸.ysm", "组A/狐狸.ysm", "组B")).toBe(false);
  });

  it("拼音面：全拼 / 首字母（纯拉丁关键词才生效）", () => {
    expect(keywordMatches("小红书模型.ysm", "", "xiaohong")).toBe(true);
    expect(keywordMatches("小红书模型.ysm", "", "xhsm")).toBe(true);
    expect(keywordMatches("小红书模型.ysm", "", "hongshu")).toBe(true);
    expect(keywordMatches("模型.ysm", "", "mx")).toBe(true);
    expect(keywordMatches("模型.ysm", "", "xx")).toBe(false);
  });

  it("混合关键词（CJK+拉丁）不走拼音面——宁漏勿误", () => {
    expect(keywordMatches("狐狸.ysm", "", "狐li")).toBe(false);
  });

  it("空关键词 = 命中全部；纯空白 = 空", () => {
    expect(keywordMatches("任意.ysm", "任意/目录", "")).toBe(true);
    expect(keywordMatches("任意.ysm", "任意/目录", "   ")).toBe(true);
  });

  it("大小写折叠（name / relPath / 关键词三路）", () => {
    expect(keywordMatches("WARRIOR.ysm", "MMD/warrior.ysm", "war")).toBe(true);
    expect(keywordMatches("warrior.ysm", "mmd/warrior.ysm", "MMD")).toBe(true);
  });
});

describe("isLatins — 拼音面门槛", () => {
  it("纯字母数字 = true；含 CJK / 标点 / 空白 = false", () => {
    expect(isLatins("xh")).toBe(true);
    expect(isLatins("xh2m")).toBe(true);
    expect(isLatins("狐")).toBe(false);
    expect(isLatins("x h")).toBe(false);
    expect(isLatins("x-h")).toBe(false);
  });
});

describe("拼音表完整性（生成物守卫）", () => {
  it("基本区常用字在表内且小写", () => {
    expect(PINYIN_BY_CODE[0x5c0f]).toBe("xiao"); // 小
    expect(PINYIN_BY_CODE[0x7ea2]).toBe("hong"); // 红
    expect(PINYIN_BY_CODE[0x72d0]).toBe("hu"); // 狐
  });
  it("表规模与生成器口径一致（CJK 基本区 2 万量级）", () => {
    expect(Object.keys(PINYIN_BY_CODE).length).toBeGreaterThan(20000);
  });
});
