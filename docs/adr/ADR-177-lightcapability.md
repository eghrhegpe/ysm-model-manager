# ADR-177：拆分 LightCapability 为编排器 + 协作子模块

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/light-capability.ts`（968 行，类体 ~560 行）；ADR-081 L1（体积光锥递进，预留 postprocess 引擎）；ADR-073（能力注册表驱动）；ADR-126 P5（手动预设优先）；ADR-168（类型下沉）

---

## 1. 背景（Context）

`LightCapability`（968 行，类体约 560 行）是 `preview-3d` 超级大区（占前端 38%）里最大的单类之一。
代码体检（2026-09-04）发现它**单类混装五职责**：

| 职责 | 体量 | 当前位置 |
|---|---|---|
| ① 灯光对象管理（key/fill/rim/ambient/spotlight + 阴影协作） | 核心 | `LightCapability` 主体 |
| ② 体积光锥体（GLSL + 几何 + 材质 + 挂载状态机） | ~150 行 + 2 段 shader | `createVolumetricMaterial/buildConeGroup/rebuildCone/disposeCone/updateConeUniforms/attachCone` |
| ③ 预设系统（7 类模型预设 + 手动优先 + 当前预设记忆） | ~50 行数据 + 逻辑 | `LIGHT_PRESETS` / `setPreset` / `getCurrentPreset` |
| ④ 菜单 UI 定义（4 个 builder + 聚合） | ~115 行 | `lcBuildMain/Spotlight/Volumetric/ThreePoint` |
| ⑤ 状态持久化（save/load + 方向灯全量恢复 + 引擎恢复） | ~110 行 | `saveState` / `loadState` / `restoreDir` |

最刺眼的是 `setVolumetricEngine("cone" | "postprocess")`：**双引擎抽象立起来了，cone 引擎实现却内嵌在灯光类里**——
抽象做了一半，比不做更贵：给了"已解耦"的错觉，实际改锥体仍要动整个灯光类。

**外部约束（决定拆分边界）**：
- 6 个外部文件**仅 `import type { LightCapability }`**（类型注解），公开类名与公开方法签名必须逐字节稳定。
- 另有 3 个符号有外部引用：`DirectionalLightParams`(`screenshot-lights.ts`)、`lightDirToPosition`(`screenshot-render.ts`)、`attenuateAmbientForSky`(`screenshot-lights.ts`)。
- `light-capability.test.ts`（551 行 / ~40 用例）覆盖锥组挂载状态机、持久化往返、引擎切换等全部棘手边界——**任何重构不得破坏其可观察行为**。
- 本仓**无 `Capability` 基类**：持久化靠 `persistState/restoreState/restoreFields` 共享工具，各 cap 直接 `implements SceneCapability`。故"状态持久化提基类"在现状下不可行，改为保留 `saveState/loadState` 在公开类并复用 `restoreFields`（与 sky/water 同构）。

## 2. 决策（Decision）

采用**"公开编排类 + 协作子模块"**模式：`LightCapability` 仍 `implements SceneCapability` 且类名、构造函数签名、所有公开方法签名保持不变；内部将三块高内聚职责下沉为独立模块，灯光对象管理（①）留在编排类作为核心职责。

### 2.1 文件布局

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `caps/light-capability.ts` | 编排类 + 灯光对象（①）+ `lightDirToPosition`/`attenuateAmbientForSky`（保留，外部引用） | `LightCapability`、`export * from "./light-presets.ts"`（类型/数据零改外部 import）、上述两个工具函数 |
| `caps/light-cone.ts`（新建） | 体积光锥体（②）：`VolumetricCone` 类 + shader 字符串 + `VolumetricConeUniforms` + `tryDisposeMat`/`ALL_TEX_KEYS` | `VolumetricCone` |
| `caps/light-controls.ts`（新建） | 菜单 UI 定义（④）：4 个 builder 收敛为 `getLightMenuControls(cap)` | `getLightMenuControls` |
| `caps/light-presets.ts`（新建） | 预设数据 + 合并（③ 数据面）：`*Params` 接口、`DEFAULT_*`、`DEFAULT_LIGHT_PARAMS`、`LIGHT_PRESETS`、`deepMergeLightParams`、`DeepPartial` | 上述全部（经 light-capability 重导出） |

> 预设的**应用逻辑**（`setPreset`/`getCurrentPreset`/手动优先）留在 `LightCapability`——它直接读 `this.params` 并触发 `syncLightsFromParams`/`rebuildCone`，与锥体、灯光强耦合，不强行外移。即③只搬"数据 + 纯合并函数"，行为不变。

### 2.2 `VolumetricCone` 接口（② 的干净契约）

```ts
class VolumetricCone {
  constructor(scene: THREE.Scene);
  /** dispose 旧实例后重建几何+材质；spotlight/volumetric 未同时启用则产出 null group */
  rebuild(height: number, spotlight: SpotlightParams, volumetric: VolumetricParams, spotlightPos: THREE.Vector3): void;
  /** 挂入场景并对齐 spotlightPos（幂等：已在场景则只同步位置） */
  attach(spotlightPos: THREE.Vector3): void;
  /** 从场景移除 group */
  detach(): void;
  isMounted(): boolean;
  /** 仅更新现有材质 uniforms（setVolumetric 走此路径，不重建几何） */
  updateUniforms(spotlight: SpotlightParams, volumetric: VolumetricParams): void;
  /** 仅同步位置（setTarget 走此路径） */
  syncPosition(spotlightPos: THREE.Vector3): void;
  /** detach + dispose 几何/材质（dispose 时调用） */
  dispose(): void;
}
```

`LightCapability` 持 `private cone = new VolumetricCone(this.scene)`，原 `coneGroup/coneUniforms/coneMaterial/coneHeight` 四个私有字段整体移入 `VolumetricCone`。编排类在 `setSpotlight/setVolumetric/setPreset/setParams/setTarget/setTargetHeight/setVolumetricEngine/loadState/apply/dispose` 中改调 `this.cone.*`，**调用顺序与挂载判定语义与原实现逐行对齐**（以测试为契约）。

### 2.3 双引擎半截抽象的处理

`setVolumetricEngine("cone" | "postprocess")` 现状：cone 引擎 → 委托 `VolumetricCone`；postprocess 引擎 → 仅关闭 cone（真正渲染由 `PostprocessingCapability` 经 `getVolumetricEngine()==="postprocess"` 接管，已就绪）。**本 ADR 不改此行为**，仅把 cone 实现彻底隔离，使"postprocess 引擎未来可独立实现"的接缝更干净。postprocess 体积光渲染本身仍属 ADR-081 L1 后续，不在本 ADR 范围。

### 2.4 持久化（⑤）

保留 `saveState`/`loadState` 在 `LightCapability`（触达大量私有字段，且锥组重挂 + 预设优先 + 引擎恢复的顺序语义极敏感）。标量字段恢复从手写 `typeof` 守卫改用 `restoreFields`（与 sky/water 同构，消除 jscpd 样板），**恢复顺序与早退语义不变**。

## 3. 后果（Consequences）

**正面**
- `light-capability.ts` 从 968 行降至约 480 行；`VolumetricCone`（~200 行）成为自包含、可单测单元。
- cone 改动不再触碰灯光类；双引擎接缝清晰，未来 postprocess 引擎可独立落地。
- 公开 API（`LightCapability` 类名 + 所有方法 + 构造函数）零变化，6 个外部 import、`light-capability.test.ts`（~40 用例）全部无感。

**负面 / 成本**
- 新增 3 个模块文件，import 关系略增（仅模块内，外部可见面不变）。
- `light-capability.ts` 需 `export * from "./light-presets.ts"` 以维持外部对类型/数据的 import 零改动（轻微间接层）。

**已知遗留**
- 持久化仍是每 cap 内联，未抽统一基类（本仓无基类现状下的取舍，见 §1）。
- postprocess 体积光渲染未实现（接缝已备，行为未变）。

## 4. 数据溯源

- 源：`frontend/src/preview-3d/caps/light-capability.ts`（968 行）+ `light-capability.test.ts`（551 行，~40 用例）。
- 外部依赖审计：6 文件 `import type { LightCapability }`；`DirectionalLightParams`→`screenshot-lights.ts`；`lightDirToPosition`→`screenshot-render.ts`；`attenuateAmbientForSky`→`screenshot-lights.ts`。
- 契约基准：`scene-capability.ts` `SceneCapability` 接口（id/apply/dispose/setEnabled/getMenuControls/saveState/loadState + 可选 setPreset/update/subscribe）。
- 范式参照：`sky-capability.ts` 用 `restoreFields` 收口持久化；各 cap `implements SceneCapability` 直连、无基类。
- 结果：拆分后 `npx vitest run`（含 light-capability 测试）→ 全绿；`tsc --noEmit` 零错误；`vite build` 通过。

<!-- 文件名: lightcapability.md → 实际文件 ADR-177-lightcapability.md -->
