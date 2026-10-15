# ADR-349：配置写入原子化：Go 侧 patch 绑定替代前端读-改-写

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：写入面形态与跨语言契约变更（新增 Wails 绑定 + 前端全部调用链改写 + 旧绑定退役路径），影响面跨 Go/前端/web 适配器/测试四方且难逆转（绑定一旦被前端消费即成既有契约）
- **相关**：`internal/app/app_config.go|SaveAppConfigPatch, go/types/config.go|AppConfigPatch, frontend/src/views/config-write.ts|writeAppConfig, tests/test_config_write_single_exit.ts, internal/app/app.go|configWriteMu`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

设置页的「部分更新（patch）」语义，此前由**前端两次 IPC** 拼出来：

```ts
const latest = await LoadAppConfig();                    // ① 读快照（IPC #1）
const resolved = { ...latest, ...只覆盖 patch 字段 };     // ② JS 侧拼完整六元组
await SaveAppConfig(resolved.filesRoot, ..., resolved.theme); // ③ 写（IPC #2）
```

两个 `await` 之间让出事件循环。这个窗口里若另一写入面改动了某字段（`SaveThresholds`
写日志阈值、`SetDownloadMirror` 写镜像源、`SetResourceRoot` 写自定义根、**或另一处
`writeAppConfig`**），该字段不在本次快照里，而本次调用把**整份六元组**落盘——那次改动
被静默冲掉。用户表现为「刚改的设置重启后又变回旧值」，且全程无报错。

复现路径真实可达且不罕见：设置页连点两次主题（两次 `writeAppConfig` 互不 await），
同时侧栏的启动器自动检测完成并写 `mcRoot`——后完成的检测用改 mcRoot 前的快照落盘，
把主题冲回旧值。

**为什么 ADR-313 的「实参点单点化」没治好它**：那次收口把六个同型 string 的位置实参
收进唯一出口 `writeAppConfig`，消灭的是「手抄配方漂移」，但单点本身就是「读一次 + 写
两次」——收口让这个模式更集中、更可靠地执行，没有消除它内部的 TOCTOU。

**已有的部分止血**：Go 侧 `configWriteMu`（锐评 2026-10-15 P2）已把 Go 内部的
「Load→modify→save」串行化，并把锁范围明确为**整个事务**而非 `saveConfig` 本身。
但它管不到锁**外**发生的读——前端的预读正在锁外。锁只能管锁内。

## 2. 决策（Decision）

**把整段读-改-写搬进 Go 侧一次绑定调用：`SaveAppConfigPatch(patch types.AppConfigPatch)`。**

### 载荷：`AppConfigPatch`，全字段 `*string`，nil = 未传

```go
type AppConfigPatch struct {
    FilesRoot *string `json:"filesRoot,omitempty"`
    McRoot    *string `json:"mcRoot,omitempty"`
    LinkMode  *string `json:"linkMode,omitempty"`
    Theme     *string `json:"theme,omitempty"`
    ThemeAuto *string `json:"themeAuto,omitempty"`
}
```

- **为何 `*string` 而非 `string`**：本仓既有 patch 入口（`SaveAppConfig` 的 `orDefault`、
  `SanitizeLinkMode`）用「空串 = 未传」编码未设置，但空串与「用户把字段显式清空」
  不可区分。配置字段全是 string，无 `bool` 三态陷阱之外的先例可循；指针是 Go 表达
  「未设置 vs 空值」的无歧义手段。生成的前端绑定形如 `?: string | null`（`undefined`
  与 `null` 都映射为 Go nil），与 nil 契约一一对应。
- **键集刻意不含 `rpRoot`**：它是 `SaveAppConfig` 的废弃入参（Go 侧从不被读取，
  `CustomRoots` 才是资源类型路径的真载体）。新绑定不复制这个历史包袱。

### 语义：锁内重读 → 只改非 nil 字段 → 落盘

沿用 `SaveAppConfig` 的全部校验与副作用口径（`ValidateMinecraftDir` / `SanitizeLinkMode`
/ `SyncLinkMode` / watcher 重建 / `clearDeprecatedFields`），差别只在**改哪些字段**由
patch 决定、**快照在锁内取**。

