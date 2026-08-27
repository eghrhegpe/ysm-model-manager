// ===== 网页版 CLI 绑定（ADR-049 网页版降级）=====
// 网页版无文件系统访问权限，大部分 CLI 命令不可用。
// 本文件提供基本的命令列表查询和降级响应。

/** 网页版支持的 CLI 命令（仅支持内存操作类命令） */
const WEB_SUPPORTED_CLI_COMMANDS = [
  "search", // 可基于 IndexedDB 数据实现
  "list",   // 可基于 IndexedDB 数据实现
];

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
   * 执行 CLI 命令（网页版降级实现）
   * 仅支持 search/list 等内存操作命令，其他返回 not_supported
   */
  ExecuteCLI: (command: string, args: Record<string, unknown>) => {
    const isSupported = WEB_SUPPORTED_CLI_COMMANDS.includes(command);
    
    if (!isSupported) {
      return Promise.resolve(JSON.stringify({
        status: "not_supported",
        command,
        error: {
          code: "web_not_supported",
          message: `网页版不支持命令 [${command}]，仅支持: ${WEB_SUPPORTED_CLI_COMMANDS.join(", ")}`,
        },
        meta: { platform: "web" },
      }));
    }

    // TODO: 实现网页版 search/list 命令（基于 IndexedDB 数据）
    // 当前返回空数据占位
    return Promise.resolve(JSON.stringify({
      status: "success",
      command,
      data: {
        output: "",
        lines: [],
        platform: "web",
        note: "网页版 CLI 命令待实现",
      },
      meta: { platform: "web" },
    }));
  },

  /**
   * 获取允许的 CLI 命令列表
   */
  GetAllowedCLICommands: () => {
    return Promise.resolve(JSON.stringify(ALL_CLI_COMMANDS));
  },
};
