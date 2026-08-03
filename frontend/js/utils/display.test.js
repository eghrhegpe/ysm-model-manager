import { describe, it, expect } from "vitest";
import { parseModelName } from "./display.ts";

describe("parseModelName", () => {
  it("parses [author]name.ysm", () => {
    const r = parseModelName("[作者A]角色模型.ysm");
    expect(r.author).toBe("作者A");
    expect(r.chara).toBe("角色模型");
    expect(r.ext).toBe("ysm");
  });

  it("parses [author]【work】name.ysm", () => {
    const r = parseModelName("[作者B]【作品X】角色.ysm");
    expect(r.author).toBe("作者B");
    expect(r.work).toBe("作品X");
    expect(r.chara).toBe("角色");
  });

  it("parses [[author]] double bracket", () => {
    const r = parseModelName("[[double]]角色.ysm");
    expect(r.author).toBe("double");
  });

  it("parses 《work》 guillemet", () => {
    const r = parseModelName("[作者C]《作品Y》角色.zip");
    expect(r.author).toBe("作者C");
    expect(r.work).toBe("作品Y");
    expect(r.ext).toBe("zip");
  });

  it("extracts year date", () => {
    const r = parseModelName("[作者]name2023.ysm");
    expect(r.date).toBe("2023");
  });

  it("extracts year-month date", () => {
    const r = parseModelName("[作者]name2023-05.ysm");
    expect(r.date).toBe("2023-05");
  });

  it("handles .ban suffix", () => {
    const r = parseModelName("[作者]name.ysm.ban");
    expect(r.isBanned).toBe(true);
    expect(r.raw).toBe("[作者]name.ysm.ban");
  });

  it("works without brackets", () => {
    const r = parseModelName("单纯文件名.7z");
    expect(r.author).toBe("");
    expect(r.chara).toBe("单纯文件名");
    expect(r.ext).toBe("7z");
  });

  it("underscores become spaces in chara", () => {
    const r = parseModelName("[作者]角色_变体.json");
    expect(r.chara).toBe("角色 变体");
  });

  it("empty author returns empty string", () => {
    const r = parseModelName("[][]name.ysm");
    expect(r.author).toBe("");
  });
});
