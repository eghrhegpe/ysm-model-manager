#!/usr/bin/env node
/**
 * 契约测试：AppConfig JSON 结构校验。匹配 Go types.AppConfig。
 * 由 tests/python/test_config_defaults.py 迁移（2026-08-03），校验逻辑逐点保真。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 解析 AppConfig 实际落点（与 Go 端 configPath() 对齐）。
 * Wails 3 迁移（ADR-001 §7 #5）后配置落在 os.UserConfigDir()/YSM-Model-Manager/ysm_config.json，
 * 仓库根的 ysm_config.json 已被 .gitignore 排除、不再作为 canonical 位置。
 * 返回首个存在的候选路径；都不存在（首次运行/纯净环境）返回 null。
 */
function configPath() {
  let base = null;
  if (process.platform === 'win32') {
    base = process.env.APPDATA ?? null;
  } else if (process.platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = path.join(os.homedir(), '.config');
  }
  const candidates = [];
  if (base) candidates.push(path.join(base, 'YSM-Model-Manager', 'ysm_config.json'));
  candidates.push(path.join(ROOT, 'ysm_config.json')); // 遗留位置（迁移兼容）
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 对应 Go types.AppConfig 的 json tag
const ALWAYS_REQUIRED = [
  'filesRoot', 'ysmRoot', 'resourcepackRoot', 'shaderpackRoot',
  'schematicRoot', 'mmdRoot', 'vrcRoot', 'mcRoot',
  'linkMode', 'theme', 'mirror',
  'winX', 'winY', 'winW', 'winH', 'winRelX', 'winRelY', 'winScrW', 'winScrH',
];
const STRING_FIELDS = ALWAYS_REQUIRED.slice(0, 11).concat(['litematicRoot', 'repoRoot']);
const INT_FIELDS = ALWAYS_REQUIRED.slice(11).concat(['voxelMaxBlocks']);

function validate() {
  const errors = [];
  const cfg = configPath();
  if (cfg === null) {
    // 首次运行或纯净环境无配置文件，属合法状态，不视为违规
    return errors;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
  } catch (e) {
    errors.push(`SYNTAX: ${cfg} 解析失败: ${e.message}`);
    return errors;
  }

  for (const field of ALWAYS_REQUIRED) {
    if (!(field in data)) {
      errors.push(`MISSING: '${field}' not in config`);
    }
  }

  for (const field of STRING_FIELDS) {
    const val = data[field];
    if (val !== undefined && val !== null && typeof val !== 'string') {
      errors.push(`TYPE: '${field}' must be string (got ${typeof val})`);
    }
  }

  for (const field of INT_FIELDS) {
    const val = data[field];
    if (val !== undefined && val !== null && typeof val !== 'number') {
      errors.push(`TYPE: '${field}' must be int (got ${typeof val})`);
    }
  }

  const vm = data['voxelMaxBlocks'];
  if (vm !== undefined && vm !== null && typeof vm !== 'number') {
    errors.push(`TYPE: 'voxelMaxBlocks' must be int (got ${typeof vm})`);
  }

  const link_mode = data['linkMode'] ?? '';
  if (link_mode && !['copy', 'hardlink', 'symlink', ''].includes(link_mode)) {
    errors.push(`VALUE: 'linkMode' must be copy/hardlink/symlink (got '${link_mode}')`);
  }

  const theme = data['theme'] ?? '';
  const valid_themes = new Set(['cyber', 'warm', 'pro', 'default-dark', 'mint', 'ocean', '']);
  if (theme && !valid_themes.has(theme)) {
    errors.push(`VALUE: 'theme' must be one of ${[...valid_themes]} (got '${theme}')`);
  }

  return errors;
}

const errors = validate();
if (errors.length) {
  console.error(`FAILED: ${errors.length} violation(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
} else {
  console.log('OK: config schema checks passed');
}
