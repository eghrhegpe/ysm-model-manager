#!/usr/bin/env node
/**
 * check-dynamic-import.ts — 动态 import() 合理性审查（对照 app_modules 规范）。
 *
 * 设计意图：app_modules 知识卡不变量「轻量组件静态导入（失败显式报错），重组件
 * 动态导入（失败 console.warn 告警不阻塞）」。本脚本对照该规范扫描动态 import()，
 * 识别四类隐患——失败处理缺失 / 空 catch 吞错 / .js 后缀残留 / 轻量工具模块被动态导入。
 *
 * 扫描 frontend/src/ 下所有 .js/.ts（排除 .test.）：
 *   1. 提取动态 import('...')（排除类型引用：`type X = import(...)` /
 *      `typeof import(...)` / `Array<import(...)` / `import(...).Type`）
 *   2. 检查失败处理：有无 .catch( / try{（整行上下文粗判）
 *   3. 分类报告：
 *      - WARN 动态导入无失败处理（fire-and-forget，失败静默）
 *      - WARN 空 catch 吞错（catch(() => {}) / .catch(() => {})）
 *      - WARN .js 后缀残留（target 以 .js 结尾且同目录存在 .ts）
 *      - WARN 轻量工具模块被动态导入（utils/ 下非组件文件，建议静态导入）
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 用法：
 *   node scripts/check-dynamic-import.ts          # 文本报告
 *   node scripts/check-dynamic-import.ts --json   # JSON（CI / doctor 消费）
 *
 * 退出码：WARN > 0 → 1；否则 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, walk, relPosix } from './_lib/scan-files.ts';

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');

// 动态 import('...')：前导排除标识符字符（import.meta / 变量名含 import 前缀）
const DYNAMIC_IMPORT_RE = /(?:^|[^A-Za-z0-9_$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// 类型引用排除（import(...) 用作类型而非运行时加载）
// P1 修复（子代理审计）：后置点号分支原为 `\.\s*[A-Za-z_$]`——会同时匹配运行时
// 写法 `import("x").then(...)`（小写 then/catch），把带 .then 的裸动态导入整条
// 判为类型引用跳过 → 漏检 fire-and-forget 静默失败。收窄为大写字类型名
// （`import("x").Type` / `.Foo`），`.then`/`.catch` 小写不再命中。
// P2-3 修复（code_review）：大写成员访问后不接调用括号才视为类型引用——`import("x").Foo()`
// 是运行时方法调用（大写方法名），(?!\s*\() 前瞻排除，避免把此类动态导入整条判为类型漏检。
// 注意 \b 不可省略：`[A-Z][\w$]*` 可回溯到部分单词（如匹配 `import("./m").F`），此时前瞻
// 在回溯位看到的不是 `(` 而通过 → `.Foo()` 仍被误判。\b 强制整词匹配后前瞻才生效。
const TYPE_REF_RE = /(?:type\s+[A-Za-z_$][\w$]*\s*=\s*import\(|typeof\s+import\(|Array<import\(|import\([^)]*\)\s*\.\s*[A-Z][\w$]*\b(?!\s*\())/;

/** 是否为 await import（失败沿 async 链传播，由调用方处理，不算静默）。 */
function isAwaitImport(text, start) {
  const before = text.slice(Math.max(0, start - 12), start);
  return /await\s*$/.test(before);
}

