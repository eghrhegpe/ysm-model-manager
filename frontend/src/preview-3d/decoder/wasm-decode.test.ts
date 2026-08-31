// @vitest-environment node
// ===== WASM 解码层测试（并发去重守卫）=====
// decodeYsmViaWasm 必须对同一路径并发去重：preloadModel 并行触发
// （纹理 + Android spec 兜底）时只解码一次，否则 atob/解析双份、WASM 状态竞争。
// 注意：cache.ts 为模块级持久 Map（无 clear API），各用例用不同路径隔离。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeYsmViaWasm } from "./wasm-decode.ts";

const { initMock, decodeMemoryMock, readFileBytesMock, memfsMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(true),
  decodeMemoryMock: vi.fn(),
  readFileBytesMock: vi.fn(),
  memfsMock: vi.fn(),
}));

vi.mock("../../../wasm/ysm-parser.ts", () => ({
  initYSMParser: initMock,
  decodeYsmFileFromMemory: decodeMemoryMock,
  decodeYsmFile: memfsMock,
}));

vi.mock("../../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ ReadFileBytes: readFileBytesMock }),
}));

// 有效 base64（空文件解码也会被内部字节长度守卫拦截；此处用最小非空）
const FAKE_B64 = "AQID"; // 3 bytes

/** 构造一个可被 parseBedrockGeometryFromJSON 解析的 main.json */
const MAIN_JSON = JSON.stringify({
  format_version: "1.16.0",
  "minecraft:geometry": [
    {
      description: { identifier: "geometry.test" },
      bones: [
        { name: "root", cubes: [{ origin: [0, 0, 0], size: [1, 1, 1] }] },
      ],
    },
  ],
});

/** 构造可被 parseYsmJsonDirect 引导 + parseBedrockGeometryFromJSON 解析的输出文件 */
function fakeDecodedFiles() {
  const ysmJson = {
    spec: {},
    files: {
      player: { model: "models/main.json", texture: "textures/body.png" },
    },
    metadata: { authors: [] },
    properties: { texture_width: 64, texture_height: 64, default_texture: "textures/body.png" },
    minecraft: { geometry: [] },
  };
  return [
    { path: "ysm.json", data: encoder.encode(JSON.stringify(ysmJson)) },
    { path: "models/main.json", data: encoder.encode(MAIN_JSON) },
    { path: "textures/body.png", data: encoder.encode("PNGDATA") },
  ];
}

const encoder = new TextEncoder();

/** 构造一个含 bones 的 minecraft:geometry JSON，返回 base64 编码 */
function geoB64(boneName: string, cubeCount: number = 1): string {
  const cubes = Array.from({ length: cubeCount }, (_, i) => ({
    origin: [i, 0, 0], size: [1, 1, 1], uv: [0, 0],
  }));
  const geo = JSON.stringify({
    format_version: "1.16.0",
    "minecraft:geometry": [{
      description: { identifier: `geometry.${boneName}` },
      bones: [{ name: boneName, cubes }],
    }],
  });
  // JSON 全 ASCII，TextDecoder 安全
  return btoa(new TextDecoder().decode(encoder.encode(geo)));
}

/** 构造一个最简 PNG（8x8）的 base64 */
function pngB64(): string {
  const png = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
    0x08, 0x02, 0x00, 0x00, 0x00, 0xAD, 0x6E, 0x96,
    0x9D, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0xFF,
    0x00, 0x05, 0xFE, 0x02, 0xFB, 0xA0, 0x32, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
  ]);
  // 二进制 → base64（不可经 TextDecoder，含 >127 字节）
  let binary = "";
  for (let i = 0; i < png.length; i++) binary += String.fromCharCode(png[i]);
  return btoa(binary);
}

