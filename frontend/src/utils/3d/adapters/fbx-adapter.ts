// ===== FBX 内容适配器（ADR-112：独立 FBX 预览地基）=====
// 经 Go 绑定 ReadFileBytes 取字节；fbx-worker=1 时走 worker（官方 FBXLoader 源码副本
// vendor/fbx/，零解析改动 → fbxSceneToData 纯数据回主线程重建），否则主线程
// blob URL → FBXLoader 解析。归一化后挂入核心场景 + 包围盒定相机；
// AnimationMixer 播内嵌 animations，经核心 perFrame 循环驱动。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。
//
// 关键边界：FBX 是「模型 + 骨架 + 内嵌动画」完整容器，≠ MMD 动画格式。
// 本适配器只做独立预览；FBX→PMX 重定向（骨骼映射 + 单位换算）属 ADR-112 明确推迟的重活。

import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import { safeErrorMessage } from "../../safe-error-msg.ts";
import { recordLoadTrace } from "../load-trace.ts";
import { disposeMaterial } from "../mesh.ts";
import { b64ToBytes, bytesToArrayBuffer } from "../base64.ts";
import { safeGet } from "../../dom/storage.ts"; // ADR-044：localStorage 统一走安全读写
import { buildFbxSceneFromData, createFbxParser } from "./fbx-parser.ts";
import type { FbxSceneData } from "./fbx-scene-to-data.ts";
import { buildBoneTree } from "../bone-tools.ts";
import { fbxBonesToBoneNodes } from "../fbx-bones.ts";
import { makeBonesPanelItem } from "./bones-panel-node.ts"; // 通用骨骼菜单项工厂（4 adapter 共用，ADR-074 S2 之上）
import type { PreviewMenuNode } from "./preview-menu/node-types.ts";

/** FBX 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） */
export interface FbxDataPort {
  readFileBytes(path: string): Promise<string | null>;
  addOpLog?(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void>;
}

/** FBX 归一化目标：包围盒最长边（单位）。对齐 MMD 厘米惯例（1.6m 人体 ≈ 160），
 *  与场景能力雾距（50-800，厘米尺度）及 MMD 同框尺度一致；cm/m 导出差 100× 均收敛于此。 */
export const FBX_TARGET_MAX_DIM = 160;

/** Box3 尺度归一结果（factor 供诊断日志回显，size/center 为缩放后坐标） */
export interface FbxScaleInfo {
  /** 实际应用的均匀缩放系数（1 = 未缩放） */
  factor: number;
  /** 缩放后包围盒尺寸 */
  size: THREE.Vector3;
  /** 缩放后包围盒中心 */
  center: THREE.Vector3;
}

/**
 * Box3 尺度归一（ADR-112 P1）：DCC 导出单位混乱（cm/m/Unity units 可差 100×）时，
 * 模型要么小到穿近平面看不见、要么顶天立地顶爆场景能力。均匀缩放组根节点，
 * 使包围盒最长边贴合 FBX_TARGET_MAX_DIM；等比缩放不破坏宽高比，
 * 骨骼动画在局部空间运算，组缩放不干扰 AnimationClip。
 * 空组 / 零尺寸 / 非有限值退化：factor=1 原样返回，不抛错。
 */
export function normalizeFbxScale(group: THREE.Group): FbxScaleInfo {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    return { factor: 1, size, center };
  }
  const factor = FBX_TARGET_MAX_DIM / maxDim;
  group.scale.multiplyScalar(factor);
  // 组根节点等比缩放（绕组本地原点），包围盒尺寸与中心随之等比放大
  size.multiplyScalar(factor);
  center.multiplyScalar(factor);
  return { factor, size, center };
}

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
async function fbxDiag(
  port: FbxDataPort,
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
): Promise<void> {
  try {
    await port.addOpLog?.(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}

/** 主线程 FBXLoader 加载（worker 降级路径；内嵌纹理自动处理，外链纹理为 ADR-112 🟡 后续） */
async function loadFbxViaBlob(
  blobUrl: string,
): Promise<THREE.Group & { animations: THREE.AnimationClip[] }> {
  const manager = new THREE.LoadingManager();
  const loader = new FBXLoader(manager);
  return new Promise<THREE.Group & { animations: THREE.AnimationClip[] }>((resolve, reject) => {
    loader.load(
      blobUrl,
      (g) => resolve(g as THREE.Group & { animations: THREE.AnimationClip[] }),
      undefined,
      (e) => reject(e instanceof Error ? e : new Error(safeErrorMessage(e))),
    );
  });
}

/** 加载剖析统计（mesh/纹理数；worker 与 blob 两路径共用） */
function countFbxStats(group: THREE.Object3D): { meshCount: number; texCount: number } {
  let meshCount = 0, texCount = 0;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      meshCount++;
      const mat = (o as THREE.Mesh).material;
      if (Array.isArray(mat)) texCount += mat.length;
      else if (mat) texCount++;
    }
  });
  return { meshCount, texCount };
}

