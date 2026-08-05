#!/usr/bin/env node
/**
 * Wails Binding 签名检查。对比 Go 端导出函数 vs 前端生成的 wailsjs。
 * 由 scripts/binding-check.py 迁移（2026-08-03），逻辑逐点保真。
 * binding-check.mjs — Go binding 一致性检查
 * 设计意图：Go binding 一致性检查
 * 依赖：node:fs / node:path / node:url
 * 用法：
 *   node scripts/binding-check.mjs                 # 默认行为
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';


// Go 文件，搜索 func (a *App) FuncName(（Go 源码位于 internal/app/ 下）
const GO_FILES = [
  'app.go', 'app_avatar.go', 'app_config.go', 'app_download.go',
  'app_files.go', 'app_install.go', 'app_model.go', 'app_scan.go',
  'app_tags.go', 'app_workshop.go', 'resource_bindings.go',
  'proxy.go', 'wasm_decoder.go', 'wasm_embed.go',
];
// Wails 绑定统一走 -ts 契约（frontend/bindings），对照 v3 生成的 app.ts
const BINDINGS_FILE = path.join(ROOT, 'frontend/bindings/ysm-model-manager/internal/app/app.ts');

// 框架生命周期方法（带 context/application 参数），Wails 不生成绑定，应排除
const FRAMEWORK_METHODS = new Set(['ServiceStartup', 'ServiceShutdown']);

function extractGoExports() {
  /** 从 Go 源码提取所有 func (a *App) 导出函数。 */
  const exports = {};
  for (const fname of GO_FILES) {
    const fp = path.join(ROOT, 'internal/app', fname);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf-8');
    for (const m of text.matchAll(/func \(a \*App\) (\w+)\(/g)) {
      const name = m[1];
      // 跳过大写开头的非导出函数（Go 惯例）+ 框架生命周期方法
      if (name[0] === name[0].toLowerCase()) continue;
      if (FRAMEWORK_METHODS.has(name)) continue;
      if (!(name in exports)) exports[name] = path.basename(fp);
    }
  }
  return exports;
}

function extractBindingsExports() {
  /** 从 v3 契约产物 app.ts 提取所有导出的包装函数。 */
  const exports = {};
  if (!fs.existsSync(BINDINGS_FILE)) return exports;
  const text = fs.readFileSync(BINDINGS_FILE, 'utf-8');
  for (const m of text.matchAll(/export function (\w+)\(/g)) {
    exports[m[1]] = path.basename(BINDINGS_FILE);
  }
  return exports;
}

const goExports = extractGoExports();
const jsExports = extractBindingsExports();

const issues = [];

// Go 有但 JS 没有
for (const [name, f] of Object.entries(goExports).sort(([a], [b]) => a.localeCompare(b))) {
  if (!(name in jsExports)) {
    issues.push({ type: 'missing_in_js', func: name, go_file: f });
  }
}

// JS 有但 Go 没有
const jsNames = new Set(Object.keys(jsExports));
const goNames = new Set(Object.keys(goExports));
for (const name of [...jsNames].filter((n) => !goNames.has(n)).sort()) {
  issues.push({ type: 'extra_in_js', func: name, js_file: path.relative(ROOT, BINDINGS_FILE) });
}

const out = { _summary: { go_functions: Object.keys(goExports).length, js_functions: Object.keys(jsExports).length, issues: issues.length }, issues };
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
