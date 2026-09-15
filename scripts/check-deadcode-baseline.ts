#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * check-deadcode-baseline.ts — 死代码 / 重复代码基线守卫。
 *
 * 调用 knip（死代码）+ jscpd（重复代码）的 JSON 输出，与基线
 * scripts/baseline/deadcode-baseline.json 对比，并按「归属裁剪」分流：
 *   - 新增 ∩ 责任文件集（显式 --base 范围 / staged / 未推送提交改动）→ ERROR（自己的债自己还）
 *   - 新增 ∩ 责任集为空 → 自动收编进基线 + INFO 留痕（他人遗留债务不拦路，但记账）
 *   - 基线已知项      → OK（放行，支持渐进清理）
 *   - 基线中已消失项  → INFO（已清理；收编写盘时一并移除）
 *   - 无任何变更上下文可归属 → 严格模式：全部新增阻断（fail-closed）
 *
 * ⚠️ CI 必须传 `--base`（或 env `YSM_DEADCODE_BASE`）：CI 跑在 **push 之后**，此时
 *    staged / 未提交 / 未跟踪三源全空，且 `origin/main...HEAD` 也空（远端已推进到本次提交）
 *    ⇒ 责任集恒为 null ⇒ 严格模式全阻断；而 CI 传 `--json` 又关掉自动收编写盘
 *    ⇒ 门禁**结构性恒红且无法自愈**（2026-09-15 实证：main 连红两天，任何非基线死代码都阻断，
 *    报的还全是别的会话的债）。调用方给出本次变更范围的基线 ref（push = `github.event.before`、
 *    PR = base.sha），责任集才能落在「本次范围真正改过的文件」上——同 `_lib/changed-scope.ts` 的味。
 *
 * 依赖：frontend/ 需安装 knip + jscpd（npm i -D knip jscpd）。
 *
 * 用法：
 *   node scripts/check-deadcode-baseline.ts              # 对比基线
 *   node scripts/check-deadcode-baseline.ts --update-baseline   # 刷新基线（直接写入，不拦新增项）
 *   node scripts/check-deadcode-baseline.ts --json       # JSON（CI 用）
 *   node scripts/check-deadcode-baseline.ts --json --base <rev> # 显式变更范围（CI push/PR 必传）
 *   node scripts/check-deadcode-baseline.ts --update-baseline --force  # 同 --update-baseline（--force 保留兼容）
 *
 * 退出码：新增 ERROR → 1；工具缺失 → 1；否则 0。
 * 设计意图：死代码基线检查（与 baseline 文件比对）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canWriteBaseline,
  parseBaseRef,
  resolveResponsibleFiles,
  splitNewFindings,
} from "./_lib/deadcode-attrib.ts";
import { ROOT, toPosix } from "./_lib/scan-files.ts";
import { checkStale } from "./_lib/stale-baseline.ts";
import { resolveToolBin } from "./_lib/tool-bin.ts";

const FRONTEND = path.join(ROOT, "frontend");
const BASELINE_FILE = path.join(ROOT, "scripts/baseline/deadcode-baseline.json");

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has("--json");
const UPDATE = ARGS.has("--update-baseline");

/**
 * 显式变更范围（2026-09-15，ADR-244）：`--base <rev>` 或 env `YSM_DEADCODE_BASE`。
 * CI 专用——push 之后 staged / 未提交 / 未跟踪三源必然全空，只能由调用方告知变更范围。
 * 空值 / 缺省 → null（本地既有语义完全不变）。解析与语义见 `_lib/deadcode-attrib.ts`。
 */
const BASE_REF = parseBaseRef(process.argv.slice(2), process.env);

const errors: string[] = [];
const infos: string[] = [];
let knipFindings: string[] = [];
let jscpdFindings: string[] = [];
// 输出解析失败 flag（执行成功但输出不可消费——假零发现，禁止写盘防洗白）
let knipParseFailed = false;
let jscpdParseFailed = false;

// ── 工具探测与执行 ────────────────────────────────────

function bin(name: string) {
  // 双根探测收敛至 _lib/tool-bin.ts 单一事实源（2026-09-15）：本地工具落在根 .bin、
  // CI 只在 frontend/ 装依赖 ⇒ 单路径硬编码必「本地绿、CI 红」。
  return resolveToolBin(name);
}

