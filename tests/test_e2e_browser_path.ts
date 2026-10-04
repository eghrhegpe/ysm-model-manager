#!/usr/bin/env node
/**
 * 契约测试：frontend/e2e/browser-path.ts 浏览器探测逻辑。
 *
 * 背景：探测逻辑是纯 fs 扫描（挑本机实际存在的 chromium，优先完整版、版本降序、
 * headless shell 兜底），此前无人钉死——「999 > 1000 字典序坑」「完整版优先于
 * 高版本 headless」全靠肉眼。本测试用临时目录注入 root/platform 参数全覆盖。
 *
 * 覆盖清单：
 *   ① 完整版 chromium 优先于 headless shell（即使 headless 版本号更大）
 *   ② 版本号数字比较（chromium-1000 胜 chromium-999，非字典序）
 *   ③ 仅 headless shell 时兜底
 *   ④ win32 32 位 chrome-win/ 变体
 *   ⑤ linux / darwin 候选路径冒烟
 *   ⑥ 根目录不存在 / 空目录 / 有目录无 exe → undefined
 *   ⑦ localChromiumUse() 形状契约：{} 或 { launchOptions: { executablePath: 存在的文件 } }
 *
 * 本文件由 tests/ 自动发现机制纳入 doctor / pre-push 门禁（scripts/_lib/contract-tests.ts）。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLocalChromium, localChromiumUse } from "../frontend/e2e/browser-path.ts";

type Platform = "win32" | "darwin" | "linux";

/** 各平台「完整版 chromium」可执行文件相对浏览器目录的路径（与 browser-path.ts 候选表同源）。 */
const CHROMIUM_REL: Record<Platform, string> = {
  win32: path.join("chrome-win64", "chrome.exe"),
  darwin: path.join("chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
  linux: path.join("chrome-linux", "chrome"),
};

/** 各平台「headless shell」可执行文件相对浏览器目录的路径。 */
const SHELL_REL: Record<Platform, string> = {
  win32: path.join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  darwin: path.join("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
  linux: path.join("chrome-headless-shell-linux64", "chrome-headless-shell"),
};

interface Item {
  /** 浏览器目录名（chromium-1228 / chromium_headless_shell-1228 / ...）。 */
  dir: string;
  /** 可执行文件相对浏览器目录的路径；"" 表示只建目录不建 exe。 */
  rel: string;
}

/** 在临时目录铺一个 ms-playwright 根（若干浏览器目录 + 可执行文件占位）。 */
function mkRoot(platform: Platform, items: Item[]): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-browser-path-"));
  for (const { dir, rel } of items) {
    const base = path.join(root, dir);
    if (rel === "") {
      fs.mkdirSync(base, { recursive: true });
      continue;
    }
    const exe = path.join(base, rel);
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, "");
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const expectAt = (platform: Platform, dir: string, rel: string, root: string): string =>
  path.join(root, dir, rel);

let passed = 0;
const ok = (name: string, fn: () => void): void => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

console.log("e2e/browser-path.ts 探测逻辑契约：");

// ① 完整版优先于 headless（headless 版本号更大也不换）
{
  const c = mkRoot("win32", [
    { dir: "chromium-999", rel: CHROMIUM_REL.win32 },
    { dir: "chromium_headless_shell-1000", rel: SHELL_REL.win32 },
  ]);
  try {
    ok("① 完整版 999 胜 headless 1000", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32"),
        expectAt("win32", "chromium-999", CHROMIUM_REL.win32, c.root),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ② 版本号数字比较（字典序会把 999 排 1000 前 → 选错）
{
  const c = mkRoot("win32", [
    { dir: "chromium-1000", rel: CHROMIUM_REL.win32 },
    { dir: "chromium-999", rel: CHROMIUM_REL.win32 },
  ]);
  try {
    ok("② 数字版降序：1000 胜 999", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32"),
        expectAt("win32", "chromium-1000", CHROMIUM_REL.win32, c.root),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ③ 仅 headless 时兜底
{
  const c = mkRoot("win32", [{ dir: "chromium_headless_shell-1228", rel: SHELL_REL.win32 }]);
  try {
    ok("③ headless 兜底", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32"),
        expectAt("win32", "chromium_headless_shell-1228", SHELL_REL.win32, c.root),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ④ win32 32 位变体（chrome-win64 缺失时落到 chrome-win）
{
  const c = mkRoot("win32", [{ dir: "chromium-1228", rel: path.join("chrome-win", "chrome.exe") }]);
  try {
    ok("④ chrome-win/ 32 位变体", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32"),
        path.join(c.root, "chromium-1228", "chrome-win", "chrome.exe"),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ⑤ linux / darwin 候选路径冒烟
for (const p of ["linux", "darwin"] as const) {
  const c = mkRoot(p, [{ dir: "chromium-1228", rel: CHROMIUM_REL[p] }]);
  try {
    ok(`⑤ ${p} 候选路径`, () =>
      assert.strictEqual(findLocalChromium(c.root, p), expectAt(p, "chromium-1228", CHROMIUM_REL[p], c.root)),
    );
  } finally {
    c.cleanup();
  }
}

// ⑥ 无浏览器情形
{
  ok("⑥ 根目录不存在 → undefined", () =>
    assert.strictEqual(findLocalChromium("C:/definitely/not/a/ms-playwright", "win32"), undefined),
  );
  const c = mkRoot("win32", []);
  try {
    ok("⑥ 空根目录 → undefined", () => assert.strictEqual(findLocalChromium(c.root, "win32"), undefined));
  } finally {
    c.cleanup();
  }
  const c2 = mkRoot("win32", [{ dir: "chromium-1228", rel: "" }]);
  try {
    ok("⑥ 有目录无 exe → undefined", () => assert.strictEqual(findLocalChromium(c2.root, "win32"), undefined));
  } finally {
    c2.cleanup();
  }
}

// ⑦ localChromiumUse 形状契约（走真实本机环境，不依赖探测结果——两种合法形态都要能消化）
{
  ok("⑦ localChromiumUse 形状", () => {
    const use = localChromiumUse();
    if (Object.keys(use).length === 0) return;
    assert.ok(use.launchOptions, "非空 use 必携带 launchOptions");
    assert.ok(
      typeof use.launchOptions.executablePath === "string" && fs.existsSync(use.launchOptions.executablePath),
      `executablePath 必须指向存在的文件: ${use.launchOptions.executablePath}`,
    );
  });
}

console.log(`  共 ${passed} 项通过`);
