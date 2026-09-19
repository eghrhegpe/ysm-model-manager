// ===== 水体形态策略表（ADR-257 B 档）=====
// 旧实现把 film/pool 的差异写死在 water-capability.ts 的约 9 处 `mode ===` 判断里，
// 且参数应用靠 mesh-name 字符串寻址（"ysm-water-top" / "-inner" / "-outer"），
// 拼错即静默失效、编译器一言不发。本文件把「形态」收成一张可注册的策略表：
// **新增形态 = 加一个 strategy 对象，现有实现零改动。**
//
// 为何 applySize / applyLevel 必须由每个形态自己实现：下一目标形态是「海洋 / 大水面」——
// 它的几何未必是 PlaneGeometry、尺寸语义也未必是平面边长（可能是视距 / LOD 环半径）。
// 若在 cap 里统一写成 `root.scale.set(size, size, 1)`，等于把通用路径钉死在 film 的假设上，
// 那正是本次要解掉的病。故「尺寸与水位如何作用于本体」的解释权必须下沉到 strategy。
//
// 为何 getTargets 用语义 role 而非 mesh name：role 是可枚举的联合类型，
// 且在不支持该部件的形态下自然返回空数组——正因如此，
// cap 里「颜色要作用于水面与内壁」这类逻辑才能写成一行同时适配两种形态的表达式。
//
// 2026-09-18 收口（ADR-257 勘误）：原实现把 name 字符串寻址从 cap 搬进本文件
// （`m.name === "ysm-water-top"` / `endsWith("-inner")`）——字符串契约并未消除，
// 且每次参数变更都要 traverse 全树做字符串比较。现改为 **build 期预捕获**：
// 形态在装配时就把各 role 的 mesh 引用塞进 `WaterBody.parts`，运行时 getTargets 纯查表，
// 与 mesh.name 彻底解耦（测试以「全树改名后仍能取出」为反证）。
//
// 2026-09-19（ADR-272）：同一套「build 期预捕获」思路延伸到尺寸——形态在装配时把自己的
// 尺寸语义固化成 `WaterBody.sizeLinks`，`applySize` 退化为查表执行。至此 pool 的 size 变更
// 也不再重建容器，`waterSize` 得以放开 UI 入口（拖滑块是高频事件，ADR-255 §2.2 的
// 「pool 全量重建、低频接受」前提随之失效）。

import * as THREE from "three";
import { envState } from "@/preview-3d/state/env-state.ts";
import { GROUND_LAYER_OFFSETS } from "./scene-capability.ts";
import type { WaterMode } from "./water-state.ts";

/** 池内壁相对水面不透明度的衰减因子（池壁比水面更实，观感更稳）。
 *  构建（build）与运行期（waterOpacity 变更）必须共用同一因子，否则内壁透明度会脱节。 */
export const INNER_WALL_OPACITY_FACTOR = 0.85;

/** 圆角参数合法域（与菜单 slider 的 min/max 一致）。
 *  构建期与运行期必须共用同一钳制——只钳一处会让越界值从另一条路径漏进 uniform。
 *  ⚠️ 不导出：唯一消费者是本文件的 `clampPoolRoundness`。菜单侧的同名域刻意以字面量重复，
 *  因为 `water-menu.ts` 是零 THREE 依赖的纯声明层，从本文件取值会把 THREE 拖进声明层。 */
const POOL_ROUNDNESS_MAX = 0.5;

/** 把任意来源的 roundness 钳到合法域（setter 之外还有存档恢复/其他 cap 直写两条路径） */
export function clampPoolRoundness(v: number): number {
  return Math.max(0, Math.min(POOL_ROUNDNESS_MAX, v));
}

/** 承载波浪材质的顶水面 */
export type WaterTopMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;

/** 装配上下文：由 WaterCapability 提供（材质构造留在 cap 侧）。
 *  微细节法线已迁至 fragment 程序化（cap 的 uDetailStrength），ctx 不再承载法线贴图交付——
 *  形态与法线实现就此解耦，新增形态无需关心法线从哪来。 */
export interface WaterBuildContext {
  /** 构造带波浪 shader 注入的材质（forPool 决定是否启用 transmission 水体厚度感） */
  buildMaterial(opts: { forPool: boolean }): THREE.MeshPhysicalMaterial;
}

