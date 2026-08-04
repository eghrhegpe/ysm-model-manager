// ===== VitePress 站点配置（ADR-022 迁移回 VitePress）=====
// 对标 MikuMikuAR：home layout 宣传首页 + 分区导航 + LocalSearch。
// 内部治理文档（adr/knowledge/novel/app 等）不进导航，文件保留（URL 可直达）。
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'YSM 模型管理器',
  description: 'Minecraft YSM 模型的一站式管理工具 — 仓库管理、整合包同步、3D 预览',
  // GitHub Pages 项目页 base 路径（仓库名）
  base: '/ysm-model-manager/',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,
  // 排除内部治理文档（冻结区/决策/知识卡/小说/开发者向），不进站点（对标 Jekyll exclude）
  srcExclude: [
    'archive/**',
    'adr/**',
    'knowledge/**',
    'novel/**',
    'app/**',
    'Design.md',
    'architecture.md',
    'governance-rules.md',
    'pitfalls.md',
    'review-report.md',
    'funcmap.md',
    'project-map.md',
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '用户指南', link: '/guide/' },
      { text: '发版记录', link: '/releases/' },
      { text: '维护手册', link: '/maintenance' },
    ],
    // 极简 sidebar：分区入口（分区内全量链接见各分区 index 页）
    sidebar: {
      '/guide/': [
        {
          text: '用户指南',
          collapsed: false,
          items: [{ text: '索引', link: '/guide/index' }],
        },
      ],
      '/releases/': [
        {
          text: '发版记录',
          collapsed: false,
          items: [{ text: '版本索引', link: '/releases/README' }],
        },
      ],
      '/maintenance': [
        {
          text: '维护手册',
          collapsed: false,
          items: [{ text: '概览', link: '/maintenance' }],
        },
      ],
    },
    search: { provider: 'local' },
    footer: {
      message: 'YSM 模型管理器',
      copyright: 'Minecraft YSM 模型的一站式管理工具',
    },
  },
})
