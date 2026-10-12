// @vitest-environment node
// ===== wasm-decode Blob 构造的「视图精确性」契约（2026-10-11 收敛）=====
//
// 被测历史缺陷：`wasm-decode.ts` 四处 Blob 构造原用 `<bytes>.buffer` 传裸 ArrayBuffer，
// 正确性依赖一条**隐性契约**——数组必须「恰好占满底层 ArrayBuffer」
// （byteOffset=0 且 byteLength === buffer.byteLength）：
//   ① collectTexturesAndAvatars 纹理（WASM 输出 f.data）
//   ② collectTexturesAndAvatars 头像（WASM 输出 f.data）
//   ③ collectJsonSpecTextures 纹理（ctx.ReadBytes）
//   ④ loadAvatarsForJson 头像（ctx.ReadBytes）
//
// 隐患：`ReadBytes` 在**网页版**走 IDB `ArrayBuffer` 直出（ADR-228），可能返回
// subarray 视图；WASM 侧 `FS.readFile` 若将来改零拷贝视图同理。此时 `.buffer`
// 会指向更大的底层缓冲 → Blob 多吞字节 → 纹理花屏/头像损坏，**且不报错**。
//
// 反证基准（同仓已认知该隐患）：`backend/web-community.ts` 显式按
// `byteOffset/byteLength` 切片；`utils/base/primitives/base64.ts` 注明「仅偏移视图才
// slice 复制」。故本轮统一改为传视图本身——Blob 构造按 byteOffset/byteLength
// 精确取字节，契约消失。
//
// 本文件用**故意错位的 subarray**（底层缓冲前后各 8 字节 0xAA 哨兵）驱动
// `collectTexturesAndAvatars` 路径：旧实现下 BlobPart 会是全长 buffer、含哨兵；
// 新实现只含视图字节。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeYsmViaWasm } from "./wasm-decode.ts";

const { initMock, decodeMemoryMock, readFileBytesMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(true),
  decodeMemoryMock: vi.fn(),
  readFileBytesMock: vi.fn(),
}));

vi.mock("@/wasm/ysm-parser.ts", () => ({
  initYSMParser: initMock,
  decodeYsmFileFromMemory: decodeMemoryMock,
  decodeYsmFile: vi.fn(),
}));

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ReadFileBytes: readFileBytesMock,
    CacheModelAvatars: vi.fn().mockResolvedValue(undefined),
  }),
}));

const encoder = new TextEncoder();

/** 纹理字节：PNG 签名 + IHDR（sniffTexSize 可识别）+ 尾部可校验数据。 */
const TEX_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG 签名
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, // 8×8
  0xaa, 0xbb, 0xcc, 0xdd, // 尾部数据（校验 Blob 不截断）
]);

const SENTINEL_BYTES = 16; // 前后各 8 字节哨兵

/**
 * 构造**错位 subarray**：底层 ArrayBuffer 前后各塞 8 字节 0xAA 哨兵，
 * 返回 [8, 8+len) 的视图 —— byteOffset=8、byteLength=len、buffer.byteLength=len+16。
 * 旧实现（`.buffer`）会把哨兵一起塞进 Blob。
 */
function misalignedView(bytes: Uint8Array): Uint8Array {
  const backing = new ArrayBuffer(bytes.byteLength + SENTINEL_BYTES);
  const u8 = new Uint8Array(backing);
  u8.fill(0xaa);
  u8.set(bytes, 8);
  return new Uint8Array(backing, 8, bytes.byteLength);
}

/** 主文件（.ysm）读入的合法 base64（内容不参与断言，仅需非空以越过早退）。 */
function mainFileB64(): string {
  let binary = "";
  for (let i = 0; i < 16; i++) binary += String.fromCharCode(i + 1);
  return btoa(binary);
}

const GEO_JSON = JSON.stringify({
  format_version: "1.16.0",
  "minecraft:geometry": [
    {
      description: { identifier: "geometry.test" },
      bones: [{ name: "root", cubes: [{ origin: [0, 0, 0], size: [1, 1, 1] }] }],
    },
  ],
});

/** ysm.json spec：声明纹理 textures/body.png（走 collectTexturesAndAvatars）。 */
function ysmSpec(): string {
  return JSON.stringify({
    spec: { version: "1.0.0" },
    files: { player: { model: "models/main.json", texture: "textures/body.png" } },
    metadata: { authors: [] },
    properties: { texture_width: 8, texture_height: 8, default_texture: "textures/body.png" },
    minecraft: { geometry: [] },
  });
}

/** WASM 输出文件集：ysm.json（spec 引导）+ 模型 + 错位视图纹理。 */
function decodedFiles(): { path: string; data: Uint8Array }[] {
  return [
    { path: "ysm.json", data: encoder.encode(ysmSpec()) },
    { path: "models/main.json", data: encoder.encode(GEO_JSON) },
    { path: "textures/body.png", data: misalignedView(TEX_BYTES) },
  ];
}

/** 捕获所有 Blob 构造的 BlobPart，并 stub URL 工厂。 */
function spyBlobs(): BlobPart[][] {
  const captured: BlobPart[][] = [];
  const RealBlob = globalThis.Blob;
  vi.stubGlobal(
    "Blob",
    class extends RealBlob {
      constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
        captured.push([...parts]);
        super(parts, opts);
      }
    },
  );
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test-${n++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return captured;
}

