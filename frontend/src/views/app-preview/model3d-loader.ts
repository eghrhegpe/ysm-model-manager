// ===== 3D 模型加载器（类型化版 — ADR-014 P2）=====
import * as THREE from "three";
import { getApp } from "../../backend/app.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";
import { isWebPlatform } from "../../backend/platform-web.ts";
import { decodeYsmViaWasm } from "./wasm.ts";
import { buildSpecFromGeometryJSON } from "../../utils/3d/spec-builder.ts";
import { textureCache } from "../../utils/3d/texture-cache.ts";
import { recordLoadTrace } from "../../utils/3d/load-trace.ts";

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

/** 并行加载纹理 URL 列表，返回 THREE.Texture 数组（P0 优化：纹理缓存池，同 URL 复用） */
export async function loadTextures(urls?: string[]): Promise<(THREE.Texture | null)[]> {
  if (!urls?.length) return [];
  const texArr: (THREE.Texture | null)[] = urls.map((url) => {
    if (!url) return null;
    return textureCache.acquire(url, (u) => {
      // 缓存未命中：创建新纹理
      const img = new Image();
      // 同步创建，异步填充——acquire 需要立即返回 Texture 实例
      const tex = new THREE.Texture(img);
      tex.flipY = false;
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      // 异步加载图片并更新纹理
      img.onload = (): void => {
        tex.needsUpdate = true;
        tex.userData.imgWidth = img.naturalWidth;
        tex.userData.imgHeight = img.naturalHeight;
      };
      img.onerror = (): void => {
        tex.userData.loadError = true;
      };
      img.src = u;
      return tex;
    });
  });
  // 等待所有图片加载完成（确保 needsUpdate 已触发）
  await Promise.all(
    texArr.map((tex, i) =>
      tex && urls[i]
        ? new Promise<void>((resolve) => {
            const img = tex.image;
            if (img && typeof (img as HTMLImageElement).complete === "boolean" && (img as HTMLImageElement).complete) { resolve(); return; }
            const check = (): void => {
              if (img && typeof (img as HTMLImageElement).complete === "boolean" && (img as HTMLImageElement).complete) resolve();
              else setTimeout(check, 50);
            };
            check();
          })
        : Promise.resolve(),
    ),
  );
  for (let i = 0; i < texArr.length; i++) {
    if (texArr[i]?.userData.loadError) {
      if (urls[i]) textureCache.invalidate(urls[i]);
      texArr[i] = null;
    }
  }
  if (texArr.every((t) => t === null))
    console.warn("[3D] 纹理加载失败，模型将显示为 fallback 颜色");
  return texArr;
}

/** 获取模型 spec（Go 绑定为唯一事实来源，ADR-004；Android 等无 Node 环境降级前端 WASM 解码兜底） */
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
async function fetchSpecViaWasmFallback(model: ModelLike): Promise<ModelSpec | null> {
  try {
    const decoded = await decodeYsmViaWasm(model._modelPath!);
    if (!decoded?.geometryRaw) return null;
    let specStr: string;
    if (isWebPlatform()) {
      // 网页版：Go binding 不可用（恒 "{}" 桩），调纯 TS 移植
      specStr = buildSpecFromGeometryJSON(decoded.geometryRaw);
    } else {
      // Android：Go binding 可用
      const { Build3DSpecFromGeometryJSON } = await getApp();
      specStr = await Build3DSpecFromGeometryJSON(decoded.geometryRaw);
    }
    if (!specStr || specStr === "{}") return null;
    const spec = JSON.parse(specStr) as ModelSpec;
    if (!spec.models?.length) return null;
    // 兜底结果写 spec 缓存：否则每次预览都重新 WASM 解码（时间翻倍）
    cacheSpec(model._modelPath!, specStr);
    console.warn("[3D] GetModel3DSpec 无数据，已用前端 WASM 解码兜底构建 spec（Android 无 Node 通道）");
    return spec;
  } catch (e) {
    console.warn("[3D] 前端 WASM 解码兜底失败:", e);
    return null;
  }
}

/** 预加载：spec 先行，纹理按全量清单加载（texArr 槽位 = cube texSlot 下标） */
export async function preloadModel(model: ModelLike): Promise<{
  texArr: (THREE.Texture | null)[];
  spec: ModelSpec;
  /** ADR-114 perComponent：组件名→Texture 数组（3D 渲染用，每组件独立纹理） */
  componentTexMap: Map<string, (THREE.Texture | null)[]>;
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
  const texArr = await loadTextures(urls);
  // ADR-114 perComponent：每组件独立纹理对象，不再依赖全局 texArr 槽位顺序。
  // 数据源统一（spec 注入优先）：GetModel3DSpec 把 ComponentTextures 注入
  // spec.componentTextures（zip/7z/解压目录三路同源）；model.componentTextures
  // 保留兼容（旧数据链）。
  const componentTexMap = new Map<string, (THREE.Texture | null)[]>();
  const compTex = (spec as { componentTextures?: Record<string, string[]> }).componentTextures
    ?? (model as ModelLike).componentTextures;
  if (compTex) {
    for (const [compName, texBase64Arr] of Object.entries(compTex)) {
      const compTexArr = await loadTextures(texBase64Arr);
      componentTexMap.set(compName, compTexArr);
    }
  }
  const order = (spec as ModelSpec).texArrOrder as string[] | undefined;
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
  return { texArr, spec, componentTexMap };
}
