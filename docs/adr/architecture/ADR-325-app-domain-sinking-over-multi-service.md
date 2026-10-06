# ADR-325：App 瘦身走域下沉：拒绝 Wails 多 Service 外壳

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-10-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：注册边界不等于职责边界：拆 Service 不消除 93 处跨文件私有调用与 5 处跨簇状态，且会让 binding-check 静默失去契约覆盖
- **相关**：`internal/app/app.go:43 App 结构体；internal/app/app.go:173 ServiceStartup 编排；main.go:105 Services 注册；scripts/binding-check.ts:33-34 App/app.ts 硬编码；frontend/src/backend/app.ts:71 唯一动态 import；frontend/src/backend/types.ts:6 类型派生`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

2026-10-06 收到一份外部锐评，两条主张：**（一）治理层比业务层厚**；**（二）`internal/app` 的 `App` 是 236 导出方法的神对象，Wails v3 支持多 Service，拆成 6~8 个是纯机械改动，能让"谁负责什么"从注释变成文件边界**。

核实结论：**体量数据大半准确，"神对象"定性有误，"纯机械"判定为假**。逐项对账见 §4。

**真实病灶确实存在**（这才是本 ADR 要处理的对象）：

| 病灶 | 实测 |
|------|------|
| 厚方法 | 37 个方法体 >30 行（`ServiceStartup` 116、`startProxy` 102、`MergeWorkshopSitesFromJSON` 81） |
| 散落的惰性缓存 | 6 个 `sync.Once` + 5 个 `Mutex` 分散在域文件里，无收口 |
| 方法间耦合 | 273 处 `a.X(` 自调用：同文件 115 / 跨文件 158（57.9%）；其中**调用未导出私有方法 93 处（34%）** |
| 跨簇状态 | `a.app`（5 文件）、`install`（4）、`appCtx`/`logger`（各 3）；`a.LoadAppConfig()` 被全簇高频调用 |
| 装配接线占绑定面 | `SetApp` / `SetMainWindow` 出现在生成物 `export function` 中 |

**但"拆 Service"治不了其中任何一个**：

1. **注册边界 ≠ 职责边界**。方法挂在哪个 struct 上，不因注册为 Wails Service 而改变耦合；152 处跨域调用、93 处跨文件私有调用一处不少。`App` 的 44 个生产文件已经构成物理边界，`internal/app` 也已依赖 **33 个 `go/` 包**——**83.3%（40,585 / 48,743 行）的 Go 生产逻辑早就在 `go/` 子包里**，`internal/app` 只占 16.1%（7,851 行）。
2. **存在双向依赖环**：`install→resource` 18 且 `resource→install` 4；`model→scan` 9 且 `scan→model` 3；`install→config` 19。拆簇不能靠单向 DAG 切分，需专门的接口/回调设计（`app.go:119` 的「回调注入打破 DownloadQueue ↔ App 循环」已是先例，说明这类环要设计而非搬运）。
3. **启动编排不可机械分摊**：`ServiceStartup`（`app.go:173`）承担日志接管 → 配置加载 → 跨包钩子注入（`config.Set` / `scanner.SetErrorSink` / `instance`、`ysmsync` 失效钩子）→ 窗口位置恢复 → 存储目录创建 → 事件发射 → Plaza 预热 → watcher 启动，是一段**进程级横切编排**。Wails v3 保证多 Service 的 `ServiceStartup` **按注册顺序**正序调用、`ServiceShutdown` 逆序（`services.go:85-88`），拆开就必须重新定义启动顺序契约。
4. **治理层会"假绿"**：`scripts/binding-check.ts:33-34` 把绑定文件路径硬编码为 `internal/app/app.ts`，`:211` 的接收者正则只认 `*App`；`scripts/web-binding-check.ts:47` 同构。拆服务后 Go 侧集合与 JS 侧集合**同步缩小**，`missing_in_js` 不触发 → **静默失去迁移部分的契约覆盖，比报错更危险**（`binding-check` 是硬门禁，见 `scripts/_lib/gate-blocks/go-domain.ts:232-233`）。

锐评中**成立**的部分也记在此，避免后续误判：Wails v3 确实原生支持多 Service（`Options.Services []Service`）；前端成本确实低——但原因是仓内已收敛（`backend/app.ts:71` 唯一动态 import、`types.ts:6` 类型自动派生、164 处引用走单一 `backendGetApp()` seam），而非"改动本身机械"。

## 2. 决策（Decision）

**D1｜不采纳"拆成 6~8 个 Wails Service"**。绑定命名空间的收益不抵：152 处跨域调用 + 93 处跨文件私有调用 + 5 处跨簇状态的归属决议，叠加启动顺序契约重定义与治理层假绿风险。

**D2｜采纳"域下沉"作为 `App` 瘦身的唯一既定方向**：逻辑继续下沉到 `go/` 子包或域对象，`*App` 只保留**薄绑定转发 + 装配**。此方向沿用 ADR-134（缓存组件抽离）、ADR-179（install 域 manager）已验证的范式，`app_install.go` 仅剩 10 行注释壳即是该范式的现成样本。

**D3｜注册边界变更的准入条件（四条须同时满足，缺一不可；本 ADR 不授权任何单条豁免）**：

