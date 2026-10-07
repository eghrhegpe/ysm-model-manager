// ===== mmd-build-parse.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import { MMDLoader } from "@moeru/three-mmd";
import { MMDAmmoPlugin } from "@moeru/three-mmd-physics-ammo";
import type * as THREE from "three";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { buildPmxScene } from "./mmd-pmx-parser.ts";
import { disposeMmdMesh, mmdDiag, trackAlloc } from "./mmd-shared.ts";
import type { DecodedTexture } from "./mmd-texture-decoder.ts";
import { applyWorkerDecodedTextures, closeUnusedDecodedBitmaps } from "./mmd-texture-decoder.ts";
import type { ParsePmdCtx, ParsePmxCtx } from "./mmd-types.ts";
import { materialList } from "./mmd-utils.ts";

/**
 * worker 路径伪造 mmd 的 updateWithMixer（P0 review 修复）：
 * 真实 MMD.updateWithMixer(delta, mixer, options) 语义中 mixer.update(delta) 是动画推进主体
 * （options 仅作用 physics/IK，worker 路径本就没有）。曾是 no-op → c.mixer.update(dt) 无人调用，
 * worker 路径 VMD 动画永不播放（mmd-build-result.ts 每帧只走 c.mmd?.updateWithMixer(...)）。
 */
export function workerMmdUpdateWithMixer(
  delta: number,
  mixer: { update: (dt: number) => void },
): void {
  mixer.update(delta);
}

export async function parsePmxStage(c: ParsePmxCtx): Promise<void> {
  c.workerResult = null;
  c.pmxParsedData = null;
  if (c.usePmxWorker && c.pmxParsePromise) {
    try {
      const pmxResult = await c.pmxParsePromise;
      c.pmxParsedData = pmxResult;
      if (pmxResult.ok && pmxResult.vertices && pmxResult.faces) {
        c.workerResult = await buildPmxScene(pmxResult, { texUrlMap: c.texMap, sliced: true });
        if (c.workerResult) {
          await mmdDiag(
            c.effectivePort,
            "pmx-worker-build",
            c.effectivePath,
            "ok",
            `vertices=${pmxResult.vertices.count} faces=${pmxResult.faces.count} bones=${pmxResult.bones?.length ?? 0} mats=${pmxResult.materials?.length ?? 0} morphs=${c.workerResult.morphBuilt} (Worker path)`,
          );
          // 非顶点 morph（group/bone/uv）降级可见化：与 IK/物理的 worker-limit 诊断对称，
          // 用户表情/口型异常时可归因到"worker 路径未支持"而非"模型坏了"
          if (c.workerResult.morphSkipped > 0) {
            await mmdDiag(
              c.effectivePort,
              "worker-limit",
              c.effectivePath,
              "warn",
              `non-vertex morphs skipped: ${c.workerResult.morphSkipped}/${pmxResult.morphs?.length ?? 0} (group/bone/uv not supported on worker path)`,
            );
          }
        }
      } else if (!pmxResult.ok) {
        await mmdDiag(
          c.effectivePort,
          "pmx-worker-build",
          c.effectivePath,
          "warn",
          `Worker parse failed: ${pmxResult.error ?? "unknown"} (fallback to MMDLoader)`,
        );
      }
    } catch {
      await mmdDiag(
        c.effectivePort,
        "pmx-worker-build",
        c.effectivePath,
        "warn",
        "Worker parse threw, fallback to MMDLoader",
      );
    }
  }
}

export async function parsePmdStage(c: ParsePmdCtx): Promise<void> {
  const worker = c.workerResult;
  if (worker) await parsePmdFromWorker(c, worker);
  else await parsePmdWithLoader(c);
  await applyDecodedTexturesStage(c);
}

