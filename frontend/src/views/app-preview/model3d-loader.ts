// ===== 3D 模型加载器（类型化版 — ADR-014 P2）=====
import * as THREE from "three";
import { getApp } from "../../wails/app.ts";

/** 模型对象（轻量接口，覆盖 loadTextures/fetchSpec/preloadModel 用到的字段） */
export interface ModelLike {
  _modelPath?: string;
  bones?: unknown[];
  textures?: string[];
  texture?: string;
}

/** Go 返回的 3D spec（models 数组） */
export interface ModelSpec {
  models?: unknown[];
  [key: string]: unknown;
}

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

/** 并行加载纹理 URL 列表，返回 THREE.Texture 数组 */
export async function loadTextures(urls?: string[]): Promise<THREE.Texture[]> {
  if (!urls?.length) return [];
  const texMap = new Map<string, THREE.Texture>();
  const loads = urls.filter(Boolean).map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = (): void => {
          const tex = new THREE.Texture(img);
          tex.flipY = false;
          tex.minFilter = THREE.NearestFilter;
          tex.magFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          tex.userData.imgWidth = img.naturalWidth;
          tex.userData.imgHeight = img.naturalHeight;
          texMap.set(url, tex);
          resolve();
        };
        img.onerror = (): void => resolve();
        img.src = url;
      }),
  );
  await Promise.all(loads);
  // 不做「按像素量过滤小纹理」：Go 解析层已过滤 avatar/ 与 <4KB 小图，前端若再按尺寸
  // 剔除会**重排 texArr 索引**，而多组件 spec 的 texIdx 是全局组件序（0,1,2...），
  // 索引漂移 → 组件贴错纹理（P1）。像素风合法小纹理（如 64×64）也不应被误杀。
  const texArr = urls
    .filter(Boolean)
    .map((url) => texMap.get(url))
    .filter((t): t is THREE.Texture => Boolean(t));
  if (texArr.length === 0)
    console.warn("[3D] 纹理加载失败，模型将显示为 fallback 颜色");
  return texArr;
}

/** 获取模型 spec（Go 绑定为唯一事实来源，ADR-004；失败抛错由上层 toast，不再降级 JS 兜底） */
async function fetchSpec(model: ModelLike): Promise<ModelSpec> {
  if (!model._modelPath) return { models: [] };
  let jsonStr = getCachedSpec(model._modelPath);
  if (!jsonStr) {
    const { GetModel3DSpec } = await getApp();
    jsonStr = await GetModel3DSpec(model._modelPath);
    cacheSpec(model._modelPath, jsonStr);
  }
  const parsed = JSON.parse(jsonStr) as ModelSpec;
  if (!parsed.models?.length) {
    throw new Error("3D spec 为空");
  }
  return parsed;
}

/** 预加载：纹理 + spec 并行获取 */
export async function preloadModel(model: ModelLike): Promise<{
  texArr: THREE.Texture[];
  spec: ModelSpec;
}> {
  const [texArr, spec] = await Promise.all([
    loadTextures(model.textures && model.textures.length > 1 ? model.textures.filter((u): u is string => Boolean(u)) : (model.texture ? [model.texture] : [])),
    fetchSpec(model),
  ]);
  // R1 契约校验：spec.texArrOrder（Go 端组件序期望纹理名）vs model.textureNames
  // （texArr 实际序）——不一致说明组件贴错纹理（texture 声明序 ≠ model 声明序），
  // 只 warn 不阻断，让错误可见。WASM 路径无 texArrOrder（nil），自动跳过。
  const order = (spec as ModelSpec).texArrOrder as string[] | undefined;
  const actual = (model as { textureNames?: string[] }).textureNames;
  if (order?.length && actual?.length) {
    for (let i = 0; i < Math.min(order.length, actual.length); i++) {
      if (String(order[i]).toLowerCase() !== String(actual[i]).toLowerCase()) {
        console.warn(
          `[model3d] R1 纹理序不一致: 组件 ${i} 期望 ${order[i]}, texArr 实际 ${actual[i]}（可能贴错纹理）`,
        );
        break;
      }
    }
  }
  return { texArr, spec };
}
