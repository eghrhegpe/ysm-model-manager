---
layout: home

hero:
  name: YSM 模型管理器
  text: Minecraft YSM 模型的一站式管理工具
  tagline: 像 Steam 创意工坊一样管理你的 YSM 模型 — 导入、预览、分类、同步到整合包，一站完成
  image:
    src: /preview/模型仓库.png
    alt: YSM 模型管理器
  actions:
    - theme: brand
      text: 用户指南
      link: /guide/
    - theme: alt
      text: 发版记录
      link: /releases/

features:
  - icon: 📦
    title: 模型仓库
    details: 树形浏览、启用/禁用、搜索排序、3D 预览
  - icon: 🎮
    title: 整合包管理
    details: 版本列表、同步状态、快捷安装
  - icon: 🎨
    title: 创作者频道
    details: 创作者浏览、渐变头像、预设搜索
  - icon: 🧩
    title: 创意工坊
    details: GitHub 在线仓库列表、一键下载
  - icon: 📄
    title: 发版记录
    details: 各版本发布说明（版本表见索引页）
    link: /releases/
  - icon: 🔧
    title: 维护手册
    details: 文档网站构建发布 + 文档体系维护（开发者向）
    link: /maintenance

---

## 🚀 快速开始

1. **下载**：前往 [GitHub Releases](https://github.com/eghrhegpe/ysm-model-manager/releases) 下载最新 `YSM-Model-Manager_windows_amd64.zip`
2. **解压**：解压到任意目录（如 `D:\YSM-Model-Manager\`）
3. **首次配置**：启动程序 → 设置游戏根目录（`.minecraft` 文件夹）→ 设置模型仓库路径
4. **开始使用**：把模型文件放入仓库目录，或通过拖拽导入

> 📖 详细操作见 [用户指南](./guide/index.md)

**技术栈**：Go (Wails v3) + 原生 HTML/CSS/JS (Web Components + Shadow DOM) + Three.js + YSMParser WASM
**平台支持**：✅ Windows (amd64) · ⚠️ macOS (实验性) · ❓ Linux (待验证)
