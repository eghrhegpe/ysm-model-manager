# 模型仓库功能锐评（2026-10-13）

> **活指针**：本文是 2026-10-13 对「📚 模型仓库」页的一次性锐评快照。结论全部锚定当时的源码树（HEAD ≈ `40a742dfb` / `88ff9c1ed`，工作区含并行会话改动）。**落地现状以源码与 `docs/knowledge/app-tree.md`、`app-content.md` 为准**——本仓的既定元规则：ADR、注释、知识卡里的「已修」都只是写下时的历史快照。
>
> **范围**：`views/app-tree/**`（仓库树交互）、`views/app-content/**` + `views/app-nav/**`（仓库页骨架 / tab / rtype 切换 / 工具栏）、`features/dnd/**`（拖拽）、`internal/app` + `go/fileops`（删除与路径守卫）。
>
> **方法**：三路分区只读审计 + 主模型逐条亲验复核。**两路子代理的头号指控被主模型证伪并驳回**（见 §四），这正是本轮方法的价值所在。

---

## 一、总判

**这是一套治理密度远高于平均水平的功能，骨架工程质量扎实，但产品心智模型欠收口。**

加分项是实打实的，不是客套：

- **类型判定单一事实源**守得很干净。`resource_types.json` + `go/types/registry` + 前端 `utils/resource/schema.ts` 同步视图三端派生，15 个类型的 group / storageSubDir 路由（`GroupStorageRoot`）无一处手抄，仓库页没有任何一处在前端重算归属语义。
- **路径安全是纵深防御而非单点**。`DeleteModelFile` 对 `ysm.json` 与普通文件走**两条独立**的 root 包含守卫（`fileops.go:533-552` / `:557-570`），目录型资源另走 `EvalSymlinks` 解析后的严格比对（`resource_bindings.go:386-399`）——这套防线经得起审计。
- **代际守卫已收成单一原语**。`createLoadGuard` 全仓唯一出口，`disconnectedCallback` 里 `_guard.invalidate()` 也接上了（`app-tree/index.ts:465`），注释还写明了「同型先例 app-sidebar 曾漏接」。这是被真实事故教育过的代码，不是运气。
- 缓存失效链（`ClearScanCache` → `_load`）、乐观更新 + 回滚 + 代际双守卫（ADR-336 落地批）都是完整范式，不是半成品。

扣分集中在**同一个模式**上：**类型切换（rtype）作为全局状态，没有一个单一的心智模型宿主**。选择器在可折叠导航里、页面侧无指示、切 tab 不跟随也不重置——三处各自合理，合起来是一个用户需要自己拼出来的模型。再叠加几处「注释描述的目标态跑在实现前面」的落差（§三）。

**健康度：3.8 / 5**（前端交互面 3.5，产品信息架构 4.0，Go 侧数据安全 4.5）

---

## 二、成立的问题（已亲验）

### P0-1 ｜ 树内拖拽移动与拖拽导入在 `document` 层双监听，每次移动都误弹「未检测到支持文件」

**症状**：用户在树内把文件拖到文件夹完成移动（ADR-336 刚落地的功能），每次都伴随一个提示性 toast「📂 未检测到支持文件（.ysm .zip …）」，且与「移动成功」toast 同时出现。用户会以为移动失败了。

**证据**：两个 `drop` 监听器都注册在 `document` 上：
- `features/dnd/move-dnd.ts:252` — `document.addEventListener("drop", onDrop)`
- `features/dnd/import-dnd.ts:226` — `document.addEventListener("drop", onDrop)`

`move-dnd` 的三个 handler 全部有 MIME 早退（`types.includes(TREE_MOVE_MIME)`，`:202/:218/:229`），**分流是完备的**。但 `import-dnd` 的 `onDrop`（`:208-222`）**没有对应的 MIME 早退**——只有 `isInTree(e)` 判定，随后直接 `handleTreeDrop`。

