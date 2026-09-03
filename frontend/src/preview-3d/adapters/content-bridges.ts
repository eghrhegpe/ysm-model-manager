// ===== content-bridges.ts — views ↔ adapters 内容层桥契约叶（架构锐评 S4 收敛）=====
//
// 背景（S4 层级倒置）：preview-3d（核心层）原 type import views/app-preview/*-controls.ts
// 共 7 处（mmd-build-menu / mmd-types / vrm-adapter / ysm-adapter ×2 / 测试 ×2），
// 依赖方向「菜单引擎 → 视图壳」。本文件把 6 个纯类型桥契约下沉至 preview-3d 域：
// 依赖全在 preview-3d 内（THREE / CameraControlBridge / mmd-materials / model3d /
// decoder/geometry），零 views 引用，方向单一（views → preview-3d）。
//
// views 层（mmd-controls.ts / ysm-controls.ts）原位 re-export 保公共面——既有消费方
// （含 views 域测试）import 语句零改动（对齐 preview-paths.ts 下沉 re-export 模式）。
//
// 血统：类型原住 views/app-preview/{mmd,ysm}-controls.ts（值文件），是内容层面板
// 填充函数与 adapter 组装之间的桥契约。值逻辑留在原文件，类型归位此处。

import type { SkinnedMesh, Texture } from "three";
import type { MMD } from "@moeru/three-mmd";
import type { CameraControlBridge } from "./camera-controls.ts";
import type { MmdMaterialDetail, MmdMaterialListItem } from "../mmd-materials.ts";
import type { BedrockGeometry } from "../decoder/geometry.ts";
import type { Spec3D, BoneSelectInfo } from "../model3d.ts";

// ── MMD 内容层桥（原 views/app-preview/mmd-controls.ts）──

/** MMD 底部导航上下文（mmd-adapter 组装；fill 系列与 nodes 函数共用） */
export interface MmdBottomNavCtx {
  mmd: MMD;
  mesh: SkinnedMesh;
  modelName: string;
  /** 当前模型完整路径（切换区「当前」高亮判断；Phase 2 后切换归 core switch 项，本字段保留兼容） */
  modelPath?: string;
  /** shared 模式下核心的相机控制桥（Phase 2 后相机归 core camera 项，本字段保留兼容） */
  cameraControls?: CameraControlBridge;
  /** 切换到另一模型（复用核心外壳重建内容层；Phase 2 后归 core switch 项，本字段保留兼容） */
  switchTo?(path: string): Promise<void>;
  /** [doc:adr-132] zip 内全部 pmx/pmd 候选虚拟路径（多候选时 model 面板显示切换 select）；非 zip = 空/缺省 */
  zipModelCandidates?: string[];
}

/** MMD 播放/动作控制桥（mmd-adapter 组装，纯逻辑层状态） */
export interface MmdPlayBridge {
  clips: Array<{ label: string }>;
  isPlaying(): boolean;
  toggle(): void;
  currentIndex(): number;
  select(index: number): void;
  /** 自动解析的 CustomAnim 路径（null = 仓库根不可用） */
  animDir: string | null;
  /** 请求重新加载动作（刷新 CustomAnim 目录扫描结果） */
  requestReload?: () => void;
}

/** 材质控制桥：复用 mmd-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在视图层（ADR-072） */
export interface MaterialControlBridge {
  /** 材质清单（index 与 mesh.material 对齐） */
  list(): MmdMaterialListItem[];
  /** 材质详情（当前可见/透明） */
  getDetail(index: number): MmdMaterialDetail | null;
  /** 设置显隐（Material.visible） */
  setVisible(index: number, visible: boolean): void;
  /** 设置透明度（0-1，联动 transparent） */
  setOpacity(index: number, opacity: number): void;
}

// ── YSM 内容层桥（原 views/app-preview/ysm-controls.ts）──

/** 模型对象（对齐 fill3DPanel / saveScreenshot 的字段需求；ysm-adapter 复用此类型） */
export type YsmModel = BedrockGeometry & {
  textures?: string[] | null;
  _modelPath?: string;
  textureNames?: string[];
  boneCount?: number;
  bones?: unknown[];
};

/** YSM 内容层句柄（shared 化：相机操作走核心 cameraControls，本句柄只管内容/骨骼） */
export interface YsmContentHandle {
  showModelGroup(i: number): void;
  getModelGroupCount(): number;
  setBoneVisible(name: string, visible: boolean): void;
  toggleBone(name: string): void;
  getBoneList(modelIdx?: number): Array<{ id: string; name: string; parentId?: string | null }>;
  /** 骨骼拾取回调（由控件层设置，适配器转发到 raycast state） */
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  /** 骨骼详情框（fill3DPanel 写入） */
  _boneDetailEl: HTMLElement | null;
}

/** 控件装配上下文：由 ysm-adapter 在 buildYsmScene 内组装传入 */
export interface YsmControlsContext {
  model: YsmModel;
  /** 当前纹理下标（纹理选择器初始值） */
  texIdx: number;
  /** preloadModel 返回的纹理数组（可能含 null——缺失纹理占位，fill3DPanel 内断言） */
  texArr: (Texture | null)[];
  spec: Spec3D;
  /** YSM 内容层句柄（模型组/骨骼显隐/拾取回调） */
  handle: YsmContentHandle;
  /** shared 模式下核心的相机控制桥（Phase 2 后相机归核心根菜单 camera 项，本字段保留兼容） */
  cameraControls?: CameraControlBridge;
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
  /** 截取当前 3D 渲染画面（PNG base64，无 data: 前缀）—— ADR-052 P3 通用化 */
  screenshot?(): Promise<string | null>;
}
