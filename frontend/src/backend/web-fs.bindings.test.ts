// ===== web-fs.ts binding 装配 + 扫描/重命名/删除/移动 集成测试（补盲区）=====
// 兄弟文件 web-fs.test.ts 只测 typeFromWebDir 纯函数；本文件用 test-setup 全局
// IDB 内存 store（__YSM_TEST_IDB__）直灌数据 + fflate 构造真实 zip，驱动
// webFsBindings 全部装配项与 scanWebModels/rekey 主链路（node 环境，无 DOM 依赖）。
// nbt-parse / voxel-parse 的 NBT 视图 mock 掉（纯解析层各有专属测试），锁 web-fs 的
// 装配与失败契约（"{}" / "[]" / {"error"}）；zip 类路径走真实 extractZip/pack-meta。
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  webFsBindings,
  scanWebModels,
  scanAllWebModels,
  collectAllWebEntries,
  readWebFile,
} from "./web-fs.ts";
import { dirKey, fileKey } from "./web-fs-shared.ts";
import { MAX_IMPORT_BYTES } from "./web-common.ts";
import { __setStatsRunnerForTest } from "./web-stats.ts";
import { emptyYsmHeader, emptyYsmSummary } from "../parsers/ysm-header.ts";
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };

// ── NBT 解析/视图 mock（web-fs 只做装配，解析层不在此验证）──
const nbtp = vi.hoisted(() => ({
  parseNbtRoot: vi.fn(),
  parseNbtRootExact: vi.fn(),
  litematicMetaView: vi.fn(),
  nbtStructureView: vi.fn(),
  schematicSummaryView: vi.fn(),
}));
vi.mock("../parsers/nbt-parse.ts", () => nbtp);
const vox = vi.hoisted(() => ({
  decodeVoxelNbt: vi.fn(),
  nbtVoxelView: vi.fn(),
  litematicVoxelView: vi.fn(),
  schematicVoxelView: vi.fn(),
}));
vi.mock("../parsers/voxel-parse.ts", () => vox);

// ── IDB 内存 store（test-setup 全局共享）──
const idb = (globalThis as unknown as {
  __YSM_TEST_IDB__: {
    idbGet: Mock;
    idbSet: Mock;
    idbKeys: Mock;
    idbGetAll: Mock;
    idbDel: Mock;
    idbTx: Mock;
    _store: Map<string, unknown>;
  };
}).__YSM_TEST_IDB__;

const enc = new TextEncoder();
const PNG = enc.encode("PNGDATA");
/** 最小合法 Bedrock geometry（1 骨 1 立方，16×32 纹理） */
const GEO = JSON.stringify({
  "minecraft:geometry": [
    {
      description: { texture_width: 16, texture_height: 32 },
      bones: [{ name: "b", cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }],
    },
  ],
});
/** ysm.json manifest（声明 model/texture 契约，见 parse-ysm-json.ts） */
const MANIFEST = JSON.stringify({
  spec: 1,
  files: { player: { model: ["main"], texture: ["skin.png"] } },
});

/** Uint8Array → 独立 ArrayBuffer（store 里 data 必须是 ArrayBuffer，见 readWebFile 消费） */
function ab(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
async function seedFile(type: string, name: string, rel: string, bytes: Uint8Array, size = bytes.length) {
  await idb.idbSet("files", fileKey(type, name, rel), { data: ab(bytes), size });
}
/** 灌一个模型组：dir 元数据 + 全部文件（默认 addedAt 固定，供 ModTime 断言） */
async function seedGroup(type: string, name: string, files: Record<string, Uint8Array>, addedAt = 1700000000000) {
  await idb.idbSet("files", dirKey(type, name), { name, addedAt });
  for (const [rel, b] of Object.entries(files)) await seedFile(type, name, rel, b);
}
/** 灌 ban/tags 标记（key 契约：`ban:/web/<type>/<name>/<rel>`，见 rekey/delete 扫描前缀） */
async function seedMark(prefix: "ban" | "tags", type: string, name: string, rel: string, val: unknown = true) {
  await idb.idbSet("config", `${prefix}:/web/${type}/${name}/${rel}`, val);
}

beforeEach(() => {
  vi.clearAllMocks();
  idb._store.clear();
  localStorage.clear();
  __setStatsRunnerForTest(null);
});
afterEach(() => {
  __setStatsRunnerForTest(null);
});

// ===== §4 模型库扫描 =====
describe("scanWebModels 根扫描（模型组收敛主文件）", () => {
  it("根目录 /web/ysm：每组收敛一条主文件条目（Size 汇总 / ModTime=addedAt / Ext 小写）", async () => {
    await seedGroup("ysm", "模型A", {
      "模型A.ysm": enc.encode("YSMBYTES"),
      "tex/face.png": PNG,
      "a.json": enc.encode("{}"),
    });
    const entries = await scanWebModels("/web/ysm");
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.Name).toBe("模型A.ysm");
    expect(e.Size).toBe("YSMBYTES".length + PNG.length + "{}".length);
    expect(e.Path).toBe("/web/ysm/模型A/模型A.ysm");
    expect(e.Ext).toBe(".ysm");
    expect(e.ModTime).toBe(1700000000000);
    expect(e.Hash).toBe("");
    expect(e.HasTags).toBe(false);
    expect(e.subdir).toBe("");
  });

  it("主文件竞争：.ysm/.zip > ysm.json > 其他；嵌套 rel 不参与", async () => {
    await seedGroup("ysm", "组B", { "b.ysm": enc.encode("x"), "b.json": enc.encode("y"), "sub/c.ysm": enc.encode("z") });
    const entries = await scanWebModels("/web/ysm");
    expect(entries[0].Name).toBe("b.ysm");
    expect(entries[0].Size).toBe(3); // x + y + z 全部计入
  });

  it("孤儿 dir key（无合格主文件，如仅 a.json）→ 跳过；只有 .png 同样跳过", async () => {
    await seedGroup("ysm", "孤儿", { "a.json": enc.encode("{}") });
    await seedGroup("ysm", "仅纹理", { "a.png": PNG });
    expect(await scanWebModels("/web/ysm")).toEqual([]);
  });

  it("多段 name 提取 subdir 元数据（ADR-096：subdir 仅元数据，Path 不拼）", async () => {
    await seedGroup("ysm", "分类1/模型C", { "模型C.ysm": enc.encode("x") });
    const entries = await scanWebModels("/web/ysm");
    expect(entries[0].Name).toBe("模型C.ysm");
    expect(entries[0].subdir).toBe("分类1");
    expect(entries[0].Path).toBe("/web/ysm/分类1/模型C/模型C.ysm");
  });

  it("按名称 localeCompare 排序 + 尾部斜杠目录同样识别为根", async () => {
    await seedGroup("ysm", "乙", { "乙.ysm": enc.encode("x") });
    await seedGroup("ysm", "甲", { "甲.ysm": enc.encode("x") });
    const entries = await scanWebModels("/web/ysm/");
    // node ICU zh-CN 拼音序：甲(jia) < 乙(yi)
    expect(entries.map((e) => e.Name)).toEqual(["甲.ysm", "乙.ysm"]);
  });

  it("非根目录（模型组）扫描：列主文件 + 跳过辅助文件；目录无 dir key → []", async () => {
    await seedGroup("ysm", "组D", { "main.ysm": enc.encode("x"), "tex/face.png": PNG });
    const inGroup = await scanWebModels("/web/ysm/组D");
    expect(inGroup.map((e) => e.Name)).toEqual(["main.ysm"]);
    expect(inGroup[0].ModTime).toBe(1700000000000);
    expect(await scanWebModels("/web/ysm/不存在")).toEqual([]);
  });
});

describe("scanAllWebModels / collectAllWebEntries 全库聚合", () => {
  it("按 resource_types 全类型扫描并回解 {type,name,path}", async () => {
    await seedGroup("ysm", "模型A", { "模型A.ysm": enc.encode("x") });
    const all = await scanAllWebModels();
    expect(all).toEqual([{ type: "ysm", name: "模型A", path: "/web/ysm/模型A/模型A.ysm" }]);
    const entries = await collectAllWebEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].Name).toBe("模型A.ysm");
  });
});