`handleTreeDrop` 在收集到 0 个文件时无条件提示（`import-dnd.ts:72-76`）：
```ts
if (collected0.length === 0) {
  logDrop("drop: 收集 0 文件（webkitGetAsEntry fallback 也空）");
  toast(`📂 ${t("import.noSupportedFiles")}（${DROP_EXTS_STR}）`, TOAST_MS.normal, "info");
  return;
}
```
纯应用内拖拽的 `dataTransfer` 不携带任何文件，必走此分支。

**机理**：`addEventListener` 不阻止同一事件的其它监听器执行。`preventDefault()` 也只影响默认动作。所以「移动成功」与「未检测到支持文件」必然成对出现。

**这是 2026-10-13 当天刚落地功能的回归**——ADR-336 的双通道分流设计是对的（`TREE_MOVE_MIME` vs `Files`），只是**只在一侧实现了判据**。

**修法**：给 `import-dnd` 的 `onDrop` 补一条同款早退，照 `move-dnd.ts:28-32` 的 `isTreeMoveDrag(types)` 同款判据。两处判据必须同源（建议共用该函数），别只改一处。

**附带收益**：`logDrop` 每次会经 `dndGetApp().AddOpLog` 往环形日志写一条「收集 0 文件」，移动操作越多，日志面板被这类噪声填得越快。修完这一并消失。

---

### P1-1 ｜ 切换资源类型不清选中态，底部计数与新树对不上

**症状**：在 YSM 页选中 3 个模型 → 切到「整合包」/「光影包」等另一类型 → 底部仍显示「已选 3 个文件」，但新树里 **0 行高亮**。此时按 Delete，弹窗写的是「确认删除 3 个文件？」，而这 3 条路径是**上一个类型**的文件。

**证据**：
- 切类型走 `attributeChangedCallback` → `_attrChangeReloadAsync`（`app-tree/index.ts:423-455`），全链只更新 `rootAttr` + `_load()` + `_renderTree()`，**无 `selectState` 清空**。
- `_load()`（`:494-517`）只写 `entries` / `filesRoot` / `loadFailed`，同样不清选中态。
- `_onKeyDelete`（`:645`）读 `this.selectState.keys` → 旧路径；`:666` 读 `this._state.rootAttr` → **新类型**，两者拼在一起发给后端。
- 树内移动链是**有**清空纪律的（`:773-776`，注释明写「防对已不存在路径批量误删」）——说明这个意识存在，只是切类型这条路径漏了。

**为什么定为 P1 而不是 P0**（我逐层验过，这是本轮最值得说的一次降级）：

`DeleteResourcePack(path, rtype)`（`resource_bindings.go:374`）拿**新类型的仓库根**去校验**旧类型的路径**，两道守卫都会拦：
- 目录型（`:396-399`）：`filepath.Rel(realRoot, realClean)` 得 `..` 前缀 → `ErrInvalidPath`
- 文件型：`DeleteModelFile(filesRoot, path)`（`fileops.go:557-570`）同样 `rel == ".." || HasPrefix(rel, ".."+sep)` → 「拒绝删除仓库外路径」

且 15 个类型的存储根**两两互不相同**（`resourcepack/resourcepacks`、`mmd/PMX`、`mmd/SceneModel`… 实测 `resource_types.json` 的 group+storageSubDir 组合无一同名兄弟），所以不存在「两个类型共用一根导致守卫失效」。

**结论**：数据**删不掉**，用户看到的是「确认删除 3 个文件？」→ 执行失败 → 一串错误 toast。**是状态不一致 + 虚假危险确认框，不是数据丢失。** 但删除类操作给出与事实不符的确认文案，本身就该修。

**修法**：`_load()` 成功路径清 `selectState`（或 `_attrChangeReloadAsync` 里清），复用 `:774-776` 现成三行。

---

### P1-2 ｜ 三个随类型联动的面板里，只有回收站不做「隐藏时不干活」

**症状**：停在「文件树」tab 切资源类型，切到「回收站」看到的不是自己触发的那次结果；若那次请求失败，错误写进了用户根本没看的面板。

