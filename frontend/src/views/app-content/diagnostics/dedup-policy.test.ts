// @vitest-environment node
// ===== dedup-policy.ts 纯函数层测试（补零 mock 单测盲区）=====
// 本模块自述「策略决策零 DOM/会话依赖，独立成层可零 mock 单测」（dedup-policy.ts:2-3），
// 此前仅有 dedup.test.ts 的集成路径覆盖，纯函数三分支（oldest/newest/path）零直测。
import { describe, it, expect } from "vitest";
import { getDefaultKeepIdx, type DedupFileLike } from "./dedup-policy.ts";

// exactOptionalPropertyTypes: true —— modTime 缺失时必须整个省略该键，不可显式传 undefined
const f = (path: string, size: number, modTime?: string | number): DedupFileLike =>
  modTime === undefined ? { path, size } : { path, size, modTime };

describe("getDefaultKeepIdx — 边界", () => {
  it("空数组 → 0（不抛错，reduce 空数组护栏）", () => {
    expect(getDefaultKeepIdx([], "oldest", "")).toBe(0);
    expect(getDefaultKeepIdx([], "newest", "")).toBe(0);
    expect(getDefaultKeepIdx([], "path", "x")).toBe(0);
  });

  it("单元素 → 0（各策略恒等）", () => {
    const one = [f("a.ysm", 10, "2020-01-01T00:00:00Z")];
    expect(getDefaultKeepIdx(one, "oldest", "")).toBe(0);
    expect(getDefaultKeepIdx(one, "newest", "")).toBe(0);
    expect(getDefaultKeepIdx(one, "path", "a")).toBe(0);
  });

  it("size 全相等 → 首项（reduce 用严格 > 比较，并列保序不走后项）", () => {
    const files = [f("a.ysm", 5, "2020-01-01T00:00:00Z"), f("b.ysm", 5, "2021-01-01T00:00:00Z")];
    expect(getDefaultKeepIdx(files, "unknown-policy", "")).toBe(0);
  });
});

describe("getDefaultKeepIdx — oldest 策略", () => {
  it("保留最早修改的文件", () => {
    const files = [
      f("new.ysm", 10, "2023-06-01T00:00:00Z"),
      f("old.ysm", 10, "2019-01-01T00:00:00Z"),
      f("mid.ysm", 10, "2021-01-01T00:00:00Z"),
    ];
    expect(getDefaultKeepIdx(files, "oldest", "")).toBe(1);
  });

  it("modTime 缺失者（null）不抢真正最老的席位", () => {
    // 有真实时间戳的文件才是「最早修改」，缺失者（null）不参与时间裁决
    const files = [f("no-time.ysm", 10), f("real-old.ysm", 10, "2018-01-01T00:00:00Z")];
    expect(getDefaultKeepIdx(files, "oldest", "")).toBe(1);
  });

  it("modTime 全缺失 → 首项（全 null 时严格 < 保序兜底）", () => {
    const files = [f("a.ysm", 10), f("b.ysm", 20)];
    expect(getDefaultKeepIdx(files, "oldest", "")).toBe(0);
  });

  it("modTime 非法字符串按缺失处理", () => {
    const files = [f("bad.ysm", 10, "not-a-date"), f("ok.ysm", 10, "2018-01-01T00:00:00Z")];
    expect(getDefaultKeepIdx(files, "oldest", "")).toBe(1);
  });
});

