// ===== buildPmxScene / buildPmxSceneSliced 根骨骼挂载测试 =====
// 回归锁（review P3）：PMX 常有多个根骨骼（parentBoneIndex < 0，如「操作中心」+
// 「全ての親」），漏挂的根及整棵子树成为孤儿 → matrixWorld 不更新 →
// calculateInverses() 用 identity 算逆矩阵 → 蒙皮把顶点拉到骨骼世界位置
//（「空气角色」/几何放大 N 倍）。本测试锁死 attachRootBones：所有根骨骼
// 都挂到 mesh，且子树骨骼 matrixWorld 平移非零（判别性断言，见 assertRootsAttached）。
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import * as THREE from "three";
import {
  buildPmxScene,
  buildPmxSceneSliced,
  createPmxParser,
} from "./mmd-pmx-parser.ts";
import type { PmxParseResponse } from "./mmd-pmx-parser.worker.ts";

/** 合成 PMX 解析结果：2 个根骨骼（parent=-1）+ 1 个子骨骼 + 最小顶点/面 */
function syntheticPmx(): PmxParseResponse {
  return {
    id: 0,
    ok: true,
    vertices: {
      count: 3,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      boneIndices: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      boneWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    },
    faces: {
      count: 3,
      indices: new Uint32Array([0, 1, 2]),
    },
    textures: [],
    materials: [],
    bones: [
      { name: "rootA", englishName: "", parentBoneIndex: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false },
      { name: "rootB", englishName: "", parentBoneIndex: -1, position: [0, 10, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false },
      { name: "child", englishName: "", parentBoneIndex: 1, position: [0, 5, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false },
    ],
    rigidBodies: [],
    joints: [],
    morphs: [],
    displayFrames: [],
  };
}

/** 断言：所有根骨骼都挂到 mesh.children，且子骨骼 matrixWorld 平移非零（漏挂 → identity → 零平移 → 失败） */
function assertRootsAttached(mesh: THREE.SkinnedMesh, pmx: PmxParseResponse): void {
  // 所有根骨骼（parent < 0）都在 mesh.children
  const rootNames = pmx.bones!.filter((b) => b.parentBoneIndex < 0).map((b) => b.name);
  const childNames = mesh.children.map((c) => (c as THREE.Bone).name);
  for (const name of rootNames) {
    expect(childNames).toContain(name);
  }
  // 判别性断言（review 三轮 P3：identity 断言是同义反复——skeleton.update() 会按当前
  // matrixWorld 重算 boneInverse，乘积恒为 I；漏挂时孤儿骨骼 matrixWorld 也是 identity，
  // 乘积照样 I，测不出回归）。真正判别：漏挂的根及其子树 matrixWorld 停留 identity
  //（平移零），挂载后子骨骼应有非零世界平移。这里不调 skeleton.update()（只刷新
  // matrixWorld），确保断言基于 bind 时算出的 inverse 对应的 matrixWorld。
  // ⚠️ review 四轮 P2：按 name 从 skeleton.bones 解析（不能用 pmx.bones 的索引直接
  // 索引 skeleton.bones——两数组 1:1 对齐从未验证，fixture 改名或切片版剪枝会
  // undefined 崩溃 / 假通过）。
  mesh.updateMatrixWorld(true);
  const childBone = mesh.skeleton.bones.find((b) => b.name === "child");
  expect(childBone).toBeDefined(); // 找不到 → 可读失败信息，而非 undefined 崩溃
  const childPos = childBone!.getWorldPosition(new THREE.Vector3());
  expect(childPos.lengthSq()).toBeGreaterThan(0.01); // 漏挂根 → 子树 identity → 零平移 → 失败
}

describe("buildPmxScene — 多根骨骼挂载", () => {
  it("两个根骨骼都挂到 mesh（漏挂 → 蒙皮拉飞「空气角色」回归）", () => {
    const pmx = syntheticPmx();
    const result = buildPmxScene(pmx, { texUrlMap: new Map() });
    expect(result).not.toBeNull();
    assertRootsAttached(result!.mesh, pmx);
  });

  it("单根骨骼：attachRootBones 不误挂多余子骨骼", () => {
    const pmx = syntheticPmx();
    // 只有一个根：把 rootB 改成 rootA 的子骨骼
    pmx.bones![1].parentBoneIndex = 0;
    const result = buildPmxScene(pmx, { texUrlMap: new Map() });
    expect(result).not.toBeNull();
    const mesh = result!.mesh;
    expect(mesh.children.map((c) => (c as THREE.Bone).name)).toEqual(["rootA"]);
  });
});

describe("buildPmxSceneSliced — 多根骨骼挂载（切片版同锁）", () => {
  it("两个根骨骼都挂到 mesh，蒙皮矩阵 identity", async () => {
    const pmx = syntheticPmx();
    const result = await buildPmxSceneSliced(pmx, { texUrlMap: new Map() });
    expect(result).not.toBeNull();
    assertRootsAttached(result!.mesh, pmx);
  });
});

// ===== 覆盖率攻坚：createPmxParser（Worker 可用路径）+ 材质/纹理构建 =====

/** 可手动投递响应的 FakeWorker（对齐 createResolveModeBridge 协议） */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  lastId = -1;
  terminated = false;
  static instances: FakeWorker[] = [];
  postMessage(msg: { id: number }): void {
    this.lastId = msg.id;
    FakeWorker.instances.push(this);
  }
  respond(resp: unknown): void {
    this.onmessage?.({ data: resp });
  }
  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

/** 带材质 + 纹理 + 骨骼层级的 PMX fixture（材质/骨骼构建分支用） */
function pmxWithMaterials(): PmxParseResponse {
  const base = syntheticPmx();
  return {
    ...base,
    textures: ["tex/face.png"],
    // 半透明 + 双面 + 纹理引用 / 不透明单面 + 无纹理（仅 builder 消费的字段）
    materials: [
      { name: "服", diffuse: [0.5, 0.2, 0.1, 0.5], flags: 0x01, textureIndex: 0 },
      { name: "肌", diffuse: [1, 1, 1, 1], flags: 0, textureIndex: -1 },
    ] as unknown as PmxParseResponse["materials"],
  };
}

describe("createPmxParser（Worker 可用路径）", () => {
  it("无 Worker（受限环境）→ always-fail parser（调用方 fallback 主线程）", async () => {
    vi.stubGlobal("Worker", undefined);
    const parser = createPmxParser();
    await expect(parser.parse(new ArrayBuffer(4))).resolves.toMatchObject({
      ok: false,
      error: "Worker 不可用（测试/受限环境）",
    });
    expect(() => parser.dispose()).not.toThrow();
  });

  it("Worker 存在 → 真实 bridge：parse 注入 id 发请求、响应经工厂接线结算、dispose 终止 worker", async () => {
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    const parser = createPmxParser();
    const bytes = new ArrayBuffer(8);
    const p = parser.parse(bytes);
    const worker = FakeWorker.instances.at(-1)!;
    expect(worker).toBeDefined();
    expect(worker.lastId).toBeGreaterThanOrEqual(0); // bridge 注入请求 id
    // 2026-08-30 修复：createResolveModeBridge 工厂内已接线 worker.onmessage →
    // bridge.handleMessage（1575cc08，409b060e 重构丢失的接线恢复）——响应正常结算，
    // 不再需要 30s 超时回退。此处正向锁「响应路径」：投递响应 → parse Promise 结算 ok:true。
    worker.respond({ id: worker.lastId, ok: true });
    await expect(p).resolves.toMatchObject({ ok: true });
    parser.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("worker 无响应 → 超时以 ok:false 结算（resolve-mode 语义）", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
      const parser = createPmxParser();
      const p = parser.parse(new ArrayBuffer(4));
      const assertion = expect(p).resolves.toMatchObject({
        ok: false,
        error: "PMX 解析超时（>30s）",
      });
      await vi.advanceTimersByTimeAsync(30001);
      await assertion;
      parser.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildPmxScene — 材质/纹理构建", () => {
  it("材质 diffuse/flags/纹理映射：半透明 + DoubleSide + texUrlMap 命中建纹理", () => {
    const pmx = pmxWithMaterials();
    const texUrlMap = new Map<string, string>([
      ["tex/face.png", "blob:tex-full"],
      ["face.png", "blob:tex-base"],
    ]);
    // TextureLoader.load 同步回包（happy-dom 无真实图像解码）→ 锁 onLoad 材质接线
    const loadSpy = vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
      function (this: THREE.TextureLoader, _url: string, onLoad?: (t: THREE.Texture) => void) {
        const tex = new THREE.Texture();
        onLoad?.(tex);
        return tex;
      } as typeof THREE.TextureLoader.prototype.load,
    );
    try {
      const result = buildPmxScene(pmx, { texUrlMap });
      expect(result).not.toBeNull();
      expect(loadSpy).toHaveBeenCalledTimes(1);
      const [matA, matB] = result!.materials;
      expect(matA.name).toBe("服");
      expect(matA.transparent).toBe(true); // diffuse.a = 0.5 < 1
      expect(matA.side).toBe(THREE.DoubleSide); // flags & 0x01
      expect(matA.map).toBeInstanceOf(THREE.Texture); // onLoad 接线：mat.map 赋值（needsUpdate 为 setter-only，不可读）
      expect(matB.transparent).toBe(false);
      expect(matB.side).toBe(THREE.FrontSide);
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("无根骨骼（全为子骨骼）→ attachRootBones 兜底挂 bones[0]", () => {
    const pmx = syntheticPmx();
    pmx.bones![0].parentBoneIndex = 1; // rootA 变 rootB 的子
    pmx.bones![1].parentBoneIndex = 0; // rootB 变 rootA 的子（人为无根环）
    const result = buildPmxScene(pmx, { texUrlMap: new Map() });
    expect(result).not.toBeNull();
    // 兜底：bones[0] 挂到 mesh（防孤儿根整树不更新 matrixWorld）
    expect(result!.mesh.children).toContain(result!.bones[0]);
  });
});

describe("buildPmxSceneSliced — 材质/纹理构建（切片版同锁）", () => {
  it("材质 diffuse/flags/纹理映射与同步版一致（basename 兜底命中）", async () => {
    const pmx = pmxWithMaterials();
    // sliced 版对 texPath 统一 lowercase 后查表 → 仅注册 basename 键也命中
    const texUrlMap = new Map<string, string>([["face.png", "blob:tex-base"]]);
    const result = await buildPmxSceneSliced(pmx, { texUrlMap });
    expect(result).not.toBeNull();
    const [matA, matB] = result!.materials;
    expect(matA.name).toBe("服");
    expect(matA.transparent).toBe(true);
    expect(matA.side).toBe(THREE.DoubleSide);
    expect(matB.side).toBe(THREE.FrontSide);
    // 延迟纹理挂 pendingTexture（worker 解码完成后同步应用）
    expect((matA.userData as { pendingTexture?: unknown }).pendingTexture).toBeDefined();
  });
});
