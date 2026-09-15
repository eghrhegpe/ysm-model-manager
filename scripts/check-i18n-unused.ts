#!/usr/bin/env node
/**
 * check-i18n-unused.ts — i18n 未使用键检查（「只减不增」基线闸）。
 *
 * 为什么需要这个闸（补的是 i18n 四闸的公共盲区）：
 *   仓库已有 check-ctx-menu-i18n / i18n-check / i18n-key-naming / i18n-ui-check，
 *   分别管「右键菜单键齐」「缺失键」「命名规范」「UI 硬编码中文」——**没有一个是管
 *   「键有没有人用」的**。于是死键只增不减且无人报警：2026-09 实测 en 包 1459 键中
 *   174 个全仓无引用（+8 个仅测试引用）= 12%，其中大多是**迁移后遗留**
 *   （`common.*` 八个通用动词被 `menu.*` 取代后全死；`content.errNoIndex*` 与
 *   `error.noIndex` 被 `workshop.githubNoIndex` 取代后留尸）。
 *
 * 判定口径与置信度：见 `_lib/i18n-unused.ts`——**精确字面量匹配**（非子串包含，
 * 后者会把 `import.queue` 误判为「已用」因它是 `import.queueFull` 的前缀），
 * 两级（test-only / dead）+ 动态查表点计数供标注置信度。
 *
 * 门禁策略：`--baseline` 只拦「本次新增」死键，存量入基线冻结（同 check-design-tokens
 * 的「只减不增」）；清理后 `--update-baseline` 收缩。**本闸刻意不自动删键**——
 * 判定是启发式，误删活键会让 UI 直接显示键名给用户，比留死键严重得多。
 *
 * 依赖：node:fs / node:path；_lib/{i18n-unused.ts, parse-args.ts, scan-files.ts}
 *
 * 用法：
 *   node scripts/check-i18n-unused.ts                      # 全量报告（只读，不阻断）
 *   node scripts/check-i18n-unused.ts --strict             # 有 ERROR（死键）时 exit 1
 *   node scripts/check-i18n-unused.ts --json               # JSON（CI / 子代理消费）
 *   node scripts/check-i18n-unused.ts --json --list        # JSON 含全量明细
 *   node scripts/check-i18n-unused.ts --top 30             # 热点前缀榜条数（默认 20）
 *   node scripts/check-i18n-unused.ts --baseline           # 只拦新增死键（门禁用）
 *   node scripts/check-i18n-unused.ts --update-baseline    # 刷新基线（清理后收缩）
 *
 * 退出码：0 = 无新增（或非 strict 且仅存量）；--strict 且有死键 → 1；
 *          --baseline 有新增 → 1；基线缺失/损坏 → 2（fail-closed）；参数错误 → 2。
 *
 * 逃生阀：YSM_SKIP_I18N_UNUSED=1（跳过并留痕）。
 *
 * 设计意图：把「i18n 键是否还有人用」从「无人知晓」变成可度量、可增量收敛的机器信号；
 *   与四个既有 i18n 闸互补（它们查「该有的有没有」，本闸查「有的还有没有人要」）。
 */
import fs from "node:fs";
import path from "node:path";
import {
  classifyKeyUsage,
  countDynamicKeySites,
  extractDottedTokens,
  groupByPrefix,
  parseLocaleKeys,
} from "./_lib/i18n-unused.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT, readText, relPosix, walk } from "./_lib/scan-files.ts";

const args = parseArgs(process.argv.slice(2), {
  bools: ["json", "strict", "list", "baseline", "update-baseline"],
  strings: ["top"],
});
const JSON_OUT = Boolean(args.json);
const STRICT = Boolean(args.strict);
const LIST = Boolean(args.list);
const BASELINE_MODE = Boolean(args.baseline) || Boolean(args["update-baseline"]);
const UPDATE_BASELINE = Boolean(args["update-baseline"]);
const TOP_N = Number(args.top ?? 20) || 20;

const BASELINE_FILE = path.join(ROOT, "scripts", "baseline", "i18n-unused-baseline.json");

const log = (m: string) => {
  if (!JSON_OUT) console.log(m);
};
const jsonExit = (code: number, payload: unknown): never => {
  if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
};

if (args.unknown.length > 0) {
  jsonExit(2, { _summary: { ok: false, error: `未知参数: ${args.unknown.join(", ")}` } });
}