/** worker 路径装配：worker mesh + 假 mmd（dispose no-op）+ 受限能力诊断（IK/刚体） */
async function parsePmdFromWorker(
  c: ParsePmdCtx,
  worker: NonNullable<ParsePmdCtx["workerResult"]>,
): Promise<void> {
  c.mesh = worker.mesh;
  // 失败释放注册表：worker mesh 分配即登记（值捕获，防后续覆盖漏释放；2026-09-03）
  const workerMesh = c.mesh;
  if (workerMesh) {
    trackAlloc(c, "mesh", () =>
      disposeMmdMesh(workerMesh, mmdDiag, c.effectivePort, "dispose-fail"),
    );
  }
  c.tParseStart = performance.now();
  c.tParseEnd = c.tParseStart;
  c.mmd = {
    mesh: worker.mesh,
    pmx: c.pmxParsedData
      ? {
          bones: c.pmxParsedData.bones ?? [],
          materials: c.pmxParsedData.materials ?? [],
          morphs: c.pmxParsedData.morphs ?? [],
        }
      : undefined,
    updateWithMixer: workerMmdUpdateWithMixer,
    dispose: () => {},
  } as unknown as Awaited<ReturnType<MMDLoader["loadAsync"]>>;
  // worker 假 mmd（dispose no-op）：分配即登记，与主线程 loader 路径对称
  trackAlloc(c, "mmd", () => c.mmd?.dispose());
  if (c.pmxParsedData?.bones?.some((b) => b.hasIK)) {
    await mmdDiag(
      c.effectivePort,
      "worker-limit",
      c.effectivePath,
      "warn",
      "Worker 路径：包含 IK 骨骼的模型，IK 计算将在主线程 fallback 模式下可用",
    );
  }
  if (c.pmxParsedData?.rigidBodies && c.pmxParsedData.rigidBodies.length > 0) {
    await mmdDiag(
      c.effectivePort,
      "worker-limit",
      c.effectivePath,
      "warn",
      `Worker 路径：含 ${c.pmxParsedData.rigidBodies.length} 个刚体，物理模拟需 MMDLoader fallback`,
    );
  }
  c.pmxParser?.dispose();
}

/** 主线程 MMDLoader 路径：loadAsync + 计时/诊断 + 分配登记（mesh 先于 mmd 注册，
 *  dispose 按 push 顺序执行 mesh→mmd，与旧 finally 块一致） */
async function parsePmdWithLoader(c: ParsePmdCtx): Promise<void> {
  const loader = new MMDLoader(c.manager).register(MMDAmmoPlugin);
  c.tParseStart = performance.now();
  try {
    c.mmd = await loader.loadAsync(c.effectivePath);
  } catch (e) {
    // blob 回收由 buildMmdScene 主入口 finally 统一兜底（此处再收会双回收）
    await mmdDiag(c.effectivePort, "parse", c.effectivePath, "fail", safeErrorMessage(e));
    throw e;
  }
  await mmdDiag(
    c.effectivePort,
    "parse",
    c.effectivePath,
    "ok",
    `bones=${c.mmd?.pmx?.bones?.length ?? 0} mats=${c.mmd?.pmx?.materials?.length ?? 0} morphs=${c.mmd?.pmx?.morphs?.length ?? 0}`,
  );
  c.tParseEnd = performance.now();
  // 结构化守卫替代 !：loadAsync 成功返回后 mmd 必非空，但仍显式校验
  // （parse 失败已在上方 throw，走到此处即成功路径）
  if (!c.mmd) {
    throw new Error("MMD parse 返回空结果");
  }
  c.mesh = c.mmd.mesh;
  // 分配即登记失败释放（2026-09-03 注册表化；值捕获防后续覆盖漏释放）
  // mesh 先于 mmd 注册——dispose 按 push 顺序执行，mesh→mmd 与旧 finally 块一致，
  trackAlloc(c, "mesh", () =>
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    disposeMmdMesh(c.mmd!.mesh, mmdDiag, c.effectivePort, "dispose-fail"),
  );
  // mmd 在 mesh 之后注册——dispose 按 push 顺序执行，mesh→mmd 与旧 finally 块一致，
  trackAlloc(c, "mmd", () => c.mmd?.dispose());
  c.pmxParser?.dispose();
}

