// ===== 重命名文件名构建 + 校验纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import { buildRenameName, validateRenameFields, type RenameFields } from "./rename-format.ts";

const full: RenameFields = {
  author: "作者A",
  work: "作品X",
  chara: "角色",
  variant: "v2",
  date: "2024-05",
};

describe("buildRenameName", () => {
  it("全字段 → [作者]【作品】角色-变体 (年月).ext", () => {
    expect(buildRenameName(full, "ysm")).toBe("[作者A]【作品X】角色-v2 (2024-05).ysm");
  });

  it("品牌缺省为「未知」", () => {
    expect(buildRenameName({ ...full, work: "" }, "ysm")).toBe(
      "[作者A]【未知】角色-v2 (2024-05).ysm",
    );
  });

  it("角色缺省为「?」", () => {
    expect(buildRenameName({ ...full, chara: "" }, "ysm")).toBe(
      "[作者A]【作品X】?-v2 (2024-05).ysm",
    );
  });

  it("无变体/日期时不拼接", () => {
    const f = { author: "作者A", work: "作品X", chara: "角色", variant: "", date: "" };
    expect(buildRenameName(f, "zip")).toBe("[作者A]【作品X】角色.zip");
  });

  it("作者为空时不带括号", () => {
    expect(buildRenameName({ ...full, author: "" }, "ysm")).toBe(
      "【作品X】角色-v2 (2024-05).ysm",
    );
  });
});

describe("validateRenameFields", () => {
  it("合法字段返回 null", () => {
    expect(validateRenameFields(full, "ysm")).toBeNull();
  });

  it("作者为空报错", () => {
    expect(validateRenameFields({ ...full, author: "" }, "ysm")).toBe(
      "⚠️ 作者、角色名不能为空",
    );
  });

  it("角色为空报错", () => {
    expect(validateRenameFields({ ...full, chara: "" }, "ysm")).toBe(
      "⚠️ 作者、角色名不能为空",
    );
  });

  it("含非法字符报错", () => {
    expect(validateRenameFields({ ...full, work: "作<品" }, "ysm")).toContain(
      "文件名不能包含",
    );
    expect(validateRenameFields({ ...full, author: "a:b" }, "ysm")).toContain(
      "文件名不能包含",
    );
  });

  it("拼接后超过 255 字符报错", () => {
    const long: RenameFields = {
      author: "A".repeat(100),
      work: "B".repeat(100),
      chara: "C".repeat(100),
      variant: "",
      date: "",
    };
    const err = validateRenameFields(long, "ysm");
    expect(err).toContain("文件名过长");
  });

  it("恰好 255 字符合法", () => {
    // "[A]【W】c.ysm" 结构：固定部分 10 字符，角色名取 245 凑满 255
    const f: RenameFields = {
      author: "A",
      work: "W",
      chara: "C".repeat(245),
      variant: "",
      date: "",
    };
    expect(buildRenameName(f, "ysm").length).toBe(255);
    expect(validateRenameFields(f, "ysm")).toBeNull();
  });
});
