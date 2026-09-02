#!/usr/bin/env node
/**
 * 检查前端代码是否绕过了 Wails bindings 直接调用 window.go.main.App.xxx
 * 
 * 目的：确保所有 Go 函数调用都通过 bindings/ 强类型接口，避免参数错位等编译期不报错的问题
 */

import { readdirSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendSrc = join(__dirname, '../src');

// 正则：匹配 window.go.main.App.xxx( 调用
// 匹配绕过 bindings 的直接调用：
//   window.go.main.App.SearchModels(    ← 点访问
//   window['go']['main']['App']['SearchModels'](  ← 方括号访问
const BYPASS_REGEX = /window(?:\.go\.main\.App|\['go'\]\['main'\]\['App'\])\.\w+\(/g;

// --json 输出格式（与 gate 的 runTools --json 契约对齐）
const wantJson = process.argv.includes('--json');

// 排除的文件（bindings 声明文件等）
const EXCLUDE_FILES = ['bindings.ts', 'bindings.d.ts'];

interface Violation {
  file: string;
  line: number;
  column: number;
  match: string;
}

function scanFile(filePath: string): Violation[] {
  // 用 path.basename 跨平台取文件名（旧 split('/') 在 Windows 下不拆路径）
  if (EXCLUDE_FILES.includes(basename(filePath))) return [];

  if (!['.ts', '.js'].includes(extname(filePath))) return [];

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    // 读错不静默吞——守卫脚本必须 fail-loud，否则真实 bypass 被掩盖假绿
    throw new Error(`无法读取 ${filePath}: ${(e as Error).message}`);
  }

  const violations: Violation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    // 重置 lastIndex（正则复用时需要）
    BYPASS_REGEX.lastIndex = 0;
    
    while ((match = BYPASS_REGEX.exec(line)) !== null) {
      violations.push({
        file: filePath,
        line: i + 1,
        column: match.index + 1,
        match: match[0],
      });
    }
  }

  return violations;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true })) {
    const fullPath = join(dir, entry as string);
    if (entry.toString().endsWith('.ts') || entry.toString().endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main() {
  const files = walkDir(frontendSrc);
  const allViolations: Violation[] = [];

  for (const file of files) {
    const violations = scanFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    if (wantJson) {
      console.log(JSON.stringify({
        _summary: { ok: false, violations: allViolations.length },
        violations: allViolations,
      }));
    } else {
      console.error('\n⚠️  检测到绕过 bindings 的直接调用：\n');
      for (const v of allViolations) {
        console.error(`  ${v.file}:${v.line}:${v.column}`);
        console.error(`    ${v.match}`);
      }
      console.error('\n请改用 bindings 导入的函数，例如：');
      console.error('  import { SearchModels } from "./bindings";');
      console.error('  SearchModels(filesRoot, keyword, minBones, ...);\n');
    }
    process.exit(1);
  } else {
    if (wantJson) {
      console.log(JSON.stringify({ _summary: { ok: true, violations: 0 } }));
    } else {
      console.log('✅ 未发现绕过 bindings 的直接调用');
    }
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('检查脚本执行失败:', err);
  process.exit(2);
});
