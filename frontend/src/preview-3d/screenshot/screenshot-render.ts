// ===== 3D 多角度截图渲染器（ADR-136 第四刀归位）=====
// 原 views/app-preview/screenshot-renderer.ts 纯领域逻辑归位 preview-3d——
// 无 DOM、纯 Three.js 离屏渲染，与 screenshot.ts 同域。
// 依赖方向修复：`decodeYsmViaWasm`（视图层 wasm.ts，836 行深耦合视图兄弟）经
// RenderMultiAngleOptions.decodeYsm 依赖注入，本文件不反向 import views。
import * as THREE from "three";

import { getApp } from "@/backend/app.ts";
import { lightDirToPosition, spotDistanceAttenuation } from "@/preview-3d/caps/light-math.ts";
import type { Spec3D } from "@/preview-3d/mesh/model3d.ts";
import { buildSpecFromGeometryJSON } from "@/preview-3d/model/spec-builder.ts";
import { buildYsmObject, type YsmObjectHandle } from "@/preview-3d/model/ysm-object.ts";
import { loadTextures, releaseTextureUrls } from "@/preview-3d/texture/texture-loader.ts";
import { screenshotFromRenderer } from "./screenshot.ts";
import { applyVolumetricCone } from "./screenshot-cone.ts";
import type { ScreenshotLights } from "./screenshot-lights.ts";

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
 *  离屏多角度截图此前用硬编码标准灯，与预览三点布光割裂（所见非所得）
 *  [light-type-switch] 三盏灯类型动态（directional/point/spot）——截图按 type 建对应对象，与预览一致。
 *  灯位 = 模型中心 + 方位角/仰角 × radius，与预览 `LightCapability.lightPosition` 同式。 */
function applyLights(
  scene: THREE.Scene,
  lights: ScreenshotLights | undefined,
  origin: THREE.Vector3,
  sh: import("./screenshot-lights.ts").ScreenshotShadow | null = null,
): void {
  if (!lights) {
    addStandardSceneLights(scene);
    return;
  }
  scene.add(new THREE.AmbientLight(lights.ambient.color, lights.ambient.intensity));
  // 靶点随模型中心（预览用同一锚点：spot 瞄准 + directional 方向基准）
  const sharedTarget = new THREE.Object3D();
  sharedTarget.position.copy(origin);
  scene.add(sharedTarget);
  for (const d of [lights.key, lights.fill, lights.rim]) {
    if (!d.enabled) continue;
    const pos = lightDirToPosition(d, lights.radius).add(origin);
    let light: THREE.Light;
    // [锐评根治 2026-10] candela 补偿收口成一份，与预览 applyLightParams 同式：
    // UI intensity = 到达靶点处照度（spot/point 同语义），反推需设的坎德拉（防距离
    // 衰减吃强度）——预览/截图所见即所得的同构义务。原只有 spot 分支补偿、point 裸强度。
    if (d.type === "spot" || d.type === "point") {
      const d0 = Math.max(pos.distanceTo(sharedTarget.position), 0.01);
      const falloff = spotDistanceAttenuation(d0, d.distance, d.decay);
      const candela = falloff > 0 ? d.intensity / falloff : d.intensity;
      light =
        d.type === "spot"
          ? new THREE.SpotLight(
              d.color,
              candela,
              d.distance,
              THREE.MathUtils.degToRad(d.angle),
              d.penumbra,
              d.decay,
            )
          : new THREE.PointLight(d.color, candela, d.distance, d.decay);
      light.position.copy(pos);
    } else {
      const dl = new THREE.DirectionalLight(d.color, d.intensity);
      dl.position.copy(pos);
      dl.target = sharedTarget; // 方向 = position − target，与预览同源
      light = dl;
    }
    if (light instanceof THREE.SpotLight) light.target = sharedTarget;
    // [巡检 F1 → 2026-10-12] 阴影接线（与预览 ShadowCapability 同参）：
    // 仅 dir/spot 能投影（three 限制），point 不接线；参数逐项镜像预览现值。
    // mesh 侧 cast/receive 由调用方在场景建好后统一置（见 wireShadows）。
    if (sh && (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight)) {
      light.castShadow = true;
      light.shadow.mapSize.set(sh.mapSize, sh.mapSize);
      light.shadow.bias = sh.bias;
      light.shadow.normalBias = sh.normalBias;
      const cam = light.shadow.camera;
      if (light instanceof THREE.DirectionalLight) {
        // 方向灯：正交相机，半宽 = shadowCameraSize（同 shadow-capability|applyDirLightShadow）
        const oc = cam as THREE.OrthographicCamera;
        oc.left = -sh.cameraSize;
        oc.right = sh.cameraSize;
        oc.top = sh.cameraSize;
        oc.bottom = -sh.cameraSize;
        oc.near = 0.5;
        oc.far = 100;
      } else {
        // 聚光灯：透视相机（同 shadow-capability|applySpotShadow）
        const pc = cam as THREE.PerspectiveCamera;
        pc.near = 0.5;
        pc.far = Math.max(light.distance, 50);
      }
      cam.updateProjectionMatrix();
      light.shadow.needsUpdate = true;
    }
    scene.add(light);
  }
}