/**
 * 构建 worker 路径的 texUrlMap：把捕获的纹理文件名映射到 blob URL。
 * worker 只登记文件名（TextureNameProxyLoader 拦截加载），主线程须读真实字节
 * （Wails 读不了本地盘，必须经 Go RPC readFileBytes 取）→ blob URL 才能挂贴图；
 * 此前 texUrlMap 从未构建 → worker 路径纹理恒缺失（codereview 批次2 P2）。
 * 纹理按 FBX 同目录解析（捕获端只留 basename）；读失败跳过，不阻塞渲染。
 */
async function buildFbxTexUrlMap(
  data: FbxSceneData,
  fbxPath: string,
  port: FbxDataPort,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const dir = fbxPath.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
  const names = new Set<string>();
  for (const nd of data.nodes) {
    if (!nd.isMesh || !nd.mesh) continue;
    for (const m of nd.mesh.materials) {
      for (const k of ["map", "normalMap", "specularMap", "alphaMap", "emissiveMap"]) {
        const n = (m as unknown as Record<string, unknown>)[k];
        if (typeof n === "string") names.add(n);
      }
    }
  }
  // 有界并发读取（对齐 mmd-adapter TEXTURE_READ_CHUNK_SIZE=4，ADR-101）：
  // 串行 Go RPC 让加载延迟随纹理数线性增长（审核 P3）
  const CHUNK_SIZE = 4;
  const nameList = [...names];
  for (let i = 0; i < nameList.length; i += CHUNK_SIZE) {
    const chunk = nameList.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (name) => {
        try {
          // 磁盘文件名大小写可能不一致 → 原样 + lowercase 双试
          let b64 = await port.readFileBytes(`${dir}/${name}`);
          if (!b64) b64 = await port.readFileBytes(`${dir}/${name.toLowerCase()}`);
          if (!b64) return;
          const bytes = bytesToArrayBuffer(b64ToBytes(b64));
          map.set(name, URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
        } catch { /* 单个纹理读取失败跳过，不阻断渲染 */ }
      }),
    );
  }
  return map;
}

/**
 * 构建 FBX 内容场景（ADR-112 地基）。
 * @param ctx   统一预览上下文（核心提供 scene/camera/controls/renderer）
 * @param path  FBX 文件绝对路径（Wails 下经 Go RPC 取字节，浏览器读不了本地盘）
 * @param port  数据端口（readFileBytes / 可选诊断日志）
 */
