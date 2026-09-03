// ===== 3D 多角度截图渲染器（ADR-136 第四刀归位）=====
// 原 views/app-preview/screenshot-renderer.ts 纯领域逻辑归位 preview-3d——
// 无 DOM、纯 Three.js 离屏渲染，与 screenshot.ts 同域。
// 依赖方向修复：`decodeYsmViaWasm`（视图层 wasm.ts，836 行深耦合视图兄弟）经
// RenderMultiAngleOptions.decodeYsm 依赖注入，本文件不反向 import views。
import * as THREE from "three";

import { getApp } from "../backend/app.ts";
import {
  lightDirToPosition,
} from "./caps/light-capability.ts";
import { type Spec3D } from "./model3d.ts";
import { screenshotFromRenderer } from "./screenshot.ts";
import { type ScreenshotLights } from "./screenshot-lights.ts";
import { buildSpecFromGeometryJSON } from "./spec-builder.ts";
import { textureCache } from "./texture-cache.ts";
import { loadTextures } from "./texture-loader.ts";
import { buildYsmObject, type YsmObjectHandle } from "./ysm-object.ts";

// ===== 3D 场景灯光样板（原 scene-lights.ts，唯一消费者是本文件，合并回）=====
// 标准主灯参数（renderer-setup / screenshot-render 口径一致）
const DIR_LIGHT_POS = [10, 30, 20] as const;
const AMBIENT_LIGHT_COLOR = 0xffffff;
const AMBIENT_LIGHT_INTENSITY = 1.0;
const DIRECTIONAL_LIGHT_COLOR = 0xffffff;
const DIRECTIONAL_LIGHT_INTENSITY = 2;

/**
 * 添加 3D 场景标准主灯（AmbientLight 0xffffff@1.0 + DirectionalLight 0xffffff@2 位于 [10,30,20]）。
 * 原 scene-lights.ts 唯一消费者是 renderMultiAngle，17 行单函数合并回宿主（复用分析结论）。
 */
function addStandardSceneLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(AMBIENT_LIGHT_COLOR, AMBIENT_LIGHT_INTENSITY));
  const dl = new THREE.DirectionalLight(DIRECTIONAL_LIGHT_COLOR, DIRECTIONAL_LIGHT_INTENSITY);
  dl.position.set(DIR_LIGHT_POS[0], DIR_LIGHT_POS[1], DIR_LIGHT_POS[2]);
  scene.add(dl);
}

/** 按预览灯光参数建灯（无 lights → 回退标准灯）——[doc:adr-126-p5] 截图灯光割裂修复：
 *  离屏多角度截图此前用硬编码标准灯，与预览三点布光割裂（所见非所得） */
function applyLights(scene: THREE.Scene, lights?: ScreenshotLights): void {
  if (!lights) {
    addStandardSceneLights(scene);
    return;
  }
  scene.add(new THREE.AmbientLight(lights.ambient.color, lights.ambient.intensity));
  for (const d of [lights.key, lights.fill, lights.rim]) {
    if (!d.enabled) continue;
    const dl = new THREE.DirectionalLight(d.color, d.intensity);
    dl.position.copy(lightDirToPosition(d, 5)); // radius 5 对齐预览 createDirectional
    scene.add(dl);
  }
}

export interface AngleShot {
  name: string;
  base64: string;
}

/** 前端 WASM 解码兜底注入类型（仅取 geometryRaw；不 import views 类型保边界）
 *  内部类型不导出（knip 零未引用导出） */
interface DecodeYsmFn {
  (modelPath: string): Promise<{ geometryRaw?: string | null } | null>;
}

export interface RenderMultiAngleOptions {
  size?: number;
  /** Component name -> texture URLs/base64 entries, matching the live preview path. */
  componentTextures?: Record<string, string[]>;
  /** 截图灯光（从预览 LightCapability 提取——所见即所得；缺省回退标准灯） */
  lights?: ScreenshotLights;
  /** 前端 WASM 解码兜底（视图层注入——features 不反向 import views；缺省跳过 WASM 兜底） */
  decodeYsm?: DecodeYsmFn;
}