**证据**：三个同族面板两种行为——
- 去重 `init-pages.ts:177-183`：`if (container.hidden) { dirty = true; return; } doDedup();` + `onShow` 补扫
- 资历最深 `oldest-models.ts:163-174`：同款守卫
- 回收站 `features/maintenance/recycle-bin.ts:317-319`：
  ```ts
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() =>
    shell.loadRecycleBin(),
  );
  ```
  **无 `container.hidden` 守卫、无 dirty、无 onShow**（全文 grep `hidden` 只命中 `onShowToast` 变量名）。且 `init-pages.ts:154` 返回裸函数 → `tabs-runtime.ts:121-124` 不会落 `showFns`。

**机理**：回收站在隐藏时仍发两次 IPC 并 `list.innerHTML=...`（`:284`）、绑 `setupRecycleActions`（`:286`），`guard` 世代被占用。同一操作因 tab 先后顺序不同呈现两种心智模型。

**修法**：`recycle-bin.ts:317-319` 补同款守卫，`initRecycleTab` 返回 `{ cleanup, onShow }`。三行改动，三个 tab 统一。

---

### P1-3 ｜ 资源类型选择器整条 i18n 链走硬编码中文，而配套 i18n 键就在旁边没人用

**症状**：英文/日文界面下，导航的资源大类 + 资源类型两个下拉全部显示中文（「Minecraft 原版」「角色模型」「自定义表情」…），而同一组件的 logo 正确显示「MMD Manager」。

**证据**：`views/app-nav/index.ts:92`、`:99` 直接消费原始 label：
```ts
label: `${meta.icon} ${meta.name}`   // meta.name 源自 resource_types.json 的 name 字段（15 项全中文）
label: o.label                       // types.ts:163 RESOURCE_TYPE_LABELS，同源全中文
```
未过 `t()`。与此同时 `utils/resource/short-label.ts:21-25` 已备齐 `rtype.pack/shader/blueprint/litematic/maid` 五键（三语言包齐备），且 `app-nav/index.ts:231,238` 的 logo **正在用** `shortLabelOf`——同一组件内两套口径并存，选择器那套绕过了已有的 i18n 体系。

**2/3 语言下主控件不可读**，且这是仓内硬编码中文未走 `t()` 的硬红线。子代理另发现同文件 3D FAB 失败 toast（`:146-151` `toast("打开 3D 失败", ...)`）同样漏网，并指出 i18n 第五闸有盲区——`scripts/i18n-ui-check.ts` 的判据只匹配 `value:/text:/tooltip:` 与 `throw/reject`，**`toast()` 不在任一通道内**，实跑 631 文件全绿。这是**门禁覆盖缺口**，比单个漏网更值得记。

---

### P2 若干

- **`repo_subdir` 整条通道是死链**（跨 6 文件）：唯一生产者 `utils/resource/types.ts:165` 字面量恒 `""`，下游 `init-pages.ts:130` 恒 `removeAttribute("subdir")`、`loader.ts:72` 的 `subdir || rtype` 分支恒假、`app-sync-manager` 订阅体恒早退。两路子代理独立报出同一条，说明它确实扎眼。⚠️ 但知识卡 `app-tree.md:163` 已记有 2026-10-13 的裁定：**不删，留 ADR 立项**——理由是跨语言签名 + 存量 localStorage + 契约恢复预期三重牵连。**本轮沿用该裁定，不重复提案。**
- **`content-tab` 是退化 testid**：4 个 tab 共用（`tpl.ts:96/106/114/122`），正向消费者为零，现存 e2e 全走 `.repo-tab[data-tab=...]`。契约测试只校验「声明了就有字面量」，4 份同名照样绿。
- **去重结果区缺「未扫描」空闲态**：`tpl-dedup.ts:28` 首屏整块留白，与「扫描完成无重复」不可区分（同分区回收站/资历最深三态齐备）。
- **`.recy-page` 声明逐字重复**：`css/content-util.ts:4` 与 `tpl-recycle.ts:14` 内联 style 五条声明逐字节一致，样式表那份恒被压制（内联优先级），改 CSS 无视觉变化。
- **语言热切换把用户弹回第一个 tab**：`lang:changed` → `clearPanels()` → `_render()` → `renderTabs` 按位置写 `${i === 0 ? " active" : ""}`，无 tab 态持久化。对照 `site/workshop-tabs.ts:117` 已有 `safeGet(WS_LAST_TAB_KEY)` 范式。

