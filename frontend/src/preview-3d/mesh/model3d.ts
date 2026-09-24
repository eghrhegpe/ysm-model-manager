// ===== 3D 模型类型定义 + 键位/相机偏好 re-export =====
// ADR-052 P2 收尾：render-session.ts 470 行生产无调用方，已删除；
// renderModel3D / RenderSession 类型别名 / THREE import 均随 render-session 一并移除。
// 本文件保留：
//   - Spec 结构（Go 返回的 models 结构）—— 活跃类型枢纽
//   - 键位/相机偏好 re-export（keymap.ts 的对外统一出口）
//
// ADR-161 §2.1 镜像声明：下方 Spec3D 族 = Go 契约 Model3DSpec/ModelGroup/BoneData/
// MeshData（bindings/ysm-model-manager/go/threejs/models.ts）的**渲染侧手写镜像**，
// 绑定类型为唯一锚点。禁新增第四套 spec 类型名；缺字段（_cubeCount/textureWidth/
// texArrOrder/componentTextures）请直锚绑定，勿在此补字段 or 用 as 双跳硬取——
// 统计侧（skeleton-render componentCountsFromSpec）已直锚绑定为范式。
import type * as THREE from "three";

// ── Spec 结构（Go 返回的 models 结构）────────────────
export interface SpecBone3D {
  id: string;
  name: string;
  parentId?: string;
  localPosition: number[];
  localRotation: number[];
  /** 发光骨骼（名前缀 "ysmGlow"，对齐上游 GeoBone.glow）；
   * 前端 mesh-builder 据此用 MeshStandardMaterial + emissive 模拟上游
   * NativeModelRenderer:152 LightTexture.pack(15,15) 全亮渲染。 */
  glow?: boolean;
}

export interface SpecMeshGroup3D {
  id?: string;
  boneId: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texIdx?: number;
  localPosition?: number[];
  localRotation?: number[];
}

interface SpecModelGroup3D {
  id?: string;
  name?: string;
  defaultVisible?: boolean;
  bones?: SpecBone3D[];
  meshGroups?: SpecMeshGroup3D[];
}

export interface Spec3D {
  models?: SpecModelGroup3D[];
}

/** 骨骼选中信息（window._3dOnBoneSelect 回调参数） */
export interface BoneSelectInfo {
  name: string;
  path: string;
  parent: string | null;
  children: string[];
  meshCount: number;
  /** @non-ui 骨骼局部坐标。消费方是**宿主页面**（window._3dOnBoneSelect 回调的接收方），
   * 不在本仓——本仓只有 bone-raycast.test.ts 断言其组装正确。不是漏读，是跨界导出。 */
  localPos: number[];
  /** @non-ui 同上（宿主页面消费）。与 localPos 同构；它未被本工具报出仅因 gate.ts 另有
   * 同名的 GazeSnap.worldPos 把读数洗白了——属工具已知假阴性，不是它真被读过。 */
  worldPos: number[];
  /** @non-ui 骨骼局部旋转（四元数），同上。 */
  localRot: number[] | null;
  /** @non-ui 命中 mesh 的局部旋转，同上。 */
  cubeRot: number[] | null;
  /** @non-ui 命中 mesh 的局部位移，同上。 */
  cubePos: number[] | null;
}

/** 骨骼层级映射（dispatch 拾取归属用，ADR-093 T5） */
export interface BoneMaps {
  boneGroupMap: Map<string, THREE.Group>;
  nameMap: Map<string, string>;
  parentMap: Map<string, string | null>;
  childrenMap: Map<string, string[]>;
}

// 键位/相机偏好 re-export 兼容
export type { TdKeyAction, TdKeymapSpec } from "@/preview-3d/infra/keymap.ts";
export {
  DEFAULT_TD_KEYMAP,
  loadTdCamSpeed,
  loadTdKeymap,
  loadTdRotMode,
  TD_KEYMAP_REGISTRY,
} from "@/preview-3d/infra/keymap.ts";

// ADR-052 P3 落地：截图功能通用化至 screenshot.ts 纯函数 + 适配器 screenshot() 能力；
// 本文件不再持有截图相关符号。
