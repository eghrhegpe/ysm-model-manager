#!/usr/bin/env node
/**
 * 代码红线审查。13 条规则 × 违规扫描（依赖 ripgrep）。
 * 由 scripts/review.py 迁移（2026-08-03），规则与输出逻辑逐点保真。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rg(pattern, paths, globs = null) {
  const cmd = ['--no-heading', '-n', '--path-separator', '/', pattern];
  for (const g of (globs || [])) cmd.push('-g', g);
  const targets = Array.isArray(paths) ? paths : [paths];
  for (const p of targets) cmd.push(path.join(ROOT, p));
  try {
    const out = execFileSync('rg', cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    return out.trim().split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
}

function parseRgLine(line) {
  const parts = line.split(':');
  if (parts.length >= 3) {
    let filePart, rest;
    if (parts[0].length === 1 && /[a-zA-Z]/.test(parts[0]) && parts[1].startsWith('/')) {
      filePart = parts[0] + ':' + parts[1];
      rest = parts.slice(2).join(':');
    } else {
      filePart = parts[0];
      rest = parts.slice(1).join(':');
    }
    const restParts = rest.split(':');
    const first = restParts[0];
    if (/^\d+$/.test(first)) {
      return [filePart, parseInt(first, 10), restParts.slice(1).join(':') || ''];
    }
  }
  return [line, 0, ''];
}

function runChecks() {
  const results = [];

  const add = (ruleId, name, lines, fix = '') => {
    const violations = [];
    for (const l of lines) {
      const [file, lineno, text] = parseRgLine(l);
      violations.push({ file: String(file), line: lineno, snippet: text.trim().slice(0, 120) });
    }
    results.push({ rule_id: ruleId, name, fix, count: violations.length, violations });
  };

  add('R1', 'window.__ vars',
    rg('window\\.__', 'frontend/js', ['*.js', '*.ts']),
    'let + getter, PageStore');

  add('R2', 'repoRoot name',
    rg('repoRoot', ['.', 'frontend/js'], ['*.go', '*.js', '*.ts', '*.json']),
    'cfg.FilesRoot / filesRoot');

  add('R3', 'callback .file() API',
    rg('\\.file\\s*\\(', 'frontend/js', ['*.js', '*.ts']),
    'new Promise(...)');

  add('R4', 'display none/block',
    rg('display:\\s*(none|block)', 'frontend', ['*.js', '*.ts', '*.css']),
    'opacity/transform');

  add('R5', 'hardcoded colors',
    rg('#[0-9a-f]{6}\\b', 'frontend', ['*.js', '*.ts', '*.css'])
      .concat(rg('#[0-9a-f]{3}\\b', 'frontend', ['*.js', '*.ts', '*.css']))
      .concat(rg('rgba?\\(', 'frontend', ['*.js', '*.ts', '*.css']))
      .concat(rg('hsla?\\(', 'frontend', ['*.js', '*.ts', '*.css'])),
    'CSS vars');

  add('R6', 'JS in public/',
    rg('public/.*\\.js', ['.', 'frontend'], ['*.md', '*.html', '*.json']),
    'ESM import');

  add('R7', 'rtype magic strings',
    rg('"ysm"|"mmd-skin"|"vrchat-avatar"', 'frontend/js', ['*.js', '*.ts']),
    'RESOURCE_TYPES');

  add('R8', 'innerHTML concat',
    rg('innerHTML\\s*=', 'frontend/js', ['*.js', '*.ts']),
    'esc()');

  add('R9', 'manual sidebar',
    rg('sidebarItem|tb-btn.*title=', 'frontend', ['*.js', '*.ts']),
    'renderSidebar()');

  add('W1', 'backslash paths',
    rg('\\\\', 'frontend/js', ['*.js', '*.ts']).filter((l) => !l.includes('node_modules') && !l.includes('bus.js') && !l.includes('bus.ts') && !l.includes('font-display')),
    '/ instead of \\');

  add('W2', 'window.go.main.App calls',
    rg('window\\.go\\.main\\.App', 'frontend/js', ['*.js', '*.ts']),
    'getApp()');

  add('W3', 'empty JSDoc',
    rg('@param\\s+\\{[^}]*\\}\\s+\\w+\\s*-?\\s*$|@returns\\s*\\{[^}]*\\}\\s*$', 'frontend/js', ['*.js', '*.ts']));

  add('W4', 'TODO no ticket',
    rg('TODO|FIXME|HACK|XXX', ['.', 'go'], ['*.go']).filter((l) => !l.includes('#') && !l.includes('nolint')));

  add('W5', 'async DOM race (callback sets innerHTML without stale guard)',
    rg('=>\\s*\\{[^}]*innerHTML\\s*=', 'frontend/js', ['*.js', '*.ts'])
      .concat(rg('\\.(then|finally)\\s*\\(.*innerHTML\\s*=', 'frontend/js', ['*.js', '*.ts']))
      .concat(rg('setTimeout\\s*\\(.*innerHTML\\s*=', 'frontend/js', ['*.js', '*.ts'])),
    'DOM writes in async callbacks need stale-request guards (fetchDone flag)');

  return results;
}

function outputText(results) {
  const out = ['========== Code Review =========='];
  for (const r of results) {
    if (r.count === 0) {
      out.push(`  [OK] [${r.rule_id}] ${r.name}`);
    } else {
      out.push(`  [WARN] [${r.rule_id}] ${r.name} (${r.count})`);
      for (const v of r.violations.slice(0, 10)) {
        out.push(`    ${v.file}:${v.line}  ${v.snippet.slice(0, 80)}`);
      }
      if (r.fix) out.push(`    -> ${r.fix}`);
    }
  }
  out.push(`${'='.repeat(10)} Review Complete ${'='.repeat(10)}`);
  process.stdout.write(out.join('\n') + '\n');
}

function outputJson(results) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

/**
 * --audit 模式：B 类审查（设计判断，无法自动化）的盘问锚点。
 * 输出审查框架 checklist，引导 AI 按「审核四件套 + 设计质量 + 反模式 + UX」逐一盘问，
 * 输出 P1-P4 风险表并落 docs/review-report.md。参照 AGENTS.md「审核代码可用性」章节。
 */