/** 部件语义角色——取代旧的 mesh-name 字符串寻址 */
export type WaterPartRole = "surface" | "floor" | "wallInner" | "wallOuter";

/**
 * 尺寸联动件（build 期预捕获，ADR-272）——形态把「哪些件随尺寸怎么变」固化成**数据**，
 * `applySize` 只按表执行，容器永不重建。与 `parts` 同一套思路：
 * **形态差异在装配期固化，运行期只查表。**
 *
 * - `square`：平面件等比铺满 `size × size`（顶水面 / 池底）；
 * - `wall`：立面件沿法向轴平移 + 单轴缩放（四壁）——水平轴随 size 变化、y 轴不动，
 *   故**壁高与壁厚保持绝对值**，不被尺寸缩放连带变形。
 *
 * 尺寸语义无法用这两类表达的形态（如未来 `ocean` 的视距 / LOD 环半径）给空数组，
 * 并在 `needsRebuild` 里声明 `waterSize` 触发重建——届时 `applySize` 按契约不会被调用。
 * ⚠️ 不导出：它经 `WaterBody.sizeLinks` 的字段类型对外生效，无需单独具名（YAGNI）。
 */
type WaterSizeLink =
  | { readonly kind: "square"; readonly mesh: THREE.Mesh }
  | {
      readonly kind: "wall";
      readonly mesh: THREE.Mesh;
      /** 随 size 平移 / 缩放的水平轴 */
      readonly axis: "x" | "z";
      /** 沿该轴的方向（池壁朝 +/− 哪一侧） */
      readonly sign: 1 | -1;
      /** 位置外偏量（外壁 = 壁厚，内壁 = 0）——绝对量，不随 size 缩放 */
      readonly offset: number;
    };

/** 组装完成的渲染体 */
export interface WaterBody {
  /** 形态标识——保留给既有断言与排错可读性 */
  readonly mode: WaterMode;
  root: THREE.Object3D;
  /** 承载波浪材质的顶水面：film 即 root 本体，pool 为 group 内预捕获引用 */
  top: WaterTopMesh;
  /**
   * 各语义角色在 build 期预捕获的 mesh 引用（YSM-2026-09-18）。
   * 不支持该部件的形态给空数组——「颜色作用于 surface + wallInner」才能一行适配两形态。
   */
  readonly parts: Record<WaterPartRole, THREE.Mesh[]>;
  /**
   * 尺寸联动件（ADR-272）：`applySize` 的唯一执行依据，build 期预捕获。
   * 空数组 = 该形态不接受 size 就地更新（须由 `needsRebuild` 声明重建）。
   */
  readonly sizeLinks: readonly WaterSizeLink[];
}

/** 依 `sizeLinks` 就地应用尺寸（模块内共享执行器）。
 *  尺寸语义已由各形态在 build 期固化成数据，执行动作本身与形态无关，故只此一份——
 *  新增形态只需产出自己的 `sizeLinks`，不必重写缩放/定位逻辑。 */
function applySizeLinks(body: WaterBody, size: number): void {
  const half = size / 2;
  for (const link of body.sizeLinks) {
    if (link.kind === "square") {
      link.mesh.scale.set(size, size, 1);
    } else {
      link.mesh.scale.x = size;
      link.mesh.position[link.axis] = link.sign * (half + link.offset);
    }
  }
}

export interface WaterBodyStrategy {
  readonly id: WaterMode;
  /** 是否受 wetness 门控（film=true：wetness 为 0 时水面不可见） */
  readonly wetnessGated: boolean;
  /**
   * 是否启用体积光学（transmission / clarity / thickness）。
   * 薄膜水没有厚度可言，其 transmission 恒为 0；若不分形态一律套用 clarity，
   * 会把 film 的水膜错误地变成透光体。故此能力由形态显式声明，而非靠 `mode === "pool"` 猜。
   */
  readonly supportsVolumeOptics: boolean;
  build(ctx: WaterBuildContext): WaterBody;
  getTargets(body: WaterBody, role: WaterPartRole): THREE.Mesh[];
  /** 应用水面世界 y（契约：必须零重建） */
  applyLevel(body: WaterBody, level: number): void;
  /** 应用尺寸（契约：仅在 needsRebuild 判为 false 时被调用）。
   *  尺寸的世界语义由各形态自行落地（scale / LOD 半径 / …）；微细节法线 GPU 化后不再需要 ctx。 */
  applySize(body: WaterBody, size: number): void;
  /** 本形态下哪些参数变更需要整体重建（mode 自身的切换由 cap 处理，不在此列） */
  needsRebuild(changed: Set<string>): boolean;
}

