#!/usr/bin/env node
/**
 * 契约测试：wails.json + go.mod 语法与结构校验（reasonix.toml 为本地 AI 终端配置，不入库不校验）。
 * 由 tests/python/test_config_syntax.py 迁移（2026-08-03），校验逻辑逐点保真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function checkWails() {
  const errors = [];
  const fp = path.join(ROOT, 'wails.json');
  if (!fs.existsSync(fp)) {
    errors.push('MISSING: wails.json');
    return errors;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e) {
    errors.push(`SYNTAX: wails.json 解析失败: ${e.message}`);
    return errors;
  }

  // Wails 3 契约：v2 平铺结构（outputfilename / frontend:* / bind）已弃用。
  // 迁移依据见 docs/architecture/adr/ADR-001-wails3-migration.md §3。
  if (!data.name) {
    errors.push("'name' must be non-empty");
  }

  const schema = data.$schema ?? '';
  if (!schema.includes('v3.wails.io')) {
    errors.push("'$schema' 必须指向 v3.wails.io（v2 配置不应残留）");
  }

  const frontend = data.frontend;
  if (typeof frontend !== 'object' || frontend === null) {
    errors.push("'frontend' 必须是对象");
  } else {
    if (!frontend.dir) errors.push("'frontend.dir' must be non-empty");
    if (!frontend.install) errors.push("'frontend.install' must be non-empty");
    if (!frontend.build) errors.push("'frontend.build' must be non-empty");
  }

  // v2 残留守卫：v3 已弃用顶层 bind 字段（service 自动发现替代）
  if ('bind' in data) {
    errors.push("'bind' 字段在 v3 已弃用（v2 残留，应移除）");
  }
  return errors;
}

function checkGomod() {
  const errors = [];
  const fp = path.join(ROOT, 'go.mod');
  if (!fs.existsSync(fp)) {
    errors.push('MISSING: go.mod');
    return errors;
  }

  const text = fs.readFileSync(fp, 'utf-8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  if (!text.startsWith('module ')) {
    errors.push("must start with 'module <name>'");
  }

  let goVersion = null;
  for (const line of lines) {
    const m = line.match(/^go\s+(\S+)/);
    if (m) {
      goVersion = m[1];
      break;
    }
  }
  if (!goVersion) {
    errors.push("missing 'go X.Y.Z' version line");
  } else {
    const parts = goVersion.split('.');
    if (parts.length >= 2) {
      const major = parseInt(parts[0], 10);
      const minor = parseInt(parts[1], 10);
      if (Number.isNaN(major) || Number.isNaN(minor)) {
        errors.push(`invalid go version '${goVersion}'`);
      } else if (major < 1 || minor < 20) {
        errors.push(`go version ${goVersion} too old, need 1.20+`);
      }
    }
  }

  let requireStart = -1;
  let requireEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^require\s*\($/.test(lines[i])) requireStart = i;
    if (requireStart >= 0 && lines[i].trim() === ')') {
      requireEnd = i;
      break;
    }
  }
  if (requireStart < 0) {
    errors.push("missing 'require (...)' block");
  } else if (requireEnd - requireStart < 2) {
    errors.push('too few dependencies in require block');
  }

  return errors;
}

const errors = [];
for (const e of checkWails()) errors.push(['wails.json', e]);
for (const e of checkGomod()) errors.push(['go.mod', e]);

if (errors.length) {
  console.error(`FAILED: ${errors.length} issue(s)\n`);
  for (const [src, e] of errors) console.error(`  [${src}] ${e}`);
  process.exit(1);
} else {
  console.log('OK: wails.json + go.mod syntax checks passed');
}
