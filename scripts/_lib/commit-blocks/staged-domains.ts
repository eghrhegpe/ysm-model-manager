#!/usr/bin/env node
/**
 * commit-blocks/staged-domains.ts — pre-commit 秒级提示段的**变更域裁剪**判据（ADR-206 按域裁剪哲学补最后一侧；2026-10-17 门禁性能实测，裁定记录见知识卡 pre-commit-hook）。
 *
 * 立因（2026-10-17 门禁性能实测）：pre-commit 是全仓唯一**不按域裁剪**的门禁层——
 * css-layer-check / i18n 两段 / path-hygiene / design-tokens 五段无差别每次提交全跑，
 * 其中 css-layer-check 单项实测 3.5s（全树扫 frontend/src + frontend/css）。
 * 纯 Go / 纯文档提交被强收约 5s 前端税，而这些段对不存在的文件**一条都判不到**。
 * （pre-push 侧早在 schedule.ts 按 plan.frontend 裁剪，本模块把同口径补到 commit 侧。）
 *
 * 设计：
 *   - 域判定**复用 _lib/domain-classify.ts 的 classify()**（单一事实源，不另起炉灶）；
 *   - 输入 = staged 文件清单（`git diff --cached --name-only`，含本次 add 的 gen 产物；
 *     gen 产物多在 docs/ 域 → 天然把文档段留在射程内）；
 *   - 输出 = 每段一行 `1`（跑）/ `0`（跳过），行序即段序（SEGMENTS），sh 侧按行位取用；
 *   - fail-open 取向：任何异常（清单读不到 / git 不可用）→ **全 1**（宁可多跑不误杀检查）。
 *     本裁剪只省时间、不放行——被跳过的段在 pre-push 全量清单里仍无条件兜底。
 *   - 逃生阀 `YSM_PRECOMMIT_FULL=1`：无视裁剪全跑（排查「疑似裁剪漏报」时用）。
 *
 * 段判据（与脚本自身扫描面对齐，逐条可单测）：
 *   css-layer    扫 frontend/src/views + frontend/css → 判据 = frontend 域
 *   i18n         查 frontend locale 键与 t() 调用 → 判据 = frontend 域
 *                （新增键三段式 i18n-key-naming 同判据；钩子里两段共用一个开关）
 *   path-hygiene R5/R6 判 frontend/tests 的 import 路径 → 判据 = frontend ∪ tests 域
 *
 * ⚠️ 只裁「非阻断秒级提示段」——三大 exit-1 硬阻断段（Android 黑名单 / biome 行级闸 /
 *   设计令牌行级闸）**永不进本清单**：它们的职责是防 `git commit --no-verify` 单点绕过，
 *   裁掉即少一层防线；且实测各 <1s，裁剪无收益却引入「放行」风险。不变量：
 *   被本模块裁掉的段，必是 pre-push --strict 全量清单里仍无条件兜底的提示段。
 *
 * 用法（钩子内，一次调用取全部开关）：
 *   SDS=$(git diff --cached --name-only | node scripts/_lib/commit-blocks/staged-domains.ts)
 *   输出三行（依序）：css-layer / i18n / path-hygiene
 *
 * 依赖：_lib/domain-classify.ts（classify）/ node:fs
 *
 * 退出码：恒 0（纯判据输出，非阻断）。
 *
 * 设计意图：把 pre-commit 的「秒级提示段」从无条件全跑收敛到按 staged 变更域裁剪，
 * 消灭纯 Go / 纯文档提交的前端固定税（css-layer-check 单项实测 3.5s）；
 * 契约测试 tests/test_commit_staged_domains.ts 锁死。
 */
import fs from "node:fs";
import { classify } from "../domain-classify.ts";
import { toPosix } from "../to-posix.ts";

/** 段名 → 触发域集合（staged 文件 classify 后命中任一域即跑）。 */
const SEGMENT_DOMAINS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["css-layer", new Set(["frontend"])],
  ["i18n", new Set(["frontend"])],
  ["path-hygiene", new Set(["frontend", "tests"])],
];

/**
 * 纯判据核心：staged 文件清单 → 每段 1/0（导出供契约测试直测，不碰进程）。
 * 空清单 = 无可判文件 → 全 0（合法：钩子侧无 staged 时本就不该跑提示段）。
 */
export function segmentsForFiles(files: string[]): Record<string, 0 | 1> {
  const domains = new Set<string>();
  for (const f of files) {
    const t = f.trim();
    if (!t) continue;
    domains.add(classify(t));
  }
  const out: Record<string, 0 | 1> = {};
  for (const [seg, need] of SEGMENT_DOMAINS) {
    let hit: 0 | 1 = 0;
    for (const d of domains) {
      if (need.has(d)) {
        hit = 1;
        break;
      }
    }
    out[seg] = hit;
  }
  return out;
}

function main(): number {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
  const files = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const fromArgv = process.argv.slice(2).filter(Boolean);
  const list = files.length ? files : fromArgv;
  // 逃生阀：无视裁剪全跑
  if (process.env.YSM_PRECOMMIT_FULL === "1") {
    for (const [seg] of SEGMENT_DOMAINS) console.log(1);
    console.error("[staged-domains] YSM_PRECOMMIT_FULL=1 逃生：全段强制跑");
    return 0;
  }
  // fail-open：清单为空且 argv 也为空（管道异常/git 不可用）→ 全 1，宁可多跑
  if (list.length === 0) {
    for (const [seg] of SEGMENT_DOMAINS) console.log(1);
    console.error("[staged-domains] ⚠️ 未收到 staged 清单（管道异常？）——按全跑处理（fail-open）");
    return 0;
  }
  const verdict = segmentsForFiles(list);
  for (const [seg] of SEGMENT_DOMAINS) console.log(verdict[seg]);
  return 0;
}

// 仅直接执行时跑 main（契约测试 import segmentsForFiles 时绝不触碰 stdin——
// 入口守卫同 _lib/commit-blocks/clean-staged-filter.ts 惯例；无守卫时 import 即读
// 宿主 stdin 并打印判定行，污染消费方输出）。
if (process.argv[1] && toPosix(process.argv[1]).endsWith("_lib/commit-blocks/staged-domains.ts")) {
  process.exit(main());
}
