#!/usr/bin/env node
/**
 * build-novel-index.ts — 小说总索引自动生成。
 *
 * 范式参考 MikuMikuAR/novel/README.md：一个文件覆盖所有子文件夹。
 * 单一事实来源 = docs/novel/ 目录树（act-* + 01..10 区域 + appendix）。
 * 产出 docs/novel/index.md，供 VitePress 站点与读者直接使用。
 *
 * 零外部依赖（node:fs / node:path + 共享层 _lib/scan-files.ts 的 ROOT）。
 * 整文件重写（index.md 全部由生成器产出，无人工段落）。
 *
 * 用法：
 *   node scripts/build-novel-index.ts          # 写入 docs/novel/index.md
 *   node scripts/build-novel-index.ts --check  # 只校验不写入，漂移时退 1
 * 设计意图：小说索引构建工具
 * 退出码：main(（失败）
 * 依赖：node:fs / node:path / 本地模块
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readText, writeText } from './_lib/scan-files.ts';

const NOVEL_DIR = path.join(ROOT, 'docs', 'novel');
const OUT_FILE = path.join(NOVEL_DIR, 'index.md');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');

// ── 区域元数据（单一事实源：docs/novel/AGENTS.md 下篇·续写宪法 §八）──────────

const REGIONS = [
  { dir: '01-解码与几何', anchor: '`go/ysm` `go/geometry` `go/threejs` `frontend/src/wasm` `app-preview`', theme: 'YSMParser WASM/CLI、格式解析、2D/3D 预览、骨骼/立方体' },
  { dir: '02-模型仓库', anchor: '`go/importer` `installer` `instance` `packs` `scanner` `dedup` `resource_types.json` `app-tree` `services`', theme: '导入/安装/实例/整合包/扫描/去重、资源注册表' },
  { dir: '03-UI器官', anchor: '`frontend/src/components` `dialogs` `features`', theme: 'Web Components、对话框、功能页、卡片 UI' },
  { dir: '04-事件中枢', anchor: '`frontend/src/core`（`bus` `global-handlers` `page-store` `context-menus` `menu-defs`）', theme: '事件总线、全局处理器、页面状态、菜单定义' },
  { dir: '05-同步与更新', anchor: '`go/sync` `download` `updater` `handler-sync`', theme: '同步、下载、更新器、进度队列' },
  { dir: '06-创作者社区', anchor: '`go/avatar` `creators.json` `workshop_sites.json` `workshop-github.json` `community`', theme: '创作者库、头像、工坊站点、社区索引' },
  { dir: '07-文件与路径', anchor: '`go/fileops` `fsutil` `paths` `recycle` `watcher` `litematic` `internal/embedded`', theme: '硬链接/复制、路径安全、回收站、监听、嵌入资源' },
  { dir: '08-配置与状态', anchor: '`go/version` `logs` `errors` `tags` `settings` `page-store`', theme: '版本、日志、错误、标签、设置持久化' },
  { dir: '09-工具链', anchor: '`scripts` `Taskfile.yml` `wails.json` `scripts/build-release.ps1` `doctor` `codemod`', theme: '自检/审计、构建发布、代码迁移工具' },
  { dir: '10-文档治理', anchor: '`AGENTS.md` `docs/knowledge` `docs/adr` `docs/archive/bug-chronicle.md` `audits`', theme: '文档宪法、知识卡、ADR、审计' },
];

const APPENDIX = [
  { dir: 'appendix/跨模块重构', theme: '多模块同时动刀的工程事件（全仓体检、逆天审计、大重构）' },
  { dir: 'appendix/Go后端', theme: 'Go 代码与 Wails 框架（`app.go` `internal/app` `main.go` 绑定 `wails.json`）' },
  { dir: 'appendix/安全横切', theme: '横切多模块的安全问题（XSS、路径穿越、权限）' },
  { dir: 'appendix/其他', theme: '原始稿存档、代码块附录' },
];

// ── 扫描 ──────────────────────────────────────────────

/**
 * 扫描某目录下所有 *.md（排除 README.md），按文件名前缀排序。
 * 返回 [{ file, rel, title, num }]。
 * num = 文件名开头数字（无则 Infinity）；title = 文件名去扩展名。
 */