/** 构造 ysm.json spec 格式文件的 base64（默认含 main.json + body.png） */
function ysmSpecB64(
  overrides: {
    files?: { player?: { model?: string | null; texture?: string | null } };
    metadata?: unknown[];
    properties?: Record<string, unknown>;
    minecraft?: unknown;
  } = {},
): string {
  const ysmJson = {
    spec: { version: "1.0.0" },
    files: { player: { model: "main.json", texture: "body.png" } },
    metadata: { authors: [] },
    properties: { texture_width: 64, texture_height: 64 },
    minecraft: { geometry: [] },
    ...overrides,
  };
  return btoa(new TextDecoder().decode(encoder.encode(JSON.stringify(ysmJson))));
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 无 URL.createObjectURL 实现（生产浏览器有）——补 mock 防纹理提取抛错
  URL.createObjectURL = URL.createObjectURL || (() => "blob:mock");
  URL.revokeObjectURL = URL.revokeObjectURL || (() => {});
  readFileBytesMock.mockResolvedValue(FAKE_B64);
  decodeMemoryMock.mockResolvedValue(fakeDecodedFiles());
  memfsMock.mockResolvedValue([]); // 默认无 MEMFS 输出（快路径成功时不触发）
});

describe("decodeYsmViaWasm 并发去重", () => {
  it("同一路径并发调用只读文件/解码一次，返回同一结果", async () => {
    const [a, b] = await Promise.all([
      decodeYsmViaWasm("/repo/a.ysm"),
      decodeYsmViaWasm("/repo/a.ysm"),
    ]);
    expect(readFileBytesMock).toHaveBeenCalledTimes(1); // 去重：只读一次
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1); // 去重：只解码一次
    expect(a?.geometryRaw).toBeTruthy();
    expect(b?.geometryRaw).toBeTruthy();
    expect(a).toBe(b); // 共享同一结果
  });

  it("不同路径各自解码", async () => {
    await Promise.all([
      decodeYsmViaWasm("/repo/b.ysm"),
      decodeYsmViaWasm("/repo/c.ysm"),
    ]);
    expect(readFileBytesMock).toHaveBeenCalledTimes(2);
    expect(decodeMemoryMock).toHaveBeenCalledTimes(2);
  });

  it("解码失败缓存 _wasmFailed：同一路径不再重读（in-flight 已清）", async () => {
    decodeMemoryMock.mockRejectedValueOnce(new Error("wasm boom"));
    const first = await decodeYsmViaWasm("/repo/d.ysm");
    expect(first).toBeNull();
    // 失败已缓存 _wasmFailed：第二次直接命中缓存，不再读文件/解码
    const second = await decodeYsmViaWasm("/repo/d.ysm");
    expect(second).toBeNull();
    expect(readFileBytesMock).toHaveBeenCalledTimes(1);
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1);
  });

  it("读文件瞬时失败不缓存 _wasmFailed：后端恢复后重试成功（P3 修复契约）", async () => {
    // 场景：ReadFileBytes 瞬时失败（后端短暂不可用/桥错误），随后恢复可用。
    // 契约：读失败与解码失败不同——不缓存 _wasmFailed，下次调用重试读文件。
    readFileBytesMock.mockRejectedValueOnce(new Error("backend transient"));
    const first = await decodeYsmViaWasm("/repo/transient.ysm");
    expect(first).toBeNull();

    // 后端已恢复：第二次应重试读文件并成功解码
    readFileBytesMock.mockResolvedValue(FAKE_B64);
    const second = await decodeYsmViaWasm("/repo/transient.ysm");
    expect(second).not.toBeNull(); // 重试成功，非 null
    expect(readFileBytesMock).toHaveBeenCalledTimes(2); // 重试：读了两次
  });

  it("3 次同路径并发合并：只解码一次，三者引用相等", async () => {
    // 3+ 次并发是 preloadModel + 纹理 + Android spec 兜底的真实并发强度，
    // 去重 Map 必须合并所有在途调用（而非仅首个），否则第 3 次会重复解码
    const [a, b, c] = await Promise.all([
      decodeYsmViaWasm("/repo/e.ysm"),
      decodeYsmViaWasm("/repo/e.ysm"),
      decodeYsmViaWasm("/repo/e.ysm"),
    ]);
    expect(readFileBytesMock).toHaveBeenCalledTimes(1);
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c); // 共享同一结果对象
  });

  it("缓存命中 geometry 快路径：不再读文件/解码", async () => {
    // 首次解码成功后缓存含 geometry.bones，二次调用走 L51 快路径直接返回缓存
    const first = await decodeYsmViaWasm("/repo/f.ysm");
    expect(first?.geometryRaw).toBeTruthy();
    const calls0 = readFileBytesMock.mock.calls.length;
    const decodes0 = decodeMemoryMock.mock.calls.length;
    // 二次走快路径：断言不重读/重解码（核心目的），且结果几何一致
    const second = await decodeYsmViaWasm("/repo/f.ysm");
    expect(second?.geometryRaw).toBe(first?.geometryRaw);
    expect(readFileBytesMock.mock.calls.length).toBe(calls0); // 不重读
    expect(decodeMemoryMock.mock.calls.length).toBe(decodes0); // 不重解码
  });

  it("原始字节解码抛 abort 后回退 MEMFS 成功（硬崩溃不阻断回退链）", async () => {
    // 模拟 WASM 硬崩溃（abort/trap）：decodeYsmFileFromMemory reject，
    // wasm.ts 的 catch 不静默吞错且不中断——继续走 MEMFS 回退路径。
    // ysm-parser 内部的 resetYSMParser 由单例 mock 替身，此处只验 wasm.ts 层行为：
    // 崩溃信号被吞后 MEMFS 仍能产出有效结果（非 null）。
    decodeMemoryMock.mockRejectedValueOnce(new Error("abort"));
    memfsMock.mockResolvedValueOnce(fakeDecodedFiles());
    const result = await decodeYsmViaWasm("/repo/g.ysm");
    expect(result?.geometryRaw).toBeTruthy(); // MEMFS 回退成功输出几何
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1); // 快路径崩溃一次
    expect(memfsMock).toHaveBeenCalledTimes(1); // 回退链触发 MEMFS
  });
});

