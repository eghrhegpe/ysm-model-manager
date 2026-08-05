#!/usr/bin/env node
/**
 * gen-guide-gap.mjs — 用户指南覆盖缺口扫描（适配自 MikuMikuAR）。
 *
 * 本项目无隔壁式 menu-map.md（声明式菜单 folder 面板）；事实源改用
 * frontend/src/app-modules.ts（组件统一入口）：提取注册的组件路径
 * （app-* 组件）与 register() 服务名作为「功能面」，与 docs/guide/ 页面
 * 清单对照，列出「有组件/服务但用户指南无对应页」的缺口（WARN 不阻断）。
 *
 * 背景：guide 是手写的叙事性操作手册（"怎么用"），无法机器生成正文；
 * 但缺口可见性可以自动化——新增组件/服务后，如果 guide 没有对应操作页，
 * 用户将找不到入口。本脚本把缺口列出来，供按优先级人工补写，避免
 * "功能加了、手册忘了"的静默漂移。
 *
 * 用法：
 *   node scripts/gen-guide-gap.mjs            # 扫描并输出缺口清单
 *   node scripts/gen-guide-gap.mjs --strict   # 有缺口时 exit 1（CI 可选卡点）
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 退出码：1 / 0（含失败码）
 * 设计意图：指南缺口生成器
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const APP_MODULES = path.join(ROOT, 'frontend', 'src', 'app-modules.ts');
const GUIDE_DIR = path.join(ROOT, 'docs', 'guide');

/** 已知豁免：UI 骨架/基础设施组件/内部服务，无独立操作页，不要求 guide 覆盖 */
const EXEMPT = new Set([
  'app-nav', // 导航栏骨架
  'app-toast', // Toast 反馈
  'context-menu', // 右键菜单基础设施
  'app-content', // 内容区容器（承载各页面，非独立功能）
  'app-sidebar', // 侧边栏容器（承载树/实例，非独立功能）
  'loadEntries', // 内部服务（app-tree loader）
  'loadInstances', // 内部服务（app-sidebar loader）
]);

/** settings.* 子域由 settings.md 总览页覆盖，豁免 */
const SETTINGS_OVERRIDDEN = new Set([
  'about', 'appearance', 'controls', 'downloads', 'graphics', 'media', 'resources', 'system',
]);

/** 组件名 → 实际覆盖它的 guide 页（组件名与功能页非一一对应） */
const ALIAS_COVERED = {
  'app-tree': 'repository', // 模型仓库树 → repository.md
  'app-resource-manager': 'resource-packs', // 资源包管理 → resource-packs.md
  'app-sync-manager': 'pack-sync', // 整合包同步 → pack-sync.md
};

function main() {
  const strict = process.argv.includes('--strict');

  if (!fs.existsSync(APP_MODULES) || !fs.existsSync(GUIDE_DIR)) {
    console.error('❌ app-modules.ts 或 guide/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  // 1. 提取 app-modules.ts 的功能面：组件路径（app-*）+ register 服务名
  const text = fs.readFileSync(APP_MODULES, 'utf8');
  const faces = new Set();
  // 组件路径：import "./views/app-xxx.ts" / import("./views/app-xxx/index.ts")
  for (const m of text.matchAll(/components\/(app-[a-z0-9-]+)\//g)) faces.add(m[1]);
  for (const m of text.matchAll(/components\/(app-[a-z0-9-]+)\.ts/g)) faces.add(m[1]);
  // register 服务名：register("loadInstances", ...)
  for (const m of text.matchAll(/register\(\s*"([a-z][a-zA-Z0-9]+)"/g)) faces.add(m[1]);
  const uniqueFaces = [...faces].sort();

  // 2. guide 页面名（去 .md，排除 index/README/中文总览）
  const guidePages = fs
    .readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith('.md') && !['README.md', 'index.md', '用户指南.md', '项目意义.md'].includes(f))
    .map((f) => f.replace(/\.md$/, ''));

  // 3. 对照：功能面是否被某 guide 页名包含（或反向），或命中 ALIAS_COVERED 映射
  const missing = [];
  for (const face of uniqueFaces) {
    if (EXEMPT.has(face)) continue;
    if (SETTINGS_OVERRIDDEN.has(face)) continue;
    if (ALIAS_COVERED[face]) continue; // 组件名 → 已有对应 guide 页
    const hit = guidePages.filter((p) => p.includes(face) || face.includes(p));
    if (!hit.length) missing.push(face);
  }

  console.log('用户指南覆盖缺口扫描');
  console.log('  功能面（app-modules 组件/服务）:', uniqueFaces.length, '个');
  console.log('  guide 页面:', guidePages.length, '篇');
  if (missing.length) {
    console.log(`\n🟡 ${missing.length} 个功能面无 guide 页面覆盖（建议人工补写操作页）:`);
    for (const f of missing) console.log(`   - ${f}`);
    console.log('\n  补写模板：docs/guide/ 下新建 <域>.md，frontmatter 含 title/description，');
    console.log('  正文按「它能做什么 → 打开方式 → 操作步骤 → 常见问题 → 相关功能」结构。');
    if (strict) process.exit(1);
    console.log('\n  (WARN 不阻断，加 --strict 后 CI 阻断)');
  } else {
    console.log('\n✅ 所有功能面均有 guide 页面覆盖。');
  }
  process.exit(0);
}

main();
