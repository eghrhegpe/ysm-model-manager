// ===== CLI 白名单单一事实源（前端静态兜底 / 网页版）=====
// 设计意图：go/cli 注册表（40 命令）是 Go 侧单一事实源（main.go SetAllowedCommands
// 注入 → GetAllowedCLICommands 动态透传）。前端在 web 模式与桌面离线兜底时需一套
// 硬编码静态列表——此前 web-cli.ts（18 项）与 services/cli-bridge.ts（20 项）
// 各自硬编码，新增 resource-scan/repo-audit 时只改一处导致漂移（只增 cli-bridge）。
// 本文件收敛为前端静态 allowlist 唯一源：两处消费方均 import 此常量，新增命令
// 只改本文件一处，后端真源仍以 Go 注册表为准（desktop 动态拉取覆盖此兜底）。
//
// ⚠️ 本列表是 Go 注册表的 **curated 子集**（21/40），非同步滞后。排除规则：
//   - 需 Go 进程内文件系统/落盘依赖的命令（doctor、commit-with-check、install 等）
//   - 需 Go 侧 3D 通道的命令（3d 通道相关）
//   - 纯诊断/发版命令（release-check 等）
// 新增 Go 命令时，仅当「无原生依赖 + 网页版可降级」才考虑纳入本列表。
// 详情见 services/cli-bridge.ts 的三层兜链注释。

/** 前端静态 CLI 白名单（网页版 + 桌面离线兜底，子集需与 Go 侧 curation 同步） */
export const CLI_ALLOWLIST = [
  "search",
  "analyze",
  "list",
  "verify",
  "benchmark",
  "export",
  "file-bench",
  "single-bench",
  "concurrent-bench",
  "scan-bench",
  "scan-dir",
  "analyze-mmd",
  "perf-log",
  "cache-status",
  "cache-verify",
  "cache-clear",
  "cache-diag",
  "config-show",
  "gui-flow",
  "resource-scan",
  "repo-audit",
] as const;

export type CLIAllowlistCommand = (typeof CLI_ALLOWLIST)[number];
