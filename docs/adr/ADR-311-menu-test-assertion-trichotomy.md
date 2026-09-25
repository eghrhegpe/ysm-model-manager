# ADR-311：菜单测试断言三分法契约（渐进执法）

- **状态**：✅ 已采纳（D2/D3 基础设施同日落地；D4 渐进执法进行中——实施进度查知识卡 `menu_test_assertion.md`）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-25
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/menu/menu-test-helpers.ts`（helper 归址）/ `scripts/check-menu-test-layout.ts`（执法闸）/ `docs/.menu-test-layout-baseline.json`（只减不增基线）/ `docs/adr/ADR-021-declarative-menu-testing.md`（B 层「菜单即数据」——本 ADR 是其测试断言侧的续刀）/ `docs/adr/ADR-085-menu-single-source.md`（check-menu-health 门禁——本 ADR 新增姊妹闸）/ `docs/adr/ADR-302`（per-kind 字段契约——本 ADR 的字段错配门已覆盖）/ 知识卡 `menu-test-assertion.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」（2026-09-25）的状态快照，落地后病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准。 -->

菜单体系三层防线的「长久度」不均（2026-09 取证）：

- **自动跟随层（已长久）**：`check-menu-health.ts` 白名单从 `PreviewMenuNodeKind`/`PreviewMenuGroupId` 类型推导、`cap-menu-trees.test.ts` + `node-validation.test.ts` 零违规门（新增 cap 自动纳入）、`context-menus.test.ts` 遍历 `MENU_DEFS` 对账——加菜单项不改这些测试。
- **脆弱层（本 ADR 治症）**：cap/adapter 侧单测手写「布局快照」断言——
  ① 有序 id/kind 清单：`expect(folder.children!.map((c) => c.id)).toEqual([…])`（决策时 26 个测试文件、40+ 处）；
  ② 顶层计数：`expect(nodes).toHaveLength(8)`；
  ③ 位置索引：`const folder = nodes[3]!`。
  增删一项、换一组、调一次顺序，测试全红陪葬。**实证**：`5bc993c74`（灯光菜单三分治）生产侧 `light-controls.ts` 改 74 行，测试侧 `light-capability.test.ts` 改 163 行——测试 churn 为生产 churn 的 2 倍+；近六周 light/sky/water 测试文件各改动 33~36 次，多数为布局陪跑而非逻辑变更。

用户痛点（决策动因）：「近期经常改菜单，测试也要频繁改，担心逻辑测试写得不够长久」。

病根不是「测试太多」而是「断言的性质错位」：把**布局事实**（哪些项、什么顺序）当**逻辑契约**锁死。布局恰是迭代最频繁的自由维度，锁它 = 每改菜单必改测试；而**行为契约**（control 读写闭包、visibleWhen 语义、值域源自 schema、i18n 三语）才是真正该锁的长久不变量——这部分现有测试已写得长久，不动。

## 2. 决策（Decision）

**菜单测试断言按性质三分，布局维度降为集合契约，执法走「基线只减不增 + 触碰即收敛」渐进路线（对齐 check-layering R8 / ADR-208 范式），不搞一次性 big-bang。**

### D1 三分法契约（写菜单测试的唯一断言准则）

| 断言性质 | 判据 | 写法 | 例 |
|----------|------|------|----|
| **行为不变量**（硬断言） | 改它 = 逻辑坏 | 逐条 `expect`，保留现状 | `control.set/get` 闭包直连 cap、`visibleWhen` 真值表、值域 `toEqual(getParamRange(…))`、options `labelKey` 三语 |
| **成员归属**（集合断言） | 改它 = 菜单该改测试了，但只红在归属处 | id 数组配仓内集合惯例：`.sort()).toEqual([...].sort())`（精确集合）/ `toContain` / `arrayContaining`，**不锁原始顺序** | 「fog-density 属于雾参数组 folder」 |
| **顺序/布局快照**（默认禁止） | 顺序绝大多数是实现细节 | **不写**；仅当顺序本身是产品决策（如 master toggle 置顶、底栏 dock 序）才写有序断言，且**必须行尾注 `// layout-assert: <产品理由>`** | `nodes[0].id === master`（cap 总开关置顶） |

`toHaveLength(N)` 顶层计数归入「顺序/布局」档：仅防门空转的量级断言（`toBeGreaterThan(50)`，cap-menu-trees 已示范）合法，精确计数需 `layout-assert` 注记。

### D2 共享 helper（消灭手 index，归属断言的载体）

