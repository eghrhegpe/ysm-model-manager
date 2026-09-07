# ADR-201：测试文件命名规范

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-07
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - `go/` 各包 `*_test.go` 文件
  - `internal/app/` 各包 `*_test.go` 文件
  - `tests/` 契约测试文件
  - 知识卡 `test-tax-reduction.md`（三刀方法论）

---

## 1. 背景（Context）

Go 测试文件命名混乱：同包下混用 `*_test.go`、`*_extra_test.go`、`*_edge_test.go`、`*_fixture_test.go`、`*_parity_test.go`、`*_regression_test.go` 等后缀，缺乏统一约定，导致：
- 测试意图不清（如 `extracted_winefox_spec_test.go` vs `extracted_winefox_real_test.go`）
- 难以按类型筛选/运行特定测试
- 新增测试时不知遵循何种命名
- CI/CD 难以针对不同测试类型配置不同策略（如 `_benchmark_test.go` 不应在常规 CI 跑）

## 2. 决策（Decision）

统一测试文件后缀命名规范，按测试性质分类：

| 后缀 | 语义 | 适用场景 | CI 策略 |
|------|------|----------|---------|
| `_test.go` | **主测试（必跑）** | 核心功能、回归防线、正常路径 | 常规 CI 必跑 |
| `_edge_test.go` | **边界/异常** | 错误路径、极值、并发竞态、非法输入 | 常规 CI 必跑 |
| `_parity_test.go` | **对齐/契约** | Go↔TS、解码器一致性、跨端对拍 | 常规 CI 必跑 |
| `_regression_test.go` | **回归专用** | 固化已修复 Bug、防回归 | 常规 CI 必跑 |
| `_benchmark_test.go` | **性能基准** | `go test -bench` 专用 | 仅在性能 CI 跑，常规 CI 跳过 |
| `_fuzz_test.go` | **模糊测试** | `go test -fuzz` 专用 | 仅在 fuzz CI 跑，常规 CI 跳过 |

**命名约束**：
- 每个测试文件**仅能使用一个**上述后缀（不可组合如 `_edge_regression_test.go`）
- 文件名主体应清晰表达被测单元（如 `orderTexByYSM_edge_test.go`、`dedup_parity_test.go`）
- 存量文件可渐进式在重构时重命名，**新增文件必须遵循**

## 3. 后果（Consequences）

**正面**：
- 测试意图一目了然，便于筛选与维护
- CI 可按后缀配置不同运行策略（如 benchmark/fuzz 隔离）
- 新人更易理解测试结构

**负面/已知遗留**：
- 存量文件重命名需时间，建议在触及相关代码时顺手处理
- 部分既有文件（如 `*_extra_test.go`）需人工判定归属类型再重命名

## 4. 数据溯源

来源：Go 测试体系锐评（2026-09-07）→ 识别命名混乱问题 → 制定规范
结果：ADR-201 统一命名规范，指导后续测试编写与存量治理

<!-- 文件名: test-naming-convention.md → 实际文件 ADR-201-test-naming-convention.md -->
