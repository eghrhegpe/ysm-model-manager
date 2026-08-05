# ADR-035：远期治理立项：组件测试与 CI 门槛

- **状态**：✅ 已采纳（立项登记，实施排期中）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/components` / `.github/workflows/release.yml` / `scripts/ai-mistake-tracker.mjs`

---

## 1. 背景（Context）

十三批审核 + 优化闭环后（2026-08-04），已修复的反模式（先删后建 / 存在即跳过 / 防抖只合并调度不合并执行 / 已关闭 channel 复用假活 / 限流器截断静默 / 文本匹配错误分类——AGENTS.md 反模式表 +6 条）需要**防线防回潮**。经远期方向评估（价值/成本/前置条件），用户确认立项三项；多资源联邦扩展与非 Windows 更新因依赖产品决策，暂缓不立项。

## 2. 决策（Decision）

统一登记三项立项（开放 backlog，实施时按优先级排期）：

| 编号 | 立项 | 优先级 | 范围 | 验收标准 |
|------|------|--------|------|---------|
| G-1 | 前端组件级测试 | P2 | app-tree / app-content 交互路径组件测试（连点/多选/tab 切换等），**前置：抗脆弱测试基础设施**（见下） | 抗脆弱基础设施落地（testid 规范 + 状态可查询 + helper 抽象 + 契约守护）后，组件测试 ≥10 用例且 `vitest run` 全绿 |
| G-2 | CI 门槛增强 | P2 | `release.yml` 主 CI 增加 `go vet` / `adr-check` / doctor 静态组件为 PR 门槛（防治理规则回潮） | PR 门槛生效，违规即红 |
| G-3 | ai-mistake-tracker 反哺 | P3 | `ai-mistake-tracker.mjs` 的 `RULE_VIOLATIONS` 增加反模式关键词检测（先删后建/静默降级/无守卫注册/无 generation 等），让修复链数据反哺陷阱清单 | 运行输出可统计反模式修复 |

### G-1 抗脆弱测试基础设施（前置规划）

**问题本质**：E2E/组件测试失效 = 断言绑定了易变实现（CSS 类 / 文案 / DOM 结构）——UI 演进时测试红而功能未坏。**解法**：断言稳定语义，测试信息从 UI 自动获取而非硬编码。

| 层 | 机制 | 解决什么 |
|----|------|---------|
| ① 稳定钩子 | 关键交互元素统一 `data-testid`（如 `tree-file` / `tree-toggle` / `sync-push`），规范写入 Design.md §19（唯一规范源） | 文案/类名/结构变化不破坏定位 |
| ② 状态可查询 | 组件渲染后暴露可查询状态（`container.dataset` 如 `data-count`/`data-selected`，或既有事件总线事件流）——测试断言**状态值**而非 DOM 结构 | "自动从 UI 获取测试信息"的核心 |
| ③ helper 抽象 | `frontend/src/test-utils/`（`getByTestId` / `waitFor` / `clickTreeFile` 等），测试不直接写选择器/定时器 | 结构变化只改 helper 一处 |
| ④ 契约守护 | `tests/*.mjs` 断言关键 testid 存在 + BusEvents 类型一致性 | testid 被删 → 契约红，防钩子静默失效 |

**落地顺序**：① 本规划入 ADR（G-1 前置） → ② Design.md §19 加 testid 规范 → ③ `test-utils/` helper → ④ 首个组件测试（app-tree 多选/连点路径）→ ⑤ 契约守护。

**隔壁实证增强（联邦 MikuMikuAR ADR-060，已落地）**：

- **数值钩子**：`window.__scene` DEV 钩子暴露 getter（fps/meshCount 等，生产剔除、`VITE_E2E_MODE` 可强制编入）→ ② 升级为 **DEV 钩子 + 阈值断言**（`meshCount > 10`/`fps ≥ 30`，不精确比数）；
- **守卫就绪探测**：`isLightingReady`/`isRenderReady` 未就绪整域跳过断言——防「UI 可操作但 state 未生效」误报；
- **testid 前缀命名空间**：`[data-testid^="actor:model"]` 前缀匹配——与①实证一致；
- **分层运行**：@dom（vitePage，CI 稳定）先立、@webgl（wailsPage，真运行时）后续——本项目先 jsdom 组件级，真 Wails 集成级可选；
- **种子数据程序化**：`createTestMesh` 程序化网格——组件测试用 mock entries，不依赖真实仓库文件。

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
