---
kind: go-testutil
name: 测试辅助函数 go/internal/testutil
tier: leaf
category: go
source_files:
  - go/internal/testutil/testutil.go
  - go/internal/testutil/testutil_windows.go
  - go/internal/testutil/assert.go
  - go/internal/testutil/determinism.go
  - internal/testutil/testutil.go
auto_fields:
  symbols_with_lines:
    - BytesZip
    - CleanAbsPath
    - CreateTestFile
    - ErrorContains
    - ErrorIs
    - FileExists
    - FileNotExists
    - InjectRootRegistry
    - LockDirExclusive
    - MakeZipBytes
    - Nil
    - NoError
    - NotNil
    - WaitForCall
    - WaitForCallNoSleep
    - WithFixedClock
    - WriteFile
    - WriteTestFile
    - WriteTestFileBytes
    - WriteZip
    - WriteZipFile
  tests:
    - go/internal/testutil/testutil_test.go
    - go/internal/testutil/assert_test.go
    - internal/testutil/testutil_test.go
use_when:
  - 跨包复用测试 helper
  - 创建测试文件
  - 构造内存 ZIP
  - go/internal/testutil 包在哪
quick_groups:
  - 测试与验证
quick_intents:
  - 测试辅助函数、go/internal/testutil 包在哪
  - 创建测试文件、构造内存 ZIP、跨包复用测试 helper
  - 测试窗口、固定时钟、确定性等待 helper
quick_risk_lines:
  - 测试 helper 必须走 go/internal/testutil 跨包复用，禁止各包各自实现同名 helper
pitfalls:
  - 各包自行实现同名测试 helper → 重复维护、行为漂移；一律复用本包
invariant_anchors:
  - go/internal/testutil/testutil.go|CreateTestFile
  - go/internal/testutil/testutil.go|MakeZipBytes
status: active
---

# 测试辅助函数 go/internal/testutil

## 概览

`go/internal/testutil/` 包提供跨包复用的 Go 单元测试辅助函数，解决原先各包各自实现同名 helper 导致的重复维护问题。

**断言族单一事实源翻转（2026-10-11，G3 清偿）**：8 个断言函数（`NoError`/`ErrorContains`/`ErrorIs`/`Equal`/`Nil`/`NotNil`/`FileExists`/`FileNotExists`）的实现**已上移根 `internal/testutil|testutil.go`**（自足实现，含 `prefixFromArgs`/`isNil` 私有 helper）；`go/internal/testutil|assert.go` 降为**纯转发层**（逐函数透传根实现，判据/diff 语义零分叉）。原因：Go internal 可见性规则方向——`go/internal/...` 只允许 `go/` 子树内导入（父目录=go/），而 `go/` 子树内包（rooted 模块根）**可以**导入根 `internal/...`（父目录=模块根），故「根包转发 go 包」（前序尝试，报 not allowed）不可编译，唯一合法单源形态 = 根侧实现 + go 侧转发。根 `internal/testutil` 仅根 `internal/app`（Wails 应用层，位于 go/ 子树外）消费；go/ 侧消费方 import 路径不变。**变更断言行为只改根实现，go 侧转发层永不复制逻辑**。

## 核心职责

- 统一 `CreateTestFile`（原先 dedup/fsutil/recycle 三处各自实现）
- 统一内存 ZIP 构造（原先 geometry/packs/ysm 五个包各自实现的 `makeZipBytes`/`writeZip` 变体）
- 提供写临时目录 ZIP 文件的快捷函数

## 对外 API / 入口

- `CreateTestFile(t, dir, name, content string) string` — 在 `dir` 下创建 `name` 文件（自动建父目录），返回完整路径
- `MakeZipBytes(t, entries map[string]string) []byte` — 构造内存 ZIP（条目名→内容），返回字节
- `WriteZipFile(t, name string, entries map[string]string) string` — 构造 ZIP 并写入 `t.TempDir()/name`，返回文件路径

## 与其他子系统关系

- **消费方**：`go/dedup`、`go/fsutil`、`go/recycle`（测试文件创建）；`go/geometry`、`go/packs`、`go/ysm`（ZIP 构造）
- 无生产代码依赖，仅供 `*_test.go` 使用

## 不变量

- 所有函数均调用 `t.Helper()`，确保错误栈定位到调用方测试代码
- `CreateTestFile` 使用 `t.Fatal` 而非返回错误（测试上下文惯例）
- `WriteZipFile` 的临时目录由 `t.TempDir()` 管理，测试结束自动清理

## 已知债（ADR-202 刀5 裸断言增量）

