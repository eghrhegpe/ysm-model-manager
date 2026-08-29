# ADR-132：多模型选择菜单原语（跨资源类型统一 select）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-29
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-093`（多模型同框引擎核心）、`ADR-080`（资源包模型适配器）、`ADR-126`（声明式菜单 Schema 终态）、`frontend/src/utils/3d/adapters/preview-menu/`、`frontend/src/views/app-preview/mmd-controls.ts`、`frontend/src/utils/3d/adapters/pack-model-adapter.ts`

---

## 1. 背景（Context）

### 1.1 多资源类型都有「一个资源含多个可切换模型」的场景

| 资源类型 | 「多模型」承载 | 现状 |
|---|---|---|
| MMD zip（EntityPlayer/SceneModel） | zip 内多 `.pmx/.pmd` 候选 | ✅ `mmd-controls.ts` 有手写 select（本 ADR 迁移为原语） |
| 资源包（.zip） | `assets/<ns>/models/{block,item}/**/*.json` 多 entry | ⚠️ topBar「上一个/下一个」切换（ADR-080 D3），非根菜单 select |
| 蓝图/投影（.zip） | 10 个 nbt/litematic 打包 | ⏸ 调研确认：zip 容器在导入层已展平成独立 sibling，预览层无「zip 内多 nbt 切换」——是新增能力，不在本 ADR |
| YSM / maid | `spec.models[]` 多组件 / `subModels[]` | ✅ `ui.activeComponent` select（刚修复 per-scene 闭包，6b080b33） |

### 1.2 问题：三套做法并存，各写各的

- MMD zip：手写在 `mmdModelInfoNodes` 里的 `kind:"select"` 节点，get 靠 basename 现场推导（无 per-scene 状态键），set 走 `switchTo` 重建
- 资源包：topBar 切换按钮，不走声明式菜单
- YSM/maid：`ui.activeComponent` 状态层 select（已收敛为 per-scene 闭包）

三者是**同一需求（多模型选择）的三种不同实现**，违反 AGENTS.md「新增 UI 功能必须可被所有数组类菜单调用」铁律。且 MMD 的手写 select 无法被资源包/蓝图复用——各 adapter 只能自己抄一遍。

### 1.3 ADR-093 遗留

ADR-093 §3「后续微任务：dock 模型列表 UI（消费 sceneRegistry）」——多模型同框引擎核心已落地（注册表/dispatch/相机累加），但「模型列表 UI」一直没做。本 ADR 承接该微任务中**最聚焦**的一块：多模型 select 菜单原语。

## 2. 决策（Decision）

### D1 · 新增 `multiModelSelectNode(opts)` 声明式 select 工厂

`frontend/src/utils/3d/adapters/preview-menu/multi-model.ts`：

```ts
export interface MultiModelSelectOpts {
  /** 多模型候选（稳定 id = 切换目标） */
  entries: Array<{ id: string; label: string }>;
  /** 当前选中（per-scene 会话态闭包，对齐 Bug B 范式——不落全局状态层） */
  activeId: () => string;
  /** 切换副作用（adapter 注入：switchTo / showModelGroup） */
  onSelect: (id: string) => void;
  /** i18n labelKey（缺省 preview.component） */
  labelKey?: string;
  /** i18n fallback（缺省「模型」） */
  fallback?: string;
}