// ===== §5 文件读取 =====
describe("readWebFile", () => {
  it("/web 路径 → base64；缺失 / 非 /web 路径 → null", async () => {
    await seedGroup("ysm", "组E", { "main.ysm": enc.encode("hello") });
    expect(await readWebFile("/web/ysm/组E/main.ysm")).toBe(btoa("hello"));
    expect(await readWebFile("/web/ysm/组E/缺.ysm")).toBeNull();
    expect(await readWebFile("/notweb/x")).toBeNull();
  });
});

// ===== §6 NBT meta / voxel（视图 mock，锁装配与失败契约）=====
describe("NBT meta 读取（ReadLitematicMeta / ReadNbtStructure / ReadSchematic）", () => {
  it("成功链：读文件 → parseNbtRoot → 视图 → typed 对象", async () => {
    await seedGroup("blueprint", "图A", { "a.litematic": enc.encode("nbt") });
    nbtp.parseNbtRoot.mockReturnValue({ tag: 1 });
    nbtp.litematicMetaView.mockReturnValue({ meta: 1 });
    const out = await webFsBindings.ReadLitematicMeta("/web/blueprint/图A/a.litematic");
    expect(out).toEqual({ meta: 1 });
    expect(nbtp.parseNbtRoot).toHaveBeenCalled();
  });

  it("失败契约：文件缺失 / 视图 null / 解析抛错 → null", async () => {
    expect(await webFsBindings.ReadLitematicMeta("/web/blueprint/图A/无.litematic")).toBeNull();
    await seedGroup("blueprint", "图A", { "a.litematic": enc.encode("nbt") });
    nbtp.parseNbtRoot.mockReturnValue({ tag: 1 });
    nbtp.litematicMetaView.mockReturnValue(null);
    expect(await webFsBindings.ReadNbtStructure("/web/blueprint/图A/a.litematic")).toBeNull();
    nbtp.parseNbtRoot.mockImplementation(() => {
      throw new Error("bad nbt");
    });
    expect(await webFsBindings.ReadSchematic("/web/blueprint/图A/a.litematic")).toBeNull();
  });
});

describe("voxel 读取（GetNbtVoxelData / GetSchematicVoxelData / GetLitematicVoxelData）", () => {
  it("成功链：decodeVoxelNbt → view → typed VoxelData", async () => {
    await seedGroup("litematic", "投A", { "a.litematic": enc.encode("nbt") });
    vox.decodeVoxelNbt.mockReturnValue({ tag: 1 });
    vox.litematicVoxelView.mockReturnValue({ blocks: 3 });
    const out = await webFsBindings.GetLitematicVoxelData("/web/litematic/投A/a.litematic");
    expect(out).toEqual({ blocks: 3 });
  });

  it("失败契约：缺文件 / 解码 null / 视图 null / 抛错 → null", async () => {
    expect(await webFsBindings.GetNbtVoxelData("/web/litematic/投A/无.litematic")).toBeNull();
    await seedGroup("litematic", "投A", { "a.litematic": enc.encode("nbt") });
    vox.decodeVoxelNbt.mockReturnValue(null);
    expect(await webFsBindings.GetNbtVoxelData("/web/litematic/投A/a.litematic")).toBeNull();
    vox.decodeVoxelNbt.mockReturnValue({ tag: 1 });
    vox.schematicVoxelView.mockReturnValue(null);
    expect(await webFsBindings.GetSchematicVoxelData("/web/litematic/投A/a.litematic")).toBeNull();
    vox.litematicVoxelView.mockImplementation(() => {
      throw new Error("view exploded");
    });
    expect(await webFsBindings.GetLitematicVoxelData("/web/litematic/投A/a.litematic")).toBeNull();
  });
});

// ===== §6.5 容器内条目枚举 + 体素读取（真实 zip）=====
describe("ListContainerEntries / GetVoxelDataInContainer", () => {
  it("枚举：扩展名白名单过滤 + 目录/穿越/反斜杠条目剔除 + 排序", async () => {
    await seedGroup("litematic", "包A", {
      "box.zip": ab2u8(zipSync({
        "dir/": strToU8(""),
        "b.nbt": enc.encode("nbt2"),
        "a.nbt": enc.encode("nbt1"),
        "c.txt": enc.encode("nope"),
        "../evil.nbt": enc.encode("bad"),
        "back\\slash.schematic": enc.encode("bad"),
        "sub/ok.schematic": enc.encode("fine"),
      })),
    });
    const path = "/web/litematic/包A/box.zip";
    const out = await webFsBindings.ListContainerEntries(path, "NBT, .schematic");
    expect(out).toEqual(["a.nbt", "b.nbt", "sub/ok.schematic"]);
    // 空白名单 → 放行全部安全条目
    const all = await webFsBindings.ListContainerEntries(path, "");
    expect(all).toContain("c.txt");
  });

  it("失败契约：缺文件 / 非 zip → []", async () => {
    expect(await webFsBindings.ListContainerEntries("/web/litematic/包A/无.zip", ".nbt")).toEqual([]);
    await seedGroup("litematic", "包A", { "坏.zip": enc.encode("not a zip") });
    expect(await webFsBindings.ListContainerEntries("/web/litematic/包A/坏.zip", ".nbt")).toEqual([]);
  });

  it("容器内体素：ext 分派视图 + 成功/缺条目/非法路径契约", async () => {
    const zip = zipSync({ "inner.nbt": enc.encode("nbt") });
    await seedGroup("litematic", "包B", { "box.zip": ab2u8(zip) });
    const path = "/web/litematic/包B/box.zip";
    vox.decodeVoxelNbt.mockReturnValue({ tag: 1 });
    vox.nbtVoxelView.mockReturnValue({ blocks: 1 });
    const out = await webFsBindings.GetVoxelDataInContainer(path, "inner.nbt", ".nbt");
    expect(out).toEqual({ blocks: 1 });
    expect(vox.nbtVoxelView).toHaveBeenCalled();
    // 非法条目路径（.. 穿越）→ null
    const bad = await webFsBindings.GetVoxelDataInContainer(path, "../x.nbt", ".nbt");
    expect(bad).toBeNull();
    // 容器内不存在该条目 → null
    vox.decodeVoxelNbt.mockReturnValue({ tag: 1 });
    const miss = await webFsBindings.GetVoxelDataInContainer(path, "没有.nbt", ".nbt");
    expect(miss).toBeNull();
  });
});

/** ArrayBuffer/Uint8Array 归一为可放进 zipSync 的 Uint8Array（zipSync 返回值可直接回灌） */
function ab2u8(buf: ArrayBuffer | Uint8Array<ArrayBuffer>): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

// ===== §7 pack/shaderpack meta（真实 zip + 真实 pack-meta 解析）=====
describe("ReadPackMeta / ReadShaderpackLang", () => {
  it("pack.mcmeta + pack.png → 元数据 + base64 缩略图", async () => {
    await seedGroup("resourcepack", "材质A", {
      "p.zip": ab2u8(zipSync({ "pack.mcmeta": strToU8('{"pack":{"pack_format":15,"description":"描述"}}'), "pack.png": PNG })),
    });
    const meta = await webFsBindings.ReadPackMeta("/web/resourcepack/材质A/p.zip");
    expect(meta?.pack_format).toBe(15);
    expect(meta?.description).toBe("描述");
    expect(meta?.thumbnail).toBe(`data:image/png;base64,${btoa("PNGDATA")}`);
  });

  it("失败契约：缺文件 / 无 mcmeta → null", async () => {
    expect(await webFsBindings.ReadPackMeta("/web/resourcepack/材质A/无.zip")).toBeNull();
    await seedGroup("resourcepack", "材质A", { "空.zip": ab2u8(zipSync({ "other.txt": strToU8("x") })) });
    expect(await webFsBindings.ReadPackMeta("/web/resourcepack/材质A/空.zip")).toBeNull();
  });

  it("光影包 lang 读取 + 失败契约 {name:\"\",entries:{}}", async () => {
    await seedGroup("shaderpack", "光影A", {
      "s.zip": ab2u8(zipSync({ "lang/en_us.lang": strToU8("key=value\n") })),
    });
    const lang = await webFsBindings.ReadShaderpackLang("/web/shaderpack/光影A/s.zip");
    expect(lang.entries).toEqual({ key: "value" });
    expect(await webFsBindings.ReadShaderpackLang("/web/shaderpack/光影A/无.zip")).toEqual(
      { name: "", entries: {} },
    );
  });
});

