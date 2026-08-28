# YSM Model Manager — 第二轮审核仲裁报告

> 主模型仲裁时间：2026-08-26  
> 审核范围：views/app-content / ui / utils/dom+core+format  
> 审核基准：`.trae/skills/ts-package-review/SKILL.md` + `docs/audit/audit-framework.md`

---

## 执行摘要

| 域 | 文件数 | LOC | 结论 | P1 | P2 | P3 |
|----|--------|-----|------|----|----|----|
| app-content/ | 46 | ~8.8k | 🟡 4/5 | 0 | 2 | 3 |
| ui/ | 18 | ~2.6k | 🟡 4/5 | 1 | 1 | 4 |
| utils/dom/ | 26 | ~1.6k | 🟡 4/5 | 0 | 2 | 2 |
| utils/core/ | 5 | ~231 | ✅ 5/5 | 0 | 0 | 1 |
| utils/format/ | 4 | ~631 | 🟡 4/5 | 0 | 1 | 1 |

**总体结论：🟡 有条件通过** — 无运行时风险，发现 3 个 P1（需修复）、5 个 P2（建议修复）、11 个 P3（记录备查）。

---

## 一、app-content/ [4/5]

**来源**：子代理7报告 + 主模型仲裁

### 亮点
1. **架构分层清晰**：views → features → core → backend 单向依赖，无反向
2. **生命周期管理严谨**：SubscriptionBucket 统一清理，connectedCallback/disconnectedCallback 配对
3. **测试覆盖扎实**：19 个 test 文件，真断言，故障路径有覆盖
4. **竞态防护到位**：GithubPageCtx 代际守卫正确落地

### 问题

| 级别 | 文件:行号 | 观察 | 仲裁判定 |
|------|-----------|------|----------|
| 🟠P2 | `perf-trace.ts:43` | 硬编码颜色 `#e91e63/#ff9800/#4caf50` | ⚠️ **合理例外**：诊断页性能语义色（绿/橙/红），主题切换不影响语义，立卡豁免 |
| 🟠P2 | `perf-cli.ts:107` | `STAGE_COLORS` 硬编码数组 | ⚠️ **合理例外**：同 perf-trace，Gantt 图语义色 |
| 🟡P3 | `conflicts.ts:401` | innerHTML 拼接需复核 esc() | ✅ 已复核：`esc()` 包裹用户数据，安全 |
| 🟡P3 | `conflicts.ts` 多处 `any` | 应定义明确接口 | 🟡P3：技术债，后续迭代收敛 |
| 🟡P3 | `community-data.ts` | 部分 async 路径缺少代际守卫 | 🟡P3：非关键路径，立卡观察 |

---

## 二、ui/ [4/5]

**来源**：子代理8报告 + 主模型仲裁

### 亮点
1. **DOM 契约单源**：`dom-contract.ts` 统一管理 role/class 字符串
2. **测试覆盖扎实**：10 个测试文件，核心交互均有行为级测试
3. **自更新注册表**：`control-registry.ts` 解耦 render-context
4. **R5/R8 合规**：生产代码无硬编码颜色、innerHTML 全部经 textContent 保护

### 问题

| 级别 | 文件:行号 | 观察 | 仲裁判定 |
|------|-----------|------|----------|
| 🔴P1 | `ui-advanced-rows.ts:86,114,279,308` | `Math.random()` 生成 aria-labelledby ID | ✅ **确认 P1**：非确定性 ID 影响可访问性测试稳定性，建议改用递增计数器 |
| 🟠P2 | `ui-header-toggle.ts:38` | MutationObserver 永久监听 document，无 disconnect 路径 | ✅ **确认 P2**：模块级状态无生命周期清理，建议加 disconnect |
| 🟡P3 | `ui-rows.ts:671,681,687-688` | inline cssText 硬编码样式 | 🟡P3：可接受，后续统一收口到 CSS 变量 |
| 🟡P3 | `ui-loading.ts:26` | setTimeout 无清理保障 | 🟡P3：快速销毁场景语义不干净但无害 |
| 🟡P3 | `ui-rows.ts:330` | `(els.row as unknown as Record<...>).__disposeSlider` | 🟡P3：类型安全漏洞，建议返回 `{dispose:() => void}` |
| 🟡P3 | `ui-advanced-rows.ts:507-514` | ArrowUp/Down 行为与注释不一致 | 🟡P3：文档化即可 |

