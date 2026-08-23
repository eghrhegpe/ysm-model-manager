// @vitest-environment node
// ===== CLI Bridge 前端封装层测试 =====
// 测试 cli-bridge.ts 的命令执行、响应解析、网页版降级等功能

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  executeCLI,
  getAllowedCLICommands,
  cliSearch,
  cliList,
  cliAnalyze,
  cliCacheStatus,
  ALLOWED_CLI_COMMANDS,
  parseCLIResponse,
  buildArgsMap,
  resetDynamicCommandsCache,
} from "./cli-bridge.ts";

// Mock getApp 和 resolveWebMode
vi.mock("../backend/app.ts", () => ({
  getApp: vi.fn(),
}));

vi.mock("../backend/platform.ts", () => ({
  resolveWebMode: vi.fn(() => false),
}));

vi.mock("../backend/web-common.ts", () => ({
  WebUnsupportedError: class extends Error {
    constructor(binding: string) {
      super(`[web] binding ${binding} 浏览器端未实现`);
      this.name = "WebUnsupportedError";
    }
  },
}));

import { getApp } from "../backend/app.ts";
import type { AppBindings } from "../backend/types.ts";
import { resolveWebMode } from "../backend/platform.ts";
import { WebUnsupportedError } from "../backend/web-common.ts";

// 重置 mock
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveWebMode).mockReturnValue(false);
  resetDynamicCommandsCache();
});