`frontend/src/preview-3d/menu/menu-test-helpers.ts` 新建（零上层依赖叶：只有 vitest expect + schema 叶——`menu-test-fixtures.ts` 顶层 import 有 preview-state 副作用接线，`@vitest-environment node` 的 cap 测试引它即拖整条状态层依赖链，R6 反桶精神；原先 light/postprocessing 测试各持一份手搓 `findNode` 近似拷贝）：

- `findNodeById(nodes, id)` → 命中即返回、未命中即 `expect` 失败带清晰信息（替代 `nodes[3]!` 与 `find(...)!` 裸 bang）
- `childIds(node)` / `nodeIds(nodes)` → 有序 id 数组，**配合集合 matcher 使用**
- `assertNoDuplicateIds(nodes)` → 树内 id 唯一（渲染 testid 撞车防线）

### D3 执法闸 `scripts/check-menu-test-layout.ts`（防回退，只拦新增）

- 扫描 `frontend/src/**/*.test.ts` 菜单区（`preview-3d/menu|caps|adapters|state` + `views/app-preview` + `features/context-menu`）中的布局快照模式：有序 `.map(...id|kind)).toEqual([数组字面量])`、精确 `toHaveLength(<数字>)`、`nodes[<数字>]` 索引。
- **豁免**：行尾 `// layout-assert: <理由>`（D1 第三档合法形态）；量级断言 `toBeGreaterThan`；非菜单区测试文件。
- **基线** `docs/.menu-test-layout-baseline.json`（key=`文件:行号区间指纹`）：只减不增，`--update` 收紧、新增需 `--force`——照 check-layering R3/R4/R8 实现。
- 接线：`DOMAIN_BLOCK_CHECKS` + `frontend-domain.ts`（gate-coverage 双向扫描锁死），随 push 门禁跑。

### D4 渐进收敛（触碰即还债）

存量 40+ 处不一次性改写（尊重 ADR-208「反对 big-bang」）：改哪个 cap 的菜单，顺手把它测试里的布局快照降为集合断言 + helper 化；基线随之收紧。`cap-menu-trees.test.ts` / `node-validation.test.ts` / `context-menus.test.ts` 的既有模式即长久范本，新写菜单测试照抄。

## 3. 后果（Consequences）

### 正面
- 改菜单项增删/重排 → 逻辑测试不再全红陪葬，只有归属处按需更新一行集合清单；测试 churn 与生产 churn 脱钩。
- 行为契约（真正长久部分）零损失——不动、不弱化。
- 顺序断言若出现，必须携带产品理由（`layout-assert` 注记），把「为什么锁顺序」沉淀为可读决策，而非手滑复制的快照。
- helper 归一消除各测试文件手搓 `findNode`/裸 `nodes[i]!` 的双源漂移。

### 负面 / 成本
- 布局闸是正则扫测试文件的启发式——误报靠 `layout-assert` 注记豁免兜底；漏报（变量间接的有序断言）接受，防线本意是「新增时想起来」而非穷举。
- 集合断言放弃顺序后，「顺序错乱」类回归不再被单测捕获——由 e2e（ADR-128 menu-nav-graph 选择器）与渲染层 `MENU_HANDLERS` 判别联合（TS2741 编译期兜底）分担，不单靠本层。
- 基线文件需人肉随 `--update` 收紧，忘跑则债务静默（gate 输出「已消除 N 条待收紧」提示兜底）。

### 已知限制（不修复）
- 非菜单区测试文件（如 dialog tag-editor 的 DOM 计数）不纳入本闸——「频繁改菜单必改测试」痛点仅在菜单区成立，泛化即噪音。
- 快照测试（`toMatchInlineSnapshot`）不引入：对 LLM 会话噪音大、diff 可读性差，集合断言已覆盖需求（评估过程见知识卡）。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `git log --since="6 weeks ago"` 菜单区 churn | light/sky/water 测试各 33~36 次改动；`5bc993c74` 测试 163 行 vs 生产 74 行 |
| 全仓 `.test.ts` 有序 id/kind toEqual 扫描 | 26 文件 40+ 处布局快照断言（决策时计数，随收敛只减） |
| `frontend/src/preview-3d/caps/cap-menu-trees.test.ts` | 「新增 cap 自动纳入」+ 防门空转量级断言 = 长久范本 |
| `scripts/check-layering.ts` | 基线只减不增 + `--update`/`--force` + 行级豁免尾注 = 执法范式 |
| `scripts/_lib/gate-coverage.ts` `DOMAIN_BLOCK_CHECKS` | 新闸接线点（tests/test_gate_coverage.ts 双向锁死） |
| `docs/adr/ADR-021` / `ADR-085` / `ADR-208` / `ADR-302` | 声明式菜单测试 / 菜单单一事实源 / 反 big-bang / per-kind 字段契约 |