export async function buildFbxScene(ctx: PreviewBuildCtx, path: string, port: FbxDataPort): Promise<PreviewScene> {
  // 纹理 blob URL 收集：dispose 时统一 revoke，防止每次预览累积泄漏（审核 P3）
  let texBlobUrls: string[] = [];
  // 1) 取字节 → ArrayBuffer + blob URL（Wails 读不了本地盘，必须经 Go RPC 取字节再包 URL）
  const tStart = performance.now();
  const b64 = await port.readFileBytes(path);
  if (!b64) {
    throw new Error("FBX 字节读取失败（ReadFileBytes 返回空）");
  }
  const bytes = bytesToArrayBuffer(b64ToBytes(b64));
  const blobUrl = URL.createObjectURL(
    new Blob([bytes], { type: "application/octet-stream" }),
  );

  // 2) 加载：fbx-worker=1 走 worker —— 官方 FBXLoader 源码副本解析（vendor/fbx/，零解析改动），
  //    场景经 fbxSceneToData 纯数据回主线程重建；未开启/worker 解析失败 → 降级主线程 blob 路径
  //    （开关模式镜像 mmd-adapter.ts:mmd-pmx-worker，ADR-044 安全读写）
  let group: THREE.Group & { animations: THREE.AnimationClip[] };
  try {
    const useFbxWorker = safeGet("fbx-worker") === "1";
    if (useFbxWorker) {
      await fbxDiag(port, "fbx-parse-dispatch", "FBX 派发 worker 解析", "ok");
      const parser = createFbxParser();
      const resp = await parser.parse(bytes);
      parser.dispose();
      if (resp.ok && resp.data) {
        // texUrlMap：worker 只登记纹理文件名，主线程读真实字节建 blob URL 挂贴图
        // （发现1 P2：此前从不构建 → worker 路径纹理恒缺失，静默回归）
        const texUrlMap = await buildFbxTexUrlMap(resp.data, path, port);
        texBlobUrls = [...texUrlMap.values()];
        group = buildFbxSceneFromData(resp.data, { texUrlMap }) as THREE.Group & { animations: THREE.AnimationClip[] };
        const { meshCount } = countFbxStats(group);
        await fbxDiag(
          port,
          "fbx-worker-build",
          `worker 解析完成：${meshCount} mesh / ${group.animations?.length ?? 0} 动画`,
          "ok",
        );
      } else {
        await fbxDiag(
          port,
          "fbx-worker-build",
          `worker 解析失败，降级主线程：${resp.error ?? "未知错误"}`,
          "warn",
        );
        group = await loadFbxViaBlob(blobUrl);
      }
    } else {
      group = await loadFbxViaBlob(blobUrl);
    }
    await fbxDiag(port, "fbx-load", `已加载 ${path}`, "ok");
  } catch (e) {
    await fbxDiag(port, "fbx-load", "FBX 解析失败", "fail", safeErrorMessage(e));
    throw e;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  const tLoadEnd = performance.now();
  // 加载剖析
  const { meshCount, texCount } = countFbxStats(group);
  recordLoadTrace({
    ts: Date.now(),
    format: "fbx",
    path,
    stages: [{ name: "加载", ms: Math.round(tLoadEnd - tStart), status: "ok" }],
    assets: { files: 1, textures: texCount, materials: texCount, animations: group.animations?.length ?? 0, fbxAnimations: group.animations?.length ?? 0 },
    ok: true,
  });

  // ADR-112 P1 尺度归一：DCC 导出单位混乱（cm/m 差 100×）→ 包围盒最长边归一至 FBX_TARGET_MAX_DIM。
  // 否则小模型穿近平面（near=0.05 恒值）看不见、大模型顶爆场景能力（雾距 50-800 厘米尺度）。
  const scaleInfo = normalizeFbxScale(group);
  if (scaleInfo.factor !== 1) {
    await fbxDiag(port, "fbx-scale", `尺度归一 ×${scaleInfo.factor.toFixed(3)}`, "warn");
  }

  if (ctx.scene) ctx.scene.add(group);

  // 3) 动画：播全部内嵌 clip（FBX 通常为单段角色动画）
  let mixer: THREE.AnimationMixer | null = null;
  if (group.animations && group.animations.length > 0) {
    mixer = new THREE.AnimationMixer(group);
    for (const clip of group.animations) mixer.clipAction(clip).play();
    await fbxDiag(port, "fbx-anim", `内嵌动画 ${group.animations.length} 段`, "ok");
  }

  // 4) 相机取景（镜像 vrm-adapter.ts:267，包围盒定相机 + controls 约束）
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  if (ctx.camera) {
    ctx.camera.near = 0.05;
    ctx.camera.far = maxDim * 50;
    ctx.camera.position.set(center.x, center.y + size.y * 0.1, center.z + maxDim * 1.6);
    ctx.camera.updateProjectionMatrix();
  }
  if (ctx.controls) {
    ctx.controls.target.copy(center);
    ctx.controls.minDistance = maxDim * 0.1;
    ctx.controls.maxDistance = maxDim * 12;
    ctx.controls.update();
  }

  // 5) 骨骼面板（ADR-074 S2 通用骨骼面板复用，ADR-112 扩展）：收拢 SkinnedMesh 骨骼
  //    构建通用骨骼树；有骨骼才注入 🦴 菜单项，复用 makeBonePanelRenderer（列表/详情/拾取联动）
  const boneTree = buildBoneTree(fbxBonesToBoneNodes(group));
  const bonePanelRef: { current: (() => void) | null } = { current: null };
  const menuItems: PreviewMenuNode[] = [];
  if (boneTree.roots.length > 0) {
    // 工厂统一空守卫 + cleanupRef 重入清理（消除原 4 段 ~15 行重复；fbx 持 bonePanelRef）
    menuItems.push(
      makeBonesPanelItem({
        tree: boneTree,
        cleanupRef: bonePanelRef,
        viewContainer: ctx.viewContainer,
        camera: ctx.camera,
        scene: ctx.scene,
        legacyTestId: "fbx-bones-entry",
      }),
    );
  }

  return {
    menuItems,
    update: (dt: number) => {
      mixer?.update(dt);
    },
    dispose: () => {
      try {
        bonePanelRef.current?.();
        mixer?.stopAllAction();
        if (ctx.scene) ctx.scene.remove(group);
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
          else if (mat) disposeMaterial(mat as THREE.Material);
        });
        // 纹理 blob URL 释放（预览关闭后不再需要；未完成的 TextureLoader.load 会静默失败）
        for (const u of texBlobUrls) URL.revokeObjectURL(u);
      } catch {
        /* 释放容错 */
      }
    },
    screenshot: () =>
      Promise.resolve(
        ctx.renderer && ctx.scene && ctx.camera
          ? screenshotFromRenderer(ctx.renderer, ctx.scene, ctx.camera)
          : null,
      ),
  };
}