/** 取所有视图形态（Uint8Array）的 BlobPart。 */
function viewParts(captured: BlobPart[][]): Uint8Array[] {
  // BlobPart 联合类型（string | ArrayBufferView | Blob）；此处只关心视图形态，
  // 用 instanceof 收窄（TS 的 ArrayBufferView 泛型与 Uint8Array 不兼容，需断言）
  return captured.flat().filter((p) => p instanceof Uint8Array) as Uint8Array[];
}

describe("wasm-decode — Blob 按视图取字节（视图精确性契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initMock.mockResolvedValue(true);
    readFileBytesMock.mockReset();
    readFileBytesMock.mockResolvedValue(mainFileB64());
    decodeMemoryMock.mockReset();
    decodeMemoryMock.mockResolvedValue(decodedFiles());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("纹理 data 为错位 subarray 时：BlobPart 只含视图字节，不夹带 0xAA 哨兵", async () => {
    const captured = spyBlobs();
    const result = await decodeYsmViaWasm("/repo/tex.ysm");

    expect(result, "解码须成功（否则未走到纹理 Blob 构造）").not.toBeNull();
    const parts = viewParts(captured);
    expect(parts.length, "须至少构造一个 Uint8Array BlobPart").toBeGreaterThan(0);

    const part = parts.find((v) => v.byteLength === TEX_BYTES.byteLength);
    expect(part, `须存在长度=${TEX_BYTES.byteLength} 的 BlobPart（视图长）`).toBeDefined();
    // 核心判据：字节逐值相等——旧实现下前后会是 0xAA 哨兵，此处必红
    expect([...part!], "BlobPart 字节须等于纹理真值（无哨兵）").toEqual([...TEX_BYTES]);
  });

  it("BlobPart 不得是「底层全长缓冲」（哨兵泄漏的签名长度）", async () => {
    const captured = spyBlobs();
    await decodeYsmViaWasm("/repo/tex2.ysm");

    const parts = viewParts(captured);
    expect(parts.length, "须至少一个 Uint8Array BlobPart").toBeGreaterThan(0);
    for (const p of parts) {
      expect(
        p.byteLength,
        "BlobPart 不得为底层全长（= 视图长 + 16 哨兵）",
      ).not.toBe(TEX_BYTES.byteLength + SENTINEL_BYTES);
    }
  });

  it("BlobPart 首尾字节即纹理真值（byteOffset 语义生效，非从底层 0 起读）", async () => {
    const captured = spyBlobs();
    await decodeYsmViaWasm("/repo/tex3.ysm");

    const part = viewParts(captured).find((v) => v.byteLength === TEX_BYTES.byteLength);
    expect(part).toBeDefined();
    expect(part![0], "首字节须为 PNG 签名 0x89").toBe(0x89);
    expect(part![part!.byteLength - 1], "尾字节须为纹理数据 0xDD").toBe(0xdd);
  });

  // [2026-10-12 自查补盲] `viewAsBlobPart` 有两条分支：整视图（byteOffset=0 且占满）与
  // 偏移视图。上面三例全走**偏移**分支，**整视图分支零判别力**——自查时对该分支做变异
  // （整视图改返回 `.buffer`）三例全绿，即「最常见路径反而没被测」。
  // 本例补上：生产路径（`FS.readFile` / `base64ToBytes` 均返回**恰好占满**的独立数组）
  // 正是整视图分支，故该分支必须自身可判别——判据 = BlobPart 长度恒等于视图长度。
  it("整视图分支（生产最常见路径）：BlobPart 长度恒等于视图长度", async () => {
    // 构造「恰好占满底层」的整视图（生产 FS.readFile/base64ToBytes 的返回形态）
    const whole = new Uint8Array(TEX_BYTES.byteLength);
    whole.set(TEX_BYTES);

    decodeMemoryMock.mockResolvedValue([
      { path: "ysm.json", data: encoder.encode(ysmSpec()) },
      { path: "models/main.json", data: encoder.encode(GEO_JSON) },
      { path: "textures/body.png", data: whole },
    ]);
    const captured = spyBlobs();
    await decodeYsmViaWasm("/repo/whole.ysm");

    const parts = viewParts(captured);
    expect(parts.length, "应至少构造一个 Uint8Array BlobPart").toBeGreaterThan(0);
    const part = parts.find((v) => v.byteLength === TEX_BYTES.byteLength);
    expect(part, "整视图分支须产出长度 = 视图长的 BlobPart").toBeDefined();
    // 反向判据：若该分支误走 `.buffer`，长度会变成底层全长（此处底层恰等于视图，
    // 故长度断言不分辨）——真正的判据是 **BlobPart 是 Uint8Array 而非 ArrayBuffer**
    // （`.buffer` 会把裸 ArrayBuffer 交给 Blob，其构造语义与视图等价但丢失 byteOffset 语义）。
    // 本例的判别力来自与偏移分支的**组合**：两分支任一退化为 `.buffer` 都会被
    // 上面三例或本例的长度/哨兵断言捕获（本例兜底整视图分支不被静默移除）。
    expect(part!.constructor.name, "整视图分支仍须走 Uint8Array 视图形态").toBe("Uint8Array");
  });
});
