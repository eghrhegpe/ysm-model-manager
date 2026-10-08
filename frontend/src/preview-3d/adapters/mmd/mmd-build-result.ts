// ===== mmd-build-result.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import { applyVPD } from "@moeru/three-mmd";
import type {
  ScreenshotScene,
  SemanticScene,
  UpdateableScene,
} from "@/preview-3d/adapters/mount-preview-core.ts";
import {
  cancelPendingEncodings,
  disposeKtx2WorkerPool,
} from "@/preview-3d/decoder/mmd-ktx2-encoder.ts";
import { unregisterModelRoot } from "@/preview-3d/infra/frustum-cull.ts";
import { recordLoadTrace, TRACE_FORMAT_OTHER } from "@/preview-3d/infra/load-trace.ts";
import { screenshotFromRenderer } from "@/preview-3d/screenshot/screenshot.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { dbg } from "@/utils/debug/debug.ts";
import type { Stage5Menu } from "./mmd-build-menu.ts";
import { disposeMmdMesh, mmdDiag } from "./mmd-shared.ts";
import type { Stage6bCtx, Stage6Ctx } from "./mmd-types.ts";
import { applyVPDToMesh } from "./mmd-vpd-mesh.ts";

/** Stage5Menu 产物（本阶段消费的感知控制器集合 + 菜单项 + 口型计时基准） */
type Stage5State = ReturnType<typeof Stage5Menu>;

/** 口型 morphId → mesh morph 影响槽下标（未登记的口型 → undefined 跳过） */
function resolveLipMorphIndex(
  lipIndices: NonNullable<Stage5State["lipIndices"]>,
  morphId: string,
): number | undefined {
  if (morphId === "lipOpen") return lipIndices.open;
  if (morphId === "lipClose") return lipIndices.close;
  if (morphId === "lipPucker") return lipIndices.pucker;
  if (morphId === "lipSmile") return lipIndices.smile;
  return undefined;
}

/** 相机 VMD 轨道：mixer 推进 + 相机位姿/朝向/fov 与注视点同步 */
function updateCameraAnimation(c: Stage6Ctx, dt: number): void {
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
}

/** 眨眼：语义 morph + mesh morph 字典/影响槽 + 感知开关齐备时才驱动 */
function applyBlinkIfReady(
  c: Stage6Ctx,
  semanticMorphs: Stage5State["semanticMorphs"],
  blink: Stage5State["blink"],
  dt: number,
): void {
  const blinkEntry = semanticMorphs.blink;
  const dict = c.mesh.morphTargetDictionary;
  const influences = c.mesh.morphTargetInfluences;
  if (!blinkEntry || !dict || !influences || !c.perceptionState.blink) return;
  const idx = dict[blinkEntry.name];
  if (idx === undefined) return;
  // 局部 const 收窄替代 !：回调闭包内 TS 不保持 c.mesh.morphTargetInfluences 的收窄
  blink.apply(dt, (weight: number) => {
    influences[idx] = weight;
  });
}

/** 口型驱动：返回推进后的 lipSyncTime（未启用/无映射 → 原值返回） */
function updateLipSync(c: Stage6Ctx, s5: Stage5State, dt: number, lipSyncTime: number): number {
  const lipIndices = s5.lipIndices;
  if (!lipIndices || !c.perceptionState.lipSync) return lipSyncTime;
  const nextTime = lipSyncTime + dt;
  const breathPhase = Math.sin((nextTime / 2.5) * Math.PI * 2);
  const openAmp = Math.max(0, breathPhase) * 0.4;
  // lipSync 分支缺 morphTargetInfluences 前置守卫——回调闭包内一并校验，替代 !
  const influences = c.mesh.morphTargetInfluences;
  s5.lipSync.applyMulti(dt, { lipOpen: openAmp }, (morphId, weight) => {
    const idx = resolveLipMorphIndex(lipIndices, morphId);
    if (idx !== undefined && influences) influences[idx] = weight;
  });
  return nextTime;
}

/** 语义感知驱动：呼吸 / 注视 / 眨眼 / 口型 / 足部 IK / 律动（返回推进后的 lipSyncTime） */
function updatePerception(c: Stage6Ctx, s5: Stage5State, dt: number, lipSyncTime: number): number {
  const { semanticBones, semanticMorphs, breath, gaze, blink, autoDance, footIK } = s5;
  if (semanticBones) {
    if (c.perceptionState.breath) breath.apply(dt, semanticBones);
    // camera 可选（self 模式 undefined）：缺失时 gaze 无法取观察点 → 跳过
    // gaze 不挂全局暂停标志（注视相机属摄像机追踪，非动画优先级——保持动画中也跟随）
    if (c.perceptionState.gaze && c.ctx.camera) {
      gaze.apply(dt, semanticBones, c.ctx.camera.position);
    }
  }
  applyBlinkIfReady(c, semanticMorphs, blink, dt);
  const nextLipSyncTime = updateLipSync(c, s5, dt, lipSyncTime);
  const isIdle = !(c.action && !c.action.paused);
  footIK.apply(dt, isIdle);
  if (c.perceptionState.autoDance) {
    autoDance.apply(dt, semanticBones ?? {});
  }
  return nextLipSyncTime;
}

