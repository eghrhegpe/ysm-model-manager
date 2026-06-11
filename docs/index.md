---
layout: default
title: YSM 模型管理器
---

<style>
.hero {
  text-align: center;
  padding: 40px 0 30px;
}
.hero h1 {
  font-size: 2.8em;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.hero .tagline {
  font-size: 1.15em;
  color: #555;
  margin-bottom: 24px;
}
.btn-download {
  display: inline-block;
  padding: 14px 36px;
  font-size: 1.1em;
  font-weight: 600;
  color: #fff !important;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border-radius: 8px;
  text-decoration: none;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 15px rgba(102,126,234,0.4);
}
.btn-download:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102,126,234,0.5);
}
.btn-secondary {
  display: inline-block;
  padding: 10px 28px;
  font-size: 0.95em;
  font-weight: 500;
  color: #667eea !important;
  border: 2px solid #667eea;
  border-radius: 8px;
  text-decoration: none;
  margin-left: 12px;
  transition: all 0.2s;
}
.btn-secondary:hover {
  background: #667eea;
  color: #fff !important;
}
.video-wrapper {
  position: relative;
  width: 100%;
  max-width: 720px;
  margin: 32px auto;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 30px rgba(0,0,0,0.15);
}
.video-wrapper iframe {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin: 24px 0;
}
.feature-card {
  padding: 20px;
  border: 1px solid #e1e4e8;
  border-radius: 10px;
  background: #f6f8fa;
  transition: transform 0.2s, box-shadow 0.2s;
}
.feature-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
}
.feature-card h3 {
  margin-top: 0;
  font-size: 1.05em;
}
.feature-card p {
  margin-bottom: 0;
  font-size: 0.92em;
  color: #586069;
}
.screenshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.screenshot-grid a {
  display: block;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e1e4e8;
  transition: transform 0.2s, box-shadow 0.2s;
}
.screenshot-grid a:hover {
  transform: scale(1.02);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.screenshot-grid img {
  width: 100%;
  display: block;
}
.links-section {
  text-align: center;
  padding: 28px 0;
}
.links-section a {
  margin: 0 10px;
}
.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.82em;
  font-weight: 600;
  margin-right: 6px;
}
.badge-green { background: #2ea04322; color: #2ea043; }
.badge-blue  { background: #0969da22; color: #0969da; }
.badge-purple{ background: #8250df22; color: #8250df; }
.badge-orange{ background: #d4920b22; color: #d4920b; }
.badge-red   { background: #cf222e22; color: #cf222e; }
footer {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid #e1e4e8;
  text-align: center;
  color: #586069;
  font-size: 0.88em;
}
</style>

<div class="hero">

# 🧱 YSM 模型管理器

<div class="tagline">
Minecraft YSM 模型的一站式管理工具<br>
仓库管理 · 整合包同步 · 3D 预览 · 冲突检测
</div>

<a class="btn-download" href="https://github.com/eghrhegpe/ysm-model-manager/releases" target="_blank">⬇️ 下载最新版本</a>
<a class="btn-secondary" href="https://github.com/eghrhegpe/ysm-model-manager" target="_blank">📦 GitHub 仓库</a>

</div>

---

## 🎬 功能介绍

<div class="video-wrapper">
<iframe src="https://player.bilibili.com/player.html?bvid=BV1vWEK6dEav&page=1&autoplay=0&high_quality=1" allowfullscreen></iframe>
</div>

---

## ✨ 核心特性

<div class="feature-grid">

<div class="feature-card">
<h3>📦 模型仓库管理</h3>
<p>以目录结构管理你的所有 YSM 模型，支持拖放导入、重命名、批量操作、筛选排序。仓库目录实时监听，文件变动自动同步。</p>
</div>

<div class="feature-card">
<h3>🎮 整合包同步</h3>
<p>自动检测所有 Minecraft 整合包，一眼看清每个包的同步状态——已同步、缺失、额外、禁用。一键安装缺失模型，同步启用/禁用状态。</p>
</div>

<div class="feature-card">
<h3>🔍 冲突与诊断</h3>
<p>扫描仓库中同名文件和重复哈希，检测整合包冲突。去重助手帮你保留一份、删除冗余，释放磁盘空间。</p>
</div>

<div class="feature-card">
<h3>🖼️ 3D 预览</h3>
<p>基于 Three.js 的内置 3D 渲染器，直接在应用内预览 YSM 模型骨骼结构。支持多纹理渲染、正确 UV 映射、骨骼层级展示。</p>
</div>

<div class="feature-card">
<h3>🌐 创作者频道</h3>
<p>内置创作者数据库（87+ 位作者），快速浏览各创作者的模型作品。支持自定义站点源，爱发电、工坊链接一键直达。</p>
</div>

<div class="feature-card">
<h3>♻️ 回收站安全</h3>
<p>删除的模型移入回收站而非直接删除。智能处理符号链接、硬链接、跨分区场景，`ensureInDir()` 防路径遍历攻击。</p>
</div>

<div class="feature-card">
<h3>🔄 多种安装模式</h3>
<p>支持复制、硬链接、符号链接三种安装方式。硬链接节省磁盘空间，符号链接适合跨仓库管理。自动检测跨分区并降级为复制。</p>
</div>

<div class="feature-card">
<h3>⚙️ 高度可配置</h3>
<p>支持 4 套主题（赛博朋克、暖阳、原版、深色），自定义仓库根目录和 Minecraft 目录，下载镜像源切换，自动更新。</p>
</div>

</div>

---

## 📸 界面预览

<div class="screenshot-grid">

<a href="preview/模型仓库.png" target="_blank">
  <img src="preview/模型仓库.png" alt="模型仓库页面" loading="lazy">
</a>

<a href="preview/整合包管理.png" target="_blank">
  <img src="preview/整合包管理.png" alt="整合包管理页面" loading="lazy">
</a>

<a href="preview/创作者频道.png" target="_blank">
  <img src="preview/创作者频道.png" alt="创作者频道页面" loading="lazy">
</a>

<a href="preview/创意工坊.png" target="_blank">
  <img src="preview/创意工坊.png" alt="创意工坊页面" loading="lazy">
</a>

</div>

---

## 📥 下载

| 版本         | 下载                                                                                                  | 说明                     |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------ |
| **最新版**   | [YSM-Model-Manager_windows_amd64.zip](https://github.com/eghrhegpe/ysm-model-manager/releases/latest) | Windows 64-bit，解压即用 |
| **全部版本** | [GitHub Releases](https://github.com/eghrhegpe/ysm-model-manager/releases)                            | 含发版说明和更新日志     |

### 系统要求

- **操作系统**: Windows 10 / Windows 11（64-bit）
- **依赖**: [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 10 1803+ 内置）
- **Minecraft**: 任意支持 YSM 模组（Yes Steve Model）的版本
- **磁盘空间**: 约 150 MB（应用）+ 模型文件空间

### 快速开始

1. 下载最新版 ZIP 并解压
2. 双击 `YSM-Model-Manager.exe` 启动
3. 在设置页面配置 **游戏根目录** 和 **仓库目录**
4. 将模型文件放入仓库目录，开始管理！

> 📖 详细教程请参阅 [用户指南](用户指南.md)

---

## 🛠️ 技术栈

<span class="badge badge-green">Go</span>
<span class="badge badge-blue">Wails v2</span>
<span class="badge badge-purple">WebView2</span>
<span class="badge badge-orange">Three.js</span>
<span class="badge badge-red">Vite</span>
<span class="badge badge-blue">WASM</span>

YSM 模型管理器基于 **Wails v2** 构建，Go 后端负责文件系统操作、YSM 解析、哈希计算、同步引擎；前端使用原生 JavaScript + Web Components + Shadow DOM 实现组件化。YSM 解析器编译为 WASM 内嵌在前端，无需外部依赖。

---

## 📄 文档

- [用户指南](用户指南.md) — 完整的使用教程
- [架构说明](architecture.md) — 项目架构与技术设计
- [发版说明](release-notes/) — 各版本更新详情
- [项目意义](项目意义.md) — 开发背后的故事

---

<div class="links-section">

<a class="btn-secondary" href="https://github.com/eghrhegpe/ysm-model-manager/releases" target="_blank">⬇️ 下载</a>
<a class="btn-secondary" href="https://github.com/eghrhegpe/ysm-model-manager" target="_blank">💻 源码</a>
<a class="btn-secondary" href="用户指南.md">📖 指南</a>
<a class="btn-secondary" href="https://www.bilibili.com/video/BV1vWEK6dEav/" target="_blank">▶️ 视频</a>

</div>

<footer>
Made with 🧱 by eghrhegpe &nbsp;·&nbsp; 2026 &nbsp;·&nbsp;
<a href="https://github.com/eghrhegpe/ysm-model-manager/blob/main/LICENSE">MIT License</a>
</footer>
