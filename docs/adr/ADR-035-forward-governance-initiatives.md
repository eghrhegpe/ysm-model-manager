# ADR-035：远期治理立项：组件测试与 CI 门槛

- **状态**：✅ 已采纳（立项登记，实施排期中）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/components` / `.github/workflows/release.yml` / `scripts/ai-mistake-tracker.mjs`

---

## 1. 背景（Context）

十三批审核 + 优化闭环后（2026-08-04），已修复的反模式（先删后建 / 存在即跳过 / 防抖只合并调度不合并执行 / 已关闭 channel 复用假活 / 限流器截断静默 / 文本匹配错误分类——AGENTS.md 反模式表 +6 条）需要**防线防回潮**。经远期方向评估（价值/成本/前置条件），用户确认立项三项；多资源联邦扩展与非 Windows 更新因依赖产品决策，暂缓不立项。

## 2. 决策（Decision）

统一登记三项立项（开放 backlog，实施时按优先级排期）：

| 编号 | 立项 | 优先级 | 范围 | 验收标准 |
|------|------|--------|------|---------|
| G-1 | 前端组件级测试 | P2 | app-tree / app-content 交互路径组件测试（连点/多选/tab 切换等），`vi.mock` bindings 模式（vitest+jsdom 已就绪） | 组件测试 ≥10 用例，`vitest run` 全绿 |
| G-2 | CI 门槛增强 | P2 | `release.yml` 主 CI 增加 `go vet` / `adr-check` / doctor 静态组件为 PR 门槛（防治理规则回潮） | PR 门槛生效，违规即红 |
| G-3 | ai-mistake-tracker 反哺 | P3 | `ai-mistake-tracker.mjs` 的 `RULE_VIOLATIONS` 增加反模式关键词检测（先删后建/静默降级/无守卫注册/无 generation 等），让修复链数据反哺陷阱清单 | 运行输出可统计反模式修复 |

**暂缓（未立项）**：ADR-024 多资源联邦扩展（需新资源类型需求信号）、非 Windows 更新支持（ADR-033 明确拒绝，需跨平台需求）。

## 3. 后果（Consequences）

**正面**：

- 已修反模式获得自动化防线（CI 门槛 + 修复分类统计），治理规则从"人工 review"走向"机器值守"；
- 组件测试补齐 vitest 纯函数层之外的交互路径覆盖。

**负面 / 成本**：

- 组件测试需 mock bindings/getApp 基础设施（G-1 前期成本）；
- CI 时长增加（G-2 的 vet/adr-check 步骤）；
- G-3 的关键词规则需随反模式演进维护。

## 4. 数据溯源

- **来源**：审核收官后远期方向评估（2026-08-04）——用户确认立项三方向（组件测试 / CI 门槛 / mistake-tracker 反哺）；
- **关联**：ADR-013（治理收敛 Phase 2 CI）、ADR-017（前端增强台账）、ADR-020（脚本工具链）、ADR-023（测试体系）；
- **验证**：`node scripts/new-adr.mjs` 占号 + `adr-check` 登记一致（34 文件/34 条）。

<!-- 文件名: forward-governance-initiatives.md → 实际文件 ADR-035-forward-governance-initiatives.md -->
