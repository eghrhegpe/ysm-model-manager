// @vitest-environment node
// ===== friendlyError 错误友好化测试（ADR-014 P2 + ADR-045 i18n + ADR-051 单一事实来源）=====
// Go 原始错误 → 友好提示；覆盖空值/中文直通/结构化 Code/兜底四类路径。
// ADR-051：删除正则兜底表，只消费结构化 AppError.Code。
import { describe, it, expect, vi } from "vitest";

// 本地 mock t() —— 返回 key 本身。注意：isolate:false 共享模块图下 per-file vi.mock
// 与 test-setup 全局 zhCN mock 竞争同一模块，先到先得会让本文件或兄弟文件拿错绑定
// （期望 key 收到中文 / 期望中文收到 key）。用 resetModules + 动态 import 把 errors.ts
// 的求值限定在本文件 mock 表内，互不污染。
vi.mock("../../core/i18n/t.ts", () => ({
  t: (key: string): string => key,
}));
vi.resetModules();
const { friendlyError, stripPathSegments, isFileExistsError } = await import("./errors.ts");

describe("friendlyError 空值与中文直通", () => {
  it("null/undefined/空串 → 未知错误", () => {
    expect(friendlyError(null)).toBe("error.unknown");
    expect(friendlyError(undefined)).toBe("error.unknown");
    expect(friendlyError("")).toBe("error.unknown");
  });

  it("已含中文的字符串直接返回", () => {
    expect(friendlyError("磁盘已满，请清理")).toBe("磁盘已满，请清理");
  });

  it("已含中文的 Error.message 直接返回", () => {
    expect(friendlyError(new Error("存储路径未配置"))).toBe("存储路径未配置");
  });
});

describe("friendlyError 结构化 AppError Code（ADR-051 单一事实来源）", () => {
  it("err.cause.Code 已知 → 映射 i18n（Wails RuntimeError 形状）", () => {
    const err = new Error("问题描述：文件已存在 操作：导入模型");
    (err as { cause?: unknown }).cause = { Code: "FILE_EXISTS" };
    expect(friendlyError(err)).toBe("error.alreadyExists");
  });

  it("err.Code 已知（兼容兜底形状）→ 映射 i18n", () => {
    expect(friendlyError({ Code: "UNSUPPORTED_FORMAT" })).toBe("error.unsupported");
    expect(friendlyError({ Code: "INVALID_PARAM" })).toBe("error.invalidArg");
    expect(friendlyError({ Code: "DECODE_FAILED" })).toBe("error.dataFormat");
    expect(friendlyError({ Code: "FILENAME_INVALID" })).toBe("error.invalidArg");
    expect(friendlyError({ Code: "INVALID_PATH" })).toBe("error.invalidArg");
    expect(friendlyError({ Code: "ALREADY_EXISTS" })).toBe("error.alreadyExists");
  });

  it("未知 Code → 透传中文 Reason 或 fallback", () => {
    // FILE_TOO_LARGE：中文 Reason 透传
    expect(friendlyError({ Code: "FILE_TOO_LARGE", message: "文件大小超过 500MB 限制" })).toBe(
      "文件大小超过 500MB 限制",
    );
    // FILE_EMPTY：中文 Reason 透传
    expect(friendlyError({ Code: "FILE_EMPTY", message: "文件内容为空" })).toBe("文件内容为空");
    // LINK_FAILED：中文 Reason 透传
    expect(friendlyError({ Code: "LINK_FAILED", message: "创建符号链接需要管理员权限" })).toBe(
      "创建符号链接需要管理员权限",
    );
    // IO_ERROR：英文 message → fallback（Go 端不会这样，仅测试兜底）
    expect(friendlyError({ Code: "IO_ERROR", message: "io: read/write on closed file" })).toBe(
      "error.fallback: io: read/write on closed file",
    );
    // WRITE_FAILED：英文 message → fallback
    expect(friendlyError({ Code: "WRITE_FAILED", message: "写入失败: boom" })).toBe(
      "写入失败: boom",
    );
    // MKDIR_FAILED：中文 Reason 透传
    expect(friendlyError({ Code: "MKDIR_FAILED", message: "无法创建目标目录" })).toBe(
      "无法创建目标目录",
    );
  });

  it("未知 Code 含内部路径 → stripPathSegments 后 fallback", () => {
    const msg = "无法创建目标目录 源路径：C:\\Users\\test 目标路径：D:\\game 解决建议：重试";
    expect(friendlyError({ Code: "MKDIR_FAILED", message: msg })).toBe(
      "无法创建目标目录 解决建议：重试",
    );
  });
});

