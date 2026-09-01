// @vitest-environment node
// ===== 网页版 YSM 头部/摘要解析测试（ysm-header.ts 纯解析 + web-fs.ts binding 装配）=====
// 范式对齐 nbt-parse.test.ts / browser-adapter.test.ts：纯函数直测 + IDB mock 装配测。
// 头部用例镜像 go/ysm/header_test.go（scanHeader/AnalyzeYSMHeaderFromBytes 口径），
// 摘要用例镜像 go/ysm/summary_extract_test.go（zip 内 ysm.json / 降级扫描 / YSGP）。
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  parseYsmHeaderFromBytes,
  extractYsmSummaryFromBytes,
  emptyYsmHeader,
  emptyYsmSummary,
} from "./ysm-header.ts";

// idb 层内存实现：复用 test-setup 全局共享 store（isolate:false 穿透修复，
// 与 browser-adapter 系一致——per-file vi.mock 在共享模块图下会捕获错位绑定）
const idbMock = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbGetAll: Mock;
    idbDel: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;

import { browserAdapter, importWebFiles } from "./browser-adapter.ts";

const enc = new TextEncoder();

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  localStorage.clear();
});

/** 完整文本头部（镜像 header_test.go TestScanHeader_FullMetadata 输入） */
const FULL_HEADER = [
  "YSGP",
  "--- [Metadata]",
  "<name>TestModel</name>",
  "<free>true</free>",
  "<hash>abc123</hash>",
  "<license>CC-BY-SA</license>",
  "<link-home>https://example.com</link-home>",
  "<link_update>https://example.com/update</link_update>",
  "--- [Codec]",
  "<format>3</format>",
  "<crypto>1</crypto>",
  "--- [Tips]",
  "This is a tip line",
  "Another tip line",
  "--- [Authors]",
  "<name>AuthorName</name>",
  "<role>Modeler</role>",
  "<contact-Bilibili>https://b23.tv/xxx</contact-Bilibili>",
  "<contact-Afdian>https://afdian.net/xxx</contact-Afdian>",
  "===",
].join("\n");

// ===== parseYsmHeaderFromBytes（TS 平移 go/ysm/header.go scanHeader）=====

