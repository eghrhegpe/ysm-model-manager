// ===== mmd-shared.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import * as THREE from "three";
import { safeDispose } from "../safe-dispose.ts";
import { DISPOSE_TEX_KEYS, estimateTexGpuBytes, matTexSlots } from "./mmd-utils.ts";
import type { MmdDataPort } from "./mmd-types.ts";

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
export async function mmdDiag(
  port: MmdDataPort,
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
): Promise<void> {
  try {
    await port.addOpLog(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}

/** 释放 MMD mesh 的全部几何/材质/纹理，并记录统计到环形日志 */
export async function disposeMmdMesh(
  mesh: THREE.SkinnedMesh,
  diag: typeof mmdDiag,
  port: MmdDataPort,
  op: string,
): Promise<void> {
  // 收集材质（单材质 / 多材质数组）
  const allMats: THREE.Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  let texCount = 0;
  let totalGpuBytes = 0;
  for (const mat of allMats) {
    for (const key of DISPOSE_TEX_KEYS) {
      const tex = matTexSlots(mat)[key];
      if (tex instanceof THREE.Texture) {
        totalGpuBytes += estimateTexGpuBytes(tex);
        texCount++;
        safeDispose(tex);
      }
    }
    safeDispose(mat);
  }
  safeDispose(mesh.geometry);
  safeDispose(mesh.skeleton);
  const gpuMb = (totalGpuBytes / (1024 * 1024)).toFixed(1);
  void diag(port, op, `tex=${texCount} gpu≈${gpuMb}MB`, "ok");
}
