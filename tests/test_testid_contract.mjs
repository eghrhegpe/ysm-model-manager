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
  'content-tab':    'src/views/app-content/tpl.ts',
  // app-nav 导航项
  'nav-item':       'src/views/app-nav/index.ts',
  // app-sidebar 侧栏操作
  'sidebar-push':   'src/views/app-sidebar/tpl.ts',
  'sidebar-pull':   'src/views/app-sidebar/tpl.ts',
  'sidebar-select-all': 'src/views/app-sidebar/tpl.ts',
  'sidebar-check':  'src/views/app-sidebar/tpl.ts',
  'sidebar-sync-type': 'src/views/app-sidebar/tpl.ts',
  // app-sync-manager 同步管理器
  'sm-push':        'src/views/app-sync-manager/tpl.ts',
  'sm-pull':        'src/views/app-sync-manager/tpl.ts',
  // app-toast 通知
  'toast':          'src/views/app-toast/index.ts',
  // app-tree 文件树
  'tree-file':      'src/views/app-tree/row-tpl.ts',
  'tree-toggle':    'src/views/app-tree/row-tpl.ts',
  'tree-dir':       'src/views/app-tree/row-tpl.ts',
  'tree-dir-toggle':'src/views/app-tree/row-tpl.ts',
  // app-tree 工具栏（bindToolbarEvents 交互元素）
  'tree-srch':      'src/views/app-tree/tpl.ts',
  'tree-adv-filter':'src/views/app-tree/tpl.ts',
  'tree-authors':   'src/views/app-tree/tpl.ts',
  'tree-batch':     'src/views/app-tree/tpl.ts',
  'tree-batch-enable': 'src/views/app-tree/tpl.ts',
  'tree-batch-disable':'src/views/app-tree/tpl.ts',
  'tree-more':      'src/views/app-tree/tpl.ts',
  'tree-more-import-file': 'src/views/app-tree/tpl.ts',
  'tree-more-import-dir':  'src/views/app-tree/tpl.ts',
  'tree-sel-all':   'src/views/app-tree/tpl.ts',
  'tree-more-open-folder': 'src/views/app-tree/tpl.ts',
  'tree-more-refresh': 'src/views/app-tree/tpl.ts',
  'tree-more-genindex': 'src/views/app-tree/tpl.ts',
  'tree-sort':      'src/views/app-tree/tpl.ts',
  'tree-view-mode': 'src/views/app-tree/tpl.ts',
  'tree-af-min-bones': 'src/views/app-tree/tpl.ts',
  'tree-af-max-bones': 'src/views/app-tree/tpl.ts',
  'tree-af-min-cubes': 'src/views/app-tree/tpl.ts',
  'tree-af-max-cubes': 'src/views/app-tree/tpl.ts',
  'tree-af-min-tex': 'src/views/app-tree/tpl.ts',
  'tree-af-max-tex': 'src/views/app-tree/tpl.ts',
  'tree-af-clear':  'src/views/app-tree/tpl.ts',
  'tree-repo':      'src/views/app-tree/tpl.ts',
  // context-menu 右键菜单
  'ctx-item':       'src/views/context-menu/index.ts',
  // modal 遮罩弹窗（modalPrompt/modalConfirm/modalSelect）
  'dlg-overlay':    'src/utils/dom/dialogs/modal.ts',
  'dlg-input':      'src/utils/dom/dialogs/modal.ts',
  'dlg-select':     'src/utils/dom/dialogs/modal.ts',
  'dlg-cancel':     'src/utils/dom/dialogs/modal.ts',
  'dlg-ok':         'src/utils/dom/dialogs/modal.ts',
  // community 仓库页事件编排（bindRepoEvents / renderModelList）
  'gh-back':        'src/features/community/render.ts',
  'gh-srch':        'src/features/community/render.ts',
  'gh-toggle':      'src/features/community/render.ts',
  'gh-select-all':  'src/features/community/render.ts',
  'gh-dl-selected': 'src/features/community/render.ts',
  'gh-list':        'src/features/community/render.ts',
  'gh-row':         'src/features/community/render.ts',
  'gh-cb':          'src/features/community/render.ts',
  'gh-name':        'src/features/community/render.ts',
  'gh-dl':          'src/features/community/render.ts',
  'gh-search-bili': 'src/features/community/render.ts',
  // recycle-bin 回收站列表（loadRecycleBin 渲染）
  'recy-item':      'src/features/recycle-bin.ts',
  'recy-restore':   'src/features/recycle-bin.ts',
  'recy-del':       'src/features/recycle-bin.ts',
};

const errors = [];

// G-1 抗脆弱测试基础设施存在性（原 test_testid_hooks.mjs 并入；
// 其 4 个 tree-* testid 已由上方 TESTID_REGISTRY 覆盖，此处仅保留 contract 注册表未覆盖的 2 项文件存在性守护）
// 1. test-utils helper 存在（G-1 ③）
if (!fs.existsSync(path.join(FE, "src/test-utils/index.ts"))) {
  errors.push("MISSING: src/test-utils/index.ts（G-1 测试基础设施 helper 缺失）");
}
// 2. 首个组件测试存在（G-1 ④）
if (!fs.existsSync(path.join(FE, "src/views/app-tree/app-tree.state.test.ts"))) {
  errors.push("MISSING: src/views/app-tree/app-tree.state.test.ts（G-1 首个组件测试缺失）");
}

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