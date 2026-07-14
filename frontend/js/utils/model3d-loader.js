import * as THREE from "three";
import { GetModel3DSpec } from "../../bindings/ysm-model-manager/app.js";
import { buildSpecFromModel } from "./model3d-spec.js";

const specCache = new Map();
const SPEC_CACHE_MAX = 20;
function cacheSpec(path, data) {
  if (specCache.size >= SPEC_CACHE_MAX) {
    const firstKey = specCache.keys().next().value;
    specCache.delete(firstKey);
  }
  specCache.set(path, data);
}

export async function loadTextures(urls) {
  if (!urls?.length) return [];
  const texMap = new Map();
  const loads = urls.filter(Boolean).map(
    (url) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
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
        img.onerror = () => resolve();
        img.src = url;
      }),
  );
  await Promise.all(loads);
  const texArr = urls.filter(Boolean).map((url) => texMap.get(url)).filter(Boolean);
  const maxPixels = texArr.reduce((m, t) => Math.max(m, (t.image?.naturalWidth || 0) * (t.image?.naturalHeight || 0)), 0);
  if (maxPixels > 0) {
    const threshold = Math.max(maxPixels / 4, 128 * 128);
    const filtered = texArr.filter((t) => ((t.image?.naturalWidth || 0) * (t.image?.naturalHeight || 0)) >= threshold);
    if (filtered.length > 0) { texArr.length = 0; texArr.push(...filtered); }
  }
  if (texArr.length === 0) console.warn("[3D] 纹理加载失败，模型将显示为 fallback 颜色");
  return texArr;
}

export async function fetchSpec(model) {
  let spec = { models: [] };
  if (model._modelPath) {
    try {
      let jsonStr = specCache.get(model._modelPath);
      if (!jsonStr) {
        jsonStr = await GetModel3DSpec(model._modelPath);
        cacheSpec(model._modelPath, jsonStr);
      }
      const parsed = JSON.parse(jsonStr);
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

export async function preloadModel(model) {
  const [texArr, spec] = await Promise.all([
    loadTextures(model.textures?.length > 1 ? model.textures : [model.texture]),
    fetchSpec(model),
  ]);
  return { texArr, spec };
}