describe("parseYsmHeaderFromBytes — 文本头部扫描", () => {
  it("完整头部：metadata/codec/tips/authors 全字段解析（含 YSGP 合并路径）", () => {
    const h = parseYsmHeaderFromBytes(enc.encode(FULL_HEADER));
    expect(h.isYsm).toBe(true);
    expect(h.isFree).toBe(true);
    expect(h.hasFree).toBe(true);
    expect(h.name).toBe("TestModel");
    expect(h.hash).toBe("abc123");
    expect(h.license).toBe("CC-BY-SA");
    expect(h.linkHome).toBe("https://example.com");
    expect(h.linkUpdate).toBe("https://example.com/update");
    expect(h.format).toBe(3);
    expect(h.crypto).toBe(1);
    expect(h.tips).toBe("This is a tip line\nAnother tip line");
    expect(h.authorName).toBe("AuthorName");
    expect(h.authorRole).toBe("Modeler");
    expect(h.authorBilibili).toBe("https://b23.tv/xxx");
    expect(h.authorAfdian).toBe("https://afdian.net/xxx");
  });

  it("纯文本（无 YSGP 魔数）：isYsm=false 但 name/free 正常解析（对齐 Go TextOnly 用例）", () => {
    const h = parseYsmHeaderFromBytes(
      enc.encode("--- [Metadata]\n<name>TextOnly</name>\n<free>true</free>\n==="),
    );
    expect(h.isYsm).toBe(false);
    expect(h.name).toBe("TextOnly");
    expect(h.isFree).toBe(true);
    expect(h.hasFree).toBe(true);
  });

  it("无 <free> 标签：hasFree/isFree 均为 false", () => {
    const h = parseYsmHeaderFromBytes(enc.encode("YSGP\n--- [Metadata]\n<name>NoFree</name>\n==="));
    expect(h.hasFree).toBe(false);
    expect(h.isFree).toBe(false);
  });

  it("--- 无 [ 分隔符处停止扫描（二进制边界，不读后续行）", () => {
    const h = parseYsmHeaderFromBytes(
      enc.encode(
        "YSGP\n--- [Metadata]\n<name>BeforeBinary</name>\n------------------------------\nBINARYDATA should not be read\n<name>AfterBinary</name>\n",
      ),
    );
    expect(h.name).toBe("BeforeBinary");
    expect(h.name).not.toContain("AfterBinary");
  });

  it("前导注释行（// # ;）清理后作为 tips（无 Tips 段时）", () => {
    const h = parseYsmHeaderFromBytes(
      enc.encode("YSGP\n// A preamble comment\n# Another comment\n<name>Test</name>\n==="),
    );
    expect(h.tips).toContain("A preamble comment");
    expect(h.tips).toContain("Another comment");
  });

  it("BOM 前缀不影响解析（对齐 Go BOM 用例）", () => {
    const h = parseYsmHeaderFromBytes(enc.encode("\uFEFFYSGP\n--- [Metadata]\n<name>BOMTest</name>\n==="));
    expect(h.isYsm).toBe(true);
    expect(h.name).toBe("BOMTest");
  });

  it("YSGP 纯二进制（无文本头部特征）→ 仅 isYsm=true + format=2（简化深度解析）", () => {
    const bin = new Uint8Array([...enc.encode("YSGP"), 2, 0, 0, 0, 1, 2, 3, 4, 5]);
    const h = parseYsmHeaderFromBytes(bin);
    expect(h.isYsm).toBe(true);
    expect(h.format).toBe(2);
    expect(h.name).toBe("");
    expect(h.tips).toBeUndefined();
  });

  it("YSGP + 文本头部 → 合并文本段字段（isYsm/format 保留，name/license 来自文本）", () => {
    const h = parseYsmHeaderFromBytes(
      enc.encode("YSGP\n--- [Metadata]\n<name>MergedModel</name>\n<license>MIT</license>\n==="),
    );
    expect(h.isYsm).toBe(true);
    expect(h.format).toBe(2);
    expect(h.name).toBe("MergedModel");
    expect(h.license).toBe("MIT");
  });

  it("非 YSM → 空头部字段（isYsm false；无换行的裸文本按 Go 语义落入前导注释 tips）", () => {
    const h = parseYsmHeaderFromBytes(enc.encode("not a ysm file at all"));
    expect(h.isYsm).toBe(false);
    expect(h.name).toBe("");
    expect(h.authorName).toBeUndefined();
    expect(h.tips).toBe("not a ysm file at all"); // 对齐 Go scanHeader 前导行 → tips
  });

  it("空字节 → 全空 YSMHeader（不抛错）", () => {
    expect(parseYsmHeaderFromBytes(new Uint8Array(0))).toEqual(emptyYsmHeader());
  });
});

// ===== extractYsmSummaryFromBytes（TS 平移 go/ysm/summary.go ExtractYsmSummary）=====

