// @vitest-environment node
// ===== 创意工坊渲染层纯函数测试（ADR-023 L3）=====
import { formatBytes } from "@/utils/format/format.ts";
import { describe, it, expect } from "vitest";
import {
  isModelMissing,
  countMissing,
  filterModels,
  type WorkshopModel,
} from "./render.ts";

const local = new Map([
  ["角色A.ysm", "hash-a"],
  ["角色B.ysm", "hash-b"],
]);

describe("isModelMissing", () => {
  it("本地有同名 → 不缺失", () => {
    expect(isModelMissing({ name: "角色A.ysm", path: "x" }, local)).toBe(false);
  });
  it("本地有同哈希（不同名）→ 不缺失", () => {
    expect(
      isModelMissing({ name: "改名.ysm", path: "x", hash: "hash-b" }, local),
    ).toBe(false);
  });
  it("本地无 → 缺失", () => {
    expect(isModelMissing({ name: "角色C.ysm", path: "x" }, local)).toBe(true);
  });
  it("有 hash 但本地无匹配 → 缺失", () => {
    // 同名也不在本地、hash 也不匹配 → 缺失
    expect(
      isModelMissing({ name: "角色C.ysm", path: "x", hash: "hash-zzz" }, local),
    ).toBe(true);
  });
  it("同名在本地但 hash 不匹配 → 不缺失（name 优先）", () => {
    expect(
      isModelMissing({ name: "角色A.ysm", path: "x", hash: "hash-zzz" }, local),
    ).toBe(false);
  });
  it("空模型 → 缺失", () => {
    expect(isModelMissing(null, local)).toBe(true);
  });
});

describe("countMissing", () => {
  it("统计缺失数量", () => {
    const models = [
      { name: "角色A.ysm", path: "a" },
      { name: "角色C.ysm", path: "c" },
    ];
    expect(countMissing(models, local)).toBe(1);
  });
});

describe("formatBytes (community)", () => {
  it("0 → 空串", () => expect(formatBytes(0)).toBe(""));
  it("字节", () => expect(formatBytes(512)).toBe("512 B"));
  it("KB", () => expect(formatBytes(2048)).toBe("2.0 KB"));
  it("MB 保留一位", () => expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB"));
});

describe("filterModels", () => {
  const models: WorkshopModel[] = [
    { name: "角色A.ysm", path: "a", size: 1 },
    { name: "角色B.ysm", path: "b", size: 2 },
    { name: "怪物X.ysm", path: "c", size: 3 },
  ];
  // 仅 角色A 在本地（其余缺失）
  const partial = new Map([["角色A.ysm", "hash-a"]]);

  it("showAll=true 返回全部（含本地已有）", () => {
    expect(filterModels(models, "", true, partial)).toHaveLength(3);
  });

  it("showAll=false 只返回缺失项", () => {
    const r = filterModels(models, "", false, partial);
    expect(r.map((m) => m.name)).toEqual(["角色B.ysm", "怪物X.ysm"]);
  });

  it("关键词大小写不敏感", () => {
    const r = filterModels(models, " 角色 ", true, partial);
    expect(r.map((m) => m.name)).toEqual(["角色A.ysm", "角色B.ysm"]);
  });

  it("关键词 + 仅缺失叠加", () => {
    const r = filterModels(models, "角色", false, partial);
    expect(r.map((m) => m.name)).toEqual(["角色B.ysm"]);
  });
});

describe("WeakMap 惰性缓存（O(N+M) 收益锁 — render.ts hashSetOf 契约）", () => {
  /** 计数 values() 遍历：hashSetOf 若退化为每次判定重建 hash Set（或 WeakMap 缓存被删），
   *  计数将随判定次数线性膨胀——本锁让 O(N×M) 回归立刻变红 */
  class CountingMap extends Map<string, string> {
    valuesCalls = 0;
    override values(): MapIterator<string> {
      this.valuesCalls += 1;
      return super.values();
    }
  }

  it("同一 localMap 实例 N 次判定 → values() 仅遍历 1 次（N×M → N+M）", () => {
    const local = new CountingMap([
      ["a.ysm", "h1"],
      ["b.ysm", "h2"],
    ]);
    for (let i = 0; i < 100; i++) {
      isModelMissing({ name: `m${i}`, path: "x", hash: "h1" }, local);
    }
    expect(local.valuesCalls, "100 次判定只建一次 hash Set（退化为逐次构建则为 100）").toBe(1);
  });

  it("独立 localMap 实例各建各的缓存（WeakMap 按实例隔离，互不串用）", () => {
    const a = new CountingMap([["a.ysm", "h1"]]);
    const b = new CountingMap([["a.ysm", "h1"]]);
    isModelMissing({ name: "x", path: "x", hash: "h1" }, a);
    isModelMissing({ name: "x", path: "x", hash: "h1" }, b);
    expect(a.valuesCalls).toBe(1);
    expect(b.valuesCalls, "B 实例不复用 A 的缓存").toBe(1);
  });
});

