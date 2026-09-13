// ===== MMD 纹理解码器（Worker 池）单元测试 =====
// P2-4：Worker 崩溃 → fail-fast 清算在途任务 + 重建替补（不再空等 8s 超时）
// P2-5：closeUnusedDecodedBitmaps 只关 refCount<=0 的位图（未应用的不泄漏）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  getTextureDecoder,
  disposeTextureDecoder,
  closeUnusedDecodedBitmaps,
  createTextureDecoder,
  applyWorkerDecodedTextures,
  type DecodedTexture,
} from "./mmd-texture-decoder.ts";

/** 可编程假 Worker：postMessage 后回包或触发崩溃 */
let respondWith: ((id: number) => "ok" | "fail" | "crash") | null = null;
let createdWorkers: FakeDecodeWorker[] = [];
/** 回包延迟 ms（> timeoutMs 时模拟超时场景） */
let responseDelayMs = 0;
/** 最近创建的假位图（用于断言 late response 是否 close） */
let createdBitmaps: ImageBitmap[] = [];

class FakeDecodeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    createdWorkers.push(this);
  }
  postMessage(msg: { id: number; relPath: string }): void {
    setTimeout(() => {
      const r = respondWith?.(msg.id) ?? "ok";
      if (r === "crash") {
        this.onerror?.();
        return;
      }
      if (r === "fail") {
        this.onmessage?.({
          data: { id: msg.id, relPath: msg.relPath, ok: false, error: "decode fail" },
        });
        return;
      }
      // ok：回传假位图（带 close 间谍）
      const bitmap = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
      createdBitmaps.push(bitmap);
      this.onmessage?.({
        data: { id: msg.id, relPath: msg.relPath, ok: true, bitmap, width: 1, height: 1 },
      });
    }, responseDelayMs);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function installFakeWorker(delayMs = 0): void {
  createdWorkers = [];
  respondWith = null;
  responseDelayMs = delayMs;
  createdBitmaps = [];
  vi.stubGlobal("Worker", FakeDecodeWorker);
}

afterEach(() => {
  disposeTextureDecoder();
  vi.unstubAllGlobals();
  createdWorkers = [];
  respondWith = null;
  responseDelayMs = 0;
  createdBitmaps = [];
});

describe("Worker 崩溃恢复（P2-4）", () => {
  beforeEach(() => {
    installFakeWorker();
  });

  it("正常解码 → 全部回包，bitmap 入结果", async () => {
    const decoder = getTextureDecoder();
    const results = await decoder.decodeAll([
      { relPath: "a.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "b.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    expect(results.size).toBe(2);
    expect(results.get("a.png")?.bitmap).toBeDefined();
    expect(results.get("b.png")?.bitmap).toBeDefined();
  });

  it("某 worker 崩溃 → 该 worker 名下任务 fail-fast 结算，decodeAll 不空等超时", async () => {
    // 4 个 worker，任务 0/1 归 worker0，2/3 归 worker1... 让 worker1 崩（任务 2、3）
    let call = 0;
    respondWith = () => {
      const n = call++;
      // worker0 收 id0/id1；worker1 收 id2/id3（round-robin：id → workerIdx%4）
      // 崩溃触发在 id2 归 worker1 的场景：让 id2、id3 全崩 → worker1.onerror 清算两者
      return n === 2 || n === 3 ? "crash" : "ok";
    };
    const decoder = getTextureDecoder();
    // 用真实超时兜底断言：若崩溃不 fail-fast，decodeAll 要等 8s 才 resolve
    const started = Date.now();
    const results = await decoder.decodeAll([
      { relPath: "0.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "1.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "2.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
      { relPath: "3.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    const elapsed = Date.now() - started;
    // fail-fast：远小于 8s 超时（允许异步调度余量）
    expect(elapsed).toBeLessThan(2000);
    // 崩溃任务（2/3）无结果，正常任务（0/1）有结果
    expect(results.has("0.png")).toBe(true);
    expect(results.has("1.png")).toBe(true);
    expect(results.has("2.png")).toBe(false);
    expect(results.has("3.png")).toBe(false);
  });

  it("崩溃 worker 被 terminate 且池重建替补", async () => {
    let call = 0;
    respondWith = () => (call++ === 0 ? "crash" : "ok");
    const decoder = getTextureDecoder();
    await decoder.decodeAll([
      { relPath: "a.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    // worker0 崩 → 被 terminate → 重建（createdWorkers 会追加替补）
    expect(createdWorkers[0].terminated).toBe(true);
    expect(createdWorkers.length).toBeGreaterThanOrEqual(5); // 4 原始 + ≥1 替补
    // 替补 worker 可继续服务后续任务
    respondWith = () => "ok";
    const results = await decoder.decodeAll([
      { relPath: "b.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);
    expect(results.size).toBe(1);
  });
});

describe("applyWorkerDecodedTextures decode miss 兜底（防永久白模）", () => {
  /** 构造带 pendingTexture 标记的 worker 路径 mesh */
  function makePendingMesh(relPath: string, blobUrl: string): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
    const mat = new THREE.MeshStandardMaterial();
    mat.userData.pendingTexture = { relPath, blobUrl };
    const mesh = { material: mat } as unknown as THREE.Mesh;
    return { mesh, mat };
  }

  /** mock TextureLoader.load：同步回调 onLoad（对齐 fbx-parser.test 的 happy-dom 规避手法） */
  function mockTextureLoader(): { textures: THREE.Texture[] } {
    const textures: THREE.Texture[] = [];
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
      ((_url: string, onLoad?: (tex: THREE.Texture) => void) => {
        const tex = new THREE.Texture();
        textures.push(tex);
        onLoad?.(tex);
        return tex;
      }) as never,
    );
    return { textures };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decode miss → pendingTexture blobUrl 走 TextureLoader 兜底赋 map（sRGB，防永久白模）", () => {
    const { mesh, mat } = makePendingMesh("face.png", "blob:face");
    mockTextureLoader();

    // 解码结果为空（全部 miss）
    const { replaced, total, fallback } = applyWorkerDecodedTextures(mesh, new Map(), new Map());

    expect(fallback).toBe(1);
    expect(replaced).toBe(0);
    expect(total).toBe(0); // pendingTexture 材质不计入 Fallback 路径 total
    const map = (mat as unknown as { map?: THREE.Texture }).map;
    expect(map).toBeDefined();
    expect(map!.colorSpace).toBe(THREE.SRGBColorSpace);
    // three 的 Material.needsUpdate 只有 setter（getter undefined），以 version 递增断言
    expect(mat.version).toBeGreaterThan(0);
  });

  it("decode 命中 → 位图纹理直接赋 map，不触发 TextureLoader 兜底", () => {
    const { mesh, mat } = makePendingMesh("face.png", "blob:face");
    const spy = mockTextureLoader();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const decoded = new Map<string, DecodedTexture>([
      ["face.png", { relPath: "face.png", bitmap, width: 1, height: 1, refCount: 0 }],
    ]);

    const { replaced, fallback } = applyWorkerDecodedTextures(mesh, decoded, new Map());

    expect(replaced).toBe(1);
    expect(fallback).toBe(0);
    expect(spy.textures).toHaveLength(0);
    const map = (mat as unknown as { map?: THREE.Texture }).map;
    expect(map).toBeDefined();
    expect(map!.colorSpace).toBe(THREE.SRGBColorSpace);
    // 位图引用计数 +1（释放链路不变）
    expect(decoded.get("face.png")!.refCount).toBe(1);
  });

  it("兜底纹理来自 TextureLoader，随材质进既有 dispose 链路（map 可被 disposeMmdMesh 释放）", () => {
    const { mat } = makePendingMesh("face.png", "blob:face");
    const { textures } = mockTextureLoader();

    applyWorkerDecodedTextures({ material: mat } as unknown as THREE.Mesh, new Map(), new Map());

    // 兜底纹理是标准 THREE.Texture（HTMLImageElement 载体，flipY 默认 true 与 image 方向一致）
    expect(textures).toHaveLength(1);
    expect(textures[0].flipY).toBe(true);
  });
});

describe("closeUnusedDecodedBitmaps（P2-5）", () => {
  it("refCount=0 的位图被 close；refCount>0 的保留（由纹理 dispose 负责）", () => {
    const unused = { close: vi.fn() } as unknown as ImageBitmap;
    const used = { close: vi.fn() } as unknown as ImageBitmap;
    const decoded = new Map<string, DecodedTexture>([
      ["unused.png", { relPath: "unused.png", bitmap: unused, width: 1, height: 1, refCount: 0 }],
      ["used.png", { relPath: "used.png", bitmap: used, width: 1, height: 1, refCount: 2 }],
    ]);
    closeUnusedDecodedBitmaps(decoded);
    expect(unused.close).toHaveBeenCalledTimes(1);
    expect(used.close).not.toHaveBeenCalled();
    // 已应用的位图不动，refCount 保持
    expect(decoded.get("used.png")!.refCount).toBe(2);
  });

  it("重复调用幂等（已关的位图 refCount=-1 标记不再关）", () => {
    const bmp = { close: vi.fn() } as unknown as ImageBitmap;
    const decoded = new Map<string, DecodedTexture>([
      ["a.png", { relPath: "a.png", bitmap: bmp, width: 1, height: 1, refCount: 0 }],
    ]);
    closeUnusedDecodedBitmaps(decoded);
    closeUnusedDecodedBitmaps(decoded);
    expect(bmp.close).toHaveBeenCalledTimes(1);
  });
});

describe("超时 late response 位图清理（GPU 泄漏修复）", () => {
  it("超时后 worker 迟到 response 携带的 ImageBitmap 须 close 防 GPU 泄漏", async () => {
    // 超时时间 20ms，worker 延迟 50ms 回包 → 任务先超时结算，后收到迟到 response
    installFakeWorker(50);
    const decoder = createTextureDecoder({ maxWorkers: 1, timeoutMs: 20 });

    const results = await decoder.decodeAll([
      { relPath: "slow.png", bytes: new ArrayBuffer(4), mimeType: "image/png" },
    ]);

    // 超时任务不入结果
    expect(results.size).toBe(0);
    // 等待 worker 迟到回包触发（50ms 延迟 + 余量）
    await vi.waitFor(() => expect(createdBitmaps).toHaveLength(1), { timeout: 200 });
    // worker 迟到回包 → close 位图
    const closeSpy = createdBitmaps[0].close;
    expect(closeSpy).toHaveBeenCalledTimes(1);

    decoder.dispose();
  });
});
