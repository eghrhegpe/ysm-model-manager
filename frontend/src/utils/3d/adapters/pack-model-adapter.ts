// ===== pack-model-adapter.ts — MC 资源包模型内容适配器（ADR-080 + ADR-084 L2）=====
// 资源包（.zip）→ ListPackModels 枚举 → 首个 entry 作为初始 path → 逐面 BufferGeometry + MeshStandardMaterial（roughness 1.0）。
// ADR-084 L2：zip 当虚拟文件夹——buildPath 即 entry path（assets/minecraft/models/block/xxx.json），
// core switchTo(newEntryPath) 走 ADR-066 §5.6 语义（复用外壳重建内容层），不自建 ◀/▶。
// 通用外壳（overlay/renderer/循环/释放/根菜单切换面板）由 mount-preview-core.ts 拥有。
// 边界：适配器 0 backend import（ADR-072），Go 绑定经 deps 注入。
//
// L4：tint 面保留纹理（color×map 相乘），类别按 texEntry 路径启发式（草/叶/水），取 MC biome 默认色
// （数据来源见 mc-tints.ts / ADR-080 §5.4；tintindex 仅作"需染色"布尔，值非类别索引）。

import * as THREE from "three";
import {
  parseJavaModel,
  isRenderableModel,
  type JavaModelResult,
} from "../parse-java-model.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import { loadMcTints, getTintColorSync } from "../mc-tints.ts";
import type { PreviewAdapter, PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import { textureCache } from "../texture-cache.ts";
import { safeDispose } from "../safe-dispose.ts";

/** Go 绑定依赖（薄包装层经 getApp 注入，对齐 vrm/litematic 工厂模式） */
export interface PackDeps {
  readEntry(path: string, entry: string): Promise<string>;
}

// tint 染色类别（MC BlockColors 语义：类别由方块身份决定，模型 JSON 不含方块身份 → 路径启发式近似，
// ADR-080 §5.4 方案 a）：*_leaves→foliage、*water*→water，其余默认 grass
// （vanilla 染色面如 grass_block 顶面/overlay 无后缀，默认草地绿即正确）。
// 注意：tintindex 值 0..3 不是类别索引（行业实现 prismarine 仅用 ===0 布尔），故不再按 index 查表。
function tintCategoryForPath(texEntry: string | null): string {
  if (!texEntry) return "grass";
  if (texEntry.includes("_leaves")) return "foliage";
  if (texEntry.includes("water")) return "water";
  return "grass";
}
const NO_TEX_FALLBACK = 0xcccccc;

interface PackState {
  group: THREE.Group | null;
  disposables: THREE.Object3D[];
  usedTextures: Set<string>;
}

/** 工厂：适配器持 zipPath（容器路径），buildPath 即 entry path（虚拟文件夹下的文件路径） */
export function makePackAdapter(deps: PackDeps, zipPath: string): PreviewAdapter {
  return {
    id: "resourcepack",
    build: (ctx, buildPath) => buildPackScene(ctx, buildPath, deps, zipPath),
  };
}

/** base64 → dataURL（纹理喂 TextureLoader） */
function b64ToDataURL(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

/** 材质签名 + 实例（用于按材质分组面） */
interface MatWithKey {
  mat: THREE.Material;
  key: string;
}

/** 读纹理 base64 → 缓存 Texture（失败返回 null） */
async function loadTexture(
  deps: PackDeps,
  path: string,
  texEntry: string,
  usedTextures: Set<string>,
): Promise<THREE.Texture | null> {
  const b64 = await deps.readEntry(path, texEntry);
  if (!b64) return null;
  const dataUrl = b64ToDataURL(b64);
  usedTextures.add(dataUrl);
  return textureCache.acquire(dataUrl, (u) => {
    const t = new THREE.Texture(new Image());
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    const img = t.image as HTMLImageElement;
    img.onload = (): void => { t.needsUpdate = true; };
    img.src = u;
    return t;
  });
}

async function textureFor(
  deps: PackDeps,
  path: string,
  face: JavaModelResult["faces"][number],
  usedTextures: Set<string>,
): Promise<MatWithKey> {
  // tint 面：保留纹理 × tint（Three 中 map 与 color 相乘）——行业做法是 tint 乘到顶点色并照常采样纹理，
  // 纯色平板是对 vanilla 染色面（grass_block 顶面/overlay 等均带纹理）的错误简化。
  // key 含纹理路径：同 tint 不同纹理须分开材质（共用一个 map 会错贴）。
  if (face.tintindex !== null) {
    const cat = tintCategoryForPath(face.texEntry);
    const color = getTintColorSync(cat, "plains");
    if (face.texEntry) {
      const tex = await loadTexture(deps, path, face.texEntry, usedTextures);
      if (tex) {
        return { mat: new THREE.MeshStandardMaterial({ map: tex, color, roughness: 1.0, metalness: 0.0 }), key: `tint:${cat}:${face.texEntry}` };
      }
    }
    // 无纹理/读取失败：纯色兜底；water 半透明（MC 语义），其余不透明
    const isWater = cat === "water";
    return { mat: new THREE.MeshStandardMaterial({ color, transparent: isWater, opacity: isWater ? 0.9 : 1.0, roughness: 1.0, metalness: 0.0 }), key: `tint:${cat}:` };
  }
  if (face.texColor) {
    return { mat: new THREE.MeshStandardMaterial({ color: parseInt(face.texColor.slice(1), 16), roughness: 1.0, metalness: 0.0 }), key: `color:${face.texColor}` };
  }
  if (face.texEntry) {
    const tex = await loadTexture(deps, path, face.texEntry, usedTextures);
    if (tex) {
      return { mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.0 }), key: `tex:${face.texEntry}` };
    }
  }
  return { mat: new THREE.MeshStandardMaterial({ color: NO_TEX_FALLBACK, roughness: 1.0, metalness: 0.0 }), key: "fallback" };
}

