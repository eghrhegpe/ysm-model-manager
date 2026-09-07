# ADR-202：Go 测试执行结构收敛：registry 并发安全 + 锁协议注入 + 包内并行解锁（测试税减负 Go 版）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-07
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-191（testutil 迁址）、ADR-192（registry 拆分）、ADR-174（parity 对账基建）、docs/knowledge/test_tax_reduction.md（测试税三刀判据）、go/types/registry/resource.go、go/installer/installer.go、go/internal/testutil/、scripts/pre-push-gate.ts

---

## 1. 背景（Context）

2026-09-07 会话对 Go 端测试提交历史做全量体检（`git log -- '*_test.go'` 472 条，占 3396 总提交的 14%）：

- **串行执行**：272 个测试文件 / 58,921 行，**0 处 `t.Parallel()`**，全套串行。门禁实录 `go test -race ./go/... ./internal/app/ -timeout 60s` 全量 37.4s（test cache 恢复后才 <1s，pre-push-gate.ts 注释）。大包 internal/app（7508 行测试）、go/sync（4928）、go/ysm（4053）包内全串行。
- **flaky 打地鼠**：map 随机序（dfa190b8b extractDisplayValues 排序、a3382de92 detect_tail 改有序 slice）、cli captureOutput pipe 死锁（1beb0bb79）、singleflight 测试超时（b5920486d）、锁不变量失败路径手动释放全局锁（685829f70）——每处都是事后补丁，无标准确定性原语。
- **TestMain 样板反复收敛又复燃**：9 包补注册表注入（987b0483）→ 补 4 包（11bfca3be）→ jscpd 检出 10 包 main_test 复制粘贴收敛至 testutil.InjectRootRegistry（4388367cf）→ testutil 迁址 go/internal（22861808a，ADR-191）。**当前 14 个领域包中仍有 2 份手写内联漏网**（go/types、go/types/registry 各自 `os.ReadFile` + `SetBundledRegistryJSON`）。
- **全局态写读竞态隐患**：`go/types/registry/resource.go` 的 `SetBundledRegistryJSON` 直接赋值 `bundledRegistryJSON`（**无锁**），而 `LoadRegistry` 持 `registryMu` 读它——测试注入与并发读取之间存在数据竞争，这正是包内不敢开 `t.Parallel` 的根因之一。

关键认知：`go test ./go/...` 每个包跑在**独立进程**，包级全局天然隔离——包间并行早已存在。真正的瓶颈是**包内串行** + **注入写读竞态** + **锁协议测试耦合全局锁**。

## 2. 决策（Decision）

**不推翻生产全局态**（LoadRegistry 进程级单例、InstallLock 全局互斥是真实语义：embed 单源注入、ADR-056 统一跨 watcher/安装并发），而是**补并发安全、解耦锁协议、解锁包内并行**。五刀均可独立提交、每刀跑绿即收：

### 刀1：registry 注入点并发安全补全（包内并行的前置地基）

`SetBundledRegistryJSON` / `SetRegistryPath` 并入 `registryMu`（写读原子化），消除测试注入与并发 `LoadRegistry` 之间的数据竞争。

- 验收：`go/types/registry` 包内测试加 `t.Parallel()` 后 `go test -race` 全绿。
- 边界：不引入新的锁原语，复用既有 `registryMu`；热路径仅测试注入点，生产无感。

### 刀2：TestMain 收敛统一（17 处 → 14 领域包全部一行委托）

- `go/types`、`go/types/registry` 两份手写内联改为 `testutil.InjectRootRegistry(m)`（与其余 12 包对齐，CWD 逐层搜索兜底路径漂移）。
- `internal/app` 保留 5 行内联胶水——ADR-191 已裁决这是装配层自有职责，非领域包重复，**不回潮**。
- 验收：14 个领域包 TestMain 全部一行委托；jscpd 无新增重复对。

### 刀3：锁协议可注入（Locker 接口），锁测试脱离全局锁

- 抽 `Locker` 接口（`Lock()` / `Unlock()`），installer 与 sync 通过包级可换实现持有；**生产默认实现 = 现有全局 `InstallLock`**（语义零变化）。
- 锁协议测试注入 stub 锁，失败路径确定性触发——不再需要 685829f70 式「失败后手动释放全局锁」的脆弱编排。
- 验收：锁不变量测试与安装测试可并行；「锁源文件 flaky」（c025b83ef 类）归零。

