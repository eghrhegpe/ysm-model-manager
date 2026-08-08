/**
 * ai-mistake-tracker.mjs — AI 犯错追踪器（git 历史修复模式分析）
 *
 * 设计意图：AI 犯错追踪器（git 历史修复模式分析）
 *
 * 依赖：node:child_process / node:path / node:url
 *
 * 用法：
 *   node scripts/ai-mistake-tracker.mjs                 # 默认行为
 *   node scripts/ai-mistake-tracker.mjs --json    # JSON 输出（CI/子代理消费）
 *   node scripts/ai-mistake-tracker.mjs --limit N # 启用 limit N
 *
 * 退出码：0（无 process.exit 调用）
 */
import { execFileSync } from "node:child_process";
import { ROOT } from './_lib/scan-files.mjs';



const CATEGORIES = [
  ["ts",          /\b\(ts\)\b|typecheck|typescript|\.ts 化|\.js → \.ts/],
  ["docs",        /\b\(docs\)\b|文档|断链|adr|知识卡/],
  ["ci",          /\b\(ci\)\b|workflow|release\.yml|github actions/],
  ["scripts",     /\b\(scripts\)\b|\.mjs|脚本|工具链/],
  ["tests",       /\b\(tests\)\b|契约测试|test_|vitest/],
  ["go",          /\b\(go\)\b|internal\/|binding|后端|go\.mod/],
  ["workshop",    /workshop|创意工坊|创作者/],
  ["wasm",        /wasm|ysm-parser|glue-data|base64|解析/],
  ["preview",     /preview|预览|model2d|model3d|skeleton|renderer|pivot|坐标|变换|透明|骨骼|渲染|uv|纹理/],
  ["ui",          /\b\(ui\)\b|css|组件|theme|样式/],
];

const RULE_VIOLATIONS = {
  git_add_all: /git add \./,          // 多会话并行时 git add . 会混入他人特性（单会话不受限，此处仅统计信号）
  stash: /git stash/,                 // 宪法禁止 git stash
  full_read_large: /read.*(\.ts|\.js|\.go).*limit\s*=\s*\d{4,}/, // 读大文件没加 limit
  // P3-7（code_review）：以下反模式正则带上下文收紧——单字命中会假阳性稀释信号
  // （本报告被 subagent-review-playbook 当优先关注项，过宽会误导子代理审查方向）
  merge_conflict: /merge conflict|合并冲突|冲突已解决|解决冲突|conflict resolution/i,
  anti_delete_first: /先删后建|先装后删|原子替换/,          // 反模式表：先删后建（失败即丢）
  anti_skip_existing: /存在即跳过|幂等|静默跳过/,           // 反模式表：存在即跳过（静默不更新）
  anti_debounce_exec: /防抖|串行化|待续跑/,                  // 反模式表：防抖只合并调度不合并执行
  anti_channel_reuse: /已关闭\s*(channel|的连接)|channel\s*(已|复|重)用|假活|channel reuse/i, // 反模式表：已关闭 channel 复用（假活）
  anti_limit_truncate: /截断|LimitReader|读满检测/,          // 反模式表：限流器截断静默
  anti_text_errno: /errno|文本兜底|错误分类/,                // 反模式表：文本匹配错误分类
  anti_silent: /静默(吞|降|跳|忽略|失败|返回空)|静默降级|静默吞错|silently (swallow|ignore|skip)/i, // 失败静默吞错（高频）
  anti_guard_register: /无守卫|registerGlobalHandlers|配对/, // 事件无守卫注册（ADR-008）
  anti_no_generation: /generation|代际|竞态/,                // 异步回写无代际守卫
  anti_partial_file: /半截|半文件|残留/,                     // 失败残留半截文件
};

const HOTSPOT_PREFIXES = ["frontend/src/", "internal/", "go/", "scripts/"];


function _run(cmd) {
  try {
    const out = execFileSync("git", cmd, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "en_US.UTF-8" },
    });
    return out.trim();
  } catch {
    return "";
  }
}

function gitLog(limit = 200) {
  const output = _run(["log", `--max-count=${limit}`, "--format=%H|%s|%ai"]);
  const commits = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const parts = line.split("|");
    if (parts.length >= 3) {
      commits.push({
        hash: parts[0].slice(0, 8),
        message: parts[1].trim(),
        date: parts[2].trim(),
        files: [],
      });
    }
  }
  return commits;
}

function gitFilesChanged(commitHash) {
  const output = _run(["diff-tree", "--no-commit-id", "-r", "--name-only", commitHash]);
  return output.split("\n").map((f) => f.trim()).filter(Boolean);
}


function categorizeCommit(message) {
  for (const [cat, pattern] of CATEGORIES) {
    if (pattern.test(message)) return cat;
  }
  return "other";
}

function isFixCommit(message) {
  // P2（code_review）：严格限定 `<type>: <desc>` 的 fix: / fix(scope): 前缀——
  // 过宽的 /^\s*fix/i 会把 fixup! / fixed: / fixme: / fixture 都算 fix，污染占比与修复链统计
  return /^\s*fix(?:\([^)]*\))?\s*:/i.test(message);
}

