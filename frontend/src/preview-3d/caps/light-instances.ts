// ===== light-instances.ts（ADR-329 刀②：三槽位灯实例 / helper / target 生命周期叶）=====
// 职责边界（承 env-ibl/env-hdr-cache 与 postprocessing-composer 叶化范式）：
//   本叶 = **Three 对象生命周期的唯一属主**——三盏灯实例、spot 瞄准点、三副 helper、
//   以及它们共同消费的 target/targetHeight。
//   cap = 状态编排（enabled 门、envState 分派、锥体、ambient、setter 群、菜单、持久化）。
//
// ⚠️ 跨 cap 协作（shadow 重入 `getTypedCap(caps,"shadow")?.apply()`）**刻意留在 cap**——
//   那是状态编排语义（重建后请求 shadow cap 重跑快照），非实例面职责；下沉会让叶反向
//   依赖 cap 查询器，把「纯 Three 生命周期叶」变成半个 cap。
//
// ⚠️ 拆叶易丢的三个不变量（勿在重构中丢）：
//   ① spot 灯的 `.target` 必须是本叶 `spotTarget`（三盏 spot 共享的隐形 Object3D），
//      否则 spot 定向脱钩、锥体朝向失锚；
//   ② `applyLightParams` 的 candela 补偿距离 d = 灯位→target，若 target 迁叶后忘记透传，
//      照度补偿会静默算错（表现：灯变暗/变亮，无报错）；
//   ③ `detach` 清单里三盏灯的 `DirectionalLight.target`（各自独立对象）与本叶
//      `spotTarget`（共享对象）**不是同一个东西**，不可合并简化。
//
// 纯谓词 helperVisibleFor 已另叶（light-visible.ts），锥体已另叶（light-cone.ts），
// 几何/色温数学已另叶（light-math.ts），参数读取已另叶（light-params.ts）——本叶只碰实例。