describe("decodeYsmViaWasm .json 路径几何合并（ysm.json spec 格式）", () => {
  it(".json 路径读取 modelFiles + texFiles 合并几何", async () => {
    // 构造 ysm.json spec 格式，含 modelFiles=[main.json] 和 texFiles=[{uv:"body.png"}]
    const ysmJsonB64 = ysmSpecB64();
    const modelJsonB64 = geoB64("root", 2); // 2 cubes → boneCount=1, cubeCount=2
    const texB64 = pngB64();

    // ReadFileBytes 需返回 base64：ysm.json 本体、modelFiles、texFiles
    const calls = new Map<string, string>();
    calls.set("/repo/ysm.json", ysmJsonB64);
    calls.set("/repo/models/main.json", modelJsonB64);
    calls.set("/repo/main.json", modelJsonB64); // 兜底路径
    calls.set("/repo/textures/body.png", texB64);
    calls.set("/repo/avatar/sdf", "");

    readFileBytesMock.mockImplementation(async (path: string) => {
      return calls.get(path) || null;
    });

    const result = await decodeYsmViaWasm("/repo/ysm.json");
    expect(result).not.toBeNull();
    // 合并后骨骼数 = 1（modelFiles 中只有 main.json）
    expect(result?.geometry?.bones?.length).toBe(1);
    // 骨名 "root" 带 _texWidth/_texHeight
    expect(result?.geometry?.bones?.[0]?._texWidth).toBeGreaterThan(0);
    // cubeCount = 2（main.json 中有 2 个 cube）
    expect(result?.geometry?.cubeCount).toBe(2);
    // boneCount = 1
    expect(result?.geometry?.boneCount).toBe(1);
    // 纹理已加载
    expect(result?.geometry?.textures?.length).toBe(1);
  });

  it(".json 路径 modelFiles 不存在时走原始解析（不合并）", async () => {
    // 构造 minecraft:geometry 格式 JSON（非 ysm.json spec），parseYsmJsonDirect 走第 2 分支，返回无 _ysmMeta
    // 注意：parseYsmJsonDirect 检查 obj.minecraft.geometry[0]，需用嵌套结构
    const directJson = JSON.stringify({
      format_version: "1.16.0",
      minecraft: {
        geometry: [{
          description: { identifier: "geometry.direct" },
          bones: [{ name: "direct", cubes: [{ origin: [0, 0, 0], size: [2, 2, 2] }] }],
        }],
      },
    });
    const b64 = btoa(new TextDecoder().decode(encoder.encode(directJson)));

    readFileBytesMock.mockResolvedValue(b64);
    const result = await decodeYsmViaWasm("/repo/direct.json");
    expect(result).not.toBeNull();
    // minecraft:geometry 格式：直接解析，不触发合并
    expect(result?.geometry?.bones?.length).toBe(1);
    expect(result?.geometry?.bones?.[0]?.name).toBe("direct");
    expect(result?.geometry?.boneCount).toBe(1);
    // 无 _ysmMeta 时不读 modelFiles
    expect(readFileBytesMock).toHaveBeenCalledTimes(1); // 只读 JSON 本体
  });
});

