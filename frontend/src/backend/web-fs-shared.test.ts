// @vitest-environment node
// ===== web-fs-shared.ts 测试（补盲区：key 规约 + 主文件优先级）=====
// 叶子模块，无 IO；所有测试纯函数直接断言。
import { describe, it, expect } from "vitest";
import { dirKey, fileKey, mainFileRank, MAIN_FILE_RANK_YSM, MAIN_FILE_RANK_JSON, MAIN_FILE_RANK_TYPE, MAIN_FILE_RANK_NONE } from "./web-fs-shared.ts";

describe("dirKey / fileKey key 规约（对齐 MikuMikuAR ADR-177：dir:*: / file:*: 前缀）", () => {
  it("dirKey 以 dir: 开头、type/name 内联、冒号结尾", () => {
    expect(dirKey("ysm", "狐狸")).toBe("dir:ysm/狐狸:");
  });

  it("dirKey 支持多段 name（目录树）", () => {
    expect(dirKey("ysm", "分类1/狐狸")).toBe("dir:ysm/分类1/狐狸:");
  });

  it("fileKey 以 file: 开头、rel 尾随", () => {
    expect(fileKey("ysm", "狐狸", "狐狸.ysm")).toBe("file:ysm/狐狸/狐狸.ysm");
  });

  it("fileKey 支持组内子目录 rel", () => {
    expect(fileKey("ysm", "狐狸", "tex/face.png")).toBe("file:ysm/狐狸/tex/face.png");
  });
});

describe("mainFileRank 主文件优先级（注册表驱动）", () => {
  it(".ysm 为 YSM 主文件最高优先级", () => {
    expect(mainFileRank("狐狸.ysm")).toBe(MAIN_FILE_RANK_YSM);
  });

  it(".zip 与 .ysm 同级（ZIP 容器）", () => {
    expect(mainFileRank("狐狸.zip")).toBe(MAIN_FILE_RANK_YSM);
  });

  it("仅 ysm.json 是 JSON 主文件（动作 a.json 不是）", () => {
    expect(mainFileRank("ysm.json")).toBe(MAIN_FILE_RANK_JSON);
    expect(mainFileRank("a.json")).toBe(MAIN_FILE_RANK_NONE);
    expect(mainFileRank("models/main.json")).toBe(MAIN_FILE_RANK_NONE);
  });

  it("其他类型注册表扩展名（.pmx/.schematic/.litematic 等）为主文件", () => {
    expect(mainFileRank("角色.pmx")).toBe(MAIN_FILE_RANK_TYPE);
    expect(mainFileRank("结构.schematic")).toBe(MAIN_FILE_RANK_TYPE);
  });

  it("辅助文件（png/txt/未知扩展名）为 NONE", () => {
    expect(mainFileRank("tex/face.png")).toBe(MAIN_FILE_RANK_NONE);
    expect(mainFileRank("readme.txt")).toBe(MAIN_FILE_RANK_NONE);
    expect(mainFileRank("noext")).toBe(MAIN_FILE_RANK_NONE);
  });

  it("扩展名大小写不敏感", () => {
    expect(mainFileRank("狐狸.YSM")).toBe(MAIN_FILE_RANK_YSM);
    expect(mainFileRank("FOX.Zip")).toBe(MAIN_FILE_RANK_YSM);
  });

  it("带 .ban/.disabled 后缀仍按主文件判定（禁用判定在导入层）", () => {
    // 与实现注释一致：mainFileRank 不剥 .ban/.disabled
    expect(mainFileRank("狐狸.ysm.ban")).toBe(MAIN_FILE_RANK_NONE);
  });
});
