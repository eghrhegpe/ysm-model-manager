#!/usr/bin/env node
/**
 * check-doc-drift.ts — 文档三一致检查器（ADR / 知识卡 / 架构树）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 三个维度：
 *   [ADR 维度]    docs/adr/ 文件 vs adr/index.md 登记表
 *                 撞号 / 漏登 / 幽灵文件 / 编号跳号（ERROR 阻断）
 *   [知识卡维度]  docs/knowledge/ 卡 frontmatter / source_files / 索引断链
 *                 必填字段缺失 / 占位符 / 引用不存在（ERROR 阻断）
 *   [架构树维度]  docs/archive/architecture.md 反引号代码路径引用
 *                 指向磁盘不存在的文件（ERROR 阻断）
 *                 实际源码树（frontend/src/ + go/ + internal/）中未在
 *                 architecture.md 登记的子模块（INFO 基线管理，--fix 刷新）
 *                 AGENTS.md 前端目录树块 vs 磁盘实况（段缺失 → WARN；认块不认章节号）
 *
 * 用法：
 *   node scripts/check-doc-drift.ts            # 文本报告
 *   node scripts/check-doc-drift.ts --json     # JSON（CI 用）
 *   node scripts/check-doc-drift.ts --fix      # 刷新 INFO 基线（架构树未登记模块）
 *
 * 退出码：发现 ERROR → 1；否则 0（INFO/WARN 不阻断）。
 * 设计意图：文档漂移检查器（代码现实 vs 架构文档声称）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ADR_DIR, listAdrFiles, REG_ROW_ID_RE } from "./_lib/adr-files.ts";
import { parseAdrHeader, parseFrontmatter, parseSourceFiles } from "./_lib/frontmatter.ts";
import {
  getUntrackedCards,
  hasFrontmatterDelimiter,
  missingRequiredCardFields,
  stripBom,
} from "./_lib/knowledge-common.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const KC_DIR = path.join(ROOT, "docs/knowledge");
// 活文档（单一权威视图）。原三份归档（archive/architecture.md、archive/3D/*）已随文档
// 治理删除，架构树维度改比对活文档 docs/architecture.md：源码顶层模块全路径须在其正文
// 出现（见「3.6 模块全路径索引」），缺失者入 unregistered（INFO 基线，--fix 刷新）。
const ARCH_DOCS = ["docs/architecture.md"];
const BASELINE_FILE = path.join(ROOT, "scripts/baseline/doc-drift-baseline.json");

const args = parseArgs(process.argv.slice(2), {
  bools: ["json", "fix"],
  strings: ["files"],
  defaults: { json: false, fix: false, files: "" },
});
if (args.unknown.length) console.warn(`忽略未知参数: ${args.unknown.join(", ")}`);
const JSON_OUT = args.json as boolean;
const FIX_MODE = args.fix as boolean;
// 文件驱动模式（commit-check / push 门禁传入）：--files 为换行分隔的仓库相对路径，
// 仅校验本次变更的知识卡，避免并行会话留在 docs/knowledge/ 下的未跟踪草稿卡（如 commit-with-check.md）阻断本次提交。
// 与 check-redlines --files 同款裁剪；无 --files 时退化为全量扫描（向后兼容 doctor --all）。
const FILES_RAW = (args.files as string) ?? "";
const FILES_SET: Set<string> | null = FILES_RAW
  ? new Set(
      FILES_RAW.split("\n")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => path.basename(p)),
    )
  : null;

const errors: string[] = [];
const warns: string[] = [];
const infos: string[] = [];

// ── 工具函数 ──────────────────────────────────────────

function readText(rel: string) {
  const p = path.join(ROOT, rel);
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

// ── 维度 1：ADR 登记一致（复用 adr-check 核心）───────

function checkAdr() {
  if (!fs.existsSync(ADR_DIR)) {
    errors.push("[ADR] docs/adr/ 目录不存在");
    return;
  }
  const files = listAdrFiles(); // 三区：根存量 / architecture/ / decisions/（ADR-320）
  if (!files.length) {
    errors.push("[ADR] adr/ 目录下没有 ADR 文件");
    return;
  }

  const fileMeta: Record<string, any> = {};
  for (const ref of files) {
    const hdr = parseAdrHeader(ref.absPath) as any;
    if (hdr.error) {
      errors.push(`[ADR] ${ref.relPath} 首部解析失败（${hdr.error}）`);
      continue;
    }
    const id = ref.id; // 文件名编号源；标题一致性由 adr-check ID_MISMATCH 把关
    if (fileMeta[id]) {
      errors.push(`[ADR] 编号 ${id} 撞号：${fileMeta[id].file} 与 ${ref.relPath}`);
    }
    fileMeta[id] = { file: ref.relPath, id, title: hdr.title };
  }

  const regText = readText("docs/adr/index.md");
  if (regText === null) {
    errors.push("[ADR] adr/index.md 登记表不存在");
    return;
  }
  const regNums = new Set<string>();
  for (const m of regText.matchAll(REG_ROW_ID_RE)) regNums.add(m[1]!);

  for (const id of Object.keys(fileMeta).sort()) {
    if (!regNums.has(id)) errors.push(`[ADR] ${id} (${fileMeta[id].file}) 未在登记表占号`);
  }
  for (const id of [...regNums].sort()) {
    if (!fileMeta[id]) errors.push(`[ADR] 登记表有 ${id}，但磁盘无对应文件`);
  }
  return { files: files.length, registered: regNums.size };
}

// ── 维度 2：知识卡一致（复用 check-knowledge-drift 核心）──

function checkKnowledge() {
  if (!fs.existsSync(KC_DIR)) return 0;
  // 未跟踪草稿跳过仅在 --files（commit/push 裁剪）模式启用：全局模式（doctor --all /
  // 契约测试）须扫全部卡（含未跟踪草稿），否则会漏检。与 check-knowledge-drift 对齐。
  const untracked = FILES_SET ? getUntrackedCards(ROOT) : new Set<string>();
  const files = fs
    .readdirSync(KC_DIR)
    .filter((f) => f.endsWith(".md") && !/^(readme|agents)\.md$/i.test(f));
  let count = 0;
  for (const cf of files) {
    if (FILES_SET) {
      if (untracked.has(cf)) continue; // 跳过未跟踪草稿（并行会话残留，不打分）
      if (!FILES_SET.has(cf)) continue; // 仅查本次变更卡
    }
    // 带 BOM 剥除 + `^---` 锚定统一走 _lib/knowledge-common（stripBom/hasFrontmatterDelimiter）。
    const text = stripBom(fs.readFileSync(path.join(KC_DIR, cf), "utf-8"));
    if (!hasFrontmatterDelimiter(text)) continue;
    count++;
    const fm = parseFrontmatter(text);
    if (!fm) {
      errors.push(`[知识卡] ${cf} 缺少 YAML frontmatter`);
      continue;
    }
    for (const key of missingRequiredCardFields(fm)) {
      errors.push(`[知识卡] ${cf} 缺少必填字段 ${key}`);
    }
    const placeholderM = fm.match(/<[a-z_]+>/);
    if (placeholderM) errors.push(`[知识卡] ${cf} 含未填充占位符 <...>`);

    // source_files 存在性——复用共享解析器（inline array 与 block list 两种格式
    // 均由 _lib/frontmatter.ts parseSourceFiles 统一处理，与 check-knowledge-drift
    // 行为一致；此前手写双解析存在分叉风险，code_review P3）
    const srcItems = parseSourceFiles(fm);
    for (const v of srcItems) {
      if (!fs.existsSync(path.join(ROOT, v)))
        errors.push(`[知识卡] ${cf} 的 source_files 引用不存在: ${v}`);
    }
  }
  // 索引断链（全局一致性检查，仅非裁剪模式执行）
  if (!FILES_SET) {
    for (const idx of ["index.md"]) {
      const idxText = readText(`docs/knowledge/${idx}`);
      if (!idxText) continue;
      for (const m of idxText.matchAll(/\]\(\.\/([a-zA-Z0-9_-]+\.md)\)/g)) {
        if (!fs.existsSync(path.join(KC_DIR, m[1]!)))
          errors.push(`[知识卡] 索引 ${idx} 链接指向不存在的卡: ${m[1]}`);
      }
    }
  }
  return count;
}

// ── 维度 3：架构树一致（新增）────────────────────────

const CODE_PATH_RE = /`((?:frontend|go|internal|scripts)\/[a-zA-Z0-9_./-]+)`/g;

/**
 * 该路径是否被 .gitignore 排除（= 构建产物 / 生成物，从不入 git）。
 *
 * 判据交给 git 本尊裁决（`git check-ignore`），不手写 glob——仓内忽略规则散在
 * .gitignore 多行（`frontend/dist`、`*.exe`、`frontend/src/wasm/ysm-wasm-data*.js`…），
 * 手抄一份必然漂移。数组式传参（仓内惯例），不走 shell 拼接。
 * fail-open：git 不可用 / 非 git 环境时不豁免（保持原有「报 ERROR」的严格性），
 * 避免把「判不了」静默变成「放过」。
 */
