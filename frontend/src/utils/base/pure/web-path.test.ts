// @vitest-environment node
// ===== web-path.ts 网页版虚拟仓库路径解析（纯函数，零依赖）测试 =====
import { describe, it, expect } from "vitest";
import {
  isWebPath,
  parseWebPath,
  parseWebDirPath,
  webDirType,
} from "./web-path.ts";

describe("isWebPath — /web/ 前缀校验", () => {
  it("两段式 /web/<type>/<rest> 返回 true", () => {
    expect(isWebPath("/web/ysm/foo")).toBe(true);
    expect(isWebPath("/web/vrm/a/b/c")).toBe(true);
  });

  it("缺少 rest 段返回 false", () => {
    expect(isWebPath("/web/ysm")).toBe(false);
    expect(isWebPath("/web/")).toBe(false);
  });

  it("非 /web 前缀返回 false", () => {
    expect(isWebPath("/other/ysm/foo")).toBe(false);
    expect(isWebPath("web/ysm/foo")).toBe(false);
  });
});

describe("parseWebPath — {type, rest} 解析", () => {
  it("正常解析多段 rest", () => {
    expect(parseWebPath("/web/ysm/a/b/c")).toEqual({ type: "ysm", rest: "a/b/c" });
  });

  it("rest 单段", () => {
    expect(parseWebPath("/web/vrm/model")).toEqual({ type: "vrm", rest: "model" });
  });

  it("非 /web 或缺少 rest 返回 null", () => {
    expect(parseWebPath("/web/ysm")).toBeNull();
    expect(parseWebPath("/foo/bar/baz")).toBeNull();
  });
});

describe("parseWebDirPath — 目录形态 {type, name}", () => {
  it("末尾 / 被剥离", () => {
    expect(parseWebDirPath("/web/ysm/some/dir/")).toEqual({ type: "ysm", name: "some/dir" });
  });

  it("name 单段", () => {
    expect(parseWebDirPath("/web/fbx/model")).toEqual({ type: "fbx", name: "model" });
  });

  it("非 /web 返回 null", () => {
    expect(parseWebDirPath("/web/ysm")).toBeNull();
    expect(parseWebDirPath("/x/y/z")).toBeNull();
  });
});

describe("webDirType — 取 /web/ 之后类型段", () => {
  it("返回类型段", () => {
    expect(webDirType("/web/ysm/foo")).toBe("ysm");
  });

  it("非 /web 或仅 /web/ 返回 null", () => {
    expect(webDirType("/other/ysm")).toBeNull();
    expect(webDirType("/web/")).toBeNull();
  });
});
