#!/usr/bin/env node
/**
 * 项目健康诊断。一键检查 Go 编译、前端构建、文件完整性、治理红线。
 * 由 scripts/doctor.py 迁移（2026-08-03），逻辑逐点保真。
 * doctor.mjs — 全量治理检查编排
 * 设计意图：全量治理检查编排
 * 依赖：node:child_process / node:fs / node:path / node:url
 * 用法：
 *   node scripts/doctor.mjs                 # 默认行为（全量：编译+构建+文件+红线+Git）
 *   node scripts/doctor.mjs --docs   # 文档模式（轻量：仅文档/ADR/索引检查，跳过 Go/前端编译与测试）
 *   node scripts/doctor.mjs --check  # 启用 check
 *   node scripts/doctor.mjs --strict # 启用 strict
 * 退出码：任何非零检查([FAIL])均置 process.exitCode=1 阻断；仅 WARN/skip 不阻断
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const PASS = '[OK]';
const FAIL = '[FAIL]';
const WARN = '[WARN]';

function run(cmd, cwd = ROOT, opts = {}) {
  /**
   * 运行命令，返回 {rc, out}。
   * Windows：npx/tsc 是无扩展名 shim，原生 execFileSync 无法 CreateProcess（ENOENT），
   * 需 opts.shell=true 经 cmd.exe 执行（与 check-deadcode-baseline 一致）；
   * grep/go/which 是原生可执行文件，保持默认（无 shell），避免 cmd.exe 找不到 Git Bash 工具。
   */
  const o = { cwd, encoding: 'utf-8', timeout: 120000 };
  if (process.platform === 'win32' && opts.shell) o.shell = true;
  try {
    const stdout = execFileSync(cmd[0], cmd.slice(1), o);
    return { rc: 0, out: stdout };
  } catch (e) {
    if (e.code === 'ENOENT') return { rc: -1, out: 'command not found: ' + cmd[0] };
    return { rc: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/**
 * node 原生递归收集目录下指定扩展名文件（模拟 grep -rn 的目录遍历）。
 * 注意：Windows 下 execFileSync 直调 MSYS grep/rg 时参数反斜杠会被吞，
 * 正则检查全部改走本函数 + JS 正则，避免治理红线假绿（code_review 实证）。
 */
function scanAllFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries) {
    if (d.isDirectory()) out.push(...scanAllFiles(path.join(dir, d.name), exts));
    else if (exts.some((e) => d.name.endsWith(e))) out.push(path.join(dir, d.name));
  }
  return out;
}

/** 返回文件中匹配正则的行，格式 `绝对路径:行号:内容`（与 grep -rn 输出一致）。 */
function grepLines(files, re) {
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf-8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(`${f}:${i + 1}:${lines[i]}`);
  }
  return hits;
}

