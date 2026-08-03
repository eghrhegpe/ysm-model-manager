// ===== 3D 模型加载器（类型化版 — ADR-014 P2）=====
import * as THREE from "three";
import { GetModel3DSpec } from "../../bindings/ysm-model-manager/internal/app/app.js";
import { buildSpecFromModel } from "./model3d-spec.js";

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
  if (specCache.size >= SPEC_CACHE_MAX) {
    const firstKey = specCache.keys().next().value;
    if (firstKey !== undefined) specCache.delete(firstKey);
  }
  specCache.set(path, data);
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
  const texArr = urls
    .filter(Boolean)
    .map((url) => texMap.get(url))
    .filter((t): t is THREE.Texture => Boolean(t));
  const maxPixels = texArr.reduce(
    (m, t) =>
      Math.max(
        m,
        ((t.image as HTMLImageElement)?.naturalWidth || 0) * ((t.image as HTMLImageElement)?.naturalHeight || 0),
      ),
    0,
  );
  if (maxPixels > 0) {
    const threshold = Math.max(maxPixels / 4, 128 * 128);
    const filtered = texArr.filter(
      (t) =>
        ((t.image as HTMLImageElement)?.naturalWidth || 0) * ((t.image as HTMLImageElement)?.naturalHeight || 0) >=
        threshold,
    );
    if (filtered.length > 0) {
      texArr.length = 0;
      texArr.push(...filtered);
    }
  }
  if (texArr.length === 0)
    console.warn("[3D] 纹理加载失败，模型将显示为 fallback 颜色");
  return texArr;
}

/** 获取模型 spec（Go 绑定优先，JS 几何兜底） */
export async function fetchSpec(model: ModelLike): Promise<ModelSpec> {
  let spec: ModelSpec = { models: [] };
  if (model._modelPath) {
    try {
      let jsonStr = specCache.get(model._modelPath);
      if (!jsonStr) {
        jsonStr = await GetModel3DSpec(model._modelPath);
        cacheSpec(model._modelPath, jsonStr);
      }
      const parsed = JSON.parse(jsonStr) as ModelSpec;
      if (parsed.models) spec = parsed;
    } catch (e) {
      console.warn("[3D] Fallback to JS geometry:", e);
    }
  }
  if (!spec.models?.length && model.bones?.length) {
    spec = buildSpecFromModel(model);
  }
  return spec;
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
  return { texArr, spec };
}
