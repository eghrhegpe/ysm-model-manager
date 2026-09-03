# ADR-168：capability 环倒置：preview-state 查询器注入断组合根运行时边

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-066（识别层注册表驱动）、ADR-073（能力注册表）、ADR-125/126（状态层上浮）、ADR-161（组合根统一）；代码：`preview-3d/state/preview-state.ts`、`preview-3d/caps/scene-capability-registry.ts`、`preview-3d/caps/scene-capability.ts`、`preview-3d/adapters/shared-infra.ts`

---

## 1. 背景（Context）

madge 实测 preview-3d 存在一个「一实两虚」的三角环：

```
preview-state ──(值 import)──▶ scene-capability-registry（组合根，import 全部 10 个 cap）
      ▲                                                          │
      └──────────────(type import)◀── scene-capability ──(type import)──┘
```

- `preview-state.ts:32` **运行时** import 组合根单例 `sceneCapabilityRegistry`，用于四个惰性解析 helper（`toggleCap`/`envToggleCap`/`waterCap`/`groundMatCap`，ADR-126 P5「cap 状态上浮」）在绑定求值时 `getById(id)`。
- 另两条边为 `import type`，编译期擦除。

作者在 `scene-capability-registry.ts:22` 已防「cap → registry」反向 import，在 `menu/core.ts:39` 已有「mount 层透传 `getCap`」的注入范式——唯独 preview-state 漏了：**状态层叶子在运行时背了组合根单例**，依赖方向颠倒。

## 2. 决策（Decision）

**preview-state 不再 import 组合根单例；改为「查询器注入」。**

1. `preview-state.ts`：删除对 `scene-capability-registry.ts` 的值 import；新增模块级注入点 `setSceneCapabilityLookup(lookup: SceneCapabilityLookup | null)`；四个惰性解析 helper 改经注入查询器 `getById`（空查询器 → `undefined`，与现状「registry 无实例」行为一致）。
2. `shared-infra.ts`（唯一 `createAll` 调用者，组合根）：`buildSharedInfra` 内 `createAll` 之后执行 `setSceneCapabilityLookup(sceneCapabilityRegistry)`。
3. 测试适配：`preview-state.test.ts` 的 `mountCaps` 由 spy 注册表方法改为注入 fake lookup。

**不清理注入**：注入对象即 registry 单例本身（长命对象），instances 生命周期由 `createAll`/`dispose` 管理——与现状持有同一引用，行为完全等价。

**理由**：与既有 `menu/core.ts getCap` 透传范式同构；组合根只允许被上层消费、不被叶子运行时反向依赖。

## 3. 后果（Consequences）

正面：
- 运行时环清零；状态层与组合根解耦，破坏性重构（如 registry 实例化方式变更）不再波及 state 层。
- 注入点唯一（组合根），测试可注入 fake lookup 隔离真实 cap 工厂（消除 happy-dom 下无 WebGL renderer 构造失败的既有测试痛点来源）。

负面 / 已知遗留：
- 另两条 `import type` 边仍在（scene-capability → preview-state 的 `PreviewSnapshot`、registry → scene-capability），编译期擦除、仅伤 madge/工具链心智——**二期**将 `PreviewSnapshot` 下沉独立类型叶子文件后全清。
- `menu/settings.ts`、`menu/env.ts`、`screenshot-lights.ts` 对 registry 的直接 import 为单向合法依赖（registry 不反向 import 它们），不在本次范围。

## 4. 数据溯源

外部评审（frontend/src 循环依赖报告）→ madge 实测环清单 → 定向读三方源码（preview-state L100-175 四 helper、registry L111-129 单例+内置注册、scene-capability L9/91 类型依赖）→ 确定唯一运行时边在 preview-state:32 → grep `createAll` 调用者定位注入点 shared-infra:112 → 方案。
