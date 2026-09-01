#!/usr/bin/env node
/**
 * drift-scan.ts — 双轨漂移自动检测脚本
 *
 * 定位：双轨（Go + 前端）实现漂移的侦察兵，手动按需运行（知识卡 drift-scan 支撑）。
 * 2026-09 孤儿审计确认保留：无 CI 挂载（情报型，扫全仓开销大），有独立知识卡 + 文档引用，
 * 与 line-counter / trace-analyze 同为「按需诊断」类，不属死代码。
 *
 * 检测维度：
 * 1. Go 硬编码常量（0755/0644/50<<20/超时魔数 等）
 * 2. Go 内联切片操作（[:len(...)-N] 模式）
 * 3. Go 内联路径归一化（应统一 filepath.ToSlash）
 * 4. Go 错误链断裂（%v 格式化 err → 应 %w）
 * 5. Go 资源泄漏风险（os.Open/os.Create 无 defer close）
 * 6. Go 重复函数实现（copyDirRecursive/formatSize 等）
 * 7. 前端硬编码常量（与 Go 端同逻辑不同实现）
 * 8. 重复字符串模式（非法字符集等）
 *
 * 用法：node scripts/drift-scan.ts [--json]
 *
 * 依赖：node:fs / node:path / node:url（零外部依赖）
 *
 * 退出码：0（报告工具，不阻断）
 *
 * 设计意图：双轨（Go 轨 + 前端轨）实现漂移的自动侦察兵——硬编码常量、内联
 * 切片/路径操作、错误链断裂、资源泄漏、重复实现等跨轨不一致，一次扫出。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
// Go 扫描根：go/（共享层）+ internal/（GUI 轨，最活跃消费侧）+ cmd/（小工具）；根 main.go 为 CLI 薄壳不入扫
const GO_ROOTS = [join(ROOT, "go"), join(ROOT, "internal"), join(ROOT, "cmd")];
const FE_DIR = join(ROOT, "frontend", "src");

// ===== 工具函数 =====

/** 递归收集文件 */
function walkFiles(dir: string, ext: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "testdata") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, ext, out);
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

