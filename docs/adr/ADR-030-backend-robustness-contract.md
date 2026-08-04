# ADR-030：后端持久化与健壮性契约

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/`（Wails Binding 入口）、`go/types/config.go`（`AppConfig`）、`app.go`（`SaveAppConfig`/`LoadAppConfig`/`shutdown`/`WindowGetSize`）、`go/sync/sync.go`、`go/ysm/header.go`、`docs/Design.md`（前端字段命名）
- **被收口来源**：`docs/archive/postmortem/postmortem-20250605.md`、`settings-persistence-postmortem.md`、`postmortem-20250611.md`（Go 陷阱段）

---

## 1. 背景（Context）

多轮事故复盘（2026-06-05 晚间复盘、2026-06-12 设置页路径持久化、2026-06-11 导航重构）暴露出一批**跨切面的后端工程陷阱**：配置落点混乱、`[]byte`/CSV 编码误用、Wails 关闭期 nil panic、Go 零值语义歧义导致数据静默丢失、前后端字段名大小写不一致。这些并非单点 bug，而是**应在架构层固化为不可违背的契约**，否则每次都会以不同形态复发。

## 2. 决策（Decision）

确立以下**后端持久化与健壮性契约**，作为 Go 后端与前后端交互的强制基线：

### 2.1 配置持久化
- **落点唯一**：配置文件存于 `os.Executable()` 所在目录（注意 `wails dev` 与编译后目录不同，禁止假设为 CWD 或用户目录）。
- **格式强制 JSON**：凡涉及中文 / Emoji / 非 ASCII 的持久化（配置、日志、索引），**一律 JSON，禁止 CSV**（CSV+ANSI 编码会导致中文乱码、且无法表达嵌套）。日志/清单如需表格展示，在读取后渲染，不存为 CSV。
- **键名大小写契约**：Go 结构体字段（如 `MmdRoot`）经 JSON 序列化后为小写 `mmdRoot`；前端 `cfg["MmdRoot"]` 取大写键会得到 `undefined`。**前后端键名必须统一为 JSON 序列化后的小写形式**，禁止前端臆测 Go 字段原名。

### 2.2 Wails 生命周期防御
- **shutdown 防御式 recover**：`WindowGetSize()` 等 Wails runtime 方法在关闭阶段可能返回 nil（panic），调用点必须 `defer recover()` 或 nil 守卫；窗口尺寸保存一律在 Go 端 shutdown 时读取，前端 `resize` handler 不可靠（内容区 `innerWidth` ≠ 外层窗口尺寸）。

### 2.3 跨语言数据
- **Windows 路径即毒药**：任何传给网络 API（fetch / GitHub / jsDelivr）的路径必须 `\` → `/` 规范化，否则 URL 拼出生效 404。
- **网络请求必须超时**：所有 `fetch` 加 `AbortController` 超时（历史用 6s），无索引/无响应时按钮必须回到可用态（⏳→❌），禁止永久卡死。

### 2.4 Go 类型零值语义审计（防静默数据丢失）
- **三态字段用指针 / 标志位**：`bool` 零值 `false` 无法区分「明确为 false」与「未设置」（如 `<free>` 标签缺失被误判为付费）。三态字段改用 `*bool` 或额外 `HasXxx bool` 标志位，仅当明确检测到时置位。
- **`map[K]V` 去重会静默覆盖**：业务逻辑需保留所有同 key 条目时（如按 SHA256 哈希聚合的同步状态），必须用 `map[K][]V`，禁止 `map[K]V` 后赋值覆盖。
- **`nil` slice 序列化为 `null`**：Go `nil` slice → JSON `null`，前端 `for...of` 对 `null` 崩溃。导出前 `make([]T, 0)` 保证 `[]`；前端消费处统一 `x || []` 兜底。

### 2.5 正则限制
- **Go RE2 不支持负向前瞻**（`(?!`、`(?<=`）。涉及 lookahead 的匹配必须用辅助函数或拆分逻辑实现，禁止直接写 PCRE 风格正则。

## 3. 后果（Consequences）

**正面**
- 将反复出现的「配置丢失 / 中文乱码 / 关闭 panic / 数据静默覆盖」收敛为可审查的硬契约，新代码有基线可依。
- 与 **ADR-005（前端治理规则）** 形成前后端呼应：ADR-005 管前端（含 `public/` 禁放 JS、事件注册守卫），本 ADR 管 Go 后端与跨语言边界。

**负面 / 已知遗留**
- 既有代码中存在非 JSON 持久化 / 大写键名臆测等历史债，需逐处巡检对齐（属渐进偿还，非本 ADR 阻断项）。
- 契约靠 review 与 `CLEANUP_RULES.md` 红线守护，尚未全部固化为编译期 lint（未来可纳入 `type-consistency` / 自定义静态检查）。

**与其他 ADR 关系**
- 前端侧同类纪律（public/ 陷阱、事件名精确匹配、按钮状态机）见 **ADR-005**；本 ADR 是其 Go 后端镜像，不重复前端条款。
- 自更新替换策略（os.Rename 原子替换）属发布流程，已由 **ADR-017** F-2 收口，不在本 ADR 范围。

## 4. 数据溯源

| 来源（postmortem） | 贡献的契约条款 | 落点 |
| --- | --- | --- |
| `postmortem-20250605.md`（关键教训） | 配置落点 `os.Executable`、前端尺寸不可靠、shutdown 防御、fetch 超时、Windows 路径规范化、RE2 限制、CSV→JSON、shutdown recover | §2.1、§2.2、§2.3、§2.5 |
| `settings-persistence-postmortem.md` | 前后端键名大小写一致性（`MmdRoot` vs `mmdRoot`）、资源库页漏读自定义路径、Tab 切换重载 | §2.1 |
| `postmortem-20250611.md`（Go 三态陷阱段） | `bool` 零值三态、`map[K]V` 静默覆盖、`nil` slice→`null`、流式读取终止条件 | §2.4 |

> 原始逐轮排查链路（症状→根因→修复）保留于上述 archive 文件的历史版本（git），本 ADR 仅收口其**工程契约内核**。