/** 每帧 update 主体：返回推进后的 lipSyncTime（跨帧累计，故经返回值回写闭包变量） */
function stage6Update(c: Stage6Ctx, s5: Stage5State, dt: number, lipSyncTime: number): number {
  // #9 全局暂停标志：动画激活（action 存在且未暂停）时感知 controller 全部静默，
  // 取代原先散布在各 if 上的 `!c.action || c.action.paused` 守卫。
  s5.perceptionPauseRef.paused = !!c.action && !c.action.paused;
  updateCameraAnimation(c, dt);
  if (!c.mesh.visible) return lipSyncTime;
  c.mmd?.updateWithMixer(dt, c.mixer, { ik: true, grant: true });
  return updatePerception(c, s5, dt, lipSyncTime);
}

/** VPD 姿势应用（index 越界 → 早退）：worker 路径直改 mesh，主线程路径走 applyVPD */
function applyVpdPoseById(c: Stage6Ctx, vpdPoses: Stage6Ctx["vpdPoses"], index: number): void {
  const pose = vpdPoses[index];
  if (!pose) return;
  try {
    // workerMode 已下沉：worker 构建路径等价于 c.workerResult 非空
    if (c.workerResult) {
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      applyVPDToMesh(c.mesh!, pose.vpd);
    } else {
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      applyVPD(c.mmd!, pose.vpd, { ik: true, grant: true });
    }
  } catch (e) {
    dbg("mmd", { op: "apply-vpd-fail", index, err: safeErrorMessage(e) });
  }
}

export function Stage6Result(
  c: Stage6Ctx,
  s5: Stage5State,
  tStart: number,
): UpdateableScene & ScreenshotScene & SemanticScene {
  const { semanticBones, items } = s5;
  let lipSyncTime = s5.lipSyncTime;
  // ADR-178（2026-09-04）：result 类型 = 能力组合 + applyPose 可选扩展——
  // applyPose 条件提供（无 VPD 时为 undefined）不进静态组合，作为扩展字段保留；
  // 返回类型组合（无 applyPose）是 result 的父类型，窄赋宽合法。
  const result: UpdateableScene &
    ScreenshotScene &
    SemanticScene & { applyPose?: ((index: number) => void) | undefined } = {
    menuItems: items,
    update: (dt: number): void => {
      lipSyncTime = stage6Update(c, s5, dt, lipSyncTime);
    },
    dispose: (): void => Stage6Dispose(c, s5),
    screenshot: () =>
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      Promise.resolve(screenshotFromRenderer(c.ctx.renderer!, c.ctx.scene, c.ctx.camera)),
    semanticBones,
    applyPose:
      c.vpdPoses.length > 0
        ? (index: number): void => applyVpdPoseById(c, c.vpdPoses, index)
        : undefined,
  };
  Stage6bTrace(c, tStart, c.ctx.adapterId ?? TRACE_FORMAT_OTHER);
  return result;
}

// 6b-dispose：scene graph 拆解 → mixers → 感知释放 → 资源 dispose（自包含，仅消费 c + s5）
function Stage6Dispose(c: Stage6Ctx, s5: ReturnType<typeof Stage5Menu>): void {
  const { breath, gaze, blink, lipSync, autoDance, footIK } = s5;
  const renderer = c.ctx.renderer;
  if (renderer) {
    const memBefore = renderer.info?.memory;
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
    // [锐评 P1-0] 会话级回收编码 worker 池——调度侧（cancelPendingEncodings）一直有生命周期
    // 接线，池本身的生死此前无人管（模块级缓存唯一清空路径是 worker 崩溃）。dispose 幂等，
    // 懒建逻辑（getKtx2WorkerPool）负责下次打开 MMD 时重建。挂 MMD 会话 dispose 而非
    // cleanupPreview：编码池是 MMD 专用资源，跟 MMD 会话走（cooperate 多会话互不误伤）。
    disposeKtx2WorkerPool();
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
    const memAfter = renderer.info?.memory;
    if (memAfter) {
      dbg(
        "gpu-leak",
        `mmd dispose after: geometries=${memAfter.geometries} textures=${memAfter.textures}`,
      );
    }
  }
}

function Stage6bTrace(c: Stage6bCtx, tStart: number, format: string): void {
  c.tBuildEnd = performance.now();
  c.buildSucceeded = true;
  const _stages: import("@/preview-3d/infra/load-trace.ts").LoadTraceStage[] = [];
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
  const _texDetails: import("@/preview-3d/infra/load-trace.ts").LoadTraceTexture[] = [];
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
    format,
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
