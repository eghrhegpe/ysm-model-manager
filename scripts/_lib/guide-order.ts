/**
 * guide-order.ts — 用户指南语义顺序与分组（gen-docs-index / gen-vitepress-sidebar 共用）。
 *
 * 单一事实来源：docs/guide/ 各篇文件名。新增指南页时：
 *   1. 加入 GUIDE_ORDER 对应位置（控制索引表与侧边栏顺序；未列出按字母序沉底）
 *   2. 加入 GUIDE_GROUPS 对应分组（侧边栏收纳 + 索引表分组表头；未分组归「其他」并告警）
 *
 * 顺序原则：新手高频在前——入门 → 核心功能 → 整理维护 → 设置体验 → 疑难排查。
 */

/** 全量语义顺序（索引表 + 侧边栏组内共用）；未列出的按字母序追加沉底。 */
export const GUIDE_ORDER = [
  // ── 🚀 入门 ──
  'install.md',
  'first-setup.md',
  // ── 📚 核心功能 ──
  'repository.md',
  'import-model.md',
  'import-queue.md',
  '3d-preview.md',
  'pack-sync.md',
  'resource-packs.md',
  'creators.md',
  'workshop.md',
  'download-queue.md',
  'blueprint-preview.md',
  // ── 🧹 整理与维护 ──
  'tags.md',
  'batch-rename.md',
  'model-dedup.md',
  'repo-health.md',
  'oldest-models.md',
  'recycle-bin.md',
  // ── ⚙️ 设置与体验 ──
  'settings.md',
  'themes.md',
  'advanced-filter.md',
  'keyboard-shortcuts.md',
  'update.md',
  'backup-migration.md',
  // ── 🩺 疑难排查 ──
  'faq.md',
  'diagnostics.md',
  // ── 📐 参考 ──
  'bone-tools-architecture.md',
];

/** 侧边栏 / 索引表分组（收纳）；未列出的指南页归「其他」并告警，不静默丢页。 */
export const GUIDE_GROUPS = [
  { key: '🚀 入门', items: ['install.md', 'first-setup.md'] },
  {
    key: '📚 核心功能',
    items: [
      'repository.md', 'import-model.md', 'import-queue.md', '3d-preview.md',
      'pack-sync.md', 'resource-packs.md', 'creators.md', 'workshop.md',
      'download-queue.md', 'blueprint-preview.md',
    ],
  },
  {
    key: '🧹 整理与维护',
    items: [
      'tags.md', 'batch-rename.md', 'model-dedup.md', 'repo-health.md',
      'oldest-models.md', 'recycle-bin.md',
    ],
  },
  {
    key: '⚙️ 设置与体验',
    items: [
      'settings.md', 'themes.md', 'advanced-filter.md', 'keyboard-shortcuts.md',
      'update.md', 'backup-migration.md',
    ],
  },
  { key: '🩺 疑难排查', items: ['faq.md', 'diagnostics.md'] },
  { key: '📐 参考', items: ['bone-tools-architecture.md'] },
];
