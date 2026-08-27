// ===== 网页版 CLI 绑定（ADR-049 网页版降级）=====
// 网页版无文件系统访问权限，大部分 CLI 命令不可用。
// ADR-123 P2：ExecuteCLI 已移出本注册表——原假实现返回空 success 占位响应，
// 但 `'ExecuteCLI' in browserAdapter` 恒 true 令 can()（capabilities.ts）门控失效，
// UI 命令列可见却不可用。移除后 has 探测 false → 门控隐藏入口，直调走
// browser-adapter fail-fast（WebUnsupportedError），cli-bridge 已有该错误的
// not_supported 响应转换，调用方零改动。待网页版真实现基于 IndexedDB 的
// search/list 时再注册 ExecuteCLI 并同步放开 can() 门控。

/** 所有 CLI 命令白名单（与后端保持同步） */
const ALL_CLI_COMMANDS = [
  "search",
  "analyze",
  "list",
  "verify",
  "benchmark",
  "export",
  "file-bench",
  "single-bench",
  "concurrent-bench",
  "scan-dir",
  "analyze-mmd",
  "perf-log",
  "cache-status",
  "cache-verify",
  "cache-clear",
  "cache-diag",
  "config-show",
  "gui-flow",
];

/** 网页版 CLI 绑定 */
export const webCliBindings = {
  /**
   * 获取允许的 CLI 命令列表
   */
  GetAllowedCLICommands: () => {
    return Promise.resolve(JSON.stringify(ALL_CLI_COMMANDS));
  },
};
