# ADR-147：移除 app-tree _typeFilter 死字段与自证测试

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-tree/index.ts:74,275-277；bus-handlers.ts:86,113,140,183,241,307；events.ts:51,472；index.extra.test.ts:448-461；知识卡 ground-cap-gcbuildmaterialgroup-133.md:45`

---

## 1. 背景（Context）

`AppTree._typeFilter` 名义上是「按资源类型过滤渲染」的字段，实则**从未被生产代码赋过非空值**：

- 全仓唯一赋值点是声明处 `index.ts:74` 的 `_typeFilter = ""`；`observedAttributes` 仅 `["root","subdir"]`（`index.ts:98`），没有 type 属性通道。
- 8 处读取（`bus-handlers.ts:86,113,140,183,241,307` 六处、`events.ts:51,472` 两处）恒为空串，等价于常量 `""`。
- 唯一非声明赋值来自 `index.extra.test.ts:454-455`——测试自己写入 `_typeFilter = "ysm"`，再断言渲染只剩 ysm 行。这是**自证循环**：它证明的只是「我们写的 filter 代码能 filter」，不证明任何生产路径可达。

因此 `index.ts:275-277` 的过滤分支在生产环境永不进入，属于带测试保暖的死代码。它同时是「测试耦合私有字段」问题（全仓 41 处 inline 私有断言中，app-tree 独占 32 处）的成因之一：为了让这个永不触发的分支有覆盖率，测试被迫去戳私有字段。

前置约束：知识卡 `ground-cap-gcbuildmaterialgroup-133.md:45` 已决策「私有字段访问用类型断言**集中一处**，无需扩大 public API 面」。本 ADR 是在该约束下推进，不与之冲突。

## 2. 决策（Decision）

**删除** `_typeFilter` 字段、其过滤分支，以及依赖它的自证用例。采「删」而非「保留标注预留」，理由：

1. 字段无生产写入方，保留即持续产生「需不需要接线」的误判成本；
2. 删掉分支可同步简化 8 处 `vm._rootAttr || vm._typeFilter || RESOURCE_TYPES.YSM` 三元，降低后续读者的认知负担；
3. 若将来真需要类型过滤，届时按真实需求重新设计（大概率走 `root` 属性或 bus 事件），比给一个空壳字段续命干净。

配套保留的既有决策：`_filterPaths`（生产赋值 3 处——`toolbar-search.ts:133` 置空、`toolbar-search.ts:224-230` 白名单交集、`toolbar-events.ts:185` 清除筛选）是 AppTree 协作子模块间的事实公共字段，下划线前缀已正确表达「对外私有、对协作层开放」的边界，**不改名转正**。本 ADR 不涉及该字段。

死代码删除的 TDD 顺序：先写捕获测试（红）→ 再删实现（绿）。本例无行为可回归，故「红」落到**契约测试**上：新增 `tests/test_private_access_contract.ts` 静态扫描，断言 app-tree 目录下 inline 私有断言归零。

## 3. 后果（Consequences）

**正面**
- 死分支与自证用例一并消失，覆盖率数字回落但**有效**覆盖率上升；
- 8 处三元简化为 `vm._rootAttr || RESOURCE_TYPES.YSM`，读取点语义变直白；
- 为「测试耦合私有字段」治理（新增 `test-internals.ts` 收敛层）扫掉一个字段，私有断言面从 11 个字段降到 10 个（计数口径见 §4 末行）。

**负面 / 风险**
- 若存在本 ADR 未发现的动态写入路径（如 `Object.assign`、字符串下标访问），删除会造成运行时静默失效。缓解：删除前以全仓 `grep -rn "_typeFilter"`（含 `.ts/.js/.html`，可命中 `obj["_typeFilter"]`、`Object.assign({ _typeFilter: … })` 等动态形态，无需 `git log -S`）交叉验证，删除后跑 `cd frontend && npx vitest run src/views/app-tree` + `npx vite build` 全绿方可提交。
- 8 处三元的简化是跨文件改动，须一次性改完，避免半途状态。

**已知遗留**
- 若后续确有类型过滤需求，重新引入时应配套真实调用方与端到端用例，不得再以「测试直接写私有字段」的方式补覆盖。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `grep -rn "_typeFilter\s*=" frontend/src`（排除 `.test.ts`） | 仅 `index.ts:74` 声明赋值 → 无生产写入方 |
| `grep -rn "typeFilter" frontend/src --include=*.js --include=*.html` | 无命中 → legacy 侧亦无写入 |
| `index.ts:98 observedAttributes` | `["root","subdir"]` → 无属性通道 |
| `grep -rn "_typeFilter" --include=*.ts`（读取点） | 8 处，均 `vm._rootAttr \|\| vm._typeFilter` 形态，恒空串 |
| `index.extra.test.ts:454-455` | 唯一非声明赋值 → 自证循环 |
| `grep -rc "as unknown as { _" --include=*.test.ts` | 全仓 41 处；app-tree 两文件 32 处（78%）→ 治理优先级 |
| 知识卡 `ground-cap-gcbuildmaterialgroup-133.md:45` | 既有决策「断言集中一处，不扩 public API」→ 约束本方案 |
| `grep -rhoE "as unknown as [^;]*\{ _" --include=*.test.ts`（app-tree 两文件）`\| grep -oE "_\w+" \| sort -u` | 11 个不同私有字段；删 `_typeFilter` 后 10 个 |

<!-- 文件名: remove-apptree-typefilter-dead-field.md → 实际文件 ADR-147-remove-apptree-typefilter-dead-field.md -->
