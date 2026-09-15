/**
 * tool-bin.ts — `node_modules/.bin` 工具二进制的双根探测解析（单一事实源）。
 *
 * 背景（2026-09-15 CI 实证，ADR-244 同族病理）：
 *   - **本地**开发常在仓库根跑 `npm i` ⇒ 工具落在 `<ROOT>/node_modules/.bin`；
 *   - **CI**（`.github/workflows/test.yml`）只在 `frontend/` 跑 `pnpm install` ⇒ 工具只落在
 *     `<ROOT>/frontend/node_modules/.bin`，根目录根本不存在。
 *   任何硬编码单一路径的调用点都是「本地绿、CI 红」的定时炸弹——`pre-push-gate` 的
 *   scripts typecheck 就因写死根路径，在 CI 报 cmd 的
 *   `The system cannot find the path specified.` 并以 hard 策略阻断整步。
 *
 * 约定（与 `check-deadcode-baseline` 原内联实现对齐，现收敛于此）：
 *   1. 两处都探，**根优先**（npm hoist 语义：hoist 后根是真实落点）；
 *   2. win32 优先 `.cmd`（npm shim 真实形态，`shell: true` 走 cmd.exe），
 *      plain 次之，`.ps1` 最后兜底（cmd.exe 不直接执行 .ps1）；
 *   3. 非 win32 优先 plain。
 *
 * 依赖：node:fs / node:path / scan-files.ts（ROOT）。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./scan-files.ts";

/** 探测目录顺序（根优先）。新增安装点须同时更新此处与契约测试。 */
export const TOOL_BIN_DIRS = [
  path.join(ROOT, "node_modules", ".bin"),
  path.join(ROOT, "frontend", "node_modules", ".bin"),
];

/**
 * 生成候选绝对路径（纯函数，供契约测试钉形状 + 顺序）。
 *
 * `platform` / `dirs` 可注入：生产调用用默认值，测试可脱离环境断言。
 */
export function toolBinCandidates(
  name: string,
  platform: NodeJS.Platform = process.platform,
  dirs: readonly string[] = TOOL_BIN_DIRS,
): string[] {
  const exts = platform === "win32" ? [".cmd", "", ".ps1"] : ["", ".ps1"];
  return dirs.flatMap((dir) => exts.map((ext) => path.join(dir, `${name}${ext}`)));
}

/** 解析工具二进制：按候选顺序取第一个真实存在的；全无 → `null`（不猜、不退化）。 */
export function resolveToolBin(name: string): string | null {
  return toolBinCandidates(name).find((c) => fs.existsSync(c)) ?? null;
}
