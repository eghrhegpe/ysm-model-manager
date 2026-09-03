// ===== 3D 模型加载器（类型化版 — ADR-014 P2）=====
// loadTextures 已随 ADR-136 第四刀归位 preview-3d/texture-loader.ts
// ADR-161 §2.1：spec 契约单一镜像——本地 unknown 袋 ModelSpec 退役，
// 出口类型锚定 Go 绑定 Model3DSpec（字段含 texArrOrder/componentTextures/_cubeCount，不再静默丢）。
import * as THREE from "three";
import { getApp } from "../../backend/app.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";
import { isWebPlatform } from "../../backend/platform-web.ts";
import { decodeYsmViaWasm } from "../../preview-3d/decoder/wasm-decode.ts";
import { buildSpecFromGeometryJSON } from "../../preview-3d/spec-builder.ts";
import { loadTextures, releaseTextureUrls } from "../../preview-3d/texture-loader.ts";
import { recordLoadTrace } from "../../preview-3d/load-trace.ts";
import type { Model3DSpec } from "../../../bindings/ysm-model-manager/go/threejs/models.ts";

/** 模型对象（轻量接口，覆盖 loadTextures/fetchSpec/preloadModel 用到的字段） */
export interface ModelLike {
  _modelPath?: string;
  bones?: unknown[];
  textures?: string[];
  texture?: string;
  /** R1 契约校验用：Go 端返回的纹理名数组 */
  textureNames?: string[];
  /** ADR-114 perComponent：组件名→声明的纹理 base64 数组 */
  componentTextures?: Record<string, string[]>;
}

/** Go 返回的 3D spec（models 数组）——锚定绑定类型，本地 unknown 袋已退役（ADR-161） */

const specCache = new Map<string, string>();
const SPEC_CACHE_MAX = 20;
function cacheSpec(path: string, data: string): void {
  // LRU：命中先删后插（刷新访问序，避免高频 spec 被冷数据挤出——R5）；
  // 满员时淘汰最久未用（Map 首项，插入序即访问序）
  if (specCache.has(path)) {
    specCache.delete(path);
  } else if (specCache.size >= SPEC_CACHE_MAX) {
    const firstKey = specCache.keys().next().value;
    if (firstKey !== undefined) specCache.delete(firstKey);
  }
  specCache.set(path, data);
}
function getCachedSpec(path: string): string | undefined {
  const data = specCache.get(path);
  if (data !== undefined) {
    // LRU 读取刷新：删除重插，保持「最近使用在前」
    specCache.delete(path);
    specCache.set(path, data);
  }
  return data;
}

/** 并行加载纹理 URL 列表，返回 THREE.Texture 数组（ADR-136 归位 preview-3d/texture-loader.ts） */

/** 获取模型 spec（Go 绑定为唯一事实来源，ADR-004；Android 等无 Node 环境降级前端 WASM 解码兜底） */
async function fetchSpec(model: ModelLike): Promise<Model3DSpec> {
  if (!model._modelPath) return { models: [] };
  let jsonStr = getCachedSpec(model._modelPath);
  if (!jsonStr) {
    const { GetModel3DSpec } = await getApp();
    const spec = await GetModel3DSpec(model._modelPath);
    // typed spec → string 缓存（缓存接口维持 string 类型不变）
    jsonStr = spec ? JSON.stringify(spec) : "{}";
    cacheSpec(model._modelPath, jsonStr);
  }
  const parsed = JSON.parse(jsonStr) as Model3DSpec;
  if (!parsed.models?.length) {
    // 降级：仅无 Node 解码通道的平台（Android 双端桥 / 网页版 browser adapter，
    // GetModel3DSpec 恒空）走前端 WASM 解码兜底；桌面 Go 有 Node 通道，spec 空是
    // 异常而非常态——保持 ADR-004「Go 为唯一事实来源」快速报错语义，避免桌面端
    // 每个空 spec 模型都被拖进完整 WASM 解码（加载变慢）。
    if (isViewerMode()) {
      const spec = await fetchSpecViaWasmFallback(model);
      if (spec) return spec;
    }
    throw new Error("3D spec 为空");
  }
  return parsed;
}