function run(name: string, args: string[], opts: { allowExit1?: boolean; cwd?: string } = {}) {
  const exe = bin(name);
  if (!exe) {
    errors.push(`[工具缺失] ${name} 未安装：cd frontend && npm i -D ${name}`);
    return null;
  }
  const r = spawnSync(exe, args, {
    cwd: opts.cwd ?? FRONTEND,
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  // knip 发现死代码时 exit 1（正常报告行为），允许此类退出码
  const ok = r.status === 0 || (opts.allowExit1 && r.status === 1);
  if (!ok) {
    errors.push(
      `[执行失败] ${name} 退出码 ${r.status}：${(r.stderr || r.stdout || "").slice(0, 300)}`,
    );
    return null;
  }
  return r.stdout;
}

// ── knip 输出解析（兼容 v3/v4/v5 格式）─────────────────
// v5 实际格式：issues: [{ file, exports: [{name,line,col}], files: [{name}],
//                        types: [...], unlisted: [...], ... }]
// 每项按类型挂数组；files 数组 = 整个文件未使用；其余数组 = 该类型未使用项。

const KNIP_TYPES = [
  "exports",
  "types",
  "enumMembers",
  "unlisted",
  "dependencies",
  "devDependencies",
  "binaries",
  "namespaceMembers",
  "duplicates",
  "catalog",
  "catalogReferences",
  "optionalPeerDependencies",
  "unresolved",
];

function parseKnip(stdout: string) {
  try {
    const data = JSON.parse(stdout);
    const out: string[] = [];
    if (Array.isArray(data.issues)) {
      for (const it of data.issues) {
        const file = it.file || "?";
        for (const type of KNIP_TYPES) {
          for (const item of it[type] || []) {
            const name = typeof item === "string" ? item : item.name || "";
            out.push(`${file}|${type}|${name}`);
          }
        }
        for (const f of it.files || []) {
          out.push(`${file}|file|${typeof f === "string" ? f : f.name || ""}`);
        }
      }
    } else if (data.files && typeof data.files === "object") {
      // v3/v4：files: { "path": [issues...] }
      for (const [file, issues] of Object.entries(data.files as Record<string, any>)) {
        for (const it of issues) {
          out.push(`${file}|${typeof it === "string" ? it : it.issueType || JSON.stringify(it)}`);
        }
      }
    }
    return out;
  } catch {
    knipParseFailed = true;
    errors.push("[解析失败] knip 输出非 JSON（可能被插件/告警污染），请手工运行 npx knip 排查");
    return [];
  }
}

// ── jscpd 输出解析 ────────────────────────────────────
// jscpd 将 JSON 报告写入 cwd 下 report/jscpd-report.json（--output 对 json
// reporter 不生效），克隆数据在 duplicates 数组。

// 竞态修复（2026-09-13，门禁锐评 P0）：jscpd 报告固定写「cwd 下 report/」，此前
// cwd=frontend → 并行会话同跑门禁时两进程读/删同一个 frontend/report/jscpd-report.json，
// 表现为「同提交第一次红、第二次绿」的瞬态 FAIL——与「判定可复现」直接冲突。
// 现改为每进程独立临时工作目录（mkdtemp，路径含随机后缀天然互斥）：报告落在
// 私有目录内，读完后整目录清理；扫描 pattern 用绝对路径指回 frontend/src，语义不变。
let jscpdWork: string | null = null;

function jscpdReportPath() {
  if (!jscpdWork) throw new Error("jscpd 工作目录未初始化");
  return path.join(jscpdWork, "report", "jscpd-report.json");
}

function parseJscpd() {
  try {
    const data = JSON.parse(fs.readFileSync(jscpdReportPath(), "utf-8"));
    const clones = data.duplicates || [];
    return clones.map((c: any) => {
      // jscpd 在 Windows 输出反斜杠路径（如 views\a.ts），基线为正斜杠——
      // 统一 toPosix 归一化，否则跨平台比对全部误判「新增」（code_review P3）
      const f1 = toPosix(c.firstFile?.name || "?");
      const f2 = toPosix(c.secondFile?.name || "?");
      // key 用文件对级（去行号）：克隆位置随代码微移漂移时，不产生新 key 误报新增
      return `${f1}#${f2}`;
    });
  } catch {
    jscpdParseFailed = true;
    errors.push("[解析失败] jscpd 报告读取异常（私有临时目录 report/jscpd-report.json）");
    return [];
  }
}

// ── 责任文件集解析（归属裁剪）─────────────────────────
// 语义与解析顺序已下沉 `_lib/deadcode-attrib.ts`（纯逻辑可契约测试）：
//   ⓪ 显式 --base（CI push/PR 唯一可用上下文，结果允许为空数组）
//   ①②③ 本地三源 staged / 未暂存 / 未跟踪 → ④ 未推送提交 diff → null（严格模式全阻断）

/** git 运行器：成功 stdout、失败 null（与 _lib 的 GitRunner 同口径）。 */
const gitRunner = (...args: string[]) => {
  const r = spawnSync("git", args, { encoding: "utf-8" });
  return r.status === 0 ? r.stdout : null;
};

// ── 主流程 ────────────────────────────────────────────

function main() {
  const knipOut = run("knip", ["--reporter", "json"], { allowExit1: true });
  if (knipOut !== null) knipFindings = parseKnip(knipOut);

  // jscpd 执行结果（null = 执行失败）：写盘守卫 canWriteBaseline 需要区分
  // 「执行成功零发现」与「执行失败」，声明提升到 try 块外供后续守卫消费
  let jscpdOut: string | null = null;

  // jscpd 5.x 发现重复代码时默认 exit 0（未传 --threshold/--exitCode），
  // exit 1 仅代表真实失败（glob 错误/IO/崩溃）——不传 allowExit1，让真实失败
  // 以 [执行失败] 暴露，而非被掩盖成 [解析失败]/消费陈旧报告（code_review P3）
  // jscpd v5 Rust 内核：显式 --format typescript,javascript 确保 .ts/.tsx 不被静默跳过
  //（无 --format 时依赖扩展名自动检测，不同 jscpd 版本行为偶有漂移；显式声明更稳定）。
  //
  // 扫描根 = 位置参数（绝对路径）+ --pattern 限扩展名：竞态修复（4172b8dad）把 cwd 迁到
  // 私有 tmpdir 防两进程写同一 frontend/report/，副作用是「绝对 --pattern + tmpdir cwd」
  // 形态下 jscpd 扫 0 文件（globby 相对 cwd 解析，跨目录绝对 glob 不生效）→ jscpd 静默
  // no-op、重复代码检查恒零发现。修正：用位置参数传绝对扫描根（jscpd 官方入口，支持
  // 绝对路径），--pattern 只管扩展名过滤；报告落 tmpdir/report/，仍与并发进程隔离。
  try {
    jscpdWork = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-gate-"));
    jscpdOut = run(
      "jscpd",
      [
        toPosix(path.join(FRONTEND, "src")),
        "--pattern",
        "**/*.{js,ts}",
        "--min-lines",
        "10",
        "--min-tokens",
        "50",
        "--format",
        "typescript,javascript",
        "--reporters",
        "json",
        "--silent",
      ],
      { cwd: jscpdWork },
    );
    if (jscpdOut !== null) {
      jscpdFindings = parseJscpd();
    }
  } finally {
    // 清理整个私有工作目录（报告是分析副产物，目录含随机后缀，整删无误伤风险；
    // finally 保证解析失败/异常路径也不残留垃圾目录）
    if (jscpdWork) fs.rmSync(jscpdWork, { recursive: true, force: true });
  }

  const current = {
    knip: [...new Set(knipFindings)].sort(),
    jscpd: [...new Set(jscpdFindings)].sort(),
  };

  if (UPDATE) {
    // 守卫：工具缺失（knip/jscpd 执行失败返回 null）或输出解析失败（假零发现）
    // 禁止写盘——否则空 findings 被写盘后旧债务全部洗白（门禁锐评 P1-3 漏洞；
    // 解析失败路径为 code_review P2 回归：执行成功但输出不可消费同样算失败）。
    if (
      !canWriteBaseline(
        knipFindings,
        knipOut,
        knipParseFailed,
        jscpdFindings,
        jscpdOut,
        jscpdParseFailed,
      )
    ) {
      errors.push(
        "[工具结果不可信] knip/jscpd 未执行成功或输出解析失败，拒绝写盘（防止空基线洗白债务）",
      );
    }
    if (errors.length > 0) {
      console.log(errors.join("\n"));
      console.log("✖ 基线未更新（存在守卫拦截）");
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify({ generated: new Date().toISOString(), ...current }, null, 2)}\n`,
    );
    infos.push(
      `--update-baseline：已写入 ${current.knip.length} 条 knip + ${current.jscpd.length} 条 jscpd 基线`,
    );
  } else if (fs.existsSync(BASELINE_FILE)) {
    let base: unknown;
    try {
      base = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8"));
    } catch {
      errors.push("[基线损坏] deadcode-baseline.json 无法解析，可删除后重跑 --update-baseline");
      base = { knip: [], jscpd: [] };
    }
    const staleWarn = checkStale((base as { generated?: string }).generated, "deadcode");
    if (staleWarn) infos.push(staleWarn);
    const baseObj = (base ?? {}) as { knip?: string[]; jscpd?: string[] };
    const baseK = new Set<string>(baseObj.knip || []);
    const baseJ = new Set<string>(baseObj.jscpd || []);
    const newK = current.knip.filter((k) => !baseK.has(k));
    const newJ = current.jscpd.filter((k) => !baseJ.has(k));
    const goneK = [...baseK].filter((k) => !current.knip.includes(k));
    const goneJ = [...baseJ].filter((k) => !current.jscpd.includes(k));

    const newKeys = [...newK, ...newJ];
    const responsible = resolveResponsibleFiles(gitRunner, BASE_REF, infos);
    const strictMode = responsible === null;
    const { blocking, absorbable } = splitNewFindings(
      newKeys,
      strictMode ? null : new Set(responsible),
    );

    for (const k of blocking) {
      errors.push(`[新增死代码/重复代码·归属本次改动] ${k}`);
    }
    for (const k of absorbable) {
      infos.push(`[自动收编] 非本次改动的遗留发现: ${k}`);
    }
    if (strictMode && newKeys.length > 0) {
      infos.push("严格模式：无 staged / 未推送上下文可归属，全部新增按阻断处理");
    }

    // 自动收编：无阻断项且有他人遗留债务时刷新基线（与 --update-baseline 同守卫，
    // 工具执行失败/输出解析失败禁止写盘防洗白）；CI（--json）只报告不写盘。
    if (blocking.length === 0 && absorbable.length > 0 && !JSON_OUT) {
      const canWrite = canWriteBaseline(
        knipFindings,
        knipOut,
        knipParseFailed,
        jscpdFindings,
        jscpdOut,
        jscpdParseFailed,
      );
      if (canWrite) {
        fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
        fs.writeFileSync(
          BASELINE_FILE,
          `${JSON.stringify({ generated: new Date().toISOString(), ...current }, null, 2)}\n`,
        );
        infos.push(
          `基线已自动收编并写盘：${current.knip.length} 条 knip + ${current.jscpd.length} 条 jscpd`,
        );
      } else {
        for (const k of absorbable) errors.push(`[收编失败·工具结果不可信，拒绝写盘] ${k}`);
      }
    }

    for (const k of goneK.slice(0, 10)) infos.push(`[已清理] knip 基线项消失: ${k}`);
    for (const k of goneJ.slice(0, 10)) infos.push(`[已清理] jscpd 基线项消失: ${k}`);
  } else {
    // ADR-043 fail-closed：无基线文件 = 无法比对 = 扫描不完整，必须 ERROR 而非 INFO——
    // 此前仅提示「首次运行请建基线」后 exit 0，门禁把「未建立基线」误当「无新增死代码」放行
    errors.push(
      "无基线文件（deadcode-baseline.json 不存在）——无法比对死代码/重复代码，请先运行 node scripts/check-deadcode-baseline.ts --update-baseline 建立基线",
    );
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            errors: errors.length,
            infos: infos.length,
            knip: current.knip.length,
            jscpd: current.jscpd.length,
          },
          errors,
          infos,
          current,
          baselineUpdated: UPDATE,
        },
        null,
        2,
      ),
    );
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" 死代码/重复代码基线 (check-deadcode-baseline)");
  console.log("══════════════════════════════════════");
  console.log(`knip 发现  : ${current.knip.length}`);
  console.log(`jscpd 发现 : ${current.jscpd.length}`);
  console.log(`ERROR      : ${errors.length}`);
  console.log(`INFO       : ${infos.length}`);
  console.log("──────────────────────────────────────");

  for (const i of infos) console.log(`ℹ ${i}`);
  if (errors.length) {
    for (const e of errors.slice(0, 25)) console.log(`❌ ${e}`);
    if (errors.length > 25) console.log(`  … 其余 ${errors.length - 25} 条（--json 全量）`);
    console.log("→ 归属本次改动的债：删除未引用导出，或确认保留后 --update-baseline 纳入");
    console.log("");
    console.log("  解读（错误行格式 <文件>|<类型>|<符号>）：");
    console.log(
      "    exports / types / enumMembers = 未使用的导出 / 类型 / 枚举成员（删掉或确认保留）",
    );
    console.log("    file = 整个文件未被引用；jscpd 项 <文件A>#<文件B> = 两文件重复代码块");
    console.log(`  基线：${path.relative(ROOT, BASELINE_FILE)}（已知债务白名单，仅放行基线内项；`);
    console.log("    基线中已消失项自动标记 [已清理]，下轮收编时移除）");
    console.log("  归属：仅「本次改动文件」内新增项阻断；他人遗留债务自动收编不拦路（记账留痕）");
    console.log("  更新基线：node scripts/check-deadcode-baseline.ts --update-baseline");
    console.log("\n退出码 1（新增死代码/重复代码·归属本次改动，阻断）。");
    process.exit(1);
  }
  console.log("✅ 无新增死代码/重复代码（基线内已知项放行）。");
}

main();
