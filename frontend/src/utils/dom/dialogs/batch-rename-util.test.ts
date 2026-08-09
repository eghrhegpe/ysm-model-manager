// ===== batch-rename-util 纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import { rebuildParsedName, applyReplaceToName } from "./batch-rename-util.ts";
import type { ParsedModelName } from "../../dom/display.ts";

const mkParsed = (over: Partial<ParsedModelName> = {}): ParsedModelName => ({
  raw: "",
  isBanned: false,
  author: "",
  work: "",
  chara: "",
  character: "",
  date: "",
  ext: "ysm",
  ...over,
});

describe("rebuildParsedName", () => {
  it("完整字段重建：作者/作品/角色/日期", () => {
    const p = mkParsed({ author: "作者", work: "作品", chara: "角色", date: "2024-01" });
    expect(rebuildParsedName("[作者]【作品】角色 (2024-01).ysm", p)).toBe(
      "[作者]【作品】角色 (2024-01).ysm",
    );
  });

  it("作者空值跳过该段", () => {
    const p = mkParsed({ work: "作品", chara: "角色" });
    expect(rebuildParsedName("【作品】角色.ysm", p)).toBe("【作品】角色.ysm");
  });

  it("作品空值跳过该段（批量语义：无「未知」缺省）", () => {
    const p = mkParsed({ author: "作者", chara: "角色" });
    expect(rebuildParsedName("[作者]角色.ysm", p)).toBe("[作者]角色.ysm");
  });

  it("日期空值跳过", () => {
    const p = mkParsed({ author: "作者", work: "作品", chara: "角色" });
    expect(rebuildParsedName("[作者]【作品】角色.ysm", p)).toBe("[作者]【作品】角色.ysm");
  });

  it("解析失败（p 全空）时角色回退到剥扩展名的文件名，保持原名", () => {
    const p = mkParsed();
    expect(rebuildParsedName("foo.ysm", p)).toBe("foo.ysm");
  });

  it("banned 文件保留 .ban 尾缀，且角色名不残留 .ysm", () => {
    // P2 回归：原实现 ext 取 "ban"、角色名残留 ".ysm"
    const p = mkParsed({ author: "作者", work: "作品", chara: "角色" });
    expect(rebuildParsedName("[作者]【作品】角色.ysm.ban", p)).toBe(
      "[作者]【作品】角色.ysm.ban",
    );
  });

  it("banned 且解析失败时：先剥 .ban 再剥扩展名回退角色名", () => {
    // P2 回归：剥 .ban 顺序不可反，否则回退名残留 .ysm
    const p = mkParsed();
    expect(rebuildParsedName("foo.ysm.ban", p)).toBe("foo.ysm.ban");
  });

  it("扩展名保留原名（非 ysm 也保留）", () => {
    const p = mkParsed({ author: "作者", work: "作品", chara: "角色" });
    expect(rebuildParsedName("[作者]【作品】角色.json", p)).toBe("[作者]【作品】角色.json");
  });

  it("无扩展名时缺省 ysm", () => {
    const p = mkParsed({ author: "作者", work: "作品", chara: "角色" });
    expect(rebuildParsedName("[作者]【作品】角色", p)).toBe("[作者]【作品】角色.ysm");
  });

  it("overrides 覆盖解析结果（表单作者优先）", () => {
    const p = mkParsed({ author: "旧作者", work: "旧作品", chara: "角色", date: "2024-01" });
    expect(
      rebuildParsedName("[旧作者]【旧作品】角色 (2024-01).ysm", p, {
        author: "新作者",
        work: "新作品",
      }),
    ).toBe("[新作者]【新作品】角色 (2024-01).ysm");
  });

  it("override 为空字符串时回退解析值（.ban 尾缀完整保留）", () => {
    const p = mkParsed({ author: "作者", work: "作品", chara: "角色", date: "2024-01" });
    expect(
      rebuildParsedName("[作者]【作品】角色 (2024-01).ysm.ban", p, {
        author: "",
        work: "新作品",
      }),
    ).toBe("[作者]【新作品】角色 (2024-01).ysm.ban");
  });

  it("全空字段重建后不改变原名（幂等）", () => {
    const p = mkParsed();
    expect(rebuildParsedName("foo.ysm", p)).toBe("foo.ysm");
  });
});

describe("applyReplaceToName", () => {
  it("仅替换文件名主体，扩展名不动", () => {
    expect(applyReplaceToName("[作者]foo (1).ysm", "foo", "bar", false)).toEqual({
      newName: "[作者]bar (1).ysm",
      ok: true,
    });
  });

  it("替换为空串=删除", () => {
    expect(applyReplaceToName("[作者]foo.ysm", "foo", "", false)).toEqual({
      newName: "[作者].ysm",
      ok: true,
    });
  });

  it("正则替换（g 全量）", () => {
    expect(applyReplaceToName("foo-foo.ysm", "foo", "x", true)).toEqual({
      newName: "x-x.ysm",
      ok: true,
    });
  });

  it("正则无效时返回原样且 ok=false", () => {
    expect(applyReplaceToName("[作者]角色.ysm", "(", "x", true)).toEqual({
      newName: "[作者]角色.ysm",
      ok: false,
    });
  });

  it("空查找串返回原样 ok=true（调用方入口守卫）", () => {
    expect(applyReplaceToName("[作者]角色.ysm", "", "x", false)).toEqual({
      newName: "[作者]角色.ysm",
      ok: true,
    });
  });

  it("替换后主体为空时保留原主体（不产生空名）", () => {
    expect(applyReplaceToName("foo.ysm", "foo", "", false)).toEqual({
      newName: "foo.ysm",
      ok: true,
    });
  });

  it("查找串命中扩展名部分时不生效（扩展名已分离）", () => {
    expect(applyReplaceToName("foo.ysm", "ysm", "json", false)).toEqual({
      newName: "foo.ysm",
      ok: true,
    });
  });

  it("无扩展名的文件名整体替换", () => {
    expect(applyReplaceToName("foo", "foo", "bar", false)).toEqual({
      newName: "bar",
      ok: true,
    });
  });

  it("不区分大小写模式由调用方正则控制：默认区分", () => {
    expect(applyReplaceToName("[A]FOO.ysm", "foo", "bar", true)).toEqual({
      newName: "[A]FOO.ysm",
      ok: true,
    });
  });
});
