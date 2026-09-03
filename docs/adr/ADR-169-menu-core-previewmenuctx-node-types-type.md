# ADR-169：menu/core 类型叶下沉：PreviewMenuCtx 归位 node-types 断子模块纯 type 环

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-076（v3 菜单拆分）、ADR-093（声明式菜单 Schema）、ADR-126（状态层上浮）、ADR-168（capability 环倒置，同型「一实多虚」环处置先例）；代码：`preview-3d/menu/core.ts`、`preview-3d/menu/node-types.ts`、`preview-3d/menu/{env,roles,switch,settings}.ts`

---

## 1. 背景（Context）

madge 实测 `menu/core.ts` 参与 4 个循环依赖（评审 B2 指控）：

```
core.ts ──(值 import)──▶ env.ts / roles.ts / render.ts（→ settings.ts 传递）
   ▲                          │
   └────(type import)◀──── env.ts / roles.ts / switch.ts / settings.ts
        （各文件仅 import type { PreviewMenuCtx } from "./core.ts"）
```

- `core.ts` **值** import `env.ts`（`disposeEnvSubscriptions`/`buildEnvSchema`）、`roles.ts`（`fillRoles` 等）、`render.ts`——编排层依赖子模块实现。
- `env/roles/switch/settings` 四文件反向 **type** import `core.ts` 的 `PreviewMenuCtx`（根菜单上下文接口），形成「一实多虚」环——与 ADR-168 处置的 capability 环同型。

`PreviewMenuCtx` 定义在编排层 core.ts，而它只是纯数据类型（`getCap: (id) => SceneCapability | null` 等 getter 集合，零运行时逻辑），被**叶子子模块**引用——依赖方向颠倒。

## 2. 决策（Decision）

**`PreviewMenuCtx` 下沉至既有菜单类型叶 `node-types.ts`，四子模块改指叶子。**

1. `node-types.ts`（自称「纯类型叶」，已持 `PreviewMenuNode`/`PreviewControlSpec`/`PreviewActionMenuCtx`）：新增 `PreviewMenuCtx` 接口定义（自 core.ts 字节级搬移，含 JSDoc），补充 type import `SceneCapability`（caps）+ `CameraControlBridge`（adapters）。
2. `core.ts`：删除接口定义，原位 `export type { PreviewMenuCtx } from "./node-types.ts"` re-export 保公共面——外部消费者（`mount-preview-core.ts` / `items.test.ts`）的 import 语句**零改动**。
3. `env.ts`/`roles.ts`/`switch.ts`/`settings.ts`（+`env.test.ts`）：`import type { PreviewMenuCtx } from "./core.ts"` → `"./node-types.ts"`。

**不选新建独立 `menu/types.ts`**：node-types.ts 已是 menu 内被广泛依赖的现有类型叶（roles/settings/render 均已引用），ctx 归位其下零新增文件；「类型聚于叶、实现留编排层」与 ADR-129「类型本位」先例一致。

## 3. 后果（Consequences）

正面：
- `menu/core.ts` 的 4 个循环依赖清零（madge 实测：仅剩 `mount-preview-core` 家族 4 环，属 C1 已判「闭包编排器不拆」的既有环）。
- 编排层 core.ts 不再被叶子子模块反向 type 引用——子模块（env/roles/switch/settings）依赖方向单一（→ 类型叶 / → caps / → state）。
- `PreviewMenuCtx` 与 `PreviewActionMenuCtx`（已同驻 node-types.ts）同域聚合，ctx 类型心智集中。

负面 / 已知遗留：
- core.ts 保留 re-export 行——公共面兼容但符号「物理定义处」在 node-types.ts，后续消费者可渐进改指叶子（非必改）。
- `mount-preview-core` 家族 4 环（scene-registry/shared-infra/switch-preview/unload-model）为既有闭包编排器互引，C1 已判维持不拆，不在本 ADR 范围。

## 4. 数据溯源

外部评审（B2：menu/core ↔ roles/switch/env/settings 环）→ madge 实测 4 环清单 → 定向读 core.ts import 面（值边）+ 四文件反向引用（全为单行 `import type { PreviewMenuCtx }`）→ 读 ctx 接口体（L37-72，仅依赖 SceneCapability/CameraControlBridge + 原始类型）→ 定 node-types.ts 为下沉宿主（既有类型叶、menu 内广泛依赖）→ 执行 + madge 前后对照。
