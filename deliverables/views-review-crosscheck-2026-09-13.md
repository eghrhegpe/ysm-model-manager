# views 审核交叉复核 — 两份结论为何相反（2026-09-13）

**背景**：同一天，两份独立审核对 `frontend/src/views` 给出方向相反的结论：

| 来源 | 结论 | 风险定级 | 依据 |
|---|---|---|---|
| 本会话审核 | 整体健康，需几处收敛 | **1 🔴 + 2 🟠** | 机器门禁全量 + 逐文件实证 |
| 兄弟会话锐评 | **A+**，范式最整齐 | **无 P1/P2** | 5 道门禁 + 人工代码审美 |

两份报告对"views 写法纪律强"这一点**没有分歧**。分歧在**结论上限**——它由门禁覆盖率决定。本文件逐条核验锐评断言，定位差异根源。

---

## 一、锐评断言核验

### 准确的（12 项）

| # | 断言 | 实测 |
|---|---|---|
| 1 | 129 生产 + 80 测试 = 209 文件 | 129 / 80 / 209 ✅ |
| 2 | `any` 全仓 0 处命中（仅注释提及） | 1 处，位于 `app-sync-manager/self-type.ts:57` 注释内 ✅ |
| 3 | `biome check src/views` 129 文件 0 违规 | 复跑：129 files, No fixes ✅ |
| 4 | `check-layering` 全绿 | ✅ |
| 5 | `check-path-hygiene` R4 14/14 OK | ✅ |
| 6 | `@/` 别名引用 601 处 | 601 ✅ |
| 7 | 0 处裸目录 import | 0 ✅ |
| 8 | `console.log` 零残留 | 0 ✅ |
| 9 | 4 处 `CSSStyleSheet` 环境守卫模式一致 | app-tree / app-content / app-preview / app-sidebar ✅ |
| 10 | `app-tree/index.ts` 631 行 | 631，views 最大文件 ✅ |
| 11 | `app-tree/index.ts:28` import 位置在 HMR 块后 | 确认：被模块级样式表 IIFE 隔断成两段 import ✅ |
| 12 | `app-toast/index.ts:41` constructor 即写 shadow innerHTML | 确认，含 `<style>` ✅ |

### 不准确或需更正的（5 项）

| # | 断言 | 实测 | 性质 |
|---|---|---|---|
| 13 | **"机器门禁全绿"** | 项目有 **32 道** `check-*.ts`；锐评跑 **5 道** | ⚠️ 门禁子集呈现为全集 |
| 14 | **"无 P1/P2 级风险"** | `check-complexity`：views **10 个 🟥 / 21 🟧 / 50 🟨**，最高 `showModelDetail` 认知 **81** | ❌ 结论不成立 |
| 15 | **"0 处 `../` 深跳"** | views 内 **7 处**，全部指向 `frontend/bindings/…`（Wails 生成绑定） | ❌ 数字不准 |
| 16 | `context-menu/index.ts:**21**` 用 `<style>` | 实际在 **84–85 行**（模板起始 84、`<style>` 标签 85） | ⚠️ 行号错 |
| 17 | **"0 处直引 `backend/app.ts`"** | **2 处**：`views/backend-deps.ts:10`（seam 本体）+ `app-content/settings/store.ts:5`（纯 `import type`） | ⚠️ 不准，但结论方向对（无运行时绕 seam） |

补充：锐评自述"**7 个** Shadow DOM 组件"与"**8** 视图统一继承"——实测 8 个文件 `extends WebComponentBase`，8 个视图目录。两句自相出入。

### 提出但未闭环（1 项）

| # | 项 | 核验结果 |
|---|---|---|
| 18 | "`app-tree/render.ts` 无 esc 却用 innerHTML"（疑点） | **安全**。`render.ts` 的 `tpl.innerHTML = row.html`（355 行）消费的是 `row-tpl.ts` / `row-tpl-list.ts` 的输出，其中 `esc()` 在 `row-common.ts` 内；`emptyStateHTML` 同理。render.ts 自身不拼接未转义数据。锐评结论表未收录该疑点的裁定 |

---

## 二、分歧根源：门禁覆盖率

项目 `scripts/` 下有 **32 道 `check-*.ts`** 门禁。锐评实证的门禁：

| 门禁 | 锐评 | 本会话 | 当前状态 |
|---|---|---|---|
| `check-layering` | ✅ 跑了 | ✅ | 绿 |
| `check-path-hygiene` | ✅ 跑了 | ✅ | 绿 |
| `biome` | ✅ 跑了 | ✅ | 绿 |
| `typecheck` | ✅ 跑了 | ✅ | 绿 |
| `vite build` | ✅ 跑了 | ✅（上轮） | 绿 |
| `check-circular` | ❌ **未跑** | ✅ | 绿（**本会话 `62ba4f88a` 修复**） |
| `check-complexity` | ❌ **未跑** | ✅ | **10 个 🟥** |
| `check-redlines` | ❌ **未跑** | ✅ | views 1 条 WARN |
| `check-file-lines` | ❌ 未跑 | ✅ | 绿 |
| `check-orphan-exports` | ❌ 未跑 | ✅ | 绿 |
| `check-tpl-refs` | ❌ 未跑 | ✅ | 绿 |
| `check-dynamic-import` | ❌ 未跑 | ✅ | 绿 |
| `check-type-safety` | ❌ 未跑 | ✅ | 绿 |

