// ===== E2E 浏览器可执行文件探测（跨机器通用，不写死任何绝对路径）=====
//
// 背景：Playwright 的浏览器下载走 CDN，在受限网络下 `npx playwright install` 会失败；
// 而本机往往**已存在**某个版本的 chromium（其他项目/历史安装留下）。注意病根不止一种：
//   · headed / 默认 full 解析期望 `chromium-<期望修订>`，缺失才 "Executable doesn't exist"；
//   · headless 默认解析走 `chromium_headless_shell-<期望修订>`——shell 在场时 headless 本可跑
//     （「默认解析必然失败」只对 full 路径成立，2026-10 锐评 P1-1 修正）；
//   · 多项目共享 ms-playwright 缓存时还会混入**更新**修订（chromium-1300 vs 期望 1243）——
//     盲目「数字最大优先」会钉比驱动更新的浏览器，比默认解析更糟。
//
// 本模块扫 `ms-playwright/` 目录，挑一个**实际存在**的 chromium 可执行文件返回。
// 优先级（锐评 P1-1 收口）：
//   · 默认：期望修订 full → 期望修订 shell → 最大修订 full → 最大修订 shell
//     （「期望修订」从 playwright-core registry 的 browsers.json 推导 = 与驱动同版；
//      推导失败时两步自然 no-op，退化为原启发式）；
//   · preferFull（WebGL 链路消费方，如 postprocessing.spec）：期望 full → 最大 full → 期望 shell → 最大 shell
//     （「完整版带 GPU 栈」的理由只对 WebGL 用例有意义，别压在不跑 WebGL 的套件上——P1-2 观察）。
//
// 找不到则返回 undefined —— 展开为 {} → 交给 Playwright 默认解析。注意因果（锐评修正）：
// CI 正常装了浏览器的场景探测**成功**（钉期望修订，净效应与默认解析一致），{} 才是
// 「完全没有浏览器」的路径。
//
// 钉住方式（实测 + Playwright 源码五级链路验证，2026-10 锐评 P2-1 修正机制描述）：
// `executablePath` 只存在于 LaunchOptions（类型可证）；use 袋的键只有命中已注册 option
// fixture 才绑定，未知键（如平铺 `use.executablePath`）**任何层级都静默忽略**（fixture 袋
// 不校验、validateConfig 不查 use 键）。必须嵌套 `use.launchOptions.executablePath`——
// 顶层 use 与 projects[].use 都生效（约定写 projects[].use），勿回退成平铺。
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Arch = "x64" | "arm64";

/** 平台×架构 → 完整版 chromium 可执行文件相对浏览器目录的路径（单候选）。
 *  与 playwright-core registry 的 EXECUTABLE_PATHS 同表（registry 改名即由
 *  test_e2e_browser_path ⑨ registry 对拍契约抓出——静态表防脱节靠对拍，不靠注释）。 */
const FULL_RELS: Record<string, string> = {
  "win32-x64": path.join("chrome-win64", "chrome.exe"),
  "linux-x64": path.join("chrome-linux64", "chrome"),
  "linux-arm64": path.join("chrome-linux-arm64", "chrome"),
  "darwin-x64": path.join(
    "chrome-mac-x64",
    "Google Chrome for Testing.app",
    "Contents",
    "MacOS",
    "Google Chrome for Testing",
  ),
  "darwin-arm64": path.join(
    "chrome-mac-arm64",
    "Google Chrome for Testing.app",
    "Contents",
    "MacOS",
    "Google Chrome for Testing",
  ),
};