function findFixChains(commits, minChain = 3) {
  const chains = [];
  let current = [];

  const flush = () => {
    if (current.length >= minChain) {
      chains.push({
        category: current[0].category,
        length: current.length,
        commits: current.map(({ hash, message }) => ({ hash, message })),
        files: [...new Set(current.flatMap((c) => c.files))],
      });
    }
    current = [];
  };

  for (const c of commits) {
    if (!isFixCommit(c.message)) {
      flush();
      continue;
    }
    const cat = categorizeCommit(c.message);
    if (current.length && current[0].category === cat) {
      current.push({ ...c, category: cat });
    } else {
      flush();
      current = [{ ...c, category: cat }];
    }
  }
  flush();
  return chains.sort((a, b) => b.length - a.length);
}

function fileHotspots(commits, topN = 15) {
  const counter = new Map();
  for (const c of commits) {
    if (!isFixCommit(c.message)) continue;
    for (const f of c.files) {
      if (HOTSPOT_PREFIXES.some((p) => f.startsWith(p))) {
        counter.set(f, (counter.get(f) || 0) + 1);
      }
    }
  }
  return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

function categoryStats(commits) {
  const stats = new Map();
  for (const c of commits) {
    if (!isFixCommit(c.message)) continue;
    const cat = categorizeCommit(c.message);
    stats.set(cat, (stats.get(cat) || 0) + 1);
  }
  return [...stats.entries()].sort((a, b) => b[1] - a[1]);
}

function ruleViolationScan(limit = 50) {
  const violations = [];
  for (const c of gitLog(limit)) {
    for (const [rule, pattern] of Object.entries(RULE_VIOLATIONS)) {
      if (pattern.test(c.message)) {
        violations.push({ rule, commit: c.hash, message: c.message });
      }
    }
  }
  return violations;
}


function formatReport(commits, chains, hotspots, catStats, violations) {
  const lines = [];
  lines.push("=".repeat(60));
  lines.push("  AI Mistake Tracker Report");
  lines.push("=".repeat(60));
  lines.push("");

  const fixCount = commits.filter((c) => isFixCommit(c.message)).length;
  lines.push(`总 commit 数: ${commits.length}`);
  lines.push(`fix 提交数:   ${fixCount} (${Math.floor((fixCount * 100) / Math.max(commits.length, 1))}%)`);
  lines.push("");

  lines.push("── Fix 提交分类 ──");
  for (const [cat, count] of catStats) {
    lines.push(`  ${cat.padEnd(12)} ${String(count).padStart(3)}  ${"█".repeat(Math.min(count, 30))}`);
  }
  lines.push("");

  if (chains.length) {
    lines.push("── 连续修复链（AI 反复犯错热点）──");
    for (const chain of chains.slice(0, 5)) {
      lines.push(`  [${chain.category}] ${chain.length} 次连续修复`);
      lines.push(`    文件: ${chain.files.slice(0, 3).join(", ")}`);
      for (const c of chain.commits.slice(0, 3)) {
        lines.push(`      ${c.hash} ${c.message.slice(0, 60)}`);
      }
      if (chain.length > 3) lines.push(`      ... 还有 ${chain.length - 3} 条`);
      lines.push("");
    }
  } else {
    lines.push("── 连续修复链：无 ──\n");
  }

  if (hotspots.length) {
    lines.push("── 文件热力图（fix 提交修改次数 Top 15）──");
    const maxCount = hotspots[0][1] || 1;
    for (const [f, count] of hotspots) {
      const barLen = Math.round((count / maxCount) * 20);
      lines.push(`  ${String(count).padStart(3)}  ${"▓".repeat(barLen)}  ${f}`);
    }
    lines.push("");
  }

  if (violations.length) {
    lines.push("── 疑似规则违反 ──");
    for (const v of violations) {
      lines.push(`  [${v.rule}] ${v.commit} ${v.message.slice(0, 50)}`);
    }
    lines.push("");
  } else {
    lines.push("── 规则违反扫描：无 ──\n");
  }

  lines.push("=".repeat(60));
  return lines.join("\n");
}


const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 200 : 200;

const commits = gitLog(limit);
for (const c of commits) {
  c.files = gitFilesChanged(c.hash);
}

const chains = findFixChains(commits);
const hotspots = fileHotspots(commits);
const catStats = categoryStats(commits);
const violations = ruleViolationScan(Math.min(limit, 200));

if (jsonMode) {
  const output = {
    total_commits: commits.length,
    fix_commits: commits.filter((c) => isFixCommit(c.message)).length,
    category_stats: Object.fromEntries(catStats),
    fix_chains: chains.map((ch) => ({
      category: ch.category,
      length: ch.length,
      files: ch.files,
      commits: ch.commits,
    })),
    file_hotspots: hotspots.map(([file, count]) => ({ file, count })),
    rule_violations: violations,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
} else {
  process.stdout.write(formatReport(commits, chains, hotspots, catStats, violations) + "\n");
}
