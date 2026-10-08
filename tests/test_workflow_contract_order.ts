#!/usr/bin/env node
/**
 * 契约测试：CI 工作流关键顺序不变量（静态扫描 .github/workflows/*.yml）。
 *
 * 背景（2026-10-08 门禁锐评落地）：CI 的顺序正确性此前全靠注释传递——拆 job 时
 * 步骤搬走、注释的上下文没搬走（test.yml contracts job 的 check-redlines 注释曾
 * 引用本 job 不存在的「下方安装前端依赖」，即孤魂注释）。本测试把四类顺序不变量
 * 提升为可执行断言，让顺序从注释变成机器可验的契约：
 *
 *   R1 fail-fast：WAILS 版本双源守卫必须先于 setup-go（版本错配是最便宜的错，最先死）。
 *   R2 契约测试零前端依赖防线：同 job 内 contract-tests 必须先于任何前端依赖安装
 *      （防「测试依赖前端依赖」病灶复发；契约测试必须在 install 前跑得动）。
 *   R3 embed 前置：go build/vet/golangci 前必须已有 vite build 产物
 *      （main.go `//go:embed all:frontend/dist` 编译期硬契约）。
 *   R4 release 串行止损：release.yml 的 test 门禁必须 needs: prepare
 *      （秒级版本校验失败时重型测试根本不启动，不白烧分钟）。
 *   R5 阶段门控：test.yml 的 e2e/e2e-web 必须 needs: contracts
 *      （契约失败大概率前端契约崩，最贵的一档不空跑；frontend/go 保持并行取 max）。
 *
 * 判定：文本层扫描（同 test_workflow_contract_runner.ts），按 job 块切分，
 * 块内按行号比较先后。规则未命中交集（job 内二者不同时存在）→ 跳过不判，
 * 只在二者共存的 job 内强制顺序。
 *
 * 运行：node tests/test_workflow_contract_order.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../scripts/_lib/scan-files.ts";

const WF_DIR = path.join(ROOT, ".github", "workflows");

let failed = 0;
const fail = (msg: string): void => {
  console.error(`[FAIL] ${msg}`);
  failed++;
};

/** 剥掉整行注释（YAML `#` 注释），保留 # 出现在引号内的情况——本仓注释大量引用反例，必须掩码。 */
const stripComment = (line: string): string => {
  const t = line.trimStart();
  if (t.startsWith("#")) return "";
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

/** 顶层 job 块（jobs: 之后缩进 2 的键）；end 为独占边界行号。 */
interface JobBlock {
  name: string;
  start: number;
  end: number;
}

function splitJobs(raw: string): JobBlock[] {
  const lines = raw.split("\n");
  const jobs: JobBlock[] = [];
  let inJobs = false;
  let cur: JobBlock | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
        continue;
      }
      continue;
    }
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(line)) {
      if (cur) {
        cur.end = i;
        jobs.push(cur);
      }
      cur = { name: line.trim().replace(/:$/, ""), start: i, end: lines.length };
      continue;
    }
  }
  if (cur) jobs.push(cur);
  return jobs;
}

/** 块内（含块首）剥注释后命中特征的行号集合（1-based）。 */
function hitLines(lines: string[], start: number, end: number, re: RegExp): number[] {
  const hits: number[] = [];
  for (let i = start; i < end; i++) {
    const code = stripComment(lines[i] ?? "");
    if (re.test(code)) hits.push(i + 1);
  }
  return hits;
}

if (!fs.existsSync(WF_DIR)) {
  console.log("⚠️ 无 .github/workflows 目录，跳过工作流顺序不变量守护");
  process.exit(0);
}

const wfFiles = fs
  .readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort();

// ─── R1/R2/R3：job 内先后序（before 必须先于 after）─────────────────
const PAIR_RULES: { id: string; why: string; before: RegExp; after: RegExp }[] = [
  {
    id: "R1",
    why: "WAILS 版本双源守卫必须先于 setup-go（fail-fast：最便宜的错最先死）",
    before: /WAILS 版本双源守卫/,
    after: /uses:\s*actions\/setup-go/,
  },
  {
    id: "R2",
    why: "契约测试必须先于前端依赖安装（测试不得依赖前端依赖的隐性防线）",
    before: /scripts\/contract-tests\.ts/,
    after: /pnpm install|npm (ci|install)/,
  },
  {
    id: "R3",
    why: "go build/vet/golangci 前必须已有 vite build 产物（//go:embed 编译期硬契约）",
    before: /pnpm exec vite build/,
    after: /go build \.\/\.\.\.|golangci-lint run/,
  },
];

// ─── R4/R5：job 必须具备的 needs（串行止损 / 阶段门控）────────────────
const NEEDS_RULES: { id: string; why: string; file: RegExp; jobs: string[]; need: RegExp }[] = [
  {
    id: "R4",
    why: "release.yml 的 test 门禁必须 needs: prepare（秒级版本校验失败时重型测试不启动）",
    file: /release\.ya?ml$/,
    jobs: ["test"],
    need: /needs:[^\n]*prepare/,
  },
  {
    id: "R5",
    why: "test.yml 的 e2e/e2e-web 必须 needs: contracts（阶段门控：最贵一档不空跑）",
    file: /test\.ya?ml$/,
    jobs: ["e2e", "e2e-web"],
    need: /needs:[^\n]*contracts/,
  },
];

let pairChecked = 0;
for (const f of wfFiles) {
  const raw = fs.readFileSync(path.join(WF_DIR, f), "utf8");
  const lines = raw.split("\n");
  for (const job of splitJobs(raw)) {
    // 先后序规则
    for (const rule of PAIR_RULES) {
      const before = hitLines(lines, job.start, job.end, rule.before);
      const after = hitLines(lines, job.start, job.end, rule.after);
      if (before.length === 0 || after.length === 0) continue; // 无交集，不判
      pairChecked++;
      if (Math.min(...before) > Math.min(...after)) {
        fail(
          `R1-R3 违规（${rule.id}）：${f} 的 job「${job.name}」——` +
            `${rule.why}。命中：before@行 ${before.join(",")} / after@行 ${after.join(",")}`,
        );
      }
    }
    // needs 规则
    for (const rule of NEEDS_RULES) {
      if (!rule.file.test(f) || !rule.jobs.includes(job.name)) continue;
      const needHits = hitLines(lines, job.start, job.end, rule.need);
      if (needHits.length === 0) {
        fail(`R4/R5 违规（${rule.id}）：${f} 的 job「${job.name}」——${rule.why}`);
      }
    }
  }
}

console.log(`  扫描 ${wfFiles.length} 个 workflow，先后序交集 ${pairChecked} 处`);

if (failed > 0) {
  console.error(`\n❌ 契约测试失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ CI 工作流顺序不变量（R1-R5）通过");
