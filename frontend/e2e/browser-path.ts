// ===== E2E 浏览器可执行文件探测（跨机器通用，不写死任何绝对路径）=====
//
// 背景：Playwright 的浏览器下载走 CDN，在受限网络下 `npx playwright install` 会失败；
// 而本机往往**已存在**某个版本的 chromium（其他项目/历史安装留下），只是版本号与
// 当前 @playwright/test 期望的不一致（如期望 1243、实际 1228）→ 默认解析必然
// "Executable doesn't exist"，导致 e2e 整层不可用。
//
// 本模块扫 `ms-playwright/` 目录，挑一个**实际存在**的 chromium 可执行文件返回。
// 找不到则返回 undefined —— 此时交给 Playwright 默认解析（CI 上正常安装了浏览器的
// 场景走的正是这条路，行为与改造前完全一致）。
//
// ⚠️ 为什么必须写进 `projects[].use` 而不是顶层 `use`：
//    顶层 `use.executablePath` 会**被 project 级 use 覆盖**——`projects[].use` 展开的
//    `devices["Desktop Chrome"]` 携带 `defaultBrowserType`，使浏览器解析整体回到默认
//    路径，顶层 executablePath 形同虚设（实测：同一份 spec，放顶层仍报
//    "Executable doesn't exist ... 1243"，放进 project 则通过）。
import fs from "node:fs";
import path from "node:path";

/** ms-playwright 根目录（Playwright 自身的浏览器缓存位置，跨平台约定）。 */
function browsersRoot(): string | null {
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

/** 单个浏览器目录内，各平台可执行文件的相对位置。 */
function candidatesIn(dir: string): string[] {
  if (process.platform === "win32") {
    return [
      path.join(dir, "chrome-win64", "chrome.exe"),
      path.join(dir, "chrome-win", "chrome.exe"),
      path.join(dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      path.join(dir, "chrome-headless-shell-win", "chrome-headless-shell.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      path.join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(dir, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
      path.join(dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
      path.join(dir, "chrome-headless-shell-mac", "chrome-headless-shell"),
    ];
  }
  return [
    path.join(dir, "chrome-linux", "chrome"),
    path.join(dir, "chrome-headless-shell-linux64", "chrome-headless-shell"),
  ];
}

/**
 * 挑一个本机实际存在的 chromium 可执行文件。
 * 优先级：完整版 chromium（带 GPU 栈，WebGL 更可靠）> headless shell（更省资源）；
 * 同为完整版时取版本号大者。
 *
 * @returns 可执行文件绝对路径；本机无任何可用浏览器时返回 undefined。
 */
export function findLocalChromium(): string | undefined {
  const root = browsersRoot();
  if (!root || !fs.existsSync(root)) return undefined;

  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return undefined;
  }

  const pick = (prefix: string): string | undefined => {
    const dirs = entries
      .filter((e) => e.startsWith(prefix))
      .sort((a, b) => {
        // 版本号降序（chromium-1228 → 1228），数字比较避免 "999" > "1000" 的字典序坑
        const n = (s: string): number => Number(s.slice(prefix.length)) || 0;
        return n(b) - n(a);
      });
    for (const d of dirs) {
      for (const exe of candidatesIn(path.join(root, d))) {
        if (fs.existsSync(exe)) return exe;
      }
    }
    return undefined;
  };

  return pick("chromium-") ?? pick("chromium_headless_shell-");
}

/**
 * 探测到本机 chromium 时返回 `{ executablePath }`，否则返回空对象。
 * 用法（**必须**写进 projects[].use，见文件头说明）：
 *
 * ```ts
 * projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...localChromiumUse() } }]
 * ```
 */
export function localChromiumUse(): { executablePath?: string } {
  const p = findLocalChromium();
  return p ? { executablePath: p } : {};
}