function scanChapters(dir: string, regionDir: string) {
  const full = path.join(dir, regionDir);
  if (!fs.existsSync(full)) return [];
  const entries = fs.readdirSync(full, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => {
      const name = e.name;
      const m = name.match(/^(\d+)-(.+)\.md$/);
      const num = m ? parseInt(m[1]!, 10) : Infinity;
      const title = m ? m[2] : name.replace(/\.md$/, '');
      return { name, num, title };
    })
    .sort((a, b) => {
      if (a.num !== b.num) return a.num - b.num;
      // 用固定 locale（zh-Hans-CN）比较，避免跨 ICU 版本排序不稳定导致 --check 幂等误报（code_review P2-3）
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  return mdFiles;
}

/** 从章节文件抽取 H1 标题（第一行 `# xxx`）。失败回退到文件名。 */
function extractH1(dir: string, regionDir: string, fileName: string) {
  const full = path.join(dir, regionDir, fileName);
  try {
    // 用 readText 去 BOM + 统一 CRLF→LF：带 BOM 的章节文件首行 `# 标题` 才会被正则命中（code_review P2-1）
    const content = readText(full);
    const lines = content.split('\n');
    for (const line of lines) {
      const m = line.match(/^#\s+(.+?)\s*$/);
      if (m) return m[1]!;
    }
  } catch { /* fall through */ }
  return fileName.replace(/\.md$/, '');
}

// ── act-* 三部曲（冻结，固定 16 章）──────────────────

const ACTS = [
  { dir: 'act-1-babel', label: '第一幕 · 巴别塔（觉醒）', desc: '系统发现自己的器官互不理解。' },
  { dir: 'act-2-walls', label: '第二幕 · 筑墙者（激化）', desc: '系统试图筑更多墙来保护自己，每堵新墙都开了新裂缝。' },
  { dir: 'act-3-cartographer', label: '第三幕 · 绘图师（和解）', desc: '系统放弃消灭裂缝，转而绘制裂缝地图。' },
];

function buildActs() {
  const blocks: string[] = [];
  for (const act of ACTS) {
    const chapters = scanChapters(NOVEL_DIR, act.dir);
    if (chapters.length === 0) continue;
    const rows = chapters.map((c) => {
      const h1 = extractH1(NOVEL_DIR, act.dir, c.name);
      const link = `${act.dir}/${c.name}`;
      const numCol = c.num === Infinity ? '—' : c.num;
      return `| ${numCol} | [${escCell(h1)}](${link}) |`;
    });
    blocks.push(`### ${act.label}\n\n${act.desc}\n\n| 章 | 标题 |\n|----|------|\n${rows.join('\n')}`);
  }
  return blocks.join('\n\n---\n\n');
}

// ── 区域志（vol 4+）──────────────────────────────────

function buildRegions() {
  const blocks: string[] = [];
  for (const r of REGIONS) {
    const chapters = scanChapters(NOVEL_DIR, r.dir);
    const count = chapters.length;
    const rows = chapters.map((c) => {
      const h1 = extractH1(NOVEL_DIR, r.dir, c.name);
      const link = `${r.dir}/${c.name}`;
      const numCol = c.num === Infinity ? '—' : c.num;
      return `| ${numCol} | [${escCell(h1)}](${link}) |`;
    });
    const tableBody = rows.length > 0 ? rows.join('\n') : '| — | _（待续写）_ |';
    blocks.push(
      `### ${r.dir}\n\n` +
      `> 锚定代码：${r.anchor}\n` +
      `> 主题：${r.theme}\n` +
      `> 章节数：${count}\n\n` +
      `| 章 | 标题 |\n|----|------|\n${tableBody}`,
    );
  }
  return blocks.join('\n\n---\n\n');
}

// ── appendix ─────────────────────────────────────────

function buildAppendix() {
  const blocks: string[] = [];
  for (const a of APPENDIX) {
    const chapters = scanChapters(NOVEL_DIR, a.dir);
    const count = chapters.length;
    const rows = chapters.map((c) => {
      const h1 = extractH1(NOVEL_DIR, a.dir, c.name);
      const link = `${a.dir}/${c.name}`;
      const numCol = c.num === Infinity ? '—' : c.num;
      return `| ${numCol} | [${escCell(h1)}](${link}) |`;
    });
    const tableBody = rows.length > 0 ? rows.join('\n') : '| — | _（待续写）_ |';
    blocks.push(
      `### ${a.dir}\n\n` +
      `> 主题：${a.theme}\n` +
      `> 章节数：${count}\n\n` +
      `| 章 | 标题 |\n|----|------|\n${tableBody}`,
    );
  }
  return blocks.join('\n\n---\n\n');
}

// ── 统计 ─────────────────────────────────────────────

function countAll() {
  let acts = 0, regions = 0, appendix = 0;
  for (const act of ACTS) acts += scanChapters(NOVEL_DIR, act.dir).length;
  for (const r of REGIONS) regions += scanChapters(NOVEL_DIR, r.dir).length;
  for (const a of APPENDIX) appendix += scanChapters(NOVEL_DIR, a.dir).length;
  return { acts, regions, appendix, total: acts + regions + appendix };
}

// ── 渲染 ─────────────────────────────────────────────

const escCell = (x: string) => x.replace(/\|/g, '\\|');

function renderIndex() {
  const stats = countAll();
  const actsBlock = buildActs();
  const regionsBlock = buildRegions();
  const appendixBlock = buildAppendix();
  return (
`# 编码奇谭：YSM 巴别塔演义 · 目录

> 在一座由四种语言搭建的巴别塔里，每堵墙本该保护你，却在暗处开了裂缝。

> 本页由 \`scripts/build-novel-index.ts\` 自动生成（内容不含时间戳，保证 \`--check\` 幂等）。
> 单一事实来源 = \`docs/novel/\` 目录树。请勿手改；新增章节后重跑生成器。

---

## 创业三部曲（🧊 已冻结）

${actsBlock}

---

## 区域志（vol 4+ · 代码区域锚定）

> 自第四卷起改为代码区域锚定：改了代码 → 看路径 → 命中下方区域 → 更新该章尾部。
> 世界观 / 角色 / 区域归属 / 禁则，见 [AGENTS.md](AGENTS.md)（续写唯一必读，含上篇·故事圣经与下篇·续写宪法）。

${regionsBlock}

---

## 附录

${appendixBlock}

---

## 统计

| 分区 | 章节数 |
|------|--------|
| 创业三部曲（act-1/2/3） | ${stats.acts} |
| 区域志（01..10） | ${stats.regions} |
| 附录（appendix） | ${stats.appendix} |
| **合计** | **${stats.total}** |

---

## 相关文档

- [续写宪法](AGENTS.md) — 小说续写唯一必读指引（上篇·故事圣经 + 下篇·续写宪法）
`
  );
}

// ── 主流程 ───────────────────────────────────────────

function main() {
  const generated = renderIndex();
  if (CHECK) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error(`[novel-index] ✗ ${path.relative(ROOT, OUT_FILE)} 不存在，请先运行生成器`);
      return 1;
    }
    const current = readText(OUT_FILE); // 归一化 CRLF→LF：磁盘行尾不影响幂等判定
    if (current === generated) {
      console.log(`[novel-index] ✓ ${path.relative(ROOT, OUT_FILE)} 无漂移`);
      return 0;
    }
    console.error(`[novel-index] ✗ ${path.relative(ROOT, OUT_FILE)} 有漂移，请重跑生成器`);
    return 1;
  }
  writeText(OUT_FILE, generated); // 保留原行尾风格（CRLF 文件不被改写成 LF）
  const stats = countAll();
  console.log(`[novel-index] ✓ 已生成 ${path.relative(ROOT, OUT_FILE)}（共 ${stats.total} 章）`);
  return 0;
}

process.exit(main());
