#!/usr/bin/env node
/**
 * 契约测试：resource_types.json schema 校验。
 * 由 tests/python/test_resource_schema.py 迁移（2026-08-03），校验逻辑逐点保真。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_FILE = path.join(ROOT, 'resource_types.json');

const VALID_PREVIEWS = new Set(['3d', 'thumbnail', 'none']);
const VALID_DETECTORS = new Set(['mcmeta', 'shader', 'ysm', 'extension']);
const VALID_ACTIONS = new Set(['import', 'toggle', 'delete', 'openFolder', 'view']);
const REQUIRED_FIELDS = ['id', 'name', 'icon', 'extensions', 'installDir', 'instanceLevel', 'preview', 'detector', 'actions'];

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
    errors.push(`SYNTAX: resource_types.json 解析失败: ${e.message}`);
    return errors;
  }

  if (!('resourceTypes' in data)) {
    errors.push("SCHEMA: missing top-level 'resourceTypes' key");
    return errors;
  }

  const types = data.resourceTypes;
  if (!Array.isArray(types) || types.length === 0) {
    errors.push("SCHEMA: 'resourceTypes' must be a non-empty array");
    return errors;
  }

  const ids = new Set();
  for (let i = 0; i < types.length; i++) {
    const rt = types[i];
    const prefix = `[${i}] ${rt?.id ?? '?'}`;

    // 必填字段
    for (const field of REQUIRED_FIELDS) {
      if (!(field in rt)) {
        errors.push(`${prefix}: missing required field '${field}'`);
      }
    }

    // id 校验
    const tid = rt?.id ?? '';
    if (!tid) {
      errors.push(`${prefix}: 'id' must be non-empty`);
    } else if (![...tid].every((c) => /[a-zA-Z0-9-]/.test(c))) {
      errors.push(`${prefix}: 'id' must be kebab-case (got '${tid}')`);
    } else if (ids.has(tid)) {
      errors.push(`${prefix}: duplicate id '${tid}'`);
    }
    ids.add(tid);

    // name 校验
    if (!rt?.name) {
      errors.push(`${prefix}: 'name' must be non-empty`);
    }

    // icon 校验（至少 1 字符）
    if (!rt?.icon) {
      errors.push(`${prefix}: 'icon' must be non-empty`);
    }

    // extensions 校验
    const exts = rt?.extensions ?? [];
    if (!Array.isArray(exts) || exts.length === 0) {
      errors.push(`${prefix}: 'extensions' must be a non-empty array`);
    } else {
      for (let j = 0; j < exts.length; j++) {
        const ext = exts[j];
        if (typeof ext !== 'string' || !ext.startsWith('.')) {
          errors.push(`${prefix}: extensions[${j}] must start with '.' (got '${ext}')`);
        }
      }
    }

    // installDir 校验
    const inst = rt?.installDir ?? '';
    if (inst && !inst.endsWith('/') && !inst.includes('{instance}')) {
      errors.push(`${prefix}: 'installDir' must end with '/' (got '${inst}')`);
    }

    // instanceLevel 校验
    if (typeof rt?.instanceLevel !== 'boolean') {
      errors.push(`${prefix}: 'instanceLevel' must be boolean`);
    }

    // preview 校验
    const preview = rt?.preview ?? '';
    if (!VALID_PREVIEWS.has(preview)) {
      errors.push(`${prefix}: 'preview' must be one of ${[...VALID_PREVIEWS]} (got '${preview}')`);
    }

    // detector 校验
    const detector = rt?.detector ?? '';
    if (!VALID_DETECTORS.has(detector)) {
      errors.push(`${prefix}: 'detector' must be one of ${[...VALID_DETECTORS]} (got '${detector}')`);
    }

    // actions 校验
    const actions = rt?.actions ?? [];
    if (!Array.isArray(actions) || actions.length === 0) {
      errors.push(`${prefix}: 'actions' must be a non-empty array`);
    } else {
      for (const act of actions) {
        if (!VALID_ACTIONS.has(act)) {
          errors.push(`${prefix}: unknown action '${act}', must be one of ${[...VALID_ACTIONS]}`);
        }
      }
    }

    // configField 如果存在，必须是 PascalCase+Root
    const cf = rt?.configField ?? '';
    if (cf && !(cf[0] === cf[0].toUpperCase() && cf.endsWith('Root'))) {
      errors.push(`${prefix}: 'configField' should be PascalCase+Root (got '${cf}')`);
    }
  }

  return errors;
}

const errors = validate();
if (errors.length) {
  console.error(`FAILED: ${errors.length} schema violation(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
} else {
  console.log('OK: all resource types passed schema checks');
}
