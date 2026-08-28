---
kind: scene_capability_registry
name: 场景能力注册表 scene-capability-registry
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/caps/
  - frontend/src/utils/3d/adapters/scene-registry.ts
tests:
  - frontend/src/utils/3d/caps/scene-capability-registry.test.ts
  - frontend/src/utils/3d/caps/ground-capability.test.ts
  - frontend/src/utils/3d/caps/light-capability.test.ts
use_when:
  - 场景能力 / cap / registry / SceneCapability
  - 3D 菜单控件声明式渲染（getMenuControls）
  - 新增 3D 能力（雾/阴影/反射/环境/灯光/后处理）
  - 3D 会话生命周期（createAll / loadAll / setPreset / saveAll / dispose）
  - 「光」指代消歧（light 是光源，fog/shadow/reflector 不是）
invariant_anchors:
  - frontend/src/utils/3d/caps/scene-capability-registry.ts|sceneCapabilityRegistry
  - frontend/src/utils/3d/caps/scene-capability.ts|SceneCapability
  - frontend/src/utils/3d/adapters/mount-preview-core.ts|createAll
  - frontend/src/utils/3d/adapters/preview-menu-env.ts|buildEnvSchema
  - frontend/src/utils/3d/adapters/preview-menu-env.ts|renderEnvLevel
---

# 场景能力注册表 scene-capability-registry

## 概览

ADR-073 扩展落地的**场景能力注册表**：所有场景能力（Sky / Ground / Environment / Fog / Shadow / Reflector / Light / Postprocessing）由统一注册表**创建、持久化、释放**，菜单由各能力的 `getMenuControls()` 声明式驱动。新增能力只需两步——实现 `SceneCapability` 接口 + 在 registry 底部 `add()` 注册一行——菜单/生命周期/持久化零手工 wiring。

这正是「**新类型加面板零改核心菜单**」的机制：隔壁会话按此模式在 2 小时内接入了 Fog/Shadow/Reflector/Environment/Postprocessing 五个新能力，核心菜单只字未动。

## 核心职责

- **能力工厂注册与实例化**：`add(factory)` 登记工厂；`createAll({ scene, renderer })` 先 `dispose()` 旧实例，再逐个工厂 try/catch 创建（单个能力抛错不阻断其余）
- **统一生命周期**（mount-preview-core 驱动）：
  1. `createAll` → 2. `getById` 引用 → 3. `loadAll`（localStorage 恢复）→ 4. `setPreset(adapter.id)`（模型类别预设，已有持久化值不覆盖用户显式选择）→ 5. `apply()` 挂入场景 → 会话结束 `saveAll()` + `dispose()`
- **声明式菜单**：每 cap 的 `getMenuControls()` 返回 `MenuControlDef[]`，`preview-menu` 的 `renderCapControls` 统一渲染五种控件（`toggle / slider / select / button / divider`）。**菜单层不碰能力实现**——引擎/锥角/预设等参数操作全部由 cap 自报控件
- **持久化**：`persistState` / `restoreState`（localStorage 前缀 `ysm-scene-cap-`，隐私模式安全降级静默）

## 对外 API / 入口

- `sceneCapabilityRegistry`（`scene-capability-registry.ts` 模块级单例）：`add` / `createAll` / `getAll` / `getById` / `saveAll` / `loadAll` / `dispose` / `getFactoryCount`
- `SceneCapability` 契约（`scene-capability.ts`）：`id` / `labelKey` / `icon` / `descKey` / `apply` / `dispose` / `setEnabled` / `isEnabled` / `getMenuControls` / `saveState` / `loadState`（`setPreset` 可选）
- `MenuControlDef`：`id`（稳定，持久化/调试用）/ `kind` / `labelKey` / `fallback` / `slider?` / `select?` / `getValue` / `setValue`

## 与其他子系统关系

- **mount-preview-core**：`createAll` 建实例 → `getById("sky"/"ground"/"light"/"fog"/"shadow"/"reflector"/"environment"/"postprocessing")` 引用 → 生命周期驱动；Shadow 额外调 `syncLights` / `applyMeshCasts`（与 Light 解耦，经 scene 遍历取光）
- **preview-menu / preview-menu-env**：环境面板由 `preview-menu.ts` 经 `buildEnvSchema`（声明式 schemaBuilder，内部调 `renderEnvLevel`）只收 **ENV_IDS 白名单**（sky/ground/environment/fog/reflector，`getAll().filter(ENV_IDS.has)`），`fillLighting` 查 `light`，阴影面板查 `shadow`——同一能力控件**不会双面板重复**
- **cleanup-3d**：会话清理统一 `saveAll()` + `dispose()`，cap 自身 dispose 还原构造前状态（`scene.fog` / `renderer.shadowMap` / tone mapping 等）
- **i18n**：cap 的 `labelKey`/`descKey` 需三语入库（`frontend/src/core/i18n/locales/`），缺键时 `tr()` 回退 fallback 中文

## 不变量

- **注册顺序 = 菜单渲染顺序**：Sky → Ground → Environment → Fog → Shadow → Reflector → Light（→ Postprocessing），与「先环境后灯光」心智一致，新能力按此语义插队注册
- **`scene-capability.ts` 只含接口/类型/持久化工具**：旧版双单例（`sceneCapabilityRegistry`）已于 2026-08-18 清理删除，**勿从该文件 import 同名单例**——唯一实现在 `scene-capability-registry.ts`
- **「光」指代消歧**：`light` 是唯一光源能力（主灯/补灯/轮廓灯/顶光/环境光/体积光）；`fog`（雾）、`shadow`（阴影）、`reflector`（反射）不是光源，菜单/语义归环境类
- **setPreset 只做合理默认**：不覆盖用户显式选择（reflectionMode / enabled 等持久化值优先）
- **dispose 必须还原构造前状态**（prevFog / prevShadowMap / prevToneMapping），防跨会话泄漏

## 相关

- ADR-073（caps/ 能力模式）、ADR-075（环境面板）、ADR-081（灯光 L1/L2）、ADR-099（3D Cap Registry 分层与 SSR 闭环）
- 知识卡：`preview_core.md`（统一 3D 预览核心，mount3D 生命周期）