### 前端：`writeAppConfig` 降为薄透传

`views/config-write.ts` 不再读盘、不再补缺省、不再拼六元组，只把 patch 原样交给绑定。
未传字段的「取当前落盘值」由 Go 侧在锁内决定。

### web 适配器：`SaveAppConfigPatch` 用 `??` 承接 nil 契约

`web-store.ts` 新增同名实现：`patch?.x ?? prev.x`。⚠️ 与旧 `SaveAppConfig` web 实现的
空串语义**有意不同**——位置实参版「空串 = 未传」（`||` 兜底），patch 版「空串 = 真清空」
（`??` 只在 null/undefined 回落）。两套入口两套语义，改一个别动另一个。

### 旧绑定 `SaveAppConfig` 保留不删

Go 侧、Web 适配器、既有 Go 测试仍用它。退役是独立的清理动作（需先确认无生产消费方），
不夹带在本次原子化里。

## 3. 后果（Consequences）

### 正面

- **TOCTOU 窗口从「两次 IPC 之间的任意长事件循环」收窄为「不存在」**：读盘在锁内，
  与其它写面天然串行（`TestSaveAppConfigPatch_ConcurrentNoFieldLoss` 以 `-race` 验证
  跨入口并发无字段丢失）。
- **前端值域校验与缺省职责归位 Go 侧**：不再有「前端以为的现值」这种可能陈旧的数据源。
- **位置实参的形态病根被结构消灭**：非法主题字面量（历史 `"dark"`）在 patch 形态下
  **无处可写**——`launcher-detect.test.ts` 的回归锁因此从「断言值不等于 dark」升级为
  「断言 theme 键压根不在 patch 里」。
- **IPC 减半**：设置页每次保存从 2 次降为 1 次。

### 负面 / 代价

- **新增绑定带来三道立刻触发的守卫**：CI 绑定产物保鲜（`git diff --exit-code` 必红）、
  e2e mock 双向类型契约（不补 `MOCK_DATA` 键则两处 `tsc` 失败）、arity 对账。
  全部已在本 PR 内处理。
- **既有测试需改形**：`config-write.test.ts` 的旧断言锁的是「前端拼完整六元组」这套
  实现细节，随该逻辑下沉而失效——整批重写为新契约（透传 + 不预读 + 单次调用）。
  ⚠️ 这是本次最需要警惕的假绿来源：改绑定名时若只改 mock 不改断言，测试照样「绿」而
  落盘其实失败了（`theme.test.ts` 就有一处这样的历史假绿，已顺手修掉）。
- **`binding-check` 对结构体入参零守卫**：其类型比对对非标量参数直接跳过，patch 内部
  字段增删只有运行时暴露。

### 已知遗留

- 旧绑定 `SaveAppConfig` 的退役（Go + web 侧一并清理）未做。
- `configWriteMu` 的持有者清单是**注释枚举**（`internal/app/app.go`），本次已同步为 6 项，
  但注释天然会腐；`check-knowledge-drift` 看不见正文断言，只能靠人工。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 锐评 2026-10-15 P1 ③「前端 read-then-write 非原子」 | 本 ADR 的立项依据 |
| ADR-313 实参点单点化（第九轮） | 前身：消灭手抄配方，但未治 TOCTOU；本 ADR 保留其「唯一出口」结构 |
| 锐评 2026-10-15 P2 `configWriteMu` | 前身：Go 侧锁已到位，但读在锁外；本 ADR 把读移进锁 |
| `internal/app/app_config_concurrent_write_test.go` | 并发护栏范式（`-race` + 逐字段断言）被本 ADR 的并发用例沿用 |
| `go/AGENTS.md` bool 三态陷阱铁律 | `*string` 指针方案的取向依据（配置字段全 string，扩展到指针同理） |
| `internal/app/app_install_instance_test.go` 裸 `&App{}` 事故注释 | 本 ADR 测试夹具必须注入 `install` 的原因 |