/** 材质 userData 键名摘要（「0 材质挂 pendingTexture」诊断用的可读清单） */
function describeMaterialUserData(mats: THREE.Material[]): string {
  return mats.map((m) => Object.keys(m.userData || {}).join(",")).join("|");
}

/** 替换结果诊断三态：命中 / 仅兜底 / 全落空（互斥，各自终结） */
async function reportTextureApplyCounts(
  c: ParsePmdCtx,
  decoded: Map<string, DecodedTexture>,
  replaced: number,
  total: number,
  fallback: number,
): Promise<void> {
  if (replaced > 0) {
    await mmdDiag(
      c.effectivePort,
      "tex-decode-apply",
      c.effectivePath,
      "ok",
      `worker-decoded=${replaced}/${total} textures (${decoded.size} bitmaps from workers, fallback=${fallback} via TextureLoader)`,
    );
    return;
  }
  if (fallback > 0) {
    await mmdDiag(
      c.effectivePort,
      "tex-decode-apply",
      c.effectivePath,
      "ok",
      `decode miss 兜底：${fallback}/${total} 材质改走主线程 TextureLoader（pendingTexture blobUrl）`,
    );
    return;
  }
  await mmdDiag(
    c.effectivePort,
    "tex-decode-apply",
    c.effectivePath,
    "warn",
    `decoded=${decoded.size} bitmaps but replaced=0 (PMX路径与磁盘路径可能不匹配, pendingTexture keys=[...查环形日志tex-decode-dispatch])`,
  );
}

/** 解码纹理落材 + 结果诊断：无 pendingTexture 材质时只上报（不落材） */
async function reportDecodedTextureApply(
  c: ParsePmdCtx,
  decoded: Map<string, DecodedTexture>,
): Promise<void> {
  const allMats = materialList(c.mesh.material);
  const pendingMats = allMats.filter(
    (m) => (m.userData as Record<string, unknown>)?.pendingTexture,
  );
  if (pendingMats.length === 0) {
    if (decoded.size > 0) {
      await mmdDiag(
        c.effectivePort,
        "tex-decode-apply",
        c.effectivePath,
        "warn",
        `decoded=${decoded.size} bitmaps but 0 materials have pendingTexture! mats=${allMats.length} userDatas=[${describeMaterialUserData(allMats)}]`,
      );
    }
    return;
  }
  // decode miss 的材质由 applyWorkerDecodedTextures 内部用 pendingTexture.blobUrl 走
  // 主线程 TextureLoader 兜底（fallback 计数），防解码失败永久白模
  const { replaced, total, fallback } = applyWorkerDecodedTextures(c.mesh, decoded, c.blobUrlToRel);
  await reportTextureApplyCounts(c, decoded, replaced, total, fallback);
}

/** worker 解码纹理应用阶段。
 *  P2-5（审核）：decoded 提到 try 外声明——apply 抛错路径也能 close 未命中位图 */
async function applyDecodedTexturesStage(c: ParsePmdCtx): Promise<void> {
  const decodedTexturesPromise = c.decodedTexturesPromise;
  if (!decodedTexturesPromise) return;
  let decoded: Map<string, DecodedTexture> | null = null;
  try {
    decoded = await decodedTexturesPromise;
    await reportDecodedTextureApply(c, decoded);
  } catch {
    await mmdDiag(
      c.effectivePort,
      "tex-decode-apply",
      c.effectivePath,
      "warn",
      "Worker 解码纹理应用失败，使用主线程 fallback",
    );
  }
  // P2-5：apply 收尾（含抛错路径）统一释放未命中位图（refCount 恒 0 的——已应用的
  // 由纹理 dispose 监听归零 close）。防每次失败加载泄漏 N 张 GPU 位图。
  if (decoded) closeUnusedDecodedBitmaps(decoded);
}