// ===== 资源包 3D（ListPackModels / Detail / ReadPackEntry）=====
describe("资源包 3D 装配", () => {
  it("ListPackModels：zip 全条目；缺文件 → []", async () => {
    await seedGroup("resourcepack", "包C", {
      "p.zip": ab2u8(zipSync({ "assets/m/models/block/a.json": strToU8("{}") })),
    });
    const path = "/web/resourcepack/包C/p.zip";
    expect(await webFsBindings.ListPackModels(path)).toEqual([
      "assets/m/models/block/a.json",
    ]);
    expect(await webFsBindings.ListPackModels("/web/resourcepack/包C/无.zip")).toEqual([]);
  });

  it("ListPackModelsDetail：assets/*/models/{block,item} 过滤 + cubes 计数 + 坏 JSON 容错", async () => {
    await seedGroup("resourcepack", "包D", {
      "p.zip": ab2u8(zipSync({
        "assets/m/models/block/a.json": strToU8('{"elements":[1,2,3]}'),
        "assets/m/models/item/b.json": strToU8("{bad json"),
        "assets/m/models/other/c.json": strToU8('{"elements":[1]}'),
        "textures/x.png": PNG,
      })),
    });
    const out = await webFsBindings.ListPackModelsDetail("/web/resourcepack/包D/p.zip");
    expect(out.total).toBe(2);
    expect(out.models).toEqual([
      { path: "assets/m/models/block/a.json", cubes: 3 },
      { path: "assets/m/models/item/b.json", cubes: 0 },
    ]);
    expect(await webFsBindings.ListPackModelsDetail("/web/resourcepack/包D/无.zip")).toEqual(
      { models: [], total: 0 },
    );
  });

  it("ReadPackEntry：命中 → base64；未命中/缺文件 → \"\"", async () => {
    await seedGroup("resourcepack", "包E", {
      "p.zip": ab2u8(zipSync({ "assets/a.json": strToU8("DATA") })),
    });
    const path = "/web/resourcepack/包E/p.zip";
    expect(await webFsBindings.ReadPackEntry(path, "assets/a.json")).toBe(btoa("DATA"));
    expect(await webFsBindings.ReadPackEntry(path, "没有.json")).toBe("");
    expect(await webFsBindings.ReadPackEntry("/web/resourcepack/包E/无.zip", "x")).toBe("");
  });
});