---

## 三、一条值得单独立账的元观察

三路子代理里，有**两条独立发现了同一个 bug**（`repo_subdir` 死链），且各自的注释都与实现矛盾：

- `tabs-runtime.ts:36-39` 明写「真值源 = 按钮自身 data-tab，**不接受第二份手工真值**」——但 `tabs-shell.ts:124-131` 与 `tabs-runtime.ts:83-86` 确实各算了一遍「谁可见」，且下标口径不同（过滤前 vs 过滤后）。
- `init-pages.ts:164-165` 注释称「快速连切被 busy 拦截的扫描由下次激活兜底」——但 `onShow` 首行 `if (!dirty) return`，而 `dirty` 只在隐藏分支置位，**该兜底不存在**；`dedup.ts:296-302` 的 `if (state.busy) return;` 静默丢弃、不排队不记脏账。结果是切类型后去重面板可能定格在上一次类型的重复项上。

这正是 AGENTS.md「元规则」警告的病症在本区的具体形态：**治理动作（ADR 编号、注释、单测）跑在实现前面，注释描述的目标态与源码实际态存在稳定落差。** 本仓 `check-knowledge-drift` 只验 frontmatter 符号存在性、看不见正文断言，这类落差没有任何机器闸。

---

## 四、被驳回的两条子代理指控（复核记录）

复核不是形式。本轮**两条最高级别的指控都是我亲自回源码证伪的**，若照单全收会浪费一轮修复。

### ❌ 驳回：「tab 面板用 `hidden` 属性而 `.tab-body{display:flex}` 覆盖它 ⇒ 隐藏面板实际可见」（被判 P0）

**证伪**：`tabs-runtime.ts` 两处写属性**始终成对**——`:84-85` 隐藏时 `style.display = "none"` + `setAttribute("hidden","")`；`:96-97` 激活时 `style.display = ""` + `removeAttribute("hidden")`；`:99-100` 恢复隐藏同样成对。内联 `display` 优先级高于任何样式表规则，`.tab-body{display:flex}` 根本赢不了它。

子代理的推理链断在「两者会反向」这个假设上——而代码里它们不可能反向。真值虽有**两份**（这条 P1 部分成立，见 §三），但**两份当前是自洽的**。

**代价**：若采信，会去「修」一个不存在的显示 bug，可能反而把一对自洽的写入改成真正的分叉。**这类越权修复比漏修更贵。**

### ❌ 驳回：「切类型不清选中态 ⇒ 按 Delete 跨类型误删，属 P0 数据丢失」

我最初读到这条时也认为是 P0。**逐层验完 Go 侧后降为 P1**：两道 root 包含守卫都会拦（§二 P1-1 已列证据），且 15 个类型存储根两两互异，不存在守卫失效的组合。

**教训**：「前端给了错参数」不等于「后端会照做」。**跨语言边界的破坏性操作，必须验到 Go 侧实写才算定级。**

---

## 五、最值得修的 3 件事

| # | 事项 | 理由 |
|---|---|---|
| 1 | **P0-1**：`import-dnd` 的 `onDrop` 补 MIME 早退，判据与 `move-dnd` 共用同源函数 | 今天的回归，用户可见；改动小；连带清掉日志噪声 |
| 2 | **P1-1 + P1-2**：`_load()` 补清选中态；回收站补 `container.hidden` 守卫 + `onShow` | 两条都是「复用已有现成范式」，无设计决策成本 |
| 3 | **P1-3**：选择器 label 改走 `shortLabelOf`；顺带把 `toast()` 纳入 i18n 门禁判据 | 修 2/3 语言下的主控件；门禁补盲区比单点修复更值 |

**不建议现在动的**：`repo_subdir` 死链——已有 2026-10-13 裁定（留 ADR 立项），本轮不重复提案。