// renderMultiAngle 透明背景多角度截图
export async function renderMultiAngle(
  modelPath: string,
  texUrls: string[],
  opts: RenderMultiAngleOptions = {},
): Promise<AngleShot[] | null> {
  const size = opts.size || 512;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let ysmObject: YsmObjectHandle | null = null;
  try {
    let spec: Spec3D | null = null;
    try {
      const { GetModel3DSpec } = await getApp();
      const modelSpec = await GetModel3DSpec(modelPath);
      // Model3DSpec → Spec3D 类型转换（Go binding null→undefined 兼容）
      spec = modelSpec ? (modelSpec as unknown as Spec3D) : null;
    } catch {
      console.warn("[screenshot] spec 获取失败");
    }
    // ADR-071：web 端 spec 桩无效 → 前端 WASM 解码 + buildSpecFromGeometryJSON 兜底（同 model3d-loader）
    if (!spec?.models?.length) {
      try {
        const decoded = opts.decodeYsm ? await opts.decodeYsm(modelPath) : null;
        if (decoded?.geometryRaw) {
          spec = JSON.parse(buildSpecFromGeometryJSON(decoded.geometryRaw)) as Spec3D;
        }
      } catch {
        console.warn("[screenshot] WASM 兜底失败");
        return null;
      }
    }
    if (!spec?.models?.length) return null;
    const texArr = await loadTextures(texUrls);
    // code review P3：组件纹理并行加载（原 for...of 逐个 await——N 个组件串行
    // 往返——Promise.all 并行，Map 在 task 内填充）
    const componentTexMap = new Map<string, (THREE.Texture | null)[]>();
    await Promise.all(
      Object.entries(opts.componentTextures ?? {}).map(async ([componentName, componentUrls]) => {
        componentTexMap.set(componentName, await loadTextures(componentUrls));
      }),
    );

    renderer = new THREE.WebGLRenderer({
      preserveDrawingBuffer: true,
      antialias: true,
      alpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(size, size);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    applyLights(scene, opts.lights);

    ysmObject = buildYsmObject(spec, texArr, componentTexMap, 0);
    const { rootGroup } = ysmObject;
    scene.add(rootGroup);

    scene.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(rootGroup);
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    // P3 修复（审核反推）：meshGroups 空/骨骼组不匹配时 Box3 为空 → getSize 为
    // NaN/0，maxDim 非有限或 ≤0，相机 position 落入 NaN → 截图脏数据甚至渲染异常。
    // 防御性提前返回（调用方按 null 处理，不写脏 PNG）。
    if (!Number.isFinite(maxDim) || maxDim <= 0) return null;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const dist = ((maxDim / (2 * Math.tan((45 * Math.PI) / 360)) / 0.85) * 1.2);

    const angles: Array<{ name: string; theta: number }> = [
      { name: "front", theta: 0 },
      { name: "45", theta: Math.PI / 4 },
      { name: "side", theta: Math.PI / 2 },
      { name: "back45", theta: -Math.PI / 4 },
    ];

    const results: AngleShot[] = [];
    for (const { name, theta } of angles) {
      camera.position.set(
        center.x + Math.sin(theta) * dist,
        center.y,
        center.z - Math.cos(theta) * dist,
      );
      camera.lookAt(center);
      // ADR-052 P3：复用截图纯函数（preserveDrawingBuffer 已开启，toDataURL 安全）
      const b64 = screenshotFromRenderer(renderer, scene, camera, { width: size, height: size }) || "";
      // P3 修复：空 base64（GPU 异常）不入结果集，避免空内容写成 PNG 文件
      if (b64) {
        results.push({ name, base64: b64 });
      }
    }
    return results;
  } catch (e) {
    // P2 修复：场景构建段（buildYsmObject/Box3）抛错也要返回 null 而非 reject
    console.warn("[screenshot] 渲染失败:", e);
    return null;
  } finally {
    // 统一清理：无论成功/失败/异常都必须释放 WebGL 资源，防上下文累积（陷阱 #8）
    // P1 修复（审核）：loadTextures 内部对每个 url 调 textureCache.acquire（refs+1），
    // 但 finally 从不 release → 引用计数永久泄漏，截图纹理永不淘汰。每次多角度截图
    // 累积泄漏所有 texUrls + componentTextures 的纹理引用。
    for (const u of texUrls) textureCache.release(u);
    if (opts.componentTextures) {
      for (const urls of Object.values(opts.componentTextures)) {
        for (const u of urls) textureCache.release(u);
      }
    }
    if (renderer) {
      if (scene && ysmObject) ysmObject.removeFromScene(scene);
      renderer.dispose();
      // P3 修复：dispose 后强制释放上下文，避免延迟到 GC
      (renderer as unknown as { forceContextLoss?: () => void }).forceContextLoss?.();
    }
  }
}
