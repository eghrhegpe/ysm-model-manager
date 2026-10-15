# ADR-350：app-tree状态骨架D1：重载入口收敛单函数+决策表、条目突变单一出口

- **状态**：✅ 已采纳（Adopted）
- **日期**：2026-10-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：app-tree 状态模型难逆转决策：重载四入口（挂载补载/属性切型/手动刷新/删除后）各写一遍缓存与守卫决策是平行实现复发源，收敛为参数化单点；跨 index.ts/events.ts/bus-handlers 多文件
- **相关**：ADR-230（代际守卫唯一出口）、锐评 2026-10-15 第 2 期 D1、`frontend/src/views/app-tree/{index.ts,tree-state.ts,data.ts,render.ts}`

---

## 1. 背景（Context）

锐评 2026-10-15 第 2 期 D1「app-tree 状态骨架」的前半程（状态容器化 `TreeState`、selectState 去模块单例、代际守卫收口 `_guard`、reload 第三处平行实现消除）已落地。残留病灶两处：

① **重载四入口各写一遍决策**：`index.ts` 的 connectedCallback 首挂载（`_load` + 快照差量补载 `_reloadAfterMountSwitch`）、属性变更链（`_attrChangeReloadAsync`：_clearSelection + 水化 + _load + stale + render）、bus `tree:reload`（全局 ClearScanCache + community cache + `_load`）、删除后重载（`ClearScanCache` + `_load`）——四条链各自内联「要不要清缓存 / 清多深 / 要不要清选中 / 水化 / 守卫」，止血 2026-10-15 A2 改其中一条时卡文要人肉同步另三条（本次实证：A2 只改了 `_attrChangeReloadAsync`/`_reloadAfterMountSwitch` 两处，靠注释钉住第三处不跟改）。平行实现的复发形态 = 每次语义变更漏改一条链。
② **条目原地突变 6 调用点**（events.ts 4 + bus-handlers.ts 2）直接写 `entry.banned`，靠「每个调用点手动 `invalidateBuildCache`」维持 render 快路径一致性——卡文不变量已钉（app-tree.md「乐观翻转原地改必须 bump buildCache 修订号」），但纪律靠注释不靠结构，新增突变点必漏（锐评第 2 期 D1 的本体）。

## 2. 决策（Decision）

**D1 只做骨架收敛，不改状态模型**（TreeState 容器/守卫出口不动）：

① **重载入口收敛为 `_reload(reason: ReloadReason)`**（`index.ts` 内私有单函数）：reason ∈ `{mount-hydrate, attr-switch, user-reload, post-delete}`，决策表参数化——「清全局缓存？」（user-reload/post-delete 才清，A2 语义固化在表内）/「水化 dirOpen？」（attr-switch）/「清选中？」（attr-switch）/「清 community cache？」（user-reload）/「失败兜底渲染？」（mount-hydrate）。四入口瘦成一行调用 + 决策表一行；新增重载场景 = 加一个 reason 枚举，不再写新链。`_load` 本体不变（ADR-230 口径 + tree:reload 行为变更只改 `_load` 的既有不变量保留，决策表只是把「谁在 `_load` 前后做什么」收进单点）。
② **条目突变单一出口 `TreeState.markEntriesMutated()`**：6 个原地写 `entry.banned` 的调用点（及未来新增）在写完条目后调它（bump buildRev + 目录级联失效由它统一做）；`markEntriesMutated` 内 `debug` 模式断言「有突变必有调用」（由 render 快路径命中日志对账），结构上杜绝漏调。
③ **边界与执行序**：本 ADR 是设计拍板；实施在**并行会话在途树工作（buildCache/目录回收/选中剪枝批）收口后**开工——① 只动 index.ts/bus-handlers.ts 的调用点，② 依赖他们 land 的 `invalidateBuildCache` 机制（骨架只调它导出的单点，不重构 render.ts）。

## 3. 后果（Consequences）

- 正面：重载语义变更面从 4 条链 + N 段注释收敛为 1 张决策表（可单测：reason × 决策矩阵逐格断言）；突变漏调从「注释纪律」升级为「结构不可能」（漏调 → debug 断言红 + 快路径行为错位有回归锁）。
- 负面/已知遗留：reason 枚举新增 = 枚举 + 决策表两处（仍有两处面，但都是数据不是代码链）；`_reload` 参数化后调用栈多一层（微秒级，无感知）；② 依赖 buildCache 机制先落地，D1 单独开工会踩在并行会话在途文件上——故执行序硬约束（§2③）。
- 回退：`_reload(reason)` 展开回四链、`markEntriesMutated` 退化为裸 `invalidateBuildCache` 调用（git revert 单提交可逆，行为零漂移——决策表语义 = 现行四条链语义的并集，无新行为引入）。

## 4. 数据溯源

- 平行实现病灶：app-tree.md 卡「reload 加载段收敛 vm._load()（第三处平行实现消除）」+ 止血 A2 提交（`53b142af8`）两处链注释「已知边界/第三处不跟改」的人肉同步实证
- 突变 6 调用点：app-tree.md 卡「乐观翻转原地改 entry.banned 必须 bump buildCache 修订号（P2 修复，审核 2026-10-15）」（events.ts 4 + bus-handlers.ts 2）
- 既有骨架资产：`tree-state.ts`（TreeState 容器 + loadFailed/advFilter 收编，23d8868f9 状态容器化）、`data.ts`（SelectState 纯函数）、`_guard`（ADR-230 唯一代际守卫出口）

<!-- 文件名: app-tree-d1.md → 实际文件 architecture/ADR-350-app-tree-d1.md（ADR-320 architecture 全量模板） -->