const gitIgnoredCache = new Map<string, boolean>();
function isGitIgnored(ref: string): boolean {
  const cached = gitIgnoredCache.get(ref);
  if (cached !== undefined) return cached;
  let ignored = false;
  try {
    // check-ignore 命中 → exit 0；未命中 → exit 1（故不能只看异常）
    execFileSync("git", ["check-ignore", "-q", "--", ref], {
      cwd: ROOT,
      stdio: "ignore",
    });
    ignored = true;
  } catch {
    ignored = false;
  }
  gitIgnoredCache.set(ref, ignored);
  return ignored;
}

/** 提取架构文档中的代码路径引用并验证存在性。已知过期引用记录在基线 staleRefs 中。 */
function checkArchRefs() {
  let baseline: Record<string, any> = { staleRefs: [] };
  if (fs.existsSync(BASELINE_FILE)) {
    // ADR-043 fail-closed：基线 JSON 损坏不得静默当空——staleRefs 清空会让此前
    // 登记为 stale 的引用全部重新报 ERROR（假阳性淹没真问题）
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8"));
    } catch (e) {
      errors.push(
        `[架构树] 基线文件损坏（${BASELINE_FILE}）：${(e as Error).message}——请修复或删除后重跑，切勿静默放行`,
      );
      baseline = { staleRefs: [] };
    }
  }
  const staleRefs = new Set(baseline.staleRefs || []);
  for (const doc of ARCH_DOCS) {
    const text = readText(doc);
    if (text === null) {
      infos.push(`[架构树] ${doc} 不存在，跳过`);
      continue;
    }
    for (const m of text.matchAll(CODE_PATH_RE)) {
      const ref = m[1]!;
      if (staleRefs.has(ref)) continue;
      if (!fs.existsSync(path.join(ROOT, ref))) {
        // 生成物豁免（2026-10-07 根因修）：架构文档合法地会登记**构建产物**路径
        // （frontend/dist/wasm/YSMParser.wasm、go/updater/ysm-updater-helper.exe、
        // frontend/src/wasm/ysm-wasm-data*.js 等），它们被 .gitignore 排除、**从不入 git**，
        // 故在干净检出（CI 全新 clone）里必然不存在。原实现一律报 ERROR ⇒ CI 结构性恒红
        // 且与改动无关（本地因跑过 build 而恒绿，属「本地绿 CI 红」形态）。
        // 判据：交给 git 裁决「是否被忽略」——被忽略即视为「产物未构建」而非「文档过期」，
        // 与仓内「生成物不承担提交归属」口径一致（AGENTS.md 归属原则）。
        if (isGitIgnored(ref)) {
          infos.push(`[架构树] ${doc} 引用构建产物（git 忽略，未构建时不存在）: ${ref}`);
          continue;
        }
        errors.push(`[架构树] ${doc} 引用不存在的路径: ${ref}`);
      }
    }
  }
}

