#!/usr/bin/env node
/**
 * release-smoke.ts — 发版冒烟组（ADR-318 D2/D4）：用 CI 同口径预演发版会踩的雷。
 *
 * 零依赖（仅 node:child_process / node:fs / node:path / node:url）。
 *
 * 设计意图（为何存在）：v1.15.0 发版五轮 CI 排雷——本地验证口径与 CI 冻结口径不同构，
 * 雷串行堆积在发版最后一公里。本脚本用 CI 同口径命令在本地 ≤3 分钟预演四类病灶
 * （lockfile 漂移 / 跨平台 import 盲区 / tag 检出敏感测试 / 绑定契约），
 * 让「本地绿 CI 红」在发版前 3 分钟暴露，而不是发版后 3 小时。
 *
 * 用法：
 *   node scripts/release-smoke.ts          # 人读输出（发版前必跑，见 release-process.md §6）
 *   node scripts/release-smoke.ts --json   # 机器可读（CI/脚本消费）
 *
 * 退出码：0 = 全绿（可发版）；1 = 任一检查失败（先修再发版，别赌 CI）。
 *
 * 设计第一原则（ADR-318 D2）：每条检查必须回答「CI 的哪个步骤会被这条检查预演」：
 *   1. lockfile-frontend  → CI test/e2e job 的 `pnpm install --frozen-lockfile`
 *      （frontend/package.json 与 pnpm-lock.yaml 不同步 = E2E job ERR_PNPM_OUTDATED_LOCKFILE，
 *        v1.15.0 round2 实证）
 *   2. lockfile-root      → CI android job 的 `npm ci`
 *      （根 package.json workspace 与 package-lock.json 不同步 = npm ci EUSAGE，
 *        v1.15.0 round4 实证）
 *   3. crossplatform      → release.yml build-darwin / build-linux / build-android
 *      （import OS 专属包缺 //go:build 标签 = build constraints exclude all Go files，
 *        v1.15.0 round4 实证；本地交叉编译受 CGO 限制不可行 → 静态检查，ADR-318 D3）
 *   4. contract-tagsensitive → CI test job 契约测试步（tag 触发检出无 refs/heads/main、
 *      detached HEAD——v1.15.0 round3 两连红实证；清单为人工维护，见知识卡）
 *   5. bindings           → CI test job binding-check（ctx 注入 arity 对账）
 *
 * 运行：node scripts/release-smoke.ts [--json]
 * 定位：发版前置清单（docs/releases/release-process.md §6）；不进 pre-push（ADR-318 D4）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");

/** OS 专属 import 路径 → 要求的 build 标签（包名级执法，ADR-318 D3）。 */
const OS_IMPORT_RULES = [
  { re: /"golang\.org\/x\/sys\/windows"/, tag: "windows", label: "golang.org/x/sys/windows" },
  { re: /"golang\.org\/x\/sys\/unix"/, tag: "unix", label: "golang.org/x/sys/unix" },
  { re: /"syscall\/js"/, tag: "js //go:build wasm", label: "syscall/js" },
  { re: /"github\.com\/ebeem\/wifi"/, tag: "windows", label: "wifi (windows-only)" },
];

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function walkGoFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "vendor" || e.name.startsWith(".")) continue;
      walkGoFiles(p, out);
    } else if (e.name.endsWith(".go")) out.push(p);
  }
  return out;
}

/**
 * 检查 1+3 共用：扫全部 .go 文件，import OS 专属包但缺对应 build 标签即违规。
 * 头部 //go:build 行取文件前 20 行内首个；_other.go / _stub.go 命名视作有标签豁免
 * （与 write_diag_other.go 范式对齐——空实现文件天然无 OS import，此豁免只为防御误报）。
 */
