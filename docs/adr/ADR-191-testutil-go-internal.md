# ADR-191：testutil 迁至 go/internal——消除内核测试对应用层的依赖倒挂

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡 `go-testutil`（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-003（逻辑下沉，薄壳+内核）、ADR-145（internal/app 不依赖 go/cli）、`go/internal/testutil/`、`internal/app/main_test.go`

---

## 1. 背景（Context）

测试辅助包 `internal/testutil`（3 文件，仅依赖 `go/types`，无 Wails/app 依赖）被 **47 个 `go/**_test.go`** 引用——领域内核的测试反向 import 应用层目录，形成依赖倒挂。倒挂本身无害（testutil 纯净），但边界靠目录自觉：`go/` 树的测试基础设施物理上住在应用层的 `internal/` 里，语义错位且无法强制。

审计同时确认：合并 `go/` 与 `internal/` 两目录不可取（会丢失 `internal/app` 的编译器封装语义，ADR-003/ADR-145 的物理锚点），倒挂根子在 testutil 位置放错，而非目录结构。

## 2. 决策（Decision）

`internal/testutil` → **`go/internal/testutil`**（Go 嵌套 internal，标准库 `net/http/internal` 同款模式）：

1. **位置**：迁入 `go/` 子树，与 47 个消费方同居；嵌套 `internal` 使 import 权限编译器强制限定在 `go/...` 内——`internal/app` 及未来任何应用层代码永久禁入。
2. **app 侧代价**：`internal/app/main_test.go` 原仅用 `InjectRootRegistry` 一个函数；改为内联 5 行注入胶水（`os.ReadFile` + `types.SetBundledRegistryJSON` + `os.Exit`）。这是装配层自有职责，不构成当年 jscpd 收敛的 9 份同构 TestMain 回潮（那是领域包之间的重复）。
3. **备选否决**：`go/testutil`（非嵌套）迁移成本更低、app 零改动，但边界退回自觉约定，未来可能再现反向引用——不予采纳。

## 3. 后果（Consequences）

- **正面**：内核测试的依赖闭环在 `go/` 子树内完成（`go/**_test` → `go/internal/testutil` → `go/types`）；倒挂消除且由编译器永久强制；`internal/` 语义纯化为「Wails 应用层」。
- **负面**：app 测试侧多 5 行胶水（可接受的装配职责）；历史 `git mv` rename 需成对提交。
- **已知遗留**：`go/` 树混入一个非领域包（`go/internal/`），但其嵌套路径已自明用途，无需额外治理。

## 4. 数据溯源

- 2026-09-05 会话审计：`grep internal/testutil --include=*.go` → 48 文件（47 go/ + 1 internal/app/main_test.go）；`testutil.*` 调用面 CreateTestFile×95 / WriteZipFile×65 / WriteTestFileBytes×64 / MakeZipBytes×48 / WriteTestFile×31 / InjectRootRegistry×25（含 app）/ LockDirExclusive×7。
- 迁移后 `go build ./...` + `go vet ./...` + `go test ./... -p 1` 全绿。
