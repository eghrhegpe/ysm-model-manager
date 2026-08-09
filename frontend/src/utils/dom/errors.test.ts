// ===== friendlyError 错误友好化测试（ADR-014 P2 + ADR-045 i18n）=====
// Go 原始错误 → 友好提示；覆盖空值/中文直通/模式匹配/兜底四类路径。
// i18n t() 已由 test-setup.ts 全局 mock，无需重复。
import { describe, it, expect } from "vitest";
import { friendlyError } from "./errors.ts";

describe("friendlyError 空值与中文直通", () => {
  it("null/undefined/空串 → 未知错误", () => {
    expect(friendlyError(null)).toBe("未知错误");
    expect(friendlyError(undefined)).toBe("未知错误");
    expect(friendlyError("")).toBe("未知错误");
  });

  it("已含中文的字符串直接返回", () => {
    expect(friendlyError("磁盘已满，请清理")).toBe("磁盘已满，请清理");
  });

  it("已含中文的 Error.message 直接返回", () => {
    expect(friendlyError(new Error("存储路径未配置"))).toBe("存储路径未配置");
  });
});

describe("friendlyError 社区高频错误", () => {
  it("429 / rate limit → GitHub 频率受限", () => {
    expect(friendlyError("HTTP 429")).toBe("⏱️ GitHub API 频率限制，请稍后重试或改用浏览器打开");
    expect(friendlyError("rate limit exceeded")).toBe(
      "⏱️ GitHub API 频率限制，请稍后重试或改用浏览器打开",
    );
  });

  it("abort / cancelled → 请求已取消", () => {
    expect(friendlyError("The operation was aborted")).toBe("请求已取消");
    expect(friendlyError("request cancelled")).toBe("请求已取消");
  });

  it("parse / unexpected token → 数据格式异常", () => {
    expect(friendlyError("Unexpected token < in JSON")).toBe("数据格式异常");
    expect(friendlyError(new Error("malformed response"))).toBe("数据格式异常");
  });

  it("dns / ENOTFOUND → 域名解析失败", () => {
    expect(friendlyError("getaddrinfo ENOTFOUND example.com")).toBe(
      "域名解析失败，请检查网络连接",
    );
  });

  it("connection refused / socket → 连接中断", () => {
    expect(friendlyError("connect ECONNREFUSED 127.0.0.1:443")).toBe(
      "连接中断，请检查网络稳定性",
    );
    expect(friendlyError("socket hang up")).toBe("连接中断，请检查网络稳定性");
  });

  it("ssl / tls / certificate → SSL/TLS 错误", () => {
    expect(friendlyError("certificate has expired")).toBe(
      "SSL/TLS 连接错误，请检查系统时间或网络",
    );
  });
});

describe("friendlyError 通用文件/网络错误", () => {
  it("access denied / EACCES → 权限不足", () => {
    expect(friendlyError("EACCES: permission denied")).toBe("权限不足，无法访问文件");
    expect(friendlyError("Access is denied.")).toBe("权限不足，无法访问文件");
  });

  it("no such file / not found → 文件或目录不存在", () => {
    expect(friendlyError("no such file or directory")).toBe("文件或目录不存在");
    expect(friendlyError(new Error("cannot find module 'x'"))).toBe(
      "文件或目录不存在",
    );
  });

  it("文件被占用 / locked → 提示关闭程序", () => {
    expect(friendlyError("file is locked by another process")).toBe(
      "文件被其他程序占用，请关闭相关程序后重试",
    );
    expect(friendlyError("sharing violation")).toBe(
      "文件被其他程序占用，请关闭相关程序后重试",
    );
  });

  it("empty / no files → 目录为空", () => {
    expect(friendlyError("directory is empty")).toBe("目录为空，没有可操作的文件");
    expect(friendlyError("no files to process")).toBe("目录为空，没有可操作的文件");
  });

  it("timeout → 连接超时", () => {
    expect(friendlyError("request timed out")).toBe("连接超时，请检查网络");
  });

  it("network / proxy / fetch → 网络连接异常", () => {
    expect(friendlyError("NetworkError when attempting to fetch")).toBe(
      "网络连接异常",
    );
  });

  it("invalid argument → 参数无效", () => {
    expect(friendlyError("EINVAL: invalid argument")).toBe("参数无效");
  });

  it("already exists → 文件已存在", () => {
    expect(friendlyError("destination already exists")).toBe("文件已存在");
  });

  it("disk full / no space → 磁盘空间不足", () => {
    expect(friendlyError("ENOSPC: no space left on device")).toBe("磁盘空间不足");
  });

  it("unsupported → 不支持的格式或操作", () => {
    expect(friendlyError("operation not supported")).toBe("不支持的格式或操作");
  });

  it("too many（非 requests）→ 操作过于频繁", () => {
    expect(friendlyError("too many open files")).toBe("操作过于频繁，请稍后重试");
  });

  it("not a directory / is a directory → 路径类型错误", () => {
    expect(friendlyError("ENOTDIR: not a directory")).toBe("路径不是目录");
    expect(friendlyError("EISDIR: is a directory")).toBe("路径是目录，不是文件");
  });
});

describe("friendlyError 兜底与对象处理", () => {
  it("未匹配英文错误 → fallback 前缀拼接", () => {
    expect(friendlyError("quantum flux")).toBe("操作失败: quantum flux");
  });

  it("自定义 fallback 生效", () => {
    expect(friendlyError("quantum flux", "重命名失败")).toBe(
      "重命名失败: quantum flux",
    );
  });

  it("Error 对象提取 message 参与匹配", () => {
    expect(friendlyError(new Error("ENOTFOUND host"))).toBe(
      "域名解析失败，请检查网络连接",
    );
  });

  it("无 message 的对象走 String(err) 兜底", () => {
    const result = friendlyError({});
    expect(result).toBe("操作失败: [object Object]");
  });
});
