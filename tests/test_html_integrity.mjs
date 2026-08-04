#!/usr/bin/env node
/**
 * 契约测试：frontend/index.html 引用完整性校验。
 * 由 tests/python/test_html_integrity.py 迁移（2026-08-03），校验逻辑逐点保真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'frontend', 'index.html');

const errors = [];

if (!fs.existsSync(INDEX)) {
  errors.push('MISSING: frontend/index.html');
  process.exit(1);
}

const html = fs.readFileSync(INDEX, 'utf-8');

// 1. CSS link href → 物理文件（跳过 data: 和 http:）
for (const m of html.matchAll(/<link[^>]*href="([^"]+)"/g)) {
  const href = m[1];
  if (href.startsWith('data:') || href.startsWith('http')) continue;
  const fp = path.join(ROOT, 'frontend', href);
  if (!fs.existsSync(fp)) {
    errors.push(`CSS link target not found: ${href}`);
  }
}

// 2. script src → 物理文件
for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) {
  const src = m[1];
  const fp = path.join(ROOT, 'frontend', src);
  if (!fs.existsSync(fp)) {
    errors.push(`Script src not found: ${src}`);
  }
}

// 3. 检查 module script 有 type="module"（原实现为 no-op 检查，保持等价）
for (const m of html.matchAll(/<script\s+([^>]*)>/g)) {
  const attrs = m[1];
  if (attrs.includes('module') && !attrs.includes('type')) {
    // type="module" implied by newer browsers
  }
  if (attrs.includes('src=') && !attrs.includes('type') && !attrs.includes('nomodule')) {
    // 非 module script 检查（原实现为 no-op）
  }
}

// 4. 检查自定义组件标签（<app-xxx>）都有对应组件文件（.js/.ts 皆可，ADR-014 渐进迁移）
for (const m of html.matchAll(/<(\w+-\w+)[>\s]/g)) {
  const tag = m[1];
  if (tag.startsWith('app-')) {
    const indexJs = path.join(ROOT, 'frontend', `js/views/${tag}/index.js`);
    const indexTs = path.join(ROOT, 'frontend', `js/views/${tag}/index.ts`);
    if (!fs.existsSync(indexJs) && !fs.existsSync(indexTs)) {
      // 有些组件可能是单文件
      const singleJs = path.join(ROOT, 'frontend', `js/views/${tag}.js`);
      const singleTs = path.join(ROOT, 'frontend', `js/views/${tag}.ts`);
      if (!fs.existsSync(singleJs) && !fs.existsSync(singleTs)) {
        errors.push(`Custom component '${tag}' has no JS/TS file`);
      }
    }
  }
}

// 5. DOCTYPE
const trimmed = html.trimStart();
if (!trimmed.startsWith('<!doctype html') && !trimmed.startsWith('<!DOCTYPE html')) {
  errors.push('Missing or incorrect DOCTYPE');
}

// 6. charset
if (!html.includes('charset="UTF-8"') && !html.includes('charset="utf-8"')) {
  errors.push('Missing charset=UTF-8');
}

if (errors.length) {
  console.error(`FAILED: ${errors.length} issue(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
} else {
  console.log('OK: index.html reference integrity passed');
}
