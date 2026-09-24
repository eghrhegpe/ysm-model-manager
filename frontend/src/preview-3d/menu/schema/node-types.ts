// preview-menu-node-types.ts — [doc:adr-093-ysm] Preview 3D 菜单声明式节点类型（menu 层出口）。
//
// [ADR-195 刀2] 节点/控件纯类型已下沉 preview-3d/menu-node-types.ts（共享类型叶）——
// caps/ 与 menu/ 双域引用同一契约，本文件 re-export 保 30+ 消费者 import 语句零改动。
//
// 保留项（未下沉）：
//   - PreviewMenuCtx：运行时根菜单上下文（依赖 SceneCapability / CameraControlBridge 真依赖，
//     下沉会形成叶 → caps/scene-capability 的 type-only 环）
//   - isPreviewFolderNode / collectPreviewLeafNodes / collectPreviewNodeIds：纯运行时值函数，
//     下沉破坏「零依赖纯类型叶」声明，且仅 node-types.test.ts 引用
//
// 方向：适配器定义「菜单即数据」→ 单一渲染器递归渲染（renderMenu）。类型契约本体
// 见 ../menu-node-types.ts（叶）。

// [ADR-195 刀2] 自共享叶 re-export 类型（caps 与 menu 消费同一契约）
export type {
  NodeFor,
  PreviewActionMenuCtx,
  PreviewControlSpec,
  PreviewDockGroup,
  PreviewMenuGroupId,
  PreviewMenuNode,
  PreviewMenuNodeKind,
} from "./menu-node-types.ts";

import type { SceneCapability } from "@/preview-3d/caps/scene-capability.ts";
// 保留项依赖（PreviewMenuCtx 用）：SceneCapability（caps）+ CameraControlBridge（adapters）
import type { CameraControlBridge } from "@/preview-3d/infra/camera-controls.ts";
// 值函数（isPreviewFolderNode 等）需本地绑定 PreviewMenuNode——re-export 不提供模块内
// 可用名，故另 type-import（与 scene-capability.ts 工厂引用控件类型同款）。
import type { PreviewMenuNode } from "./menu-node-types.ts";

/** 根菜单上下文：core 在 mount3D 内组装，全部经 getter 暴露避免闭包捕获过期值 */
export interface PreviewMenuCtx {
  selfMode: boolean;
  /** 统一能力解析点：按 id 取场景能力实例。mount 层透传 sceneCapabilityRegistry.getById，
   *  测试注入 fake——收编原 getSkyCap/getGroundCap/getLightCap 三字段，新增能力零 ctx 改动 */
  getCap: (id: string) => SceneCapability | null;
  /** [暗线 C1 收口 2026-10] 面板渲染侧 id → cap 解析（默认 = id，命名分裂面板经 cap.panelId）。
   *  取代 core.ts 手写 SCENE_CAP_FOR_PANEL 平行映射表；测试 mock 可省略（回退 getCap）。 */
  getCapByPanelId?: (panelId: string) => SceneCapability | null;
  getCamBridge: () => CameraControlBridge;
  getSiblings: () => string[];
  getCurrentPath: () => string;
  /** 当前会话资源类型（如 ysm/EntityPlayer/vrm/resourcepack；空串未知）——类型 tab 点击时判断同类型走 switchTo */
  getCurrentRtype?: () => string;
  /** 当前会话子类型（如 EntityPlayer/CustomAnim；空串未知）——传递给 getModelsByType 做扩展名隔离 */
  getCurrentSubtype?: () => string;
  /** 按资源类型（+可选子类型）扫描候选模型路径（点击切换模型的类型 tab 时懒加载；缺省回退 siblings） */
  getModelsByType?: (rtype: string, subtype?: string) => Promise<string[]>;
  /** 类型 tab 列表（如 ["ysm","EntityPlayer","vrm","resourcepack"]；缺省仅「当前目录」tab） */
  getTypeTabs?: () => string[];
  /** 3D 渲染器容器：点击该区域关闭菜单（不再全局点击杀弹窗） */
  getViewContainer: () => HTMLElement;
  close: () => void;
  /** 切换模型（同源复用外壳替换）。返回 Promise 供调用方在完成后局部刷新（如 fillSwitch 列表重渲染）；mount 层透传 handle.switchTo 的 Promise */
  switchTo: (path: string, options?: { keepInScene?: boolean }) => Promise<void> | void;
  /** 跨类型跳转（切换模型选中不同类型：关当前 + 开目标，由 app 层 openModel3DFullscreen 提供）。
   *  第二参透传 siblings，切换后新会话「当前目录」tab 有候选（P1-2） */
  switchExternal?: (
    path: string,
    siblings?: string[],
    options?: { keepInScene?: boolean },
  ) => Promise<void> | void;
  /** 卸载已加载角色（mount3D 注入：移除 roots + dispose + 注册表注销 + 相机重算） */
  unloadModel?: (id: string) => void;
  /** 动作节点真 ctx：mount3D 注入真实现，适配器动作可 toast/closeAllOverlays */
  toast: (message: string) => void;
  closeAllOverlays: () => void;
}

/** 类型守卫：节点是否为 folder（可下钻） */
export function isPreviewFolderNode(n: PreviewMenuNode): boolean {
  return n.kind === "folder" || Array.isArray(n.children);
}

/** 递归收集全部叶子节点（folder 展开；供测试/审计遍历） */
export function collectPreviewLeafNodes(nodes: PreviewMenuNode[]): PreviewMenuNode[] {
  const out: PreviewMenuNode[] = [];
  for (const n of nodes) {
    if (n.kind === "folder" || Array.isArray(n.children)) {
      out.push(...collectPreviewLeafNodes(n.children ?? []));
    } else {
      out.push(n);
    }
  }
  return out;
}

/** 递归收集全部节点 id（供 id 唯一性契约测试） */
export function collectPreviewNodeIds(nodes: PreviewMenuNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.id);
    if (Array.isArray(n.children)) out.push(...collectPreviewNodeIds(n.children));
  }
  return out;
}