// ===== #5 Bedrock 预览 fallback 链 =====
describe("AnalyzeBedrockModel", () => {
  it(".zip：找 geometry JSON + 收集纹理/动画（textures/ 优先）", async () => {
    await seedGroup("fbx", "Zip模", {
      "z.zip": ab2u8(zipSync({
        "model.json": strToU8(GEO),
        "textures/skin.png": PNG,
        "root.png": PNG,
        "act.animation.json": strToU8('{"anim":1}'),
      })),
    });
    const m = await webFsBindings.AnalyzeBedrockModel("/web/fbx/Zip模/z.zip");
    expect(m.boneCount).toBe(1);
    expect(m.cubeCount).toBe(1);
    expect(m.texWidth).toBe(16);
    expect(m.texHeight).toBe(32);
    // 单 geometry 路径收集组内全部 .png（root.png + textures/skin.png）
    expect([...(m.textures as string[])].sort()).toEqual([
      `data:image/png;base64,${btoa("PNGDATA")}`,
      `data:image/png;base64,${btoa("PNGDATA")}`,
    ]);
    expect([...(m.textureNames as string[])].sort()).toEqual(["root", "skin"]);
    expect(m.animations).toEqual(['{"anim":1}']);
  });

  it(".zip：ysm.json manifest 声明序合并（models/ 前缀 + .json 候选回退）", async () => {
    await seedGroup("fbx", "Man模", {
      "m.zip": ab2u8(zipSync({
        "ysm.json": strToU8(MANIFEST),
        "models/main.json": strToU8(GEO),
        "textures/skin.png": PNG,
      })),
    });
    const m = await webFsBindings.AnalyzeBedrockModel("/web/fbx/Man模/m.zip");
    expect(m.boneCount).toBe(1);
    expect(m.textureNames).toEqual(["skin"]);
  });

  it(".zip：manifest 解析失败 → 降级单 geometry 路径", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedGroup("fbx", "Bad模", {
      "b.zip": ab2u8(zipSync({
        "ysm.json": strToU8("{bad"),
        "geo.json": strToU8(GEO),
        "textures/s.png": PNG,
      })),
    });
    const m = await webFsBindings.AnalyzeBedrockModel("/web/fbx/Bad模/b.zip");
    expect(m.boneCount).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it(".json（非 manifest）：扫组内 geometry + 组内 .png 纹理", async () => {
    await seedGroup("fbx", "Json模", {
      "model.json": enc.encode(GEO),
      "skin.png": PNG,
    });
    const m = await webFsBindings.AnalyzeBedrockModel("/web/fbx/Json模/model.json");
    expect(m.boneCount).toBe(1);
    expect(m.textures).toEqual([`data:image/png;base64,${btoa("PNGDATA")}`]);
    expect(m.textureNames).toEqual(["skin"]);
  });

  it(".json manifest：按声明序读组内 models/ 文件合并", async () => {
    await seedGroup("fbx", "JsonMan", {
      "ysm.json": enc.encode(MANIFEST),
      "models/main.json": enc.encode(GEO),
      "textures/skin.png": PNG,
    });
    const m = await webFsBindings.AnalyzeBedrockModel("/web/fbx/JsonMan/ysm.json");
    expect(m.boneCount).toBe(1);
    expect(m.textureNames).toEqual(["skin"]);
  });

  it("失败契约：.ysm 直通 / 缺文件 / 非 Bedrock JSON → {}", async () => {
    expect(await webFsBindings.AnalyzeBedrockModel("/web/ysm/A/a.ysm")).toEqual({});
    expect(await webFsBindings.AnalyzeBedrockModel("/web/fbx/A/无.zip")).toEqual({});
    await seedGroup("fbx", "空模", { "e.json": enc.encode('{"nope":true}') });
    expect(await webFsBindings.AnalyzeBedrockModel("/web/fbx/空模/e.json")).toEqual({});
  });
});

describe("AnalyzeBedrockModelEntry（zip 内单角色定位）", () => {
  const mk = async () => {
    await seedGroup("fbx", "组Z", {
      "z.zip": ab2u8(zipSync({
        "models/fox.json": strToU8(GEO),
        "textures/skin.png": PNG,
      })),
    });
    return "/web/fbx/组Z/z.zip";
  };
  it("全路径 / 文件名（含 .geo.json 归一）命中 + 纹理收集", async () => {
    const path = await mk();
    const hit = await webFsBindings.AnalyzeBedrockModelEntry(path, "models/fox.json");
    expect(hit.boneCount).toBe(1);
    expect(hit.textures).toHaveLength(1);
    const byBase = await webFsBindings.AnalyzeBedrockModelEntry(path, "fox");
    expect(byBase.boneCount).toBe(1);
  });
  it("失败契约：空 subPath / 非 zip / 未命中 → {}", async () => {
    const path = await mk();
    expect(await webFsBindings.AnalyzeBedrockModelEntry(path, "")).toEqual({});
    expect(await webFsBindings.AnalyzeBedrockModelEntry("/web/fbx/组Z/别的.json", "x")).toEqual({});
    expect(await webFsBindings.AnalyzeBedrockModelEntry(path, "不存在")).toEqual({});
  });
});

describe("FindPreviewImage / ExtractPreviewTexture", () => {
  it("FindPreviewImage：候选顺序 base.png > preview.png；无候选命中 → \"\"", async () => {
    await seedGroup("ysm", "组P", {
      "mod.ysm": enc.encode("x"),
      "preview.png": PNG,
    });
    const uri = await webFsBindings.FindPreviewImage("/web/ysm/组P/mod.ysm");
    expect(uri).toBe(`data:image/png;base64,${btoa("PNGDATA")}`);
    // 无任何候选 png 的组 → ""
    await seedGroup("ysm", "组Q", { "mod.ysm": enc.encode("x") });
    expect(await webFsBindings.FindPreviewImage("/web/ysm/组Q/mod.ysm")).toBe("");
  });

  it("ExtractPreviewTexture：zip 首张 textures/ PNG；json 扫组内 png；其余 → \"\"", async () => {
    await seedGroup("ysm", "组T", {
      "z.zip": ab2u8(zipSync({ "textures/a.png": PNG, "b.png": PNG })),
      "m.json": enc.encode("{}"),
      "cover.png": PNG,
    });
    expect(await webFsBindings.ExtractPreviewTexture("/web/ysm/组T/z.zip")).toBe(
      `data:image/png;base64,${btoa("PNGDATA")}`,
    );
    expect(await webFsBindings.ExtractPreviewTexture("/web/ysm/组T/m.json")).toBe(
      `data:image/png;base64,${btoa("PNGDATA")}`,
    );
    expect(await webFsBindings.ExtractPreviewTexture("/web/ysm/组T/mod.ysm")).toBe("");
  });
});

// ===== §8-14 重命名 / 删除 / 移动 / 复制 / 搜索 =====
describe("RenameDir（组级 rekey）", () => {
  it("成功：dir + file + ban/tags 全迁移，旧 key 消失，dir 元数据 name 同步", async () => {
    await seedGroup("ysm", "旧名", { "main.ysm": enc.encode("x") });
    await seedMark("ban", "ysm", "旧名", "main.ysm");
    await seedMark("tags", "ysm", "旧名", "main.ysm", ["a"]);
    await webFsBindings.RenameDir("/web/ysm/旧名", "新名");
    expect(await idb.idbGet("files", fileKey("ysm", "新名", "main.ysm"))).toBeDefined();
    expect(await idb.idbGet("config", "ban:/web/ysm/新名/main.ysm")).toBe(true);
    expect(await idb.idbGet("config", "tags:/web/ysm/新名/main.ysm")).toEqual(["a"]);
    expect(await idb.idbGet("files", dirKey("ysm", "旧名"))).toBeUndefined();
    // dir 元数据 name 已改 → 根扫描可见
    const list = await scanWebModels("/web/ysm");
    expect(list.map((x) => x.Name)).toEqual(["main.ysm"]);
  });

  it("多段 name：只替换末段保留父路径", async () => {
    await seedGroup("ysm", "分类1/狐狸", { "main.ysm": enc.encode("x") });
    await webFsBindings.RenameDir("/web/ysm/分类1/狐狸", "大猫");
    expect(await idb.idbGet("files", dirKey("ysm", "分类1/大猫"))).toBeDefined();
    expect(await idb.idbGet("files", dirKey("ysm", "分类1/狐狸"))).toBeUndefined();
  });

  it("校验：非 web 路径 / 非法名 / 目标已存在 / 源缺失 → reject", async () => {
    await seedGroup("ysm", "存在", { "main.ysm": enc.encode("x") });
    await expect(webFsBindings.RenameDir("/notweb/x", "y")).rejects.toThrow();
    await expect(webFsBindings.RenameDir("/web/ysm/存在", "a/b")).rejects.toThrow();
    await expect(webFsBindings.RenameDir("/web/ysm/存在", "..")).rejects.toThrow();
    await expect(webFsBindings.RenameDir("/web/ysm/不存在", "任意")).rejects.toThrow();
    // 目标已存在（重命名为现有组）
    await seedGroup("ysm", "另一个", { "m.ysm": enc.encode("x") });
    await expect(webFsBindings.RenameDir("/web/ysm/存在", "另一个")).rejects.toThrow();
    // 上面失败分支不得落库
    expect(await idb.idbGet("files", dirKey("ysm", "任意"))).toBeUndefined();
  });
});

describe("RenameFile（组内单文件 rekey）", () => {
  it("成功：文件 rekey + ban/tags 标记跟随 + 子目录 rel 保留", async () => {
    await seedGroup("ysm", "组R", { "tex/face.png": PNG });
    await seedMark("ban", "ysm", "组R", "tex/face.png");
    await webFsBindings.RenameFile("/web/ysm/组R/tex/face.png", "eye.png");
    expect(await idb.idbGet("files", fileKey("ysm", "组R", "tex/eye.png"))).toBeDefined();
    expect(await idb.idbGet("files", fileKey("ysm", "组R", "tex/face.png"))).toBeUndefined();
    expect(await idb.idbGet("config", "ban:/web/ysm/组R/tex/eye.png")).toBe(true);
    expect(await idb.idbGet("config", "ban:/web/ysm/组R/tex/face.png")).toBeUndefined();
  });

  it("同名（trim 归一后）→ no-op 成功不删数据", async () => {
    await seedGroup("ysm", "组R", { "a.png": PNG });
    await webFsBindings.RenameFile("/web/ysm/组R/a.png", " a.png ");
    expect(await idb.idbGet("files", fileKey("ysm", "组R", "a.png"))).toBeDefined();
  });

  it("校验：ysm.json 禁改 / 目标已存在 / 源缺失 / 非法名 → reject", async () => {
    await seedGroup("ysm", "组R", { "ysm.json": enc.encode("{}"), "a.png": PNG });
    await expect(webFsBindings.RenameFile("/web/ysm/组R/ysm.json", "b.json")).rejects.toThrow();
    await expect(webFsBindings.RenameFile("/web/ysm/组R/a.png", "ysm.json")).rejects.toThrow();
    await expect(webFsBindings.RenameFile("/web/ysm/组R/无.png", "b.png")).rejects.toThrow();
    await expect(webFsBindings.RenameFile("/notweb/a.png", "b.png")).rejects.toThrow();
    // ysm.json 禁改后原文件仍在
    expect(await idb.idbGet("files", fileKey("ysm", "组R", "ysm.json"))).toBeDefined();
  });
});

describe("MoveModelFile / CopyModelFile（组级 rekey）", () => {
  it("移动：整组迁移到目标文件夹（dst=Join(dstDir, Base(src))，多段组名取末段）", async () => {
    await seedGroup("ysm", "分类1/狐狸", { "main.ysm": enc.encode("x") });
    await seedMark("tags", "ysm", "分类1/狐狸", "main.ysm", ["t"]);
    await webFsBindings.MoveModelFile("/web/ysm/分类1/狐狸/main.ysm", "/web/ysm/作者A");
    expect(await idb.idbGet("files", dirKey("ysm", "作者A/狐狸"))).toBeDefined();
    expect(await idb.idbGet("files", fileKey("ysm", "作者A/狐狸", "main.ysm"))).toBeDefined();
    expect(await idb.idbGet("config", "tags:/web/ysm/作者A/狐狸/main.ysm")).toEqual(["t"]);
    expect(await idb.idbGet("files", dirKey("ysm", "分类1/狐狸"))).toBeUndefined();
  });

  it("复制：目标组存在且源组保留", async () => {
    await seedGroup("ysm", "源组", { "main.ysm": enc.encode("x") });
    await webFsBindings.CopyModelFile("/web/ysm/源组", "/web/ysm/作者B");
    expect(await idb.idbGet("files", dirKey("ysm", "作者B/源组"))).toBeDefined();
    expect(await idb.idbGet("files", dirKey("ysm", "源组"))).toBeDefined();
  });

  it("校验：非法源 / 源缺失 / 非法 dstDir / 目标已存在 / 自嵌套 → reject", async () => {
    await seedGroup("ysm", "源组", { "main.ysm": enc.encode("x") });
    await seedGroup("ysm", "作者B/源组", { "main.ysm": enc.encode("x") });
    await expect(webFsBindings.MoveModelFile("/notweb/x", "/web/ysm/作者B")).rejects.toThrow();
    await expect(webFsBindings.MoveModelFile("/web/ysm/不存在组", "/web/ysm/作者B")).rejects.toThrow();
    await expect(webFsBindings.MoveModelFile("/web/ysm/源组", "/notweb/dst")).rejects.toThrow();
    await expect(webFsBindings.MoveModelFile("/web/ysm/源组", "/web/ysm/作者B")).rejects.toThrow(); // 目标已存在
    await expect(webFsBindings.MoveModelFile("/web/ysm/源组", "/web/ysm/源组/sub")).rejects.toThrow(); // 自嵌套
    // 校验失败不落库
    expect(await idb.idbGet("files", dirKey("ysm", "作者B/不存在组"))).toBeUndefined();
  });
});

describe("DeleteResourcePack / RemoveDir", () => {
  it("删除整组：dir + file + ban/tags 标记全清；非 web 路径 reject", async () => {
    await seedGroup("ysm", "组X", { "main.ysm": enc.encode("x") });
    await seedMark("ban", "ysm", "组X", "main.ysm");
    await webFsBindings.DeleteResourcePack("/web/ysm/组X/main.ysm", "ysm");
    expect(await idb.idbGet("files", dirKey("ysm", "组X"))).toBeUndefined();
    expect(await idb.idbGet("files", fileKey("ysm", "组X", "main.ysm"))).toBeUndefined();
    expect(await idb.idbGet("config", "ban:/web/ysm/组X/main.ysm")).toBeUndefined();
    await expect(webFsBindings.DeleteResourcePack("/notweb/x", "ysm")).rejects.toThrow();
  });

  it("RemoveDir：目录形态路径删除；非法路径 reject", async () => {
    await seedGroup("ysm", "组Y", { "main.ysm": enc.encode("x") });
    await webFsBindings.RemoveDir("/web/ysm/组Y");
    expect(await idb.idbGet("files", dirKey("ysm", "组Y"))).toBeUndefined();
    await expect(webFsBindings.RemoveDir("/notweb/y")).rejects.toThrow();
  });
});

describe("CheckFileExists / GetPackInfo / ListAllFilePaths / 子目录映射", () => {
  it("CheckFileExists：file 命中 / dir 命中 / dir 前缀命中 / 缺失 / 非 web", async () => {
    await seedGroup("ysm", "分类1/组Z", { "main.ysm": enc.encode("x") });
    expect(await webFsBindings.CheckFileExists("/web/ysm/分类1/组Z/main.ysm")).toBe(true);
    expect(await webFsBindings.CheckFileExists("/web/ysm/分类1/组Z")).toBe(true);
    expect(await webFsBindings.CheckFileExists("/web/ysm/不存在组")).toBe(false);
    expect(await webFsBindings.CheckFileExists("/notweb/x")).toBe(false);
  });

  it("GetPackInfo：web 无 ysm-pack.json → 最小 PackInfo（name 取末段）", async () => {
    expect(await webFsBindings.GetPackInfo("/web/ysm/组名")).toEqual({ name: "组名", description: "" });
    expect(await webFsBindings.GetPackInfo("/web/ysm/分类/组名")).toEqual({ name: "组名", description: "" });
  });

  it("ListAllFilePaths：递归完整路径；子目录收敛子树；非 web → []", async () => {
    await seedGroup("ysm", "组L", { "main.ysm": enc.encode("x"), "tex/face.png": PNG });
    expect(await webFsBindings.ListAllFilePaths("/web/ysm/组L")).toEqual([
      "/web/ysm/组L/main.ysm",
      "/web/ysm/组L/tex/face.png",
    ]);
    expect(await webFsBindings.ListAllFilePaths("/web/ysm/组L/tex")).toEqual(["/web/ysm/组L/tex/face.png"]);
    expect(await webFsBindings.ListAllFilePaths("/notweb/x")).toEqual([]);
  });

  it("GetSubDirMap：resource_types 注册表派生（id → instanceDir）", async () => {
    const map = (await webFsBindings.GetSubDirMap()) as Record<string, string>;
    const rts = (resourceTypesJson as { resourceTypes: Array<{ id: string; instanceDir?: string }> }).resourceTypes;
    expect(Object.keys(map).sort()).toEqual(rts.map((r) => r.id).sort());
    const ep = rts.find((r) => r.id === "EntityPlayer");
    expect(map.EntityPlayer).toBe(ep?.instanceDir ?? "");
  });
});

describe("批量读取 / 根路径 / 类型识别 / YSM 头部摘要", () => {
  it("ReadFileBytesBatch / WithMeta：null 透传 + 并发读（缺失 → null）", async () => {
    await seedGroup("ysm", "组B", { "main.ysm": enc.encode("x") });
    expect(await webFsBindings.ReadFileBytesBatch(null)).toBeNull();
    const batch = (await webFsBindings.ReadFileBytesBatch([
      "/web/ysm/组B/main.ysm",
      "/web/ysm/组B/缺.ysm",
    ])) as Record<string, string | null>;
    expect(batch["/web/ysm/组B/main.ysm"]).toBe(btoa("x"));
    expect(batch["/web/ysm/组B/缺.ysm"]).toBeNull();
    expect(await webFsBindings.ReadFileBytesBatchWithMeta(null)).toBeNull();
    const meta = (await webFsBindings.ReadFileBytesBatchWithMeta(["/web/ysm/组B/main.ysm"])) as Record<
      string,
      { data: string | null; hash: string }
    >;
    expect(meta["/web/ysm/组B/main.ysm"]).toEqual({ data: btoa("x"), hash: "" });
  });

  it("GetRepoRoot / GetDefaultRepoRoot：rtype 含 / 替换为 _", async () => {
    expect(await webFsBindings.GetRepoRoot("a/b")).toBe("/web/a_b");
    expect(await webFsBindings.GetRepoRoot("ysm")).toBe("/web/ysm");
    expect(await webFsBindings.GetDefaultRepoRoot()).toBe("/web");
  });

  it("DetectContainerType：空串 / 超大 base64 / 非法 base64 → \"\"；指纹 zip → 类型", async () => {
    expect(await webFsBindings.DetectContainerType("")).toBe("");
    // 守卫上限对齐 MAX_IMPORT_BYTES 的 base64 长度（audit #1：探测上限=导入上限，
    // 50~100MB 合法 zip 不再误杀）；超限 1 字符即拒
    const maxB64 = Math.ceil(MAX_IMPORT_BYTES / 3) * 4;
    expect(await webFsBindings.DetectContainerType("A".repeat(maxB64 + 1))).toBe("");
    expect(await webFsBindings.DetectContainerType("!!!not-base64!!!")).toBe("");
    const zipB64 = btoa(String.fromCharCode(...new Uint8Array(zipSync({ "ysm.json": strToU8("{}") }))));
    expect(await webFsBindings.DetectContainerType(zipB64)).toBe("ysm");
  });

  it("DetectResourceType：扩展名直判 / zip 指纹 / 缺失 → \"\"", async () => {
    expect(await webFsBindings.DetectResourceType("/web/ysm/a.ysm")).toBe("ysm");
    expect(await webFsBindings.DetectResourceType("/web/litematic/a.litematic")).toBe("litematic");
    await seedGroup("ysm", "组F", { "mystery.zip": ab2u8(zipSync({ "ysm.json": strToU8("{}") })) });
    expect(await webFsBindings.DetectResourceType("/web/ysm/组F/mystery.zip")).toBe("ysm");
    expect(await webFsBindings.DetectResourceType("/web/ysm/组F/无.zip")).toBe("");
  });

  it("ExtractYSMHeader 系列：缺失 → 全空；垃圾字节 → 非 YSM（文本行落 tips，name 恒空）", async () => {
    expect(await webFsBindings.ExtractYSMHeaderFromBase64("")).toEqual(emptyYsmHeader());
    const junk = await webFsBindings.ExtractYSMHeaderFromBase64(btoa("garbage"));
    expect(junk.isYsm).toBe(false);
    expect(junk.name).toBe("");
    expect(await webFsBindings.ExtractYSMHeader("/web/ysm/组G/无.ysm")).toEqual(emptyYsmHeader());
    await seedGroup("ysm", "组G", { "a.ysm": enc.encode("garbage") });
    const h = await webFsBindings.ExtractYSMHeader("/web/ysm/组G/a.ysm");
    expect(h.isYsm).toBe(false);
    expect(h.name).toBe("");
  });

  it("ExtractYsmSummary：缺文件 → 最小空摘要；裸 ysm.json → spec/name 契约", async () => {
    const miss = await webFsBindings.ExtractYsmSummary("/web/ysm/组S/无.ysm");
    expect(miss).toEqual(emptyYsmSummary("无.ysm"));
    await seedGroup("ysm", "组S", {
      "main.json": enc.encode(JSON.stringify({ spec: 7, metadata: { name: "狐狸" } })),
    });
    const s = await webFsBindings.ExtractYsmSummary("/web/ysm/组S/main.json");
    expect(s.source).toBe("main.json");
    expect((s as { spec?: number }).spec).toBe(7);
    expect((s as { name?: string }).name).toBe("狐狸");
  });
});

describe("SearchModels（关键词 + 数值范围）", () => {
  const seed = async () => {
    await seedGroup("ysm", "狐狸A", { "a.ysm": enc.encode("x") });
    await seedGroup("ysm", "狼B", { "b.ysm": enc.encode("x") });
  };
  it("关键词匹配 name OR path（大小写不敏感）；无数值条件快速路径", async () => {
    await seed();
    const hit = await webFsBindings.SearchModels("/web/ysm", "狐狸");
    expect((hit as { name: string }[]).map((r) => r.name)).toEqual(["a.ysm"]);
    const byPath = await webFsBindings.SearchModels("/web/ysm", "狼b");
    expect((byPath as { name: string }[]).map((r) => r.name)).toEqual(["b.ysm"]);
    const all = await webFsBindings.SearchModels("/web/ysm", "");
    expect((all as { boneCount: number }[]).every((r) => r.boneCount === 0)).toBe(true);
    const miss = await webFsBindings.SearchModels("/web/ysm", "猫");
    expect(miss).toEqual([]);
  });

  it("数值条件：min/max 骨骼过滤 + hasError 排除", async () => {
    await seed();
    __setStatsRunnerForTest(async (paths: string[]) =>
      paths.map((p) => ({
        boneCount: p.includes("狐狸") ? 10 : 2,
        cubeCount: 5,
        texWidth: 64,
        texHeight: 64,
        hasError: false,
      })),
    );
    const min = (await webFsBindings.SearchModels("/web/ysm", "", 5, 0, 0, 0, 0, 0)) as { name: string }[];
    expect(min.map((r) => r.name)).toEqual(["a.ysm"]);
    const max = (await webFsBindings.SearchModels("/web/ysm", "", 0, 5, 0, 0, 0, 0)) as { name: string }[];
    expect(max.map((r) => r.name)).toEqual(["b.ysm"]);
    const cubes = (await webFsBindings.SearchModels("/web/ysm", "", 0, 0, 6, 0, 0, 0)) as unknown[];
    expect(cubes).toEqual([]);
    const tex = (await webFsBindings.SearchModels("/web/ysm", "", 0, 0, 0, 0, 32, 128)) as { boneCount: number }[];
    expect(tex).toHaveLength(2);
    __setStatsRunnerForTest(async (paths: string[]) =>
      paths.map((p) => ({
        boneCount: 0,
        cubeCount: 0,
        texWidth: 0,
        texHeight: 0,
        hasError: p.includes("狐狸"),
      })),
    );
    const errFiltered = (await webFsBindings.SearchModels("/web/ysm", "", 1, 0, 0, 0, 0, 0)) as { name: string }[];
    expect(errFiltered).toEqual([]);
  });

  it("Worker 不可用（runner 返回 null / 抛错）→ 降级关键词匹配（数值 0）", async () => {
    await seed();
    __setStatsRunnerForTest(async () => null);
    const degraded = (await webFsBindings.SearchModels("/web/ysm", "狐狸", 1, 0, 0, 0, 0, 0)) as {
      name: string;
      boneCount: number;
      hasError: boolean;
    }[];
    expect(degraded.map((r) => r.name)).toEqual(["a.ysm"]);
    expect(degraded[0].boneCount).toBe(0);
    expect(degraded[0].hasError).toBe(false);
    __setStatsRunnerForTest(async () => {
      throw new Error("worker dead");
    });
    const degraded2 = (await webFsBindings.SearchModels("/web/ysm", "狼", 1, 0, 0, 0, 0, 0)) as { name: string }[];
    expect(degraded2.map((r) => r.name)).toEqual(["b.ysm"]);
  });
});

// ===== ScanModelEntriesFiltered rtype 白名单过滤（对齐 Go app_scan.go:328-376）=====
describe("ScanModelEntriesFiltered rtype 白名单过滤", () => {
  it("rtype 匹配 → 保留；rtype 不匹配 → 条目被滤（EntityPlayer 白名单滤掉 .ysm）", async () => {
    await seedGroup("ysm", "组A", { "main.ysm": enc.encode("x") });
    // 同型 rtype：ysm 白名单含 .ysm → 保留
    const keep = (await webFsBindings.ScanModelEntriesFiltered("/web/ysm/组A", "ysm", "", "ui")) as Array<{ Name: string }>;
    expect(keep.map((e) => e.Name)).toEqual(["main.ysm"]);
    // 异型 rtype：EntityPlayer 白名单(.pmx/.pmd/.vrm/.zip)不含 .ysm → 滤空
    const drop = (await webFsBindings.ScanModelEntriesFiltered("/web/ysm/组A", "EntityPlayer", "", "ui")) as Array<{ Name: string }>;
    expect(drop).toHaveLength(0);
  });

  it("rtype 空/未知 → 退化不过滤（对齐 Go：白名单为空时不过滤）", async () => {
    await seedGroup("ysm", "组A", { "main.ysm": enc.encode("x") });
    const empty = (await webFsBindings.ScanModelEntriesFiltered("/web/ysm/组A", "", "", "ui")) as Array<{ Name: string }>;
    expect(empty.map((e) => e.Name)).toEqual(["main.ysm"]);
    const unknown = (await webFsBindings.ScanModelEntriesFiltered("/web/ysm/组A", "no-such-type", "", "ui")) as Array<{ Name: string }>;
    expect(unknown.map((e) => e.Name)).toEqual(["main.ysm"]);
  });

  it("过滤命中条目填充 type 字段（对齐 Go e.Type = rtype）", async () => {
    await seedGroup("ysm", "组A", { "main.ysm": enc.encode("x") });
    const hit = (await webFsBindings.ScanModelEntriesFiltered("/web/ysm/组A", "ysm", "", "ui")) as Array<{ type?: string }>;
    expect(hit[0].type).toBe("ysm");
  });

  it("容器差异锁定：.zip 按扩展名白名单保留（web 不打开验真；Go 会打开容器指纹核验）", async () => {
    await seedGroup("EntityPlayer", "组B", { "m.zip": enc.encode("zip") });
    // EntityPlayer 白名单含 .zip → web 按扩展名保留（已知差异：Go containerCache 验真，
    // 内容非 EntityPlayer 会被剔除；web 暂不验真，差异由本契约测试钉死）
    const hit = (await webFsBindings.ScanModelEntriesFiltered("/web/EntityPlayer/组B", "EntityPlayer", "", "ui")) as Array<{ Name: string }>;
    expect(hit.map((e) => e.Name)).toEqual(["m.zip"]);
  });
});

describe("杂项装配", () => {
  it("ClearScanCache / InvalidateScanCache：网页版 no-op resolve", async () => {
    await expect(webFsBindings.ClearScanCache()).resolves.toBeUndefined();
    await expect(webFsBindings.InvalidateScanCache()).resolves.toBeUndefined();
  });

  it("ScanModelEntries 三入口与 ReadFileBytes 等价转发", async () => {
    await seedGroup("ysm", "组W", { "main.ysm": enc.encode("x") });
    expect(await webFsBindings.ScanModelEntries("/web/ysm/组W")).toHaveLength(1);
    expect(await webFsBindings.ScanModelEntriesWithLabel("/web/ysm/组W", "ui")).toHaveLength(1);
    expect(
      await webFsBindings.ScanModelEntriesFiltered("/web/ysm/组W", "ysm", "", "ui"),
    ).toHaveLength(1);
    expect(await webFsBindings.ReadFileBytes("/web/ysm/组W/main.ysm")).toBe(btoa("x"));
  });

  it("SaveScreenshotFile：触发浏览器下载（a.download/href/click 接线）", async () => {
    const clicks: unknown[] = [];
    const anchor = {
      download: "",
      href: "",
      click: () => clicks.push(1),
      remove: () => {},
    };
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: () => {} },
    });
    try {
      await webFsBindings.SaveScreenshotFile("shot.png", "QUJD");
      expect(anchor.download).toBe("shot.png");
      expect(anchor.href).toBe("data:image/png;base64,QUJD");
      expect(clicks).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ===== 防御分支补刀（失败契约的最后几条路）=====
describe("防御分支补刀", () => {
  it("容器枚举：无扩展名 / 绝对路径条目被安全过滤剔除", async () => {
    await seedGroup("litematic", "包G", {
      "g.zip": ab2u8(zipSync({ "noext": strToU8("x"), "/abs.nbt": strToU8("x"), "ok.nbt": strToU8("x") })),
    });
    const path = "/web/litematic/包G/g.zip";
    // 空白名单放行全部安全条目（含无点条目）
    const all = await webFsBindings.ListContainerEntries(path, "");
    expect(all).toEqual(["noext", "ok.nbt"]);
    // 非空白名单：无点条目 / 绝对路径条目被剔除
    const out = await webFsBindings.ListContainerEntries(path, ".nbt");
    expect(out).toEqual(["ok.nbt"]);
  });

  it("容器体素：容器文件缺失 / 解码 null / 视图 null / 视图抛错 → null", async () => {
    const zip = zipSync({ "inner.nbt": enc.encode("nbt") });
    await seedGroup("litematic", "包H", { "box.zip": ab2u8(zip) });
    const path = "/web/litematic/包H/box.zip";
    expect(await webFsBindings.GetVoxelDataInContainer("/web/litematic/包H/无.zip", "inner.nbt", ".nbt")).toBeNull();
    vox.decodeVoxelNbt.mockReturnValue(null);
    expect(await webFsBindings.GetVoxelDataInContainer(path, "inner.nbt", ".nbt")).toBeNull();
    vox.decodeVoxelNbt.mockReturnValue({ tag: 1 });
    vox.nbtVoxelView.mockReturnValue(null);
    expect(await webFsBindings.GetVoxelDataInContainer(path, "inner.nbt", ".nbt")).toBeNull();
    vox.nbtVoxelView.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await webFsBindings.GetVoxelDataInContainer(path, "inner.nbt", ".nbt")).toBeNull();
  });

  it("pack/shader/models：坏 mcmeta / 非 zip 字节 → 各自失败契约", async () => {
    await seedGroup("resourcepack", "包I", {
      "坏mcmeta.zip": ab2u8(zipSync({ "pack.mcmeta": strToU8("{bad") })),
      "非zip.zip": enc.encode("plain bytes"),
    });
    const bad = "/web/resourcepack/包I/坏mcmeta.zip";
    const nz = "/web/resourcepack/包I/非zip.zip";
    expect(await webFsBindings.ReadPackMeta(bad)).toBeNull();
    expect(await webFsBindings.ReadPackMeta(nz)).toBeNull();
    expect(await webFsBindings.ReadShaderpackLang(nz)).toEqual({ name: "", entries: {} });
    expect(await webFsBindings.ListPackModels(nz)).toEqual([]);
    expect(await webFsBindings.ListPackModelsDetail(nz)).toEqual({ models: [], total: 0 });
    expect(await webFsBindings.ReadPackEntry(nz, "x")).toBe("");
    // 光影包：zip 无 lang 条目 → 空结构
    await seedGroup("shaderpack", "光影B", { "s.zip": ab2u8(zipSync({ "other.txt": strToU8("x") })) });
    expect(await webFsBindings.ReadShaderpackLang("/web/shaderpack/光影B/s.zip")).toEqual(
      { name: "", entries: {} },
    );
  });

  it("ListPackModelsDetail：assets 下无 /models/ 段的 json 不算模型条目", async () => {
    await seedGroup("resourcepack", "包J", {
      "p.zip": ab2u8(zipSync({ "assets/m/readme.json": strToU8("{}") })),
    });
    const out = await webFsBindings.ListPackModelsDetail("/web/resourcepack/包J/p.zip");
    expect(out.total).toBe(0);
  });

  it("ExtractPreviewTexture：zip 路径缺文件 → \"\"；非 zip 字节 → \"\"", async () => {
    expect(await webFsBindings.ExtractPreviewTexture("/web/ysm/组T/无.zip")).toBe("");
    await seedGroup("ysm", "组K", { "坏.zip": enc.encode("plain") });
    expect(await webFsBindings.ExtractPreviewTexture("/web/ysm/组K/坏.zip")).toBe("");
  });

  it("FindPreviewImage：非 web 相对路径（无斜杠）→ \"\"；组内无文件 → \"\"", async () => {
    expect(await webFsBindings.FindPreviewImage("mod.ysm")).toBe("");
    await idb.idbSet("files", dirKey("ysm", "空组"), { name: "空组", addedAt: 1 });
    expect(await webFsBindings.FindPreviewImage("/web/ysm/空组/mod.ysm")).toBe("");
  });

  it("manifest 合并：模型缺文件 / 无骨骼 / 重复项 / 纹理缺文件 → 降级或跳过", async () => {
    await seedGroup("fbx", "Man2", {
      "m.zip": ab2u8(zipSync({
        "ysm.json": strToU8(JSON.stringify({
          spec: 1,
          files: {
            player: {
              model: ["main", "main", "missing", "nobones"],
              texture: ["", "nope.png", "skin.png"],
            },
          },
        })),
        "models/nobones.json": strToU8('{"foo":1}'),
        "models/main.json": strToU8(GEO),
        "textures/skin.png": PNG,
      })),
    });
    const m = await webFsBindings.AnalyzeBedrockModel("/web/fbx/Man2/m.zip");
    // main 命中 1 骨；missing/nobones 走 continue；空纹理名跳过、缺纹理文件跳过
    expect(m.boneCount).toBe(1);
    expect(m.textureNames).toEqual(["skin"]);
  });

  it("SearchModels：maxCubes / minTex / maxTex 过滤", async () => {
    await seedGroup("ysm", "狐狸A", { "a.ysm": enc.encode("x") });
    __setStatsRunnerForTest(async (paths: string[]) =>
      paths.map(() => ({ boneCount: 10, cubeCount: 5, texWidth: 64, texHeight: 64, hasError: false })),
    );
    const noCubes = (await webFsBindings.SearchModels("/web/ysm", "", 0, 0, 0, 3, 0, 0)) as unknown[];
    expect(noCubes).toEqual([]);
    const noTex = (await webFsBindings.SearchModels("/web/ysm", "", 0, 0, 0, 0, 65, 0)) as unknown[];
    expect(noTex).toEqual([]);
    const hiTex = (await webFsBindings.SearchModels("/web/ysm", "", 0, 0, 0, 0, 0, 32)) as unknown[];
    expect(hiTex).toEqual([]);
    const ok = (await webFsBindings.SearchModels("/web/ysm", "", 0, 0, 0, 5, 64, 64)) as unknown[];
    expect(ok).toHaveLength(1);
  });

  it("RenameDir：空白名 → reject；rekey 中途写失败 → 回滚新 key 且源完好", async () => {
    await seedGroup("ysm", "组M", { "main.ysm": enc.encode("x") });
    await expect(webFsBindings.RenameDir("/web/ysm/组M", "   ")).rejects.toThrow();
    // rekey 阶段一按 store 收敛为 idbTx 单事务：让 files 事务抛错 → catch 走 rollback
    // （原注入点 idbSet 已不适用于 idbTx 批量提交，改注入事务失败）
    idb.idbTx.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    await expect(webFsBindings.RenameDir("/web/ysm/组M", "组N")).rejects.toThrow("disk full");
    expect(await idb.idbGet("files", dirKey("ysm", "组M"))).toBeDefined();
    expect(await idb.idbGet("files", dirKey("ysm", "组N"))).toBeUndefined();
    expect(await idb.idbGet("files", fileKey("ysm", "组M", "main.ysm"))).toBeDefined();
  });

  it("MoveModelFile：目标位于源子目录（startsWith 分支）→ reject", async () => {
    await seedGroup("ysm", "组S2", { "main.ysm": enc.encode("x") });
    await expect(webFsBindings.MoveModelFile("/web/ysm/组S2", "/web/ysm/组S2/sub")).rejects.toThrow();
  });

  it("ExtractYsmSummary：zip 头垃圾字节 → 兜底最小空摘要（1342 catch 契约）", async () => {
    await seedGroup("ysm", "组S3", { "bad.ysm": enc.encode("PK\x03\x04garbage-not-a-zip") });
    const s2 = await webFsBindings.ExtractYsmSummary("/web/ysm/组S3/bad.ysm");
    expect((s2 as { source?: string }).source).toBe("bad.ysm");
    expect((s2 as { schema?: string }).schema).toBe("ysm-summary/v1");
  });

  it("FSA 包装：无 showDirectoryPicker → authState=unsupported / SelectLocalRepo reject", async () => {
    await expect(webFsBindings.GetFsaAuthState()).resolves.toBe("unsupported");
    await expect(webFsBindings.SelectLocalRepo()).rejects.toThrow();
  });
});

// ===== parseWebModelPath 精确探测 + 回退语义（P0-2 优化回归锁）=====
// 优化前：每个路径解析都全库扫 dir: 前缀（O(全库)）；优化后：先按路径段前缀
// 精确探测 dir key（O(1)），全 miss 才回退全库反查（兼容"name 边界不确定"的模糊输入）。
// 本 describe 经 ListAllFilePaths（listWebModelDirFiles → parseWebModelPath 链路）间接锁定：
//   ① 精确路径 → 命中（不依赖全库反查路径，且命中 dir key 探测）
//   ② 模糊子目录（组内 rel 子树）→ 回退语义仍工作
//   ③ 模型组不存在 / 非 web → null（不误命中）
describe("parseWebModelPath 精确探测 + 回退语义（经 ListAllFilePaths 间接）", () => {
  it("精确模型路径：单段 name", async () => {
    await seedGroup("ysm", "组P", { "main.ysm": enc.encode("x"), "tex/face.png": PNG });
    expect(await webFsBindings.ListAllFilePaths("/web/ysm/组P")).toEqual([
      "/web/ysm/组P/main.ysm",
      "/web/ysm/组P/tex/face.png",
    ]);
  });

  it("精确模型路径：多段 name（目录树，name=分类1/组Q）", async () => {
    await seedGroup("ysm", "分类1/组Q", { "main.ysm": enc.encode("x") });
    // 整组：name=分类1/组Q，rel=""
    expect(await webFsBindings.ListAllFilePaths("/web/ysm/分类1/组Q")).toEqual([
      "/web/ysm/分类1/组Q/main.ysm",
    ]);
  });

  it("模糊子目录：rel 子树（组内 tex/）回退语义仍收敛", async () => {
    await seedGroup("ysm", "组R", { "main.ysm": enc.encode("x"), "tex/face.png": PNG });
    // /web/ysm/组R/tex 不是 dir key 精确边界 → 走回退反查，收敛到 rel=tex 子树
    expect(await webFsBindings.ListAllFilePaths("/web/ysm/组R/tex")).toEqual([
      "/web/ysm/组R/tex/face.png",
    ]);
  });

  it("模型组不存在 / 非 web → 不误命中", async () => {
    await seedGroup("ysm", "组S", { "main.ysm": enc.encode("x") });
    expect(await webFsBindings.ListAllFilePaths("/web/ysm/不存在组")).toEqual([]);
    expect(await webFsBindings.ListAllFilePaths("/notweb/x")).toEqual([]);
  });

  it("精确路径解析不依赖全库 dir 扫描（idbKeys 调用次数受控）", async () => {
    // 灌入多个不相关模型组，确保精确路径命中走 O(1) 探测而非全库反查
    await seedGroup("ysm", "无关A", { "a.ysm": enc.encode("x") });
    await seedGroup("ysm", "无关B", { "b.ysm": enc.encode("x") });
    await seedGroup("ysm", "目标组", { "main.ysm": enc.encode("x") });
    const keysBefore = idb.idbKeys.mock.calls.length;
    expect(await webFsBindings.ListAllFilePaths("/web/ysm/目标组")).toEqual([
      "/web/ysm/目标组/main.ysm",
    ]);
    // 精确命中路径：不应触发 dir: 前缀全库扫描（仅 file: 前缀枚举）
    const newCalls = idb.idbKeys.mock.calls.slice(keysBefore);
    expect(newCalls.some((c) => c[1] === "dir:ysm/")).toBe(false);
  });
});

// ===== scanWebModelGroups 批量收敛（P0-1 性能语义锁）=====
// 优化后：根扫描 = 2 次前缀批量操作（dir + file，各 1 次事务），不再逐组 get /
// 逐文件 get。本 describe 断言 IDB 调用次数受控，防回归到 N+1 串行查询。
describe("scanWebModels 根扫描批量收敛（P0-1）", () => {
  it("多模型组：idbGetAll 前缀批量取，不逐组逐文件 get", async () => {
    await seedGroup("ysm", "组1", { "a.ysm": enc.encode("x"), "tex/p.png": PNG });
    await seedGroup("ysm", "组2", { "b.ysm": enc.encode("y") });
    await seedGroup("ysm", "分类1/组3", { "c.ysm": enc.encode("z"), "tex/q.png": PNG });
    idb.idbKeys.mockClear();
    idb.idbGet.mockClear();
    idb.idbGetAll.mockClear();

    const entries = await scanWebModels("/web/ysm");
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.Name).sort()).toEqual(["a.ysm", "b.ysm", "c.ysm"]);

    // 前缀批量：dir + file 各一次 getAll（或 keys）；不出现逐组/逐文件的 get
    const getAllCalls = idb.idbGetAll.mock.calls;
    expect(getAllCalls.some((c) => c[1] === "dir:ysm/")).toBe(true);
    expect(getAllCalls.some((c) => c[1] === "file:ysm/")).toBe(true);
    // 不逐文件 get（file: 前缀的 idbGet 调用应为 0——dir meta 也走 getAll 了）
    const fileGets = idb.idbGet.mock.calls.filter((c) => String(c[1]).startsWith("file:"));
    expect(fileGets).toHaveLength(0);
  });

  it("多段 name（目录树）分组正确：文件归入完整 name 组", async () => {
    await seedGroup("ysm", "分类1/模型C", { "模型C.ysm": enc.encode("x") });
    await seedGroup("ysm", "分类2/模型D", { "模型D.ysm": enc.encode("y") });
    const entries = await scanWebModels("/web/ysm");
    expect(entries).toHaveLength(2);
    const paths = entries.map((e) => e.Path).sort();
    expect(paths).toEqual([
      "/web/ysm/分类1/模型C/模型C.ysm",
      "/web/ysm/分类2/模型D/模型D.ysm",
    ]);
    // 分组不串：组1 的文件不落入组2
    expect(entries.find((e) => e.Path.includes("模型C"))?.Size).toBe("x".length);
    expect(entries.find((e) => e.Path.includes("模型D"))?.Size).toBe("y".length);
  });

  it("同首段不同子组：分桶后前缀匹配正确，不串组", async () => {
    // 两个组共享首段"分类"，但子组不同
    await seedGroup("ysm", "分类/组A", { "a.ysm": enc.encode("aaa"), "tex/a.png": PNG });
    await seedGroup("ysm", "分类/组B", { "b.ysm": enc.encode("bbb"), "tex/b.png": PNG });
    await seedGroup("ysm", "其他/组C", { "c.ysm": enc.encode("ccc") });
    const entries = await scanWebModels("/web/ysm");
    expect(entries).toHaveLength(3);
    // 每个组的主文件和大小应正确对应
    const byPath = Object.fromEntries(entries.map((e) => [e.Path, e]));
    expect(byPath["/web/ysm/分类/组A/a.ysm"]?.Size).toBe("aaa".length + PNG.length);
    expect(byPath["/web/ysm/分类/组B/b.ysm"]?.Size).toBe("bbb".length + PNG.length);
    expect(byPath["/web/ysm/其他/组C/c.ysm"]?.Size).toBe("ccc".length);
    // 主文件正确：组A选 a.ysm（rank 3），组B选 b.ysm，组C选 c.ysm
    expect(byPath["/web/ysm/分类/组A/a.ysm"].Name).toBe("a.ysm");
    expect(byPath["/web/ysm/分类/组B/b.ysm"].Name).toBe("b.ysm");
    expect(byPath["/web/ysm/其他/组C/c.ysm"].Name).toBe("c.ysm");
  });

  it("大库场景：100 个单段组 + 50 个多段组，分桶后扫描正确且高效", async () => {
    // 创建 100 个单段组
    for (let i = 0; i < 100; i++) {
      await seedGroup("ysm", `组${i}`, { [`file${i}.ysm`]: enc.encode(`data${i}`) });
    }
    // 创建 50 个多段组（共享首段"分类"）
    for (let i = 0; i < 50; i++) {
      await seedGroup("ysm", `分类/子组${i}`, { [`sub${i}.ysm`]: enc.encode(`subdata${i}`) });
    }
    idb.idbGetAll.mockClear();
    const entries = await scanWebModels("/web/ysm");
    expect(entries).toHaveLength(150);
    // 验证 getAll 调用次数：dir + file 各 1 次（共 2 次）
    const getAllCalls = idb.idbGetAll.mock.calls;
    expect(getAllCalls).toHaveLength(2);
    expect(getAllCalls.some((c) => c[1] === "dir:ysm/")).toBe(true);
    expect(getAllCalls.some((c) => c[1] === "file:ysm/")).toBe(true);
  });
});