/** AGENTS.md 前端目录树块 vs 磁盘实况（段缺失 → WARN，可能是规划中目录）。
 *  认块不认章节号：AGENTS.md 持续瘦身重排，锚定「§4.2」这类标题正是空转成因
 *  （2026-10 该章节已随瘦身消失，旧匹配恒 miss、闸门静默失效无人察觉）。
 *  识别口径 = 正文任一围栏代码块含 frontend/src/ 即视为目录树逐段验真；
 *  无此类块 = 瘦身后健康态（手写树另由 check-knowledge-drift 检查4 拦截），仅记 INFO。 */
function checkAgentsTree() {
  const text = readText("AGENTS.md");
  if (text === null) return;
  let block: string | null = null;
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    if (m[1]!.includes("frontend/src/")) {
      block = m[1]!;
      break;
    }
  }
  if (block === null) {
    infos.push("[架构树] AGENTS.md 无前端目录树代码块（瘦身后健康态；手写树由 check-knowledge-drift 检查4 拦截）");
    return;
  }
  const lines = block.split(/\r?\n/);
  const rootIdx = lines.findIndex((l) => l.includes("frontend/src/"));
  if (rootIdx < 0) return;
  for (const line of lines.slice(rootIdx + 1)) {
    const segM = line.match(/^\s{2}(?![│├└─])([^\s—]+)/);
    if (!segM) continue;
    let seg = segM[1]!;
    if (seg.startsWith("frontend/src/")) seg = seg.slice("frontend/src/".length);
    seg = seg.split("/")[0]!;
    if (!seg) continue;
    if (!fs.existsSync(path.join(ROOT, "frontend/src", seg))) {
      warns.push(
        `[架构树] AGENTS.md 目录树描述 frontend/src/${seg} 但磁盘不存在（疑似规划中目录或已删除）`,
      );
    }
  }
}

