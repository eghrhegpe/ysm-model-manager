// ===== 3D 单个网格构建（从 model3d.ts 拆出，ADR-040 P1 第6轮）=====
// 负责将 SpecMeshGroup3D 数据构建为 THREE.Mesh 并添加到目标组。
import * as THREE from "three";
import type { SpecMeshGroup3D } from "./model3d.ts";
import { applyRotationIfNonIdentity } from "./quaternion.ts";
import { getTextureAlphaMode } from "./texture-alpha.ts";
import type { TextureAlphaMode } from "./texture-alpha.ts";

/** ysmview 风格材质配置（索引 2.16 魔法数值收敛）。
 * side 用 DoubleSide：对齐 architecture.md 材质标准 + YSMViewer/Blockbench 双面渲染。
 * YSMViewer 双面渲染 → 薄脸板从侧面/背面看也可见；此前漂移成 FrontSide 单面，
 * 导致骨骼转动时脸部薄 cube 背面被剔除而"转头脸消失"（与视锥剔除无关）。 */
const MATERIAL_OPTS = {
  side: THREE.DoubleSide,
} as const;
/** 无纹理时的占位灰 */
const FALLBACK_COLOR_GRAY = 0xcccccc;

/**
 * 从 spec mesh group 数据构建 THREE.Mesh 并添加到 boneGroup。
 * ADR-114 perComponent：compTexArr 是当前组件自己的纹理数组（通常 1 张），
 * 不再用全局 texArr[texIdx] 查——根治 texOrder 顺序变动导致的错位。
 * @param bg 骨骼组（添加目标）
 * @param md 单个 mesh group 数据
 * @param compTexArr 当前组件的纹理数组（perComponent）
 * @param texIdx 调用方纹理索引（单组件场景）
 * @param multiModel 是否多组件场景
 * @param texArr 全局纹理数组（perComponent 缺省时回退用）
 * @param modeOverride 面级拆分产出的碎片模式（ADR-118 Phase B），缺省按整纹理判定
 */
