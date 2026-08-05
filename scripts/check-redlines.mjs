#!/usr/bin/env node
/**
 * 代码红线审查。12 条规则 × 违规扫描（依赖 ripgrep）。
 * W3 empty JSDoc / W4 TODO 无编号已移交 comment-checker.mjs（避免双重扫描）。
 * 由 scripts/review.py 迁移（2026-08-03），规则与输出逻辑逐点保真。
 * 设计意图：治理审查工具（原 review.mjs，2026-08-05 更名去误导）
 * 用法：
 *   node scripts/check-redlines.mjs                 # 默认行为
 *   node scripts/check-redlines.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（成功）
 * 依赖：本地模块
 */
import { rg } from './_lib/ripgrep.mjs';
import { parseRgLine } from './_lib/rg-line.mjs';

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
    rg('window\\.__', 'frontend/src', ['*.js', '*.ts']),
    'let + getter, PageStore');

  add('R2', 'repoRoot name',
    rg('repoRoot', ['.', 'frontend/src'], ['*.go', '*.js', '*.ts', '*.json']),
    'cfg.FilesRoot / filesRoot');

  add('R3', 'callback .file() API',
    rg('\\.file\\s*\\(', 'frontend/src', ['*.js', '*.ts']),
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
    rg('"ysm"|"mmd-skin"|"vrchat-avatar"', 'frontend/src', ['*.js', '*.ts']),
    'RESOURCE_TYPES');

  // R8 只报「非纯字符串字面量赋值 + 行内无 esc(」的 innerHTML：
  // 纯静态模板（= "..." / = `...` 开头）与已转义插值不计入（历史 149 处噪声多来自它们）；
  // 变量/拼接赋值仍保留待人工确认
  const r8Inner = rg('innerHTML\\s*=\\s*[^\'"`\\n]', 'frontend/src', ['*.js', '*.ts']).filter(
    (l) => !/esc\(/.test(l),
  );
  add('R8', 'innerHTML concat (non-literal)',
    r8Inner,
    'esc()');

  add('R9', 'manual sidebar',
    rg('sidebarItem|tb-btn.*title=', 'frontend', ['*.js', '*.ts']),
    'renderSidebar()');

  add('R10', 'private esc implementations',
    rg('replace\\(/&/g, "&amp;"\\)', 'frontend/src', ['*.ts', '*.js']).filter((l) => !l.includes('utils/dom/dom.ts')),
    'import { esc } from utils/dom/dom.ts (5-replace 单点，致命陷阱 #15)');

  // W1 排除正则/转义误报：[/\] 字符类、replace(/\\/g 归一化、\n \t \. \w \d \s \b 等
  // （历史 148 处噪声几乎全来自它们）；真实路径拼接（"\\" 双反斜杠字符串字面量）仍保留
  add('W1', 'backslash paths',
    rg('\\\\', 'frontend/src', ['*.js', '*.ts']).filter(
      (l) =>
        !l.includes('node_modules') &&
        !l.includes('bus.js') &&
        !l.includes('bus.ts') &&
        !l.includes('font-display') &&
        !/\[?\/\\\\|\\[ntr]|\\[.wWdDsSb]/.test(l),
    ),
    '/ instead of \\');

  add('W2', 'window.go.main.App calls',
    rg('window\\.go\\.main\\.App', 'frontend/src', ['*.js', '*.ts']),
    'getApp()');

  // W3 empty JSDoc / W4 TODO no ticket 已移交 comment-checker.mjs（扫描范围更全，
  // W4 覆盖 go+frontend，避免双重扫描），此处不再重复。

  add('W5', 'async DOM race (callback sets innerHTML without stale guard)',
    rg('=>\\s*\\{[^}]*innerHTML\\s*=', 'frontend/src', ['*.js', '*.ts'])
      .concat(rg('\\.(then|finally)\\s*\\(.*innerHTML\\s*=', 'frontend/src', ['*.js', '*.ts']))
      .concat(rg('setTimeout\\s*\\(.*innerHTML\\s*=', 'frontend/src', ['*.js', '*.ts'])),
    'DOM writes in async callbacks need stale-request guards (fetchDone flag)');

  add('W6', 'bypass dialogs (dlg-overlay outside dialogs/modal.ts)',
    rg('className\\s*=\\s*"dlg-overlay"', 'frontend/src', ['*.ts', '*.js']).filter((l) => !l.includes('dialogs/modal.ts')),
    '统一走 modal.ts (modalConfirm/registerDlg 单例槽位，致命陷阱 #14)；合法旁路须确认 registerDlg 已登记');

  return results;
}

function outputText(results) {
  const out = ['========== Check Redlines =========='];
  out.push('⚠️ 正则红线扫描候选清单，非审核结论——violations 需逐条人工确认，勿直接采信');
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
  out.push(`${'='.repeat(10)} Check Complete ${'='.repeat(10)}`);
  process.stdout.write(out.join('\n') + '\n');
}

function outputJson(results) {
  const total = results.reduce((s, r) => s + r.count, 0);
  process.stdout.write(JSON.stringify({
    _summary: {
      rules: results.length,
      violations: total,
      notice: '正则红线扫描候选清单，非审核结论——violations 需逐条人工确认，勿直接采信',
    },
    results,
  }, null, 2) + '\n');
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