/* ============ film：贴地薄水膜（单位平面 + scale 驱动尺寸）============ */

const filmStrategy: WaterBodyStrategy = {
  id: "film",
  wetnessGated: true,
  supportsVolumeOptics: false,
  build(ctx) {
    const geo = new THREE.PlaneGeometry(1, 1, 64, 64);
    const mat = ctx.buildMaterial({ forPool: false });
    const root = new THREE.Mesh(geo, mat) as WaterTopMesh;
    root.rotation.x = -Math.PI / 2;
    root.position.y = envState.waterLevel;
    root.scale.set(envState.waterSize, envState.waterSize, 1);
    root.name = "ysm-ground-water";
    return {
      mode: "film",
      root,
      top: root,
      // 薄水膜无容器部件：容器类 role 恒为空数组（cap 侧的一行表达式正依赖此约定）
      parts: { surface: [root], floor: [], wallInner: [], wallOuter: [] },
      // 水膜只有一件：单位平面 × scale 铺满
      sizeLinks: [{ kind: "square", mesh: root }],
    };
  },
  getTargets(body, role) {
    return body.parts[role];
  },
  applyLevel(body, level) {
    body.top.position.y = level;
  },
  applySize(body, size) {
    // 微细节法线取世界水平坐标（vWorldPos_wave.xz），其世界频率随尺寸自动跟随——
    // 原先「size 变更须重取法线贴图」的约束随贴图链路一并消失（ADR-271，零 CPU 重算）
    applySizeLinks(body, size);
  },
  needsRebuild() {
    // size / level 均走 scale / position.y，永不需要重建
    return false;
  },
};

/* ============ pool：盒式凹形水池（顶面 + 池底 + 4 面内外壁）============ */

/** 四壁布局（build 与 applySize 共用的单一事实源）：
 *  `axis` / `sign` = 该壁沿哪个水平轴、朝哪一侧随 size 平移（|位置| = size/2 + offset）；
 *  `rotY` = 让壁面法线朝向池内。build 期据此产出 mesh 与 sizeLinks，运行期零推导。 */
const POOL_WALLS: readonly {
  readonly key: string;
  readonly axis: "x" | "z";
  readonly sign: 1 | -1;
  readonly rotY?: number;
}[] = [
  { key: "n", axis: "z", sign: -1 },
  { key: "s", axis: "z", sign: 1, rotY: Math.PI },
  { key: "e", axis: "x", sign: 1, rotY: -Math.PI / 2 },
  { key: "w", axis: "x", sign: -1, rotY: Math.PI / 2 },
];