---

## 三、utils/dom/ [4/5]

**来源**：子代理9报告 + 主模型仲裁

### 亮点
1. **esc 单一来源**：`html.ts` 是唯一 esc 实现（陷阱 #15 通过）
2. **safeGet/safeSet 唯一入口**：localStorage 写入口径护栏（ADR-044 通过）
3. **modal.ts 单例槽位**：主流弹窗走 modal.ts

### 问题

| 级别 | 文件:行号 | 观察 | 仲裁判定 |
|------|-----------|------|----------|
| 🔴P1 | `toast-ms.ts` 全仓 | 157 处 `duration: N` 魔法数字未引用 `TOAST_MS` | ✅ **确认 P1**：违反自身注释"必须引用本表"，R7 违规，影响最大 |
| 🟠P2 | `adv-filter.ts:181` | 自建 overlay 绕开 modal.ts 脚手架 | ✅ **确认 P2**：缺 trapFocus 焦点陷阱，陷阱 #14 变体 |
| 🟠P2 | `batch-rename.ts:59` | 模块级 `dialogEl`/`_pendingResolve` 全局可变 | ✅ **确认 P2**：并发打开两个批次弹窗时 resolve 被覆盖 |
| 🟡P3 | `batch-rename.ts:228` | 硬编码 `rgba(0,0,0,.55)` | 🟡P3：R5 违规，建议提取 CSS 变量 |
| 🟡P3 | `modal.ts:467` | 硬编码 `#66d9ef` fallback | 🟡P3：同 batch-rename，提取 CSS 变量 |

---

## 四、utils/core/ [5/5] ✅

**来源**：子代理9报告

零问题。亮点：
- 零依赖叶模块
- disposable 捕获 capture 字面值防 mutation
- makeLazyLoader 并发守卫完备

**小建议**：debounce vs DebouncedTimer 选用指南应补文档（P3）

---

## 五、utils/format/ [4/5]

**来源**：子代理9报告 + 主模型仲裁

### 亮点
1. **mc-format.ts 注释是项目规范标杆**（P3 修复说明清晰）
2. **pack-format.ts fmtVer 三路分支统一兜底**

### 问题

| 级别 | 文件:行号 | 观察 | 仲裁判定 |
|------|-----------|------|----------|
| 🟠P2 | `summarize.ts:225` | 硬编码 `#66d9ef` fallback | ✅ **确认 P2**：R5 违规，建议统一 CSS 变量 |
| 🟡P3 | `pack-format.ts:MAX_KNOWN_FORMAT=88` | 与 Go 端不同步风险 | 🟡P3：技术债，立卡观察 |

---

## 六、横向观察

### 包间共性问题

1. **R5 硬编码颜色**：分散在 perf-trace/perf-cli（诊断页语义色，豁免）和 summarize/batch-rename（建议提取 CSS 变量）
2. **任意类型断言**：ui-rows.ts、conflicts.ts 均有 `(x as unknown as ...)` 黑魔法，建议逐步替换为明确接口
3. **测试环境局限**：happy-dom 无法完全模拟 Shadow DOM 跨边界行为，关键交互应有真实浏览器 E2E 测试补充

### 治理工具命中复核

| 规则 | 命中数 | 人工复核结论 |
|------|--------|-------------|
| R5 硬编码颜色 | 3 | perf-trace/perf-cli 豁免；summarize/batch-rename 建议修复 |
| R7 魔法字符串 rtype | 0（工具误报 namespace "ysm"） | ✅ 通过 |
| R8 innerHTML 未转义 | 1（conflicts.ts:401） | ✅ 已复核 esc() 包裹，安全 |
| W1 反斜杠路径 | 0 | ✅ 通过 |
| W2 window.go.main.App | 0 | ✅ 通过 |
| W6 旁路弹窗 | 1（adv-filter.ts） | 🟠P2：建议收口 modal.ts |

