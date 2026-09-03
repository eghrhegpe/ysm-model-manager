# ADR-167：MMD 适配器 stage 管线拆分

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-066](ADR-066-universal-resource-preview.md)（统一 3D 外壳 / PreviewAdapter 契约）、[ADR-077]（mmd-bones）、[ADR-074]（bones-panel-node 通用化）

---

## 1. 背景（Context）

`frontend/src/preview-3d/adapters/mmd-adapter.ts` 达 1776 行（非测试），连续第五次被外部审核按「巨型文件」标准点名。但结构审计表明该文件**不是**一坨 god file：它已是 ADR-066 P2 富格式内容管线——`MdMmBuildCtx` 六域接口组（IO/Parse/Texture/Anim/Perception/Trace）+ 每 stage 以 `Pick<MdMmBuildCtx,…>` 收窄签名 + `buildMmdScene` 线性编排；KTX2/anim-library/VPD/zip-overlay/material/morph/bones 等兄弟模块早已外提（imports 表 90 行仅 6 行为本仓 util）。

问题在于：**编排器 + 全部 stage 实体代码仍同驻单文件**，行数指标持续触发误报，且类型声明与逻辑混排降低可扫读性。评审建议的「按材质/骨骼/动画拆」与真实结构（stage 缝）不符，横切会破坏既有 Pick 收窄边界，未采纳。

## 2. 决策（Decision）

沿既有 stage 缝做**纯搬移式拆分**（零逻辑改动），一文件拆为九文件：

| 新模块 | 内容 |
|--------|------|
| `mmd-types.ts` | 六域状态接口、`MdMmBuildCtx`、全部 stage Pick 别名、MmdDataPort/MmdPanelHooks/MmdMenuItemsOpts/MmdAdapterDeps |
| `mmd-shared.ts` | `mmdDiag`（诊断）与 `disposeMmdMesh`（GPU 释放）——跨 stage 共用 |
| `mmd-build-load.ts` | detectFormat + Stage1 输入 + Stage1b 文件扫描 + Stage2 LoadingManager |
| `mmd-build-parse.ts` | ParsePmx + ParsePmd |
| `mmd-build-scene.ts` | Stage3 家族：mesh 挂载 / debug / KTX2 hydrate / schedule |
| `mmd-build-anim.ts` | Stage4 动画（VMD 库 + 相机轨道） |
| `mmd-build-menu.ts` | Stage5 菜单 + `mmdMenuItems` |
| `mmd-build-result.ts` | Stage6 结果 / dispose / 6b 追踪 |
| `mmd-adapter.ts`（壳） | `buildMmdScene` 编排器 + `makeMmdAdapter` + 公共符号 re-export |

模块图方向：stage 模块只依赖 `mmd-types.ts` / `mmd-shared.ts` / 既有外提兄弟模块，**壳是唯一组合根**，严格无环。

### 关键约束（拆分陷阱）

1. **`mmdMenuItems` 自环**：Stage5Menu 内部调用导出函数 `mmdMenuItems`。若菜单外移而 `mmdMenuItems` 留壳，将产生 shell↔menu 运行时环 → 二者**同驻 `mmd-build-menu.ts`**，壳 re-export 保兼容。
2. **`verbatimModuleSyntax`**：`mmd-build-result.ts` 对 `mdMmStage5Menu` 的 `ReturnType<typeof …>` 查询须**值 import**（type-only import 被禁）。
3. **公共面冻结**：消费者仅 `views/app-preview/mmd-3d.ts`、`scene-3d.ts`（`makeMmdAdapter`/`MmdPanelHooks`）与 `mmd-adapter.test.ts`（`buildMmdScene`/`MmdDataPort`/`MmdPanelHooks`）——壳 re-export 后调用方零改动。
4. 不采纳评审「材质/骨骼/动画」切法（与 stage 缝正交，徒增耦合）。

## 3. 后果（Consequences）

**正面**：单文件 ≤400 行，巨型文件治理信号归零；类型层独立成 `mmd-types.ts` 便于后续单独审阅；拆分以 mmd-adapter.test.ts（700+ 行断言）为行为回归护栏。
**负面**：文件数 +8；跨 stage 类型（Pick 别名）须经 `mmd-types.ts` 中转，访问路径 `c.xxx` 语义不变。
**已知遗留**：`views/app-preview` 层 `mmd-3d.ts`/`scene-3d.ts` 两个 makeMmdAdapter 实例化点未合并（另一议题）；循环依赖总清单（评审报告 45+ 处）不在本 ADR 范围，其余环另立 ADR。

## 4. 数据溯源

- 行数：`wc -l mmd-adapter.ts` = 1776（非测试）；结构 outline 经 grep 顶层声明核实（stage 函数 488-1573、公共面 1663-1776）。
- 消费者：grep `makeMmdAdapter|buildMmdScene|mmdMenuItems` 于 frontend/src → 仅 mmd-3d.ts / scene-3d.ts / mmd-adapter.test.ts。
- 测试引用面：mmd-adapter.test.ts:133 仅 `buildMmdScene` + 两类型。
