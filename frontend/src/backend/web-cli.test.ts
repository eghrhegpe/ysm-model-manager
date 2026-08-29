// @vitest-environment node
// ===== web-cli 网页版 CLI 绑定测试 =====
// webCliBindings 是纯静态绑定（无 Wails 桥 / DOM），node 环境直测：
// GetAllowedCLICommands 序列化 CLI_ALLOWLIST；ExecuteCLI 已按 ADR-123 P2 移出注册表
// （假实现会令 can() 门控失效），此处作为回归红线断言其不存在。
import { describe, it, expect } from "vitest";
import { webCliBindings } from "./web-cli.ts";
import { CLI_ALLOWLIST } from "./cli-allowlist.ts";

describe("webCliBindings", () => {
  it("GetAllowedCLICommands 返回 CLI_ALLOWLIST 的 JSON 序列化（逐项一致）", async () => {
    const raw = await webCliBindings.GetAllowedCLICommands();
    expect(typeof raw).toBe("string");
    const parsed: unknown = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    // 与单一事实源逐项深比对（顺序敏感：桌面端按序展示命令列）
    expect(parsed).toEqual(CLI_ALLOWLIST);
  });

  it("allowlist 内容健全：非空、全为字符串、含核心命令", async () => {
    const parsed: string[] = JSON.parse(await webCliBindings.GetAllowedCLICommands());
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    for (const core of ["search", "analyze", "list", "verify", "export", "cache-status"]) {
      expect(parsed).toContain(core);
    }
  });

  it("ADR-123 P2 回归红线：ExecuteCLI 不得注册（假实现令 can() 门控失效）", () => {
    expect(Object.keys(webCliBindings)).not.toContain("ExecuteCLI");
    expect(Object.keys(webCliBindings)).toEqual(["GetAllowedCLICommands"]);
  });
});
