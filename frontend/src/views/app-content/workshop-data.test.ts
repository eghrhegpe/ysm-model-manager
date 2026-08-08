// ===== 创意工坊数据/工具测试 =====
// 覆盖：getCreatorIdentity 全部分支、getTagFromRole、parseDescTags、收藏 CRUD
import { describe, it, expect, beforeEach } from "vitest";
import {
  getCreatorIdentity,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
} from "./workshop-data.ts";
import { ICONS } from "../../utils/icon/workshop-icons.ts";

describe("getCreatorIdentity", () => {
  it("已知 role 映射到对应标签与图标", () => {
    expect(getCreatorIdentity({ role: "official" })).toEqual({
      label: "官方IP模型库", icon: ICONS.OFFICIAL, tag: "official",
    });
    expect(getCreatorIdentity({ role: "creator" })).toEqual({
      label: "YSM 创作者", icon: ICONS.CREATOR, tag: "creator",
    });
    expect(getCreatorIdentity({ role: "vup" })).toEqual({
      label: "VTuber 创作者", icon: ICONS.VUP, tag: "vup",
    });
    expect(getCreatorIdentity({ role: "repo" })).toEqual({
      label: "社区模型仓库", icon: ICONS.REPO, tag: "repo",
    });
    expect(getCreatorIdentity({ role: "oc" })).toEqual({
      label: "OC 原创角色", icon: ICONS.OC, tag: "oc",
    });
  });

  it("无 role 时从旧 tag 字段推断", () => {
    expect(getCreatorIdentity({ tag: "vup" })).toEqual({
      label: "VTuber 创作者", icon: ICONS.VUP, tag: "vup",
    });
    expect(getCreatorIdentity({ tag: "oc" })).toEqual({
      label: "OC 原创角色", icon: ICONS.OC, tag: "oc",
    });
    expect(getCreatorIdentity({ tag: "official" })).toEqual({
      label: "官方IP模型库", icon: ICONS.OFFICIAL, tag: "official",
    });
    expect(getCreatorIdentity({ tag: "repo" })).toEqual({
      label: "社区模型仓库", icon: ICONS.REPO, tag: "repo",
    });
  });

  it("未知 role/tag 回退 YSM 创作者", () => {
    expect(getCreatorIdentity({})).toEqual({
      label: "YSM 创作者", icon: ICONS.CREATOR, tag: "creator",
    });
    expect(getCreatorIdentity({ role: "unknown" })).toEqual({
      label: "YSM 创作者", icon: ICONS.CREATOR, tag: "creator",
    });
  });
});

describe("getTagFromRole", () => {
  it("有 role 返回 role，否则 creator", () => {
    expect(getTagFromRole("vup")).toBe("vup");
    expect(getTagFromRole(undefined)).toBe("creator");
    expect(getTagFromRole("")).toBe("creator");
  });
});

describe("parseDescTags", () => {
  it("空描述返回空数组", () => {
    expect(parseDescTags(undefined)).toEqual([]);
    expect(parseDescTags("")).toEqual([]);
  });

  it("按顿号/逗号切分、去空白、过滤空串", () => {
    expect(parseDescTags(" 模型、 捏人 , 皮肤 ，vup")).toEqual(["模型", "捏人", "皮肤", "vup"]);
  });

  it("最多保留 6 个标签", () => {
    const desc = Array.from({ length: 8 }, (_, i) => `tag${i}`).join("、");
    expect(parseDescTags(desc)).toHaveLength(6);
  });
});

describe("收藏工具", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loadFavs 空存储返回 []，损坏 JSON 返回 []", () => {
    expect(loadFavs()).toEqual([]);
    localStorage.setItem("ysm-fav-creators", "{bad json");
    expect(loadFavs()).toEqual([]);
  });

  it("toggleFav 添加/移除并持久化", () => {
    expect(toggleFav("alice")).toBe(true); // now faved
    expect(isFaved("alice")).toBe(true);
    expect(loadFavs()).toEqual(["alice"]);

    expect(toggleFav("alice")).toBe(false); // unfaved
    expect(isFaved("alice")).toBe(false);
    expect(loadFavs()).toEqual([]);
  });

  it("多个收藏按顺序追加", () => {
    toggleFav("a");
    toggleFav("b");
    expect(loadFavs()).toEqual(["a", "b"]);
  });
});