if (process.env.YSM_SKIP_I18N_UNUSED === "1") {
  log("[check-i18n-unused] YSM_SKIP_I18N_UNUSED=1，跳过");
  process.exit(0);
}

// ── 键集合：以 en 为准（三包对齐由 i18n 一致性测试保证）──
const EN_LOCALE = path.join(ROOT, "frontend/src/locales/en.ts");
let keys: string[];
try {
  keys = parseLocaleKeys(readText(EN_LOCALE));
} catch (e) {
  const msg = `无法读取语言包 ${relPosix(EN_LOCALE)}：${String(e)}`;
  if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
  console.error(`❌ ${msg}`);
  process.exit(2);
}

// ── 消费侧语料：生产（src 去 locales 去测试）+ 全仓（+ 测试 + 脚本）──
const SRC = path.join(ROOT, "frontend/src");
const NOT_LIB = (n: string) => n.startsWith(".") || n === "node_modules";

// 自排除：本工具自身（判定层 + CLI + 契约测试）含**探针字符串**
//（如 `t(\`import.${x}\`)` 用于验证构造式计数），若不排除会被自己数成「真实构造点」，
// 让置信度指标虚高（实测 +2）。探针是夹具不是消费方——同类先例：linter 忽略自己的 fixtures。
const SELF_FILES = new Set(
  [
    "scripts/_lib/i18n-unused.ts",
    "scripts/check-i18n-unused.ts",
    "tests/test_i18n_unused.ts",
  ].map((p) => path.join(ROOT, p)),
);

const prodFiles = [
  ...(walk(SRC, {
    exts: [".ts"],
    skipTest: true,
    skipDir: (n) => NOT_LIB(n) || n === "locales", // 语言包本身不是消费方
  }) as string[]),
  path.join(ROOT, "frontend", "index.html"),
];
const testFiles = walk(SRC, {
  exts: [".ts"],
  // 「只要测试文件」= skipFile 命中「不以 .test.ts 结尾者」→ 保留测试、丢弃其余。
  skipFile: /^(?!.*\.test\.ts$).*$/,
}) as string[];
const extraFiles = [
  ...(walk(path.join(ROOT, "tests"), { exts: [".ts"] }) as string[]),
  ...(walk(path.join(ROOT, "scripts"), { exts: [".ts"], skipTest: false }) as string[]),
].filter((f) => !SELF_FILES.has(f));

const readAll = (files: string[]): string =>
  files
    .map((f) => {
      try {
        return readText(f);
      } catch {
        return "";
      }
    })
    .join("\n");

const prodCorpus = readAll(prodFiles);
const allCorpus = `${prodCorpus}\n${readAll(testFiles)}\n${readAll(extraFiles)}`;

const prodLits = extractDottedTokens(prodCorpus);
const allLits = extractDottedTokens(allCorpus);
const rows = classifyKeyUsage(keys, prodLits, allLits);
const dyn = countDynamicKeySites(allCorpus);

const dead = rows.filter((r) => r.usage === "dead").map((r) => r.key);
const testOnly = rows.filter((r) => r.usage === "test-only").map((r) => r.key);
const allUnusedKeys = [...dead.map((k) => `dead:${k}`), ...testOnly.map((k) => `test-only:${k}`)];