function outputAudit() {
  const out = [
    '========== Design Audit Checklist ==========',
    '> 按维度逐一盘问，输出 P1-P4 风险表，结果落 docs/review-report.md',
    '',
    '【1. 审核思维准则（盘问代码）】',
    '  [数据流]    状态从哪来？谁修改？流到哪？ → grep setter / bus.emit / PageStore. 写入点，查幽灵路径',
    '  [生命周期]  订阅/监听创建与销毁是否同层配对？ → bus.on 有 _unsubs 清理？EventsOn 有 _registered 守卫？',
    '  [并发边界]  异步有过期标记？连点 3 次是否竞态？ → 查 _loading/_pending/generation counter',
    '  [异常契约]  抛异常后调用方还能安全用吗？ → catch 后状态一致？finally emit 完成事件？',
    '',
    '【2. 设计质量检查项】',
    '  [状态唯一]  同一状态是否多处读写？ → PageStore/registry 唯一源 vs 模块级变量+localStorage 双源',
    '  [副作用]    函数是否隐式改外部状态？ → 模块级变量被多处直接写入',
    '  [并发安全]  异步有去重/锁？ → _registered 守卫防重复注册',
    '  [错误边界]  异常不吞没不扩散？ → 静默 catch {} 或 Promise 无 .catch 即违规',
    '  [资源释放]  订阅级联清理？ → _unsubs 数组统一 disconnectedCallback 清',
    '  [UI 文案]   可见文案走 TERMINOLOGY？ → 新造词 = 术语漂移',
    '',
    '【3. 反模式排查】',
    '  [隐式状态写入] 函数直接改模块级 _xxx 而非 setter/action',
    '  [职责过载]     一函数做数据获取+UI 更新+持久化（违反三层解耦）',
    '  [魔法数值]     硬编码常量/事件字符串；CSS 硬编码颜色（R5 已扫，但变量误用语义靠人）',
    '  [显著重复]     相似逻辑 ≥2 文件 → 抽 utils/ 公共函数',
    '  [Promise 断裂] .then() 无 .catch() 或 catch 静默吞错',
    '  [无守卫注册]   bus.on 顶层直接注册不查已注册（ADR-008）',
    '',
    '【4. UX 审核（代码模式识别体验问题）】',
    '  [路径深度]   核心功能 ≤3 层可达？',
    '  [异步反馈]   async 前后 UI 状态更新？按钮 loading → 完成 → 恢复',
    '  [破坏防呆]   remove/delete/reset 有二次确认？',
    '  [错误消息]   catch 抛给用户的是可理解文案（含文件名/原因）？',
    '  [交互一致]   同类操作复用 modal.js/.btn-base？',
    '  [空状态]     无数据时有行动入口？',
    '  [可撤销]     破坏性操作有恢复路径（回收站/撤销）？',
    '',
    '【5. 心理模拟】',
    '  ① 契约检查：公开函数签名 vs 内部实现一致？隐式依赖外部全局？',
    '  ② 状态机：快速点击 3 次，_loading/_pending 能拦截？',
    '  ③ 异常：第 N 行抛异常，第 M 行清理仍执行？（finally 覆盖）',
    '  ④ 引用计数：bus.on ↔ 清理、addEventListener ↔ removeEventListener 配对？',
    '',
    '【输出格式】',
    '## [模块名] — 审核结果',
    '**总体结论：通过 / 有条件通过 / 不通过**',
    '**亮点：** [模式 + 文件:行号]',
    '**风险：** P1-P4 表（级别 | 文件 | 观察 | 建议）',
    '',
    '落盘：docs/review-report.md',
  ];
  process.stdout.write(out.join('\n') + '\n');
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const auditMode = args.includes('--audit');
if (auditMode) {
  outputAudit();
  process.exit(0);
}
const results = runChecks();
if (jsonMode) outputJson(results);
else outputText(results);
