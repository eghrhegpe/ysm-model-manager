#!/usr/bin/env node
/**
 * 项目健康诊断。一键检查 Go 编译、前端构建、文件完整性、治理红线。
 * 由 scripts/doctor.py 迁移（2026-08-03），逻辑逐点保真。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

function checkGoBuild() {
  console.log('=== Go Build ===');
  const { rc, out } = run(['go', 'build', './go/...']);
  if (rc === 0) {
    console.log(`  ${PASS} Go build passed`);
  } else {
    console.log(`  ${FAIL} Go build failed`);
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
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkFrontendBuild() {
  console.log('\n=== Frontend Build ===');
  // 先检查 npx 是否可用
  const which = run(['which', 'npx']);
  if (which.rc !== 0) {
    console.log(`  ${WARN} npx not found in PATH — skip frontend build`);
    console.log('        run manually: cd frontend && npx vite build');
    return;
  }
  const { rc, out } = run(['npx', 'vite', 'build'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} Frontend build passed`);
  } else {
    console.log(`  ${FAIL} Frontend build failed`);
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkTypeScript() {
  console.log('\n=== TypeScript Check ===');
  // ADR-014：前端 .ts 类型检查（tsc --noEmit，见 frontend/package.json typecheck）
  const which = run(['which', 'npx']);
  if (which.rc !== 0) {
    console.log(`  ${WARN} npx not found in PATH — skip typecheck`);
    console.log('        run manually: cd frontend && npx tsc --noEmit');
    return;
  }
  const { rc, out } = run(['npx', 'tsc', '--noEmit'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} tsc --noEmit passed`);
  } else {
    console.log(`  ${FAIL} tsc --noEmit failed (${out.trim().split('\n').length} errors)`);
    for (const line of out.trim().split('\n').slice(-5)) {
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
    'frontend/index.html', 'frontend/js/bus.ts', 'frontend/js/app-modules.js',
  ];
  for (const f of files) {
    const p = path.join(ROOT, f);
    console.log(`  ${fs.existsSync(p) ? PASS : FAIL} ${f}`);
  }
}

function checkGovernance() {
  console.log('\n=== Governance Rules ===');
  let issues = 0;

  // 规则 1: window.__* 全局变量
  const r1 = run(['grep', '-rn', 'window\\.__', path.join(ROOT, 'frontend/js/'), '--include=*.js', '--include=*.ts', '-l']).out.trim();
  if (r1) {
    issues += 1;
    console.log(`  ${WARN} [rule1] window.__ global vars:`);
    for (const f of r1.split('\n')) console.log(`    ${f}`);
  }

  // 规则 5: 硬编码颜色
  const r5 = run(['grep', '-rn', '#[0-9a-f]\\{6\\}\\b', path.join(ROOT, 'frontend/'), '--include=*.js', '--include=*.ts', '--include=*.css']).out.trim();
  if (r5) {
    issues += 1;
    const lines = r5.split('\n');
    console.log(`  ${WARN} [rule5] hardcoded colors (${lines.length} hits, top 10):`);
    for (const line of lines.slice(0, 10)) console.log(`    ${line}`);
  }

  // 规则 8: innerHTML 拼接
  const r8 = run(['grep', '-rn', 'innerHTML\\s*=', path.join(ROOT, 'frontend/js/'), '--include=*.js', '--include=*.ts']).out.trim();
  if (r8) {
    issues += 1;
    console.log(`  ${WARN} [rule8] innerHTML concat:`);
    for (const line of r8.split('\n')) console.log(`    ${line}`);
  }

  // Wails 调用检查
  const w = run(['grep', '-rn', 'window\\.go\\.main\\.App', path.join(ROOT, 'frontend/js/'), '--include=*.js', '--include=*.ts']).out.trim();
  if (w) {
    issues += 1;
    console.log(`  ${WARN} [Wails] direct window.go calls:`);
    for (const line of w.split('\n')) console.log(`    ${line}`);
  }

  if (issues === 0) {
    console.log(`  ${PASS} all rules passed`);
  } else {
    console.log(`  ${WARN} ${issues} issue(s) found`);
  }
}

function checkConfig() {
  console.log('\n=== Config Consistency ===');
  const { rc } = run(['grep', '-c', '^\\[\\[plugins\\]\\]', path.join(ROOT, 'reasonix.toml')]);
  console.log(`  reasonix.toml plugins: ${rc}`);

  const r = run(['grep', '-o', '"name"[[:space:]]*:[[:space:]]*"[^"]*"', path.join(ROOT, 'wails.json')]);
  if (r.rc === 0) {
    const name = r.out.trim().split('\n')[0] || '?';
    console.log(`  ${PASS} wails.json: ${name}`);
  } else {
    console.log(`  ${FAIL} wails.json parse failed`);
  }
}

function checkGit() {
  console.log('\n=== Git Status ===');
  const { out } = run(['git', 'status', '--short']);
  if (out.trim()) console.log(out);
  else console.log(`  ${PASS} clean`);
}

const STATIC_TOOLS = [
  'check-doc-drift.mjs',
  'check-adr-health.mjs',
  'check-boolean-naming.mjs',
  'check-circular.mjs',
  'check-consumers.mjs',
  'check-deadcode-baseline.mjs',
];

function checkStaticAnalysis() {
  console.log('\n=== Static Analysis (6 tools) ===');
  let failed = 0;
  for (const tool of STATIC_TOOLS) {
    const { rc } = run(['node', path.join('scripts', tool), '--json']);
    if (rc === 0) console.log(`  ${PASS} ${tool}`);
    else {
      failed += 1;
      console.log(`  ${FAIL} ${tool}`);
    }
  }
  if (failed === 0) console.log(`  ${PASS} all static checks passed`);
  else console.log(`  ${FAIL} ${failed} tool(s) failed`);
}

console.log('========== YSM Doctor ==========');
checkGoBuild();
checkGoTest();
checkFrontendBuild();
checkTypeScript();
checkKeyFiles();
checkGovernance();
checkConfig();
checkStaticAnalysis();
checkGit();
console.log('\n========== Done ==========');