### 刀4：确定性原语沉淀（testutil 三件套）

`go/internal/testutil` 新增 `SortedKeys` / `WithFixedClock` / `CleanAbsPath`（map 排序、时间注入、平台无关绝对路径构造），收编散修：dfa190b8b / a3382de92（排序）、276fd42e6（filepath.Join 构造路径）。复用判据照搬 `test_tax_reduction` 卡刀三：**同模式 ≥3 处即抽**。

- 验收：新增 flaky 类提交（map 随机序 / 时间依赖 / 路径拼串）归零。

### 刀5：包内并行试点 + 门禁分级

- 试点：`go/types/registry`、`go/sync` 大包开 `t.Parallel()`（刀1 地基后），预估 -race 全量 37.4s → <20s。
- 门禁（pre-push-gate.ts）：`-race` 仅并发敏感包（sync / conc / download / instance / installer / watcher / scanner），其余包普通 `-cover`；`YSM_FRESH_GO_TEST=1` 逃生阀保留。
- 验收：门禁 go test 段 < 20s 且 `-race` 覆盖不减关键并发包。

### 明确不做（防范围蔓延）

1. **不做生产 LoadRegistry 实例化大改**——进程级单例是真实语义，77 消费方 + 绑定面（ADR-192 门面已接），收益仅在测试侧；「实例注入」若做，只做测试注入点的并发安全（刀1），不扩散到生产装配。
2. **不做目录式 fixtures 声明式化**——另立项；ADR-174 黄金语料（声明式 JSON + regen）已是验证过的轻量替代方向。
3. **不删 TestMain 机制**——Go 包级一次性注入是正确形态，12 包统一委托 testutil 已是收敛终点，债只在 2 份手写内联（刀2 收掉）。

## 3. 后果（Consequences）

**正面**：包内并行解锁（大包串行 → 并行，门禁 37.4s → <20s 预估）；flaky 打地鼠转为一站式原语；TestMain 样板达终态（14 领域包一行委托）；锁协议测试确定性触发，全局锁残留编排（手动释放）成为历史。

**负面**：刀3 引入 `Locker` 薄抽象层（生产代码 +1 接口，约 10 行）；刀1 给注入点加锁，理论上有微小写热路径成本（仅测试/启动注入时发生，可忽略）。

**已知遗留**：`internal/app` 内联胶水 5 行（ADR-191 既定装配职责）；go/types 两份 TestMain 迁移后若 CWD 异常由 testutil 告警兜底（不阻断）；目录式 fixtures 声明式化仍排期（另立项）。

## 4. 数据溯源

- 2026-09-07 会话 git 体检：472/3396 提交涉及测试；263 条 fix(test)/test 前缀（56%）；122 纯测试提交 / 351 生产+测试混合；272 测试文件 58,921 行；17 处 TestMain（14 领域包 + internal/app + tests/ + 根误匹配）；0 处 t.Parallel。
- grep 实证：`SetBundledRegistryJSON` 无锁直赋（go/types/registry/resource.go:20）；`var InstallLock sync.Mutex` 全局（go/installer/installer.go:22，ADR-056 统一）；14 包中 12 包已 `testutil.InjectRootRegistry(m)`，go/types、go/types/registry 手写内联。
- 门禁实录：pre-push-gate.ts:397 `go test -race ./go/... ./internal/app/ -timeout 60s`，注释记录 37.4s → cache <1s；check-go-diff-coverage.ts 冷缓存超时 30s→120s。
- 历史锚点：987b0483 / 11bfca3be / 4388367cf（TestMain 三轮收敛）、22861808a（ADR-191）、4013b4d78（CWD 搜索）、685829f70 / c025b83ef（锁 flaky）、dfa190b8b / a3382de92（map 排序 flaky）。
- 结果：本 ADR 五刀落地方案 + 知识卡同步（check-knowledge-drift 自动兜底）。

<!-- 文件名: go-registry-go.md → 实际文件 ADR-202-go-registry-go.md -->
