#!/usr/bin/env node
/**
 * check-worker-lifecycle.ts — Worker 生命周期闸（锐评 host/env 耦合复审 G2，2026-10-08）。
 *
 * 设计意图：
 *   实测 `frontend/src/preview-3d` 有 4 处 `new Worker(...)`，其中 2 处绕过
 *   `createWorkerBridge` 工厂裸建（KTX2 编码池 / MMD 纹理解码池）。裸建本身不违规——
 *   违规的是**建了 worker 却没有终止出口**：Worker 持有独立线程 + 各自的 WASM 实例
 *   （BasisEncoder / 纹理解码器），无出口即「服务一次性事件的资源活到进程结束」。
 *   实证病灶：KTX2 编码池曾有完整桥（含 `dispose()`）但**生产侧零调用**，唯一清空路径
 *   是 worker 崩溃；编码却是「每个纹理一生一次」的事件（落盘后 `completedHashes` 幂等跳过）。
 *   本闸把「新建 Worker 必须配终止出口」从口头约定变成机械闸。
 *
 * 射程（刻意收窄——泛化即噪音，同 check-singleton-hygiene 口径）：
 *   frontend/src/preview-3d/**  生产文件（.test./.spec./.d. 豁免）
 *
 * 判定（W1 unmanaged-worker）：
 *   一个文件命中 `new Worker(` = 该文件「未被终止出口管理」且「未显式豁免」。
 *   合规四路（任一即放行）：
 *     a. 文件级终止出口：导出 `dispose*` / `terminate*` / `__reset*` / `reset*` / `clear*`
 *        函数——文件级粒度（终止函数通常整体收口整池，逐 worker 对账需跨行数据流分析，
 *        启发式不做，漏报接受，同 check-singleton-hygiene）。
 *     b. 工厂合规：文件**只**通过 `createWorkerBridge` / `createResolveModeBridge` 建 worker
 *        （工厂自带 `dispose()` → `terminatePool()`）⇒ 视为受管。
 *     c. 行级豁免：声明行或其前 3 行内注 `// worker-allow: <非空理由>`
 *        （对齐仓内 `singleton-allow:` / `layering-allow:` 文化）。
 *     d. 入基线：存量债登记 docs/.worker-lifecycle-baseline.json（file→count 计数制，
 *        行号会随编辑漂移制造假回归，计数只问「这个文件的这类债有没有变多」）。
 *        只许减少；--update 收紧，新增需 --force。
 *
 * 假绿防线（G2 落地硬要求，照抄 check-singleton-hygiene 的空域 fail-loud）：
 *   - **空域 fail-loud**：扫描到 0 个生产文件即 exit 2，拒绝报绿。
 *     ⚠️ 这不是形式主义：本闸射程窄（只 preview-3d），一旦目录改名/移动，
 *     「零命中」会被误读成「零债」——而真相是「闸没扫到东西」。
 *   - **零 Worker 也 fail-loud**：若扫描域内 `new Worker(` 总命中为 0，同样 exit 2。
 *     本仓已知有 4 处，0 命中只可能是解析器失效（正则被改坏 / 文件编码变化），
 *     不是「债还清了」——债还清时应是「命中数下降」而非「归零后无人察觉」。
 *
 * 已知局限（不追求穷举，同 check-menu-test-layout ADR-311 口径）：
 *   - 别名绕过：`const W = Worker; new W(...)` 不命中——仓内无此写法，接受漏报。
 *   - `stripNoise` 不解析嵌套模板 / `${}` 插值内的反引号——与 check-layering 同源局限。
 *   - 不区分数值：一个文件建 1 个 worker 与建 3 个 worker 同样是「1 处债」。
 *
 * 用法：
 *   node scripts/check-worker-lifecycle.ts            # 基线比对，超线退 1
 *   node scripts/check-worker-lifecycle.ts --json     # JSON（pre-push-gate 消费，_summary.ok）
 *   node scripts/check-worker-lifecycle.ts --update   # 收紧基线（只许减；--force 才可增/重建）
 *   node scripts/check-worker-lifecycle.ts --help
 * 退出码：0 通过 / 1 回归（超基线）/ 2 用法或扫描域异常。
 * 依赖：node:fs / node:path / node:url / _lib(parse-args, scan-files)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { SRC_DIR, walk } from "./_lib/scan-files.ts";
import { toPosix } from "./_lib/to-posix.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BASELINE_FILE = resolve(REPO_ROOT, "docs", ".worker-lifecycle-baseline.json");

/** 扫描域（相对 frontend/src，POSIX）。刻意只覆盖 3D 渲染域——锐评实证的 Worker 集中在
 *  此；全仓泛化会把 stats.worker / pmx-parser.worker 等一并卷进来，噪音压过信号。 */