describe("extractYsmSummaryFromBytes — 摘要提取", () => {
  const ysmJson = {
    spec: 1,
    metadata: {
      name: "角色A",
      tips: "介绍文字",
      license: { type: "CC-BY-SA" },
      authors: [{ name: "作者甲", role: "模型师", contact: { bilibili: "https://b23.tv/xxx" } }],
      link: { home: "https://example.com", donate: "https://afdian.net/x" },
    },
    properties: {
      default_texture: "textures/face.png",
      height_scale: 1.2,
      width_scale: 0.8,
      extra_animation_classify: [
        { id: "grp1", name: "表情组", extra_animation: { happy: "开心", sad: "难过" } },
      ],
      extra_animation_buttons: [{ id: "cfg1", name: "模型配置", config_forms: [{ type: "slider" }, { type: "toggle" }] }],
    },
    files: {
      player: {
        texture: ["textures/face.png", "textures/body.png"],
        animation: { a1: {}, a2: {} },
        model: [{ path: "models/main.json" }],
      },
    },
  };

  it("zip 内 ysm.json：metadata/stats/preview/动画分组/配置菜单全字段", () => {
    const zipBytes = zipSync({
      "ysm.json": strToU8(JSON.stringify(ysmJson)),
      "models/main.json": strToU8(
        JSON.stringify({ "minecraft:geometry": [{ description: { texture_width: 64, texture_height: 128 } }] }),
      ),
      "textures/face.png": strToU8("PNG"),
    });
    const s = extractYsmSummaryFromBytes(zipBytes, "角色.ysm");
    expect(s.schema).toBe("ysm-summary/v1");
    expect(s.source).toBe("角色.ysm");
    expect(s.format).toBe("ysm");
    expect(s.spec).toBe(1);
    expect(s.name).toBe("角色A");
    expect(s.tips).toBe("介绍文字");
    expect(s.license).toBe("CC-BY-SA");
    expect(s.authors).toEqual([{ name: "作者甲", roles: "模型师", bilibili: "https://b23.tv/xxx" }]);
    expect(s.links).toEqual({ home: "https://example.com", donate: "https://afdian.net/x" });
    // stats：textures=2、animations=2（对象键数）、models=1、texWidth/Height 来自几何体 JSON
    expect(s.stats).toEqual({ textures: 2, models: 1, animations: 2, texWidth: 64, texHeight: 128 });
    expect(s.preview).toMatchObject({ defaultTexture: "textures/face.png", heightScale: 1.2, widthScale: 0.8 });
    expect(s.animGroups).toEqual([{ id: "grp1", name: "表情组", items: ["开心", "难过"] }]);
    expect(s.configMenus).toEqual([
      { id: "cfg1", name: "模型配置", controls: ["slider", "toggle"] },
    ]);
  });

  it("zip 内 ysm.json tips 超过 200 字符 → 截断补 ...（对齐 Go zip 分支 truncate）", () => {
    const longTips = "字".repeat(250);
    const zipBytes = zipSync({ "ysm.json": strToU8(JSON.stringify({ metadata: { name: "长介绍", tips: longTips } })) });
    const s = extractYsmSummaryFromBytes(zipBytes, "长.ysm");
    expect(s.tips).toBe("字".repeat(200) + "...");
  });

  it("zip 无 ysm.json → 降级扫描：format=zip、name=去扩展名、几何/动画/贴图计数", () => {
    const zipBytes = zipSync({
      "models/main.json": strToU8('{"minecraft:geometry":[]}'),
      "models/animation.json": strToU8("{}"),
      "textures/skin.png": strToU8("PNG"),
      "textures/face.jpg": strToU8("JPG"),
    });
    const s = extractYsmSummaryFromBytes(zipBytes, "角色.ysm");
    expect(s.format).toBe("zip");
    expect(s.name).toBe("角色");
    expect(s.stats).toEqual({ textures: 2, models: 1, animations: 1, texWidth: 0, texHeight: 0 });
  });

  it("裸 ysm.json（source 以 .json 结尾）→ 直接解析 JSON", () => {
    const s = extractYsmSummaryFromBytes(
      enc.encode(JSON.stringify({ spec: 2, metadata: { name: "裸模型", license: { type: "MIT" } } })),
      "ysm.json",
    );
    expect(s.format).toBe("ysm");
    expect(s.spec).toBe(2);
    expect(s.name).toBe("裸模型");
    expect(s.license).toBe("MIT");
  });

  it("YSGP（V2）→ 基本摘要：name=去扩展名、spec=2、无 stats", () => {
    const s = extractYsmSummaryFromBytes(enc.encode("YSGP\n--- [Metadata]\n<name>MergedModel</name>\n==="), "模型.ysm");
    expect(s.format).toBe("ysm");
    expect(s.name).toBe("模型");
    expect(s.spec).toBe(2);
    expect(s.stats).toEqual({ textures: 0, models: 0, animations: 0, texWidth: 0, texHeight: 0 });
  });

  it("非 zip 文本头部 → 基本摘要（name/license/authorName/tips）", () => {
    const s = extractYsmSummaryFromBytes(
      enc.encode("--- [Metadata]\n<name>TextOnly</name>\n<license>MIT</license>\n--- [Authors]\n<name>作者乙</name>\n==="),
      "模型.ysm",
    );
    expect(s.name).toBe("TextOnly");
    expect(s.license).toBe("MIT");
    expect(s.authors).toEqual([{ name: "作者乙" }]);
    expect(s.stats).toEqual({ textures: 0, models: 0, animations: 0, texWidth: 0, texHeight: 0 });
  });

  it("非 zip 无头部 → name 回退去扩展名文件名", () => {
    const s = extractYsmSummaryFromBytes(enc.encode("garbage data"), "模型.ysm");
    expect(s.name).toBe("模型");
    expect(s.source).toBe("模型.ysm");
    expect(s.schema).toBe("ysm-summary/v1");
  });

  it("zip 内 ysm.json 畸形 → throw（装配层 catch → 最小空摘要）", () => {
    const zipBytes = zipSync({ "ysm.json": strToU8("{broken") });
    expect(() => extractYsmSummaryFromBytes(zipBytes, "坏.ysm")).toThrow("ysm.json");
  });
});

// ===== binding 装配（web-fs.ts webFsBindings → browserAdapter）=====

