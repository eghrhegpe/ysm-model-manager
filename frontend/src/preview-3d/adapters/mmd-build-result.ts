// ===== mmd-build-result.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import { applyVPD } from "@moeru/three-mmd";
import { dbg } from "../../utils/debug/debug.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { unregisterModelRoot } from "../frustum-cull.ts";
import { recordLoadTrace } from "../load-trace.ts";
import { setPerceptionPaused } from "../perception/core.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import { cancelPendingEncodings } from "./mmd-ktx2-encoder.ts";
import { applyVPDToMesh } from "./mmd-vpd-mesh.ts";
import type { PreviewScene } from "./mount-preview-core.ts";
import { disposeMmdMesh, mmdDiag } from "./mmd-shared.ts";
import { mdMmStage5Menu } from "./mmd-build-menu.ts";
import type { MdMmStage6Ctx, MdMmStage6bCtx } from "./mmd-types.ts";

export function mdMmStage6Result(
  c: MdMmStage6Ctx,
  s5: ReturnType<typeof mdMmStage5Menu>,
  tStart: number,
): PreviewScene {
  const {
    semanticBones,
    semanticMorphs,
    breath,
    gaze,
    blink,
    lipSync,
    lipIndices,
    autoDance,
    footIK,
    items,
  } = s5;
  let lipSyncTime = s5.lipSyncTime;
  const result: PreviewScene = {
    menuItems: items,
    update: (dt: number): void => {
      // #9 全局暂停标志：动画激活（action 存在且未暂停）时感知 controller 全部静默，
      // 取代原先散布在各 if 上的 `!c.action || c.action.paused` 守卫。
      setPerceptionPaused(!!c.action && !c.action.paused);
      if (c.cameraMixer && c.cameraAction && !c.cameraAction.paused) {
        c.cameraMixer.update(dt);
        const cam = c.ctx.camera;
        if (cam) {
          cam.position.copy(c.cameraAnimRoot.position);
          cam.quaternion.copy(c.cameraAnimRoot.quaternion);
          cam.fov = c.cameraAnimRoot.fov;
          cam.updateProjectionMatrix();
        }
        if (c.ctx.controls) c.ctx.controls.target.copy(c.cameraAnimTarget.position);
      }
      if (!c.mesh.visible) return;
      c.mmd?.updateWithMixer(dt, c.mixer, { ik: true, grant: true });
      if (semanticBones) {
        if (c.perceptionState.breath)
          breath.apply(dt, semanticBones);
        // camera 可选（self 模式 undefined）：缺失时 gaze 无法取观察点 → 跳过
        // gaze 不挂全局暂停标志（注视相机属摄像机追踪，非动画优先级——保持动画中也跟随）
        if (c.perceptionState.gaze && c.ctx.camera)
          gaze.apply(dt, semanticBones, c.ctx.camera.position);
      }
      const blinkEntry = semanticMorphs.blink;
      if (
        blinkEntry &&
        c.mesh.morphTargetDictionary &&
        c.mesh.morphTargetInfluences &&
        c.perceptionState.blink
      ) {
        const idx = c.mesh.morphTargetDictionary[blinkEntry.name];
        if (idx !== undefined) {
          // 局部 const 收窄替代 !：回调闭包内 TS 不保持 c.mesh.morphTargetInfluences 的收窄
          const influences = c.mesh.morphTargetInfluences;
          blink.apply(dt, (weight: number) => {
            influences![idx] = weight;
          });
        }
      }
      if (lipIndices && c.perceptionState.lipSync) {
        lipSyncTime += dt;
        const breathPhase = Math.sin((lipSyncTime / 2.5) * Math.PI * 2);
        const openAmp = Math.max(0, breathPhase) * 0.4;
        // lipSync 分支缺 morphTargetInfluences 前置守卫——回调闭包内一并校验，替代 !
        const influences = c.mesh.morphTargetInfluences;
        lipSync.applyMulti(dt, { lipOpen: openAmp }, (morphId, weight) => {
          const idx =
            morphId === "lipOpen"
              ? lipIndices.open
              : morphId === "lipClose"
                ? lipIndices.close
                : morphId === "lipPucker"
                  ? lipIndices.pucker
                  : morphId === "lipSmile"
                    ? lipIndices.smile
                    : undefined;
          if (idx !== undefined && influences) influences[idx] = weight;
        });
      }
      const isIdle = !(c.action && !c.action.paused);
      footIK.apply(dt, isIdle);
      if (c.perceptionState.autoDance) {
        autoDance.apply(dt, semanticBones ?? {});
      }
    },
    dispose: (): void => mdMmStage6Dispose(c, s5),
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(c.ctx.renderer!, c.ctx.scene, c.ctx.camera)),
    semanticBones,
    applyPose:
      c.vpdPoses.length > 0
        ? (index: number): void => {
            const pose = c.vpdPoses[index];
            if (!pose) return;
            try {
              // workerMode 已下沉：worker 构建路径等价于 c.workerResult 非空
              if (c.workerResult) {
                applyVPDToMesh(c.mesh!, pose.vpd);
              } else {
                applyVPD(c.mmd!, pose.vpd, { ik: true, grant: true });
              }
            } catch (e) {
              dbg("mmd", { op: "apply-vpd-fail", index, err: safeErrorMessage(e) });
            }
          }
        : undefined,
  };
  mdMmStage6bTrace(c, tStart);
  return result;
}

