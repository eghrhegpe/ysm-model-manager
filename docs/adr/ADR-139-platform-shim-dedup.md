# ADR-139：平台 shim 收敛 rustbridge 与 scanner 四 OS 重复

- **状态**：🔄 部分采纳（L1 部分执行；L2 scanner 已执行、rustbridge 待批；L3 待批）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-31
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/rustbridge/bridge_{windows,linux,darwin,android}.go; go/scanner/rust_backend_{windows,linux,darwin,android}.go; scripts/jscpd-go.mjs; build/{darwin,linux,windows}/Taskfile.yml; scripts/android-build.mjs; ADR-120`

---

## 1. 背景（Context）

### 1.1 jscpd 实测：生产重复只占 12.8%，且主体是平台 shim

`scripts/jscpd-go.mjs` 全量重跑（scope `./go/**/*.go`，默认阈值，2026-08-31 工作树）：

| 维度 | 治理前 | 本轮一(Batch C) | 本轮二(scanner 合并) |
|---|---|---|---|
| 重复块 | 454 | 451 | 447 |
| 唯一文件对（门禁口径） | 173 | **170** | **167** |
| 生产源码块 | 116（12.8%） | — | — |
| 测试样板块 | 792（87.2%） | — | — |
| 文件对分类 | 生产-生产 38 / 生产-测试 2 / 测试-测试 133 | 生产-生产 35 | 生产-生产 32 |

**门禁口径更正**：`jscpd-go.mjs` 计的是**文件对**（`clones` 数组），`454` 是 `statistics.clones`（重复块实例数），`173` 才是对数。二者不可混称。

### 1.2 「抽 helper 降块不降对」的判断不成立

对 38 个生产-生产对做「链接块数」分布统计：

- **26 个对只被 1 块链接** → 消掉该块即消掉该对；其中 15 个是**文件内自重复**（`a#a`），抽取后 helper 留在同文件同包，无跨包 API 变更。
- 仅 12 个对被 2 块以上链接（archive.go 6 块、sync_dirlevel.go 3 块、tags.go 3 块、fileops.go 3 块），这类才是「必须全清才降 1 对」。

实测印证：抽 3 处 helper（importer / fsutil / cli）后**文件对 173 → 170**，每处 1 对。故「只有合并语义变体或消除平台 shim 才能降对」的结论被证伪。

### 1.3 平台 shim 是逐字复制，不是「结构近似」

| 文件组 | 实证 |
|---|---|
| `bridge_darwin.go` ↔ `bridge_linux.go` | 各 101 行，`diff` 仅 2 行不同：构建标签行 + 注释里的平台名。**逐字相同** |
| `bridge_android.go` | 107 行 = 同一份代码 + 额外注释与空行 |
| `bridge_windows.go` | 126 行，**无 cgo**（syscall / DLL 加载），实现路径真实不同 |
| `rust_backend_{linux,darwin,android}.go` | 各 29 行，**纯 Go 无 cgo**，除构建标签行外逐字相同 |
| `rust_backend_windows.go` | 34 行 = 同一份代码 + 4 行 ADR-120 决策注释 |
| **scanner 四文件合并后实证** | 四个文件**去掉注释与空行后逐字相同**（`diff <(grep -vE '^\s*//' A \| grep -vE '^\s*$') …` 零差异）→ 可塌缩成**单个不带 OS 约束**的文件 |
| **rustbridge 三 cgo 文件实证** | `bridge_{darwin,linux,android}.go` 去注释与空行后亦**逐字相同**，**含 `/* */` C 前导块在内** |

`rust_backend` 在生产构建里**真实启用**：`build/darwin/Taskfile.yml:15`、`build/linux/Taskfile.yml:37` 恒定带 `-tags production,rust_backend`；`build/windows/Taskfile.yml:153` 在 amd64 生产版带上；`scripts/android-build.mjs:186` 在 `production` 或 `--rust-backend` 时带上。**不是死代码。**

### 1.4 关键发现：android 隐含 linux 构建标签 → 安卓生产构建断裂（已止血）

Go 的 `GOOS=android` **同时满足 `linux` 构建约束**。因此同包内若同时存在 `*linux*.go` 与 `*android*.go` 变体，安卓会一并纳入，符号重复声明：

