# ADR-133：契约测试真实性：从存在性门禁升级为消费性校验

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-30
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`tests/test_testid_contract.mjs（TESTID_REGISTRY / 存在性校验 line103-116）；ADR-035（G-1 抗脆弱测试基础设施）；事件链 5bfc6ff5→5cbbc43a→029ef285→46f45c19→9a43766d`

---

## 1. 背景（Context）

`tests/test_testid_contract.mjs` 是当前唯一守护「关键 `data-testid` 不被静默删除」的门禁（G-1 抗脆弱测试基础设施，ADR-035）。其实现（`TESTID_REGISTRY` + line 103–116）只做**存在性校验**：注册表条目 `<testid> → <源文件>` 要求源文件中出现 `data-testid="<testid>"` 或 `dataset.testid = "<testid>"` 字面量。它不校验该 testid 是否被 handler 绑定、是否被测试引用。

一次真实事故暴露了这是**结构性病**而非单点失误（事件链，5 个 commit 均经 `git cat-file` 核实存在）：

| 提交 | 动作 | 问题 |
|---|---|---|
| `5bfc6ff5` | 有意删「骨骼导出」按钮 | 忘删 `TESTID_REGISTRY` 的 `tree-repo-export` 条目（漏同步） |
| `5cbbc43a` | 为过 push-gate | 补**假按钮** `export-repo`（无 handler）凑 testid——把「删功能」变成「加摆设」 |
| `029ef285` | 重生成翻译 | 假按钮被无意删除（回到干净态，但无人意识到） |
| `46f45c19` | 为过 push-gate（我） | **重演** `5cbbc43a` 错误——再补假按钮 |
| `9a43766d` | 质疑后查证（我） | 删假按钮 + 删死条目，才回到正确状态 |

三层病根：

1. **手工清单 × 自动门禁 = 必然累积死条目**。删除元素要求人记得同步清理 `TESTID_REGISTRY`；人删按钮时想的是「删功能」，不会记得清清单。`tree-repo-export` 漏网 2 周 + 2 个「修复」提交才被揪出。
2. **契约检查「字符串存在」而非「功能存在」**。line 113 仅 `content.includes(...)`，不校验 handler 绑定或测试引用。故「有 testid 无 handler」的死按钮照样过门禁——**门禁自身认假货**。
3. **门禁反向驱动错误行为**。最危险的不是死条目，而是 push-gate 失败 → 人/AI 选择「补个假的凑过去」。`5cbbc43a` 与 `46f45c19` 两次重演即铁证：**当门禁不校验真实性时，它不是在保护功能，而是在诱导造假。**

实证（见 §4 溯源）：全仓 57 个注册表 testid 全部有真实消费，但消费方式分两类——**44 个**被 `.test.ts` 直接 `getByTestId` 引用；**12 个**（`content-tab`、`sidebar-push/pull/select-all/check/sync-type`、`tree-authors`、`tree-batch`、`tree-more`、`ctx-item`、`dlg-select`、`dlg-ok`）仅出现在自身声明文件，被事件委托 / `dataset.testid` 动态消费，**全仓无任何字面量引用**。

该实证直接否决了「朴素消费性检查（testid 字面量须出现在声明文件之外）」的可行性——它会把这 12 个合法动态委托 testid 误判为死条目。因此阶段 A 不能依赖字面量消费检查，阶段 B（让 testid 与 handler 在同一声明处共存）才是真·机制修复。

## 2. 决策（Decision）

分两阶段落地，阶段 A 立即止血、阶段 B 根治。

### 阶段 A（立即止血，低风险，不引入手工白名单膨胀之外的额外维护）