export function addMeshToBoneGroup(
  bg: THREE.Group,
  md: SpecMeshGroup3D,
  compTexArr: (THREE.Texture | null)[],
  texIdx: number,
  multiModel: boolean,
  texArr: (THREE.Texture | null)[] = [],
  modeOverride?: TextureAlphaMode,
  glow: boolean = false,
): void {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(md.positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(md.normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(md.uvs, 2));
  geo.setIndex(md.indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // ADR-114 perComponent：优先组件级纹理，缺则回退全局 texArr
  const arr = compTexArr.length > 0 ? compTexArr : texArr;
  // 索引空间（code review P3）：per-component 数组是组件自己的纹理（局部 0 基，
  // ADR-114 cube.TexSlot=0 → compTexArr[0]）；只有回退到全局 texArr 时才用
  // md.texIdx（Go 端全局槽位）/调用方 texIdx——混用两个索引空间会越界误报
  // 品红 warning（如 arrow texSlot=6 对 compTexArr 长度 1），多纹理组件还可能绑错
  const mti = arr === compTexArr ? 0 : multiModel ? (md.texIdx ?? 0) : (texIdx ?? 0);

  // 纹理槽位缺失时**不再静默兜底贴错图**（坏文明根除）：旧行为「找第一张可用」
  // 会把别的组件皮肤贴上还装没事（wine_fox 多组件渲染错乱的帮凶）；灰色占位 +
  // 明确报错至少诚实暴露映射断裂，便于定位数据源问题。
  let mt: THREE.Texture | null = null;
  if (arr.length > 0) {
    if (mti >= 0 && mti < arr.length && arr[mti]) {
      mt = arr[mti];
    } else {
      console.error(
        `[model3d] 纹理槽位缺失: 组件 ${md.boneId} 期望索引 ${mti}` +
          `（可用纹理 ${arr.filter(Boolean).length}/${arr.length}），以灰色占位渲染`,
        { multiModel, mdTexIdx: md.texIdx, callerTexIdx: texIdx },
      );
    }
  }

  // ysmview 风格材质：FrontSide + transparent + alphaTest 0.1 + depthWrite（配置收敛于 MATERIAL_OPTS）
  // ADR-118 Phase B：modeOverride 来自面级拆分（碎片级模式），优先于整纹理判定
  const alphaMode = modeOverride ?? (mt ? getTextureAlphaMode(mt) : "opaque");
  // 发光骨骼（名前缀 "ysmGlow"，对齐上游 GeoBone.glow + NativeModelRenderer:152
  // LightTexture.pack(15,15)）：改用 MeshStandardMaterial 设 emissive，
  // 模拟上游全亮渲染；非 glow 保持 MeshBasicMaterial 不变（无光照开销）。
  const mat = glow
    ? new THREE.MeshStandardMaterial({
        // map/emissiveMap 为 MaterialParameters 可选键（3rd-party）——仅 mt 存在时附带
        ...(mt ? { map: mt, emissiveMap: mt } : {}),
        color: mt ? 0xffffff : FALLBACK_COLOR_GRAY,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.0,
        ...MATERIAL_OPTS,
        transparent: alphaMode === "blend",
        alphaTest: alphaMode === "cutout" ? 0.1 : 0,
        depthWrite: alphaMode !== "blend",
      })
    : mt
      ? new THREE.MeshBasicMaterial({
          map: mt,
          ...MATERIAL_OPTS,
          transparent: alphaMode === "blend",
          alphaTest: alphaMode === "cutout" ? 0.1 : 0,
          depthWrite: alphaMode !== "blend",
        })
      : new THREE.MeshBasicMaterial({
          color: FALLBACK_COLOR_GRAY,
          ...MATERIAL_OPTS,
        });

  // 方案 E：blend 双 pass——BackSide 写深度 + FrontSide alpha 混合。
  // 根除"部分方块不可见"：blend mesh 正背面排序错误导致帧间闪烁。
  // 双 pass 利用深度缓冲自动处理正背面遮挡：
  //   Pass 1 (renderOrder=1)：BackSide + depthWrite=true，背面写入深度
  //   Pass 2 (renderOrder=2)：FrontSide + depthWrite=false，正面混合
  //   正面 pass 的深度测试自动剔除被背面遮挡的像素 → 正背面排序正确
  // opaque/cutout 保持单 mesh（depthWrite=true，深度测试自动处理遮挡）。
  if (alphaMode === "blend" && mt) {
    // Pass 1: BackSide depth pre-pass——从 mat 派生，继承 glow/emissive 等配置
    // alphaTest: 0.01 丢弃全透明片元，不写幽灵深度遮挡身后透明物体
    // colorWrite: false 让预 pass 不贡献颜色，避免 glow blend 背面发暗
    const depthGeo = geo.clone();
    const depthMat = mat.clone();
    depthMat.side = THREE.BackSide;
    depthMat.depthWrite = true;
    depthMat.alphaTest = 0.01;
    depthMat.colorWrite = false;
    const depthMesh = new THREE.Mesh(depthGeo, depthMat);
    depthMesh.frustumCulled = false;
    depthMesh.renderOrder = 1;
    depthMesh.position.set(
      md.localPosition?.[0] ?? 0,
      md.localPosition?.[1] ?? 0,
      md.localPosition?.[2] ?? 0,
    );
    applyRotationIfNonIdentity(depthMesh, md.localRotation);
    bg.add(depthMesh);

    // Pass 2: FrontSide blend pass（原 mat 已设 depthWrite=false）
    const blendMat = mat.clone();
    blendMat.side = THREE.FrontSide;
    const blendMesh = new THREE.Mesh(geo, blendMat);
    blendMesh.frustumCulled = false;
    blendMesh.renderOrder = 2;
    blendMesh.position.set(
      md.localPosition?.[0] ?? 0,
      md.localPosition?.[1] ?? 0,
      md.localPosition?.[2] ?? 0,
    );
    applyRotationIfNonIdentity(blendMesh, md.localRotation);
    bg.add(blendMesh);
    // clone 后原 mat 不再被任何 mesh 持有，显式 dispose 止 GPU 材质泄漏
    mat.dispose();
    return;
  }

  const mesh = new THREE.Mesh(geo, mat);
  // ADR-098 副作用修正：Three.js 默认 mesh 级 `frustumCulled` 常开且我们的
  // `ysm_3d_frustumCull` 开关关不到它。骨骼旋转时脸部等扁平小包围球被内置
  // 视锥误判不可见而隐藏（转头脸消失），故关闭 mesh 级剔除，可见性交由外层
  // `cullModelGroups`（Group 级，单模型场景本就豁免）统一管理，性能不裸奔。
  mesh.frustumCulled = false;
  mesh.position.set(
    md.localPosition?.[0] ?? 0,
    md.localPosition?.[1] ?? 0,
    md.localPosition?.[2] ?? 0,
  );
  applyRotationIfNonIdentity(mesh, md.localRotation);
  bg.add(mesh);
}