```
GOOS=android CGO_ENABLED=0 go build -tags rust_backend ./go/scanner/
  rust_backend_linux.go:11:6: scanEntriesWithRust redeclared in this block
  rust_backend_android.go:11:6: other declaration of scanEntriesWithRust
```

`GOOS=android CGO_ENABLED=1 go list` 显示 `go/rustbridge` 的 CgoFiles 同时含 `bridge_android.go` 与 `bridge_linux.go`（`nativeBuffer` / `Scan` 均重复）。

而 `scripts/android-build.mjs:154` 的 `rustBackend = argv.includes('--rust-backend') || production || env.GO_RUST_BACKEND === '1'` 意味着**安卓生产构建必然带上 `rust_backend`** → 必然踩中该断裂。

全库 `go list` 扫描（33 个包）确认撞车范围**恰好只有这 2 个包**：`go/rustbridge`、`go/scanner`。

**根因修复（已执行）**：`go/scanner` 四份变体合并为单个 `rust_backend.go`（`//go:build rust_backend`，不带 OS 约束），撞车由构造上消失——`!android` 守卫对 scanner 已不再需要。本 ADR 初版建议的「标签守卫」是止血，合并是根治（「推倒重来适合于根除相伴」）。

---

## 2. 决策（Decision）

**平台 shim 按「是否逐字相同」分三档治理，不搞一次性大爆炸重构；先用构建标签守卫止血，再去重。**

### L1 — 构建标签守卫（部分已执行）

- `go/scanner`：已由 **L2 合并**从根上消除撞车（四文件 → 单文件 `rust_backend.go`，无 OS 约束），守卫不再需要。
- `go/rustbridge`：`bridge_linux.go` 已加 `//go:build linux && !android && rust_backend` 守卫（只能减少文件纳入，不改变已纳入路径语义），待 L2 合并彻底取代。

**理由（守卫是止血不是重构）**：加 `!android` 不可能改变任何现有可编译目标的语义；若后续 L2 合并成单文件，守卫自动作废。

### L2 — 逐字相同文件合并（scanner 已执行；rustbridge 待批）

- `go/scanner`：**已执行**——四份 `*_<os>.go` 合并为 `rust_backend.go`（`//go:build rust_backend`），删 4 留 1。本地验证闭环完整：`go test -tags rust_backend ./go/scanner/...` 在本机 Windows 即可跑通（CI 同款，`.github/workflows/test.yml:166`），不依赖 NDK。
- `go/rustbridge`：`bridge_{darwin,linux,android}.go` 去注释后逐字相同（含 C 前导块），合并为 `bridge_cgo.go`（`//go:build (darwin || linux || android) && rust_backend`）。`bridge_windows.go` 单列（syscall/DLL，无 cgo，实现真实不同）。合并后 android 撞车同样由构造消失，**无需 `!android` 守卫**，且 `build/darwin` 与 `build/linux` 的 `-extldflags` 完全相同 → 链接侧无平台差异。
- **android 纳入 L2**：初版顾虑「NDK/gomobile 链路、CI 零覆盖」而排除 android；但既然三份 cgo 文件去注释后逐字相同，合并不改变 android 的任何行为（仅仅是 android 与另外三者共用同一文件），顾虑已不成立。

**已验证收益**：scanner 合并消 3 个文件对（android↔darwin / android↔linux 各 27 行、android↔windows 27 行）→ 170 → 167。rustbridge 合并预期再消 3 个（darwin↔linux 89 行、android↔darwin 82 行、android↔windows 11 行）→ 167 → 164。

### L3 — 跨 OS 抽象（不在本 ADR 批准范围，需独立 ADR）

把 `bridge_windows.go`（syscall/DLL）与 unix cgo 实现的公共逻辑抽成 OS 无关核心 + per-OS 薄壳。跨 4 OS、涉及 cgo 与 NDK，属架构级变更，须另立 ADR 并在独立 worktree 实施。

### 明确不合并

`go/geometry/archive.go`、`go/fileops/fileops.go` 等被 2 块以上链接的**故意语义变体**（如 `readTexFrom7z` 比 `readTexFromZip` 多 `IsYsmEntryJSON` 过滤）维持不动——强行合并会遮蔽意图并引入回归风险。

---

## 3. 后果（Consequences）

**正面**

