// ===== MMD ZIP Overlay 测试 =====
// 覆盖 ZipOverlayPort 三条路由：
//   1. readFileBytes — zip 内路径命中 / zip 外路径透传
//   2. readFileBytesBatch — 混合路径逐条分流
//   3. listAllFilePaths — 虚拟目录返回 zip 条目 / 外部路径透传
// 以及 resolveMmdZipConfig 的模型选择逻辑（多模型取首个 + GBK 解码 + 纹理发现）。
import { describe, it, expect, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { b64ToBytes, bytesToBase64 } from "../base64.ts";
import { extractZip } from "../../parsers/extract.ts";
import {
  resolveMmdZipConfig,
  makeZipOverlayPort,
  prepareMmdZipInput,
  zipFindEntry,
} from "./mmd-zip-overlay.ts";
import type { MmdDataPort } from "./mmd-adapter.ts";

/** 构造内存 zip：包含 1 个 pmx 模型 + 纹理 + vmd 动画 */
function makeTestZipBytes(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "model.pmx": strToU8("pmx-model-bytes"),
    "texture/body.png": strToU8("png-bytes"),
    "texture/face.jpg": strToU8("jpg-bytes"),
    "animation/dance.vmd": strToU8("vmd-bytes"),
  };
  const zipped = zipSync(files);
  return new Uint8Array(zipped);
}

/** 构造多模型 zip：两个 pmx + 一个 pmd，验证字典序选择 */
function makeMultiModelZipBytes(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "zuko.pmx": strToU8("zuko-model"),
    "miku.pmx": strToU8("miku-model"),
    "extra.pmd": strToU8("extra-model"),
  };
  const zipped = zipSync(files);
  return new Uint8Array(zipped);
}

/** 构造空 zip */
function makeEmptyZipBytes(): Uint8Array {
  const zipped = zipSync({});
  return new Uint8Array(zipped);
}

/** 将 zip 字节编码为 base64 字符串（模拟 readFileBytes 的实际返回） */
function zipToB64(zipBytes: Uint8Array): string {
  return bytesToBase64(zipBytes);
}

/** 构造注入端口：readFileBytes 返回 base64（模拟 Wails 桥序列化） */
function makeInnerPort(): MmdDataPort {
  return {
    readFileBytes: vi.fn().mockImplementation(async (p: string) => {
      if (p === "/external/file.txt") return bytesToBase64(new Uint8Array([1, 2, 3]));
      return null;
    }),
    readFileBytesBatch: vi.fn().mockImplementation(async (paths: string[]) => {
      const result: Record<string, string | null> = {};
      for (const p of paths) {
        result[p] = bytesToBase64(new Uint8Array([10]));
      }
      return result;
    }),
    listAllFilePaths: vi.fn().mockImplementation(async (dir: string) => {
      if (dir === "/external") return ["/external/a.txt", "/external/b.txt"];
      return [];
    }),
    addOpLog: vi.fn().mockResolvedValue(undefined),
    getCachedTexture: vi.fn().mockResolvedValue(null),
  };
}

describe("zipFindEntry", () => {
  it("按 basename 查找 zip 条目（大小写不敏感）", () => {
    // key 与 resolveMmdZipConfig 的 entriesMap 一致（lowercase + 正斜杠）
    const entries = new Map<string, Uint8Array>([
      ["texture/body.png", strToU8("data1")],
      ["texture/face.jpg", strToU8("data2")],
    ]);
    const hit = zipFindEntry(entries, "body.png");
    expect(hit).not.toBeNull();
    expect(hit![0]).toBe("d".charCodeAt(0));
  });

  it("精确路径命中", () => {
    const entries = new Map<string, Uint8Array>([["model.pmx", strToU8("x")]]);
    const hit = zipFindEntry(entries, "model.pmx");
    expect(hit).not.toBeNull();
  });

  it("找不到返回 null", () => {
    const entries = new Map<string, Uint8Array>([["a.pmx", strToU8("x")]]);
    expect(zipFindEntry(entries, "missing.png")).toBeNull();
  });

  it("扩展名不匹配（.pmx.png 不等于 .pmx）", () => {
    const entries = new Map<string, Uint8Array>([["model.pmx.png", strToU8("x")]]);
    expect(zipFindEntry(entries, "model.pmx")).toBeNull();
  });
});

