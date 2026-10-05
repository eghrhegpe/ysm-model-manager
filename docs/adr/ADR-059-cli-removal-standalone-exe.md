# ADR-059：CLI 移除与裸 exe 发布

- **状态**：已采纳（Accepted）
- **日期**：2026-08-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`cli_export.go / internal/app/cli.go / go/updater/updater.go / scripts/build-release.ps1`
- **修订关联**：[ADR-102](./ADR-102-cli-embedded-return-diagnostic-platform.md) 确立内嵌 `--cli` 诊断协同平台定位（非独立分发），本 ADR 的「裸 exe 发布」「`export` 不随包分发」决策保持有效

---

## 1. 背景（Context）

v1.12.0 纯 exe 发布（ADR-058）后，ZIP 内仍有两个可执行文件：主程序 + `ysm-cli.exe`，发布资产保持 zip 形态，「下载单个 exe」的承诺未完全兑现。进一步审视 CLI 的价值：

- **功能已被主程序覆盖**：WASM 解码引擎（ADR-029）落地后，主程序自身即可拖拽/打开模型完成预览与解析；CLI 的 `doctor`/`stats`/`export` 排障能力在图形界面中均有等价入口。
- **伦理边界隐患**：CLI 的 `export` 子命令会导出 3D 网格 JSON——触碰 ADR-026 铁律 1「绝不提供模型导出」，虽仅限本地合法文件，但作为可分发工具存在被滥用风险。
- **发布形态冗余**：为单个排障工具维持 zip 打包与更新解压链，与「纯 exe 发布」目标相悖。

## 2. 决策（Decision）

**移除 CLI，Windows Release 资产由 zip 收敛为裸 exe。**

- **移除 CLI**：删除 `cli_export.go`（`//go:build cli` 薄入口）、`internal/app/cli.go`（`CLIMain`/`runExport`/`runDoctor`/`runStats`）与 `cli_test.go`；`main.go` 的 `!cli` build tag 一并去除。
- **裸 exe 发布**：`scripts/build-release.ps1` 不再打包 zip、不再构建 `ysm-cli.exe`，产物为 `YSM-Model-Manager_windows_amd64.exe` + `SHA256SUMS`；`.github/workflows/release.yml` Windows 资产同步改 exe。
- **更新链直装**：`go/updater` 的 `assetPattern()` 匹配 `.exe`；`InstallUpdate` 去掉 zip 解压环节，直接校验 PE 魔数后经 helper 替换；SHA256SUMS 按 exe 名取哈希（`internal/app/app_config.go` 语义同步）。

## 3. 后果（Consequences）

**正面**：
- 达成真正的「单文件交付」：下载一个 exe 即具备全部能力，无解压步骤。
- 更新链简化：无 zip 解压/条目遍历/覆盖白名单，攻击面收窄（zip bomb、路径穿越等 zip 攻击面整体消失）。
- 伦理边界收紧：`export` 能力不再随包分发，与 ADR-026 铁律一致。

**负面 / 注意**：
- 排障 CLI 能力不再随包提供（需在源码环境 `go run .` 或构建期自行生成）。
- 旧版 zip 升级路径：旧版本更新包仍为 zip，v1.13.0 起的新更新包为 exe——旧程序升级到 v1.13.0 时其旧 `InstallUpdate` 逻辑仍按 zip 处理新资产会失败，因此 v1.13.0 发布时需确保旧版用户能通过 zip 形态过渡（v1.12.0 及以前仍发 zip，v1.13.0 切换后旧用户手动覆盖升级一次）。

**已知遗留**：
- 既有 ADR 的历史条款随之失效（不改历史正文）：ADR-001 §4.1 CLI 薄壳设计、ADR-033 §4「`ysm-cli.exe` 纳入 `alwaysOverwrite`」。
- Linux/macOS 资产仍为 `.tar.gz`（自动更新不支持，手动下载），未纳入本次收敛。

## 4. 数据溯源

- ADR-026（伦理边界铁律 1：不提供模型导出）、ADR-029（WASM 内嵌解码）、ADR-058（纯 exe 发布模型）。
- 实现：`go/updater/updater.go`（`assetPattern`/`InstallUpdate` 裸 exe 直装）、`scripts/build-release.ps1`（产物与上传改 exe）、`.github/workflows/release.yml`（Windows 资产改 exe）。
- 移除范围：`cli_export.go`、`internal/app/cli.go`、`internal/app/cli_test.go`。

<!-- 文件名: cli-removal-standalone-exe.md → 实际文件 ADR-059-cli-removal-standalone-exe.md -->
