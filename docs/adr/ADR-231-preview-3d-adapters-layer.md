# ADR-231：preview-3d adapters 按私有子系统分层

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/`、先例 `ADR-225`（adapters/shared 已建）、约束 `ADR-146`（@/ 路径约定）

---

## 1. 背景（Context）

`preview-3d/adapters/` 是 preview-3d 下**唯一未分层**的目录：递归 110 文件（顶层平铺 96 + `shared/perception/` 14）、26,253 行。其顶层**抽象层级混杂**，同层并存五类职责：

| 职责类别 | 代表文件（行数） |
|---|---|
| 格式适配器主体 | `vrm-adapter.ts`(854)、`ysm-adapter.ts`(780)、`litematic-adapter.ts`(547)、`pack-model-adapter.ts`(401)、`fbx-adapter.ts`(395) |
| 统一外壳 | `mount-preview-core.ts`(1038) |
| **格式私有子系统** | MMD 18（解析/构建/纹理/动画/worker）、FBX 3、VRM 2 |
| 跨格式基础设施 | `switch-preview.ts`、`mount-session.ts`、`render-host.ts`、`worker-bridge.ts`、`scene-registry.ts`、`schema-registry.ts`、`shared-infra.ts` |
| UI / 输入 | `mmd-build-menu.ts`、`mmd-zip-overlay.ts`、`vrm-bone-ui.ts`、`*-controls.ts`、`input-and-animation.ts`、`wasd-camera.ts` |

后果：定位靠「猜前缀」而非结构直觉；`mmd-build-menu.ts`（UI 菜单）与 `mmd-pmx-parser.ts`（二进制解析）同层，抽象层级不可辨。

`ADR-225` 已先例确立 `adapters/shared/` = 跨格式能力子层（perception 下沉），但未覆盖其余 96 文件。

## 2. 决策（Decision）

按**私有子系统**维度分层（**非**机械按格式前缀）：

1. 建 `adapters/mmd/`、`adapters/fbx/`、`adapters/vrm/` 三个格式私有子目录，收纳该格式的**全部私有实现**（adapter + parser + worker + 构建管线 + 同名测试）。
2. **判定标准（准入红线）**：仅当某格式拥有「私有子系统」——即 ≥2 个非 adapter 实现文件（parser / worker / 构建管线）——才为其建子目录。据此 `ysm` / `litematic` / `pack` 各仅 1 个 adapter 源文件 → **留根不建目录**，避免单文件目录碎片。
3. `adapters/shared/` 沿用 `ADR-225` 语义（跨格式能力），本次不扩充。
4. 其余（统一外壳 + 跨格式基础设施 + UI + 输入）本次**留根不动**。"adapters 是否应仅含格式适配器"（即 UI → `menu/`、基础设施 → `infra/`）属**独立决策**，不在本 ADR 范围——见「已知遗留」。
5. 迁移为**纯路径重指**：不改任何逻辑、签名、导出；跨目录 import 一律 `@/preview-3d/adapters/<group>/xxx.ts`，同子目录内保持 `./xxx.ts`（`ADR-146`）。
6. **禁止相对上跳**：`check-path-hygiene` R3 已锁定「任何 in-src 相对 `../` 上跳即 FAIL」（2026-09-07），迁移不得引入 `../`。
7. 同步更新 `scripts/baseline/deadcode-baseline.json` 中硬编码的 adapters 路径，否则 `check-deadcode-baseline` 断链。

## 3. 后果（Consequences）

- **正面**：
  - `adapters/` 根从 96 → 56 文件；三个高内聚格式族（组内 160 条依赖边免改）自成一格，定位靠结构。
  - 成本为三方案最低：仅 **41 条** import 改路径（26 切边 + 15 外部受影响）。
  - 最大枢纽 `mount-preview-core.ts`（18 条外部引用、近期 4 次提交的热点，且 `ADR-227` 刚收敛其单例）**留根不动**，天然避开并行会话冲突面。
- **负面**：
  - 一次性 41 条 import 改动 + 新建 3 目录；须全量 `typecheck` + `vite build` + 全量单测复验。
  - 迁移窗口内若并行会话改动同批文件，须靠提交白名单隔离归属。
- **已知遗留**：
  - `adapters/` 根仍余 56 文件（含 UI 5、输入 3、跨格式基础设施 16、单文件格式 adapter 3）——「adapters 语义纯粹化」未决，留二期另立 ADR。
  - `shared/perception/`（14 文件）不在本次顶层统计口径内，其内部结构本 ADR 不涉及。
- **风险/门禁**：`check-path-hygiene`（R2 目录深度 3 层不触发 / R3 相对上跳 / R5-R6）、`check-layering`、`check-deadcode-baseline`（基线须同步）、`audit-src-map`（生成物，重生成）须逐一复验。

## 4. 数据溯源

- 规模：`find frontend/src/preview-3d/adapters -name "*.ts" | wc -l` → **110**（顶层 96 + `shared/perception/` 14）。
- 依赖图：脚本解析 96 文件全部 import（`./xxx.ts` + `@/preview-3d/adapters/xxx.ts`）→ **内部依赖边 186、外部引用 68 条 / 39 文件**。
- 方案对比（**切边** = 须改 `@/` 的跨组边；**外部受影响** = 目标模块被移出原位置的引用）：

| 方案 | 组分布（含测试） | 组内边（免改） | 切边 | 外部受影响 | 总改路径 |
|---|---|---|---|---|---|
| A 机械按格式前缀（含建 `shared/`） | shared **48** / mmd 27 / fbx 7 / vrm 6 / litematic 3 / ysm 3 / pack 2 | 139 | 47 | 68 | **115** |
| B 按职责分流（UI/infra 跨一级目录） | ui 18 / infra 29 / mmd 22 / adapter 14 / fbx 7 / vrm 6 | 110 | 76 | 44 | **120** |
| **C 仅私有子系统建目录（采纳）** | root 56 / mmd 27 / fbx 7 / vrm 6 | 160 | **26** | **15** | **41** ✅ |

- **A 否决理由**：`shared` 桶 48 文件（半数）无家可归，天花板最低；成本反为最高（115）；且另建 3 个单文件级碎片目录（ysm / litematic / pack）。
- **B 否决理由**：成本最高（120）；且 UI→`menu/`、基础设施→`infra/` 属跨一级目录的独立决策，混做会放大 review 面与并行冲突概率 → 拆二期。
- 约束来源：`grep -rn "preview-3d/adapters" scripts/` → `scripts/baseline/deadcode-baseline.json` 含 10+ 条硬编码路径，须同步。
- 约束来源：`scripts/check-path-hygiene.ts`（R3：`R3_UPLEVEL_MIN = 1`，2026-09-07 锁定）。
- 先例：`docs/adr/ADR-225-perception-adapters-shared.md`（确立 `adapters/shared/` 语义）。