// 6b-dispose：scene graph 拆解 → mixers → 感知释放 → 资源 dispose（自包含，仅消费 c + s5）
function mdMmStage6Dispose(
  c: MdMmStage6Ctx,
  s5: ReturnType<typeof mdMmStage5Menu>,
): void {
  const { breath, gaze, blink, lipSync, autoDance, footIK } = s5;
  const renderer = c.ctx.renderer;
  if (renderer) {
    const memBefore = (
      renderer as unknown as { info?: { memory?: { geometries: number; textures: number } } }
    ).info?.memory;
    if (memBefore) {
      dbg(
        "gpu-leak",
        `mmd dispose before: geometries=${memBefore.geometries} textures=${memBefore.textures}`,
      );
    }
  }
  try {
    c.bonePanelRef.current?.();
    // 从 scene 移除 mesh（disposeMmdMesh 只释放 GPU 资源，不处理 scene graph 引用）
    c.ctx.scene?.remove(c.mesh);
    unregisterModelRoot(c.mesh);
    c.mixer.stopAllAction();
    c.mixer.uncacheRoot(c.mesh);
    c.cameraMixer?.stopAllAction();
    breath.dispose();
    gaze.dispose();
    blink.dispose();
    lipSync.dispose();
    autoDance.dispose();
    footIK.dispose();
  } catch (e) {
    dbg("mmd", { op: "dispose-aux-fail", err: safeErrorMessage(e) });
  } finally {
    cancelPendingEncodings();
    c.stopLongTaskWatch();
    for (const url of c.blobUrls) URL.revokeObjectURL(url);
  }
  try {
    disposeMmdMesh(c.mesh, mmdDiag, c.port, "dispose-tex");
    c.mmd?.dispose();
    // KTX2Loader 内部持有 WASM 解码器 + worker pool，不 dispose 会泄漏
    c.ktx2Loader?.dispose();
    c.ktx2CacheLoader?.dispose();
  } catch (e) {
    dbg("mmd", { op: "dispose-mesh-fail", err: safeErrorMessage(e) });
  }
  if (renderer) {
    const memAfter = (
      renderer as unknown as { info?: { memory?: { geometries: number; textures: number } } }
    ).info?.memory;
    if (memAfter) {
      dbg(
        "gpu-leak",
        `mmd dispose after: geometries=${memAfter.geometries} textures=${memAfter.textures}`,
      );
    }
  }
}

function mdMmStage6bTrace(c: MdMmStage6bCtx, tStart: number): void {
  c.tBuildEnd = performance.now();
  c.buildSucceeded = true;
  const _stages: import("../load-trace.ts").LoadTraceStage[] = [];
  if (c.tParseStart > 0)
    _stages.push({ name: "读取", ms: Math.round(c.tParseStart - tStart), status: "ok" });
  if (c.tParseEnd > 0)
    _stages.push({ name: "解析", ms: Math.round(c.tParseEnd - c.tParseStart), status: "ok" });
  if (c.textureLoadedAt > 0)
    _stages.push({
      name: "纹理加载",
      ms: Math.round(c.textureLoadedAt - c.tParseEnd),
      status: "ok",
    });
  if (c.tBuildEnd > c.tParseEnd)
    _stages.push({ name: "build", ms: Math.round(c.tBuildEnd - c.tParseEnd), status: "ok" });
  const _mats = Array.isArray(c.mmd?.mesh?.material)
    ? c.mmd.mesh.material
    : c.mmd?.mesh?.material
      ? [c.mmd.mesh.material]
      : [];
  const _texDetails: import("../load-trace.ts").LoadTraceTexture[] = [];
  for (const m of _mats) {
    const img = (m as { map?: { image?: HTMLImageElement } })?.map?.image;
    if (img?.width && img?.height) {
      const src = (m as { map?: { source?: { src?: string } } })?.map?.source?.src ?? "";
      _texDetails.push({
        path: src.split("/").pop() ?? "texture",
        size: `${img.width}x${img.height}`,
      });
    }
  }
  recordLoadTrace({
    ts: Date.now(),
    format: "mmd",
    path: c.origPath,
    stages: _stages,
    assets: {
      files: c._traceFiles,
      textures: _texDetails.length,
      bones: c.mmd?.pmx?.bones?.length ?? 0,
      materials: c.mmd?.pmx?.materials?.length ?? _mats.length,
      morphs: c.mmd?.pmx?.morphs?.length ?? 0,
      animations: c.clips.length,
      pmxWorker: c.usePmxWorker,
      ktx2Hits: c.cachedHashes?.size ?? 0,
      ktx2Total: c.blobUrlToHash.size,
    },
    textureDetails: _texDetails,
    gpuMb: c._traceGpuMb,
    ok: true,
  });
}
