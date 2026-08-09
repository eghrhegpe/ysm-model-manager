# ADR-044：代码写法治理范式：31 批审核反推的系统性不足与收敛策略

- **状态**：已采纳（Accepted）
- **日期**：2026-08-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-033,ADR-039,ADR-043`

---

## 1. 背景（Context）

项目经 31 批、93 个功能的分批只读审核（每批 3 子代理并行 + 主模型逐条读源码独立核实 + code_review 复审），累计修复 P1×15 / P2×70+ / P3×90+。对全部审核发现做反推归纳后发现：**反复出现的不是单点 bug，而是写法层面的系统性不足**——同一类问题（代际守卫遗漏、落盘非原子、截断静默、truthiness 吞合法值、知识卡漂移）在 5~10+ 批中反复暴露，说明现有治理红线（AGENTS.md §三）约束了「做什么」（注册表优先/esc 统一/零 window.__*），**未约束「怎么写同一类基础设施与防御范式」**。

## 2. 决策（Decision）

采纳 12 类高频不足模式与 5 大根因的反推结论，落三条收敛策略：

### 策略 A：基础设施工具函数收敛（根治「各模块手写一份、先后不一致」）

| 工具函数 | 现状（散落位置） | 收敛目标 |
|---------|----------------|---------|
| `safeGet/safeSet`（localStorage 隐私模式防护） | app-modules.ts 模块级、settings/community.ts 局部 | 新建 `frontend/src/utils/dom/storage.ts` 统一导出，全项目替换裸调 |
| `WriteFileAtomic`（tmp+rename+chmod 原子落地） | go/importer 已抽、app_install 复用 | 提升为公共函数，tags/logs/fileops 全部接入 |
| `readLimitedEntry`（ADR-033 limit+1 截断探测） | go/geometry 已抽 | 提升为 `go/fsutil` 公共函数，ysm/packs/updater 统一 |
| `isRecycleDir`（EqualFold 回收站判定） | fsutil/dedup/scanner 各一份 | 收敛到 `go/fsutil`，三处统一引用 |

### 策略 B：防御范式上升为强制红线（根治「补丁式防御」）

追加到 AGENTS.md §三.3，作为新增代码的强制要求：

1. **异步范式**：每个 `await` 后落 DOM / 写状态前必校验代际（**含 catch 分支**）；async 事件 handler 最外层必有 catch 出口；busy 命中必回完成事件（带 `skipped` 标记），禁止静默吞事件。
2. **数值守卫范式**：`Number.isFinite` 拦截 NaN/±Infinity；数字回填用 `?? ""` 不用 `|| ""`；`!x` 只用于布尔判断，数值/字符串用显式 null/undefined 判断。
3. **边界对称范式**：校验必须覆盖上下界（int16 负界、路径 `.` 与 `..`、`IsInside` 相等放行、`..foo` 误判）；字符串比较统一 EqualFold / 规范化 / 词边界。

### 策略 C：知识卡机制锚核对（根治「文档与代码双源不同步」）

现有 `check-knowledge-drift` 只对账 source_files/tests 存在性，**无法发现机制描述错误**（31 批里几乎每批都出现：sync.Once→registryMu、sort.Strings→json.Decoder、GetVersion→GetAppVersion、meshMax 幽灵字段）。给知识卡「不变量」条目附可执行 grep 锚（如 `sync.Once` → `registryMu`），漂移检测对锚做**内容核对**而非仅存在性；重构触及锚时漂移即红。锚核对纳入 ADR-043 的 fail-closed 三态契约。

## 3. 后果（Consequences）

**正面**：
- 基础设施收敛后，同类缺陷（落盘半截、隐私模式中断、截断静默）不再逐模块复发，审核发现密度应显著下降。
- 范式入红线后，「await 后不校验代际」「async 无 catch」在 code_review 中可直接判违规，降低 P1/P2 发生率。
- 知识卡机制锚让「重构后文档不同步」成为可检测问题而非靠人工发现。

**负面**：
- 收敛涉及跨模块重构（storage.ts 替换、WriteFileAtomic 提升），需分批执行并回归，短期增加改动面。
- 范式红线对已有代码不追溯（不强制回改存量），新旧写法并存一段时间。
- 机制锚核对需为知识卡逐条补充锚点，初期维护成本上升。

**已知遗留**：
- 12 类模式中的样式/UI 一致性（no-animations 跨 shadow 边界、focusVisible、trapFocus）未纳入本 ADR 收敛范围，由 Design.md 规范承载。
- 关键路径测试护栏（getApp/RuntimeBuffer/防护分支零测试）已部分补测（wails/app.test.ts、go/logs/runtime_test.go），「修复含守卫分支须带测试」建议纳入 pre-push-gate 提示，属 ADR-043 范畴的后续项。

## 4. 数据溯源

**来源** → **结果**：

- 31 批分批审核（每批 3 子代理 + 主模型独立核实 + code_review）→ 累计 93 个功能、P1×15 / P2×70+ / P3×90+ 修复记录
- 审核发现反推归纳 → 12 类高频模式（代际守卫不完整 10+ 批、localStorage 裸调 8+ 批、落盘非原子 6+ 批、截断静默 5+ 批、truthiness 吞合法值 5+ 批、路径匹配脆弱 6+ 批、边界校验不对称 5+ 批、幽灵路径 7+ 批、知识卡漂移几乎每批、关键路径零测试 6+ 批、catch 缺失 5+ 批、样式一致性 4+ 批）
- 5 大根因：①防御补丁式而非范式式 ②基础设施函数未收敛 ③文档与代码双源不同步 ④模块级状态缺「唯一写入点」约束 ⑤关键路径零测试 + vi.mock 掩盖核心
- 策略落地优先级（投入产出）：A 收敛工具函数（多数已存在仅未收敛）> B 范式入红线（固话最贵教训）> C 机制锚核对（唯一能治根因③的手段）

<!-- 文件名: code-writing-governance.md → 实际文件 ADR-044-code-writing-governance.md -->