/** 构建单个模型的内容 group（面 → 合并 BufferGeometry + Material，按材质签名去重） */
async function buildModelGroup(
  deps: PackDeps,
  path: string,
  model: JavaModelResult,
  usedTextures: Set<string>,
): Promise<{ group: THREE.Group; disposables: THREE.Object3D[] }> {
  const group = new THREE.Group();
  const disposables: THREE.Object3D[] = [];

  // 按材质签名分组面：同材质的面合并为单一 BufferGeometry，减少 draw call
  // 原实现：每面独立 Mesh（100 面 = 100 draw call）→ 合并后：每材质 1 个 Mesh（通常 1-5 draw call）
  // 修复：用材质签名 key 分组（原实现按 Material 对象引用分组，每面新实例 → 永远不命中）
  const matFaces = new Map<string, { mat: THREE.Material; faces: Array<typeof model.faces[number]> }>();
  for (const f of model.faces) {
    const { mat, key } = await textureFor(deps, path, f, usedTextures);
    const existing = matFaces.get(key);
    if (existing) {
      existing.faces.push(f);
    } else {
      matFaces.set(key, { mat, faces: [f] });
    }
  }

  for (const { mat, faces } of matFaces.values()) {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let idxOff = 0;
    for (const f of faces) {
      for (const v of f.verts) positions.push(v / 16);
      for (const u of f.uv) uvs.push(u);
      for (let i = 0; i < f.verts.length; i++) normals.push(f.dir[i % 3]);
      indices.push(idxOff, idxOff + 1, idxOff + 2, idxOff + 2, idxOff + 1, idxOff + 3);
      idxOff += f.verts.length / 3;
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    disposables.push(mesh);
  }
  return { group, disposables };
}

/** 包围盒定相机（对齐 vrm-adapter 口径） */
function frameCamera(ctx: PreviewBuildCtx, target: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  if (ctx.camera) {
    ctx.camera.near = 0.05;
    ctx.camera.far = maxDim * 50;
    ctx.camera.position.set(center.x, center.y + size.y * 0.15, center.z + maxDim * 1.8);
    ctx.camera.updateProjectionMatrix();
  }
  if (ctx.controls) {
    ctx.controls.target.copy(center);
    ctx.controls.minDistance = maxDim * 0.1;
    ctx.controls.maxDistance = maxDim * 12;
    ctx.controls.update();
  }
}

/** 释放内容层 GPU 资源（复用：build 失败和 dispose 共用） */
function disposeContent(state: PackState, scene: THREE.Scene): void {
  if (state.group && state.group.parent) {
    scene.remove(state.group);
  }
  for (const d of state.disposables) {
    d.traverse((o) => {
      const mesh = o as THREE.Mesh;
      safeDispose(mesh.geometry);
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        safeDispose(m);
      }
    });
  }
  for (const url of state.usedTextures) {
    textureCache.release(url);
  }
  state.disposables = [];
  state.group = null;
  state.usedTextures.clear();
}

/** 构建资源包模型预览场景（ADR-080 D3 + ADR-084 L2） */
async function buildPackScene(
  ctx: PreviewBuildCtx,
  entryPath: string, // ADR-084 L2：zip 内模型路径（虚拟文件夹下的文件路径）
  deps: PackDeps,
  zipPath: string,   // 容器路径（.zip 文件路径）
): Promise<PreviewScene> {
  if (!ctx.scene || !ctx.camera || !ctx.controls || !ctx.renderer) {
    throw new Error("pack-model shared 模式需要核心提供 scene/camera/controls/renderer");
  }

  const state: PackState = { group: null, disposables: [], usedTextures: new Set() };

  // 解析模型（entryPath = zip 内路径，readEntry 取 zip 内文件内容）
  let model: JavaModelResult | null = null;
  try {
    model = await parseJavaModel(entryPath, async (e) => deps.readEntry(zipPath, e));
  } catch (e) {
    ctx.loadingEl.remove();
    throw new Error(`资源包内模型解析失败: ${entryPath}`);
  }
  if (!isRenderableModel(model!)) {
    ctx.loadingEl.remove();
    throw new Error(`资源包内模型无完整纹理引用: ${entryPath}`);
  }

  // 预载 MC biome tint 表（vendored minecraft-data，ADR-080 §5.4 L4）；失败则降级 plains 默认常量
  try {
    await loadMcTints();
  } catch (e) {
    console.warn("[pack-model] tint 表加载失败，使用 plains 默认色兜底:", e);
  }

  // 释放旧内容层（ADR-084 L2：switchTo 先 dispose 旧 group 再重建）
  // 注意：core switchTo 已执行 built?.dispose()，但我们保留此处作为防御性清理（
  // 首次 build 时 state 为空 no-op，重建时确保无残留）。
  // 核心在 switchTo 内已移除 sceneBaseline 之外的子节点（line 724-727），此处只需释放 GPU 资源。
  if (state.group && state.group.parent) {
    ctx.scene!.remove(state.group);
  }

  const { group, disposables } = await buildModelGroup(deps, zipPath, model!, state.usedTextures);
  state.group = group;
  state.disposables = disposables;
  ctx.scene!.add(group);
  frameCamera(ctx, group);
  ctx.loadingEl.remove();

  return {
    dispose: () => disposeContent(state, ctx.scene!),
    resetCamera: () => {
      if (ctx.camera && state.group) {
        frameCamera(ctx, state.group);
      }
    },
    setRotationMode: (orbit: boolean) => ctx.cameraControls?.setOrbit(orbit),
    setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer, ctx.scene, ctx.camera)),
  };
}

export { buildPackScene };