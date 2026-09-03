// ===== mmd-build-scene.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { dbg } from "../../utils/debug/debug.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { b64ToBytes, bytesToArrayBuffer } from "../base64.ts";
import { registerModelRoot } from "../frustum-cull.ts";
import { scheduleBackgroundEncoding } from "./mmd-ktx2-encoder.ts";
import { DISPOSE_TEX_KEYS, matTexSlots } from "./mmd-utils.ts";
import { mdMmTrackAlloc, mmdDiag } from "./mmd-shared.ts";
import type { MdMmStage3Ctx } from "./mmd-types.ts";

export async function mdMmStage3SceneMesh(c: MdMmStage3Ctx): Promise<void> {
  c.buildSucceeded = false;
  // 拆分前：scene 缺失 / bb 失败的守卫 return 会短路整个 stage3（KTX2 缓存读 3.2
  // 与后台编码写 3.3 一并跳过）——守卫拆到 3.1 后须在此恢复短路语义，防未挂载模型
  // 仍触发缓存 hydrate/dispose 与 saveCachedTexture 持久化（376d07ac 回归点）。
  if (!(await mdMmStage3MountAndDebug(c))) return;
  await mdMmStage3Ktx2Hydrate(c);
  await mdMmStage3Ktx2Schedule(c);
}

// 3.1 挂载 + 网格调试诊断（scene 守卫 → add → registerModelRoot → boundingBox diag）
// 返回是否完成挂载（false = 守卫命中跳过挂载，调用方须短路 3.2/3.3）
async function mdMmStage3MountAndDebug(c: MdMmStage3Ctx): Promise<boolean> {
  // 结构化守卫替代 !：scene 可选（self 模式适配器自驱 renderer 时为 undefined）
  const scene = c.ctx.scene;
  if (!scene) {
    await mmdDiag(
      c.effectivePort,
      "mesh-debug",
      c.effectivePath,
      "warn",
      "共享 scene 不可用，跳过挂载",
    );
    return false;
  }
  scene.add(c.mesh);
  registerModelRoot(c.mesh);
  {
    const geo = c.mesh.geometry;
    geo.computeBoundingBox();
    // computeBoundingBox 后 boundingBox 必非空；显式守卫替代 !
    const bb = geo.boundingBox;
    if (!bb) {
      await mmdDiag(
        c.effectivePort,
        "mesh-debug",
        c.effectivePath,
        "warn",
        "几何 boundingBox 计算失败",
      );
      return false;
    }
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    const idx = geo.index;
    const allMats = Array.isArray(c.mesh.material)
      ? c.mesh.material
      : c.mesh.material
        ? [c.mesh.material]
        : [];
    const hasMap = allMats.filter((m) => (m as THREE.MeshStandardMaterial).map).length;
    await mmdDiag(
      c.effectivePort,
      "mesh-debug",
      c.effectivePath,
      "warn",
      `posAttr=${posAttr?.count ?? "null"} idx=${idx?.count ?? "null"} bb=${bb.min.toArray().map((v) => v.toFixed(1))}/${bb.max.toArray().map((v) => v.toFixed(1))} visible=${c.mesh.visible} frustumCulled=${c.mesh.frustumCulled} mats=${allMats.length} hasMap=${hasMap} wm=${c.mesh.matrixWorld.elements[12].toFixed(1)},${c.mesh.matrixWorld.elements[13].toFixed(1)},${c.mesh.matrixWorld.elements[14].toFixed(1)} worldPos=${c.mesh
        .getWorldPosition(new THREE.Vector3())
        .toArray()
        .map((v) => v.toFixed(1))}`,
    );
  }
  c.ctx.loadingEl.remove();
  c.cachedHashes = null;
  return true;
}