describe("ExtractYSMHeaderFromBase64 / ExtractYSMHeader binding", () => {
  it("ExtractYSMHeaderFromBase64：base64 → 文本头部字段（导入队列作者/tips 预填路径）", async () => {
    const h = await browserAdapter.ExtractYSMHeaderFromBase64(btoa(FULL_HEADER));
    expect(h.authorName).toBe("AuthorName");
    expect(h.tips).toBe("This is a tip line\nAnother tip line");
    expect(h.name).toBe("TestModel");
    expect(h.isYsm).toBe(true);
  });

  it("ExtractYSMHeaderFromBase64：非法 base64 → 空 YSMHeader（不 reject）", async () => {
    await expect(browserAdapter.ExtractYSMHeaderFromBase64("!!!invalid!!!")).resolves.toEqual(emptyYsmHeader());
  });

  it("ExtractYSMHeader：readWebFile → 头部（重命名对话框 tips 路径）", async () => {
    await importWebFiles([new File([enc.encode(FULL_HEADER)], "狐狸.ysm")], "ysm");
    const h = await browserAdapter.ExtractYSMHeader("/web/ysm/狐狸/狐狸.ysm");
    expect(h.isYsm).toBe(true);
    expect(h.authorName).toBe("AuthorName");
    expect(h.tips).toContain("This is a tip line");
  });

  it("ExtractYSMHeader：文件缺失 → 空 YSMHeader（不 reject）", async () => {
    await expect(browserAdapter.ExtractYSMHeader("/web/ysm/不存在/a.ysm")).resolves.toEqual(emptyYsmHeader());
  });
});

describe("ExtractYsmSummary binding", () => {
  it("zip 内容（.ysm 主文件整体入库）→ 摘要含 stats/license（详情卡恢复）", async () => {
    const zipBytes = zipSync({
      "ysm.json": strToU8(
        JSON.stringify({
          spec: 1,
          metadata: {
            name: "角色A",
            license: { type: "CC-BY-SA" },
            authors: [{ name: "作者甲" }],
          },
          files: { player: { texture: ["a.png", "b.png"], model: [{ path: "models/main.json" }] } },
        }),
      ),
      "models/main.json": strToU8('{"minecraft:geometry":[]}'),
    });
    await importWebFiles([new File([zipBytes], "角色.ysm")], "ysm");
    const s = await browserAdapter.ExtractYsmSummary("/web/ysm/角色/角色.ysm");
    expect(s.name).toBe("角色A");
    expect(s.license).toBe("CC-BY-SA");
    expect(s.stats).toEqual({ textures: 2, models: 1, animations: 0, texWidth: 0, texHeight: 0 });
    expect(s.authors).toEqual([{ name: "作者甲" }]);
  });

  it("文件缺失 → 最小空摘要（schema/source 保留，不 reject）", async () => {
    const s = await browserAdapter.ExtractYsmSummary("/web/ysm/不存在/角色.ysm");
    expect(s.schema).toBe("ysm-summary/v1");
    expect(s.source).toBe("角色.ysm");
    expect(s.name).toBe("");
    expect(s.stats).toEqual({ textures: 0, models: 0, animations: 0, texWidth: 0, texHeight: 0 });
  });

  it("zip 内 ysm.json 畸形 → 最小空摘要（消费方容错，不 reject）", async () => {
    const zipBytes = zipSync({ "ysm.json": strToU8("{broken") });
    await importWebFiles([new File([zipBytes], "坏.ysm")], "ysm");
    const s = await browserAdapter.ExtractYsmSummary("/web/ysm/坏/坏.ysm");
    expect(s.schema).toBe("ysm-summary/v1");
    expect(s.source).toBe("坏.ysm");
    expect(s.name).toBe("");
  });

  it("能力门控：三个 binding 已实现（'X' in browserAdapter → true，不再 fail-fast）", () => {
    expect("ExtractYSMHeader" in browserAdapter).toBe(true);
    expect("ExtractYSMHeaderFromBase64" in browserAdapter).toBe(true);
    expect("ExtractYsmSummary" in browserAdapter).toBe(true);
  });
});

describe("emptyYsmSummary — 最小空结构", () => {
  it("字段形状完整（消费方 stats?./authors?. 安全访问）", () => {
    const s = emptyYsmSummary("x.ysm");
    expect(s.schema).toBe("ysm-summary/v1");
    expect(s.source).toBe("x.ysm");
    expect(s.format).toBe("ysm");
    expect(s.preview).toEqual({ hasGui: false });
    expect(s.stats).toEqual({ textures: 0, models: 0, animations: 0, texWidth: 0, texHeight: 0 });
  });
});