// ── 基线模式（「只减不增」）──
if (BASELINE_MODE) {
  if (UPDATE_BASELINE) {
    const uniqueKeys = [...new Set(allUnusedKeys)].sort();
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify(
        {
          generated: new Date().toISOString(),
          count: uniqueKeys.length,
          note: "i18n 未使用键存量基线——门禁只拦新增；清理后重跑 --update-baseline 收缩",
          unused: uniqueKeys,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    if (JSON_OUT)
      jsonExit(0, { _summary: { ok: true, mode: "update-baseline", count: uniqueKeys.length } });
    log(`✅ 已写入 i18n 未使用键基线：${uniqueKeys.length} 条 → ${relPosix(BASELINE_FILE)}`);
    process.exit(0);
  }

  // fail-closed：基线缺失不得当「零新增」放行（同 check-design-tokens/check-redlines 纪律）
  if (!fs.existsSync(BASELINE_FILE)) {
    const msg = `基线不存在（${relPosix(BASELINE_FILE)}）——请先运行 node scripts/check-i18n-unused.ts --update-baseline 建立基线`;
    if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
    console.error(`❌ ${msg}`);
    process.exit(2);
  }
  let baseSet: Set<string>;
  try {
    const base = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8")) as { unused?: string[] };
    baseSet = new Set(base.unused ?? []);
  } catch (e) {
    const msg = `基线损坏（${relPosix(BASELINE_FILE)}）：${String(e)}——删除后重跑 --update-baseline`;
    if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
    console.error(`❌ ${msg}`);
    process.exit(2);
  }
  const currentSet = new Set(allUnusedKeys);
  const added = allUnusedKeys.filter((k) => !baseSet.has(k));
  const gone = [...baseSet].filter((k) => !currentSet.has(k));

  if (JSON_OUT) {
    jsonExit(added.length > 0 ? 1 : 0, {
      _summary: {
        ok: added.length === 0,
        mode: "baseline",
        current: currentSet.size,
        baseline: baseSet.size,
        added: added.length,
        gone: gone.length,
      },
      added,
      gone,
    });
  }
  log("");
  log(`基线比对：当前 ${currentSet.size} / 基线 ${baseSet.size}`);
  log(`新增未使用键：${added.length}    已清理：${gone.length}`);
  if (added.length > 0) {
    console.error(`\n❌ 本次新增 ${added.length} 个未使用 i18n 键（存量不拦）：`);
    for (const k of added.slice(0, 20)) console.error(`   ${k}`);
    console.error(
      "\n修复：用起来、删掉，或确属「预留待用」时加注释说明后重跑 --update-baseline 收编。",
    );
    process.exit(1);
  }
  if (gone.length > 0) {
    log(
      `ℹ 死键减少 ${gone.length} 条——建议 node scripts/check-i18n-unused.ts --update-baseline 收缩基线`,
    );
  }
  log("✅ 无新增未使用 i18n 键。");
  process.exit(0);
}

// ── 报告模式 ──
const byPrefix = groupByPrefix([...dead, ...testOnly]);
const summary = {
  total: keys.length,
  dead: dead.length,
  testOnly: testOnly.length,
  dynamicTSites: dyn.dynamicT,
  constructedSites: dyn.constructed,
};

if (JSON_OUT) {
  jsonExit(STRICT && dead.length > 0 ? 1 : 0, {
    _summary: {
      ok: !(STRICT && dead.length > 0),
      mode: "report",
      ...summary,
    },
    byPrefix,
    ...(LIST ? { dead, testOnly } : { deadPreview: dead.slice(0, 30) }),
  });
}

log("══════════════════════════════════════════════════");
log(" i18n 未使用键检查 (check-i18n-unused)");
log("══════════════════════════════════════════════════");
log(`语言包键数  : ${summary.total}（以 en 为准）`);
log(`真死键      : ${summary.dead}   ← 全仓（含测试/脚本）无引用`);
log(`仅测试引用  : ${summary.testOnly}   ← 生产未用，疑似冗余`);
log(
  `合计未使用  : ${summary.dead + summary.testOnly}（${(((summary.dead + summary.testOnly) / (summary.total || 1)) * 100).toFixed(0)}%）`,
);
log("──────────────────────────────────────────────────");
log("置信度标注：");
log(`  动态查表点 t(<变量>) : ${summary.dynamicTSites} 处（值来自同仓字面量数据，不构成假阳性）`);
log(`  键构造式（模板/拼接）: ${summary.constructedSites} 处 ← 唯一真风险源，0 则判定可信`);
log("──────────────────────────────────────────────────");
log(`热点前缀 Top ${TOP_N}：`);
for (const g of byPrefix.slice(0, TOP_N)) {
  log(`  ${String(g.count).padStart(4)}  ${g.prefix}.*`);
}
if (dead.length) {
  log("──────────────────────────────────────────────────");
  log(`真死键样例（前 ${Math.min(15, dead.length)}）:`);
  for (const k of dead.slice(0, 15)) log(`  ${k}`);
}
log("──────────────────────────────────────────────────");
log("说明：本闸**刻意不自动删键**——判定是启发式，误删活键会让 UI 直接显示键名，");
log("     比留死键严重得多。清理请人工分批，每批跑 --update-baseline 收缩基线。");
if (STRICT && dead.length) process.exit(1);
