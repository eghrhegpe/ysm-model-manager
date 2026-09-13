# ADR-235：preview-3d 目录语义归位：adapters 拆分与 menu 前缀升格

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/`、`frontend/src/preview-3d/menu/`、`frontend/src/preview-3d/infra/`；ADR-227（单例收敛战役）、ADR-233（会话状态机，B 组近期落点）、ADR-146（路径别名反桶）、ADR-225（perception 下沉）

---

## 1. 背景（Context）

### 1.1 命题界定：这是整洁债，不是质量债

2026-09-14 对 `frontend/src/preview-3d/`（190 个生产文件 / 37845 行）做架构锐评。结论先行：**代码质量无需整改，目录语义需要整改**。硬指标实测全绿：

| 指标 | 实测 | 判定 |
|------|------|------|
| `any` 出现 | 2 处（`menu/env.ts`、`menu/components-styles.ts`） | 已收敛 |
| `@ts-ignore` / `@ts-expect-error` | 0 处 | 达标 |
| 生产代码非空断言 `!.` | 43 处（`ysm-adapter.ts` 占 11） | 可接受 |
| `check-layering` 门禁 | 无 `preview-3d` 违规 | 达标 |
| `index.ts` 裸目录聚口 | 0 个 | 达标（ADR-146） |
| 模块级 `let` 可变状态 | 14 个文件 | ADR-227 已收敛中 |

`caps/` 能力层为范本级：7 个能力类统一 `implements SceneCapability` + `apply()`/`dispose()` 契约；`mount-preview-core.ts` 的 `assembleShell` 注释解释 WHY、标注 ADR 号、记录回归教训（L609「兜底须在 `body!` 消费前」）。**本次不触及任何实现逻辑，只搬门牌。**

### 1.2 核心病症：`adapters/` 名不副实

`adapters/` 是 `preview-3d` 内被引用最多的目录（`@/preview-3d/adapters/` 118 处 import：外部 68 + 内部 50），但 30 个顶层生产文件中**仅 3 个是真 adapter（占比 10%）**：

- 真 adapter：`ysm-adapter.ts`、`litematic-adapter.ts`、`pack-model-adapter.ts`（及 `mmd/`、`vrm/`、`fbx/`、`shared/` 格式家族）
- 寄居者：28 个，含核心装配器 `mount-preview-core.ts`（1041 行）、代际守卫 `session-ledger.ts`、`switch-preview.ts`（501 行）

即：**全区最重要的装配中枢，藏在名为「适配器」的抽屉里**。新人导航成本与 AI 检索命中率双输。

### 1.3 精确分组：28 个寄居者无余数拆分

按真实职责（已逐个核实导出符号）分为三组，**无一个文件无处可去**：

| 组 | 职责 | 数量 | 判定依据 |
|----|------|------|----------|
| A | 菜单节点构造器 | 5 | `material-controls` / `morph-controls` / `perception-controls` / `bones-panel-node` / `menu-graph` 均返回 `PreviewMenuNode`，import `@/preview-3d/menu/node-types.ts` |
| B | 装配与会话生命周期 | 5 | `mount-preview-core` / `mount-session` / `switch-preview` / `session-ledger` / `shared-infra` |
| C | 共享基础设施 | 17 | 渲染宿主、相机、拾取、外壳、注册表、worker 桥等 |

### 1.4 次级病症：`menu/` 用命名前缀模拟模块

`menu/`（23 文件 / 5222 行）内部高度依赖前缀命名空间：

- `render.ts`（753 行）：15 个 `rm*` 函数（`rmMakeRowBase` / `rmAppendFolder` / `rmAppendDynamicRow` …）
- `cap-controls.ts`（671 行）：12 个 `renderCap*` 函数（`renderCapToggle` / `renderCapSlider` / `renderCapColor` …）

前缀是「文件内模块化」的补偿手段——当一个文件需要前缀来分区时，说明它已承担目录的职责。

### 1.5 关键约束：B 组是高频改动区（ADR-227 + ADR-233 双战役叠加）

ADR-227「preview-3d 模块级单例收敛为实例（P1 战役）」当前 **🔄 部分采纳**，其 §2 决策 2 明确最终目标：

> 把 `mount-preview-core` / `shared-infra` / `mount-session` 的运行态进一步收敛为 `PreviewSession` 类实例（方案 A）

ADR-233「preview-3d 会话生命周期状态机收敛」已于 2026-09-13 进入**已实施**态，落点同样是 B 组：`mount-session.ts` 加 `SessionStatus` / `guardSessionAlive` / teardown、`switch-preview.ts` 收敛 3 处逐字咒语、`mount-preview-core.ts` 接入 status 迁移。

**B 组 5 个文件同时是 ADR-227 的战役目标与 ADR-233 的近期落点。** 若此刻单独立案搬移，文件极可能在类化时被重命名/拆分，造成二次 churn。故本 ADR 将 B 组**绑定 ADR-227 节奏**，不抢跑；批次 A / C 不受战役影响，可先行。

### 1.6 历史先例

commit `7061818c4`「根级散文件归位 mesh/ 与 infra/」已确立「散装文件按职责归位子目录」的先例，但 `adapters/` 内部未竟全功——本 ADR 是该先例的收尾。

---

## 2. 决策（Decision）

采用 **「目标结构一次性锁定 + 分三批执行 + B 组绑定 ADR-227」** 策略。

### 2.1 目标结构

```
preview-3d/
├── adapters/          仅格式适配器家族（3 顶层 + mmd/ vrm/ fbx/ shared/）
├── mount/             【新建】装配与会话生命周期（B 组 5 文件）
├── infra/             【已有·扩充】共享基础设施（C 组 17 文件）
├── menu/
│   ├── render/        【阶段三】rm* 前缀升格目录
│   └── cap-controls/  【阶段三】renderCap* 前缀升格目录
└── （bone/ caps/ decoder/ materials/ mesh/ model/ state/ texture/ 不变）
```

**命名裁定**：不新增 `core/`——`frontend/src/core` 已是「引擎无关内核」（ADR-189 D4），同名的 `preview-3d/core` 会造成语义撞车。复用既有的 `infra/`（16 文件 / 98 处引用，语义已确立）+ 新建 `mount/`（语义=编排，与 infra=基建 正交）。

### 2.2 归位映射表

**批次 A — 菜单节点构造器 → `menu/`（5 文件，无战役冲突，可立即执行）**

| 源文件 | 目标 |
|--------|------|
| `adapters/material-controls.ts` | `menu/material-controls.ts` |
| `adapters/morph-controls.ts` | `menu/morph-controls.ts` |
| `adapters/perception-controls.ts` | `menu/perception-controls.ts` |
| `adapters/bones-panel-node.ts` | `menu/bones-panel-node.ts` |
| `adapters/menu-graph.ts` | `menu/menu-graph.ts` |

**批次 B — 装配与会话 → `mount/`（5 文件，⚠️ 须与 ADR-227 PreviewSession 类化同步）**

| 源文件 | 目标 |
|--------|------|
| `adapters/mount-preview-core.ts` (1041) | `mount/mount-preview-core.ts` |
| `adapters/switch-preview.ts` (501) | `mount/switch-preview.ts` |
| `adapters/shared-infra.ts` (365) | `mount/shared-infra.ts` |
| `adapters/mount-session.ts` (364) | `mount/mount-session.ts` |
| `adapters/session-ledger.ts` | `mount/session-ledger.ts` |

**批次 C — 共享基建 → `infra/`（17 文件，无战役冲突）**

| 源文件 | 目标 |
|--------|------|
| `render-host.ts` / `render-loop.ts` | `infra/` |
| `camera-controls.ts` / `wasd-camera.ts` / `input-and-animation.ts` | `infra/` |
| `unified-pick.ts` / `preview-shell.ts` / `overlay-active.ts` / `preview-loading.ts` | `infra/` |
| `postprocessing.ts` / `schema-registry.ts` / `scene-registry.ts` / `register-built-scene.ts` | `infra/` |
| `worker-bridge.ts` / `ui-constants.ts` / `content-bridges.ts` / `unload-model.ts` | `infra/` |

**阶段三 — `menu/` 前缀升格目录（可逆，优先级最低）**

- `menu/render.ts` 的 15 个 `rm*` → `menu/render/` 目录，前缀去除
- `menu/cap-controls.ts` 的 12 个 `renderCap*` → `menu/cap-controls/` 目录，前缀去除

### 2.3 执行纪律

1. **测试随源走**：`*.test.ts` 与源文件同目录同步迁移（项目既有约定）。
2. **路径别名**：一律 `@/preview-3d/<新目录>/<具体文件>.ts`，精确同目录用 `./`——遵守 ADR-146，禁止裸目录聚口。
3. **批量改 import**：迁移后全量 `grep "@/preview-3d/adapters/"` 替换（预计 118 处），每批次结束后跑 `cd frontend && npx vite build && npm run typecheck`。
4. **格式化复查**：`node scripts/check-biome.ts --files <改动文件...>`。
5. **不得顺手改逻辑**：本 ADR 授权范围仅路径变更，任何行为修改另案。

### 2.4 非目标（Out of Scope）

- 不重构 `caps/` 能力层（已达标）。
- 不改 `mount-preview-core.ts` 内部结构（属 ADR-227）。
- 不处理测试体积倒挂（`mmd-adapter.test.ts` 2031 行 vs 源文件 76 行）——另案。
- 不清 `perception/` 空壳目录——不属本 ADR（可直接 `rmdir`，见 §3 遗留）。

---

## 3. 后果（Consequences）

**正面**

- `adapters/` 名实相符，格式适配器家族一眼可辨（10% → 100% 纯度）。
- 装配中枢独立为 `mount/`，与 ADR-227 的 `PreviewSession` 类化目标目录天然对齐——**类化落地时无需二次搬家**。
- 前缀命名空间消除：`rm*` / `renderCap*` 降为目录内普通函数，新增行变体不再需要发明新前缀。
- AI 与新人检索命中率提升：按职责检索（`mount/` = 挂载、`infra/` = 基建）取代按历史惯性检索。

**负面 / 风险**

- **churn 成本**：118 处 import 需批量替换，涉及 `app-modules.ts`、`menu/*`、`caps/postprocessing-capability.ts` 等多目录。属纯机械改动，可分批提交降低风险。
- **并行会话冲突**：`preview-3d` 区存在兄弟 AI 活跃（ADR-227 战役中）。大批次路径变更易与其冲突 → **批次 B 必须等 ADR-227 类化窗口**，批次 A/C 建议与兄弟会话错峰。
- **git 追踪**：路径变更须走 `git mv` 语义（或用 `--files` 白名单同时包含新旧路径），避免 rename 半身丢失。
- **知识卡漂移**：`docs/knowledge/3d-patterns.md` 等卡的 `source_files` / `invariant_anchors` 含 `preview-3d/adapters/mount-preview-core.ts` 等路径，迁移后须同步（pre-commit 的 `check-knowledge-drift` 会提示）。

**已知遗留**

- `frontend/src/preview-3d/perception/` 为空壳目录（ADR-225 下沉后残留，commit `d4888d588` 已删内容但目录未除，git 不跟踪空目录）。**可随时 `rmdir`，零风险，不属本 ADR 范围。**
- `caps/sky-capability.ts` 的 `injectSkySunScalePatch`（L55，约 100 行）越位于 `SkyCapability` class 之外，建议收为私有方法或独立 `sky-patch.ts`——零风险小改，可搭批次 C 顺风车。
- 测试命名错位（11 个测试按行为命名、无同名源文件，如 `menu/node-render.test.ts` 实测 `render.ts`）——**已核实非孤儿测试**，建议加前缀消歧，另案。

---

## 4. 数据溯源

| 结论 | 来源 → 结果 |
|------|-------------|
| `adapters/` 纯度 10% | `ls adapters/*.ts` 分类 → 31 生产文件中 3 个含 `adapter` |
| 118 处 import 影响面 | `grep -rn "@/preview-3d/adapters/" frontend/src` → 外部 68 + 内部 50 |
| A/B/C 三组无余数拆分 | 逐个 `grep "export function"` 核实导出符号 → 5（`PreviewMenuNode` 构造器）+ 5（装配会话）+ 17（基建）= 27 |
| 硬指标全绿 | `grep "any"` → 2；`@ts-ignore` → 0；非空断言 → 43；`node scripts/check-layering.ts` → exit 0 无 preview-3d 违规 |
| B 组撞车风险 | ADR-227 §2 决策 2「收敛为 `PreviewSession` 类实例（方案 A）」+ 状态 🔄 部分采纳；ADR-233 实施态落点同为 `mount-session.ts` / `switch-preview.ts` / `mount-preview-core.ts` |
| 不新增 `core/` | ADR-189 D4：`frontend/src/core` 为引擎无关内核，同名会语义撞车 |
| 复用 `infra/` 有先例 | commit `7061818c4`「根级散文件归位 mesh/ 与 infra/」 |
| `perception/` 空壳 | `git log -- .../perception/` → `d4888d588`「收尾移除旧 perception 目录（ADR-225 下沉后残留删除半身）」 |

## 5. 待拍板项

1. **目录命名**：`mount/`（推荐）vs `infra/mount/`（不新增一级目录）？
2. **批次顺序**：A+C 先行、B 等 ADR-227；还是全部等 ADR-227 收口后一次做完？
3. **阶段三是否纳入本次**：`menu/` 前缀升格是否与 A/B/C 同批，或另立 ADR？
