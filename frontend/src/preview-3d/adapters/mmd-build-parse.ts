// ===== mmd-build-parse.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import { MMDLoader } from "@moeru/three-mmd";
import { MMDAmmoPlugin } from "@moeru/three-mmd-physics-ammo";
import * as THREE from "three";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { buildPmxScene } from "./mmd-pmx-parser.ts";
import { applyWorkerDecodedTextures, closeUnusedDecodedBitmaps } from "./mmd-texture-decoder.ts";
import type { DecodedTexture } from "./mmd-texture-decoder.ts";
import { mmdDiag } from "./mmd-shared.ts";
import type { MdMmParsePmdCtx, MdMmParsePmxCtx } from "./mmd-types.ts";

export async function mdMmParsePmxStage(c: MdMmParsePmxCtx): Promise<void> {
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
            `vertices=${pmxResult.vertices.count} faces=${pmxResult.faces.count} bones=${pmxResult.bones?.length ?? 0} mats=${pmxResult.materials?.length ?? 0} (Worker path)`,
          );
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

export async function mdMmParsePmdStage(c: MdMmParsePmdCtx): Promise<void> {
  if (c.workerResult) {
    c.mesh = c.workerResult.mesh;
    c.tParseStart = performance.now();
    c.tParseEnd = c.tParseStart;
    c.mmd = {
      mesh: c.workerResult.mesh,
      pmx: c.pmxParsedData
        ? {
            bones: c.pmxParsedData.bones ?? [],
            materials: c.pmxParsedData.materials ?? [],
            morphs: c.pmxParsedData.morphs ?? [],
          }
        : undefined,
      updateWithMixer: () => {},
      dispose: () => {},
    } as unknown as Awaited<ReturnType<MMDLoader["loadAsync"]>>;
    if (c.pmxParsedData?.bones && c.pmxParsedData.bones.some((b) => b.hasIK)) {
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
  } else {
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
    c.pmxParser?.dispose();
  }
  if (c.decodedTexturesPromise) {
    // P2-5（审核）：decoded 提到 try 外声明——apply 抛错路径也能 close 未命中位图
    let decoded: Map<string, DecodedTexture> | null = null;
    try {
      decoded = await c.decodedTexturesPromise;
      const allMats2: THREE.Material[] = Array.isArray(c.mesh.material)
        ? c.mesh.material
        : c.mesh.material
          ? [c.mesh.material]
          : [];
      const pendingMats = allMats2.filter(
        (m) => (m.userData as Record<string, unknown>)?.pendingTexture,
      );
      if (pendingMats.length === 0 && decoded.size > 0) {
        await mmdDiag(
          c.effectivePort,
          "tex-decode-apply",
          c.effectivePath,
          "warn",
          `decoded=${decoded.size} bitmaps but 0 materials have pendingTexture! mats=${allMats2.length} userDatas=[${allMats2.map((m) => Object.keys(m.userData || {}).join(",")).join("|")}]`,
        );
      } else if (decoded.size > 0) {
        const { replaced, total } = applyWorkerDecodedTextures(c.mesh, decoded, c.blobUrlToRel);
        if (replaced > 0) {
          await mmdDiag(
            c.effectivePort,
            "tex-decode-apply",
            c.effectivePath,
            "ok",
            `worker-decoded=${replaced}/${total} textures (${decoded.size} bitmaps from workers)`,
          );
        } else {
          await mmdDiag(
            c.effectivePort,
            "tex-decode-apply",
            c.effectivePath,
            "warn",
            `decoded=${decoded.size} bitmaps but replaced=0 (PMX路径与磁盘路径可能不匹配, pendingTexture keys=[...查环形日志tex-decode-dispatch])`,
          );
        }
      }
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
}
