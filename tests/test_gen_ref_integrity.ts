#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gen-ref-integrity.ts —— 生成物「引用完整性」判定。
 *
 * 背景（2026-10-09 审核体系锐评第三刀，实测驱动）：ADR-151-d1 关掉了「误收编他人**身份**」
 * 的门（未知新建不 stage），但没关「引用」这门——聚合生成物（ADR 登记表 / routes / index）
 * 会把**他人尚未入库**的新文件写进自己的正文，被 gen-stage 正常收编，于是提交里留下悬空
 * 引用（实证：未提交的 ADR-235-d1 被重新生成的 docs/adr/index.md 登记）。
 *
 * 本测试锁定三件事：
 *   1. 提取口径**保守**：只认 markdown 相对链接，跳过 scheme/绝对路径/纯锚点/代码围栏/非 md；
 *   2. 判定方向**与 ADR-151-d1 同向**：引用未入库 → 拒收编（漏收编无害／误收编有害）；
 *      读不到内容或非 md 文件 → 放行（不制造误判滞留）；
 *   3. wiring 反向锚：gen-stage 的 CLI 必须真的调用本闸（否则退回「静默卷带」）。
 *
 * 依赖：node:assert / node:fs / node:path / 被测模块 / _lib/scan-files。
 * 用法：node tests/test_gen_ref_integrity.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（check + finish 汇总裁决）。
 */
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractRepoRefs,
  filterUnindexedGenStaged,
  findUnindexedRefs,
} from "../scripts/_lib/gen-ref-integrity.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { check, finish } from "./_lib.mts";

check("extractRepoRefs：相对链接解析为仓库路径（同名目录/上级目录/锚点后缀）", () => {
  const text = [
    "| [ADR-256-d1](./decisions/ADR-256-d1-x.md) | 标题 |",
    "见 [卡](../knowledge/foo.md#sec) 与 [卡2](./bar.md)。",
    "重复 [bar](./bar.md) 只算一次。",
  ].join("\n");
  assert.deepStrictEqual(extractRepoRefs(text, "docs/adr/index.md"), [
    "docs/adr/bar.md",
    "docs/adr/decisions/ADR-256-d1-x.md",
    "docs/knowledge/foo.md",
  ]);
});

check("extractRepoRefs：保守跳过（scheme / 绝对路径 / 纯锚点 / 非 md / 越出仓库）", () => {
  const text = [
    "[外链](https://example.com/x.md)",
    "[邮件](mailto:a@b.c)",
    "[站点绝对](/knowledge/foo.md)",
    "[锚点](#section)",
    "[图片](./img/x.png)",
    "[越界](../../../outside.md)",
  ].join("\n");
  assert.deepStrictEqual(extractRepoRefs(text, "docs/adr/index.md"), []);
});

check("extractRepoRefs：代码围栏内的示例链接不算真引用", () => {
  const text = [
    "```md",
    "[示例](./not-a-real-ref.md)",
    "```",
    "~~~",
    "[示例2](./also-not-real.md)",
    "~~~",
    "[真引用](./real.md)",
  ].join("\n");
  assert.deepStrictEqual(extractRepoRefs(text, "docs/adr/index.md"), ["docs/adr/real.md"]);
});

check("findUnindexedRefs：纯集合差（索引内即视为已入库）", () => {
  const indexed = new Set(["docs/a.md"]);
  assert.deepStrictEqual(findUnindexedRefs(["docs/a.md", "docs/b.md"], indexed), ["docs/b.md"]);
  assert.deepStrictEqual(findUnindexedRefs([], indexed), []);
});

