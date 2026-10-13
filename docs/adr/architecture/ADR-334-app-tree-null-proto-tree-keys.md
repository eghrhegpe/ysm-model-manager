# ADR-334：app-tree 建树/展开态改 null 原型与 hasOwn 判存在（消除原型链吞键）

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-13
- **拍板**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：键来自磁盘目录名，与 Object.prototype 继承键同名即污染全局并静默吞掉整棵子树；修复面跨前端两个模块且改的是数据结构基底
- **相关**：`frontend/src/views/app-tree/render.ts|buildTree`、`frontend/src/views/app-tree/render.ts|flattenVisible`、`frontend/src/views/app-tree/index.ts|toggleDir`、`frontend/src/views/app-tree/index.ts|readScopedDirOpen`、`docs/knowledge/app-tree.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

这是 [ADR-333](./ADR-333-instance-nesttree-selfkey-namespace.md)（Go 侧 `nestDirLevelTree` 防御键与真实段名碰撞）的**前端同构复刻**，且后果更重。

`render.ts|buildTree` 用**普通对象**逐段建树，键直接取自磁盘路径段（`entry.path.split("/")`，全程无净化）：

```ts
if (!current[p] || current[p]._e) current[p] = {};   // 建中间目录
current[fileName] = { _e: entry };                     // 建叶子
```

当磁盘上存在名为 `__proto__` 的目录或文件时：

- `current["__proto__"]` 沿原型链读到继承的 `Object.prototype`（truthy）→ `if` 判定成立，`= {}` 走**原型 setter**，整棵子树被写进全局 `Object.prototype`
- `Object.keys(root)` 恒不含该目录 → **该目录及其全部子树在 UI 完全不显示**
- 任意新对象 `{}` 都能读到被污染的子树数据（**全进程级**）

**实测证据**（node 复刻 `buildTree` 逻辑，ADR 落地前）：

```
输入：__proto__/a.ysm、__proto__/deep/nested/b.ysm、models/ok.ysm
1) root own keys:             [ 'models' ]         ← __proto__ 子树整体丢失
2) Object.prototype own keys: [ 'a.ysm', 'deep' ]  ← 全局污染
5) ({}).deep 内容: {"nested":{"b.ysm":{...}}}      ← 泄漏到全应用每个对象
```

**次生缺陷**（同源不同表现）：`index.ts|toggleDir` 与 `render.ts|flattenVisible` 用 `dirOpen[dir]` 读展开态，键同样是磁盘目录名。目录名 `__proto__` 时读到 `Object.prototype`（truthy）→ 取反恒 false → **该目录永不可折叠**。实测 `constructor` / `toString` 等读出 function，取反正常，**仅 `__proto__` 卡死**。

## 2. 决策（Decision）

### 2.1 建树：null 原型对象（治本）

`buildTree` 的**所有建节点处**（root + 每个中间目录）改用 `Object.create(null)`。null 原型下 `__proto__` / `constructor` / `toString` 退化为**普通字符串键**，不可能再命中原型链。

遍历侧语义**不变**：全仓树遍历统一走 `Object.keys(node)` + 显式 `_e` 过滤（`treeChildKeys` / `sortedChildKeys` / `dirFlagsOf` / `annotateDirNodes`），`Object.keys` 在 null 原型下行为与普通对象一致。

叶子节点 `{ _e: entry }` **保持普通对象**：它只承载条目、不再作为容器被下钻，无命中面（实测 null 原型容器上 `c["__proto__"] = {...}` 走 own key，无污染）。

### 2.2 展开态读侧：`Object.hasOwn` 判存在性

`toggleDir` 与 `flattenVisible` 改 `Object.hasOwn(dirOpen, key) ? dirOpen[key] === true : false`——不再把「原型链上继承到的东西」当 own 键。

`readScopedDirOpen` 返回 `Object.assign(Object.create(null), stored[rtype] || {})`：localStorage 反序列化出的对象可能含 `__proto__` own 键，展开副本既避免读侧命中原型，也不污染调用方的 `stored` 对象。

**口径先例**：仓内同病同修法见 `utils/icon/workshop-icons.ts`（`Object.hasOwn(SITE_ICON_MAP, siteId)`），本次直接对齐。

## 3. 后果（Consequences）

### 3.1 正面

- `__proto__` / `constructor` / `toString` 等目录与文件在树上正常显示，子树完整
- 全局 `Object.prototype` 不再被写入；`{}` 不再凭空多出属性
- 同名目录可正常展开/折叠

### 3.2 负面 / 已知遗留

- `Object.create(null)` 对象**没有 `hasOwnProperty` / `toString` 方法**，代码里若对其直接调这些方法会 `TypeError`。本次已核全仓树遍历只用 `Object.keys`，未触此面；**将来若有代码对 `TreeNode` 直接调 `node.hasOwnProperty(...)`，须改 `Object.hasOwn(node, ...)`**
- 本 ADR 只治 `app-tree`。同形态的 `Map` 容器（`preview-3d/bone/*` 用骨骼 id 作键）本就无原型链命中面，无需改

### 3.3 方法论沉淀

本缺陷是 ADR-333 同构扫描的产出，而**首轮由 AI 主代理做的扫描漏掉了它**——判据写成「grep 键被回写进输出的显式字段赋值」（`Name: k` / `Path: k`），而 `buildTree` 用的是 `current[fileName] = {...}` **简写形式**，不在判据内。子代理改用「逐个 `map[string]` / `Record` 读其键来源并论证是否回写输出」才捞到。

**教训**：审计「键冲突」类缺陷应搜**数据流边**（键 → 是否成为输出 / 参与查找），而非键的声明点或赋值形态。已并入 `skills/pitfalls.md` #27。

## 4. 数据溯源

- 来源：ADR-333 同构扫描（子代理只读扫描 + 主代理实证复核）→ 发现前端同构实例 → 拍板（用户「可以，顺带看看有没有其他改进项」）
- 实证：node 复刻 `buildTree` 逻辑确认全局污染 + 子树丢失；变异验证（退回 `{}`）确认 4 条新用例全红
- 回归锁（`frontend/src/views/app-tree/render.test.ts`「buildTree 键与 Object.prototype 同名」4 例）：
  - `__proto__` 目录及其子树可见 + 无污染
  - 名为 `__proto__` 的**文件**（叶子位）同样安全
  - `constructor` / `toString` / `hasOwnProperty` 目录照常建树
  - 空 `dirOpen` 下 `__proto__` 目录不被恒判为已展开
- **测试自身的坑（已记入测试注释）**：构造含 `__proto__` 键的输入必须用 `Object.fromEntries`；对象字面量 `{ __proto__: true }` 设置的是**原型**而非 own key，测的就不是产品行为了