const SCAN_AREA = "preview-3d";

const RULES = ["unmanaged-worker"] as const;
type Rule = (typeof RULES)[number];

/** 行级豁免标记（理由非空才算，防空注滥用） */
export const WORKER_ALLOW_RE = /worker-allow:\s*\S+/;
/** 豁免注回溯窗口：声明行 + 前 3 行（容 JSDoc 块尾行或紧邻单行注） */
const ALLOW_LOOKBACK = 3;

export interface WorkerHit {
  /** 相对仓库根 POSIX 路径 */
  file: string;
  line: number;
  rule: Rule;
}

/**
 * 剥离注释与模板字面量（空格等长替换，保持行结构/行号）。
 * 复用 check-singleton-hygiene / check-layering 同款最小实现——跨脚本 import 需改其
 * 模块接口，故复制而非依赖（同 check-circular P2-1 code_review 处置）。
 */
function stripNoise(text: string): string {
  return text
    .replace(/`(?:\\.|[^`\\])*`/g, (m: string) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, (m: string) => m.replace(/[^\n]/g, " "));
}

/** `new Worker(` 裸建（含 `new globalThis.Worker(` 的防御写法与可选空白）。 */
const NEW_WORKER_RE = /\bnew\s+(?:globalThis\.)?Worker\s*\(/g;

export function newWorkerSites(text: string): number[] {
  const clean = stripNoise(text);
  const out: number[] = [];
  for (const m of clean.matchAll(NEW_WORKER_RE)) {
    out.push(clean.slice(0, m.index).split("\n").length);
  }
  return out;
}

/** 文件级终止出口：`dispose*` / `terminate*` / `__reset*` / `reset*` / `clear*` 导出函数。 */
const TERMINATE_FN_RE =
  /export\s+function\s+(?:__reset\w*|reset\w*|clear\w*|dispose\w*|terminate\w*)\s*\(/;

/** 工厂合规：文件只经 createWorkerBridge / createResolveModeBridge 建 worker
 *  （工厂自带 dispose() → terminatePool()，等价于有终止出口）。 */
const FACTORY_RE = /\bcreate(?:WorkerBridge|ResolveModeBridge)\b/;

/** 文件级「受终止出口管理」判定。 */
export function hasTerminateChannel(text: string): boolean {
  const clean = stripNoise(text);
  if (TERMINATE_FN_RE.test(clean)) return true;
  // 工厂合规：该文件的全部 new Worker 都出自工厂内部实现（worker-bridge.ts 自身），
  // 或经工厂受管。判据 = 出现工厂符号 ⇒ 视为受管（文件级粒度，不漏报整文件）。
  if (FACTORY_RE.test(clean)) return true;
  return false;
}

/** 声明行或其前 ALLOW_LOOKBACK 行内是否带豁免注（查原文——stripNoise 已把注释抹成空格）。 */
function hasAllowMarker(lines: string[], line: number): boolean {
  const idx = line - 1;
  for (let i = Math.max(0, idx - ALLOW_LOOKBACK); i <= idx; i++) {
    if (WORKER_ALLOW_RE.test(lines[i] ?? "")) return true;
  }
  return false;
}

/** 收集扫描域内的生产文件（绝对路径；.ts/.tsx，测试与声明文件豁免）。 */
export function collectFiles(): string[] {
  const dir = resolve(SRC_DIR, SCAN_AREA);
  if (!existsSync(dir)) {
    throw new Error(`check-worker-lifecycle: 扫描域不存在（重构后请更新 SCAN_AREA）: ${SCAN_AREA}`);
  }
  return walk(dir, {
    exts: [".ts", ".tsx"],
    skipFile: (n: string) => /\.(test|spec)\.tsx?$/.test(n) || /\.d\.ts$/.test(n),
  }) as string[];
}

/** 扫描全部文件（入参为绝对路径）→ 未受管 Worker 命中表（命中相对仓库根 POSIX 路径）。 */
export function scanFiles(files: string[]): WorkerHit[] {
  const hits: WorkerHit[] = [];
  for (const abs of files) {
    if (!existsSync(abs)) continue;
    const file = toPosix(relative(REPO_ROOT, abs));
    const raw = readFileSync(abs, "utf8");
    const sites = newWorkerSites(raw);
    if (sites.length === 0) continue;
    if (hasTerminateChannel(raw)) continue;
    const lines = raw.split("\n");
    // 行级豁免：任一站点的豁免注 → 整文件放行（文件级粒度，同 check-singleton-hygiene）
    if (sites.some((ln) => hasAllowMarker(lines, ln))) continue;
    for (const line of sites) hits.push({ file, line, rule: "unmanaged-worker" });
  }
  return hits;
}

/** 命中 → file→count 计数制基线（行号会漂移，计数只问「有没有变多」）。 */
function toCounts(hits: WorkerHit[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const h of hits) {
    if (!out[h.file]) out[h.file] = {};
    out[h.file]![h.rule] = (out[h.file]![h.rule] ?? 0) + 1;
  }
  return out;
}

interface Baseline {
  exists: boolean;
  counts: Record<string, Record<string, number>>;
  generatedAt?: string;
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_FILE)) return { exists: false, counts: {} };
  try {
    const j = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    return { exists: true, counts: j.entries ?? {}, generatedAt: j.generatedAt };
  } catch (e) {
    console.error(`❌ 基线解析失败 ${relative(REPO_ROOT, BASELINE_FILE)}: ${(e as Error).message}`);
    process.exit(2);
  }
}

function writeBaseline(counts: Record<string, Record<string, number>>, note: string): void {
  const payload = {
    _comment:
      "Worker 生命周期闸基线（docs/.worker-lifecycle-baseline.json）：file→rule→count 计数制。只许减少；新增需 --force。",
    generatedAt: new Date().toISOString().slice(0, 10),
    note,
    entries: counts,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** 基线比对：超基线 = 回归，低基线 = fixed（导出供契约测试直测计数制语义）。 */
export function diffBaselinePublic(
  current: Record<string, Record<string, number>>,
  baseline: Record<string, Record<string, number>>,
): { regressions: string[]; fixed: string[] } {
  return diffBaseline(current, baseline);
}

function diffBaseline(
  current: Record<string, Record<string, number>>,
  baseline: Record<string, Record<string, number>>,
): { regressions: string[]; fixed: string[] } {
  const regressions: string[] = [];
  const fixed: string[] = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of files) {
    const cur = current[file] ?? {};
    const base = baseline[file] ?? {};
    for (const rule of RULES) {
      const c = cur[rule] ?? 0;
      const b = base[rule] ?? 0;
      if (c > b) regressions.push(`${file} [${rule}] ${b} → ${c}`);
      else if (c < b) fixed.push(`${file} [${rule}] ${b} → ${c}`);
    }
  }
  return { regressions, fixed };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2), {
    bools: ["json", "update", "force", "help"],
  });
  if (parsed.unknown.length > 0) {
    // 陷阱 #12：未知 flag 必须退 1——拼错 `--updat` 若静默忽略会照常「跑成功」
    console.error(`❌ 未知参数: ${parsed.unknown.join(" ")}（--help 看用法）`);
    process.exit(2);
  }
  if (parsed.help) {
    console.log(
      [
        "check-worker-lifecycle — Worker 生命周期闸",
        "",
        "  （无参）      基线比对，超线退 1",
        "  --json        JSON 输出（_summary.ok）",
        "  --update      收紧基线（只许减；新增需 --force）",
        "  --help        本帮助",
        "",
        "判据：preview-3d 生产文件内出现 `new Worker(` 即需有终止出口",
        "（导出 dispose*/terminate*/reset*/clear*，或经 createWorkerBridge 工厂，",
        "或行内 `// worker-allow: <理由>`，或入基线）。",
      ].join("\n"),
    );
    process.exit(0);
  }

  let files: string[] = [];
  try {
    files = collectFiles();
  } catch (e) {
    console.error(`❌ 扫描失败: ${(e as Error).message}`);
    process.exit(2);
  }
  // 空域 fail-loud（check-ctx-menu-i18n 假绿教训：0 文件 = 扫描失效，非全绿）
  if (files.length === 0) {
    console.error(`❌ 扫描域内 0 个生产文件（SCAN_AREA=${SCAN_AREA}）——指向失效？拒绝报绿`);
    process.exit(2);
  }

  const hits = scanFiles(files);

  // 零 Worker 也 fail-loud：本仓已知有多个 `new Worker(` 站点，归零只可能解析器失效。
  // ⚠️ 与「债还清」区分：债还清 = 命中数下降（且落在终止出口上），不是「一处都扫不到」。
  const totalSites = files.reduce(
    (s, abs) => (existsSync(abs) ? s + newWorkerSites(readFileSync(abs, "utf8")).length : s),
    0,
  );
  if (totalSites === 0) {
    console.error(
      `❌ 扫描域内 \`new Worker(\` 总命中为 0（扫了 ${files.length} 个文件）——` +
        "解析器失效或射程漂移？拒绝报绿（债还清应表现为命中数下降，而非归零）",
    );
    process.exit(2);
  }

  const current = toCounts(hits);
  const filesScanned = files.length;
  const bl = loadBaseline();

  if (parsed.update) {
    if (bl.exists && !parsed.force) {
      const { regressions } = diffBaseline(current, bl.counts);
      if (regressions.length) {
        console.log(
          `[基线守卫] 新增 ${regressions.length} 处未受管 Worker（超基线），拒绝更新——确认属实请加 --force`,
        );
        for (const r of regressions.slice(0, 10)) console.log(`   ${r}`);
        process.exit(1);
      }
    }
    const prevJson = JSON.stringify(bl.counts, Object.keys(bl.counts).sort());
    const newJson = JSON.stringify(current, Object.keys(current).sort());
    if (bl.exists && prevJson === newJson) {
      console.log(`[worker-lifecycle] 基线无变化（${hits.length} 处债务），跳过写入`);
      process.exit(0);
    }
    writeBaseline(current, parsed.force ? "（--force 覆盖写入）" : "（--update 收紧）");
    console.log(
      `[worker-lifecycle] 基线已写入: ${relative(REPO_ROOT, BASELINE_FILE)}（${hits.length} 处债务 / ${Object.keys(current).length} 文件）`,
    );
    process.exit(0);
  }

  if (!bl.exists) {
    console.error("❌ 基线不存在（docs/.worker-lifecycle-baseline.json）——先跑 --update 初始化");
    process.exit(1);
  }

  const { regressions, fixed } = diffBaseline(current, bl.counts);
  const ok = regressions.length === 0;
  const baselineTotal = Object.values(bl.counts).reduce(
    (s, r) => s + Object.values(r).reduce((a, b) => a + (b ?? 0), 0),
    0,
  );

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            ok,
            total: hits.length,
            files: Object.keys(current).length,
            scannedFiles: filesScanned,
            workerSites: totalSites,
            baseline: baselineTotal,
            regressions: regressions.length,
            fixed: fixed.length,
            warns_list: regressions,
          },
          hits,
          regressions,
          fixed,
        },
        null,
        2,
      ),
    );
    process.exit(ok ? 0 : 1);
  }

  console.log("=== Worker 生命周期检查（终止出口/工厂/豁免/基线）===");
  console.log(
    `扫描: ${filesScanned} 个生产文件 / ${totalSites} 处 \`new Worker(\` / 命中 ${hits.length} 处未受管（${Object.keys(current).length} 文件承载债务）`,
  );
  if (regressions.length) {
    console.error(`❌ 新增/超出基线 ${regressions.length} 处（只减不增）：`);
    for (const r of regressions) console.error(`   ${r}`);
    console.error(
      "   → 修复: 给该模块补终止出口（export function dispose* / terminate* / reset*），" +
        "或改用 createWorkerBridge 工厂，或行内注 `// worker-allow: <理由>` 说明为何无需回收",
    );
  }
  if (fixed.length) {
    console.log(`🎉 已消除 ${fixed.length} 处债务计数（低于基线）：`);
    for (const f of fixed.slice(0, 8)) console.log(`   ${f}`);
    console.log("   运行 `node scripts/check-worker-lifecycle.ts --update` 收紧基线");
  }
  console.log(ok ? "\n✅ Worker 生命周期闸通过（存量在基线内）" : "\n❌ Worker 生命周期闸未通过");
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