check("filterUnindexedGenStaged：复现本次实测事故——登记表引用未入库 ADR ⇒ 拒收编", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-ref-integrity-"));
  const indexMd = path.join(tmp, "index.md");
  fs.writeFileSync(
    indexMd,
    "| [ADR-235-d1](./decisions/ADR-235-d1-sky-cap-cap.md) | sky cap | ✅ |\n",
  );
  const readFile = (p: string) => {
    const abs = path.join(tmp, p);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  };
  // ① 目标未入库（实证形态）：必须拒收编，并精确点名缺失目标
  const unsafe = filterUnindexedGenStaged(["index.md"], new Set(["README.md"]), readFile);
  assert.deepStrictEqual(unsafe.keep, []);
  assert.strictEqual(unsafe.dropped.length, 1);
  assert.deepStrictEqual(unsafe.dropped[0]!.missing, ["decisions/ADR-235-d1-sky-cap-cap.md"]);
  // ② 目标已入库（正常流：新 ADR 与重新生成的登记表同一次提交）：必须放行
  const safe = filterUnindexedGenStaged(
    ["index.md"],
    new Set(["decisions/ADR-235-d1-sky-cap-cap.md"]),
    readFile,
  );
  assert.deepStrictEqual(safe.keep, ["index.md"]);
  assert.deepStrictEqual(safe.dropped, []);
  // ③ 读不到内容 → 放行（不制造误判滞留）；非 md → 一律放行（v1 不猜其它语法）
  assert.deepStrictEqual(filterUnindexedGenStaged(["missing.md"], new Set(), readFile).keep, [
    "missing.md",
  ]);
  assert.deepStrictEqual(
    filterUnindexedGenStaged(["sidebar.gen.mjs"], new Set(), () => "[x](./y.md)").keep,
    ["sidebar.gen.mjs"],
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

check("端到端：临时仓库里跑 gen-stage CLI——引用了未入库 ADR 的登记表不进 stage 清单", () => {
  // 为什么用临时仓库而不是在真仓里造未跟踪文件：本仓已有先例（zzz-fm-delimiter-tmp.md 被
  // 并行会话顺手提交），在真仓造污染物正是这道闸要防的事故形态本身。
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-gen-stage-e2e-"));
  const run = (args: string[], cwd = repo) =>
    spawnSync(process.execPath, [path.join(ROOT, "scripts/_lib/gen-stage.ts"), ...args], {
      cwd,
      encoding: "utf8",
    });
  try {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const git = (args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });
    fs.mkdirSync(path.join(repo, "docs/adr/decisions"), { recursive: true });
    const indexPath = path.join(repo, "docs/adr/index.md");
    const snap = path.join(repo, "snap.txt");
    const porcelain = path.join(repo, "porcelain.txt");
    const run = (extra: string[] = []) =>
      spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts/_lib/gen-stage.ts"), snap, porcelain, ...extra],
        { cwd: repo, encoding: "utf8" },
      );

    // 起点：登记表不含幽灵行且**已入库**（clean）——复现「gen 前不 dirty」的真实前置
    fs.writeFileSync(indexPath, "| [ADR-256](./decisions/ADR-256.md) | 真 |\n");
    fs.writeFileSync(path.join(repo, "docs/adr/decisions/ADR-256.md"), "# ADR-256\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
    // gen 前 porcelain（同刻采集）——此刻 index.md 干净，故不在 dirty 名单里
    execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    fs.writeFileSync(porcelain, execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }));
    // 快照喂「mtime 很旧」+ 旧尺寸 → index.md 落进 snapChanged（= gen 刚改写它）
    fs.writeFileSync(snap, "1 1 docs/adr/index.md\n");

    // ① 反向：gen 把**未入库**的新 ADR 写进登记表（本次实测事故形态）
    fs.writeFileSync(indexPath, "| [ADR-999-d1](./decisions/ADR-999-d1-ghost.md) | 幽灵 |\n");
    const bad = run();
    assert.doesNotMatch(bad.stdout, /docs\/adr\/index\.md/, "引用未入库目标时不得进 stage 清单");
    assert.match(bad.stderr, /跳过收编（引用未入库文件/, "必须显式告警，不得静默丢弃");
    assert.match(bad.stderr, /ADR-999-d1-ghost\.md/, "告警必须点名缺失目标（可操作）");

    // ② 正向：目标入库后同一份产物必须放行（正常流：新 ADR 与登记表同一次提交）
    fs.writeFileSync(path.join(repo, "docs/adr/decisions/ADR-999-d1-ghost.md"), "# ADR\n");
    git(["add", "docs/adr/decisions/ADR-999-d1-ghost.md"]);
    fs.writeFileSync(snap, "1 1 docs/adr/index.md\n");
    const good = run();
    assert.match(good.stdout, /docs\/adr\/index\.md/, "目标入库后必须正常收编（不得误判滞留）");
    assert.doesNotMatch(good.stderr, /跳过收编/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

check("wiring：gen-stage 的 CLI 必须调用引用完整性闸（防静默卷带回流）", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/_lib/gen-stage.ts"), "utf8");
  assert.match(src, /from "\.\/gen-ref-integrity\.ts"/, "gen-stage 必须 import 本闸");
  assert.match(src, /filterUnindexedGenStaged\(/, "gen-stage 必须真的调用本闸");
  assert.match(src, /loadIndexedPaths\(/, "已入库判据必须来自索引（ls-files − 暂存删除）");
  // 反向锚：不能既调用又无视结果（keep 必须参与输出）
  assert.match(src, /toStage = keep/, "过滤结果必须真的替换输出清单");
});

finish("test_gen_ref_integrity.ts 全部断言通过");