- **~~2026-10-11 修复批次审计登记（未收口）~~→ 已收口（2026-10-11）**：~~`check-go-diff-coverage` 的「测试断言增量红线」（新增/变更 `*_test.go` 行禁裸 `t.Fatal`/`t.Fatalf`，须走 testutil 断言）是**增量闸**——只扫 diff 窗口。2026-10-10/11 批次中 6 个测试文件 ~24 处裸 t.Fatal 已随推送窗口 grandparent 化，闸不再复扫；`45a6a8177` 只收了同族 1/6（tags_relocate_test）。~~（清单以 `node scripts/check-go-diff-coverage.ts --base 47f9ccd83` 实测为准，2026-10-11 审计记录：10 文件红、6 属该批次——tags_commit_order / fileops_target_plan / app_files_tags_migrate / app_config_preserve / app_prune_disabled / app_files_toggle。）收口 = **一次性改走 testutil 断言**（参照 `45a6a8177` 先例）：go/ 侧 5 文件（tags_commit_order / fileops_target_plan / cli_readonly / geometry_select_parity / cube_mesh_parity，28 处）+ 根 internal/app 8 文件（config_preserve / files_tags_migrate / files_toggle / import_invalidate / migrate_rekey / prune_disabled / recycle_tags / texture_order_parity，82 处）全部改走 testutil 断言；夹带根桥包 `internal/testutil`（断言族单一事实源翻转，见概览）。改完以债前 commit（`47f9ccd83`）为 base 重跑该闸转绿（提交后复验）。
- **已知债（结构性，非本次）**：`source_files` 中根 `internal/testutil|testutil.go` 与 go 侧 `assert.go` 断言函数**双条目同符号**（无多行），断言族实现虽已单源化，但符号面在漂移检查里是双登记——若未来需要严格单源登记，可让 go 侧 `assert.go` 从卡内 source_files 移除（转发层符号由根实现卡承载），暂维持现状。
- **2026-10-11 全库扫描补盲：增量闸漏掉了存量的大头**：上一条只清了"diff 窗口里露头的"那批，但该闸是**纯增量**——`check-go-diff-coverage` 只判 `base...head` 的新增行，海量存量裸断言从不进 diff、闸永远看不见。同日给该闸补了**全库计数账本**（`check-go-diff-coverage.ts --update-baseline`，账本 `scripts/baseline/go-bare-assert-baseline.json`）：按文件记"裸断言**条数**"（不记行号，行号会漂移），每次运行全库重扫并与账本比对——超出基线 → WARN/debt 档（doctor 报告**永远可见**，不阻断）；diff 新增仍 ERROR（原阻断语义不变）。**裸断言存量债的真实量级以该账本为准**（首次全库扫描即暴露出远大于"6 文件批次"的规模：存量覆盖 `go/` 与根 `internal/` 数百个 `_test.go` 文件——此前闸只见其鳞爪）。收债仍走一次性改 testutil 断言（上一条先例），清理后重跑 `--update-baseline` 收缩。
- **2026-10-12 codemod 批量收债（形态 A/B/C/D）**：`scripts/codemod-bare-assert-noerror.ts` 机械收债累计清 **2296 处**，账本 **5000 → 2704**（2026-10-12 时点）。四形态：A 规整 `if X != nil { t.Fatal(X) }`；B `t.Fatalf(fmt, X)`（恰 2 参、fmt 单尾 %v/%w）；C `if [init;] X != nil {` 块内（任意深度、多语句）同名 `t.Fatal(X)`——保留 if 结构只换块内行；D `if X ==/!= nil { t.Fatal("msg") }` 3 行块 → `testutil.NotNil/Nil`（收 any，无 error 类型限制）。内置**编译期校验安全网**：apply 后 `go test -run=__none__` 编译全部测试包 → 自动还原 "cannot use X as error" 误转（slice/map/指针空值检查）+ 回收孤儿 import，循环直至无错。**剩余 2704 语义分类**（2026-10-12 时点，供收债排期）：多参 Fatalf 信息型 ~1962（`t.Fatalf("..%s.. %v", ctx, err)` 含完整上下文，转 NoError 需 Sprintf 拼前缀、有损，**建议接受现状**）；消息断言其它形态 ~616（`if got == ""`/`if idx < 0`/调用比较等，非 nil 检查、需语义/人工）；可清 ~15（形态 D 漏网 `if X ==/!= nil` 3 行块）；fuzz/bench ~33（`*testing.F/B` 类型限制，正确保留）；其它 ~90。

## 相关

- `go/dedup/`、`go/fsutil/`、`go/recycle/`（测试文件）
- `go/geometry/`、`go/packs/`、`go/ysm/`（ZIP 构造）
