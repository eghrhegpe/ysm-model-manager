#!/usr/bin/env node
/**
 * i18n-key-naming.mjs — i18n 键名三段式规范检查（ADR-124）
 *
 * 零依赖（仅 node:fs / node:path / node:url / node:child_process + _lib/parse-args）。
 *
 * 设计意图：1195 键语言包中大量"实体直挂 root"的旧键（preview.fog、tree.sortName 等），
 * 大模型/翻译人员改文案时极易撞车（"骨骼"18 处、"贴图"/"模型"/"整合包"更多）。
 * 全量重构不可行（PR 不可 review），本脚本只卡「新增键」必须三段式，旧键保留
 * 作为语义注释，由 --list-violations 给出迁移清单，按优先级（高频歧义实体）分批重构。
 *
 * 三段式规范（详见 ADR-124）：
 *   <模块>.<子命名空间>.<实体>   ← 子命名空间存在时，两段合法
 *   <模块>.<角色>.<实体>        ← 实体直挂 root 时，角色必填
 *   角色：tab / section / label / metric / action / hint / msg / field / ...
 *   例外：menu.* / error.* / nav.* / lang.* / ctx.* / app.* 自身就是角色，两段合法
 *
 * 用法：
 *   node scripts/i18n-key-naming.mjs                       # CI 模式：只检查新增/修改的键
 *   node scripts/i18n-key-naming.mjs --list-violations     # 列出所有违规旧键（按"高频歧义实体"排序）
 *   node scripts/i18n-key-naming.mjs --check key1 key2     # 检查指定键
 *   node scripts/i18n-key-naming.mjs --entity bone          # 列出某实体的所有键（如所有含"骨骼"的键）
 *   node scripts/i18n-key-naming.mjs --help                # 帮助
 *
 * 退出码：通过 → 0；违规且 CI 模式 → 1；--list-violations 不阻断。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, '..', 'frontend', 'src', 'core', 'i18n', 'locales');

// ── 模块白名单（宽松：不在白名单不阻断，只在 --list-violations 报告）──
const KNOWN_NAMESPACES = new Set([
  'preview', 'settings', 'diagnostics', 'content', 'dialog', 'tree', 'import',
  'about', 'workshop', 'error', 'format', 'common', 'syncManager', 'webFs',
  'menu', 'web', 'sync', 'recycle', 'nav', 'downloads', 'credits', 'sidebar',
  'update', 'downloadQueue', 'community', 'ctx', 'repo', 'skeleton', 'advFilter',
  'toast', 'perf', 'lang', 'resource', 'android', 'app', 'instances', 'oldest',
  'dedup', 'rtype', 'gh',
]);

// ── 已知合法的两段 entity（classify 是 role，但整体是不可拆分的业务术语，两段保留）──
// 格式：完整 segment 名（如 "skeletonTab"）→ 允许两段，不报错
const KNOWN_TWO_SEG_ENTITIES = new Set([
  'skeletonTab', 'boneLabels', 'bonesLabel', 'boneCount',
  'assetsBones', 'minGtMaxBones',
]);

// ── 角色白名单（UI 角色，必须从语义上回答"在 UI 中扮演什么角色"）──
const KNOWN_ROLES = new Set([
  'tab', 'section', 'label', 'metric', 'action', 'hint', 'msg', 'dialog',
  'option', 'state', 'event', 'field', 'tip', 'placeholder', 'status',
  'page', 'header', 'row', 'col', 'group', 'sub', 'item',
]);

// ── entity 派生 segment（classify 为 role，但 segment 整体本身也是完整业务术语）──
// 优先级：整个 seg 在 KNOWN_ROLES → role；
//         seg 在此集合 → role（整体是 entity）；
//         其他按 classfySecondSegment 规则判断。
// 集合与 KNOWN_TWO_SEG_ENTITIES 完全同源（同一批"整体不可拆分的业务术语"），
// 直接引用避免双份维护漂移（审查建议：此前两处逐字复制）。
const ENTITY_DERIVED_SEGMENTS = KNOWN_TWO_SEG_ENTITIES;

// ── 例外命名空间：自身就是角色，不强制三段式（menu/error/nav/...）──
// 这些命名空间下的两段键，两段本身合法（dialog 就是角色，不是子命名空间）
const EXEMPT_NAMESPACES = new Set(['menu', 'error', 'nav', 'lang', 'ctx', 'app', 'dialog']);

// ── 参数解析（仅直接执行时解析 argv；被 import 时跳过，见文件尾 main() guard）──
function parseCliArgs() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['list-violations', 'help'],
    strings: ['entity', 'check'],
    defaults: {},
  });

  if (args.help) {
    const _src = readFileSync(process.argv[1], 'utf-8');
    const _s = _src.indexOf('/**');
    const _e = _src.indexOf('*/', _s);
    console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }
  if (args.unknown && args.unknown.length) {
    console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
  }

  // --check：第一个值在 args.check，其余在 args._
  const allCheckKeys = [args.check, ...(args._ || [])].filter(Boolean);
  return { args, allCheckKeys };
}


