// @vitest-environment node
// ===== 创意工坊数据/工具测试 =====
// 覆盖：getCreatorIdentity 全部分支、getTagFromRole、parseDescTags、收藏 CRUD
import { describe, it, expect, beforeEach } from "vitest";
import {
  getCreatorIdentity,
  getTagDisplayLabel,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
} from "./workshop-data.ts";
import { ICONS } from "@/utils/icon/workshop-icons.ts";

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

  it("role 优先于 tag（两者同时存在时按 role 判定）", () => {
    // role=official + tag=vup → role 分支命中，tag 不参与
    expect(getCreatorIdentity({ role: "official", tag: "vup" })).toEqual({
      label: "官方IP模型库", icon: ICONS.OFFICIAL, tag: "official",
    });
    // tag 无 role 时走 tag 推断
    expect(getCreatorIdentity({ tag: "official" })).toEqual({
      label: "官方IP模型库", icon: ICONS.OFFICIAL, tag: "official",
    });
  });

  it("tag=creator 不在显式推断分支 → 回退 YSM 创作者", () => {
    // tag 推断只覆盖 official/vup/oc/repo；creator 属默认回退（非 creator 分支）
    expect(getCreatorIdentity({ tag: "creator" })).toEqual({
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

  it("按顿号/全角逗号切分、去空白、过滤空串", () => {
    expect(parseDescTags(" 模型、 捏人 ， 皮肤 ，vup")).toEqual(["模型", "捏人", "皮肤", "vup"]);
  });

  it("ASCII 逗号不参与切分（英文描述不再被碎成标签）", () => {
    // 锐评 P0-3：逗号属正常句读——切碎会让详情层丢弃全文
    expect(parseDescTags("cool models, fast updates")).toEqual([]);
    // 顿号仍切分，段内夹带的 ASCII 逗号原样保留
    expect(parseDescTags(" 模型、 捏人 , 皮肤 ，vup")).toEqual(["模型", "捏人 , 皮肤", "vup"]);
  });

  it("单段描述不视为标签串（回退全文展示，不再吞成单个 #chip）", () => {
    expect(parseDescTags("模型")).toEqual([]);
    expect(parseDescTags("cool models fast updates")).toEqual([]);
  });

  it("短片段多段 → 仍按标签串渲染（内容以 chips 呈现，不丢文本）", () => {
    expect(parseDescTags("只玩模型，从不捏人")).toEqual(["只玩模型", "从不捏人"]);
  });

  it("超长段（>12 字符）判为普通描述 → 空数组（回退全文）", () => {
    expect(parseDescTags("这是一个相当长的描述片段超过上限、另一个也不短")).toEqual([]);
    expect(parseDescTags("a very long english sentence here、b")).toEqual([]);
  });

  it("段数 > 6 → 回退全文（不截断丢尾；复核 P1-2）", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `tag${i}`).join("、");
    // 原实现 slice(0,6) 让第 7/8 段在浮层静默消失（浮层「有片段即只渲染 chips」）
    expect(parseDescTags(eight)).toEqual([]);
    const six = Array.from({ length: 6 }, (_, i) => `tag${i}`).join("、");
    expect(parseDescTags(six)).toEqual(["tag0", "tag1", "tag2", "tag3", "tag4", "tag5"]);
  });
});

describe("getTagDisplayLabel（锐评 P0-4 / 复核 P1-3）", () => {
  it("已知 role → i18n label（与 getCreatorIdentity 单源）", () => {
    expect(getTagDisplayLabel("vup")).toBe("VTuber 创作者");
    expect(getTagDisplayLabel("oc")).toBe("OC 原创角色");
    expect(getTagDisplayLabel("official")).toBe("官方IP模型库");
    expect(getTagDisplayLabel("creator")).toBe("YSM 创作者");
  });

  it("未知 tag → 原样返回（不得冒充 YSM 创作者，否则文案与 data-tag 过滤语义不符）", () => {
    expect(getTagDisplayLabel("modeler")).toBe("modeler");
    expect(getTagDisplayLabel("custom-role")).toBe("custom-role");
  });

  it("空串入参 → 原样返回空串（锁定新出口的空值语义；签名不含 undefined，调用方须先经 getTagFromRole/cr.role 守卫）", () => {
    expect(getTagDisplayLabel("")).toBe("");
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