export function multiModelSelectNode(opts: MultiModelSelectOpts): PreviewMenuNode;
```

- 返回 `kind: "select"` 声明式节点，`control.options` / `control.get` / `control.set` 全部由工厂装配，**零手写 DOM**
- 单候选（`entries.length < 2`）时返回 `null`（调用方不注入）
- `get` 读 `activeId()` 闭包；`set` 调 `onSelect(id)` + 写会话态
- 复用现成 i18n：`preview.component` / `preview.allComponents`（三语言包已就位，零新增键）

### D2 · 切换语义：复用「虚拟路径 + basename」模式，**不改 build 签名**

调研确认（ebe7fa78）：给 `PreviewAdapter.build` 加可选第三参 `opts?: { subPath?: string }` 需改 **10 处调用点 + 6 处实现签名 + 2 处类型 + switchToSession options 扩展**——改动面过大且与现有架构相悖。

**采用** MMD zip 已验证的「虚拟路径 + basename」模式（mmd-zip-overlay.ts / mmd-adapter.ts:387-392，零签名改动）：

- select 的 `value` 就是完整切换目标（MMD 为 `zip.rootPath + key` 虚拟路径；资源包为 entry path）
- `set` → `switchTo(虚拟路径)` → core switchToSession 复用外壳重建 → build 侧按路径前缀判断（`.zip` 或虚拟路径前缀）重新定位选中模型
- **不**给 `PreviewAdapter.build` 加参、**不**扩展 `switchToSession` options——切换目标天然由 path 携带
- `PreviewStatePath` **不扩展 `multi.${string}` 模板串域**（调研确认：`bindings: Record<typeof KNOWN_PATHS[number]>` 要求字面量全覆盖，模板串会破坏 Record）；当前会话态走闭包（`activeId`），与 `ui.activeComponent` 同范式，未来若状态层化再以**具体字面量路径**（如 `multi.mmd.activeEntry`）进 KNOWN_PATHS

### D3 · 迁移路径（分三档）

| 资源 | 动作 | 说明 |
|---|---|---|
| MMD zip | 迁移 | `mmdModelInfoNodes` 手写 select（mmd-controls.ts:65-86）→ `multiModelSelectNode()` 调用（候选 `zipModelCandidates` 已有，get 的 basename 匹配保留，set → switchTo 虚拟路径不变） |
| 资源包 | 接入 | 现状已走 siblings + core switch 面板（ADR-084 L2）。接入方案：在 pack 适配器/视图层用 `multiModelSelectNode()` 生成根菜单 select（候选 = `ListPackModels` entries），set → `switchTo(entryPath)` 与现有 switch 面板同语义 |
| 蓝图/litematic | 暂不做 | 调研确认：litematic 单 region 聚合、.zip 容器在导入层已展平成独立 sibling、预览层无「zip 内多 nbt 切换」。这是**新增能力**而非重构，单列后续 |
| YSM/maid | 暂不迁移 | 已是 per-scene 闭包 select（6b080b33），形态可后续对齐 |

### D4 · 顺手治理 `[doc:adr-127]` 文档漂移

调研发现：`mmd-controls.ts:38,64`、`mmd-adapter.ts:206,392`、`mmd-zip-overlay.ts:33`、`preview_panel_declarative.md:128` 四处 `[doc:adr-127]` 标记指「zip 多 pmx 选择」，但 **ADR-127 实际主题是「性能档位」**（ADR-127-preview-perf-presets.md）——标记编号与主题不符，是历史文档漂移。本 ADR 落地涉及这些文件时**顺手修正标记**为指向本 ADR（ADR-132）。

### D5 · 否决的方案

- **否决**「给每个 adapter 手写一遍 select」：重复实现、违反铁律（现状即是如此，本 ADR 就是要收编它）
- **否决**「给 PreviewAdapter.build 加 subPath 参数」：10 处调用点 + 6 实现 + 2 类型 + switchToSession options 扩展，改动面过大；虚拟路径模式零签名改动
- **否决**「`PreviewStatePath` 加 `multi.${string}` 模板串域」：`bindings: Record<typeof KNOWN_PATHS[number]>` 要求字面量全覆盖，模板串破坏 Record 类型
- **否决**「走全局状态层落 activeEntry」：跨预览泄漏风险（正是 6b080b33 修的 Bug B），per-scene 闭包才是正确形态
- **否决**「把多模型同台（keepInScene）一并做」：同台是 ADR-093 范围，本 ADR 只做「选择原语」，切模型仍是 switchTo 重建语义

## 3. 后果（Consequences）

### 正面

- 多模型 select 成为**跨资源类型统一原语**，任何 adapter 一行调用即得声明式 select（对齐铁律）
- 消除 MMD 手写 select；资源包从 topBar 切换升级为根菜单 select
- 会话态走 per-scene 闭包（对齐 6b080b33 范式），无跨预览泄漏风险

### 负面 / 风险

- 迁移涉及多 adapter，需逐个验证「候选数据来源 → 原语 → 切换副作用」闭环
- `PreviewStatePath` 域扩展需全仓 typecheck 确认无破坏
- 资源包接入需确认 adapter 拿到 entries 列表的通道（bind 或 ctx 传参）

### 已知遗留

- YSM/maid 组件 select 未迁移（形态可后续对齐）
- 多模型同台（keepInScene）不在本 ADR（ADR-093 范围）
- 蓝图/litematic 视调研结果（若现状已是独立 sibling，则「打包多文件 → select」是新功能，单列）

## 4. 数据溯源

- 来源：`mmd-controls.ts:61-98`（MMD zip select 现状）、`pack-3d.ts`（资源包 entries 枚举）、`pack-model-adapter.ts`（资源包 adapter）、`preview-state.ts:33-40`（PreviewStatePath 域）、`ADR-093 §3`（dock 模型列表 UI 遗留）、`6b080b33`（Bug B per-scene 闭包范式）
- 结果：多资源类型「多模型选择」是同一需求，抽统一原语 `multiModelSelectNode`；状态走 per-scene 闭包；`multi.*` 域仅类型层扩展

<!-- 文件名: multi-model-select-menu-primitive.md → 实际文件 ADR-132-multi-model-select-menu-primitive.md -->
