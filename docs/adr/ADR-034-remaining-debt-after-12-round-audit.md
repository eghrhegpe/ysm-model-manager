# ADR-034：12 轮审计后的剩余技术债盘点与处置方向

- **状态**：已采纳（Accepted）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-002 项目健康评估 / ADR-003 逻辑下沉 / ADR-011 路径分隔符 / ADR-012 Binding 调用一致性 / ADR-023 测试体系 / audit-summary-2026-08-04.md

---

## 1. 背景（Context）

12 轮审计（audit-summary-2026-08-04.md）已闭环：13 模块 / 16 commits / P1×4 P2×14 P3×17 全修复，
四件套（go build+test / tsc / vitest / doctor）全绿。app_install.go 下沉有并行 AI 在跟。

本 ADR 盘点审计线封顶后**剩余的技术债**，并为每一项给出处置方向与优先级，
作为下一阶段工作的决策真相源。调查覆盖 4 个方向：
前端大文件、Go 测试盲区、治理违规（ADR-011/012）、契约测试覆盖。

---

## 2. 决策（Decision）

### 2.1 方向一：前端大文件拆分（🔴 最高）

**现状**：前端 >500 行文件 13 个，其中 `site-view.ts`（1,314 行）是唯一 RED 级，
`index.ts`（1,032）、`content-css.ts`（919）、`import-queue.ts`（843）紧随。

**处置**：优先拆 `site-view.ts`（前端唯一 RED，ADR-002 §3.2 点名）。
按 AGENTS.md §4.2 拆为 5 文件：主入口编排壳（~120）+ render（~280）+ events（~420）
+ edit（~260）+ drag（~230）。关键设计：共享闭包变量提为显式 `SiteViewState`，
事件绑定返回 cleanup 聚合，render 纯函数化可单测。

**优先级**：P1。RED 单点、零撞车（社区模块独立，下沉 AI 在后端）。

### 2.2 方向二：Go 测试盲区补单测（🟡 中）

**现状**：24 个 Go 包，21 个有测试，**3 个零测试**：

| 包 | 文件数 | 总行数 | 说明 |
|----|--------|--------|------|
| `go/litematic` | 6 | 4,889 | 自动生成数据 + 解析器，核心业务 |
| `go/logs` | 1 | 121 | 日志工具，薄 |
| `go/version` | 1 | 6 | 版本号常量，极薄 |

**处置**：
- `go/version`（6 行）：1 个单测断言版本常量格式即可，5 分钟闭环
- `go/logs`（121 行）：补 NewLogger / Add / Format 三函数单测
- `go/litematic`（4,889 行）：`block_ids_data.go`（3,477 行）是自动生成数据豁免；
  剩余 ~1,400 行解析器（`litematic.go` / `block.go` 等）需补解析正确性单测，
  工作量中等，建议独立 P2 任务

**优先级**：P2。version/logs 快速闭环，litematic 单列。

### 2.3 方向三：治理违规收尾（🟢 低，多为已合规）

**ADR-011 路径分隔符**：状态「已采纳，违规未修复」。实测前端反斜杠自拼违规 **0 处**，
`split(/[/\\]/)` 等跨平台写法已普及。**结论：ADR-011 治理已生效**，
建议将状态注释更新为「已采纳，违规已清零」或直接关闭遗留标记。

**ADR-012 Binding 调用一致性**：状态「已采纳，当前不一致，未修复」。实测：
- `getApp()` 调用点 **119 处**（合规，治理红线 §3.2）
- 直接 `from .../bindings/.../internal/app/app.js` **7 处**（违规）

**处置**：7 处违规改为 `getApp()`，10 分钟闭环。
涉及文件：`app-sidebar/loader.ts`、`app-tree/{bus-handlers,events,instance-actions,loader}.ts`、
`utils/model3d-loader.ts`、`utils/screenshot-renderer.ts`。

**优先级**：P3。量小、机械、易闭环。

### 2.4 方向四：契约测试扩充（🟡 中）

**现状**：`tests/` 共 8 件，守护范围集中在 JSON schema（config/creators/resource/workshop）、
HTML 完整性、脚本输出。**Go Wails Binding 契约零覆盖**——前端调 Go 函数的参数/返回类型
无静态守护，Binding 签名变更只能靠人肉测。

**处置**：新增 `tests/test_binding_contract.mjs`，扫描 `bindings/` 生成 TS 类型导出清单，
断言关键 Binding（Download/Install/Scan/Sync 等）的参数个数与返回类型与前端调用点一致。
对齐 ADR-023 L1 契约层，守护跨层接口。

**优先级**：P2。跨层守护空白，但需先确认 `bindings/` 生成机制。

---

## 3. 后果（Consequences）

### 正面

- **剩余债透明化**：4 方向硬数据落盘，下一阶段工作有明确决策依据
- **ADR-011/012 可收尾**：实测违规已清零（011）或仅 7 处（012），治理闭环在望
- **测试盲区量化**：3 包零测试，version/logs 可快速闭环，litematic 单列 P2

### 负面

- **本 ADR 是盘点非修复**：真正的工作量在 P1-P3 任务中，需后续会话落地
- **方向四依赖 bindings 机制确认**：若 `bindings/` 是 Wails 自动生成，
  契约测试需匹配生成时机，复杂度可能上升

### 已知遗留

- `site-view.ts` 拆分（方向一）是 3-4 轮机械大改写，建议单独 commit
- `go/litematic` 4,889 行单测覆盖（方向二）工作量中等，建议独立任务
- ADR-011 状态注释更新（方向三）需手动改 ADR 文件

---

## 4. 数据溯源

| 来源 | 数据 | 结果 |
|------|------|------|
| `wc -l` 前端 | 13 个 >500 行文件，`site-view.ts` 1,314 行唯一 RED | 方向一优先拆 site-view |
| `list_symbols` site-view | 15 符号，`renderSiteView` 横跨 135–1314（1,179 行） | 上帝函数确认 |
| Go 包测试扫描 | 24 包 / 21 有测试 / 3 零测试（litematic 4,889 / logs 121 / version 6） | 方向二盲区量化 |
| `grep '\\\\'` 前端 | ADR-011 反斜杠自拼违规 0 处 | 011 治理已生效 |
| `grep getApp()` vs `from bindings` | 119 处合规 vs 7 处违规 | 012 仅 7 处待改 |
| `ls tests/*.mjs` | 8 件契约测试，Go Binding 契约零覆盖 | 方向四跨层守护空白 |
| audit-summary-2026-08-04.md | 12 轮审计 P1×4/P2×14/P3×17 全修复 | 审计线封顶，本 ADR 接力 |

<!-- 文件名: remaining-debt-after-12-round-audit.md → 实际文件 ADR-034-remaining-debt-after-12-round-audit.md -->