// 3.2 KTX2 缓存命中 → 按 hash 聚槽 → 单次解码替换（读路径）
async function mdMmStage3Ktx2Hydrate(c: MdMmStage3Ctx): Promise<void> {
  if (c.blobUrlToHash.size > 0 && c.ctx.renderer) {
    // ADR-072：适配器 0 backend import——KTX2 缓存经 port 注入（壳层实现）；
    // port 缺方法（可选）→ 跳过缓存优化（保留原 typeof-function 守卫语义）
    const hasCachedTextures = c.effectivePort.hasCachedTextures;
    const getCachedTextureByHash = c.effectivePort.getCachedTextureByHash;
    if (typeof hasCachedTextures === "function" && typeof getCachedTextureByHash === "function") {
      const allHashes = [...new Set(c.blobUrlToHash.values())];
      const cacheStatus = (await hasCachedTextures(allHashes)) ?? {};
      c.cachedHashes = new Set(allHashes.filter((h) => cacheStatus[h]));
      if (c.cachedHashes.size > 0) {
        c.ktx2CacheLoader = new KTX2Loader()
          .setTranscoderPath("/basis/")
          .detectSupport(c.ctx.renderer);
        // KTX2 缓存 loader 分配即登记失败释放（2026-09-03 注册表化）
        mdMmTrackAlloc(c, "ktx2CacheLoader", () => c.ktx2CacheLoader?.dispose());
        const allMats: THREE.Material[] = Array.isArray(c.mesh.material)
          ? c.mesh.material
          : c.mesh.material
            ? [c.mesh.material]
            : [];
        // P2-6（审核）：按 hash 聚合材质槽，一个 hash 只 loadAsync 一次——原逐槽替换
        // 会让共享同一纹理的 N 个材质槽各解码一次 KTX2（three-mmd 用 ctx.textures[fullPath]
        // 缓存共享身份），浪费 GPU 内存且破坏纹理共享。聚合后同一 hash 的所有槽
        // 赋同一份 CompressedTexture 实例，保持与原纹理一致的共享语义。
        const slotsByHash = new Map<string, Array<{ mat: THREE.Material; key: string }>>();
        for (const mat of allMats) {
          for (const key of DISPOSE_TEX_KEYS) {
            const tex = matTexSlots(mat)[key];
            if (!(tex instanceof THREE.Texture)) continue;
            const img = tex.image as HTMLImageElement | undefined;
            if (!img?.src?.startsWith("blob:")) continue;
            const hash = c.blobUrlToHash.get(img.src);
            if (!hash || !c.cachedHashes.has(hash)) continue;
            const arr = slotsByHash.get(hash);
            if (arr) arr.push({ mat, key });
            else slotsByHash.set(hash, [{ mat, key }]);
          }
        }
        // 逐 hash 单次替换：loadAsync 一次 → 同一份压缩纹理赋给所有共享槽
        const replaceTasks: Array<Promise<void>> = [];
        for (const [hash, slots] of slotsByHash) {
          replaceTasks.push(
            getCachedTextureByHash(hash).then((ktx2B64) => {
              if (!ktx2B64) return;
              const ktxBytes = b64ToBytes(ktx2B64);
              const ktxBlob = new Blob([bytesToArrayBuffer(ktxBytes)]);
              const ktxUrl = URL.createObjectURL(ktxBlob);
              c.blobUrls.push(ktxUrl);
              return (
                c.ktx2CacheLoader!
                  .loadAsync(ktxUrl)
                  .then((compressedTex) => {
                    for (const { mat, key } of slots) {
                      const prev = matTexSlots(mat)[key];
                      matTexSlots(mat)[key] = compressedTex;
                      if (prev instanceof THREE.Texture) prev.dispose();
                      mat.needsUpdate = true;
                    }
                  })
                  // KTX2 缓存替换失败 → 保留原纹理，不阻断批量替换（链保持 resolve，
                  // 供外层 Promise.all await 与 replaced= 计数——不可改 fire-and-forget）
                  .catch((err) =>
                    dbg("ktx2-replace-fail", { hash, slots: slots.length, err: safeErrorMessage(err) }),
                  )
              );
            }),
          );
        }
        await Promise.all(replaceTasks);
        await mmdDiag(
          c.effectivePort,
          "ktx2-replace",
          "cache-hit",
          "ok",
          `cached=${c.cachedHashes.size} replaced=${replaceTasks.length} slots=${slotsByHash.size} total=${allHashes.length}`,
        );
      } else {
        await mmdDiag(
          c.effectivePort,
          "ktx2-replace",
          "cache-miss",
          "warn",
          `total=${allHashes.length}（缓存未命中，将后台编码）`,
        );
      }
    }
  }
}

// 3.3 后台编码调度（写路径持久化通道，gate = saveCachedTexture）
async function mdMmStage3Ktx2Schedule(c: MdMmStage3Ctx): Promise<void> {
  // P2-3（审核）：后台编码 gate 从「已废弃 getCachedTexture」改为 saveCachedTexture——
  // 读路径已用 hasCachedTextures/getCachedTextureByHash，写路径真正需要的是持久化通道；
  // 原 gate 挂在废弃方法上，一旦按「已废弃」清理会静默停掉后台编码（缓存永不写入）。
  if (c.blobUrlToHash.size > 0 && c.effectivePort.saveCachedTexture) {
    // 局部 const 收窄替代 !：filter 闭包内 TS 不保持 c.cachedHashes 的收窄
    const cachedHashes = c.cachedHashes;
    const toEncode = cachedHashes
      ? new Map([...c.blobUrlToHash].filter(([, h]) => !cachedHashes.has(h)))
      : c.blobUrlToHash;
    if (toEncode.size > 0) {
      scheduleBackgroundEncoding(toEncode, c.port);
    }
  }
}
