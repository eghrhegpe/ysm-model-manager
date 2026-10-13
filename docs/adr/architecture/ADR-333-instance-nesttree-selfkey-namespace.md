# ADR-333：同步树防御键 __self 改内部常量（消除与真实段名碰撞）

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-13
- **拍板**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：内部 map 键用段名字面量，与真实目录名存在数学可能碰撞；键名外显性契约需一次性钉死
- **相关**：`go/instance/instance_tree.go|selfLeafKey; go/instance/instance_tree.go|nestDirLevelTree; go/instance/instance_tree.go|treeChildren; docs/knowledge/go-instance.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`nestDirLevelTree` 把 dirLevel 扁平同步单元按相对路径段重建为嵌套展示树，`nestTreeNode.children` 是 `map[string]*nestTreeNode`，**key 直接就是磁盘路径段名**。树化过程有两处防御分支（`go/instance/instance_tree.go|nestDirLevelTree`），都用**段名字面量 `"__self"`** 作键。该键与**真实目录名**共享同一命名空间。

**分支 B（`go/instance/instance_tree.go|nestDirLevelTree`）是真病灶**：同段名既是叶子又已是**容器**时，叶子被写进 `existing.children["__self"]`。若该容器内部**已存在**名为 `__self` 的真实嵌套子夹（占用同一键），防御叶子即**覆盖真实子夹节点** → 静默丢失一整棵真实子树，无报错。

> 复现实证（变异验证）：构造 `global/__self/__self/keep.ysm` + 实例侧叶子 `inst/__self`，旧键下 `keep.ysm` 从输出树消失，残留仅 `map[__self:true]`。

**分支 A（`nxt.leaf != nil`）经实证确认在旧键下本就安全**，不在本 ADR 修复范围：叶子节点进入该分支时 `children` 必为 nil（叶子没有子节点），防御写入的键**不覆盖任何既有键**。触发条件（全局侧平铺模型夹 + 实例侧同级更深嵌套）在 `sync_dirlevel.go` 对模型夹 `SkipDir` 下极少发生。

**概率**极低（要目录恰好叫 `__self` 且内含同名嵌套子夹），但属数学可能，且后果是**静默数据丢失**而非报错。

## 2. 决策（Decision）

把防御键移出段名命名空间：定义包内常量 `selfLeafKey`，取值带 **NUL（`\x00`）前缀**。

```go
// selfLeafKey 是 nestDirLevelTree 两处防御分支的内部键。取 NUL 前缀：
// NUL 在路径/目录名中被操作系统禁止，真实段名数学上不可能等于它，
// 故防御节点与真实目录永不碰撞。键从不被外显（见 §3 键不外显契约）。
const selfLeafKey = "\x00__self_leaf"
```

两处写入统一改走常量。

### 2.1 为什么 NUL 前缀而非其他写法

候选方案与淘汰理由：

| 方案 | 结论 |
|---|---|
| **NUL（`\x00`）前缀** | ✅ **采纳**：文件系统与 Go 路径 API 均禁止 NUL 出现在路径中，碰撞在数学上不成立；无外部依赖 |
| 私有 unicode 私用区（`\uE000`）字符 | 淘汰：仅「约定」层面不碰撞（目录名可含任意非 NUL 字符），需额外约定；收益与 NUL 相同但证明力弱 |
| 侧写节点结构（`nestTreeNode` 增 `selfLeaf *ResourceSyncItem` 字段，children 只存真实段名） | 淘汰：语义最干净，但要求**所有**遍历点（`treeChildren`、`absorbSelfMarker` 及其上游）都改判，违反最小变更；当前两处写入均可原地替换 |
| 保留现状仅记录在案 | 淘汰：静默丢子树是数据正确性问题，非风格债 |

## 3. 后果（Consequences）

### 3.1 正面

- `__self` 命名冲突从「数学可能」降为「不可能」，防御分支退化为纯兜底而无需再顾虑撞名

### 3.2 关键前提：键不外显（本次决策的安全边界）

**`selfLeafKey` 永不成为输出段名**——安全性依赖 `treeChildren` 既有分支：`c.leaf != nil` 时输出 `*c.leaf`（叶子自身的 `Name`/`Path`），**键 `k` 只在容器分支参与 `joinRel` 拼路径**。防御节点恒为「只有 leaf、无 children」形态，故：

- 走 leaf 分支 → 键不出现在任何 `Name` / `Path` / `childRel` 中
- 即使将来防御节点带 children，键会以 `\x00` 出现在路径里而**必被前端视为无效**（而非静默错误路径）

故改键名**零外部契约影响**：不动 `types.ResourceSyncItem`、不动前端 `applyFilter`/`dirOpen`、不动绑定。

### 3.3 负面 / 已知遗留

- 无运行时性能影响（常数比较）
- 遗留：本 ADR 只治 `go/instance` 一处；`status_counts.go` 与面板链的混合夹重复行是**独立**问题（卡片已记形态变化会重新显形），不在本 ADR 范围

## 4. 数据溯源

- 来源：整合包前端/后端代码质量走查 → 知识卡 `go-instance.md` 已知限制节「`__self` 魔法段名边缘冲突」→ grep 复核源码树确认仍未治 → 拍板（用户「来吧 a」）
- 实施：`nestDirLevelTree` 两处写入统一改走常量 + 抽 `selfLeafKey`（含键不外显契约注释）
- 回归锁（`go/instance/instance_helpers_test.go`）：
  - `TestNestDirLevelTree_SelfKeyNoCollisionWithRealDir_LeafOverContainer` — 分支 B 行为锁：真实嵌套 `__self` 子夹的子树必须存活
  - `TestNestDirLevelTree_SelfKeyBranchA_UnaffectedByKeyChange` — 分支 A 记录锁（如实标注它本就不受影响）
  - `TestSelfLeafKey_UsesNulPrefix` — 契约锁：键必须以 NUL 前缀，防「改回段名字面量」
- **变异验证**（关键证据，非空转测试）：把 `selfLeafKey` 退回 `"__self"` 后跑上述用例 → 分支 B 行为锁与契约锁**双双变红**（`keep.ysm` 子树消失，残留 `map[__self:true]`）；分支 A 记录锁保持绿，与 §1 实证结论一致。恢复 `\x00__self_leaf` 后三例全绿

<!-- 文件名: instance-nesttree-selfkey-namespace.md → 实际文件 architecture/ADR-333-instance-nesttree-selfkey-namespace.md（ADR-320 architecture 全量模板） -->
