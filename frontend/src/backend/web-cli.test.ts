// @vitest-environment node
// ===== web-cli 网页版 CLI 绑定测试 =====
// webCliBindings 是纯静态绑定（无 Wails 桥 / DOM），node 环境直测：
// GetAllowedCLICommands 序列化 CLI_ALLOWLIST；ExecuteCLI 已按 ADR-123 P2 移出注册表
// （假实现会令 can() 门控失效），此处作为回归红线断言其不存在。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { webCliBindings } from "./web-cli.ts";
import { CLI_ALLOWLIST } from "./cli-allowlist.ts";

/**
 * Go 侧 CLI 命令单一事实源：docs/cli-commands.md（gen-cli-doc.ts 自动生成，
 * 从 go/cli/ 注册表静态提取，`--check` 已接入 doctor 防漂移）。
 * 解析 `### \`cmd\`` 顶层命令块 → 命令名集合。
 */
function goCliCommands(): Set<string> {
  const path = fileURLToPath(new URL("../../../docs/cli-commands.md", import.meta.url));
  const md = readFileSync(path, "utf-8");
  const names = new Set<string>();
  for (const m of md.matchAll(/^### `([^`]+)`/gm)) names.add(m[1]);
  return names;
}

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

  it("CLI_ALLOWLIST 必须是 Go 命令集的子集（防放行 Go 不存在的命令→ 两端漂移守卫）", async () => {
    // Go 侧注册表 39 命令（docs/cli-commands.md 单一事实源，gen 自动同步）；
    // 前端白名单是手选子集（网页版只放行安全的），允许少于 Go 全集，
    // 但绝不允许出现 Go 没注册的命令——否则 UI 放行了一个必然失败的入口。
    const goCommands = goCliCommands();
    expect(goCommands.size).toBeGreaterThanOrEqual(CLI_ALLOWLIST.length);
    for (const cmd of CLI_ALLOWLIST) {
      expect(goCommands.has(cmd)).toBe(true);
    }
  });

  it("ADR-123 P2 回归红线：ExecuteCLI 不得注册（假实现令 can() 门控失效）", () => {
    expect(Object.keys(webCliBindings)).not.toContain("ExecuteCLI");
    expect(Object.keys(webCliBindings)).toEqual(["GetAllowedCLICommands"]);
  });
});