describe("CLI Bridge - 命令执行", () => {
  it("执行白名单命令成功", async () => {
    const mockApp = {
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({
          status: "success",
          command: "search",
          data: { output: "test output", lines: ["line1"] },
          timing: { total_ms: 100 },
          meta: { platform: "windows" },
        })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    const result = await executeCLI("search", { keyword: "test" });

    expect(result.status).toBe("success");
    expect(result.command).toBe("search");
    expect(result.data?.output).toBe("test output");
    expect(result.timing?.total_ms).toBe(100);
  });

  it("拒绝非白名单命令", async () => {
    const result = await executeCLI("dangerous-command");

    expect(result.status).toBe("not_supported");
    expect(result.error?.code).toBe("command_not_allowed");
    expect(result.command).toBe("dangerous-command");
  });

  it("处理执行错误", async () => {
    const mockApp = {
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({
          status: "error",
          command: "search",
          error: { code: "runtime_error", message: "模型不存在" },
          timing: { total_ms: 50 },
        })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    const result = await executeCLI("search", {});

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("runtime_error");
    expect(result.error?.message).toBe("模型不存在");
  });

  it("处理 getApp 异常", async () => {
    vi.mocked(getApp).mockRejectedValue(new Error("连接失败"));

    const result = await executeCLI("search");

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("call_failed");
  });
});

describe("CLI Bridge - 网页版降级", () => {
  it("网页版返回降级响应", async () => {
    vi.mocked(resolveWebMode).mockReturnValue(true);

    const mockApp = {
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({
          status: "not_supported",
          command: "cache-status",
          error: {
            code: "web_not_supported",
            message: "网页版不支持命令 [cache-status]",
          },
          meta: { platform: "web" },
        })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    const result = await executeCLI("cache-status");

    expect(result.status).toBe("not_supported");
    expect(result.error?.code).toBe("web_not_supported");
    expect(result.meta?.platform).toBe("web");
  });

  it("网页版 WebUnsupportedError 处理", async () => {
    vi.mocked(resolveWebMode).mockReturnValue(true);

    const mockApp = {
      ExecuteCLI: vi.fn().mockImplementation(() => {
        throw new WebUnsupportedError("ExecuteCLI");
      }),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    const result = await executeCLI("analyze");

    expect(result.status).toBe("not_supported");
    expect(result.error?.code).toBe("web_not_supported");
  });
});

describe("CLI Bridge - 命令列表", () => {
  it("获取允许的命令列表（桌面版）", async () => {
    const commands = ["search", "list", "analyze"];
    const mockApp = {
      GetAllowedCLICommands: vi.fn().mockResolvedValue(JSON.stringify(commands)),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    const result = await getAllowedCLICommands();

    expect(result).toEqual(commands);
    expect(mockApp.GetAllowedCLICommands).toHaveBeenCalled();
  });

  it("获取允许的命令列表（网页版降级）", async () => {
    vi.mocked(resolveWebMode).mockReturnValue(true);

    const result = await getAllowedCLICommands();

    expect(result).toEqual(ALLOWED_CLI_COMMANDS);
  });

  it("getApp 异常时降级到本地列表", async () => {
    vi.mocked(getApp).mockRejectedValue(new Error("连接失败"));

    const result = await getAllowedCLICommands();

    expect(result).toEqual(ALLOWED_CLI_COMMANDS);
  });
});

describe("CLI Bridge - 动态白名单", () => {
  it("动态列表放行硬编码列表之外的新命令", async () => {
    const mockApp = {
      GetAllowedCLICommands: vi.fn().mockResolvedValue(
        JSON.stringify(["new-cmd", "search", "list"])
      ),
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({ status: "success", command: "new-cmd", data: {} })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    const result = await executeCLI("new-cmd");

    expect(result.status).toBe("success");
    expect(mockApp.ExecuteCLI).toHaveBeenCalledWith("new-cmd", {});
  });

  it("动态列表缺失的硬编码命令被拒绝（native 模式以动态列表为准）", async () => {
    const mockApp = {
      GetAllowedCLICommands: vi.fn().mockResolvedValue(
        JSON.stringify(["only-other"])
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    const result = await executeCLI("search");

    expect(result.status).toBe("not_supported");
    expect(result.error?.code).toBe("command_not_allowed");
  });

  it("拉取失败时回退硬编码列表（本次调用），不持久化缓存，下次重试后端", async () => {
    // 独立 mock 状态，避免与其它用例的 mock 队列交互
    vi.mocked(getApp).mockReset();

    // 第一次调用：后端拉取失败
    vi.mocked(getApp).mockRejectedValueOnce(new Error("连接失败"));

    // 失败回退：硬编码命令放行（但执行时 getApp 仍失败 → call_failed），新命令被拒
    const hardcoded = await executeCLI("search");
    expect(hardcoded.status).toBe("error");
    expect(hardcoded.error?.code).toBe("call_failed");

    const outside = await executeCLI("new-cmd");
    expect(outside.status).toBe("not_supported");
    expect(outside.error?.code).toBe("command_not_allowed");

    // 后端恢复：不持久化缓存 → 下次调用重新拉取，动态新命令放行
    vi.mocked(getApp).mockReset();
    const mockApp = {
      GetAllowedCLICommands: vi.fn().mockResolvedValue(
        JSON.stringify(["new-cmd", "search"])
      ),
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({ status: "success", command: "new-cmd", data: {} })
      ),
    } as unknown as AppBindings;
    vi.mocked(getApp).mockResolvedValue(mockApp);

    const retry = await executeCLI("new-cmd");
    expect(retry.status).toBe("success");
    expect(mockApp.ExecuteCLI).toHaveBeenCalledWith("new-cmd", {});
  });
});

describe("CLI Bridge - 便捷方法", () => {
  it("cliSearch 传递正确参数", async () => {
    const mockApp = {
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({ status: "success", command: "search", data: {} })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    await cliSearch({ keyword: "warrior", format: "json" });

    expect(mockApp.ExecuteCLI).toHaveBeenCalledWith("search", {
      keyword: "warrior",
      format: "json",
    });
  });

  it("cliList 调用 list 命令", async () => {
    const mockApp = {
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({ status: "success", command: "list", data: {} })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    await cliList();

    expect(mockApp.ExecuteCLI).toHaveBeenCalledWith("list", {});
  });

  it("cliAnalyze 传递 model 参数", async () => {
    const mockApp = {
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({ status: "success", command: "analyze", data: {} })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    await cliAnalyze({ model: "/path/to/model.ysm" });

    expect(mockApp.ExecuteCLI).toHaveBeenCalledWith("analyze", {
      model: "/path/to/model.ysm",
    });
  });

  it("cliCacheStatus 调用 cache-status 命令", async () => {
    const mockApp = {
      ExecuteCLI: vi.fn().mockResolvedValue(
        JSON.stringify({ status: "success", command: "cache-status", data: {} })
      ),
    } as unknown as AppBindings;

    vi.mocked(getApp).mockResolvedValue(mockApp);

    await cliCacheStatus();

    expect(mockApp.ExecuteCLI).toHaveBeenCalledWith("cache-status", {});
  });
});

describe("CLI Bridge - 响应解析", () => {
  it("解析有效 JSON 响应", () => {
    const raw = JSON.stringify({
      status: "success",
      command: "test",
      data: { key: "value" },
    });

    const result = parseCLIResponse(raw);

    expect(result.status).toBe("success");
    expect(result.command).toBe("test");
    expect(result.data?.key).toBe("value");
  });

  it("解析无效 JSON 返回错误", () => {
    const result = parseCLIResponse("invalid json");

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("parse_error");
  });
});

describe("CLI Bridge - 参数构建", () => {
  it("过滤 undefined 值", () => {
    const result = buildArgsMap({
      keyword: "test",
      format: undefined,
      count: 5,
      verbose: true,
    });

    expect(result).toEqual({
      keyword: "test",
      count: 5,
      verbose: true,
    });
    expect(result).not.toHaveProperty("format");
  });

  it("过滤 null 值", () => {
    const result = buildArgsMap({
      keyword: null as unknown as string | undefined,
      valid: "yes",
    });

    expect(result).toEqual({ valid: "yes" });
    expect(result).not.toHaveProperty("keyword");
  });

  it("空对象返回空 map", () => {
    const result = buildArgsMap({});

    expect(result).toEqual({});
  });
});

describe("CLI Bridge - 白名单常量", () => {
  it("包含所有预期命令", () => {
    const expected = [
      "search", "analyze", "list", "verify", "benchmark", "export",
      "file-bench", "single-bench", "concurrent-bench",
      "scan-dir", "analyze-mmd", "perf-log",
      "cache-status", "cache-verify", "cache-clear", "cache-diag",
      "config-show", "gui-flow",
      "resource-scan", "repo-audit",
    ];

    for (const cmd of expected) {
      expect(ALLOWED_CLI_COMMANDS).toContain(cmd);
    }
  });

  it("数量正确", () => {
    expect(ALLOWED_CLI_COMMANDS).toHaveLength(25);
  });

  it("类型安全：只能传入白名单中的命令", () => {
    // 验证 AllowedCLICommand 类型
    const validCmd: (typeof ALLOWED_CLI_COMMANDS)[number] = "search";
    expect(ALLOWED_CLI_COMMANDS).toContain(validCmd);
  });
});
