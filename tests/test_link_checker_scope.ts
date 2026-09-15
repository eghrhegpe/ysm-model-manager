#!/usr/bin/env node
/**
 * test_link_checker_scope.ts — link-checker 扫描域契约测试（scripts/link-checker.ts）。
 *
 * 锁「扫描域 = git 跟踪的 .md ∩ isScannable ∩ 磁盘存在」这一不变量（2026-09-15，ADR-244；
 * 磁盘存在项补于 review 2d51556ba P2）：
 * ① 原实现是裸 `readdir` 工作树 ⇒ 任何人往仓库里丢一个**未跟踪** md 就能拦住全仓推送
 * （实证：并行 agent 落在仓库根的 `SOUL.md` / `TOOLS.md` 带 `/concepts/soul` 模板链接，
 * 3 条断链卡住推送，与推送内容毫无关系）。门禁只该检查仓库里的文档。
 * ② 被跟踪但工作区缺失的 md（并行会话删除未 add、手工误删）不得进扫描域——
 * extractLinks 对其 readFileSync 进 catch 返空 + 锚点恒 0，该文件断链全盲 ⇒ 假绿。
 *
 * 断言口径用「构造性相等」（扫描域 ≡ 跟踪 ∩ 可扫）而非「含某个文件」——前者换机器、
 * 换工作区状态都成立，后者会因目录增删而假红/假绿。
 *
 * 运行：node tests/test_link_checker_scope.ts（失败 exit 1；契约 runner 收集）
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, toPosix } from "../scripts/_lib/scan-files.ts";
import { isScannable, listScanTargets } from "../scripts/link-checker.ts";

/** git ls-files 系列 → posix 相对路径数组（NUL 分隔，防非 ASCII 路径转义）。
 * maxBuffer 对齐生产 trackedRelPaths（全仓 ls-files 输出可超默认 1MB，超限则误判 git 不可用退 walk）。 */
function gitPaths(...args: string[]): string[] {
  const out = execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .map((p) => toPosix(p));
}

// ─── 1) isScannable：扫描域筛选规则（纯函数）────────────
assert.equal(isScannable("docs/a.md"), true, "普通 md 应纳入");
assert.equal(isScannable("README.md"), true, "仓库根 md 应纳入");
assert.equal(isScannable("node_modules/pkg/x.md"), false, "node_modules 应跳过");
assert.equal(isScannable("docs/node_modules/x.md"), false, "任意层级 node_modules 应跳过");
assert.equal(isScannable("archive/x.md"), false, "archive 应跳过");
assert.equal(isScannable("upstream/pkg/x.md"), false, "upstream（vendor）应跳过");
assert.equal(isScannable("build/x.md"), false, "build 应跳过");
assert.equal(isScannable("docs/a.txt"), false, "非 .md 不收");
assert.equal(isScannable("docs/.doc-next-steps.md"), false, "自动生成产物应跳过");
assert.equal(isScannable("docs\\b.md"), true, "反斜杠路径应归一化后纳入");

// ─── 2) 扫描域 ≡ git 跟踪文件 ∩ isScannable ∩ 磁盘存在（构造性相等）──
const targets = listScanTargets();
assert.equal(targets.source, "git", "本仓 git 可用，扫描域必须走 git 权威路径（非 walk 退化）");

// 期望集与 listScanTargets 同口径（existsSync 过滤）：工作区若有被跟踪但缺失的 md，
// 两侧同时剔除，断言不因测试环境的状态误红
const trackedMd = gitPaths("ls-files", "-z").filter(
  (r) => isScannable(r) && fs.existsSync(path.join(ROOT, r)),
);
assert.deepEqual(
  [...targets.rels].sort(),
  [...trackedMd].sort(),
  "扫描域必须恰好等于「git 跟踪文件 ∩ isScannable ∩ 磁盘存在」",
);
assert.ok(
  targets.rels.length > 100,
  `扫描域不应为空或过小（实际 ${targets.rels.length} 个）——真零会让门禁静默失效`,
);
assert.ok(
  targets.rels.includes("docs/knowledge/pre_push_gate.md"),
  "已知被跟踪的文档卡必须纳入扫描域",
);

// ─── 3) 未跟踪 md 一律不参与扫描（2026-09-15 回归点）──────
// 工作树里可能有并行 agent / 临时脚本落下的未跟踪 md；它们不是「仓库里的文档」，
// 不得进入扫描域——否则它们内部的链接（如 agent 模板的 /concepts/soul）会拦住全仓推送。
const untrackedMd = gitPaths("ls-files", "--others", "--exclude-standard", "-z").filter((p) =>
  p.endsWith(".md"),
);
const leaked = untrackedMd.filter((p) => targets.rels.includes(p));
assert.equal(
  leaked.length,
  0,
  `未跟踪 md 不得进入扫描域（泄漏 ${leaked.length} 个）：${leaked.slice(0, 5).join(", ")}`,
);

console.log(
  `✅ test_link_checker_scope 全部通过（扫描域 ${targets.rels.length} 个 md；未跟踪 md ${untrackedMd.length} 个已确认排除）`,
);