/** 收集实际源码树一层子模块（frontend/src/ + go/ + internal/）。 */
function collectSourceModules() {
  const out: string[] = [];
  const roots: Array<[string, (d: string) => boolean]> = [
    ["frontend/src", (d) => /^[a-z][a-z0-9-]*$/.test(d) && d !== "css"],
    ["go", (d) => /^[a-z][a-z0-9-]*$/.test(d)],
    ["internal", (d) => /^[a-z][a-z0-9-]*$/.test(d)],
  ];
  for (const [rel, filter] of roots) {
    const dir = path.join(ROOT, rel);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      if (!fs.statSync(path.join(dir, d)).isDirectory() || !filter(d)) continue;
      out.push(`${rel}/${d}`);
    }
  }
  return out.sort();
}

/** 架构文档未登记模块 → INFO；--fix 刷新基线。 */
function checkArchCoverage() {
  const modules = collectSourceModules();
  const archText = ARCH_DOCS.map((d) => readText(d) || "").join("\n");
  const unregistered = modules.filter((m) => !archText.includes(m));

  let baseline: Record<string, any> = { unregistered: [] };
  if (fs.existsSync(BASELINE_FILE)) {
    // ADR-043 fail-closed：同上——损坏基线不得静默当空（--fix 前无法正确比对）
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8"));
    } catch (e) {
      errors.push(
        `[架构树] 基线文件损坏（${BASELINE_FILE}）：${(e as Error).message}——请修复或删除后重跑 --fix`,
      );
      baseline = { unregistered: [] };
    }
  }
  const known = new Set(baseline.unregistered || []);

  if (FIX_MODE) {
    // 守卫：工具缺失（knip/jscpd）禁止写盘，防止空基线洗白债务。
    // 移除「只许减少」守卫：AI 友好，避免因新增项拒绝写入导致 AI 绕 10K token 元认知。
    if (errors.length > 0) {
      console.log(errors.join("\n"));
      console.log("✖ 基线未更新（存在守卫拦截）");
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify({ generated: new Date().toISOString(), unregistered }, null, 2)}\n`,
    );
    infos.push(`[架构树] --fix 已刷新基线（${unregistered.length} 个未登记模块）`);
    return;
  }

  for (const m of unregistered) {
    if (!known.has(m))
      infos.push(`[架构树] 源码模块 ${m} 未在架构文档登记（INFO，--fix 纳入基线）`);
  }
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  const adr = checkAdr();
  const kc = checkKnowledge();
  checkArchRefs();
  checkArchCoverage();
  checkAgentsTree();

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            errors: errors.length,
            warns: warns.length,
            infos: infos.length,
            adrFiles: adr?.files,
            adrRegistered: adr?.registered,
            knowledgeCards: kc,
          },
          errors,
          warns,
          infos,
          summary: { adrFiles: adr?.files, adrRegistered: adr?.registered, knowledgeCards: kc },
        },
        null,
        2,
      ),
    );
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" 文档三一致检查 (check-doc-drift)");
  console.log("══════════════════════════════════════");
  console.log(`ADR 维度     : ${adr ? `${adr.files} 文件 / 登记 ${adr.registered}` : "FAILED"}`);
  console.log(`知识卡维度   : ${kc ?? 0} 卡`);
  console.log(`ERROR       : ${errors.length}`);
  console.log(`WARN        : ${warns.length}`);
  console.log(`INFO        : ${infos.length}`);
  console.log("──────────────────────────────────────");

  if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);
  if (infos.length) for (const i of infos) console.log(`ℹ ${i}`);
  if (errors.length) {
    for (const e of errors) console.log(`❌ ${e}`);
    console.log("→ 修复: node scripts/check-doc-drift.ts --fix（刷新架构树基线）");
    console.log("\n退出码 1（可接 CI 卡点）。");
    process.exit(1);
  }
  console.log("✅ 三一致通过：ADR 登记、知识卡、架构树均无 ERROR 级漂移。");
}

main();