/** 是否为 loadView 包装器内的动态导入（loadView 内部统一 .catch + toast，不算裸导入）。 */
function isLoadViewWrapped(text, start) {
  const before = text.slice(Math.max(0, start - 240), start + 1);
  return /loadView\s*\(\s*['"][^'"]*['"]\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*$/.test(before);
}

/** 是否为裸 import(...) 且无 .catch（fire-and-forget，失败静默）。 */
function isBareImport(text, start) {
  // 不是 await import，且向后 240 字符内无 .catch( / try{ → 无失败处理。
  // 窗口取 240 字符无法覆盖跨行 Promise 链（.then(...) 回调长时 .catch 落在窗口外，
  // 会把「有 .catch 的链」误判为裸导入——如 app-tree/events.ts:172）。放宽到 2000 字符，
  // 覆盖常规 Promise 链；代价是对超长链的判定偏宽松（漏报方向，非误报方向）。
  const tail = text.slice(start, start + 2000);
  return !/\.catch\s*\(|try\s*\{/.test(tail);
}/** 空 catch 吞错（catch(() => {}) / .catch(() => {})）。 */
function isEmptyCatch(text, start) {
  const tail = text.slice(start, start + 160);
  return /\.catch\s*\(\s*\(\)\s*=>\s*\{\s*\}\)/.test(tail) || /\.catch\s*\(\s*\(\)\s*=>\s*\{\}\)/.test(tail);
}

/** 是否为轻量工具模块（utils/ 下非组件、非 3d 渲染的纯函数文件）。 */
function isLightweightUtil(spec) {
  return /\/utils\/[^/]+\.ts$/.test(spec) && !/\/utils\/dom\/(?:css|html)\.ts$/.test(spec);
}

function main() {
  // ADR-043 fail-closed：SRC_DIR 缺失 = 扫描不完整，必须显式失败而非空结果假绿
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`❌ frontend/src 目录不存在（${SRC_DIR}），扫描不完整，拒绝放行`);
    return 1;
  }
  const files = walk(SRC_DIR, { exts: ['.ts', '.js'] }).filter(
    (f: any) => !/\.test\./.test(f) && !/\.spec\./.test(f),
  );

  const warns: any[] = [];
  let dynamicCount = 0;

  for (const f of files) {
    const text = fs.readFileSync(f as string, 'utf8');
    for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) {
      // 排除类型引用（import("x").Type / type X = import(...) 等）
      const ctxStart = Math.max(0, m.index - 40);
      const ctx = text.slice(ctxStart, m.index + m[0].length + 60);
      if (TYPE_REF_RE.test(ctx)) continue;
      dynamicCount++;

      const spec = m[1];
      const line = text.slice(0, m.index).split('\n').length;
      const rel = relPosix(f);

      // 1. .js 后缀残留（同目录存在 .ts 对应）
      //    豁免 bindings/ 路径：vite.config.js wailsBindingsResolve 插件约定
      //    （Wails 生成 .ts、前端按 .js 导入、插件解析回 .ts），非残留。
      if (spec.endsWith('.js') && !spec.includes('/bindings/')) {
        const tsSpec = spec.replace(/\.js$/, '.ts');
        if (fs.existsSync(path.resolve(path.dirname(f as string), tsSpec))) {
          warns.push({ file: rel, line, spec, kind: 'js_suffix', msg: `.js 后缀残留（存在 ${tsSpec}，应改 .ts）` });
        }
      }

      // 2. 轻量工具模块被动态导入
      if (isLightweightUtil(spec)) {
        warns.push({ file: rel, line, spec, kind: 'lightweight_util', msg: '轻量工具模块被动态导入（建议静态导入，无按需价值）' });
      }

      // 3. 失败处理缺失（裸 import(...) 无 .catch 才是 fire-and-forget；
      //    await import(...) 失败沿 async 链传播，由调用方处理；
      //    loadView 包装器内统一 .catch + toast，不算裸导入）
      if (!isLoadViewWrapped(text, m.index) && !isAwaitImport(text, m.index) && isBareImport(text, m.index)) {
        warns.push({ file: rel, line, spec, kind: 'no_error_handling', msg: '裸动态导入无 .catch（fire-and-forget，失败静默）' });
      }
      // 4. 空 catch 吞错（await import 或裸 import 均适用）
      else if (isEmptyCatch(text, m.index)) {
        warns.push({ file: rel, line, spec, kind: 'empty_catch', msg: '空 catch 吞错（catch(() => {})，失败无反馈）' });
      }
    }
  }

  warns.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      _summary: { files_scanned: files.length, dynamic_imports: dynamicCount, warns: warns.length },
      warns,
    }, null, 2));
    return warns.length ? 1 : 0;
  }

  console.log(`扫描 ${files.length} 个前端源文件`);
  console.log(`动态 import() 数: ${dynamicCount}, 隐患: ${warns.length}`);
  console.log('');
  if (warns.length) {
    for (const w of warns) {
      console.log(`  [${w.kind}] ${w.file}:${w.line}  ${w.spec}`);
      console.log(`          ${w.msg}`);
    }
    console.log(`\n共 ${warns.length} 条隐患`);
    console.log('→ 修复: 改用静态 import（顶层 import），或确保动态 import 有 try/catch 错误处理');
  } else {
    console.log('全部动态导入均符合规范（有失败处理 / 非轻量工具 / 无 .js 后缀残留）');
  }
  return warns.length ? 1 : 0;
}

process.exit(main());