export interface AngleShot {
  name: string;
  base64: string;
}

/** 前端 WASM 解码兜底注入类型（仅取 geometryRaw；不 import views 类型保边界）
 *  内部类型不导出（knip 零未引用导出） */
type DecodeYsmFn = (modelPath: string) => Promise<{ geometryRaw?: string | null } | null>;

export interface RenderMultiAngleOptions {
  size?: number;
  /** Component name -> texture URLs/base64 entries, matching the live preview path. */
  componentTextures?: Record<string, string[]>;
  /** 截图灯光（从预览 LightCapability 提取——所见即所得；缺省回退标准灯） */
  lights?: ScreenshotLights;
  /** 前端 WASM 解码兜底（视图层注入——features 不反向 import views；缺省跳过 WASM 兜底） */
  decodeYsm?: DecodeYsmFn;
}

/** 解析 Spec3D：Go binding 优先，失败走前端 WASM 解码 + buildSpecFromGeometryJSON 兜底（ADR-071） */
async function resolveShotSpec(modelPath: string, decodeYsm?: DecodeYsmFn): Promise<Spec3D | null> {
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
      const decoded = decodeYsm ? await decodeYsm(modelPath) : null;
      if (decoded?.geometryRaw) {
        spec = JSON.parse(buildSpecFromGeometryJSON(decoded.geometryRaw)) as Spec3D;
      }
    } catch {
      console.warn("[screenshot] WASM 兜底失败");
      return null;
    }
  }
  return spec?.models?.length ? spec : null;
}

/** 组件纹理并行加载（Promise.all，Map 在 task 内填充） */
async function loadComponentTextures(
  componentTextures: Record<string, string[]>,
): Promise<Map<string, (THREE.Texture | null)[]>> {
  const map = new Map<string, (THREE.Texture | null)[]>();
  await Promise.all(
    Object.entries(componentTextures).map(async ([componentName, componentUrls]) => {
      map.set(componentName, await loadTextures(componentUrls));
    }),
  );
  return map;
}

/** 构建截图 renderer 并镜像预览输出设置（[ADR-266-d1 D2]） */
function createShotRenderer(
  size: number,
  output?: ScreenshotLights["output"],
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    preserveDrawingBuffer: true,
    antialias: true,
    alpha: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // [ADR-266-d1 D2] 输出设置同构：镜像活跃预览 renderer 的现值。光柱 shader 的
  // `<tonemapping_fragment>` / `<colorspace_fragment>` 与模型材质同受这三项支配——
  // 不镜像即「预览 ACES×0.5 对 离屏 NoToneMapping×1.0」的亮度静默分叉（既有债，
  // 光柱入镜会把它放大成显性穿帮）。读现值、不重推 sky/pp 属主链：推导即手抄，手抄即分叉。
  if (output) {
    renderer.toneMapping = output.toneMapping;
    renderer.toneMappingExposure = output.exposure;
    renderer.outputColorSpace = output.outputColorSpace;
  }
  return renderer;
}

/** [F1 落地] 阴影接线：renderer 级开关 + mesh 级 cast/receive。
 *  [锐评 2026-10-08 P1-1 已知差异声明] 离屏 Scene **刻意不镜像** 预览的 `scene.environment`
 *  （IBL/环境贴图 PMREM 纹理）：环境贴图跨 WebGL context 不可共享，离屏侧无法直接复用预览
 *  的 PMREM 纹理；PBR 反射 lobe 与 IBL 环境光在截图里缺失，模型会比预览略暗。 */
function applyShotShadows(
  renderer: THREE.WebGLRenderer,
  rootGroup: THREE.Object3D,
  shadowSpec: ScreenshotLights["shadow"],
): void {
  if (!shadowSpec?.enabled) return;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = shadowSpec.type;
  renderer.shadowMap.needsUpdate = true;
  rootGroup.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
  });
}