/** 兜底：前端 WASM 解码 .ysm 拿 geometry JSON，构建 spec
 *  Android 路径调 Go binding Build3DSpecFromGeometryJSON；
 *  网页版路径（isWebPlatform）调纯 TS buildSpecFromGeometryJSON——
 *  Go binding 在网页版恒 "{}" 桩（ADR-049 P2-2 闭环）。 */
async function fetchSpecViaWasmFallback(model: ModelLike): Promise<Model3DSpec | null> {
  try {
    const decoded = await decodeYsmViaWasm(model._modelPath!);
    if (!decoded?.geometryRaw) return null;
    if (isWebPlatform()) {
      // 网页版：Go binding 不可用（恒 null 桩），调纯 TS 移植
      const specStr = buildSpecFromGeometryJSON(decoded.geometryRaw);
      if (!specStr || specStr === "{}") return null;
      const spec = JSON.parse(specStr) as Model3DSpec;
      if (!spec.models?.length) return null;
      cacheSpec(model._modelPath!, specStr);
      return spec;
    } else {
      // Android：Go binding 可用（返回 typed Model3DSpec | null）
      const { Build3DSpecFromGeometryJSON } = await getApp();
      const spec = await Build3DSpecFromGeometryJSON(decoded.geometryRaw);
      if (!spec) return null;
      const specStr = JSON.stringify(spec);
      // 兜底结果写 spec 缓存：否则每次预览都重新 WASM 解码（时间翻倍）
      cacheSpec(model._modelPath!, specStr);
      console.warn("[3D] GetModel3DSpec 无数据，已用前端 WASM 解码兜底构建 spec（Android 无 Node 通道）");
      return spec;
    }
  } catch (e) {
    console.warn("[3D] 前端 WASM 解码兜底失败:", e);
    return null;
  }
}

/**
 * 预加载：spec 先行，纹理按全量清单加载（texArr 槽位 = cube texSlot 下标）
 *
 * 返回的 `releaseTextures()` 是 loadTextures 的**配对释放器**，消费方（ysm-adapter）
 * 在 dispose / 构建失败时必须调用一次——纹理所有权归缓存池，不得直接 tex.dispose()。
 */