describe("decodeYsmViaWasm 未覆盖分支补测", () => {
  it("ReadFileBytes 返回空 → 缓存 _wasmFailed，二次不再读", async () => {
    readFileBytesMock.mockResolvedValue(null); // 文件不存在 → 空字节守卫
    const first = await decodeYsmViaWasm("/repo/nofile.ysm");
    expect(first).toBeNull();
    const second = await decodeYsmViaWasm("/repo/nofile.ysm");
    expect(second).toBeNull();
    expect(readFileBytesMock).toHaveBeenCalledTimes(1);
  });

  it(".json 路径非法 JSON → 外层 catch 缓存 _wasmFailed", async () => {
    readFileBytesMock.mockResolvedValue(btoa("{not valid json")); // JSON.parse 抛错
    const first = await decodeYsmViaWasm("/repo/bad.json");
    expect(first).toBeNull();
    const second = await decodeYsmViaWasm("/repo/bad.json");
    expect(second).toBeNull();
    expect(readFileBytesMock).toHaveBeenCalledTimes(1); // 失败已缓存，二次不重读
  });

  it("WASM init 失败 → 缓存 _wasmFailed，二次不再读/解码", async () => {
    initMock.mockResolvedValueOnce(false);
    const first = await decodeYsmViaWasm("/repo/initfail.ysm");
    expect(first).toBeNull();
    expect(decodeMemoryMock).not.toHaveBeenCalled();
    const second = await decodeYsmViaWasm("/repo/initfail.ysm");
    expect(second).toBeNull();
    expect(readFileBytesMock).toHaveBeenCalledTimes(1);
  });

  it("WASM 解码有文件但几何体解析为空 → 回退 Go（缓存 _wasmFailed）", async () => {
    // ysm.json 存在但 models/main.json 的 bones 为空 → processModelFile 无产出 → geometry null
    decodeMemoryMock.mockResolvedValueOnce([
      {
        path: "ysm.json",
        data: encoder.encode(JSON.stringify({
          spec: {},
          files: { player: { model: "models/main.json", texture: "textures/body.png" } },
          metadata: { authors: [] },
          properties: {},
          minecraft: { geometry: [] },
        })),
      },
      {
        path: "models/main.json",
        data: encoder.encode(JSON.stringify({
          format_version: "1.16.0",
          "minecraft:geometry": [{
            description: { identifier: "geometry.x" },
            bones: [], // 无骨骼 → parseBedrockGeometryFromJSON 返回 null
          }],
        })),
      },
      { path: "textures/body.png", data: encoder.encode("PNGDATA") },
    ]);
    const first = await decodeYsmViaWasm("/repo/nogeo.ysm");
    expect(first).toBeNull();
    const second = await decodeYsmViaWasm("/repo/nogeo.ysm");
    expect(second).toBeNull();
    expect(readFileBytesMock).toHaveBeenCalledTimes(1); // 失败已缓存
  });

  it("WASM 路径 JPEG 纹理 SOF 尺寸嗅探（bone 补 _texWidth/_texHeight）", async () => {
    // 手工构造 JPEG：SOI + APP0 + SOF0(8×8) + EOI；sniffTexSize 需在 SOF 段读宽高
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x10, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03, 0x01, 0x22,
      0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ]);
    decodeMemoryMock.mockResolvedValueOnce([
      {
        path: "ysm.json",
        data: encoder.encode(JSON.stringify({
          spec: {},
          files: { player: { model: "models/main.json", texture: "textures/body.jpg" } },
          metadata: { authors: [] },
          properties: { default_texture: "textures/body.jpg" },
          minecraft: { geometry: [] },
        })),
      },
      { path: "models/main.json", data: encoder.encode(MAIN_JSON) },
      { path: "textures/body.jpg", data: jpeg },
    ]);
    const result = await decodeYsmViaWasm("/repo/jpeg.ysm");
    expect(result).not.toBeNull();
    // JPEG 宽高来自 SOF 嗅探（无 PNG 签名时不走 PNG 分支）
    expect(result?.geometry?.bones?.[0]?._texWidth).toBe(8);
    expect(result?.geometry?.bones?.[0]?._texHeight).toBe(8);
  });

  it(".json 合并 modelFiles 补 models/ 前缀失败 → 回退原始路径", async () => {
    const ysmJsonB64 = ysmSpecB64();
    const modelJsonB64 = geoB64("root", 1);
    const texB64 = pngB64();

    // 补前缀路径 models/main.json 不存在 → 走 L131 原始路径回退
    const calls = new Map<string, string>();
    calls.set("/repo/ysm.json", ysmJsonB64);
    calls.set("/repo/main.json", modelJsonB64);
    calls.set("/repo/textures/body.png", texB64);
    readFileBytesMock.mockImplementation(async (path: string) => calls.get(path) || null);

    const result = await decodeYsmViaWasm("/repo/ysm.json");
    expect(result).not.toBeNull();
    expect(result?.geometry?.bones?.length).toBe(1); // 原始路径回退解析成功
    expect(result?.geometry?.boneCount).toBe(1);
  });

  it(".json 路径作者头像读取（avatarUrl 回填）", async () => {
    const ysmJson = {
      spec: { version: "1.0.0" },
      files: { player: { model: null } },
      metadata: { authors: [{ name: "alice", role: "author", avatar: "avatar/a.png" }] },
      properties: {},
      minecraft: { geometry: [] },
    };
    const ysmJsonB64 = btoa(new TextDecoder().decode(encoder.encode(JSON.stringify(ysmJson))));
    const calls = new Map<string, string>();
    calls.set("/repo/avatar.json", ysmJsonB64);
    calls.set("/repo/avatar/a.png", pngB64());
    readFileBytesMock.mockImplementation(async (path: string) => calls.get(path) || null);

    const result = await decodeYsmViaWasm("/repo/avatar.json");
    expect(result).not.toBeNull();
    expect(result?.authors?.[0]?.name).toBe("alice");
    expect(result?.authors?.[0]?.avatarUrl).toMatch(/^blob:/); // avatarUrl 已回填
  });

  it("WASM 路径解析 animations/ 动画文件", async () => {
    const animJson = JSON.stringify({
      format_version: "1.8.0",
      animations: {
        walk: {
          loop: true,
          animation_length: 1.0,
          // 注意：parseChannel 以数值 t 查 key（channelData[t]），键须为整数形式
          bones: { arm: { rotation: { "0": [0, 0, 0], "1": [0, 30, 0] } } },
        },
      },
    });
    decodeMemoryMock.mockResolvedValueOnce([
      ...fakeDecodedFiles(),
      { path: "animations/walk.json", data: encoder.encode(animJson) },
    ]);
    const result = await decodeYsmViaWasm("/repo/anim.ysm");
    expect(result).not.toBeNull();
    expect(result?.animations?.length).toBe(1);
    expect((result?.animations?.[0] as { name?: string } | undefined)?.name).toBe("walk");
  });
});