1. **保留存在性校验**（防钩子静默失效的初衷不变）。
2. **反向孤儿扫描**：source（`frontend/src`，排除 `dist*` 构建产物）中凡匹配关键命名约定（`tree-` / `sm-` / `gh-` / `ctx-` / `dlg-` / `recy-` / `sidebar-` / `nav-` / `content-` / `toast-`）的 `data-testid`，若未登记于注册表 → 契约红。强制「加了关键交互元素必须显式登记」，捕获「忘登记」类遗漏。扫描限定 `frontend/src` 是关键：构建产物 `dist-*` 含历史残留 testid 字面量（如已清掉的 `tree-repo-export`），扫全 `frontend/` 会制造误报。
3. **修复指引 + 造假拦截（修复文案）**：注册表条目在 source 缺失时，契约错误信息必须写明 canonical fix = **删除注册表条目**（功能已删），并显式禁止「为过门禁补无 handler 的假按钮」（病根 3 的诱导链从文案层切断）。提交级模式检测（同提交新增 `data-testid="X"` + 注册表条目且零引用 → 失败）留作 push-gate 增强，不在离线契约测试中落地（见 §4 实证对「零引用」判定的可靠性限制）。
4. **反造假校验推迟至阶段 B（关键修订）**：实证发现本仓消费以 `#id` / `.class` / 事件委托为主，testid 字面量消费**无法区分真/假**——§1 实证 12 个动态委托 testid 全仓零字面量引用；`app-nav` 的 `nav-group-select` / `nav-subtype-select` / `nav-repo-sel` 仅以 `#id` 被组件与测试消费。故阶段 A **不落地字面量消费性检查**：它要么误杀上述合法项，要么需膨胀白名单（= 病根1 重现）。反造假（「有 testid 无 handler」）只能由阶段 B 结构性解决（testid↔handler 同处声明，从结构上使其不可能）。阶段 A 仅以孤儿扫描 + canonical 修复指引止血，不引入消费性白名单。

### 阶段 B（根治，消除手工清单本身）

1. **testid 与 handler 同处声明**：各视图以声明式映射（如 `TOOLBAR_BINDINGS = [{ testid, handler }]`、`KEY_TESTIDS`）取代手工 `TESTID_REGISTRY`，使 `testid` 与 `handler` 在同一声明处共存。注册表改为由绑定处**自动生成**（并入 pre-commit 的 `GEN_CMDS` 同款纯函数链路），消灭手工清单（病根 1）。
2. **契约校验升级为真实性**：每个声明 testid 必须绑定**真实 handler**（非 `undefined` / 无操作）+ 至少一处测试或 handler 引用。「有 testid 无 handler」在结构上不可能（病根 2）。
3. **反向孤儿扫描并入生成链路**：阶段 A 的孤儿扫描在生成注册表时一并完成，无需独立维护。

> 不做的事：不采用「纯字面量消费性检查」作为主手段（实证证伪其安全性）；不在阶段 A 把 12 个动态委托项当作「死条目」强删（会破坏合法功能）。

## 3. 后果（Consequences）

**正面**
- 门禁从「形式主义」升级为「真实性」：不再认假货，不再诱导造假（病根 2、3 根除于阶段 B，阶段 A 即开始止血）。
- 死条目自净：删除功能即删 registry 条目成为唯一正确路径，漏同步有孤儿扫描兜底（病根 1 阶段 A 缓解、阶段 B 消除）。
- 关键交互元素删除不再能静默逃进门禁盲区。

**负面 / 成本**
- 阶段 A 引入 12 项有界动态委托白名单，需随阶段 B 收敛；白名单本身是小幅手工维护（但远小于 57 项全量清单，且每项带收敛 TODO）。
- 阶段 B 为结构性重构：需在各视图建立声明式 `testid↔handler` 映射并改生成链路，有一次性迁移成本。

**已知遗留**
- 阶段 A→B 过渡期内，12 个动态委托 testid 依赖白名单放行，其「真实消费」靠文档标注而非静态校验保障。
- `tmp/analyze-testid-consumers.mjs` 为本次调研实证脚本（一次性），不作为长效工具；阶段 B 落地后可删除。

## 4. 数据溯源

- **契约测试实现** → `tests/test_testid_contract.mjs`：`TESTID_REGISTRY`（line 19–88，手工清单）；存在性校验（line 103–116，仅 `content.includes('data-testid="<id>"')` / `dataset.testid = "<id>"`）。
- **事件链核实** → `git cat-file -t` 确认 `5bfc6ff5` / `5cbbc43a` / `029ef285` / `46f45c19` / `9a43766d` 均存在；`git log --oneline` 见 `9a43766d` 为「移除 export-repo 死按钮 + 删 tree-repo-export 死条目」。
- **消费性实证** → `tmp/analyze-testid-consumers.mjs`（遍历 `frontend/src` 全部 `.ts/.tsx`，负向边界正则 `(?<![a-z0-9-])<id>(?![a-z0-9-])` 防前缀误匹配）：57 个 testid 全部有消费；44 个有 `.test.ts` `getByTestId` 引用；12 个仅声明文件出现（动态委托）。
- **上游契约** → ADR-035（G-1 抗脆弱测试基础设施）、`docs/adr/index.md` 登记表（ADR-133 已占号）。

<!-- 文件名: testid-contract-authenticity.md → 实际文件 ADR-133-testid-contract-authenticity.md -->
