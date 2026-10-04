#!/usr/bin/env node
/**
 * 契约测试：frontend/e2e/browser-path.ts 浏览器探测逻辑。
 *
 * 背景：探测逻辑是纯 fs 扫描（挑本机实际存在的 chromium；2026-10 锐评 P1-1 收口后
 * 语义 = 期望修订优先（对齐 playwright-core registry 期望版）+ 最大修订启发式兜底），
 * 此前「数字版排序 / 优先级回落」全靠肉眼。本测试用临时目录注入 root/platform/expected
 * 全覆盖，并用**真机 registry 对拍**（⑨）钉死候选表与已装 playwright-core 的同步性。
 *
 * 覆盖清单：
 *   ① 完整版优先于 headless（不涉及期望修订时；即使 headless 版本号更大）
 *   ② 版本号数字比较（chromium-1000 胜 chromium-999，非字典序）
 *   ③ 仅 headless shell 时兜底
 *   ④ linux / darwin 候选路径（registry 布局：chrome-linux64 / Google Chrome for Testing.app）
 *   ⑤ 根目录不存在 / 空目录 / 有目录无 exe → undefined
 *   ⑥ localChromiumUse() 形状契约
 *   ⑦ 版本优先（P1-1）：期望修订胜最大修订——期望 shell 在、旧 full 在 → 不降档旧 full；
 *      期望 full 在、混入更新的 max full → 不升级异版（比默认解析更糟的钉法）
 *   ⑧ preferFull（WebGL 消费方）：期望 full → 最大 full → 期望 shell
 *   ⑨ registry 对拍：候选表必须与实装 playwright-core 的可执行布局一致（静态表防脱节）
 *
 * 本文件由 tests/ 自动发现机制纳入 doctor / pre-push 门禁（scripts/_lib/contract-tests.ts）。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  findLocalChromium,
  fullExeRels,
  shellExeRels,
  localChromiumUse,
} from "../frontend/e2e/browser-path.ts";

type Platform = "win32" | "darwin" | "linux";
type Arch = "x64" | "arm64";

/** 各平台×架构「完整版」可执行相对路径（与 playwright-core registry EXECUTABLE_PATHS 同表；⑨ 对拍兜同步）。 */
const CHROMIUM_REL: Record<Platform, Record<Arch, string>> = {
  win32: {
    x64: path.join("chrome-win64", "chrome.exe"),
    arm64: path.join("chrome-win64", "chrome.exe"), // registry 无 win-arm64 键，模块回落 x64 表
  },
  darwin: {
    x64: path.join("chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    arm64: path.join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
  },
  linux: {
    x64: path.join("chrome-linux64", "chrome"),
    arm64: path.join("chrome-linux-arm64", "chrome"),
  },
};

/** 各平台×架构「headless shell」可执行相对路径。 */
const SHELL_REL: Record<Platform, Record<Arch, string>> = {
  win32: {
    x64: path.join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
    arm64: path.join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  },
  darwin: {
    x64: path.join("chrome-headless-shell-mac-x64", "chrome-headless-shell"),
    arm64: path.join("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
  },
  linux: {
    x64: path.join("chrome-headless-shell-linux64", "chrome-headless-shell"),
    arm64: path.join("chrome-headless-shell-linux-arm64", "chrome-headless-shell"),
  },
};

interface Item {
  /** 浏览器目录名（chromium-1228 / chromium_headless_shell-1228 / ...）。 */
  dir: string;
  /** 可执行文件相对浏览器目录的路径（平台×架构）；"" 表示只建目录不建 exe。 */
  rel: string;
}

/** 在临时目录铺一个 ms-playwright 根（若干浏览器目录 + 可执行文件占位）。 */
function mkRoot(platform: Platform, arch: Arch, items: Item[]): { root: string; cleanup: () => void } {
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

const expectAt = (root: string, dir: string, rel: string): string => path.join(root, dir, rel);

let passed = 0;
const ok = (name: string, fn: () => void): void => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

console.log("e2e/browser-path.ts 探测逻辑契约：");

// ① 完整版优先于 headless（expected: null = 纯启发式；headless 版本号更大也不换）
{
  const c = mkRoot("win32", "x64", [
    { dir: "chromium-999", rel: CHROMIUM_REL.win32.x64 },
    { dir: "chromium_headless_shell-1000", rel: SHELL_REL.win32.x64 },
  ]);
  try {
    ok("① 完整版 999 胜 headless 1000", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32", { expected: null }),
        expectAt(c.root, "chromium-999", CHROMIUM_REL.win32.x64),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ② 版本号数字比较（字典序会把 999 排 1000 前 → 选错）
{
  const c = mkRoot("win32", "x64", [
    { dir: "chromium-1000", rel: CHROMIUM_REL.win32.x64 },
    { dir: "chromium-999", rel: CHROMIUM_REL.win32.x64 },
  ]);
  try {
    ok("② 数字版降序：1000 胜 999", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32", { expected: null }),
        expectAt(c.root, "chromium-1000", CHROMIUM_REL.win32.x64),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ③ 仅 headless 时兜底
{
  const c = mkRoot("win32", "x64", [{ dir: "chromium_headless_shell-1228", rel: SHELL_REL.win32.x64 }]);
  try {
    ok("③ headless 兜底", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32", { expected: null }),
        expectAt(c.root, "chromium_headless_shell-1228", SHELL_REL.win32.x64),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ④ linux / darwin 候选路径（registry 布局对拍表；arch 参数化）
for (const p of ["linux", "darwin"] as const) {
  for (const arch of ["x64", "arm64"] as const) {
    const c = mkRoot(p, arch, [{ dir: "chromium-1228", rel: CHROMIUM_REL[p][arch] }]);
    try {
      ok(`④ ${p}/${arch} 候选路径`, () =>
        assert.strictEqual(
          findLocalChromium(c.root, p, { expected: null, arch }),
          expectAt(c.root, "chromium-1228", CHROMIUM_REL[p][arch]),
        ),
      );
    } finally {
      c.cleanup();
    }
  }
}

// ⑤ 无浏览器情形
{
  ok("⑤ 根目录不存在 → undefined", () =>
    assert.strictEqual(findLocalChromium("C:/definitely/not/a/ms-playwright", "win32", { expected: null }), undefined),
  );
  const c = mkRoot("win32", "x64", []);
  try {
    ok("⑤ 空根目录 → undefined", () =>
      assert.strictEqual(findLocalChromium(c.root, "win32", { expected: null }), undefined),
    );
  } finally {
    c.cleanup();
  }
  const c2 = mkRoot("win32", "x64", [{ dir: "chromium-1228", rel: "" }]);
  try {
    ok("⑤ 有目录无 exe → undefined", () =>
      assert.strictEqual(findLocalChromium(c2.root, "win32", { expected: null }), undefined),
    );
  } finally {
    c2.cleanup();
  }
}

// ⑥ localChromiumUse 形状契约（走真实本机环境，不依赖探测结果——两种合法形态都要能消化）
{
  ok("⑥ localChromiumUse 形状", () => {
    const use = localChromiumUse();
    if (Object.keys(use).length === 0) return;
    assert.ok(use.launchOptions, "非空 use 必携带 launchOptions（嵌套形，平铺是静默 no-op）");
    assert.ok(
      typeof use.launchOptions.executablePath === "string" && fs.existsSync(use.launchOptions.executablePath),
      `executablePath 必须指向存在的文件: ${use.launchOptions.executablePath}`,
    );
  });
  // 信息输出：本机实际钉住的路径（锐评复核时一眼可辨「期望版优先」是否生效）
  const pinned = localChromiumUse();
  if (pinned.launchOptions) console.log(`    (本机钉住: ${pinned.launchOptions.executablePath})`);
}

// ⑦ 版本优先（P1-1 本机实证场景：旧 full 1228 + 匹配 shell 1243 → 钉 shell 1243 而非降档旧 full）
{
  const c = mkRoot("win32", "x64", [
    { dir: "chromium-1228", rel: CHROMIUM_REL.win32.x64 },
    { dir: "chromium_headless_shell-1243", rel: SHELL_REL.win32.x64 },
  ]);
  const exp = { full: "chromium-1243", shell: "chromium_headless_shell-1243" };
  try {
    ok("⑦ 期望 shell 胜旧 full（不降档）", () =>
      assert.strictEqual(findLocalChromium(c.root, "win32", { expected: exp }), expectAt(c.root, "chromium_headless_shell-1243", SHELL_REL.win32.x64)),
    );
  } finally {
    c.cleanup();
  }
}
// ⑦b 反向污染（多项目共缓存混入更新 max）：期望 full 在场 → 胜 max full 1300（不升级异版）
{
  const c = mkRoot("win32", "x64", [
    { dir: "chromium-1300", rel: CHROMIUM_REL.win32.x64 },
    { dir: "chromium-1243", rel: CHROMIUM_REL.win32.x64 },
  ]);
  const exp = { full: "chromium-1243", shell: "chromium_headless_shell-1243" };
  try {
    ok("⑦b 期望 full 胜更新的 max full（不升级异版）", () =>
      assert.strictEqual(findLocalChromium(c.root, "win32", { expected: exp }), expectAt(c.root, "chromium-1243", CHROMIUM_REL.win32.x64)),
    );
  } finally {
    c.cleanup();
  }
}

// ⑧ preferFull（WebGL 消费方，postprocessing.spec 语义）：期望 full → 最大 full → 期望 shell
{
  const c = mkRoot("win32", "x64", [
    { dir: "chromium-1228", rel: CHROMIUM_REL.win32.x64 },
    { dir: "chromium_headless_shell-1243", rel: SHELL_REL.win32.x64 },
  ]);
  const exp = { full: "chromium-1243", shell: "chromium_headless_shell-1243" };
  try {
    ok("⑧ preferFull：期望 full 缺失时取最大 full（1228），不落到期望 shell", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32", { expected: exp, preferFull: true }),
        expectAt(c.root, "chromium-1228", CHROMIUM_REL.win32.x64),
      ),
    );
  } finally {
    c.cleanup();
  }
}
{
  const c = mkRoot("win32", "x64", [
    { dir: "chromium-1243", rel: CHROMIUM_REL.win32.x64 },
    { dir: "chromium-1228", rel: CHROMIUM_REL.win32.x64 },
  ]);
  const exp = { full: "chromium-1243", shell: "chromium_headless_shell-1243" };
  try {
    ok("⑧b preferFull：期望 full 在场直接取之", () =>
      assert.strictEqual(
        findLocalChromium(c.root, "win32", { expected: exp, preferFull: true }),
        expectAt(c.root, "chromium-1243", CHROMIUM_REL.win32.x64),
      ),
    );
  } finally {
    c.cleanup();
  }
}

// ⑨ registry 对拍：候选表必须与**实装** playwright-core 的可执行布局一致
//（静态表的最大盲区是 registry 改名/加架构——自指同构测试抓不住，只有对拍真机事实源能钉）
{
  const REPO = path.resolve(fileURLToPath(import.meta.url), "..");
  const req = createRequire(path.join(REPO, "package.json"));
  let fullExe: string;
  try {
    fullExe = req("playwright-core").chromium.executablePath();
  } catch {
    fullExe = "";
  }
  if (!fullExe) {
    console.log("  ⚠ ⑨ 跳过：playwright-core 不可解析（依赖未装环境；CI 装完依赖后必跑）");
  } else {
    const pkgDir = path.dirname(req.resolve("playwright-core"));
    const browsers = JSON.parse(fs.readFileSync(path.join(pkgDir, "browsers.json"), "utf8")).browsers as Array<{
      name: string;
      revision: string | number;
    }>;
    try {
      // a) 目录命名约定：fullExe 路径里必有 registry 目录段 chromium-<browsers.json revision>
      //    （路径深度平台各异：win/linux 两层、mac 四层 .app——按段名定位而非按层数）
      const rev = String(browsers.find((b) => b.name === "chromium")?.revision ?? "");
      const arch: Arch = process.arch === "arm64" ? "arm64" : "x64";
      const norm = (s: string): string => s.split(path.sep).join("/");
      const segs = fullExe.split(path.sep);
      const idx = segs.lastIndexOf(`chromium-${rev}`);
      assert.ok(idx > 0, `registry 期望路径 ${fullExe} 中找不到目录段 chromium-${rev}`);
      const fullDir = segs[idx];
      const msRoot = segs.slice(0, idx).join(path.sep);
      // b) 候选表（full）必须含 registry 期望的「浏览器目录内」相对可执行布局
      const relFull = norm(segs.slice(idx + 1).join("/"));
      const table = fullExeRels(process.platform, arch).map(norm);
      assert.ok(table.includes(relFull), `full 候选表与 registry 脱节：registry 期望 ${relFull}，表内 [${table.join(", ")}]`);
      // c) 候选表（shell）与磁盘对拍：本机若装了 shell 目录，表内相对布局必须真实存在
      const shellRev = String(browsers.find((b) => b.name === "chromium-headless-shell")?.revision ?? rev);
      const shellDir = path.join(msRoot, `chromium_headless_shell-${shellRev}`);
      if (fs.existsSync(shellDir)) {
        const shellRel = norm(shellExeRels(process.platform, arch)[0]);
        assert.ok(
          fs.existsSync(path.join(shellDir, shellRel)),
          `shell 候选表与磁盘脱节：${shellDir} 下无 ${shellRel}`,
        );
      }
      ok(`⑨ registry 对拍：${fullDir} / ${relFull}（${process.platform}/${arch}）`, () => undefined);
    } finally {
      // 保持断言在 try 内执行（断言失败 → 非零退出；信息已打印）
    }
  }
}

console.log(`  共 ${passed} 项通过`);
