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
// 尺寸语义固化成 `WaterBody.transformLinks`，`applyProfile` 退化为查表执行。至此 pool 的 size 变更
// 也不再重建容器，`waterSize` 得以放开 UI 入口（拖滑块是高频事件，ADR-255 §2.2 的
// 「pool 全量重建、低频接受」前提随之失效）。
//
// 2026-09（ADR-272 扩展）：同一判例适用于壁高与池深——`sizeLinks` 泛化为 `transformLinks`，
// 几何一律单位尺寸，结构参数（size / poolHeight / wallThickness）全部经同一执行器落地。
// 于是 pool 的 needsRebuild 恒为 false，重建契约专为未来形态（ocean 换几何）保留。

import * as THREE from "three";
import { envState } from "@/preview-3d/state/env-state.ts";
import { clampFieldValue, type EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import { GROUND_LAYER_OFFSETS } from "./scene-capability.ts";
import { WATER_WAVE_SEGMENTS, type WaterMode } from "./water-state.ts";

/** 池内壁相对水面不透明度的衰减因子（池壁比水面更实，观感更稳）。
 *  构建（build）与运行期（waterOpacity 变更）必须共用同一因子，否则内壁透明度会脱节。 */
export const INNER_WALL_OPACITY_FACTOR = 0.85;

/** 圆角合法域的**唯一事实源 = schema `range`**（ADR-283）。
 *  构建期与运行期必须共用同一钳制——只钳一处会让越界值从另一条路径漏进 uniform；
 *  而该钳制的源头（不再是本文件的字面量，也不再是菜单 slider 的重复字面量）
 *  统一为 `ENV_STATE_SCHEMA.waterPoolRoundness.range`，菜单与 cap 都只是它的读口。 */

/** 把任意来源的 roundness 归一到 schema 合法域（存档恢复 / 其他 cap 直写仍走此处）。 */
export function clampPoolRoundness(v: number): number {
  return clampFieldValue("waterPoolRoundness", v);
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
 * 变换联动件（build 期预捕获，ADR-272）——形态把「哪些件随哪个结构参数怎么变」固化成**数据**，
 * `applyProfile` 只按表执行，容器永不重建。与 `parts` 同一套思路：
 * **形态差异在装配期固化，运行期只查表。**
 *
 * - `square`：平面件等比铺满 `size × size`（顶水面 / 池底）；
 * - `wall`：立面件沿法向轴（四壁）——水平轴随 size 缩放平移，y 轴 = 壁高；
 *   外壁比内壁高出一截壁厚加高（max(0.02, t×0.6)）且外偏一个壁厚，
 *   这些绝对量只随 h / t 变、不被尺寸缩放连带变形。
 *
 * 结构语义无法用这两类表达的形态（如未来 `ocean` 的视距 / LOD 环半径）给空数组，
 * 并在 `needsRebuild` 里声明重建——届时 `applyProfile` 按契约不会被调用。
 * ⚠️ 不导出：它经 `WaterBody.transformLinks` 的字段类型对外生效（YAGNI）。
 */
type WaterTransformLink =
  | { readonly kind: "square"; readonly mesh: THREE.Mesh }
  | {
      readonly kind: "wall";
      readonly mesh: THREE.Mesh;
      /** 随 size 平移 / 缩放的水平轴 */
      readonly axis: "x" | "z";
      /** 沿该轴的方向（池壁朝 +/− 哪一侧） */
      readonly sign: 1 | -1;
      /** 外壁：位置再外偏一个壁厚，高度加一截壁厚抬升；内壁贴水面 */
      readonly outer: boolean;
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
   * 变换联动件（ADR-272）：`applyProfile` 的唯一执行依据，build 期预捕获。
   * 空数组 = 该形态不接受结构参数就地更新（须由 `needsRebuild` 声明重建）。
   */
  readonly transformLinks: readonly WaterTransformLink[];
}

/** 依 `transformLinks` 就地应用结构参数（模块内共享执行器，build 与运行期同一推导）。
 *  参数语义已由各形态在 build 期固化成数据，执行动作本身与形态无关，故只此一份——
 *  新增形态只需产出自己的 `transformLinks`，不必重写缩放/定位逻辑。 */
function applyTransformLinks(
  body: WaterBody,
  size: number,
  poolHeight: number,
  wallThickness: number,
): void {
  const half = size / 2;
  const h = clampFieldValue("waterPoolHeight", poolHeight);
  const t = clampFieldValue("waterPoolWallThickness", wallThickness); // 值域同源 schema（ADR-283）
  for (const link of body.transformLinks) {
    if (link.kind === "square") {
      link.mesh.scale.set(size, size, 1);
    } else {
      const wallH = h + (link.outer ? Math.max(0.02, t * 0.6) : 0);
      link.mesh.scale.x = size;
      link.mesh.scale.y = wallH;
      link.mesh.position.y = wallH / 2;
      link.mesh.position[link.axis] = link.sign * (half + (link.outer ? t : 0));
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
  /**
   * 是否支持圆角裁剪（`uRoundness` 边角淡出）。
   * pool=true（盒式容器可切圆角）；film=false（水膜无容器，圆角只会凭空裁掉四角）。
   * 与 `supportsVolumeOptics` 同理——由形态显式声明，**构造期与运行期共用同一门控**：
   * 若只在构造期门控（`buildMaterial` 的 forPool），pool 专属参数变更就会在运行期
   * 把 `uRoundness` 泄漏进 film 材质（分派表 applier 侧漏门控，2026-09 修复）。
   */
  readonly supportsRoundness: boolean;
  build(ctx: WaterBuildContext): WaterBody;
  getTargets(body: WaterBody, role: WaterPartRole): THREE.Mesh[];
  /** 应用水面世界 y（契约：必须零重建） */
  applyLevel(body: WaterBody, level: number): void;
  /** 就地应用结构参数（size / 池深 / 壁厚；契约：仅在 needsRebuild 判为 false 时被调用）。
   *  世界语义由各形态自行落地（scale / LOD 半径 / …）；无容器的形态（film）可忽略 h / t。 */
  applyProfile(
    body: WaterBody,
    profile: { size: number; poolHeight: number; wallThickness: number },
  ): void;
  /** 本形态下哪些参数变更需要整体重建（mode 自身的切换由 cap 处理，不在此列） */
  needsRebuild(changed: Set<EnvStateKey>): boolean;
}

/* ============ film：贴地薄水膜（单位平面 + scale 驱动尺寸）============ */

const filmStrategy: WaterBodyStrategy = {
  id: "film",
  wetnessGated: true,
  supportsVolumeOptics: false,
  supportsRoundness: false, // 薄水膜无容器：圆角裁剪无意义（构造期亦恒 0）
  build(ctx) {
    // 分段数 = WATER_WAVE_SEGMENTS 唯一事实源（与 shader 波幅抗锯齿的间距推导同源）
    const geo = new THREE.PlaneGeometry(1, 1, WATER_WAVE_SEGMENTS, WATER_WAVE_SEGMENTS);
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
      transformLinks: [{ kind: "square", mesh: root }],
    };
  },
  getTargets(body, role) {
    return body.parts[role];
  },
  applyLevel(body, level) {
    body.top.position.y = level;
  },
  applyProfile(body, p) {
    // 微细节法线取世界水平坐标（vWorldPos_wave.xz），其世界频率随尺寸自动跟随——
    // 原先「size 变更须重取法线贴图」的约束随贴图链路一并消失（ADR-271，零 CPU 重算）
    // film 无容器：poolHeight / wallThickness 被 links 天然忽略（只有 square 件）
    applyTransformLinks(body, p.size, p.poolHeight, p.wallThickness);
  },
  needsRebuild() {
    // size / level 均走 scale / position.y，永不需要重建
    return false;
  },
};

/* ============ pool：盒式凹形水池（顶面 + 池底 + 4 面内外壁）============ */

/** 四壁布局（build 与 transformLinks 共用的单一事实源）：
 *  `axis` / `sign` = 该壁沿哪个水平轴、朝哪一侧随 size 平移（|位置| = size/2 + 壁厚）；
 *  `rotY` = 让壁面法线朝向池内。build 期据此产出 mesh 与 links，运行期零推导。 */
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
  supportsRoundness: true, // 盒式容器：圆角 = 池体边角淡出
  build(ctx) {
    const group = new THREE.Group();
    group.name = "ysm-ground-water";

    // ADR-272 及其扩展：**结构参数不进几何**——几何一律按单位尺寸建，世界尺寸 /
    // 壁高 / 壁厚全部由 transformLinks 表达（拖滑块是高频事件，全量重建不可接受）。
    const links: WaterTransformLink[] = [];

    const topGeo = new THREE.PlaneGeometry(1, 1, WATER_WAVE_SEGMENTS, WATER_WAVE_SEGMENTS);
    const topMat = ctx.buildMaterial({ forPool: true });
    const top = new THREE.Mesh(topGeo, topMat) as WaterTopMesh;
    top.rotation.x = -Math.PI / 2;
    top.position.y = envState.waterLevel;
    top.name = "ysm-water-top";
    group.add(top);
    links.push({ kind: "square", mesh: top });

    const bottomMat = new THREE.MeshStandardMaterial({
      color: envState.waterPoolWallColor,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bottomMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = GROUND_LAYER_OFFSETS.waterPoolBottom;
    bottom.name = "ysm-water-bottom";
    group.add(bottom);
    links.push({ kind: "square", mesh: bottom });

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
      // 单位壁几何：壁高 / 加高 / 外偏全部经 links 表达（h / t 变更零重建）。
      // 池深 h 只描述容器（壁高 / 光学光程），不动水面——水面由 waterLevel 决定（ADR-257 A 档）。
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 4), innerMat);
      const outer = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 4), outerMat);
      inner.name = `ysm-water-wall-${wall.key}-inner`;
      outer.name = `ysm-water-wall-${wall.key}-outer`;
      if (wall.rotY !== undefined) {
        inner.rotation.y = wall.rotY;
        outer.rotation.y = wall.rotY;
      }
      group.add(inner, outer);
      // 预捕获：运行时按 role 取件不遍历 + name 匹配（name 仅保留给调试可读性）
      wallInner.push(inner);
      wallOuter.push(outer);
      // 变换联动：内壁贴 size/2，外壁再外偏一个壁厚；壁高 = h（外壁加一截）
      links.push(
        { kind: "wall", mesh: inner, axis: wall.axis, sign: wall.sign, outer: false },
        { kind: "wall", mesh: outer, axis: wall.axis, sign: wall.sign, outer: true },
      );
    }

    const body: WaterBody = {
      mode: "pool",
      root: group,
      top,
      parts: { surface: [top], floor: [bottom], wallInner, wallOuter },
      transformLinks: links,
    };
    // 初始变换与运行期同一执行器（单一推导）：几何永不烘焙结构参数
    applyTransformLinks(
      body,
      envState.waterSize,
      envState.waterPoolHeight,
      envState.waterPoolWallThickness,
    );
    return body;
  },
  getTargets(body, role) {
    return body.parts[role];
  },
  applyLevel(body, level) {
    body.top.position.y = level;
  },
  applyProfile(body, p) {
    // 逐件 scale + 定位（依据为 build 期预捕获的 transformLinks）：顶/底等比铺满，
    // 四壁壁高 = 池深（外壁按壁厚加一截、外偏一个壁厚），全部经 scale.y / position
    // 表达——几何一句不动（ADR-272 扩展，拖池深/壁厚滑块零重建）。
    applyTransformLinks(body, p.size, p.poolHeight, p.wallThickness);
  },
  needsRebuild() {
    // ADR-272 扩展：size / 水位 / 池深 / 壁厚全走 transformLinks，pool 永不重建。
    // 重建契约为真正需要换几何的形态保留（如未来 ocean）。
    return false;
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
