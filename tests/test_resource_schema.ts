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
// ADR-067：zipentry 为容器内容指纹 detector（裸文件按扩展名、.zip 容器按 zipEntries 匹配）
const VALID_DETECTORS = new Set(['mcmeta', 'shader', 'ysm', 'extension', 'zipentry']);
const VALID_ZIP_MATCHES = new Set(['exact', 'prefix', 'suffix']);
const CONTAINER_EXTS = new Set(['.zip', '.7z']);
const VALID_ACTIONS = new Set(['import', 'toggle', 'delete', 'openFolder', 'view']);
// Go AppConfig 字段白名单（go/types/config.go）——configField 必须指向真实持久化字段
const VALID_CONFIG_FIELDS = new Set([
  'YsmRoot', 'ResourcepackRoot', 'ShaderpackRoot', 'SchematicRoot', 'LitematicRoot', 'MmdRoot', 'VrcRoot',
]);
const REQUIRED_FIELDS = ['id', 'name', 'icon', 'extensions', 'instanceDir', 'instanceLevel', 'preview', 'detector'];
// ADR-092：合法分组 id 白名单（resourceGroups 顶层数组派生）
const VALID_GROUPS = new Set(['minecraft', 'minecraft-mod', 'mmd', 'vrm', 'other']);

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

  // ADR-092：resourceGroups 顶层数组（可选；若存在须为含 id 的非空数组，id 合法且唯一）
  if ('resourceGroups' in data) {
    const groups = data.resourceGroups;
    if (!Array.isArray(groups) || groups.length === 0) {
      errors.push("SCHEMA: 'resourceGroups' must be a non-empty array when present");
    } else {
      const groupIds = new Set();
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const gid = g?.id ?? '';
        if (!gid) {
          errors.push(`SCHEMA: resourceGroups[${gi}].id must be non-empty`);
        } else if (groupIds.has(gid)) {
          errors.push(`SCHEMA: duplicate resourceGroup id '${gid}'`);
        }
        groupIds.add(gid);
      }
    }
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

    // 容器宣告守卫（ADR-067）：extensions / subtypes.extensions 声明容器扩展名
    // （.zip/.7z）的类型必须具备 zipEntries 内容指纹——容器识别唯一途径是内容指纹，
    // 无指纹的容器宣告 = 无主假阳性（ExtBelongsTo 列它为候选，DetectContainerType 永远
    // 无法命中）。与 go/packs DetectResourceType 容器分支准入语义一致。
    const hasContainerDecl = (list) => (list ?? []).some((e) => CONTAINER_EXTS.has(e.toLowerCase()));
    const hasFingerprint = (entries) => Array.isArray(entries) && entries.length > 0;
    if (hasContainerDecl(exts) && !hasFingerprint(rt?.zipEntries)) {
      errors.push(`${prefix}: 声明容器扩展名（${[...CONTAINER_EXTS].join('/')}）必须配合非空 zipEntries 内容指纹`);
    }
    if (Array.isArray(rt?.subtypes)) {
      for (const st of rt.subtypes) {
        if (hasContainerDecl(st?.extensions) && !hasFingerprint(st?.zipEntries)) {
          errors.push(`${prefix}.${st?.name ?? '?'}: 声明容器扩展名必须配合非空 zipEntries 内容指纹`);
        }
      }
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

    // zipEntries 校验（内容指纹契约，ADR-067）：元素结构 + zipentry detector 配套约束
    const zipEntries = rt?.zipEntries ?? [];
    if (!Array.isArray(zipEntries)) {
      errors.push(`${prefix}: 'zipEntries' must be an array`);
    } else {
      for (let j = 0; j < zipEntries.length; j++) {
        const ze = zipEntries[j];
        if (!ze || typeof ze.name !== 'string' || !ze.name) {
          errors.push(`${prefix}: zipEntries[${j}].name must be non-empty string`);
        }
        if (!ze || !VALID_ZIP_MATCHES.has(ze.match)) {
          errors.push(`${prefix}: zipEntries[${j}].match must be one of ${[...VALID_ZIP_MATCHES]} (got '${ze?.match}')`);
        }
      }
      // detector=zipentry 必须声明 zipEntries 且 extensions 含容器扩展名——
      // 否则 DetectResourceType 容器分支（matchZipArchive）永不执行，内容识别静默失效
      if (detector === 'zipentry') {
        if (zipEntries.length === 0) {
          errors.push(`${prefix}: detector 'zipentry' requires non-empty 'zipEntries'`);
        }
        const containerExts = exts.filter((e) => CONTAINER_EXTS.has(e.toLowerCase()));
        if (containerExts.length === 0) {
          errors.push(`${prefix}: detector 'zipentry' requires '.zip' or '.7z' in 'extensions'`);
        }
      }
    }

    // actions 校验（可选——81490dc8 清理死配置后不再强制：存在才校验非空+白名单，
    // 前端/Go 已零消费，唯一历史消费者即本测试自身）
    const actions = rt?.actions;
    if (actions !== undefined) {
      if (!Array.isArray(actions) || actions.length === 0) {
        errors.push(`${prefix}: 'actions' must be a non-empty array`);
      } else {
        for (const act of actions) {
          if (!VALID_ACTIONS.has(act)) {
            errors.push(`${prefix}: unknown action '${act}', must be one of ${[...VALID_ACTIONS]}`);
          }
        }
      }
    }

    // configField 如果存在，必须是 PascalCase+Root，且必须在 Go AppConfig 字段白名单内
    const cf = rt?.configField ?? '';
    if (cf && !(cf[0] === cf[0].toUpperCase() && cf.endsWith('Root'))) {
      errors.push(`${prefix}: 'configField' should be PascalCase+Root (got '${cf}')`);
    }
    if (cf && !VALID_CONFIG_FIELDS.has(cf)) {
      errors.push(`${prefix}: 'configField' must be one of ${[...VALID_CONFIG_FIELDS]} (got '${cf}')`);
    }

    // ADR-092：group 可选；若存在必须在合法分组白名单内，且引用的 resourceGroups 已声明
    const grp = rt?.group ?? '';
    if (grp && !VALID_GROUPS.has(grp)) {
      errors.push(`${prefix}: 'group' must be one of ${[...VALID_GROUPS]} (got '${grp}')`);
    }
  }

  // ===== P0 守卫硬断言（与 go/types validateRegistrySchema 对齐）=====
  // 壳/叶职责分离 + 字段唯一归属：违规直接 FAIL，CI 拦在提交前。

  // 守卫 1：装饰壳类型（有 subtypes 且非 subDirGrouping）字段白名单——
  // 壳只管分组/识别/展示，落盘与配置字段归叶类型独占。豁免：installDir/scanDir
  // （整合包实例扫描按壳聚合消费，browser-adapter 契约钉死 create-blueprint→schematics）、
  // instanceLevel（REQUIRED_FIELDS 必填）、scanInstance/dirLevelSync（遗留标记，
  // Go 侧 validateRegistrySchema 同款豁免：同步管理器按壳读取 dirLevelSync）。
  const SHELL_FORBIDDEN_FIELDS = [
    'storageSubDir', 'configField', 'configFallback',
    'isDir', 'hashable', 'installExts', 'nestedModelDir', 'fallbackDir',
  ];
  for (const rt of types) {
    const hasSubtypes = Array.isArray(rt?.subtypes) && rt.subtypes.length > 0;
    const isSubDirGrouping = rt?.subDirGrouping === true;
    if (!hasSubtypes || isSubDirGrouping) continue;
    for (const f of SHELL_FORBIDDEN_FIELDS) {
      const v = rt?.[f];
      const present = Array.isArray(v)
        ? v.length > 0
        : typeof v === 'boolean'
          ? v
          : v !== undefined && v !== '';
      if (present) {
        const val = Array.isArray(v) ? JSON.stringify(v) : `${v}`;
        errors.push(`${rt.id}: 壳类型（subtypes 且非 subDirGrouping）禁止携带 '${f}'=${val}（落地/配置归叶）`);
      }
    }
  }

  // 守卫 2/3：storageSubDir 全局唯一，configField 允许同组共享
  const subDirOwners = new Map(); // storageSubDir → 首个声明者
  const cfgFieldOwners = new Map(); // configField → [首个声明者, 所属组]
  for (const rt of types) {
    if (rt?.storageSubDir) {
      if (subDirOwners.has(rt.storageSubDir)) {
        errors.push(`${rt.id}: storageSubDir '${rt.storageSubDir}' 与 '${subDirOwners.get(rt.storageSubDir)}' 重复（全局唯一）`);
      } else {
        subDirOwners.set(rt.storageSubDir, rt.id);
      }
    }
    if (rt?.configField) {
      const existing = cfgFieldOwners.get(rt.configField);
      if (existing && existing[1] !== rt.group) {
        errors.push(`${rt.id}: configField '${rt.configField}' 与 '${existing[0]}' 跨组重复（仅限同组共享）`);
      } else if (!existing) {
        cfgFieldOwners.set(rt.configField, [rt.id, rt.group]);
      }
    }
  }

  // 守卫 4：configFallback 引用完整性——必须指向已声明的 configField
  for (const rt of types) {
    if (rt?.configFallback && !cfgFieldOwners.has(rt.configFallback)) {
      errors.push(`${rt.id}: configFallback '${rt.configFallback}' 引用了不存在的 configField（孤儿回退）`);
    }
  }

  // 守卫 5：组元数据完整性——每个出现的 group 恰好一个 groupLabel/groupIcon 携带者，
  // 且组有成员必有标签（组的元数据是全局概念，禁止 per-type 双写或零写静默丢失）。
  const groupLabelOwners = new Map(); // group → [types]
  const groupIconOwners = new Map(); // group → [types]
  for (const rt of types) {
    if (!rt?.group) continue;
    if (rt.groupLabel) {
      const list = groupLabelOwners.get(rt.group) ?? [];
      list.push(rt.id);
      groupLabelOwners.set(rt.group, list);
    }
    if (rt.groupIcon) {
      const list = groupIconOwners.get(rt.group) ?? [];
      list.push(rt.id);
      groupIconOwners.set(rt.group, list);
    }
  }
  for (const rt of types) {
    if (!rt?.group) continue;
    if (!groupLabelOwners.has(rt.group)) {
      errors.push(`group '${rt.group}' 有成员但无 groupLabel 携带者（应恰好 1 个类型携带）`);
    }
    if (!groupIconOwners.has(rt.group)) {
      errors.push(`group '${rt.group}' 有成员但无 groupIcon 携带者（应恰好 1 个类型携带）`);
    }
  }
  for (const [g, owners] of groupLabelOwners) {
    if (owners.length > 1) {
      errors.push(`group '${g}' 的 groupLabel 被多个类型携带（应恰好 1 个）: ${owners.join(', ')}`);
    }
  }
  for (const [g, owners] of groupIconOwners) {
    if (owners.length > 1) {
      errors.push(`group '${g}' 的 groupIcon 被多个类型携带（应恰好 1 个）: ${owners.join(', ')}`);
    }
  }

  // 守卫 6：storageSubDir × scanDir/installDir 跨组撞车——仓库侧目录（FilesRoot）与
  // 整合包侧目录（实例内）语义不同，跨组相同字符串 = 复制粘贴错误。同组豁免：
  // MC 生态内同组类型合法共享整合包目录（如 blueprint/litematic 都读 schematics/，
  // Create 与 Litematica 共用）。同类型自身 storageSubDir === scanDir 亦豁免
  // （如 blueprint 两侧都叫 schematics）。历史案例：create-blueprint 壳 installDir
  // 'schematics/' 与 blueprint 叶 storageSubDir='schematics' 撞车（壳白名单已禁）。
  const storageSubDirOwnerOf = new Map(); // subdir → typeId
  const typeGroupOf = new Map(); // typeId → group
  for (const rt of types) {
    if (rt?.storageSubDir) storageSubDirOwnerOf.set(rt.storageSubDir, rt.id);
    if (rt?.id) typeGroupOf.set(rt.id, rt.group ?? '');
  }
  for (const rt of types) {
    for (const f of ['scanDir', 'instanceDir']) {
      const v = rt?.[f] ? String(rt[f]).replace(/\/+$/, '') : '';
      if (!v) continue;
      const owner = storageSubDirOwnerOf.get(v);
      if (owner && owner !== rt.id && typeGroupOf.get(owner) !== rt?.group) {
        errors.push(`${rt.id}.${f}='${rt[f]}' 与 ${owner}.storageSubDir 撞车（跨组仓库/整合包目录混淆）`);
      }
    }
  }

  // 守卫 7：scanInstance=true 必须声明 fallbackDir——兜底扫描只允许注册表点名目录，
  // 缺省会退回“任一兄弟目录含扩展名即命中”的危险宽目录混入行为。
  for (const rt of types) {
    if (rt?.scanInstance === true && !rt?.fallbackDir) {
      errors.push(`${rt.id}: scanInstance=true 必须声明非空 fallbackDir（限定兜底目录名）`);
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
