#!/usr/bin/env node
/**
 * check-tpl-refs.ts — 前端 JS id 引用 ↔ 模板定义交叉核对（断链检测）。
 *
 * 设计意图：JS 代码里 getElementById("xxx") 引用的 id，若模板/动态生成中从未
 * 定义，事件绑定静默失效（?.addEventListener 跳过 null），无任何报错线索——
 * 曾出现 ws-export-btn / diag-dedup-list 幽灵 id。本脚本把这类断链提前暴露：
 * 「引用有、定义无」→ ERROR 阻断。
 *
 * 扫描 frontend/src/ 下所有 .js/.ts（排除 .test.）：
 *   1. 收集定义：所有源文件中的 id="xxx" / id='xxx' 字面量
 *      （含模板字符串拼接的静态片段，如 '...id="repo-tab-'+... 的静态前缀部分）
 *   2. 收集引用：getElementById("xxx") / getElementById('xxx') 字面量参数
 *      （动态参数如 getElementById(id) / getElementById(prefix+...) 无法静态判定，跳过）
 *   3. 交叉核对：引用但无定义的 id → 断链（ERROR）
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 用法：
 *   node scripts/check-tpl-refs.ts            # 文本报告
 *   node scripts/check-tpl-refs.ts --json     # JSON（CI / doctor 消费）
 *
 * 退出码：断链 > 0 → 1；否则 0（WARN 不阻断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, walk, getRoot } from './_lib/scan-files.ts';

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');

/** 收集单个文件中的 id 定义（id="xxx" / id='xxx' 字面量）。 */
function collectDefinedIds(text: string) {
  const out = new Set();
  // 双引号/单引号字面量 + 模板字符串内的静态 id="..."（模板 ${} 片段天然被排除，因为引号不闭合）
  for (const m of text.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bid='([a-zA-Z0-9_-]+)'/g)) out.add(m[1]);
  // JS 属性赋值形式：el.id = "xxx" / el.style.id = "xxx"（动态创建的真实 id，如 fab.ts 注入 style）
  for (const m of text.matchAll(/\.id\s*=\s*"([a-zA-Z0-9_-]+)"/g)) out.add(m[1]);
  for (const m of text.matchAll(/\.id\s*=\s*'([a-zA-Z0-9_-]+)'/g)) out.add(m[1]);
  return out;
}

/** 收集单个文件中的 getElementById 字面量引用。 */
function collectRefs(text: string) {
  const out = new Map(); // id -> 行号
  for (const m of text.matchAll(/getElementById\("([a-zA-Z0-9_-]+)"\)/g)) {
    const line = text.slice(0, m.index).split('\n').length;
    if (!out.has(m[1])) out.set(m[1], line);
  }
  for (const m of text.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)/g)) {
    const line = text.slice(0, m.index).split('\n').length;
    if (!out.has(m[1])) out.set(m[1], line);
  }
  return out;
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

  // 汇总所有定义（跨文件，含模板拼接）
  const defined = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f as string, 'utf8');
    for (const id of collectDefinedIds(text)) defined.add(id);
  }

  // 额外收集 frontend/ 根目录的入口 HTML（index.html / web.html）中的 id 定义：
  // web-spike/main.ts（ADR-049 网页版独立入口）引用 #drop/#file/#out，定义在
  // frontend/web.html，不在 src/ 扫描范围内 → 误报断链。入口 HTML 的 id 是真实 DOM
  // 定义，纳入收集避免漏判。
  const frontendRoot = path.join(getRoot(), 'frontend');
  for (const htmlName of ['index.html', 'web.html']) {
    const htmlPath = path.join(frontendRoot, htmlName);
    if (fs.existsSync(htmlPath)) {
      const htmlText = fs.readFileSync(htmlPath, 'utf8');
      for (const id of collectDefinedIds(htmlText)) defined.add(id);
    }
  }

  // 汇总所有引用
  const refs = new Map(); // id -> [{ file, line }]
  for (const f of files) {
    const text = fs.readFileSync(f as string, 'utf8');
    for (const [id, line] of collectRefs(text)) {
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push({ file: f, line });
    }
  }

  // 交叉核对：引用但无定义 → 断链
  const broken: any[] = [];
  for (const [id, occ] of refs) {
    if (!defined.has(id)) {
      for (const o of occ) broken.push({ id, file: o.file, line: o.line });
    }
  }
  broken.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (JSON_OUT) {
    // refs 为唯一 id 数，broken 为出现次数（维度不同，分别列明避免歧义，code_review P3）
    const refOccurrences = [...refs.values()].reduce((n, occ) => n + occ.length, 0);
    console.log(JSON.stringify({
      _summary: { files_scanned: files.length, refs: refs.size, ref_occurrences: refOccurrences, broken: broken.length },
      broken,
    }, null, 2));
    return broken.length ? 1 : 0;
  }

  console.log(`扫描 ${files.length} 个前端源文件`);
  console.log(`getElementById 引用 id 数: ${refs.size}, 断链: ${broken.length}`);
  console.log('');
  if (broken.length) {
    for (const b of broken) {
      console.log(`  [BROKEN] ${b.id} — ${b.file}:${b.line} 引用但模板/源码中无 id 定义`);
    }
    console.log(`\n共 ${broken.length} 条断链（JS 引用的 id 从未渲染，事件绑定静默失效）`);
    console.log('→ 修复: 在模板中添加对应 id 的定义，或删除 JS 中未使用的 id 引用');
  } else {
    console.log('全部 id 引用均有定义');
  }
  return broken.length ? 1 : 0;
}

process.exit(main());