// ── 提取键 ──────────────────────────────────────────
/** 纯文本 → 键集合（checkCI 对 git show 输出直接复用，免落临时文件）。 */
function extractKeysFromText(text) {
  const keys = new Set();
  // 匹配 "key": "value" 或 'key': 'value'，排除函数类型
  const re = /^\s*['"]([^'"]+)['"]\s*:\s*(?!function\b|\()/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

function extractKeys(file) {
  return extractKeysFromText(readFileSync(file, 'utf8'));
}

function loadAllKeys() {
  const result = {};
  for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.ts'))) {
    const lang = basename(file, '.ts');
    result[lang] = extractKeys(resolve(LOCALES_DIR, file));
  }
  return result;
}

// ── 常见实体名集合（用于判断"是业务实体还是子命名空间"）──
const COMMON_ENTITIES = new Set([
  'bones', 'bone', 'texture', 'textures', 'model', 'models', 'pack', 'packs',
  'count', 'size', 'total', 'name', 'names', 'title', 'desc', 'hint', 'type',
  'id', 'path', 'url', 'file', 'files', 'dir', 'dirs', 'folder', 'folders',
  'tab', 'tabs', 'sort', 'search', 'filter', 'status', 'state', 'mode',
  'color', 'opacity', 'brightness', 'contrast', 'light', 'shadow',
  'camera', 'zoom', 'rotate', 'axis', 'angle', 'time', 'date', 'author',
  'version', 'format', 'group', 'item', 'items', 'row', 'rows', 'key', 'keys',
  'value', 'values', 'enable', 'disable', 'show', 'hide', 'open', 'close',
  'td', 'fov', 'fovx', 'fovy',
]);

// ── 子命名空间 vs 角色 判断 ─────────────────────────
/**
 * 判断第二段是"子命名空间"还是"角色"。
 *
 * 子命名空间特征（合法，两段本身不违规）：
 *   - 含下划线：preview3d_group, env_group_custom
 *   - 驼峰含大写：preview3dCamSpeed, postprocessingGroupBloom, ssrOpacity
 *   - 以数字开头：3dPreview, 360View
 *   - 全小写短词但非角色：preview3d（不是 known_role，是子命名空间）
 *
 * 角色特征（两段违规，实体直挂 root）：
 *   - 在 KNOWN_ROLES 白名单：tab, section, label, metric, action, hint, ...
 *   - 非子命名空间特征的普通英文词：bones, count, sort, search, title, name
 *
 * @returns {'role' | 'subns'}
 */
function classifySecondSegment(seg) {
  if (KNOWN_ROLES.has(seg)) return 'role';

  // 子命名空间特征
  if (/_/.test(seg)) return 'subns';                  // env_group, preview3d_settings
  if (/^\d/.test(seg)) return 'subns';                // 3dPreview
  if (/^[a-z]{1,3}\d*$/.test(seg)) return 'subns';    // td (three.js), fov, fovX

  // 含大写字母：可能是驼峰 entity+RoleType（如 boneCount, boneLabels, skeletonTab）
  if (/[A-Z]/.test(seg)) {
    // 整体在 entity 派生 segment 表里 → role（即使能拆出 rolePart）
    if (ENTITY_DERIVED_SEGMENTS.has(seg)) return 'role';
    const match = seg.match(/^([a-z]+)([A-Z][a-z]+)$/);
    if (match) {
      const [, entity, rolePart] = match;
      const rolePartLower = rolePart.toLowerCase();
      // rolePart 本身是已知角色 → role
      if (KNOWN_ROLES.has(rolePartLower)) return 'role';
      // entity + 整体都在 COMMON_ENTITIES → role
      if (COMMON_ENTITIES.has(entity) && COMMON_ENTITIES.has(seg.toLowerCase())) return 'role';
    }
    return 'subns'; // 其他驼峰视为子命名空间
  }

  // 短纯英文小写词：bones, count, sort, name, title, desc, hint, type
  if (COMMON_ENTITIES.has(seg)) return 'role';

  // 默认：短纯小写词视为角色（更严格，便于 CI 发现问题）
  if (/^[a-z]+$/.test(seg) && seg.length <= 8) return 'role';

  return 'subns'; // 其余视为子命名空间（保守）
}

// ── 启发式：根据实体名猜测角色（用于违规建议）──
function guessRole(entity) {
  const e = entity.toLowerCase();
  if (/tab$|nav$|page$/.test(e)) return 'tab';
  if (/^(export|import|copy|paste|delete|remove|add|open|close|save|reload|clear|reset|apply|cancel|submit|confirm|refresh|retry|download|upload|install|uninstall|enable|disable|run|stop|start|pause|resume|toggle|select|deselect|choose)/.test(e)) return 'action';
  if (/count$|size$|total$|num$|amount$|number$|len$|length$|width$|height$|depth$/.test(e)) return 'metric';
  if (/hint$|tip$|help$|desc$|description$|placeholder$/.test(e)) return 'hint';
  if (/label$|title$|name$|caption$|heading$/.test(e)) return 'label';
  if (/state$|status$/.test(e)) return 'state';
  if (/msg$|message$|text$|content$/.test(e)) return 'msg';
  if (/field$|col$|column$|attr$|attribute$/.test(e)) return 'field';
  if (/group$|section$|panel$/.test(e)) return 'section';
  return 'section'; // 默认
}

// ── 校验单键 ────────────────────────────────────────
/**
 * @returns {{ ok: boolean, reason?: string, suggestion?: string }}
 */
function validateKey(key) {
  const parts = key.split('.');

  // 单段键允许（很少，如 lang）
  if (parts.length < 2) return { ok: true };

  const ns = parts[0];

  // 例外命名空间：自身就是角色，两段合法
  if (EXEMPT_NAMESPACES.has(ns)) {
    // 两段合法（menu.openFolder）；三段及以上第二段当子命名空间——
    // 单凭字面无法区分子命名空间与自创角色，且 ADR-124 注释明确"角色不限于白名单"，
    // 三段成段即默认合法，避免 audio/cache 等子命名空间词被误判为"角色不在白名单"阻断提交。
    return { ok: true };
  }

  // 普通命名空间
  if (parts.length === 2) {
    // 两段：第二段是子命名空间 → 合法（preview.postprocessingGroupBloom）
    // 第二段是角色 → 违规，但 KNOWN_TWO_SEG_ENTITIES 里的保留（preview.skeletonTab 等复合实体）
    const second = parts[1];
    const classify = classifySecondSegment(second);
    if (classify === 'role') {
      // 在已知合法两段 entity 表里 → 保留（整体是不可拆分的业务术语）
      if (KNOWN_TWO_SEG_ENTITIES.has(second)) return { ok: true };
      const roleGuess = guessRole(second);
      return {
        ok: false,
        reason: `实体直挂 root（"${ns}.${second}" 缺少子命名空间）`,
        suggestion: `建议改为 "${ns}.${roleGuess}.${second}"`,
      };
    }
    // 子命名空间合法
    return { ok: true };
  }

  // 三段及以上：<模块>.<第二段>.<实体...>
  // 第二段在 KNOWN_ROLES → 明确角色；否则默认当子命名空间（合法）。
  // 不再用 classifySecondSegment 的字面启发式判"角色不在白名单"——那会把
  // audio/cache/proxy/layer/panel/network 等子命名空间意图词误判为角色并阻断提交。
  // "实体直挂 root"违规只在两段式判定（见上方 parts.length === 2，ADR-124 主战场）。
  return { ok: true };
}

// ── 子命令：--list-violations ──────────────────────
function listViolations() {
  const all = loadAllKeys();
  const baseLang = 'zh-CN';
  if (!all[baseLang]) {
    console.error(`❌ 找不到基准语言包 ${baseLang}`);
    process.exit(1);
  }

  const violations = [];
  for (const key of all[baseLang]) {
    const result = validateKey(key);
    if (!result.ok) violations.push({ key, ...result });
  }

  // 按"实体违规次数"降序（高频歧义优先）
  const entityCount = new Map();
  for (const v of violations) {
    const parts = v.key.split('.');
    if (parts.length === 2) {
      const ent = parts[1];
      entityCount.set(ent, (entityCount.get(ent) || 0) + 1);
    }
  }

  violations.sort((a, b) => {
    const ea = a.key.split('.')[1] || '';
    const eb = b.key.split('.')[1] || '';
    return (entityCount.get(eb) || 0) - (entityCount.get(ea) || 0);
  });

  console.log(`[扫描] ${LOCALES_DIR}`);
  console.log(`[基准] ${baseLang}：${all[baseLang].size} 键\n`);
  console.log(`[违规] 共 ${violations.length} 个键实体直挂 root（按"实体跨命名空间数"降序）\n`);

  // 按实体分组输出 TOP
  const grouped = new Map();
  for (const v of violations) {
    const parts = v.key.split('.');
    if (parts.length === 2) {
      const ent = parts[1];
      if (!grouped.has(ent)) grouped.set(ent, []);
      grouped.get(ent).push(v);
    }
  }

  const sortedEntities = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
  const TOP = 15;
  for (const [ent, items] of sortedEntities.slice(0, TOP)) {
    console.log(`📌 "${ent}"（${items.length} 处违规）：`);
    for (const v of items.slice(0, 3)) { // 每实体最多显示 3 个示例
      console.log(`   ❌ ${v.key}`);
      console.log(`      原因：${v.reason}`);
      if (v.suggestion) console.log(`      → ${v.suggestion}`);
    }
    if (items.length > 3) console.log(`      ... 还有 ${items.length - 3} 处`);
    console.log();
  }

  if (sortedEntities.length > TOP) {
    console.log(`... 还有 ${sortedEntities.length - TOP} 个低频实体未显示`);
  }

  console.log(`\n[统计]`);
  console.log(`  总违规键：${violations.length}`);
  console.log(`  高频歧义实体（>5处违规）：${sortedEntities.filter(([_, v]) => v.length > 5).length}`);
  console.log(`  中频（2-5处）：${sortedEntities.filter(([_, v]) => v.length >= 2 && v.length <= 5).length}`);
  console.log(`  孤立（1处）：${sortedEntities.filter(([_, v]) => v.length === 1).length}`);

  return violations;
}

// ── 子命令：--entity <name> ──────────────────────────
function listByEntity(entity) {
  const all = loadAllKeys();
  const baseLang = 'zh-CN';
  const lower = entity.toLowerCase();

  const found = [];
  for (const key of all[baseLang]) {
    if (key.toLowerCase().includes(lower)) found.push(key);
  }

  if (found.length === 0) {
    console.log(`[实体] "${entity}"：未找到匹配键`);
    return;
  }

  console.log(`[实体] 搜索含 "${entity}" 的所有键（共 ${found.length} 个）：\n`);
  for (const key of found.sort()) {
    const result = validateKey(key);
    console.log(`  ${result.ok ? '✅' : '❌'} ${key}`);
    if (!result.ok) console.log(`       原因：${result.reason}  → ${result.suggestion || ''}`);
  }
}

// ── CI 模式：检查新增/修改的键 ──────────────────────
function checkCI() {
  const r = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', 'frontend/src/core/i18n/locales'], {
    encoding: 'utf-8',
    cwd: resolve(__dirname, '..'),
  });
  if (r.status !== 0) {
    // 无 git 或失败 → 跳过
    console.log('[i18n-key-naming] 无法获取 git diff，跳过新增键检查');
    return;
  }

  const changedFiles = r.stdout.trim().split('\n').filter(Boolean);
  if (changedFiles.length === 0) {
    console.log('[i18n-key-naming] 无语言包改动，跳过');
    return;
  }

  // 找新增键（current - HEAD）
  const newKeys = new Set();
  for (const relPath of changedFiles) {
    const fullPath = resolve(__dirname, '..', relPath.replace(/\//g, '\\'));
    if (!existsSync(fullPath)) continue;
    const current = extractKeys(fullPath);

    // 尝试从 git HEAD 读旧版本（git show 输出直接走纯文本提取，不落临时文件——
    // 只读环境/并行下安全，且省一次写删 IO）
    const gitPath = relPath.replace(/\\/g, '/');
    const headResult = spawnSync('git', ['show', `HEAD:${gitPath}`], { encoding: 'utf-8' });
    let headKeys = new Set();
    if (headResult.status === 0) {
      headKeys = extractKeysFromText(headResult.stdout);
    }

    for (const k of current) {
      if (!headKeys.has(k)) newKeys.add(k);
    }
  }

  if (newKeys.size === 0) {
    console.log(`[i18n-key-naming] 无新增键，跳过`);
    return;
  }

  console.log(`[i18n-key-naming] 检查 ${newKeys.size} 个新增键...\n`);

  const violations = [];
  for (const key of newKeys) {
    const result = validateKey(key);
    if (!result.ok) violations.push({ key, ...result });
  }

  if (violations.length === 0) {
    console.log(`✅ 全部 ${newKeys.size} 个新增键通过三段式校验`);
    return;
  }

  console.error(`❌ ${violations.length}/${newKeys.size} 个新增键违反三段式规范（ADR-124）：\n`);
  for (const v of violations) {
    console.error(`   ❌ ${v.key}`);
    console.error(`      原因：${v.reason}`);
    if (v.suggestion) console.error(`      建议：${v.suggestion}`);
  }
  console.error(`\n详见 ADR-124：docs/adr/ADR-124-i18n-key-naming-three-segment.md`);
  process.exit(1);
}

// ── --check <key1> <key2> ──────────────────────────
function checkKeys(keys) {
  let allOk = true;
  for (const key of keys) {
    const result = validateKey(key);
    if (result.ok) {
      console.log(`✅ ${key}`);
    } else {
      console.log(`❌ ${key}`);
      console.log(`     原因：${result.reason}`);
      if (result.suggestion) console.log(`     建议：${result.suggestion}`);
      allOk = false;
    }
  }
  process.exit(allOk ? 0 : 1);
}

// ── 主入口（仅直接执行时运行；被 import 时跳过，便于单元测试）──
function main() {
  const { args, allCheckKeys } = parseCliArgs();
  if (args['list-violations']) {
    listViolations();
  } else if (args.entity) {
    listByEntity(args.entity);
  } else if (allCheckKeys.length > 0) {
    checkKeys(allCheckKeys);
  } else {
    checkCI();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}

// 导出纯函数供测试 import（见 scripts/i18n-key-naming.test.mjs）
export { validateKey, classifySecondSegment, guessRole, extractKeys, loadAllKeys };