function checkGoBuild() {
  console.log('=== Go Build ===');
  const { rc, out } = run(['go', 'build', './go/...']);
  if (rc === 0) {
    console.log(`  ${PASS} Go build passed`);
  } else {
    console.log(`  ${FAIL} Go build failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkGoTest() {
  // 原 ultrawork 独有步骤，并入 doctor（ultrawork.mjs 已废弃）
  console.log('\n=== Go Test ===');
  const { rc, out } = run(['go', 'test', './go/...', '-count=1']);
  if (rc === 0) {
    console.log(`  ${PASS} Go test passed`);
  } else {
    console.log(`  ${FAIL} Go test failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function buildUpdaterHelper() {
  // go/updater/update.go 通过 //go:embed 内嵌 ysm-updater-helper.exe，
  // 该文件由 cmd/updater/main.go 编译生成（见 cmd/build-release.ps1 步骤 1b），
  // 且被 .gitignore(*.exe) 忽略、不入库。CI / 干净 checkout 缺此文件会导致
  // go vet / go build / go test 因 embed 找不到文件而失败。
  // 因此任何 Go 检查前必须先构建它（与 release.yml CI、windows Taskfile 一致）。
  console.log('=== Build Updater Helper ===');
  const { rc, out } = run(['go', 'build', '-o', 'go/updater/ysm-updater-helper.exe', './cmd/updater']);
  if (rc === 0) {
    console.log(`  ${PASS} updater helper built -> go/updater/ysm-updater-helper.exe`);
  } else {
    console.log(`  ${FAIL} updater helper build failed (go vet/build/test 将因此失败)`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) console.log(`    ${line}`);
  }
}

function checkGoVet() {
  console.log('\n=== Go Vet ===');
  const { rc, out } = run(['go', 'vet', './go/...']);
  if (rc === 0) {
    console.log(`  ${PASS} go vet passed`);
  } else {
    console.log(`  ${FAIL} go vet failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) console.log(`    ${line}`);
  }
}

function checkContractTests() {
  // 契约测试为宪法基石，禁止修改（AGENTS.md 红线）。失败即阻断。
  console.log('\n=== Contract Tests (tests/*.mjs) ===');
  const dir = path.join(ROOT, 'tests');
  if (!fs.existsSync(dir)) {
    console.log(`  ${WARN} tests/ not found — skip`);
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  if (files.length === 0) {
    console.log(`  ${WARN} no .mjs contract tests`);
    return;
  }
  let failed = 0;
  for (const f of files) {
    const { rc } = run(['node', path.join('tests', f)]);
    if (rc === 0) console.log(`  ${PASS} ${f}`);
    else {
      failed += 1;
      console.log(`  ${FAIL} ${f}`);
    }
  }
  if (failed === 0) console.log(`  ${PASS} all contract tests passed`);
  else {
    console.log(`  ${FAIL} ${failed} contract test(s) failed`);
    process.exitCode = 1;
  }
}

/**
 * 前端工具探测：直接查 frontend/node_modules/.bin/{name}，不依赖 npx/PATH。
 * Git Bash 环境下 `which npx` 会失败（which 不在 Windows PATH、npx 是 .cmd shim），
 * 导致前端检查被误跳过；与 check-deadcode-baseline.mjs 的 bin() 模式对齐。
 * Windows 下带 .cmd 后缀 + shell:true 经 cmd.exe 执行。
 */
function frontendBin(name) {
  const dir = path.join(ROOT, 'frontend', 'node_modules', '.bin');
  const candidates = process.platform === 'win32'
    ? [path.join(dir, name + '.cmd'), path.join(dir, name)]
    : [path.join(dir, name)];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function checkFrontendBuild() {
  console.log('\n=== Frontend Build ===');
  const bin = frontendBin('vite');
  if (!bin) {
    console.log(`  ${WARN} vite not found in node_modules/.bin — skip frontend build`);
    console.log('        run manually: cd frontend && npx vite build');
    return;
  }
  const { rc, out } = run([bin, 'build'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} Frontend build passed`);
  } else {
    console.log(`  ${FAIL} Frontend build failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkFrontendTest() {
  // ADR-023 P3：L3 Vitest 前端单测并入全量自检（写了要跑、坏了要红）
  console.log('\n=== Frontend Test (Vitest) ===');
  const bin = frontendBin('vitest');
  if (!bin) {
    console.log(`  ${WARN} vitest not found in node_modules/.bin — skip vitest`);
    console.log('        run manually: cd frontend && npx vitest run');
    return;
  }
  const { rc, out } = run([bin, 'run'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} vitest run passed`);
  } else {
    console.log(`  ${FAIL} vitest run failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkTypeScript() {
  console.log('\n=== TypeScript Check ===');
  // ADR-014：前端 .ts 类型检查（tsc --noEmit，见 frontend/package.json typecheck）
  const bin = frontendBin('tsc');
  if (!bin) {
    console.log(`  ${WARN} tsc not found in node_modules/.bin — skip typecheck`);
    console.log('        run manually: cd frontend && npx tsc --noEmit');
    return;
  }
  const { rc, out } = run([bin, '--noEmit'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} tsc --noEmit passed`);
  } else {
    // 空输出时 trim().split 得 ['']，直接 length 会假报 1 errors（code_review P2）
    const lines = out.trim().split('\n').filter(Boolean);
    console.log(`  ${FAIL} tsc --noEmit failed (${lines.length} errors)`);
    process.exitCode = 1;
    for (const line of lines.slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkKeyFiles() {
  console.log('\n=== Key Files ===');
  const files = [
    'main.go', 'wails.json',
    'internal/app/app.go', 'internal/app/resource_bindings.go',
    'resource_types.json', 'go.mod', 'reasonix.toml', 'AGENTS.md',
    'frontend/index.html', 'frontend/src/bus.ts', 'frontend/src/app-modules.ts',
  ];
  for (const f of files) {
    const p = path.join(ROOT, f);
    const ok = fs.existsSync(p);
    console.log(`  ${ok ? PASS : FAIL} ${f}`);
    if (!ok) process.exitCode = 1;
  }
}

function checkGovernance() {
  console.log('\n=== Governance Rules ===');
  let errors = 0;

  // 规则 1: window.__* 全局变量（ERROR 硬门槛，doctor 退出码 1 阻断提交）
  // node 原生扫描（grep 直调在 Windows MSYS 下吞反斜杠，`window\.__` 变 `window.__` 假绿）
  const srcTs = scanAllFiles(path.join(ROOT, 'frontend/src'), ['.js', '.ts']);
  const r1 = grepLines(srcTs, /window\.__/).map((l) => l.replace(/:\d+:.*$/, '')); // 右剥 :行号:内容，Windows 盘符路径不受 split(':')[0] 截断（code_review P2）
  if (r1.length) {
    errors += 1;
    console.log(`  ${FAIL} [rule1] window.__ global vars:`);
    for (const f of [...new Set(r1)]) console.log(`    ${f}`);
  }

  // 规则 8 动态拼接: innerHTML 含表达式插值（非纯标识符，如 ${e.message}）必须 esc()（ERROR 硬门槛）
  // 纯标识符插值（${inner} 等受信 HTML 片段）放行；命中行含 esc( 视为已转义
  const r8dyn = grepLines(srcTs, /innerHTML\s*=[^;]*\$\{[^}]*[^A-Za-z0-9_$}][^}]*\}/);
  if (r8dyn.length) {
    const unescaped = r8dyn.filter((l) => !/esc\(/.test(l));
    if (unescaped.length) {
      errors += 1;
      console.log(`  ${FAIL} [rule8] innerHTML 表达式插值未 esc()`);
      for (const line of unescaped) console.log(`    ${line}`);
    }
  }

  // 规则 5: 硬编码颜色（WARN 级，存量允许）
  const r5 = grepLines(scanAllFiles(path.join(ROOT, 'frontend'), ['.js', '.ts', '.css']), /#[0-9a-f]{6}\b/);
  if (r5.length) {
    console.log(`  ${WARN} [rule5] hardcoded colors (${r5.length} hits, top 10):`);
    for (const line of r5.slice(0, 10)) console.log(`    ${line}`);
  }

  // Wails 调用检查（WARN 级）。过滤注释行：`// ...`、`/* ... */`、` * ...` 里出现
  // window.go.main.App 只是文档说明（如 wails/app.ts 治理注释），非真实调用。
  const w = grepLines(srcTs, /window\.go\.main\.App/)
    .filter((l) => l && !/:\d+:\s*(?:\/\/|\/\*|\*)/.test(l))
    .join('\n');
  if (w) {
    console.log(`  ${WARN} [Wails] direct window.go calls:`);
    for (const line of w.split('\n')) console.log(`    ${line}`);
  }

  if (errors === 0) {
    console.log(`  ${PASS} all rules passed`);
  } else {
    console.log(`  ${FAIL} ${errors} ERROR rule(s) found`);
    process.exitCode = 1;
  }
}

function checkConfig() {
  console.log('\n=== Config Consistency ===');
  // node 原生计数（grep -c 直调在 Windows MSYS 下吞反斜杠，正则失效；且 rc 是退出码不是计数）
  let pluginsCount = '0（无匹配或文件缺失）';
  try {
    const toml = fs.readFileSync(path.join(ROOT, 'reasonix.toml'), 'utf-8');
    const n = (toml.match(/^\[\[plugins\]\]/gm) || []).length;
    pluginsCount = String(n);
  } catch { /* 文件缺失保持提示 */ }
  console.log(`  reasonix.toml plugins: ${pluginsCount}`);

  // wails.json name 提取（node 原生，消除 grep 依赖）
  try {
    const wailsJson = fs.readFileSync(path.join(ROOT, 'wails.json'), 'utf-8');
    const m = wailsJson.match(/"name"\s*:\s*"[^"]*"/);
    if (m) console.log(`  ${PASS} wails.json: ${m[0]}`);
    else {
      console.log(`  ${FAIL} wails.json parse failed`);
      process.exitCode = 1;
    }
  } catch {
    console.log(`  ${FAIL} wails.json parse failed`);
    process.exitCode = 1;
  }
}

function checkGit() {
  console.log('\n=== Git Status ===');
  const { out } = run(['git', 'status', '--short']);
  if (out.trim()) console.log(out);
  else console.log(`  ${PASS} clean`);
}

// 全量静态检查列表（保持原 12 项顺序，向后兼容既有输出 / CI）
const STATIC_TOOLS = [
  'check-doc-drift.mjs',
  'check-adr-health.mjs',
  'check-boolean-naming.mjs',
  'check-circular.mjs',
  'check-circular-go.mjs',
  'check-orphan-exports.mjs',
  'check-deadcode-baseline.mjs',
  // 前端分层依赖方向守护（views → features → services → utils → core，零容忍 + 基线）
  'check-layering.mjs',
  // 前端 JS id 引用 ↔ 模板定义交叉核对（幽灵 id 断链检测，防事件绑定静默失效）
  'check-tpl-refs.mjs',
  // 动态 import() 合理性审查（对照 app_modules 规范：失败处理/轻量工具/.js 后缀）
  'check-dynamic-import.mjs',
  // auto-import 默认只提示（rc=0），加 --strict 让缺失 import 成为真检查项
  { tool: 'auto-import.mjs', args: ['--strict'] },
  // 生成器守护：adr 登记表/规范索引 + releases 索引 + knowledge 委托校验，防生成产物静默过期
  { tool: 'gen-docs-index.mjs', args: ['--check'] },
  // 项目结构地图：目录结构 vs 磁盘扫描（AGENTS.md §4.1 指针指向 docs/project-map.md）
  { tool: 'gen-project-map.mjs', args: ['--check'] },
  // 小说总索引：docs/novel/ 目录树 vs docs/novel/index.md，防新增章节漏入索引
  { tool: 'build-novel-index.mjs', args: ['--check'] },
  // 脚本卫生：退出码失效 / 共享层内联 / --json 契约（WARN 不阻断，默认 rc=0）
  'check-script-hygiene.mjs',
];

// —— 静态检查工具分组（从 STATIC_TOOLS 派生，避免清单漂移）——
// 文档相关（--docs 模式运行，轻量、不碰 Go/前端编译）：
// 文档漂移 / ADR 登记健康 / 索引生成器守卫 / 知识卡 / 脚本卫生
const DOC_RELEVANT = new Set([
  'check-doc-drift.mjs',
  'check-adr-health.mjs',
  'gen-docs-index.mjs',
  'gen-project-map.mjs',
  'build-novel-index.mjs',
  'check-script-hygiene.mjs',
]);
const toolName = (entry) => (typeof entry === 'string' ? entry : entry.tool);
const DOC_STATIC_TOOLS = STATIC_TOOLS.filter((e) => DOC_RELEVANT.has(toolName(e)));
const CODE_STATIC_TOOLS = STATIC_TOOLS.filter((e) => !DOC_RELEVANT.has(toolName(e)));

function runStaticTools(tools, label) {
  console.log(`\n=== Static Analysis: ${label} (${tools.length} tools) ===`);
  let failed = 0;
  for (const entry of tools) {
    const tool = typeof entry === 'string' ? entry : entry.tool;
    const extraArgs = typeof entry === 'string' ? [] : entry.args || [];
    const { rc } = run(['node', path.join('scripts', tool), '--json', ...extraArgs]);
    if (rc === 0) console.log(`  ${PASS} ${tool}`);
    else {
      failed += 1;
      console.log(`  ${FAIL} ${tool}`);
    }
  }
  if (failed === 0) console.log(`  ${PASS} all static checks passed`);
  else {
    console.log(`  ${FAIL} ${failed} tool(s) failed`);
    process.exitCode = 1;
  }
}

function checkStaticAnalysis() {
  runStaticTools(STATIC_TOOLS, 'full');
}

// —— 文档模式专属检查 ——
// 断链 + 知识卡漂移 + ADR 登记一致性（撞号/漏登/幽灵/跳号）。
// 注意：check-doc-drift / check-adr-health 已并入 DOC_STATIC_TOOLS，此处不重复运行。
// link-checker 必须带 --strict：其 --json 模式默认恒 exit 0（仅 strict 才按断链非零退出，
// 避免断链时 doctor 误判 passed——code_review P2）。
const DOC_EXTRA_SCRIPTS = [
  { tool: 'link-checker.mjs', args: ['--strict'] },
  'check-knowledge-drift.mjs',
  'adr-check.mjs',
];

function checkDocExtra() {
  console.log('\n=== Doc Checks (links / drift / ADR registry) ===');
  let failed = 0;
  for (const s of DOC_EXTRA_SCRIPTS) {
    const tool = typeof s === 'string' ? s : s.tool;
    const extra = typeof s === 'string' ? [] : s.args || [];
    const { rc } = run(['node', path.join('scripts', tool), '--json', ...extra]);
    if (rc === 0) console.log(`  ${PASS} ${tool}`);
    else {
      failed += 1;
      console.log(`  ${FAIL} ${tool}`);
    }
  }
  if (failed === 0) console.log(`  ${PASS} all doc checks passed`);
  else {
    console.log(`  ${FAIL} ${failed} doc check(s) failed`);
    process.exitCode = 1;
  }
}

const DOCS_MODE = process.argv.includes('--docs');

if (DOCS_MODE) {
  // —— 文档模式：轻量，跳过一切 Go / 前端编译与测试 ——
  console.log('========== YSM Doctor (docs mode) ==========');
  console.log('跳过：Updater Helper / Go Build / Go Vet / Go Test / Contract Tests');
  console.log('跳过：Frontend Build / Frontend Test (Vitest) / TypeScript Check');
  console.log('跳过：Key Files / Governance / Config Consistency');
  checkDocExtra();
  runStaticTools(DOC_STATIC_TOOLS, 'docs');
  checkGit();
  console.log('\n========== Done (docs mode) ==========');
} else {
  // —— 全量模式：编译 + 构建 + 文件 + 红线 + Git ——
  console.log('========== YSM Doctor ==========');
  buildUpdaterHelper();
  checkGoBuild();
  checkGoVet();
  checkGoTest();
  checkContractTests();
  checkFrontendBuild();
  checkFrontendTest();
  checkTypeScript();
  checkKeyFiles();
  checkGovernance();
  checkConfig();
  checkStaticAnalysis();
  checkGit();
  console.log('\n========== Done ==========');
}