- 安卓生产构建断裂被**根因修复**（scanner 合并使撞车由构造消失），不再依赖「安卓路径恰好没启用 rust_backend」这一巧合。
- `go/scanner` 的平台 shim 已收敛为单一事实源：四份变体改一处即生效四端，消除「改了 windows 忘改 darwin」。
- 门禁文件对从 173 → 167；剩余 21 个单块链接对（含 12 个文件内自重复）仍是**可机械清零**的确定收益池。

**负面 / 代价**

- L2 合并后，未来若某 OS 真需要分叉逻辑，需重新拆文件（当前无此需求，三份 cgo 文件已证逐字相同）。
- `go/rustbridge` 合并仍需在 linux/darwin 真机构建下验收（本机 Windows 无 cgo 交叉编译；但 `GOOS=x CGO_ENABLED=1 go list` 可本地确认每 OS 恰好纳入一个文件）。

**已知遗留**

- `go/rustbridge` 无单测文件（`[no test files]`），CI 仅 Windows 侧覆盖 `-tags rust_backend ./go/scanner/...`（`.github/workflows/test.yml:166`）。**linux / darwin / android 的 rust_backend 路径在 CI 零覆盖**——这是比重复债务更值得优先处理的风险。
- 测试样板 792 块（87.2%）**不动**：属测试固有样板，抽公共夹具会削弱用例独立性与可读性。

---

## 4. 验证方案（本地无 C 编译器约束下的可行手段）

Windows 开发机无法交叉编译 cgo，但 `go list` **只解析构建约束、不调用 C 编译器**，可作为本地验证原语：

```bash
# 每个 GOOS 应恰好纳入一个 shim
for os in windows linux darwin android; do
  GOOS=$os CGO_ENABLED=1 go list -tags rust_backend -e -f '$os: {{.GoFiles}} cgo={{.CgoFiles}}' ./go/scanner/ ./go/rustbridge/
done

# 纯 Go 包可真实交叉编译，能捕获 redeclared
GOOS=android CGO_ENABLED=0 go build -tags rust_backend ./go/scanner/

# 门禁
node scripts/jscpd-go.mjs
```

`CGO_ENABLED=0` 下出现的 `undefined: rustbridge.Scan` 是 cgo 文件被排除的预期产物，**不是缺陷**；生产安卓构建走 `CGO_ENABLED=1` + NDK clang。

**L2 的验收门**必须包含真机构建：`build/linux/Taskfile.yml` 与 `build/darwin/Taskfile.yml` 各跑一次生产构建，以及 `scripts/android-build.mjs --production`（需 NDK）。

---

## 5. 数据溯源

| 结论 | 来源 |
|---|---|
| 454 块 / 173 对；生产 116 块 vs 测试 792 块 | `scripts/jscpd-go.mjs` + jscpd v5 `--reporters json`（`frontend/node_modules/jscpd`），全量重跑 |
| 38 个生产-生产对中 26 个单块链接 | 对 `duplicates[]` 按归一化文件对分组统计块数（脚本：`tmp/jscpd-pair-shape.mjs`） |
| bridge_darwin ↔ bridge_linux 仅 2 行不同 | `diff go/rustbridge/bridge_darwin.go go/rustbridge/bridge_linux.go` |
| rust_backend_{linux,darwin,android} 除标签外逐字相同 | `diff` + `grep -l 'import "C"'`（三文件均无 cgo） |
| android 隐含 linux 标签导致 redeclared | `GOOS=android go list` + `GOOS=android CGO_ENABLED=0 go build -tags rust_backend ./go/scanner/` 实测报错 |
| 撞车范围仅 2 个包 | 遍历 33 个包做 `GOOS=android go list` 文件名交集检测 |
| scanner 四文件去注释逐字相同 | `diff <(grep -vE '^\s*//' A ¦ grep -vE '^\s*$') <(grep -vE '^\s*//' B ¦ grep -vE '^\s*$')` 零差异 |
| rustbridge 三 cgo 文件去注释逐字相同（含 C 前导块） | 同上 `diff`，零差异 |
| scanner 合并本地可验证 | `go test -tags rust_backend ./go/scanner/...` 本机 Windows 跑通（CI 同款 test.yml:166） |
| 173 → 170 → 167 | `node scripts/jscpd-go.mjs --update` 两次对比；scanner 合并消 3 对 |
