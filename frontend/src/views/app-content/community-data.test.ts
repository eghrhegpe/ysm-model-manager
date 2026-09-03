// @vitest-environment node
// ===== 创意工坊数据层纯函数测试 =====
// mergeCommunityCreators：新增/更新计数、字段补充、type 追加去重、_fromCommunity 标记。
// mergeCommunitySites：按 id 去重新增。
// fillSearch：{{q}} 替换为 encodeURIComponent 后的查询词。
import { describe, it, expect } from "vitest";
import {
  mergeCommunityCreators,
  dedupeCreators,
  mergeCommunitySites,
  fillSearch,
  type LocalCreator,
} from "./community-data.ts";
import type { WorkshopCreator, WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";

function localCreator(name: string, extra: Partial<LocalCreator> = {}): LocalCreator {
  return { name, type: "", ...extra } as LocalCreator;
}

function communityCreator(name: string, extra: Partial<WorkshopCreator> = {}): WorkshopCreator {
  return { name, ...extra } as WorkshopCreator;
}

describe("mergeCommunityCreators", () => {
  it("新创作者 → 追加并标记 _fromCommunity", () => {
    const local = [localCreator("A")];
    const r = mergeCommunityCreators(local, [
      communityCreator("A"),
      communityCreator("B"),
      communityCreator("C"),
    ]);
    expect(r.added).toBe(2);
    expect(r.updated).toBe(0);
    expect(local).toHaveLength(3);
    expect(local.find((c) => c.name === "B")?._fromCommunity).toBe(true);
  });

  it("已存在但缺字段 → 补充 desc/type/role 并计 updated", () => {
    const local = [localCreator("A")];
    const r = mergeCommunityCreators(local, [
      communityCreator("A", { desc: "描述", type: "bilibili", role: "作者" }),
    ]);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(1);
    expect(local[0].desc).toBe("描述");
    expect(local[0].type).toBe("bilibili");
    expect(local[0].role).toBe("作者");
  });

  it("字段已齐全 → 不重复更新", () => {
    const local = [localCreator("A", { desc: "有", type: "bilibili", role: "作者" })];
    const r = mergeCommunityCreators(local, [
      communityCreator("A", { desc: "有", type: "bilibili", role: "作者" }),
    ]);
    expect(r.updated).toBe(0);
  });

  it("type 已包含 → 不重复追加", () => {
    const local = [localCreator("A", { type: "bilibili;x" })];
    mergeCommunityCreators(local, [communityCreator("A", { type: "x" })]);
    expect(local[0].type).toBe("bilibili;x");
  });

  it("type 冲突（本地 bilibili / 社区 afdian）→ 分号段合并并计 updated", () => {
    // 领域语义：name 唯一身份，type 是多站点集合——同名不同站点应归一而非覆盖丢失
    const local = [localCreator("A", { type: "bilibili" })];
    const r = mergeCommunityCreators(local, [communityCreator("A", { type: "afdian" })]);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(1);
    expect(local[0].type).toBe("bilibili;afdian");
  });

  it("社区 type 多段 → 整段并入且不重复", () => {
    const local = [localCreator("A", { type: "bilibili" })];
    mergeCommunityCreators(local, [
      communityCreator("A", { type: "afdian;bilibili;x" }),
      communityCreator("A", { type: "x" }),
    ]);
    expect(local[0].type).toBe("bilibili;afdian;x");
    // 首条已并 afdian/x → 第二条无新段 → 总 updated 计 1
  });

  it("同名不同站点独立记录 → dedupe 归一并保留全部站点段", () => {
    const flat = [
      localCreator("狐狸", { type: "bilibili" }),
      localCreator("狐狸", { type: "afdian" }),
    ];
    const out = dedupeCreators(flat);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("bilibili;afdian");
  });

  it("dedupe 同一引用重复（多段 type 进多组）→ 保留一份", () => {
    const c = localCreator("A", { type: "bilibili;afdian" });
    const out = dedupeCreators([c, c, c]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("bilibili;afdian");
  });

  it("dedupe 无 name 条目跳过", () => {
    const out = dedupeCreators([{ type: "bilibili" } as LocalCreator]);
    expect(out).toHaveLength(0);
  });
});

describe("mergeCommunitySites", () => {
  it("按 id 去重：新 id 追加，重复 id 忽略", () => {
    const local: WorkshopSite[] = [{ id: "s1" } as WorkshopSite];
    const r = mergeCommunitySites(local, [
      { id: "s1" } as WorkshopSite,
      { id: "s2" } as WorkshopSite,
    ]);
    expect(r.added).toBe(1);
    expect(local).toHaveLength(2);
  });

  it("无 id 的社区条目跳过", () => {
    const local: WorkshopSite[] = [];
    const r = mergeCommunitySites(local, [{} as WorkshopSite]);
    expect(r.added).toBe(0);
  });
});

describe("fillSearch", () => {
  it("替换 {{q}} 为 encodeURIComponent 结果", () => {
    expect(fillSearch("search?q={{q}}", "猫娘 模型")).toBe(
      "search?q=%E7%8C%AB%E5%A8%98%20%E6%A8%A1%E5%9E%8B",
    );
  });

  it("多个 {{q}} 全部替换", () => {
    expect(fillSearch("{{q}}/{{q}}", "a")).toBe("a/a");
  });

  it("无占位符 → 原样返回", () => {
    expect(fillSearch("plain", "x")).toBe("plain");
  });
});
