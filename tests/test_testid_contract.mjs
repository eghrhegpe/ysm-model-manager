#!/usr/bin/env node
/**
 * 契约测试：关键 data-testid 存在性校验（G-1 抗脆弱测试基础设施 — ADR-035 / Design.md §19.1）。
 * 关键交互元素的 data-testid 被删除 → 契约红，防钩子静默失效。
 * 注册表：<testid> → <源文件路径（相对 frontend/）>
 * 只检验设计规范定义的「必须加」testid，纯展示元素不在此列。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');

/**
 * 关键 testid 注册表：<testid> → <期望所在的源文件（相对 frontend/）>
 * 新增关键交互元素时，在此注册 testid 及其源文件路径；删除元素时同步清理本表。
 */
const TESTID_REGISTRY = {
  // app-content 标签栏
  'content-tab':    'js/views/app-content/tpl.ts',
  'content-subtab': 'js/views/app-content/tpl.ts',
  // app-nav 导航项
  'nav-item':       'js/views/app-nav/index.ts',
  // app-resource-manager 资源管理器
  'rm-import':      'js/views/app-resource-manager/tpl.ts',
  'rm-open':        'js/views/app-resource-manager/tpl.ts',
  'rm-item':        'js/views/app-resource-manager/tpl.ts',
  // app-sidebar 侧栏操作
  'sidebar-push':   'js/views/app-sidebar/tpl.ts',
  'sidebar-pull':   'js/views/app-sidebar/tpl.ts',
  // app-sync-manager 同步管理器
  'sm-push':        'js/views/app-sync-manager/tpl.ts',
  'sm-pull':        'js/views/app-sync-manager/tpl.ts',
  // app-toast 通知
  'toast':          'js/views/app-toast/index.ts',
  // app-tree 文件树
  'tree-file':      'js/views/app-tree/row-tpl.ts',
  'tree-toggle':    'js/views/app-tree/row-tpl.ts',
  'tree-dir':       'js/views/app-tree/row-tpl.ts',
  'tree-dir-toggle':'js/views/app-tree/row-tpl.ts',
  // context-menu 右键菜单
  'ctx-item':       'js/views/context-menu/index.ts',
};

const errors = [];

for (const [testid, relFile] of Object.entries(TESTID_REGISTRY)) {
  const fp = path.join(FE, relFile);
  if (!fs.existsSync(fp)) {
    errors.push(`MISSING: ${relFile}（testid="${testid}" 的源文件）`);
    continue;
  }
  const content = fs.readFileSync(fp, 'utf-8');
  // 查找 data-testid="${testid}" 或 dataset.testid = "${testid}"
  const attrPattern = `data-testid="${testid}"`;
  const datasetPattern = `dataset.testid = "${testid}"`;
  if (!content.includes(attrPattern) && !content.includes(datasetPattern)) {
    errors.push(`MISSING: testid="${testid}" 在 ${relFile} 中未找到（data-testid 属性或 dataset.testid 赋值均认可）`);
  }
}

if (errors.length > 0) {
  console.error('❌ 契约测试失败：关键 data-testid 缺失');
  for (const e of errors) {
    console.error('  ', e);
  }
  process.exit(1);
} else {
  const count = Object.keys(TESTID_REGISTRY).length;
  console.log(`✅ 契约测试通过：${count} 个关键 data-testid 全部存在`);
}