const poolStrategy: WaterBodyStrategy = {
  id: "pool",
  wetnessGated: false,
  supportsVolumeOptics: true,
  build(ctx) {
    const size = envState.waterSize;
    const half = size / 2;
    const wallThickness = envState.waterPoolWallThickness;
    // h = 池深：自此只描述容器本身（墙体几何高度 / 光学厚度），
    // 不再决定水面位置——水面由 envState.waterLevel 决定（ADR-257 A 档）。
    const h = Math.max(0.01, envState.waterPoolHeight);
    const group = new THREE.Group();
    group.name = "ysm-ground-water";

    // ADR-272：**尺寸不进几何**——几何一律按单位宽建，世界尺寸由 scale / position 表达。
    // 于是改 size 只改 transform、容器零重建（拖滑块是高频事件，全量重建不可接受）。
    // 壁高 h 与壁厚是绝对量，故只缩放水平轴、y 轴不动（见 WaterSizeLink 注释）。
    const sizeLinks: WaterSizeLink[] = [];

    const topGeo = new THREE.PlaneGeometry(1, 1, 64, 64);
    const topMat = ctx.buildMaterial({ forPool: true });
    const top = new THREE.Mesh(topGeo, topMat) as WaterTopMesh;
    top.rotation.x = -Math.PI / 2;
    top.position.y = envState.waterLevel;
    top.scale.set(size, size, 1);
    top.name = "ysm-water-top";
    group.add(top);
    sizeLinks.push({ kind: "square", mesh: top });

    const bottomMat = new THREE.MeshStandardMaterial({
      color: envState.waterPoolWallColor,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bottomMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = GROUND_LAYER_OFFSETS.waterPoolBottom;
    bottom.scale.set(size, size, 1);
    bottom.name = "ysm-water-bottom";
    group.add(bottom);
    sizeLinks.push({ kind: "square", mesh: bottom });

    const innerMat = new THREE.MeshPhysicalMaterial({
      color: envState.waterColor,
      transparent: true,
      opacity: envState.waterOpacity * INNER_WALL_OPACITY_FACTOR,
      side: THREE.BackSide,
      roughness: 0.1,
      metalness: 0,
      transmission: envState.waterClarity * 0.5,
      thickness: envState.waterPoolWallThickness,
      depthWrite: false,
    });
    const outerMat = new THREE.MeshStandardMaterial({
      color: envState.waterPoolWallColor,
      side: THREE.FrontSide,
      roughness: 0.8,
      metalness: 0,
    });

    // 预捕获容器：内 / 外壁按 role 分组，运行时零遍历取件
    const wallInner: THREE.Mesh[] = [];
    const wallOuter: THREE.Mesh[] = [];

    for (const wall of POOL_WALLS) {
      const innerGeo = new THREE.PlaneGeometry(1, h, 4, 4);
      const outerGeo = new THREE.PlaneGeometry(1, h + Math.max(0.02, wallThickness * 0.6), 4, 4);
      const inner = new THREE.Mesh(innerGeo, innerMat);
      const outer = new THREE.Mesh(outerGeo, outerMat);

      inner.name = `ysm-water-wall-${wall.key}-inner`;
      outer.name = `ysm-water-wall-${wall.key}-outer`;
      inner.scale.x = size;
      outer.scale.x = size;
      inner.position[wall.axis] = wall.sign * half;
      outer.position[wall.axis] = wall.sign * (half + wallThickness);
      inner.position.y = h / 2;
      outer.position.y = h / 2;
      if (wall.rotY !== undefined) {
        inner.rotation.y = wall.rotY;
        outer.rotation.y = wall.rotY;
      }

      group.add(inner, outer);
      // 预捕获：运行时按 role 取件不再遍历 + name 匹配（name 仅保留给调试可读性）
      wallInner.push(inner);
      wallOuter.push(outer);
      // 尺寸联动：内壁贴在 size/2 处，外壁再外偏一个壁厚（绝对量）
      sizeLinks.push(
        { kind: "wall", mesh: inner, axis: wall.axis, sign: wall.sign, offset: 0 },
        { kind: "wall", mesh: outer, axis: wall.axis, sign: wall.sign, offset: wallThickness },
      );
    }

    return {
      mode: "pool",
      root: group,
      top,
      parts: { surface: [top], floor: [bottom], wallInner, wallOuter },
      sizeLinks,
    };
  },
  getTargets(body, role) {
    return body.parts[role];
  },
  applyLevel(body, level) {
    body.top.position.y = level;
  },
  applySize(body, size) {
    // 逐件 scale + 定位（依据为 build 期预捕获的 sizeLinks）：顶/底等比铺满、四壁只缩放水平轴，
    // 壁高与壁厚保持绝对值；几何一句不动（ADR-272）。
    applySizeLinks(body, size);
  },
  needsRebuild(changed) {
    // ADR-272：waterSize 已零重建（走 sizeLinks）。墙高与壁厚仍烘焙进壁几何
    // （y 尺寸 / 外壁偏移 / 外壁加高），故保留重建。
    return changed.has("waterPoolHeight") || changed.has("waterPoolWallThickness");
  },
};

/* ============ 注册表 ============ */

const REGISTRY = new Map<WaterMode, WaterBodyStrategy>([
  [filmStrategy.id, filmStrategy],
  [poolStrategy.id, poolStrategy],
]);

/** 注册一种水体形态——新增形态的唯一入口，现有实现零改动 */
export function registerWaterBodyStrategy(strategy: WaterBodyStrategy): void {
  REGISTRY.set(strategy.id, strategy);
}

/** 取形态策略；未注册时 fail-closed 回退 film，防未知 mode 让整个能力崩掉 */
export function getWaterBodyStrategy(mode: WaterMode): WaterBodyStrategy {
  return REGISTRY.get(mode) ?? filmStrategy;
}

export { filmStrategy, poolStrategy };