/** 平台×架构 → headless shell 可执行文件相对浏览器目录的路径（单候选）。 */
const SHELL_RELS: Record<string, string> = {
  "win32-x64": path.join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  "linux-x64": path.join("chrome-headless-shell-linux64", "chrome-headless-shell"),
  "linux-arm64": path.join("chrome-headless-shell-linux-arm64", "chrome-headless-shell"),
  "darwin-x64": path.join("chrome-headless-shell-mac-x64", "chrome-headless-shell"),
  "darwin-arm64": path.join("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
};

/** 默认架构（darwin/linux 候选表分 arch；win32 无 arm64 表项时回落 x64）。 */
function defaultArch(): Arch {
  return process.arch === "arm64" ? "arm64" : "x64";
}

/** 完整版候选表（导出供 registry 对拍契约消费）。 */
export function fullExeRels(
  platform: NodeJS.Platform = process.platform,
  arch: Arch = defaultArch(),
): string[] {
  const rel = FULL_RELS[`${platform}-${arch}`] ?? FULL_RELS[`${platform}-x64`];
  return rel ? [rel] : [];
}

/** headless shell 候选表（导出供 registry 对拍契约消费）。 */
export function shellExeRels(
  platform: NodeJS.Platform = process.platform,
  arch: Arch = defaultArch(),
): string[] {
  const rel = SHELL_RELS[`${platform}-${arch}`] ?? SHELL_RELS[`${platform}-x64`];
  return rel ? [rel] : [];
}

/** 按「ms-playwright 根 + 目录名 + 候选相对路径」挑第一个实际存在的可执行文件。 */
function pickInDir(
  root: string,
  dir: string | null | undefined,
  rels: string[],
): string | undefined {
  if (!dir) return undefined;
  for (const rel of rels) {
    const p = path.join(root, dir, rel);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * ms-playwright 根目录（Playwright 自身的浏览器缓存位置，跨平台约定）。
 * 认 `PLAYWRIGHT_BROWSERS_PATH`（registry 自身语义，锐评 P2-5：registry 认而我们不能盲）：
 *   "0" = 包内 .local-browsers（随 playwright-core 包目录解析）；其余值 = 自定义目录。
 */
export function browsersRoot(): string | null {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (env) {
    if (env === "0") {
      const pkgDir = resolvePlaywrightCoreDir();
      return pkgDir ? path.join(pkgDir, ".local-browsers") : null;
    }
    return env;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return path.join(local, "ms-playwright");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Caches", "ms-playwright");
  }
  return path.join(home, ".cache", "ms-playwright");
}

/** 解析 playwright-core 包目录（模块所在目录 → 仓库根 → cwd 逐级试；pnpm 布局下
 * frontend/node_modules 未必有顶层链接，仓库根 node_modules 常有——必须多跳）。 */
function resolvePlaywrightCoreDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const base of [here, path.resolve(here, "../.."), process.cwd()]) {
    try {
      return path.dirname(createRequire(base).resolve("playwright-core"));
    } catch {
      // 试下一跳
    }
  }
  return null;
}

/**
 * playwright-core registry 事实源：browsers.json 里两个 chromium 条目的期望修订号
 * （「期望修订优先」步的输入；不可解析/不可读返回 null → 该步 no-op，退化为启发式）。
 * 磁盘目录命名约定：浏览器名 dash→underscore + "-" + 修订（registry isBrowserDirectory 规则）。
 */
export function registryFacts(): { chromiumRev: string; shellRev: string } | null {
  const pkgDir = resolvePlaywrightCoreDir();
  if (!pkgDir) return null;
  try {
    const entries: Array<{ name: string; revision: string | number }> = JSON.parse(
      fs.readFileSync(path.join(pkgDir, "browsers.json"), "utf8"),
    ).browsers;
    const cr = entries.find((b) => b.name === "chromium")?.revision;
    if (cr == null) return null;
    const shell = entries.find((b) => b.name === "chromium-headless-shell")?.revision ?? cr;
    return { chromiumRev: String(cr), shellRev: String(shell) };
  } catch {
    return null;
  }
}

/** 期望目录名（full / shell）；推导失败给 null（pickInDir 对 null 天然 no-op）。 */
function expectedDirNames(): { full: string | null; shell: string | null } {
  const facts = registryFacts();
  if (!facts) return { full: null, shell: null };
  return {
    full: `chromium-${facts.chromiumRev}`,
    shell: `chromium_headless_shell-${facts.shellRev}`,
  };
}

/**
 * 挑一个本机实际存在的 chromium 可执行文件（锐评 P1-1 收口：版本优先，避免钉出比
 * 默认解析更差的版本）。
 *
 * 默认优先级：期望修订 full → 期望修订 shell → 最大修订 full → 最大修订 shell；
 * preferFull（WebGL 消费方）：期望 full → 最大 full → 期望 shell → 最大 shell。
 *
 * @param root ms-playwright 根目录（缺省 `browsersRoot()`；契约测试经此注入临时目录）
 * @param platform 目标平台（缺省 `process.platform`；契约测试经此做跨平台断言）
 * @param opts.preferFull 完整版优先（WebGL 链路消费方，见文件头说明）
 * @param opts.expected 显式指定期望目录（契约测试注入；null = 跳过版本优先步；缺省 = 自动从 registry 推导）
 * @param opts.arch 目标架构（darwin/linux 候选表分 arch；缺省 process.arch）
 * @returns 可执行文件绝对路径；本机无任何可用浏览器时返回 undefined。
 */
export function findLocalChromium(
  root: string | null = browsersRoot(),
  platform: NodeJS.Platform = process.platform,
  opts: {
    preferFull?: boolean;
    expected?: { full: string | null; shell: string | null } | null;
    arch?: Arch;
  } = {},
): string | undefined {
  if (!root || !fs.existsSync(root)) return undefined;

  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch (err) {
    // 锐评 P2-6：「没权限」与「没浏览器」在日志里必须可区分，否则 CI 上 EACCES 与空目录同症状
    console.warn(`[browser-path] 读取浏览器目录失败（${root}）：${String(err)}`);
    return undefined;
  }

  const arch = opts.arch ?? defaultArch();
  const fullRels = fullExeRels(platform, arch);
  const shellRels = shellExeRels(platform, arch);
  // 注意：显式 root（测试）+ 不传 expected 时也会自动推导期望修订——临时根里没有
  // 那些目录名，版本优先步自然 no-op，行为等同 expected: null。
  const expected = opts.expected ?? expectedDirNames();

  /** 目录名前缀 + 数字版本降序（避免 "999" > "1000" 字典序坑）挑第一个有可执行的 */
  const maxWith = (prefix: string, rels: string[]): string | undefined => {
    const dirs = entries
      .filter((e) => e.startsWith(prefix))
      .sort((a, b) => {
        const n = (s: string): number => Number(s.slice(prefix.length)) || 0;
        return n(b) - n(a);
      });
    for (const d of dirs) {
      const hit = pickInDir(root, d, rels);
      if (hit) return hit;
    }
    return undefined;
  };

  if (opts.preferFull) {
    return (
      pickInDir(root, expected.full, fullRels) ??
      maxWith("chromium-", fullRels) ??
      pickInDir(root, expected.shell, shellRels) ??
      maxWith("chromium_headless_shell-", shellRels)
    );
  }
  return (
    pickInDir(root, expected.full, fullRels) ??
    pickInDir(root, expected.shell, shellRels) ??
    maxWith("chromium-", fullRels) ??
    maxWith("chromium_headless_shell-", shellRels)
  );
}

/**
 * 探测到本机 chromium 时返回可直接展开进 `use` 的 `launchOptions` 片段，否则返回空对象。
 * 用法（约定写进 projects[].use；顶层 use 亦生效——见文件头机制说明）：
 *
 * ```ts
 * projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...localChromiumUse() } }]
 * ```
 *
 * ⚠️ 返回值是 `launchOptions` 嵌套形（`executablePath` 只存在于 LaunchOptions 内，
 * Playwright 类型可证）：`use` 袋对平铺的未知键静默忽略（fixture 袋不校验），
 * 平铺写 `use.executablePath` 不生效——勿回退。
 */
export function localChromiumUse(): { launchOptions?: { executablePath: string } } {
  const p = findLocalChromium();
  return p ? { launchOptions: { executablePath: p } } : {};
}

/**
 * WebGL 链路（e2e-web spec 级硬钉 executablePath）：探测命中 → 返回钉住的 chromium；
 * 探测不到 → 抛清晰错误（有意语义：环境缺失即启动失败，防「环境没了测试却全绿」，
 * 见 e2e-web/postprocessing.spec.ts 头注）。
 *
 * 2026-10 收口：此前三个 e2e-web spec 各自 `?? 硬编码 ${LOCALAPPDATA}\ms-playwright\
 * chromium-1228\chrome.exe` 兜底——跨平台假路径（Linux/CI 上 LOCALAPPDATA 未定义、
 * 修订号 1228 写死），且三份复制。兜底逻辑归本模块单点：抛错而非给假路径。
 */
export function pinnedChromiumOrThrow(opts: { preferFull?: boolean } = {}): string {
  const p = findLocalChromium(undefined, undefined, opts);
  if (p) return p;
  throw new Error(
    `[e2e-web] 无可用本机 chromium（browsersRoot=${browsersRoot() ?? "不可推导"}）：` +
      `先跑 pnpm exec playwright install chromium，或用 PLAYWRIGHT_BROWSERS_PATH 指到既有浏览器目录`,
  );
}