/** 计算截图相机与距离（fov 45 缩略图固定取景，near/far 按包围盒夹逼） */
function computeShotCamera(maxDim: number): { camera: THREE.PerspectiveCamera; dist: number } {
  // [锐评 screenshot 轮 2026-10-11] 近/远裁剪面按包围盒**夹逼**（不搬预览的
  // camera-setup 常量——其 near=0.05 只因预览 dist 带 +2 地板才安全，截图 dist
  // =1.7×maxDim 无地板，小模型会整模型落入近平面之后）。旧实现 far 硬编码 1000：
  // maxDim 超过约 588 时背侧最远点（≈dist+maxDim）越过 far → 远端静默裁切；
  // fixed 0.1/1000 对角色尺度只有约 10000:1 深度精度，远劣于夹逼。
  // fov 45 是有意与预览 50 不同的缩略图固定取景（多角度导出需跨模型一致），不动。
  const dist = (maxDim / (2 * Math.tan((45 * Math.PI) / 360)) / 0.85) * 1.2;
  const camNear = Math.max(maxDim * 0.05, 1e-4);
  const camFar = dist + maxDim * 2;
  return { camera: new THREE.PerspectiveCamera(45, 1, camNear, camFar), dist };
}

/** 多角度截图循环（screenshotFromRenderer 复用截图纯函数，preserveDrawingBuffer 已开启） */
function captureShotAngles(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  center: THREE.Vector3,
  dist: number,
  size: number,
): AngleShot[] {
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
    const b64 =
      screenshotFromRenderer(renderer, scene, camera, { width: size, height: size }) || "";
    // 空 base64（GPU 异常）不入结果集，避免空内容写成 PNG 文件
    if (b64) results.push({ name, base64: b64 });
  }
  return results;
}

/** finally 出口：释放纹理引用 + 光柱 + renderer 上下文（防 GPU 累积，陷阱 #8） */
function releaseShotResources(ctx: {
  texUrls: string[];
  componentTextures: Record<string, string[]> | undefined;
  cone: ReturnType<typeof applyVolumetricCone>;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  ysmObject: YsmObjectHandle | null;
}): void {
  releaseTextureUrls(ctx.texUrls);
  if (ctx.componentTextures) {
    for (const urls of Object.values(ctx.componentTextures)) releaseTextureUrls(urls);
  }
  // [ADR-266-d1] 光柱先释放（几何/材质/贴图槽位 + 从场景摘除），与纹理 release 同纪律——
  // 离屏会话不依赖 GC 回收 GPU 资源
  ctx.cone?.dispose();
  if (ctx.renderer) {
    if (ctx.scene && ctx.ysmObject) ctx.ysmObject.removeFromScene(ctx.scene);
    ctx.renderer.dispose();
    // dispose 后强制释放上下文，避免延迟到 GC
    ctx.renderer.forceContextLoss?.();
  }
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
  // [ADR-266-d1] 离屏光柱句柄（finally 释放 GPU 资源）
  let cone: ReturnType<typeof applyVolumetricCone> = null;
  try {
    const spec = await resolveShotSpec(modelPath, opts.decodeYsm);
    if (!spec) return null;
    const texArr = await loadTextures(texUrls);
    const componentTexMap = await loadComponentTextures(opts.componentTextures ?? {});
    renderer = createShotRenderer(size, opts.lights?.output);
    scene = new THREE.Scene();
    ysmObject = buildYsmObject(spec, texArr, componentTexMap, 0);
    const { rootGroup } = ysmObject;
    scene.add(rootGroup);

    // [F1 落地] 阴影接线：顺序在 applyLights 之前——灯建好时 shadowMap 已启用，
    // 首帧即正确（不留一帧无影）。mesh 遍历在 rootGroup 建好后（与 shadow-capability|applyMeshes 同式）。
    const shadowSpec = opts.lights?.shadow ?? null;
    applyShotShadows(renderer, rootGroup, shadowSpec);

    scene.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(rootGroup);
    const center = box.getCenter(new THREE.Vector3());
    // 灯光在模型中心算出后再建：spot/point 灯位需相对模型中心（与预览同构）
    applyLights(scene, opts.lights, center, shadowSpec);
    // [ADR-266-d1 D1] 体积光锥入镜：复用预览同一 VolumetricCone（几何/shader 单源）
    cone = applyVolumetricCone(scene, opts.lights, center);
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    // meshGroups 空/骨骼组不匹配时 Box3 为空 → getSize 为
    // NaN/0，maxDim 非有限或 ≤0，相机 position 落入 NaN → 截图脏数据甚至渲染异常。
    // 防御性提前返回（调用方按 null 处理，不写脏 PNG）。
    if (!Number.isFinite(maxDim) || maxDim <= 0) return null;
    const { camera, dist } = computeShotCamera(maxDim);
    return captureShotAngles(renderer, scene, camera, center, dist, size);
  } catch (e) {
    // 场景构建段（buildYsmObject/Box3）抛错也要返回 null 而非 reject
    console.warn("[screenshot] 渲染失败:", e);
    return null;
  } finally {
    releaseShotResources({
      texUrls,
      componentTextures: opts.componentTextures,
      cone,
      renderer,
      scene,
      ysmObject,
    });
  }
}
