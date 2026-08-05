#!/usr/bin/env node
/**
 * check-tpl-refs.mjs — 前端 JS id 引用 ↔ 模板定义交叉核对（断链检测）。
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
 *   node scripts/check-tpl-refs.mjs            # 文本报告
 *   node scripts/check-tpl-refs.mjs --json     # JSON（CI / doctor 消费）
 *
 * 退出码：断链 > 0 → 1；否则 0（WARN 不阻断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, walk } from './_lib/scan-files.mjs';

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');

/** 收集单个文件中的 id 定义（id="xxx" / id='xxx' 字面量）。 */
function collectDefinedIds(text) {
  const out = new Set();
  // 双引号/单引号字面量 + 模板字符串内的静态 id="..."（模板 ${} 片段天然被排除，因为引号不闭合）
  for (const m of text.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bid='([a-zA-Z0-9_-]+)'/g)) out.add(m[1]);
  return out;
}

/** 收集单个文件中的 getElementById 字面量引用。 */
function collectRefs(text) {
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
  const files = walk(SRC_DIR, { include: ['.ts', '.js'] }).filter(
    (f) => !/\.test\./.test(f) && !/\.spec\./.test(f),
  );

  // 汇总所有定义（跨文件，含模板拼接）
  const defined = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const id of collectDefinedIds(text)) defined.add(id);
  }

  // 汇总所有引用
  const refs = new Map(); // id -> [{ file, line }]
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const [id, line] of collectRefs(text)) {
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push({ file: f, line });
    }
  }

  // 交叉核对：引用但无定义 → 断链
  const broken = [];
  for (const [id, occ] of refs) {
    if (!defined.has(id)) {
      for (const o of occ) broken.push({ id, file: o.file, line: o.line });
    }
  }
  broken.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      _summary: { files_scanned: files.length, refs: refs.size, broken: broken.length },
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
  } else {
    console.log('全部 id 引用均有定义');
  }
  return broken.length ? 1 : 0;
}

process.exit(main());
