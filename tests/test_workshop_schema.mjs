#!/usr/bin/env node
/**
 * 契约测试：workshop_sites.json schema 校验。
 * 由 tests/python/test_workshop_schema.py 迁移（2026-08-03），校验逻辑逐点保真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_FILE = path.join(ROOT, 'workshop_sites.json');

const VALID_GROUPS = new Set(['search', 'github', 'repo']);
const REQUIRED_FIELDS = ['id', 'icon', 'label', 'url', 'desc', 'group'];

function validate() {
  const errors = [];

  if (!fs.existsSync(JSON_FILE)) {
    errors.push(`MISSING: ${JSON_FILE}`);
    return { errors, count: 0 };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
  } catch (e) {
    errors.push(`SYNTAX: workshop_sites.json 解析失败: ${e.message}`);
    return { errors, count: 0 };
  }

  if (!Array.isArray(data) || data.length === 0) {
    errors.push('SCHEMA: must be a non-empty array');
    return { errors, count: 0 };
  }

  const ids = new Set();
  for (let i = 0; i < data.length; i++) {
    const site = data[i];
    const prefix = `[${i}] ${site?.id ?? '?'}`;

    for (const field of REQUIRED_FIELDS) {
      if (!(field in site)) {
        errors.push(`${prefix}: missing required field '${field}'`);
      } else if (typeof site[field] !== 'string' || !site[field]) {
        errors.push(`${prefix}: '${field}' must be non-empty string`);
      }
    }

    const tid = site?.id ?? '';
    if (tid) {
      if (ids.has(tid)) {
        errors.push(`${prefix}: duplicate id '${tid}'`);
      }
      ids.add(tid);
    }

    const group = site?.group ?? '';
    if (group && !VALID_GROUPS.has(group)) {
      errors.push(`${prefix}: 'group' must be one of ${[...VALID_GROUPS]} (got '${group}')`);
    }

    // searchUrl if present must contain {{q}} or be a valid URL
    const su = site?.searchUrl ?? '';
    if (su && !su.includes('{{q}}') && !su.startsWith('http')) {
      errors.push(`${prefix}: 'searchUrl' should contain {{q}} or be a URL`);
    }

    // presetSearches if present
    const ps = site?.presetSearches ?? [];
    if (ps && ps.length > 0) {
      if (!Array.isArray(ps)) {
        errors.push(`${prefix}: 'presetSearches' must be an array`);
      } else {
        for (let j = 0; j < ps.length; j++) {
          const p = ps[j];
          if (typeof p !== 'object' || p === null || !('label' in p)) {
            errors.push(`${prefix}: presetSearches[${j}] missing 'label'`);
          }
        }
      }
    }
  }

  return { errors, count: data.length };
}

const { errors, count } = validate();
if (errors.length) {
  console.error(`FAILED: ${errors.length} schema violation(s) in ${path.basename(JSON_FILE)}\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
} else {
  console.log(`OK: ${count} sites, all schema checks passed`);
}