两条关键推论：

1. **`check-circular` 未跑 → 无法独立验证"无循环依赖"**。该项目曾有 `model2d-draw.ts ↔ model2d-hit-zones.ts` 直接双模块环（`check-circular` exit 1），由本会话下沉 `model2d-geom.ts` 叶模块修复。锐评报告的时点（129 生产文件 = `geom.ts` 已存在）在此修复**之后**——它看到的"绿"是本会话的修复成果，而非 views 层固有品质。它未跑该门禁，因而既无法发现、也无法主张。

2. **`check-complexity` 未跑 → 遗漏当前唯一成规模的问题**。这不是历史遗留：10 个红档**当前可复现**。锐评的"无 P1/P2"因此不成立。

门禁子集的呈现方式还有一层风险：读者会把"机器门禁全绿"读作"项目无问题"，而实际含义是"我选的这 5 道没问题"。

---

## 三、双向遗漏（互相补位）

**锐评漏掉、本会话覆盖到**：循环依赖（🔴）、`showModelDetail` 认知 81、`collectBoneBounds` 57/嵌套 6、views 10 个复杂度红档、R5 在 views 的命中、`--grad-rot` 未接线参数。

**本会话漏掉、锐评抓到**：

| 项 | 位置 | 价值 |
|---|---|---|
| import 被模块级代码隔断 | `app-tree/index.ts:28` | ✅ 真实，写法不规范（ESM 提升使其非破坏性） |
| `<style>` 内联双轨 | `app-toast/index.ts:42`、`context-menu/index.ts:85` | ✅ 真实，与 4 大视图的 `adoptedStyleSheets` 不一致 |
| constructor 即写 shadow innerHTML | `app-toast/index.ts:41` | ✅ 真实，当前清理对称故无泄漏 |

这三项是**人工审美层面**的发现，机器门禁不覆盖，本会话确实漏检。锐评在此强于门禁驱动的方法。

---

## 四、本会话的自我更正

复核过程同时暴露本会话两处需更正：

1. **P1 重构的嵌套指标未达预期**。上轮报告预期"嵌套 7 → 3"；实测 `collectBoneBounds` 为**认知 57 / 嵌套 6**（原 `calcBoneHitZones` 认知 155 / 嵌套 7）。认知大幅下降（−63%），但嵌套仅降 1。同时新引入 2 个复杂度命中：`collectBoneBounds`（57/6，红档）、`projectVertex`（32/3，橙档）。净效果仍是改善（消除一个 155 红档），但"嵌套降至 3"的表述不成立。

2. **生产行数偏低**。上轮报告写"约 2.1 万行"，实测 **23,152 行**（生产）/ 45,138 行（含测试）。

3. **引入 1 条 R5 WARN**。`model2d-draw.ts:82` 的 `return \`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})\`` 被 R5 判为硬编码色——实为运行时构造。同形态既有先例 `cap-controls.ts:540` 亦在 WARN 内，属已知容忍形态，`--baseline` exit 0 不阻断。

---

## 五、结论

两份报告**定性一致、定量分叉**：

- 一致处：views 的分层隔离（seam 模式）、路径纪律、`esc()` 注入式转义、订阅可回收、生命周期对称——确为全仓最整齐的模块组。锐评的 12 项断言准确，且它在**人工审美维度上补了本会话的盲区**。
- 分叉处：锐评的 **A+ / 无 P1/P2** 建立在 5 道门禁上，遗漏了 `check-complexity`（10 个红档，可复现）与 `check-circular`（修复前为红）。其 5 项断言不准确（含"0 处 `../` 深跳"、"0 处直引 backend/app.ts"）。

**可采用的联合表述**：

> views 的**分层 / 路径 / 格式 / 类型**四维达 A+ 级，机器门禁全绿（含循环依赖，本会话修复后）；**复杂度**维度有 10 个红档函数待收敛，最高 `showModelDetail` 认知 81。人工层面遗留 3 项小债：`app-tree/index.ts:28` import 位置、toast/context-menu 的 `<style>` 双轨、`app-tree/index.ts` 631 行体量。

**方法教训**：审核报告里"门禁全绿"必须附**门禁清单**与**覆盖率**，否则结论上限被静默截断。锐评的 5/32 与"全绿"并列，是本轮两份报告分叉的直接成因。
