# ADR-097：3D SceneCapability 注册表 + 模型切换复用架构

- **状态**：✅ 已采纳
- **被补充**：[ADR-106](./ADR-106-preview-env-menu-drill-visual.md) 在本 ADR 的注册表之上，扩展两级下钻、分组折叠、跨 cap 预设联动、4 种可视化控件类型（image/color/timeline/histogram）
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-073`（3D 菜单声明式）、`ADR-081`（后处理体积光）、`ADR-084`（L2 资源释放）、`ADR-093`（多模型同框）

---

## 1. 背景（Context）

### 1.1 菜单集成碎片化

3D 预览的场景能力（Sky/Ground/Light/Postprocessing）原先各自独立接入菜单系统：
- `fillEnvironment()` 手工创建 DOM 控件绑定 SkyCapability
- `fillLighting()` 手工创建 6 个滑块绑定 LightCapability
- 新增能力需改 4 个文件（capability 类 + menu-defs + menu 渲染 + mount-preview-core）

问题：每新增一个 3D 能力（Fog/Shadow/Reflector 等）都要走 4 文件 wiring，且菜单渲染与能力逻辑紧耦合。

### 1.2 模型切换无资源复用

`switchToSession()` 切换模型时：
- **复用外壳**：renderer/scene/camera/controls/lighting/sky/postprocessing/rAF 循环
- **重建内容层**：geometry/material/texture/bone-tree/IK 全部 dispose + 重建

关键浪费：
- **纹理无缓存**：同文件纹理每次 fetch + upload，MMD 同目录纹理切换 10 次 = 10 份 GPU 副本
- **几何体无复用**：相同模型重新 parse + upload
- **骨骼树/IK 重建**：buildBoneTree 每次重新构建
- **材质无池化**：同参数材质每次 new

### 1.3 持久化缺失

Sky/Light/Ground 的用户设置（时间/云量/灯光角度等）不调 `safeGet/safeSet`，每次打开 3D 预览重置为默认值。

## 2. 决策（Decision）

### 2.1 SceneCapability 统一接口

新建 `frontend/src/preview-3d/caps/scene-capability.ts`：

```typescript
interface SceneCapability {
  readonly id: string;           // 唯一标识（sky/ground/light/postprocessing/fog/...）
  readonly labelKey: string;     // i18n 菜单标签键
  readonly descKey: string;      // i18n 描述键
  readonly icon: string;         // 菜单图标

  apply(ctx: CapContext): void;  // 挂载到场景
  dispose(): void;               // 释放资源

  // 菜单驱动
  setEnabled(v: boolean): void;
  isEnabled(): boolean;
  setPreset(name: string): void;
  getMenuControls(): MenuControlDef[];

  // 持久化
  saveState(): void;             // → localStorage
  loadState(): void;             // ← localStorage
}
```

**MenuControlDef** 类型：
```typescript
type MenuControlDef =
  | { id: string; kind: "toggle";  getValue: () => boolean; setValue: (v: boolean) => void; labelKey: string }
  | { id: string; kind: "slider";  min: number; max: number; step: number; getValue: () => number; setValue: (v: number) => void; labelKey: string; unit?: string }
  | { id: string; kind: "select";  options: { value: string; label: string }[]; getValue: () => string; setValue: (v: string) => void; labelKey: string };
```

### 2.2 注册表驱动

新建 `frontend/src/preview-3d/caps/scene-capability-registry.ts`：

```typescript
class SceneCapabilityRegistry {
  add(factory: SceneCapabilityFactory): void;
  createAll(ctx: { scene, renderer }): SceneCapability[];
  getById(id: string): SceneCapability | undefined;
  saveAll(): void;    // 持久化所有能力状态
  loadAll(): void;    // 恢复所有能力状态
  dispose(): void;    // 释放所有能力
}
```

底部注册 3 个内置工厂：
```typescript
sceneCapabilityRegistry.add((ctx) => new SkyCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new GroundCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new LightCapability(ctx));
```

### 2.3 菜单自动发现

`preview-menu.ts` 中 `fillEnvironment` / `fillLighting` 重构为通用 `renderCapControls`：
- 遍历 `sceneCapabilityRegistry.getAll()` → 每个 cap 调 `getMenuControls()`
- 自动渲染 toggle/slider/select 控件，无需手工 DOM

### 2.4 生命周期自动管理

- `mount-preview-core.ts`：`sceneCapabilityRegistry.createAll()` + `loadAll()`
- `cleanup-3d.ts`：`sceneCapabilityRegistry.saveAll()` + `sceneCapabilityRegistry.dispose()`
- 新增能力只需：1) 实现接口 2) 注册一行，菜单/持久化/释放全自动

### 2.5 模型切换复用现状（已评估，待实施）

当前 `switchToSession()` 的复用/重建边界：

| 层 | 复用 | 重建 |
|----|------|------|
| 渲染器 | WebGLRenderer, Scene, Camera, Controls | — |
| 灯光/环境 | SkyCapability, GroundCapability, LightCapability, Postprocessing | — |
| 内容层 | — | Geometry, Material, Texture, BoneTree, IK |
| 生命周期 | rAF 循环, Resize/Key 事件 | AnimationMixer, MorphTargets |

**已识别的复用机会（P0-P4）**：

| 优先级 | 改进 | 收益 | 复杂度 |
|--------|------|------|--------|
| P0 | 纹理缓存池（Map<url, Texture>） | 显存省 30-50% | 低 |
| P1 | 几何体缓存（同模型重载） | 减少 parse+upload | 中 |
| P2 | 材质工厂（同参数复用） | 减少 material 创建 | 低 |
| P3 | 骨骼树缓存（同 spec 复用） | IK/bone 零重建 | 中 |
| P4 | LOD 管理（多模型自动降级） | 多模型帧率保障 | 高 |

## 3. 后果（Consequences）

### 正面
- **新增 3D 能力零 wiring**：实现接口 + 注册一行，菜单/持久化/释放全自动
- **菜单渲染与能力逻辑解耦**：`renderCapControls` 通用函数，不关心具体 cap
- **持久化自动**：所有 cap 的 `saveState`/`loadState` 由 registry 统一调用
- **测试覆盖**：10 个险恶测试（重复注册、dispose 后操作、工厂抛错等）
- **模型切换复用边界清晰**：外壳/内容层分离，为 P0-P4 优化铺路

### 负面
- `SceneCapability` 接口较重（10+ 方法），新 cap 需实现全部（可用 partial mock 简化测试）
- 注册表是全局单例，单元测试需注意状态隔离（每个 test 用 new SceneCapabilityRegistry()）

### 已知遗留
- **P0 纹理缓存池**：待实施（ADR-098 候选）
- **P1-P4**：待评估实施优先级
- `cleanup-3d.ts` 保留旧 `ctx.skyCap?.dispose()` 兼容代码，待全量迁移后移除
- `funcmap.md` / `sidebar.gen.mjs` 超 400 行属生成数据，不治理

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `fillEnvironment` 150 行手工 DOM → `renderCapControls` 10 行 | 菜单渲染代码量减 93% |
| `fillLighting` 6 个手工滑块 → 3 个自动 + 3 个特殊 | 基础控件零手工 |
| 3 个 cap 各自 dispose → registry.saveAll + dispose | 生命周期统一管理 |
| `switchToSession` 分析 | 识别 5 个复用改进点（P0-P4） |
| 10 个险恶测试 | 注册表健壮性覆盖 |

---

<!-- 文件名: scene-capability-registry.md → 实际文件 ADR-097-scene-capability-registry.md -->
