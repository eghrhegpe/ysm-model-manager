#!/usr/bin/env node
/**
 * 契约测试：creators.json schema 校验。
 * type/role 是自由标签，只校验必填字段和格式。
 * 由 tests/python/test_creators_schema.py 迁移（2026-08-03），校验逻辑逐点保真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_FILE = path.join(ROOT, 'creators.json');

function validate() {
  const errors = [];

  if (!fs.existsSync(JSON_FILE)) {
    errors.push(`MISSING: ${JSON_FILE}`);
    return errors;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
  } catch (e) {
    errors.push(`SYNTAX: creators.json 解析失败: ${e.message}`);
    return errors;
  }

  if (!Array.isArray(data) || data.length === 0) {
    errors.push('SCHEMA: must be a non-empty array');
    return errors;
  }

  const names = new Set();
  for (let i = 0; i < data.length; i++) {
    const creator = data[i];
    if (typeof creator !== 'object' || creator === null) continue;

    const prefix = `[${i}] ${creator?.name ?? '?'}`;

    const name = creator?.name ?? '';
    if (!name || typeof name !== 'string') {
      errors.push(`${prefix}: 'name' must be non-empty string`);
    }
    // duplicate names are allowed (multiple source entries)
    names.add(name);

    for (const field of ['desc', 'type', 'role']) {
      const val = creator?.[field] ?? '';
      if (val && typeof val !== 'string') {
        errors.push(`${prefix}: '${field}' must be string`);
      }
    }
  }

  return errors;
}

const errors = validate();
if (errors.length) {
  console.error(`FAILED: ${errors.length} schema violation(s) in ${path.basename(JSON_FILE)}\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
} else {
  console.log('OK: all creators passed schema checks');
}
