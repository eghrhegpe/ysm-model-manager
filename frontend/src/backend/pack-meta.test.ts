// @vitest-environment node
// ===== 资源包/光影包详情 web 实现测试（ReadPackMeta / ReadShaderpackLang）=====
// TS 平移 go/packs/mcmeta.go：用 fflate zipSync 构造 zip → importWebFiles 落 IDB →
// browserAdapter.ReadPackMeta / ReadShaderpackLang 验证字段（成功路径 + 失败路径 "{}"）。
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { browserAdapter, importWebFiles } from "./browser-adapter.ts";

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

const enc = new TextEncoder();

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  localStorage.clear();
});

/** 构造 zip 文件并导入 IDB（zip 内无主文件扩展名 → 原 zip 整体当主文件，路径 /web/<type>/<name>/<name>.zip） */
async function importZip(name: string, entries: Record<string, string | Uint8Array>, type: string): Promise<string> {
  const bytes: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(entries)) {
    bytes[k] = typeof v === "string" ? strToU8(v) : v;
  }
  await importWebFiles([new File([zipSync(bytes)], name)], type);
  return `/web/${type}/${name.replace(/\.zip$/i, "")}/${name}`;
}

const packMeta = JSON.stringify({
  pack: {
    pack_format: 15,
    description: "测试资源包",
  },
});

describe("browserAdapter.ReadPackMeta — 资源包详情（TS 平移 go/packs/mcmeta.go）", () => {
  it("pack.mcmeta + pack.png → pack_format / description / thumbnail(base64 data URL)", async () => {
    const pngBytes = enc.encode("fake-png-data");
    const path = await importZip(
      "材质包.zip",
      { "pack.mcmeta": packMeta, "pack.png": pngBytes },
      "resourcepack",
    );
    const parsed = await browserAdapter.ReadPackMeta(path);
    expect(parsed).not.toBeNull();
    expect(parsed!.pack_format).toBe(15);
    expect(parsed!.description).toBe("测试资源包");
    expect(parsed!.thumbnail).toBe(`data:image/png;base64,${btoa("fake-png-data")}`);
  });

  it("description 支持文本组件数组（[{\"text\":...}] 含 extra 拼接）与对象形态（对齐 go Desc）", async () => {
    const arrPath = await importZip("数组.zip", {
      "pack.mcmeta": JSON.stringify({
        pack: {
          pack_format: 12,
          description: [{ text: "Hello " }, { text: "World", extra: [{ text: "!" }] }],
        },
      }),
    }, "resourcepack");
    const arrMeta = await browserAdapter.ReadPackMeta(arrPath);
    expect(arrMeta!.description).toBe("Hello World!");

    const objPath = await importZip("对象.zip", {
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 12, description: { text: "对象描述" } } }),
    }, "resourcepack");
    const objMeta = await browserAdapter.ReadPackMeta(objPath);
    expect(objMeta!.description).toBe("对象描述");
  });

  it("supported_formats / min_format / max_format 三种形态归一为 [min, max]（int / [int,int] / 对象）", async () => {
    const path = await importZip("格式.zip", {
      "pack.mcmeta": JSON.stringify({
        pack: {
          pack_format: 15,
          description: "x",
          supported_formats: [3, 7],
          min_format: { min_inclusive: 1, max_inclusive: 2 },
          max_format: 12,
        },
      }),
    }, "resourcepack");
    const meta = await browserAdapter.ReadPackMeta(path);
    expect(meta).not.toBeNull();
    expect(meta!.supported_formats).toEqual([3, 7]);
    expect(meta!.min_format).toEqual([1, 2]);
    expect(meta!.max_format).toEqual([12, 12]);
  });

  it("zip 内路径大小写不敏感（PACK.MCMETA 命中）+ BOM 剥离（对齐 go StripBOM）", async () => {
    const path = await importZip("大写.zip", {
      "PACK.MCMETA": "\uFEFF{\"pack\":{\"pack_format\":9,\"description\":\"bom\"}}",
    }, "resourcepack");
    const meta = await browserAdapter.ReadPackMeta(path);
    expect(meta).not.toBeNull();
    expect(meta!.pack_format).toBe(9);
    expect(meta!.description).toBe("bom");
  });

  it("无 pack.mcmeta 的 zip → null（对齐 Go ErrPackMetaNotFound → error 通道）", async () => {
    const path = await importZip("无meta.zip", { "readme.txt": "hello" }, "resourcepack");
    expect(await browserAdapter.ReadPackMeta(path)).toBeNull();
  });

  it("坏 zip（非 zip 内容）→ null（对齐 Go 打开失败 → error 通道）", async () => {
    const path = await importZip("坏包.zip", { "pack.mcmeta": "x" }, "resourcepack");
    // 覆盖 IDB 中内容为非 zip 字节：extractZip 抛错 → null
    idbMock.idbSet("files", "file:resourcepack/坏包/坏包.zip", {
      data: enc.encode("not a zip").buffer,
      size: 10,
    });
    expect(await browserAdapter.ReadPackMeta(path)).toBeNull();
  });

  it("文件不存在 → null", async () => {
    expect(await browserAdapter.ReadPackMeta("/web/resourcepack/不存在/a.zip")).toBeNull();
  });
});

describe("browserAdapter.ReadShaderpackLang — 光影包详情（TS 平移 go/packs/mcmeta.go）", () => {
  it("lang/en_US.lang → name（pack.name 优先）+ entries 全量 key=value", async () => {
    const path = await importZip("光影包.zip", {
      "lang/en_US.lang": "pack.name=光影测试包\ntitle=My Shader\nsome.key=任意值",
    }, "shaderpack");
    const meta = await browserAdapter.ReadShaderpackLang(path);
    expect(meta.name).toBe("光影测试包"); // pack.name 先命中，title 不再覆盖
    expect(meta.entries).toEqual({
      "pack.name": "光影测试包",
      title: "My Shader",
      "some.key": "任意值",
    });
  });

  it("小写 lang/en_us.lang 也命中（对齐 go zip 分支大小写双匹配）", async () => {
    const path = await importZip("小写光影.zip", {
      "lang/en_us.lang": "shaderpack.name=小写路径光影",
    }, "shaderpack");
    const meta = await browserAdapter.ReadShaderpackLang(path);
    expect(meta.name).toBe("小写路径光影");
  });

  it("# 注释 / 空行 / 无 = 行被跳过；a=b=c 值保留 = 后全部（对齐 go TrimSpace + Index 切分）", async () => {
    const path = await importZip("注释.zip", {
      "lang/en_US.lang": "# 注释行\n\npack.name= 带空格标题 \nno-eq-line\na=b=c\n",
    }, "shaderpack");
    const meta = await browserAdapter.ReadShaderpackLang(path);
    expect(meta.name).toBe("带空格标题");
    expect(meta.entries ?? {}).toEqual({ "a": "b=c", "pack.name": "带空格标题" });
    expect("no-eq-line" in (meta.entries ?? {})).toBe(false);
  });

  it("无 lang/en_US.lang（仅有 zh_CN.lang）→ {name:\"\",entries:{}}（对齐 go 空结果）", async () => {
    const path = await importZip("中文光影.zip", {
      "lang/zh_cn.lang": "pack.name=中文",
    }, "shaderpack");
    expect(await browserAdapter.ReadShaderpackLang(path)).toEqual({ name: "", entries: {} });
  });

  it("文件不存在 / 非 zip → {name:\"\",entries:{}}", async () => {
    expect(await browserAdapter.ReadShaderpackLang("/web/shaderpack/不存在/a.zip")).toEqual(
      { name: "", entries: {} },
    );
  });
});