describe("resolveMmdZipConfig", () => {
  it("正常 zip：找到 pmx + 纹理 + 动画", async () => {
    const zipBytes = makeTestZipBytes();
    const port = makeInnerPort();
    vi.spyOn(port, "readFileBytes").mockResolvedValueOnce(zipToB64(zipBytes));

    const config = await resolveMmdZipConfig("/repo/model.zip", port);

    expect(config.modelEntry).toBe("model.pmx");
    expect(config.modelBase).toBe("model.pmx");
    expect(config.modelBytes.length).toBeGreaterThan(0);
    expect(config.entryPaths.length).toBe(4); // pmx + 2 纹理 + vmd
  });

  it("多模型 zip：按字典序取第一个 pmx", async () => {
    const zipBytes = makeMultiModelZipBytes();
    const port = makeInnerPort();
    vi.spyOn(port, "readFileBytes").mockResolvedValueOnce(zipToB64(zipBytes));

    const config = await resolveMmdZipConfig("/repo/multi.zip", port);

    // .pmx 优先于 .pmd，pmx 中 miku.pmx < zuko.pmx
    expect(config.modelEntry).toBe("miku.pmx");
  });

  it("[doc:adr-127] 多模型 zip：modelCandidates 暴露全部 pmx/pmd（排序，第一个 = 默认）", async () => {
    const zipBytes = makeMultiModelZipBytes();
    const port = makeInnerPort();
    vi.spyOn(port, "readFileBytes").mockResolvedValueOnce(zipToB64(zipBytes));

    const config = await resolveMmdZipConfig("/repo/multi.zip", port);

    // 全部候选：.pmx 优先，pmx 内字典序；pmd 兜底
    expect(config.modelCandidates.map((c) => c.key)).toEqual(["miku.pmx", "zuko.pmx", "extra.pmd"]);
    // 第一个 = 默认选中（与 modelEntry 一致）
    expect(config.modelCandidates[0].key).toBe(config.modelEntry);
  });

  it("空 zip 抛错", async () => {
    const zipBytes = makeEmptyZipBytes();
    const port = makeInnerPort();
    vi.spyOn(port, "readFileBytes").mockResolvedValueOnce(zipToB64(zipBytes));

    await expect(resolveMmdZipConfig("/repo/empty.zip", port)).rejects.toThrow(/未找到.*模型文件/);
  });
});