function checkCrossPlatformImports() {
  const violations = [];
  const goDirs = ["go", "internal", "cmd"];
  const files = goDirs
    .filter((d) => fs.existsSync(path.join(ROOT, d)))
    .flatMap((d) => walkGoFiles(path.join(ROOT, d)));
  for (const fp of files) {
    const text = fs.readFileSync(fp, "utf8");
    const head = text.slice(0, text.indexOf("package ") > 0 ? text.indexOf("package ") : 600);
    if (/_other\.go$|_stub\.go$/.test(fp)) continue;
    const hasBuild = /\/\/go:build\s/.test(head);
    for (const rule of OS_IMPORT_RULES) {
      if (rule.re.test(text) && !hasBuild) {
        violations.push(`${path.relative(ROOT, fp)}: import ${rule.label} 但缺 //go:build ${rule.tag}`);
      }
    }
  }
  return violations;
}

/** 检查 3：CI 敏感契约测试抽样（tag 检出场景，人工维护清单——ADR-318 已知遗留）。 */
function runTagSensitiveContractTests(): string[] {
  const tests = ["tests/test_diff_coverage_shallow.ts", "tests/test_gate_fallback.ts"];
  for (const t of tests) {
    if (!fs.existsSync(path.join(ROOT, t))) return [`${t} 不存在（清单漂移，请人工核对）`];
    try {
      execFileSync("node", [t], { cwd: ROOT, stdio: "pipe", timeout: 120_000 });
    } catch (e: any) {
      const out = (e.stdout ?? "") + (e.stderr ?? "");
      return [`${t} 失败: ${out.split("\n").slice(-3).join(" | ")}`];
    }
  }
  return [];
}

function run(cmd: string, args: string[], cwd = ".") {
  // Windows 下 pnpm/npm 是 .cmd 垫片，execFileSync 直接调用会 ENOENT——走 shell 字符串
  const cmdline = [cmd, ...args].join(" ");
  try {
    execFileSync(cmdline, {
      cwd: path.join(ROOT, cwd ?? "."),
      stdio: "pipe",
      timeout: 300_000,
      shell: true,
      encoding: "utf8",
    });
    return [];
  } catch (e: any) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    return [`${cmdline} 失败: ${out.split("\n").filter(Boolean).slice(-4).join(" | ")}`];
  }
}

const checks: Array<{ name: string; ciStep: string; run: () => string[] }> = [
  {
    name: "lockfile-frontend",
    ciStep: "test.yml/e2e pnpm install --frozen-lockfile",
    run: () => run("pnpm", ["install", "--frozen-lockfile", "--config.confirmModulesPurge=false"], "frontend"),
  },
  {
    name: "lockfile-root",
    ciStep: "release.yml build-android npm ci",
    // --dry-run：校验 lockfile 同步但不真装（真装会清 node_modules，本地开发环境伤不起）
    run: () => run("npm", ["ci", "--dry-run"], "."),
  },
  {
    name: "crossplatform-imports",
    ciStep: "release.yml build-darwin/linux/android go build",
    run: checkCrossPlatformImports,
  },
  {
    name: "contract-tagsensitive",
    ciStep: "test.yml 契约测试（tag 触发场景）",
    run: runTagSensitiveContractTests,
  },
  {
    name: "bindings",
    ciStep: "test.yml binding-check",
    run: () => run("node", ["scripts/binding-check.ts"]),
  },
];

const results = [];
for (const c of checks) {
  process.stdout.write(`[smoke] ${c.name} ... `);
  const t0 = Date.now();
  let errors = [];
  try {
    errors = c.run();
  } catch (e: any) {
    errors = [`检查器异常: ${e.message}`];
  }
  const ok = errors.length === 0;
  console.log(ok ? "✅" : "❌");
  results.push({ name: c.name, ciStep: c.ciStep, ok, ms: Date.now() - t0, errors });
}

const failed = results.filter((r) => !r.ok);
if (jsonMode) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  console.log("\n──── 失败明细（归属 CI 步骤 → 错误）────");
  for (const f of failed) {
    console.log(`❌ ${f.name}  （预演 CI 步骤: ${f.ciStep}）`);
    for (const e of f.errors) console.log(`   → ${e}`);
  }
  console.log(
    failed.length === 0
      ? "\n✅ 发版冒烟组全绿 —— CI 同口径预演通过（ADR-318）"
      : `\n结论: FAIL ❌ ${failed.length}/${results.length} 项失败——先修再发版，别赌 CI`,
  );
}
process.exit(failed.length === 0 ? 0 : 1);
