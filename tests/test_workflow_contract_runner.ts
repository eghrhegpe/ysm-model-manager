#!/usr/bin/env node
/**
 * 契约测试：CI 工作流必须走 contract-tests 统一入口（禁止裸跑 tests/*.ts）。
 *
 * 背景（2026-09-11 六层 CI 缺陷复盘，本层为第六层）：
 *   CI 与本地曾各跑一套执行路径——test.yml 走 `scripts/contract-tests.ts`（经
 *   _lib/contract-tests.ts spawn 时注入 `--import ts-alias-register.ts`，让 Node
 *   原生 TS 执行能解析 tsconfig paths 的 `@/<dir>/*` 别名），而 pages-deploy.yml
 *   自己手写 `for f in tests/*.ts; do node "$f"; done` 裸跑循环，**没有**该钩子。
 *   于是任何 import 链进入含 `@/` 别名的 frontend 源码的契约测试，在 Pages 里
 *   必然 ERR_MODULE_NOT_FOUND——长期红且不阻断（只有 Pages 挂，CI 绿，故没人管）。
 *   实测两例：test_contract_alias_runtime.ts、test_cube_uv_quad_vertex.ts。
 *   讽刺之处在于：test_contract_alias_runtime.ts 的存在意义**正是**钉住这个钩子，
 *   而它自己在裸跑语境下加载期即崩——钩子没了，护栏也一起死了，没有任何测试能报。
 *
 * 本测试是该结构缺口的静态护栏：直接读 .github/workflows/*.yml 文本，
 * 断言「凡执行 tests/ 下契约测试的 workflow 一律经 scripts/contract-tests.ts」。
 * 放在文本层而非运行时层，是因为运行时层在裸跑语境下自毁（见上），必须更早一道防线。
 *
 * 判定规则（保守，允许注释提及裸跑模式——本仓注释大量引用反例）：
 *   ① 命中「裸跑 loop」签名 → VIOLATION：`for <var> in tests/`、`tests/*.ts` 出现在
 *      非注释行、`Get-ChildItem ... tests` 逐跑。
 *   ② 断言 contract-tests.ts 入口存在且被至少一个 workflow 调用。
 *
 * 运行：node tests/test_workflow_contract_runner.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../scripts/_lib/scan-files.ts";

const WF_DIR = path.join(ROOT, ".github", "workflows");
const RUNNER = "scripts/contract-tests.ts";

let failed = 0;
const fail = (msg: string): void => {
  console.error(`[FAIL] ${msg}`);
  failed++;
};

/** 剥掉整行注释（YAML `#` 注释），保留 # 出现在引号内的情况——本仓注释大量引用反例，必须掩码。 */
const stripComment = (line: string): string => {
  const t = line.trimStart();
  if (t.startsWith("#")) return "";
  // 逐字符找未被引号包裹的 '#'（YAML 注释只能在行首或空白后）
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(line[i - 1] ?? " ")))
      return line.slice(0, i);
  }
  return line;
};

if (!fs.existsSync(WF_DIR)) {
  console.log("⚠️ 无 .github/workflows 目录，跳过工作流契约 runner 守护");
  process.exit(0);
}

const wfFiles = fs
  .readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort();

// ─── 规则 ①：禁止裸跑 tests/*.ts 循环 ────────────────────────────────
// 这些签名对应「不走统一入口、直接逐个 node <测试文件>」的写法。
const BARE_RUN_PATTERNS: { re: RegExp; why: string; except?: (code: string) => boolean }[] = [
  { re: /for\s+\w+\s+in\s+tests\//, why: "bash `for f in tests/*.ts` 裸跑循环" },
  { re: /tests\/\*\.ts/, why: "glob 直指 tests/*.ts（应交给 contract-tests.ts 收集）" },
  { re: /Get-ChildItem[^\n]*tests/i, why: "PowerShell Get-ChildItem tests 裸跑循环" },
  // 单文件直跑同样绕过统一入口（如 node tests/test_xxx.ts）——排除 runner 自身路径
  {
    re: /node\s+(?:\S*[/\\])?tests[/\\][^\s"']+\.ts(?!\S)/,
    why: "node 单文件直跑 tests/*.ts（应经 scripts/contract-tests.ts）",
    except: (code) => code.includes(RUNNER),
  },
];

const bareHits: string[] = [];
let runnerCallers = 0;

for (const f of wfFiles) {
  const raw = fs.readFileSync(path.join(WF_DIR, f), "utf8");
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const code = stripComment(lines[i] ?? "");
    if (!code) continue;
    for (const { re, why, except } of BARE_RUN_PATTERNS) {
      if (re.test(code) && !except?.(code)) {
        bareHits.push(`${f}:${i + 1}  ${why}  →  ${code.trim()}`);
      }
    }
    if (code.includes(RUNNER)) runnerCallers++;
  }
}

if (bareHits.length) {
  fail(
    `工作流存在「裸跑 tests/*.ts」写法（缺 --import ts-alias-register 的 @/ 别名注入，` +
      `含别名 import 的契约测试必然 ERR_MODULE_NOT_FOUND）：\n    ${bareHits.join("\n    ")}\n` +
      `  → 改用 \`node ${RUNNER}\`（本地 pre-push 与 CI 同源；域裁剪/并发/失败复跑全复用 _lib）。`,
  );
}

// ─── 规则 ②：统一入口必须存在，且至少被一个 workflow 调用 ────────────
const runnerAbs = path.join(ROOT, "scripts", "contract-tests.ts");
if (!fs.existsSync(runnerAbs)) {
  fail(`统一入口 ${RUNNER} 不存在——CI 无处可走，工作流只能退回裸跑`);
} else if (runnerCallers === 0) {
  fail(`没有任何 workflow 调用 ${RUNNER}（配置漂移或入口被绕过）`);
}

console.log(
  `  扫描 ${wfFiles.length} 个 workflow，裸跑写法 ${bareHits.length} 处，` +
    `经 ${RUNNER} 调用 ${runnerCallers} 处`,
);

if (failed > 0) {
  console.error(`\n❌ 契约测试失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ CI 工作流契约 runner 走统一入口（无裸跑 tests/*.ts）通过");