export async function preloadModel(model: ModelLike): Promise<{
  texArr: (THREE.Texture | null)[];
  spec: Model3DSpec;
  /** ADR-114 perComponent：组件名→Texture 数组（3D 渲染用，每组件独立纹理） */
  componentTexMap: Map<string, (THREE.Texture | null)[]>;
  /**
   * 归还本次 acquire 的全部纹理引用（texArr + componentTexMap 的 URL 清单）。
   * 幂等：重复调用无副作用——防止 dispose 重入把 refs 多减，导致仍在使用中的
   * 共享纹理提前归零被 LRU 淘汰（悬垂已释放纹理）。
   */
  releaseTextures: () => void;
}> {
  const tStart = performance.now();
  const tParseStart = performance.now();
  const spec = await fetchSpec(model);
  const tParseEnd = performance.now();
  // 实际纹理清单（URL + 名）；多组件走数组，单组件走单一 texture
  const actualUrls = model.textures && model.textures.length > 0
    ? model.textures
    : (model.texture ? [model.texture] : []);
  // name 索引：优先显式 textureNames；缺失时从 URL 基名派生（R1 契约比对用）
  const actualNames = (model as { textureNames?: string[] }).textureNames
    ?? actualUrls.map((u) =>
      typeof u === "string"
        ? (u.split("/").pop()?.replace(/\.\w+$/, "").toLowerCase() ?? "")
        : "",
    );
  // texArr 必须以全量纹理清单 actualUrls 为槽位（cube texSlot 即其下标）——
  // 组件 texSlot = 声明序位置（未声明组件 = len(声明) + 按名段序号），与 Go 端
  // 纹理收集序（声明序 + 未声明按名）对齐。spec.texArrOrder 是「组件序期望纹理名」
  // （长度 = 组件数，R1 契约校验专用），不可当 texArr 槽位清单：魔法酒狐等模型用它
  // 会把 6 张声明纹理截断成 3 张（面板「纹理 (3)」），且 arrow texSlot=6 越界品红。
  const urls = actualUrls;
  const componentTexMap = new Map<string, (THREE.Texture | null)[]>();
  // 组件纹理 URL 清单（与 componentTexMap 同序同键）：释放器按此归还引用
  const componentTexUrls = new Map<string, string[]>();

  // 释放器前置定义：纹理加载段任一步抛错时，catch 里也能归还已 acquire 的引用
  //（否则 preloadModel 抛错 → 调用方拿不到 release 闭包 → 引用永久泄漏）。
  let released = false;
  const releaseTextures = (): void => {
    if (released) return;
    released = true;
    releaseTextureUrls(urls);
    for (const compUrls of componentTexUrls.values()) releaseTextureUrls(compUrls);
  };

  let texArr: (THREE.Texture | null)[];
  try {
    texArr = await loadTextures(urls);
  } catch (e) {
    releaseTextures();
    throw e;
  }
  // ADR-114 perComponent：每组件独立纹理对象，不再依赖全局 texArr 槽位顺序。
  // 数据源统一（spec 注入优先）：GetModel3DSpec 把 ComponentTextures 注入
  // spec.componentTextures（zip/7z/解压目录三路同源）；model.componentTextures
  // 保留兼容（旧数据链）。
  // 绑定类型自带 componentTextures（Record<string, string[]|null>|null），直读无需松断言
  const compTex = spec.componentTextures ?? model.componentTextures;
  // 契约哨兵（回归 936169b1 防再犯）：多组件 spec 缺 componentTextures = perComponent
  // 契约断裂（此前是 typed 序列化静默丢字段），全体组件会回落全局 texArr[texIdx] 错贴纹理。
  // 缺失时渲染仍继续（.ysm WASM 路径本就无该字段），但必须显式告警而非静默跳过。
  if ((spec.models?.length ?? 0) > 1 && !compTex) {
    console.warn(
      `[model3d] 契约预警: spec 含 ${spec.models?.length} 个组件但无 componentTextures —— perComponent 专属纹理缺失，组件将回落全局纹理槽（检查 Go 端 Model3DSpec 字段/注入链）`,
    );
  }
  if (compTex) {
    try {
      for (const [compName, texBase64Arr] of Object.entries(compTex)) {
        const compUrls = texBase64Arr ?? [];
        const compTexArr = await loadTextures(compUrls);
        componentTexMap.set(compName, compTexArr);
        componentTexUrls.set(compName, compUrls);
      }
    } catch (e) {
      // 组件纹理加载中断：主 texArr 已完成 acquire，一并归还后上抛
      releaseTextures();
      throw e;
    }
  }
  const order = spec.texArrOrder as string[] | undefined;
  // R1 契约校验：texArrOrder[i] = 组件 i 实际贴图名（Go 端按 texSlot 分配，多组件可**共享**
  // 同一张声明纹理，如 arm 与 main 共享 skin；未声明组件用 basename）。故改为**存在性**比对：
  // 每个期望名必须存在于 texArr 实际清单 actualNames——缺失（未加载/越界）才 warn 不阻断。
  // 不再逐一按索引比对（共享槽位下组件序 ≠ texArr 序，会误报）。WASM 路径 texArrOrder nil 跳过。
  if (order?.length && actualNames.length) {
    const present = new Set(actualNames.map((n) => String(n ?? "").trim().toLowerCase()));
    for (const expRaw of order) {
      const exp = String(expRaw ?? "").trim().toLowerCase();
      if (!exp) continue; // 空值跳过：未命名纹理（P2）
      if (!present.has(exp)) {
        console.warn(
          `[model3d] R1 纹理缺失: 组件期望贴图 ${expRaw} 不在已加载纹理清单 [${actualNames.join(", ")}]（可能越界/缺纹理）`,
        );
        break;
      }
    }
  }
  // 加载剖析：perf 面板甘特图消费（读取 → 解析 → 纹理加载 → 构建，构建段由 adapter 补）
  try {
    const tLoadEnd = performance.now();
    recordLoadTrace({
      ts: Date.now(),
      format: "other",
      path: model._modelPath ?? "",
      stages: [
        { name: "读取", ms: Math.round(tParseStart - tStart), status: "ok" },
        { name: "解析", ms: Math.round(tParseEnd - tParseStart), status: "ok" },
        { name: "纹理加载", ms: Math.round(tLoadEnd - tParseEnd), status: "ok" },
      ],
      assets: {
        files: 1,
        textures: texArr.filter(Boolean).length,
        animations: 0,
      },
      ok: true,
    });
  } catch { /* perf trace 失败不影响加载 */ }

  return { texArr, spec, componentTexMap, releaseTextures };
}