import * as THREE from "three";
import { envState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import { lightDirToPosition, lightTypeOf, spotDistanceAttenuation } from "./light-math.ts";
import {
  LIGHT_SLOTS,
  type LightInstanceParams,
  type LightSlot,
  readLightParams,
} from "./light-params.ts";
import { lightHelperVisibleFor } from "./light-visible.ts";

/** 三槽位的通用别名（cap 侧 LightKey 同义，叶内沿用灯领域术语） */
export type LightSlotKey = LightSlot;

// [light-gizmo] 方向灯可视化辅助配色：与灯光颜色解耦，仅用于在视口区分三盏灯的来向，
// 让「开/关 + 从哪照来」一眼可见（与聚光灯 SpotLightHelper 线框锥同语义的视觉锚点）。
const DIR_HELPER_COLORS: Record<LightSlot, number> = {
  key: 0xffd9a0,
  fill: 0x6fb1ff,
  rim: 0xff77cc,
};

/** 叶构造入参（cap 构造时装配后传入） */
export interface LightInstancesDeps {
  scene: THREE.Scene;
  /** 对象中心（模型包围盒中心），聚光灯瞄准点 */
  target?: THREE.Vector3;
  /** 聚光灯位于对象上方的高度（= 灯位定位半径 + 锥长） */
  targetHeight?: number;
  /** 能力总闸当前态——helper 显隐谓词三支之一，叶在建/挂 helper 时取用 */
  isMasterOn: () => boolean;
}

/**
 * 三槽位灯实例 + helper + target 生命周期的属主（ADR-329 刀②）。
 * cap 持有一个本类实例，公开 API（getLights/mount/dispose/setTarget…）全部委托，
 * 签名与拆前零变更——生产调用方（shadow cap / screenshot / menu / registry）无需改动。
 */
export class LightInstances {
  private readonly scene: THREE.Scene;
  private readonly isMasterOn: () => boolean;

  /** 对象中心，聚光灯瞄准点（灯位平移基准 + 瞄准点 + 照度补偿距离基准） */
  private target: THREE.Vector3;
  /** 聚光灯位于对象上方的高度 */
  private targetHeight: number;

  // 灯光对象（[light-type-switch] 三盏统一实例，各可 directional/point/spot）
  private keyLight: THREE.Light;
  private fillLight: THREE.Light;
  private rimLight: THREE.Light;
  /** 聚光灯瞄准点（仅 type=spot 的灯使用；全局共享一个隐形 Object3D） */
  private spotTarget: THREE.Object3D;

  // [light-gizmo] 每盏灯一个 helper（类型相关的线框）——类型切换时重建
  private keyHelper: THREE.Object3D | null = null;
  private fillHelper: THREE.Object3D | null = null;
  private rimHelper: THREE.Object3D | null = null;

  constructor(deps: LightInstancesDeps) {
    this.scene = deps.scene;
    this.isMasterOn = deps.isMasterOn;
    this.target = deps.target ?? new THREE.Vector3(0, 0, 0);
    this.targetHeight = deps.targetHeight ?? 8;

    // 聚光灯瞄准点（隐形 Object3D，所有 spot 灯共享）
    this.spotTarget = new THREE.Object3D();
    this.spotTarget.name = "ysm-light-spot-target";
    this.spotTarget.position.copy(this.target);

    // [light-type-switch] 三盏灯统一实例化：createLight 按各盏灯的 type 建对应 Three 对象
    this.keyLight = this.createLight(this.instanceParams("key"), "key");
    this.fillLight = this.createLight(this.instanceParams("fill"), "fill");
    this.rimLight = this.createLight(this.instanceParams("rim"), "rim");
    // [light-gizmo] 每盏灯配一个类型相关 helper（颜色区分），visible 绑三支谓词
    this.keyHelper = this.createHelper(this.keyLight, "key");
    this.fillHelper = this.createHelper(this.fillLight, "fill");
    this.rimHelper = this.createHelper(this.rimLight, "rim");
  }

  /** 从 envState 读单盏灯参数（真值映射在 light-params.readLightParams——叶不重建映射，
   *  免得键名拼装与 FLATTEN_MAP 分叉出第二份事实） */
  private instanceParams(which: LightSlotKey, state: EnvState = envState): LightInstanceParams {
    return readLightParams(state, which);
  }

  /* ----- 灯对象访问（ShadowCapability 经 getLights 消费） ----- */

  /** 当前三盏灯（挂载态由 cap.apply/detach 管理） */
  lights(): THREE.Light[] {
    return [this.keyLight, this.fillLight, this.rimLight];
  }

  getLight(which: LightSlotKey): THREE.Light {
    return which === "key" ? this.keyLight : which === "fill" ? this.fillLight : this.rimLight;
  }

  private setLight(which: LightSlotKey, light: THREE.Light): void {
    if (which === "key") this.keyLight = light;
    else if (which === "fill") this.fillLight = light;
    else this.rimLight = light;
  }

  /** 灯当前实际类型（instanceof 三分支，经 light-math 纯函数） */
  lightTypeOfSlot(which: LightSlotKey): LightInstanceParams["type"] {
    return lightTypeOf(this.getLight(which));
  }

  /* ----- 灯工厂（[light-type-switch] 按 type 建对应 Three 对象） ----- */

  /** 灯位 = 模型中心 + 方位角/仰角方向 × targetHeight。
   *  半径用 targetHeight（switch-preview 设为 `max(maxDim*0.8, 6)`）而非固定值，
   *  使大模型的光源不会陷在网格内部；同时保留旧独立聚光灯「距靶点 = targetHeight」
   *  的 candela 补偿距离语义。spot/point 跟随模型中心；directional 靠 target 同步平移。 */
  private lightPosition(p: LightInstanceParams): THREE.Vector3 {
    return lightDirToPosition(p, this.targetHeight).add(this.target);
  }

  private createLight(p: LightInstanceParams, which: LightSlotKey): THREE.Light {
    const pos = this.lightPosition(p);
    let light: THREE.Light;
    if (p.type === "spot") {
      const spot = new THREE.SpotLight(
        p.color,
        p.intensity,
        p.distance,
        THREE.MathUtils.degToRad(p.angle),
        p.penumbra,
        p.decay,
      );
      spot.position.copy(pos);
      // ⚠️ 不变量①：spot 定向锚定本叶共享 spotTarget（丢了即锥体朝向失锚）
      spot.target = this.spotTarget;
      light = spot;
    } else if (p.type === "point") {
      const point = new THREE.PointLight(p.color, p.intensity, p.distance, p.decay);
      point.position.copy(pos);
      light = point;
    } else {
      const dir = new THREE.DirectionalLight(p.color, p.intensity);
      dir.position.copy(pos);
      // 方向 = position − target；target 跟随模型中心 → 方向恒等于方位角/仰角向量
      dir.target.position.copy(this.target);
      light = dir;
    }
    light.visible = p.enabled;
    // 灯本体与 helper 同口径按**槽位**命名（`which`），三盏同为 spot 也不再重名——
    // 旧实现按类型命名（`ysm-light-${p.type}`）在 types 已切口径不一致，且多 spot 同框时重名，
    // 未来任何「按名查灯」逻辑都会踩雷；helper 早已按槽位命名，此处对齐。
    light.name = `ysm-light-${which}`;
    return light;
  }

  /** 原地更新已有灯的参数（类型不变时） */
  private applyLightParams(light: THREE.Light, p: LightInstanceParams): void {
    light.color.setHex(p.color);
    light.visible = p.enabled;
    light.position.copy(this.lightPosition(p));
    // DirectionalLight 方向 = position − target；target 跟随模型中心才能保证方向语义
    if (light instanceof THREE.DirectionalLight) light.target.position.copy(this.target);

    // [锐评根治 2026-10] spot 与 point 同吃 candela 补偿（原只有 spot）：UI intensity
    // 语义统一为「到达模型中心处照度」。原 point 走裸强度，同参数 spot→point 切换靶点
    // 照度瞬降 targetHeight^decay 倍（默认 8m/1.5 衰减 ≈ 23 倍暗）——同一根「强度」滑块
    // 在两种 type 下物理语义分裂，是参数对接的断层而非观感微差。两型均为位置光、
    // 靶点恒为模型中心（spotTarget 与 this.target 恒等位），补偿式收口成一份防手抄分叉。
    const positional =
      light instanceof THREE.SpotLight || light instanceof THREE.PointLight ? light : null;
    if (positional) {
      // ⚠️ 不变量②：d = 灯位→target，漏传 target 即照度补偿静默算错
      const d = Math.max(light.position.distanceTo(this.target), 0.01);
      const falloff = spotDistanceAttenuation(d, p.distance, p.decay);
      positional.intensity = falloff > 0 ? p.intensity / falloff : p.intensity;
      positional.distance = p.distance;
      positional.decay = p.decay;
    } else {
      light.intensity = p.intensity;
    }

    if (light instanceof THREE.SpotLight) {
      light.angle = THREE.MathUtils.degToRad(p.angle);
      light.penumbra = p.penumbra;
      light.target = this.spotTarget;
    }
  }

  /* ----- 单盏灯同步：类型变化重建，否则原地更新 ----- */

  /**
   * 单盏灯与 envState 对齐（[light-type-switch]）：类型变化 → dispose 旧灯/旧 helper → 重建；
   * 否则原地更新参数 + 刷 helper。
   * @param masterOn 能力总闸当前态（重建后按其决定是否重新挂载；helper 谓词三支之一）
   * @param rebuildHook 类型切换后的跨 cap 善后钩子（cap 传 shadow 重入；纯 Three 叶不应知道 shadow）
   * @returns 是否发生了类型切换重建（cap 据此知道锥体要不要跟着重建）
   */
  syncLight(
    which: LightSlotKey,
    state: EnvState,
    masterOn: boolean,
    rebuildHook: () => void,
  ): boolean {
    const p = this.instanceParams(which, state);
    const current = this.getLight(which);
    const currentType = this.lightTypeOfSlot(which);

    if (p.type !== currentType) {
      // 类型切换：dispose 旧灯 + 旧 helper → 重建（MikuMikuAR 同款）
      this.disposeLight(which);
      const next = this.createLight(p, which);
      // createLight 内建的是原始强度；spot 需经衰减补偿重算（与原地更新路径同源）
      this.applyLightParams(next, p);
      this.setLight(which, next);
      this.setHelper(which, this.createHelper(next, which));
      if (masterOn) {
        this.mountLight(which);
        this.mountHelper(which);
      }
      // [锐评 L-2 收口 2026-09-22] 重建出来的是**裸新灯**（createLight 不碰 castShadow/shadow.*），
      // 而 ShadowCapability 只订阅 "shadow" 组——类型切换写的全是 light* 键，派发永不到它，
      // 旧灯身上的阴影配置随 dispose 一起蒸发（ADR-280 前灯对象终身存活掩盖了这条断口）。
      // 唯一补挂出口 = 请 shadow cap 重跑 apply()：其 disable→restore→现场重快照→施 的
      // 重入自洽序（shadow-capability.ts apply/applyShadows）保证幂等不递归（纯 Three 写、零 envState）。
      // loadState 第③步逐盏重建同样经本分支，一并覆盖。
      rebuildHook();
      return true;
    }

    this.applyLightParams(current, p);
    this.syncHelper(which);
    return false;
  }

  /* ----- helper 显隐（谓词单源在 light-visible.ts） ----- */

  /** helper 可见性唯一谓词三支：能力总闸 ∧ 本灯 enabled ∧ lightHelperVisible */
  private helperVisibleFor(which: LightSlotKey, masterOn: boolean): boolean {
    return lightHelperVisibleFor(
      masterOn,
      this.instanceParams(which).enabled,
      envState.lightHelperVisible,
    );
  }

  /** 类型相关 helper 工厂（颜色按槽位取 DIR_HELPER_COLORS） */
  private createHelper(light: THREE.Light, which: LightSlot): THREE.Object3D {
    let h: THREE.Object3D;
    if (light instanceof THREE.SpotLight)
      h = new THREE.SpotLightHelper(light, DIR_HELPER_COLORS[which]);
    else if (light instanceof THREE.PointLight)
      h = new THREE.PointLightHelper(light, 1, DIR_HELPER_COLORS[which]);
    else
      h = new THREE.DirectionalLightHelper(
        light as THREE.DirectionalLight,
        2,
        DIR_HELPER_COLORS[which],
      );
    h.name = `ysm-light-${which}-helper`;
    // [ADR-293] helper 可见 = 能力总闸 ∧ 本灯开 ∧ 线框总闸（谓词单源，重建即取当前门禁态）
    h.visible = this.helperVisibleFor(which, this.isMasterOn());
    return h;
  }

  getHelper(which: LightSlotKey): THREE.Object3D | null {
    return which === "key" ? this.keyHelper : which === "fill" ? this.fillHelper : this.rimHelper;
  }

  private setHelper(which: LightSlotKey, h: THREE.Object3D): void {
    if (which === "key") this.keyHelper = h;
    else if (which === "fill") this.fillHelper = h;
    else this.rimHelper = h;
  }

  /** helper 显隐（谓词单源：能力总闸 ∧ 本灯 enabled ∧ lightHelperVisible）+ 几何重算 */
  syncHelper(which: LightSlotKey): void {
    const h = this.getHelper(which);
    if (!h) return;
    h.visible = this.helperVisibleFor(which, this.isMasterOn());
    const updatable = h as unknown as { update?: () => void };
    updatable.update?.();
  }

  /** 把单盏灯的 helper 挂到场景并同步显隐（[S1 收口] 谓词单源：能力总闸 ∧ 本灯开关 ∧ 线框总闸——
   *  单独 loadState 后总开关为 off 时 helper 也不该可见） */
  mountHelper(which: LightSlotKey): void {
    const h = this.getHelper(which);
    if (!h) return;
    if (!h.parent) this.scene.add(h);
    h.visible = this.helperVisibleFor(which, this.isMasterOn());
    (h as unknown as { update?: () => void }).update?.();
  }

  /* ----- 挂载 / 卸载 ----- */

  /** 把单盏灯（+ 其 DirectionalLight target）挂到场景 */
  mountLight(which: LightSlotKey): void {
    const light = this.getLight(which);
    if (!light.parent) this.scene.add(light);
    if (light instanceof THREE.DirectionalLight && !light.target.parent) {
      this.scene.add(light.target);
    }
  }

  /** 释放单盏灯与 helper（类型切换前调用） */
  private disposeLight(which: LightSlotKey): void {
    const light = this.getLight(which);
    if (light.parent) light.parent.remove(light);
    if (light instanceof THREE.DirectionalLight && light.target.parent) {
      light.target.parent.remove(light.target);
    }
    light.dispose();

    const h = this.getHelper(which);
    if (h) {
      if (h.parent) h.parent.remove(h);
      (h as unknown as { dispose?: () => void }).dispose?.();
    }
  }

  /** 把三盏灯 + spot 瞄准点 + 三副 helper 挂到场景（cap.apply 委托） */
  mountAll(): void {
    for (const which of LIGHT_SLOTS) this.mountLight(which);
    // 聚光灯瞄准点需要挂到场景图，否则 SpotLight 定向失效
    if (!this.spotTarget.parent) this.scene.add(this.spotTarget);
    for (const which of LIGHT_SLOTS) this.mountHelper(which);
  }

  /** 卸载三盏灯 + ambient 不归本叶（cap 持 ambient）——⚠️ 不变量③：
   *  三盏灯各自的 `DirectionalLight.target`（独立对象）与共享 `spotTarget` 是两回事，
   *  清单不可合并简化。ambient 由 cap 自行摘除（其属主是 sky 让位判据，不是灯实例）。 */
  detach(): void {
    const objs: (THREE.Object3D | null | undefined)[] = [
      this.keyLight,
      this.fillLight,
      this.rimLight,
      this.keyLight instanceof THREE.DirectionalLight ? this.keyLight.target : null,
      this.fillLight instanceof THREE.DirectionalLight ? this.fillLight.target : null,
      this.rimLight instanceof THREE.DirectionalLight ? this.rimLight.target : null,
      this.spotTarget,
      this.keyHelper,
      this.fillHelper,
      this.rimHelper,
    ];
    objs
      .filter((o): o is THREE.Object3D => o !== null && o !== undefined)
      .forEach((o) => {
        if (o.parent) o.parent.remove(o);
      });
  }

  /* ----- target / targetHeight（灯位与锥长的共同基准） ----- */

  /** 平移靶点：三盏灯位置基于 target 重算（方位角/仰角不变），强度/朝向 + helper 同步 */
  setTarget(v: THREE.Vector3): void {
    this.target.copy(v);
    this.spotTarget.position.copy(this.target);
    for (const which of LIGHT_SLOTS) {
      this.applyLightParams(this.getLight(which), this.instanceParams(which));
      this.syncHelper(which);
    }
  }

  getTarget(): THREE.Vector3 {
    return this.target.clone();
  }

  getTargetHeight(): number {
    return this.targetHeight;
  }

  /** 改靶点高度：只影响 spot 灯到目标的物理距离 → 重算 candela 补偿 + 灯位 */
  setTargetHeight(h: number): void {
    this.targetHeight = h;
    for (const which of LIGHT_SLOTS) {
      this.applyLightParams(this.getLight(which), this.instanceParams(which));
      this.syncHelper(which);
    }
  }

  /** spot 灯朝向（世界，光源 → 靶点），结果写入调用方拥有的 `out`。
   *  旧实现把「恒垂直向下」写死进锥体几何，聚光灯一旦可倾斜锥体即与真实光锥脱钩；
   *  统一从 spot 灯/靶点算方向后，默认俯视灯下恒为 (0,-1,0)（旧行为不变），倾斜灯自动跟随。
   *  显式 `out` 形参（而非返回内部暂存向量）：调用方拥有结果生命周期，
   *  消除「外部长期持有即串改」的隐式契约；未归一化，VolumetricCone 内部归一化。 */
  spotDir(light: THREE.SpotLight, out: THREE.Vector3): void {
    out.copy(this.spotTarget.position).sub(light.position);
  }

  /** 释放全部灯与 helper 资源（cap.dispose 委托；three 几何/材质 dispose 幂等） */
  dispose(): void {
    this.keyLight.dispose();
    this.fillLight.dispose();
    this.rimLight.dispose();
    (this.keyHelper as unknown as { dispose?: () => void } | null)?.dispose?.();
    (this.fillHelper as unknown as { dispose?: () => void } | null)?.dispose?.();
    (this.rimHelper as unknown as { dispose?: () => void } | null)?.dispose?.();
  }
}