1. 前端必须保留**合并门面**（`getApp()` 返回聚合对象、`AppBindings` 用交集类型），使 138 处调用点（109 `backendGetApp()` + 29 `getApp()`，71 个文件）零改动；若走真命名空间，须另立 ADR 并计入 14 个测试 mock、`e2e/mock-data.ts:384` 双向键集断言、`backend/ysm-decode-bridge.ts:20` 第二收口点。
2. 先改造 `scripts/binding-check.ts` 与 `scripts/web-binding-check.ts` 的硬编码路径与 `*App` 接收者正则，并加**覆盖量断言**（防止集合同步缩小导致的假绿）。
3. 启动编排有明确归属与顺序契约（`ServiceStartup` 正序 / `ServiceShutdown` 逆序）。
4. 93 处跨文件私有调用与 5 处跨簇状态（`app` / config / `install` / `watcher` / `tags`）先有归属决议；注意 Go 的「导出即绑定」副作用——给跨簇 helper 升格为导出方法会把它推上前端绑定面。

**D4｜装配接线退出绑定面**：`SetApp` / `SetMainWindow` 是装配注入点，不应出现在前端 API 面（现已被生成；同类已有 `SERVER_INJECTED` 白名单先例，见 `scripts/binding-check.ts:38`）。此项独立实施，不依赖 D2。

## 3. 后果（Consequences）

**正面**

- 避免一次跨 Go / 前端 / 治理三层的大范围机械搬运，以及伴随的假绿风险。
- 收益聚焦真病灶（厚方法 + 散落 Once + 跨域调用），而非绑定命名空间这类表面收益。
- 与 ADR-134 / 179 同向，无需新范式；`App` 的物理边界（44 文件 / 20 域）继续作为演进单元。

**负面**

- `*App` 的方法数**短期不会下降**：薄转发方法仍占据绑定面（56 个 ≤3 行方法即为候选，但下沉后仍需一个转发壳）。
- 主动放弃"文件粒度 = 注册粒度"的一致性收益；多 Service 在 Wails 生态中的调试便利（`ServiceName` 日志）不使用。
- D2 收敛后若仍要动注册边界，代价不会变小（准入条件依旧成立）。

**已知遗留**（不在本 ADR 范围，另行处置）

- 37 个 >30 行厚方法的逐个收敛方案。
- 6 个 `sync.Once` / 5 个 `Mutex` 的缓存收口。
- 多 Service 在 **Android / iOS** 目标的额外约束未核实（本次仅读通用 / 桌面路径）。
- 治理层与业务层的体量比例（治理文本 94,281 行 / Go 生产 48,743 行 ≈ 1.93×）本身是否合理，未在本 ADR 讨论。

## 4. 数据溯源

来源（外部锐评的两条主张）→ 核实方法与结果：

| 来源主张 | 核实结果 | 判定 |
|---------|---------|------|
| Go 532 文件 / 109k；测试 329（62%） | 528 / 118,463；测试 329 / 69,493（62.3%） | 部分准确 |
| 前端 1040 / 209k；测试 = 生产 104% | 1055 / 229,890；测试 118,147 / 生产 111,743 = 105.7% | 部分准确 |
| scripts 113 / 34k | 顶层 103 / 34,515（递归含 `_attic` 180 / 50,746） | 口径 = 顶层，行数准确 |
| ADR 328 / 21.4k | 331 份（顶层 320）/ 顶层 31,223 行 | 行数低估 10k |
| 知识卡 199 / 24.8k，最大 1146 | 199 / 28,543；最大 `routes-quick.md` 1,179 行（**生成物**）、手写最大 `model3d.md` 1,138 | 数量准确 |
| 契约测试 123 / 20k；commits 5127 | 123 / 21,682；5,127 | 准确 |
| `App` 有 236 个**导出**方法 | 236 = 全部方法（含未导出）；导出 **178**、未导出 58；绑定生成物 **176** 个 `export function`（差额 2 = `ServiceStartup` / `ServiceShutdown`，被 Wails `internalServiceMethods` 名单排除） | **定性错误** |
| 7 `sync.Once` + 5 mutex | 6 个 Once 字段 + 5 个 Mutex 字段 | 基本准确 |
| 已长成 18 个 `app_*.go` 清晰边界 | 44 个生产文件 / 20 个域；导出方法最多的 `resource_bindings.go`（21 个）无 `app_` 前缀 | **低估** |
| 拆 6~8 Service 是纯机械改动 | 见 §1 四条；跨文件私有调用 93 处、跨簇状态 5 处、双向环 3 对、治理硬编码 2 个脚本 | **判定为假** |

实测命令（可复现，均为只读）：`Get-ChildItem` + `Get-Content` 行数统计（Go / 前端 / scripts / ADR / 知识卡 / 契约测试分区，测试文件按 `_test.go`、`*.test.ts` 切分）；`go env GOMODCACHE` 后读 `github.com/wailsapp/wails/v3@v3.0.0-beta.26` 的 `pkg/application/{options,services,bindings}.go` 与 `internal/generator/**`；正则统计 `^func \(a \*App\) [A-Z]`（178）与 `[a-z_]`（58）、`export function`（176）、`\ba\.([A-Za-z_]\w*)\(`（273~275，口径差 2）；`wails3 generate bindings --help`（`-i` = "Generate Typescript interfaces instead of classes"）。

关键 Wails 事实（供后续决策复用）：服务发现是 **`application.NewService` 调用点驱动**（全仓仅 `main.go:106` 一处），不写调用点就不生成绑定；生成文件名 = **结构体名小写**（`renderer.go:47-49`），包 `index.ts` 以结构体名为命名空间但**全仓零消费方**；运行期按**数值 ID**（`$Call.ByID`，176/176）寻址、与命名空间无关；硬约束「**同一类型只能注册一个服务实例**」（`bindings.go:145`）。

<!-- 文件名: app-domain-sinking-over-multi-service.md → 实际文件 architecture/ADR-325-app-domain-sinking-over-multi-service.md（ADR-320 architecture 全量模板） -->
