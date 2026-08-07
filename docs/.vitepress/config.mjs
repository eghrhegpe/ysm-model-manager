// ===== VitePress 站点配置（ADR-022 迁移回 VitePress）=====
// 对标 MikuMikuAR：home layout 宣传首页 + 分区导航 + LocalSearch。
// nav 顶层仅用户向（首页/指南/发版/维护）；sidebar 按内容类型分组收纳
// （架构与规范/决策记录/知识卡/小说折叠），内部治理文档不进 nav 顶层但 URL 可直达。
import { defineConfig } from 'vitepress'
import { autoSidebar } from './sidebar.gen.mjs'

export default defineConfig({
  title: 'YSM 模型管理器',
  description: 'Minecraft YSM 模型的一站式管理工具 — 仓库管理、整合包同步、3D 预览',
  // GitHub Pages 项目页 base 路径（仓库名）
  base: '/ysm-model-manager/',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,
  // 仅排除冻结区（archive/ 为历史归档，不发布）；其余全部文档进站
  // （导航由 scripts/gen-vitepress-sidebar.mjs 自动生成，构建前先跑）
  srcExclude: ['archive/**'],
  // 内部文档引用仓库源码路径（../frontend、../scripts 等）在站点外不可达，
  // 属于文档站常态（链接在仓库内有效），跳过死链检查
  ignoreDeadLinks: true,

  // 防 FOUC 主题脚本（借鉴 reasonix.io 的 <head> 内联模式，落 VitePress 主题）。
  // 显式加固层：首帧前同步 appearance 偏好并设 color-scheme，消除自定义主题变量加载前的白屏闪烁；幂等。
  appearance: 'dark',
  transformHead() {
    const noFouc =
      "(function(){try{var k='vitepress-theme-appearance';var s=localStorage.getItem(k)||'auto';var d=s==='auto'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s;var c=d==='dark';var r=document.documentElement;r.classList.toggle('dark',c);r.style.colorScheme=c?'dark':'light';}catch(e){}})();"
    return [['script', { id: 'ysm-no-fouc' }, noFouc]]
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '用户指南', link: '/guide/' },
      { text: '发版记录', link: '/releases/' },
      { text: '维护手册', link: '/maintenance' },
    ],
    // 自动生成的全文档导航树（sidebar.gen.mjs，由 scripts/gen-vitepress-sidebar.mjs 生成）
    sidebar: autoSidebar,
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    footer: {
      message: 'YSM 模型管理器',
      copyright: 'Minecraft YSM 模型的一站式管理工具',
    },
  },
})
