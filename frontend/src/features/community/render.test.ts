// ===== 创意工坊渲染层纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import {
  isModelMissing,
  countMissing,
  formatSize,
  filterModels,
  groupSites,
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

describe("formatSize", () => {
  it("0 → 空串", () => expect(formatSize(0)).toBe(""));
  it("字节", () => expect(formatSize(512)).toBe("512B"));
  it("KB", () => expect(formatSize(2048)).toBe("2KB"));
  it("MB 保留一位", () => expect(formatSize(5 * 1024 * 1024)).toBe("5.0MB"));
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

describe("groupSites", () => {
  it("按 group 分组，缺省 browse", () => {
    const g = groupSites([
      { label: "A", group: "search" },
      { label: "B" },
      { label: "C", group: "repo" },
    ]);
    expect(Object.keys(g).sort()).toEqual(["browse", "repo", "search"]);
    expect(g.search).toHaveLength(1);
    expect(g.browse).toHaveLength(1);
    expect(g.repo).toHaveLength(1);
  });
});