describe("ZipOverlayPort 三条路由", () => {
  // 模拟 resolveMmdZipConfig 产物，手工构造 config
  const zipBytes = makeTestZipBytes();
  const innerPort = makeInnerPort();
  const realExtract = extractZip(zipBytes);

  // 复现 resolveMmdZipConfig 的 key 归一化逻辑
  const entriesMap = new Map<string, Uint8Array>();
  const entryPaths: string[] = [];
  const seen = new Set<string>();
  for (const meta of realExtract.metas) {
    // 前端无 GBK 码表：文件名以 fflateKey 原值（Latin-1 解码）直接使用
    const realName = meta.fflateKey;
    const fflateKey = meta.fflateKey;
    const bytes = realExtract.entries[fflateKey];
    if (!bytes || !realName) continue;
    const key = realName.toLowerCase().replace(/\\/g, "/");
    if (seen.has(key)) continue;
    seen.add(key);
    entriesMap.set(key, bytes);
    entryPaths.push(key);
  }
  for (const [key, bytes] of Object.entries(realExtract.entries)) {
    const k = key.toLowerCase().replace(/\\/g, "/");
    if (!seen.has(k)) {
      seen.add(k);
      entriesMap.set(k, bytes);
      entryPaths.push(k);
    }
  }

  const config = {
    zipPath: "/repo/model.zip",
    modelEntry: "model.pmx",
    modelBase: "model.pmx",
    modelBytes: entriesMap.get("model.pmx")!,
    entries: entriesMap,
    entryPaths,
    modelCandidates: [{ key: "model.pmx", base: "model.pmx" }],
  };

  const { port: overlay, rootPath } = makeZipOverlayPort(innerPort, config);

  it("readFileBytes：zip 内路径命中", async () => {
    const bytesB64 = await overlay.readFileBytes(rootPath + "model.pmx");
    expect(bytesB64).not.toBeNull();
    const bytes = b64ToBytes(bytesB64!);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("readFileBytes：zip 外路径透传 inner", async () => {
    const bytesB64 = await overlay.readFileBytes("/external/file.txt");
    expect(bytesB64).not.toBeNull();
    const bytes = b64ToBytes(bytesB64!);
    expect(bytes[0]).toBe(1);
  });

  it("readFileBytes：zip 内不存在的文件返回 null", async () => {
    const bytes = await overlay.readFileBytes(rootPath + "nonexistent.pmx");
    expect(bytes).toBeNull();
  });

  it("readFileBytesBatch：混合路径逐条分流", async () => {
    const paths = [
      rootPath + "model.pmx",
      "/external/file.txt",
      rootPath + "texture/body.png",
    ];
    const result = await overlay.readFileBytesBatch(paths);
    expect(result[paths[0]]).not.toBeNull(); // zip 内
    expect(result[paths[1]]).not.toBeNull(); // zip 外透传
    expect(result[paths[2]]).not.toBeNull(); // zip 内纹理
  });

  it("listAllFilePaths：虚拟根目录返回所有 zip 条目", async () => {
    const paths = await overlay.listAllFilePaths(rootPath);
    expect(paths).not.toBeNull();
    expect(paths!).toContain(rootPath + "model.pmx");
    expect(paths!).toContain(rootPath + "texture/body.png");
    expect(paths!).toContain(rootPath + "texture/face.jpg");
    expect(paths!).toContain(rootPath + "animation/dance.vmd");
    expect(paths!.length).toBe(4);
  });

  it("listAllFilePaths：zip 子目录过滤", async () => {
    const paths = await overlay.listAllFilePaths(rootPath + "texture/");
    expect(paths).not.toBeNull();
    expect(paths!.length).toBe(2); // body.png + face.jpg
    expect(paths!.every((p) => p.startsWith(rootPath + "texture/"))).toBe(true);
  });

  it("listAllFilePaths：外部路径透传 inner", async () => {
    const paths = await overlay.listAllFilePaths("/external");
    expect(paths).toContain("/external/a.txt");
    expect(paths).toContain("/external/b.txt");
  });

  it("addOpLog：透传至 inner port", async () => {
    await overlay.addOpLog("read", "test", "ok");
    expect(innerPort.addOpLog).toHaveBeenCalled();
  });

  it("getCachedTexture：透传至 inner port", async () => {
    const mockFn = vi.fn().mockResolvedValue(null);
    const portWithCache: MmdDataPort = { ...innerPort, getCachedTexture: mockFn as MmdDataPort["getCachedTexture"] };
    const { port: overlay2 } = makeZipOverlayPort(portWithCache, config);
    await overlay2.getCachedTexture!("test");
    expect(mockFn).toHaveBeenCalledWith("test");
  });

  it("saveCachedTexture：透传至 inner port（P2-1 落盘通道不因 zip overlay 丢失）", async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined);
    const portWithSave: MmdDataPort = { ...innerPort, saveCachedTexture: mockFn as MmdDataPort["saveCachedTexture"] };
    const { port: overlay2 } = makeZipOverlayPort(portWithSave, config);
    await overlay2.saveCachedTexture!("h1", "b64");
    expect(mockFn).toHaveBeenCalledWith("h1", "b64");
  });
});

describe("prepareMmdZipInput 端到端", () => {
  it("整合返回 overlay port + 根路径 + 模型信息", async () => {
    const zipBytes = makeTestZipBytes();
    const port = makeInnerPort();
    vi.spyOn(port, "readFileBytes").mockResolvedValueOnce(zipToB64(zipBytes));

    const result = await prepareMmdZipInput("/repo/model.zip", port);

    expect(result.rootPath.endsWith("/repo/model.zip!/")).toBe(true);
    expect(result.modelEntry).toBe("model.pmx");
    expect(result.modelBase).toBe("model.pmx");
    expect(result.modelBytes.length).toBeGreaterThan(0);

    // overlay port 能读取 zip 内模型（base64 返回）
    const modelB64 = await result.port.readFileBytes(result.rootPath + "model.pmx");
    expect(modelB64).not.toBeNull();

    // overlay port 能读取 zip 内纹理
    const texB64 = await result.port.readFileBytes(result.rootPath + "texture/body.png");
    expect(texB64).not.toBeNull();

    // overlay port 能列出 zip 条目
    const allPaths = await result.port.listAllFilePaths(result.rootPath);
    expect(allPaths).not.toBeNull();
    expect(allPaths!.length).toBe(4); // pmx + 2 png/jpg + vmd
  });
});