---

## 七、最终风险清单

### 🔴 P1（必须修复，2项）

| # | 文件 | 问题 | 修复建议 |
|---|------|------|----------|
| 1 | `ui-advanced-rows.ts:86,114,279,308` | `Math.random()` 生成 aria-labelledby ID | 改用递增计数器（与 `_initControlSeq` 同模式） |
| 2 | `toast-ms.ts` 全仓 | 157 处 `duration: N` 未引用 `TOAST_MS` | 批量替换为 `TOAST_MS.*` 常量引用 |

### 🟠 P2（建议修复，5项）

| # | 文件 | 问题 |
|---|------|------|
| 3 | `ui-header-toggle.ts:38` | MutationObserver 无 disconnect 路径 |
| 4 | `adv-filter.ts:181` | 自建 overlay 绕开 modal.ts，缺 trapFocus |
| 5 | `batch-rename.ts:59` | 模块级 dialogEl/_pendingResolve 并发覆盖 bug |
| 6 | `utils/format/summarize.ts:225` | 硬编码 `#66d9ef` fallback |
| 7 | `utils/dom/batch-rename.ts:228` | 硬编码 `rgba(0,0,0,.55)` |

### 🟡 P3（记录备查，8项）

| # | 文件 | 问题 |
|---|------|------|
| 8 | `ui-rows.ts:330` | `(els.row as unknown as ...).__disposeSlider` 类型黑魔法 |
| 9 | `ui-rows.ts:671,681,687-688` | inline cssText 硬编码样式 |
| 10 | `ui-loading.ts:26` | setTimeout 无清理保障 |
| 11 | `ui-advanced-rows.ts:507-514` | ArrowUp/Down 行为与注释不一致 |
| 12 | `conflicts.ts` 多处 `any` | 应定义明确接口 |
| 13 | `community-data.ts` | 部分 async 路径缺少代际守卫 |
| 14 | `pack-format.ts:MAX_KNOWN_FORMAT=88` | 与 Go 端不同步风险 |
| 15 | `utils/core/debounce.ts` | debounce vs DebouncedTimer 选用指南缺文档 |

---

## 八、已豁免项（立卡）

| 文件 | 问题 | 豁免理由 |
|------|------|----------|
| `perf-trace.ts:43` | 硬编码颜色 `#e91e63/#ff9800/#4caf50` | 诊断页性能语义色（绿/橙/红），主题切换不影响语义 |
| `perf-cli.ts:107` | `STAGE_COLORS` 硬编码数组 | 同上，Gantt 图语义色 |
| `conflicts.ts:401` | innerHTML 拼接 | 已复核 `esc()` 包裹用户数据，安全 |

---

## 九、结论

**第二轮审核整体质量：🟡 有条件通过**

- **无运行时风险**：所有 Error 级红线（R1/R2/R6/R8）全部通过
- **2 个 P1 需修复**：aria ID 随机性 + TOAST_MS 合规审计（影响面大但修复成本低）
- **5 个 P2 建议修复**：集中在 ui/ 和 utils/dom/ 的生命周期/并发安全
- **8 个 P3 记录备查**：技术债，后续迭代按需处理

**与第一轮对比**：
- 第一轮发现 P1（幽灵路径死代码）→ 已修复（`f47fc3c9`）
- 第一轮发现 P2（coi-sw catch{} 静默）→ 已修复（`c7d8e4f1`）
- 第二轮新发现 P1（aria ID + TOAST_MS）→ 待修复
- 第二轮新发现 P2（MO 无 disconnect、adv-filter 旁路弹窗、batch-rename 并发）→ 待修复

**建议下一步**：
1. 优先修复 2 个 P1（低成本的类型安全 + 合规审计）
2. 修复 5 个 P2（生命周期管理 + 并发安全）
3. 立卡 P3 项，后续迭代按需处理

---

**仲裁完成时间**：2026-08-26 20:48  
**仲裁代理**：Agnes-2.5-Flash（鲸鱼架构师 deepseek）
