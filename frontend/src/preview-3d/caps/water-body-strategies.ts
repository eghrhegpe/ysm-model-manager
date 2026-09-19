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

import * as THREE from "three";
import { envState } from "@/preview-3d/state/env-state.ts";
import { GROUND_LAYER_OFFSETS } from "./scene-capability.ts";
import type { WaterMode } from "./water-state.ts";

/** 池内壁相对水面不透明度的衰减因子（池壁比水面更实，观感更稳）。
 *  构建（build）与运行期（waterOpacity 变更）必须共用同一因子，否则内壁透明度会脱节。 */
export const INNER_WALL_OPACITY_FACTOR = 0.85;

/** 圆角参数合法域（与菜单 slider 的 min/max 一致）。
 *  构建期与运行期必须共用同一钳制——只钳一处会让越界值从另一条路径漏进 uniform。 */
export const POOL_ROUNDNESS_MAX = 0.5;

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
    // 原先「size 变更须重取法线贴图」的约束随贴图链路一并消失（零 CPU 重算）
    body.root.scale.set(size, size, 1);
  },
  needsRebuild() {
    // size / level 均走 scale / position.y，永不需要重建
    return false;
  },
};

/* ============ pool：盒式凹形水池（顶面 + 池底 + 4 面内外壁）============ */

const poolStrategy: WaterBodyStrategy = {
  id: "pool",
  wetnessGated: false,
  supportsVolumeOptics: true,
  build(ctx) {
    const size = envState.waterSize;
    const half = size / 2;
    // h = 池深：自此只描述容器本身（墙体几何高度 / 光学厚度），
    // 不再决定水面位置——水面由 envState.waterLevel 决定（ADR-257 A 档）。
    const h = Math.max(0.01, envState.waterPoolHeight);
    const group = new THREE.Group();
    group.name = "ysm-ground-water";

    const topGeo = new THREE.PlaneGeometry(1, 1, 64, 64);
    const topMat = ctx.buildMaterial({ forPool: true });
    const top = new THREE.Mesh(topGeo, topMat) as WaterTopMesh;
    top.rotation.x = -Math.PI / 2;
    top.position.y = envState.waterLevel;
    top.scale.set(size, size, 1);
    top.name = "ysm-water-top";
    group.add(top);

    const bottomMat = new THREE.MeshStandardMaterial({
      color: envState.waterPoolWallColor,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(size, size), bottomMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = GROUND_LAYER_OFFSETS.waterPoolBottom;
    bottom.name = "ysm-water-bottom";
    group.add(bottom);

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

    const wallPairs: Array<{
      name: string;
      axis: "ns" | "ew";
      pos: THREE.Vector3;
      outerPos: THREE.Vector3;
      rotY?: number;
    }> = [
      {
        name: "ysm-water-wall-n",
        axis: "ns",
        pos: new THREE.Vector3(0, h / 2, -half),
        outerPos: new THREE.Vector3(0, h / 2, -half - envState.waterPoolWallThickness),
      },
      {
        name: "ysm-water-wall-s",
        axis: "ns",
        pos: new THREE.Vector3(0, h / 2, half),
        outerPos: new THREE.Vector3(0, h / 2, half + envState.waterPoolWallThickness),
        rotY: Math.PI,
      },
      {
        name: "ysm-water-wall-e",
        axis: "ew",
        pos: new THREE.Vector3(half, h / 2, 0),
        outerPos: new THREE.Vector3(half + envState.waterPoolWallThickness, h / 2, 0),
        rotY: -Math.PI / 2,
      },
      {
        name: "ysm-water-wall-w",
        axis: "ew",
        pos: new THREE.Vector3(-half, h / 2, 0),
        outerPos: new THREE.Vector3(-half - envState.waterPoolWallThickness, h / 2, 0),
        rotY: Math.PI / 2,
      },
    ];

    for (const pair of wallPairs) {
      const geoSizeW = size;
      const innerGeo = new THREE.PlaneGeometry(geoSizeW, h, 4, 4);
      const outerGeo = new THREE.PlaneGeometry(
        geoSizeW,
        h + Math.max(0.02, envState.waterPoolWallThickness * 0.6),
        4,
        4,
      );
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.name = `${pair.name}-inner`;
      inner.position.copy(pair.pos);
      if (pair.rotY) inner.rotation.y = pair.rotY;
      const outer = new THREE.Mesh(outerGeo, outerMat);
      outer.name = `${pair.name}-outer`;
      outer.position.copy(pair.outerPos);
      if (pair.rotY) outer.rotation.y = pair.rotY;
      group.add(inner, outer);
      // 预捕获：运行时按 role 取件不再遍历 + name 匹配（name 仅保留给调试可读性）
      wallInner.push(inner);
      wallOuter.push(outer);
    }

    return {
      mode: "pool",
      root: group,
      top,
      parts: { surface: [top], floor: [bottom], wallInner, wallOuter },
    };
  },
  getTargets(body, role) {
    return body.parts[role];
  },
  applyLevel(body, level) {
    body.top.position.y = level;
  },
  applySize(_body, _size) {
    // pool 的 size 变更已被 needsRebuild 判为需要重建（池底与四壁几何依赖 size），
    // 故按契约不会走到这里——保留显式空实现，免被误读为遗漏。
  },
  needsRebuild(changed) {
    return (
      changed.has("waterSize") ||
      changed.has("waterPoolHeight") ||
      changed.has("waterPoolWallThickness")
    );
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