describe("friendlyError 兜底与非结构化输入", () => {
  it("纯英文字符串（非 AppError）→ fallback 前缀拼接", () => {
    expect(friendlyError("quantum flux")).toBe("error.fallback: quantum flux");
  });

  it("自定义 fallback 生效", () => {
    expect(friendlyError("quantum flux", "重命名失败")).toBe(
      "重命名失败: quantum flux",
    );
  });

  it("Error 对象提取 message → fallback（无 Code 且不含中文）", () => {
    expect(friendlyError(new Error("ENOTFOUND host"))).toBe("error.fallback: ENOTFOUND host");
  });

  it("无 message 的对象走 String(err) 兜底", () => {
    const result = friendlyError({});
    expect(result).toBe("error.fallback: [object Object]");
  });

  it("含中文的 Error.message → 直接透传", () => {
    expect(friendlyError(new Error("网络超时，请重试"))).toBe("网络超时，请重试");
  });
});

// P3 补测（审核）：非对象 truthy/falsy 输入 + cause.Code 嵌套对象 + stripPathSegments 直测
describe("friendlyError — 边界输入与嵌套 cause", () => {
  it("0 / false 等 falsy 值 → 未知错误", () => {
    expect(friendlyError(0)).toBe("error.unknown");
    expect(friendlyError(false)).toBe("error.unknown");
  });

  it("纯对象 cause.Code 已知 → 映射 i18n", () => {
    expect(friendlyError({ cause: { Code: "FILE_EXISTS" } })).toBe("error.alreadyExists");
  });

  it("cause.Code 未知 + 外层英文 message → fallback", () => {
    const err = new Error("boom: io error");
    (err as { cause?: unknown }).cause = { Code: "IO_ERROR" };
    expect(friendlyError(err)).toBe("error.fallback: boom: io error");
  });

  it("Code 为空串 + 中文 message → 透传中文", () => {
    expect(friendlyError({ Code: "", message: "网络超时，请重试" })).toBe("网络超时，请重试");
  });
});

describe("stripPathSegments — 内部路径剥离（导出直测）", () => {
  it("源路径+目标路径整段剥离，保留解决建议", () => {
    expect(stripPathSegments("无法创建目标目录 源路径：C:\\a 目标路径：D:\\b 解决建议：重试")).toBe(
      "无法创建目标目录 解决建议：重试",
    );
  });

  it("仅源路径且无后续标记 → 剥到行尾", () => {
    expect(stripPathSegments("无法创建 源路径：C:\\a 无后续")).toBe("无法创建");
  });

  it("无路径标记的文案原样保留", () => {
    expect(stripPathSegments("文件内容为空")).toBe("文件内容为空");
  });
});

describe("isFileExistsError — 文件冲突判定", () => {
  it("结构化 Code: FILE_EXISTS / ALREADY_EXISTS → true", () => {
    expect(isFileExistsError({ cause: { Code: "FILE_EXISTS" } })).toBe(true);
    expect(isFileExistsError({ cause: { Code: "ALREADY_EXISTS" } })).toBe(true);
    expect(isFileExistsError({ Code: "FILE_EXISTS" })).toBe(true);
  });

  it("字符串匹配: 目标已存在 / 文件已存在 → true", () => {
    expect(isFileExistsError("目标已存在，请更换名称")).toBe(true);
    expect(isFileExistsError("文件已存在")).toBe(true);
    expect(isFileExistsError("FILE_EXISTS: duplicate")).toBe(true);
  });

  it("非冲突错误 → false", () => {
    expect(isFileExistsError({ cause: { Code: "IO_ERROR" } })).toBe(false);
    expect(isFileExistsError("网络超时")).toBe(false);
    expect(isFileExistsError(null)).toBe(false);
    expect(isFileExistsError(undefined)).toBe(false);
    expect(isFileExistsError("")).toBe(false);
  });
});