describe("getDefaultKeepIdx — newest 策略", () => {
  it("保留最新修改的文件", () => {
    const files = [
      f("old.ysm", 10, "2019-01-01T00:00:00Z"),
      f("new.ysm", 10, "2023-06-01T00:00:00Z"),
      f("mid.ysm", 10, "2021-01-01T00:00:00Z"),
    ];
    expect(getDefaultKeepIdx(files, "newest", "")).toBe(1);
  });

  it("modTime 用数字时间戳与 ISO 字符串等价", () => {
    const iso = [f("a.ysm", 10, "2020-01-01T00:00:00Z"), f("b.ysm", 10, "2021-01-01T00:00:00Z")];
    const num = [f("a.ysm", 10, 1577836800000), f("b.ysm", 10, 1609459200000)];
    expect(getDefaultKeepIdx(iso, "newest", "")).toBe(getDefaultKeepIdx(num, "newest", ""));
    expect(getDefaultKeepIdx(num, "newest", "")).toBe(1);
  });

  it("modTime 缺失者（null）不抢真正最新的席位（P0 修复：2026-09 语义收口）", () => {
    // toTimestamp 缺失/非法返回 null（「无时间信息」），不参与时间裁决；
    // 有真实时间戳的文件才是「最新修改」，缺失者不该被选中。
    // 2026-09 修复前行为：toTimestamp 缺失返回 MAX_SAFE_INTEGER，newest 取最大值 → 无时间信息
    // 反被判为「最新」，与「视为最老」意图相悖（Go 扫描恒带回 modTime，故生产不可达）。
    const files = [f("real-new.ysm", 10, "2023-06-01T00:00:00Z"), f("no-time.ysm", 10)];
    expect(getDefaultKeepIdx(files, "newest", "")).toBe(0);
  });

  it("modTime 全缺失 → 首项（全 null 时严格 > 保序兜底）", () => {
    const files = [f("a.ysm", 10), f("b.ysm", 20)];
    expect(getDefaultKeepIdx(files, "newest", "")).toBe(0);
  });
});

describe("getDefaultKeepIdx — path 策略", () => {
  it("优先保留路径前缀匹配项", () => {
    const files = [
      f("ysm/keep/win.ysm", 10, "2020-01-01T00:00:00Z"),
      f("ysm/other/a.ysm", 999, "2020-01-01T00:00:00Z"),
    ];
    expect(getDefaultKeepIdx(files, "path", "ysm/keep")).toBe(0);
  });

  it("前缀匹配大小写不敏感（双侧 toLowerCase）", () => {
    const files = [
      f("YSM/Keep/Win.ysm", 10, "2020-01-01T00:00:00Z"),
      f("other/big.ysm", 999, "2020-01-01T00:00:00Z"),
    ];
    expect(getDefaultKeepIdx(files, "path", "ysm/keep")).toBe(0);
  });

  it("优先路径未命中 → 回退保留最大文件", () => {
    const files = [f("a.ysm", 10, "2020-01-01T00:00:00Z"), f("b.ysm", 999, "2020-01-01T00:00:00Z")];
    expect(getDefaultKeepIdx(files, "path", "nope/missing")).toBe(1);
  });

  it("priorityPath 为空串 → 直接回退保留最大文件（不做空前缀全匹配）", () => {
    const files = [f("a.ysm", 10, "2020-01-01T00:00:00Z"), f("b.ysm", 999, "2020-01-01T00:00:00Z")];
    expect(getDefaultKeepIdx(files, "path", "")).toBe(1);
  });

  it("多个前缀命中 → 取首个", () => {
    const files = [f("keep/a.ysm", 10, "2020-01-01T00:00:00Z"), f("keep/b.ysm", 999, "2020-01-01T00:00:00Z")];
    expect(getDefaultKeepIdx(files, "path", "keep")).toBe(0);
  });
});

describe("getDefaultKeepIdx — 默认分支", () => {
  it("未知策略 → 保留最大文件", () => {
    const files = [f("small.ysm", 10, "2020-01-01T00:00:00Z"), f("big.ysm", 999, "2019-01-01T00:00:00Z")];
    for (const policy of ["", "largest", "whatever", "OLDEST"]) {
      expect(getDefaultKeepIdx(files, policy, "")).toBe(1);
    }
  });

  it("大小写敏感：\"OLDEST\" 不命中 oldest 分支（case 精确匹配）", () => {
    // 构造「可判别」样例：时间最老者 size 最小 → 两条分支各自给出不同索引
    const files = [
      f("old-small.ysm", 10, "2019-01-01T00:00:00Z"),
      f("new-big.ysm", 999, "2023-06-01T00:00:00Z"),
    ];
    expect(getDefaultKeepIdx(files, "oldest", "")).toBe(0); // 真命中 oldest → 按时间取最早
    expect(getDefaultKeepIdx(files, "OLDEST", "")).toBe(1); // 未命中 → 默认分支按 size 取最大
  });
});