/** 读取文件内容（忽略 _test.go / *.test.ts） */
function readSrc(path: string) {
  const base = path.split(/[/\\]/).pop()!;
  if (base.includes("_test.") || base.includes(".test.")) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** 在内容中搜索正则，返回所有匹配行 */
function findMatches(content: string, regex: RegExp, filePath: string, filter: ((line: string, content: string, lineIdx: number) => boolean) | undefined) {
  const results: any[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(regex);
    if (m) {
      // 应用过滤器
      if (filter && !filter(lines[i]!.trim(), content, i)) continue;
      results.push({
        file: relative(ROOT, filePath),
        line: i + 1,
        text: lines[i]!.trim(),
        match: m[0],
      });
    }
  }
  return results;
}

// ===== 检测规则 =====

const RULES = [
  {
    id: "HARDCODED_PERMS_DIR",
    severity: "warn",
    desc: "硬编码目录权限 0755（应使用 fsutil.DirPerms）",
    glob: "*.go",
    regex: /os\.MkdirAll\([^,]+,\s*(?:0o)?0755\)/,
    exclude: [/test/],
  },
  {
    id: "HARDCODED_PERMS_FILE",
    severity: "warn",
    desc: "硬编码文件权限 0644（应使用 fsutil.FilePerms）",
    glob: "*.go",
    regex: /os\.WriteFile\([^,]+,[^,]+,\s*(?:0o)?0644\)/,
    exclude: [/test/],
    // 排除 heredoc 字符串（如 GitHub Actions workflow）
    filter: (line: string) => !line.startsWith("os.WriteFile(\"index.json\""),
  },
  {
    id: "HARDCODED_READ_LIMIT",
    severity: "warn",
    desc: "硬编码读取上限 50<<20（应使用 types.MaxReadLimit）",
    glob: "*.go",
    regex: /50\s*<<\s*20/,
    exclude: [/types\/extensions\.go/, /test/],
    // 排除常量定义本身和注释
    filter: (line: string) => !line.startsWith("//") && !line.startsWith("const "),
  },
  {
    id: "INLINE_BAN_STRIP",
    severity: "error",
    desc: "内联 .ban 后缀剥离 [:len(name)-4] 或 [:len(name)-len(\".ban\")]（应使用 types.StripBanSuffix）",
    glob: "*.go",
    regex: /\[:len\([^)]+\)-(?:4|len\("\.ban"\))\]/,
    exclude: [/types\/extensions\.go/, /test/],
    // 排除注释行和函数定义本身
    filter: (line: string) => !line.startsWith("//") && !line.startsWith("return name[:len(name)-4]"),
  },
  {
    id: "INLINE_ILLEGAL_CHARS",
    severity: "warn",
    desc: "内联非法字符集检测（应使用 fsutil.ContainsIllegalNameChar）",
    glob: "*.go",
    regex: /strings\.ContainsAny\([^,]+,\s*`\\\/:\*\?"<>\|`\)/,
    exclude: [/fsutil\/perms\.go/, /test/],
  },
  {
    id: "DUPLICATE_FORMAT_SIZE",
    severity: "warn",
    desc: "独立 formatSize 实现（应使用 fsutil.FormatSize）",
    glob: "*.go",
    regex: /^func formatSize\(/,
    exclude: [/fsutil\/format\.go/, /test/],
    // 排除委托实现（单行函数体含 fsutil.FormatSize）
    filter: (line: string, content: string, lineIdx: number) => {
      const lines = content.split("\n");
      const nextLine = lines[lineIdx + 1] || "";
      // 如果函数体是单行委托调用，不算重复
      return !nextLine.includes("fsutil.FormatSize") && !line.includes("fsutil.FormatSize");
    },
  },
  {
    id: "FE_HARDCODED_FORMAT",
    severity: "warn",
    desc: "前端独立 formatSize 实现（应委托 formatBytes）",
    glob: "*.ts",
    regex: /export function formatSize\(bytes: number\): string \{/,
    exclude: [/test/],
  },
  {
    id: "INLINE_PATH_NORM",
    severity: "info",
    desc: "内联路径分隔符替换（建议统一 filepath.ToSlash）",
    glob: "*.go",
    regex: /strings\.ReplaceAll\([^,]+,\s*"\\\\"[^"]*"\/"\)/,
    exclude: [/test/],
  },
  {
    id: "COPY_DIR_REIMPL",
    severity: "info",
    desc: "copyDirRecursive 独立实现（应使用 fsutil.CopyDirRecursive）",
    glob: "*.go",
    regex: /^func copyDirRecursive\(/,
    exclude: [/fsutil\/copy\.go/, /test/],
    // 薄包装降噪：函数体若委托 fsutil.CopyDirRecursive 即为已收敛适配器（ADR-044），
    // 仅标记真正独立实现（如 importer.go 的原子整树复制，语义独特暂不可收敛）。
    filter: (line: string, content: string, lineIdx: number) => {
      const lines = content.split("\n");
      for (let i = lineIdx; i < Math.min(lineIdx + 20, lines.length); i++) {
        if (lines[i]!.includes("fsutil.CopyDirRecursive")) return false;
      }
      return true;
    },
  },
  {
    id: "ERROR_WRAP_V",
    severity: "warn",
    desc: "错误链断裂：fmt.Errorf 使用 %v 格式化 err（应使用 %w 保留错误链）",
    glob: "*.go",
    regex: /fmt\.Errorf\([^)]*%v[^)]*,\s*err\)/,
    exclude: [/test/],
    filter: (line: string) => {
      if (line.startsWith("//")) return false;
      // 伴生 %w 时豁免：单个 fmt.Errorf 内已有 %w 保留主链，%v 仅格式化伴生参数
      // （双 %w 会创建 Unwrap() []error 多错误包装，errors.Unwrap() 返回 nil，
      //  破坏 Unwrap 链——go/paths 已有实证，测试 TestIsInside_RelFailureSentinel_Windows）
      if (line.includes("%w")) return false;
      return true;
    },
  },
  {
    id: "FD_LEAK_RISK",
    severity: "warn",
    desc: "资源泄漏风险：os.Open/os.Create 后无 defer close 或显式 close",
    glob: "*.go",
    regex: /os\.(Open|Create)\(/,
    exclude: [/test/],
    filter: (line: string, content: string, lineIdx: number) => {
      const lines = content.split("\n");
      const trimmed = line.trim();

      // 排除注释行
      if (trimmed.startsWith("//")) return false;

      // 排除 return os.Open(...) 模式（调用方负责 close）
      if (trimmed.startsWith("return os.Open") || trimmed.startsWith("return os.Create")) return false;

      // 提取变量名（f, err := os.Open(...)）
      const varMatch = trimmed.match(/^(\w+),\s*(?:err|_)\s*:=\s*os\.(Open|Create)\(/);
      if (!varMatch) return false; // 无变量赋值，跳过
      const varName = varMatch[1];

      // 检查当前行及后 15 行是否有 defer close 或显式 close
      for (let i = lineIdx; i < Math.min(lineIdx + 16, lines.length); i++) {
        if (lines[i]!.includes(`${varName}.Close()`)) {
          return false;
        }
        // 所有权转移豁免：传给 ReadLimitedEntry 等自管 close 的封装函数（内部 defer Close）
        if (lines[i]!.includes(`ReadLimitedEntry(${varName}`)) {
          return false;
        }
      }
      return true;
    },
  },
  {
    id: "HARDCODED_TIMEOUT",
    severity: "info",
    desc: "散落超时魔数（建议提取为命名常量）",
    glob: "*.go",
    regex: /time\.After\(\d+\s*\*\s*time\.(Second|Minute|Hour)\)/,
    exclude: [/test/],
  },
  {
    id: "TIMER_LEAK",
    severity: "warn",
    desc: "定时器泄漏风险：setTimeout/setInterval 赋值后无对应 clear",
    glob: "*.ts",
    regex: /\b(\w+)\s*=\s*(?:window\.)?(?:setInterval|setTimeout)\(/,
    exclude: [/test/],
    filter: (line: string, content: string, lineIdx: number) => {
      const trimmed = line.trim();
      // 排除注释行
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
      // 提取变量名
      const m = trimmed.match(/\b(\w+)\s*=\s*(?:window\.)?(?:setInterval|setTimeout)\(/);
      if (!m) return false;
      const varName = m[1]!;
      // 排除常见非泄漏模式：r, resolve, reject（Promise 延迟）
      if (["r", "resolve", "reject", "next", "t"].includes(varName)) return false;
      // 检查同文件是否有对应的 clearTimeout/clearInterval（多种模式）
      // 1. 直接调用：clearTimeout(timer)
      // 2. 对象属性：clearTimeout(xxx.timer) 或 clearTimeout(this.timer)
      // 3. 批量清理：timers.forEach(clearTimeout) 或 arr.forEach(t => clearTimeout(t))
      const clearRegex = new RegExp(
        `clear(?:Timeout|Interval)\\s*\\([^)]*\\b${varName}\\b[^)]*\\)` +
        `|forEach\\s*\\(\\s*clear(?:Timeout|Interval)\\s*\\)` +
        `|forEach\\s*\\([^)]*=>\\s*clear(?:Timeout|Interval)\\s*\\([^)]*\\b${varName}\\b`
      );
      return !clearRegex.test(content);
    },
  },
];

// ===== 主逻辑 =====

function scan() {
  const findings: any[] = [];

  for (const rule of RULES) {
    const isGo = rule.glob === "*.go";
    const roots = isGo ? GO_ROOTS : [FE_DIR];
    const ext = isGo ? ".go" : ".ts";
    const files = roots.flatMap((d) => walkFiles(d, ext));

    for (const file of files) {
      const content = readSrc(file);
      if (!content) continue;

      // 检查排除规则
      if (rule.exclude?.some((re) => re.test(file))) continue;

      const matches = findMatches(content, rule.regex, file, rule.filter);
      for (const m of matches) {
        findings.push({ ...rule, ...m });
      }
    }
  }

  return findings;
}

function formatOutput(findings: any[], json: boolean) {
  if (json) {
    // 剥离 RegExp/函数字段（JSON 序列化会静默丢成 {}），机器输出保留有效字段
    const clean = findings.map(({ regex, exclude, filter, ...rest }) => rest);
    console.log(JSON.stringify(clean, null, 2));
    return;
  }

  // 按严重度分组
  const bySeverity: Record<string, any> = { error: [], warn: [], info: [] };
  for (const f of findings) {
    bySeverity[f.severity]?.push(f);
  }

  console.log("🔍 双轨漂移扫描报告\n");

  if (bySeverity.error.length) {
    console.log(`❌ 严重 (${bySeverity.error.length})：`);
    for (const f of bySeverity.error) {
      console.log(`  ${f.id}: ${f.file}:${f.line}`);
      console.log(`    ${f.desc}`);
      console.log(`    > ${f.text.slice(0, 80)}`);
    }
    console.log();
  }

  if (bySeverity.warn.length) {
    console.log(`⚠️  警告 (${bySeverity.warn.length})：`);
    for (const f of bySeverity.warn) {
      console.log(`  ${f.id}: ${f.file}:${f.line}`);
      console.log(`    ${f.desc}`);
    }
    console.log();
  }

  if (bySeverity.info.length) {
    console.log(`ℹ️  提示 (${bySeverity.info.length})：`);
    for (const f of bySeverity.info) {
      console.log(`  ${f.id}: ${f.file}:${f.line}`);
    }
    console.log();
  }

  const total = findings.length;
  console.log(`\n📊 总计: ${total} 处漂移`);
  console.log(`   严重: ${bySeverity.error.length} | 警告: ${bySeverity.warn.length} | 提示: ${bySeverity.info.length}`);
}

// ===== 入口 =====

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

const findings = scan();
formatOutput(findings, jsonMode);

// 有严重问题时退出码 1（--json 只是输出格式开关，不改失败语义，CI 集成可依赖 exit code）
const hasError = findings.some((f) => f.severity === "error");
if (hasError) {
  process.exit(1);
}
