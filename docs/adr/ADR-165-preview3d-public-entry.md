# ADR-165：preview-3d 公共入口以真模块收敛视图层深导入

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views 对 preview-3d 内部深导入 53 处 / ADR-146 反桶契约`

---

## 1. 背景（Context）

`preview-3d/` 作为 3D 预览子域，被 `views/` 等上层以**内部路径深导入**消费：实测 `frontend/src/views` 对 preview-3d 内部（caps / state / adapters / decoder / menu 等）有 **53 处导入、18 个不同目标**（top3：adapters/mount-preview-core 11、decoder/geometry 9、decoder/wasm-decode 5）。深钻内部路径意味着：

- `views` 直接耦合 preview-3d 的实现细节，内部重命名/重构会波及上层；
- 无单一公共入口，`views` 无法把握 preview-3d 承诺的公共面边界；
- 三点命中反桶契约的反面：公共面应由 preview-3d 自己声明，而非上层逐文件去猜。

**约束冲突**：反桶契约（ADR-146）禁止新增「以 re-export 为主体的聚合文件」（薄 barrel 会被 R1 嫌疑拦截）。因此「简单开一个 index re-export 所有内部符号」的方案**直接撞 ADR-146**，不可取。公共面必须以**真模块**形式存在——自身持有逻辑/类型，而非薄转发。

## 2. 决策（Decision）

在 preview-3d 建立**真公共入口模块**（自身持有实际逻辑/类型，非 re-export 转发），把 `views` 的 import 面从 53 收敛到个位数。18 个被深入目标按三级分流：

1. **共享公共 API**（adapters/mount-preview-core、decoder/geometry、decoder/wasm-decode、vrm-adapter 等）：收进真公共模块，`views` 只经它取。
2. **纯内部实现**（menu/node-types、decoder/cache、menu/multi-model 等）：禁止 `views` 穿透，由公共模块暴露瘦函数回打（瘦函数是真实逻辑，不是转发）。
3. **剩余按需收敛**：逐个评估，能并入公共面则并入，否则明确为「内部」并清私转公。

理由：
- 满足 ADR-146（真模块 ≠ re-export 转发，规避 R1 聚合嫌疑）；
- 单一事实源：preview-3d 自己声明公共面，上层不再逐文件探测；
- 收敛 import 面到个位数，降低耦合、隔离 refactor 冲击面。

## 3. 后果（Consequences）

**正面**
- `views` 与 preview-3d 内部解耦，公共面边界由 preview-3d 声明。
- 将来对 preview-3d 内部重命名/拆分不再波及上层。
- 与 ADR-146 反桶契约相容。

**负面 / 代价**
- 需逐类评估 18 个目标归属，工作量分布在多个文件。
- 公共模块新增符号可能触发「别名/路径卫生」门禁，需按 `check-path-hygiene` 规则登记。

**已知遗留（不做）**
- **不做**一次性 codemod 全量重写（AGENTS 明令禁止）；存量 `views` 深导入按「该文件因他故被改时顺手切公共面」渐进迁移，不搞大爆炸式改造。
- preview-3d 内部的类型环（type-only 环，非运行时值环）不在本 ADR 范围——经核验运行时无值环，不构成缺陷（`check-circular.ts` 剥离 type-only 后报 0 环，独立 Tarjan 值导入图同样 0 环）。

## 4. 数据溯源

来源 → 结果（复核口径）：
- 审计报告 → `frontend/src/views` 深导入 preview-3d 内部（mount-preview-core 13、decoder/geometry 12）。
- 本次复核（全树 import 抓取）→ 深导入 **53 处 / 18 个目标**（mount-preview-core 11、decoder/geometry 9、wasm-decode 5、menu/node-types 5、vrm-adapter/mmd-adapter/cache 各 3 等）——量级与审计一致，个别数字以实测为准。
- 循环依赖交叉验证（`check-circular.ts` + 独立 Tarjan）→ 值导入运行时图 **0 环**；含 type-only 边才有 10–11 个 SCC。据此在本 ADR 明确「类型环不在范围」。

<!-- 文件名: preview3d-public-entry.md → 实际文件 ADR-165-preview3d-public-entry.md -->
