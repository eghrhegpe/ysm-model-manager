# YSM 知识库全量体检报告

> 体检时间: 2026-07-05
> 体检对象: docs/knowledge/ 下 142 张知识卡（150 个文件，含 8 个生成物）
> 体检维度: 漂移状态 / 源码覆盖率 / Feature 完整性 / Perf 标签 / 快速路由

---

## 一、总体健康评分

| 指标 | 状态 | 评分 |
|------|------|------|
| **漂移检查** | 0 ERROR, 0 WARN | 🟢 优秀 |
| **索引同步** | 已是最新 | 🟢 优秀 |
| **Go 包覆盖率** | 31/31 顶层包全覆盖 | 🟢 优秀 |
| **前端目录覆盖率** | 12/13 一级目录覆盖（仅 web-spike 缺失，实验目录无需建卡） | 🟢 良好 |
| **Feature 分类** | 7 张卡中仅 5 张是真正业务功能，3 个核心功能完全空白 | 🟡 偏弱 |
| **Perf 标签覆盖率** | 8/142 = 5.6%（建议提升至 41 张 = 28.9%） | 🔴 严重缺失 |
| **Routes-quick 覆盖率** | 5 张卡 / 3 个场景分组（应有 6 个 category） | 🟡 偏弱 |

**综合评级: 🟡 良好, 但存在三个需关注的薄弱点**

---

## 二、🟢 亮点

1. **Go 端全覆盖** — `go/` 下 31 个包（avatar, cli, config, container, dedup, download, executil, fileops, fsutil, geometry, importer, installer, instance, launcher, litematic, logs, packs, paths, recycle, repoaudit, rustbridge, scanner, sync, tags, texture_cache, threejs, types, updater, version, watcher, ysm）每个都被至少一张知识卡的 source_files 覆盖
2. **0 漂移** — 卡间引用和卡→源码引用均无断链
3. **Tier 分布合理** — 91 architecture : 51 leaf（~64:36），架构层与叶子层配比健康

---

## 三、🟡 中等风险

### 3.1 覆盖粒度不足（不是盲区，是粗粒度）

| 区域 | 问题 | 严重程度 |
|------|------|---------|
| `go/sync/` | 26 文件仅有宽路径 `go/sync/` 覆盖，缺冲突/硬链接/递归合并等核心文件的精确引用 | ⚠️ 中 |
| `frontend/src/preview-3d/` | 25+ 渲染管线文件（camera-setup, mesh-builder, spec-builder, render-budget 等）仅有宽路径覆盖 | ⚠️ 中 |
| `features/community/` | 16 文件（含 download-queue-store 15KB）仅有宽路径覆盖 | ⚠️ 中 |

### 3.2 Feature 分类覆盖不足

| 空白功能 | 对应源码 |
|---------|---------|
| **同步 / 整合包** | `views/app-sync-manager/` + `app-sidebar/` + `core/handlers/sync.ts` |
| **预览设置 / 显示控制** | `views/app-preview/screenshot.ts` 等 |
| **3D 控制器** | `views/app-preview/mmd-controls.ts` / `vrm-controls.ts` / `ysm-controls.ts` |

另有 **搜索/筛选编排、截图导出、文件管理、动画播放** 4 个功能分散在 ui/core/utils 分类中，缺 feature 层编排卡。

### 3.3 Routes-quick 覆盖偏窄

仅 3 个场景分组（后端桥接、扫描、3D 预览），缺失 3 个 category（config, core, ui, feature, utils 大部分场景）。

---

## 四、🔴 严重问题

### 4.1 Perf 标签大面积缺失

138/142 张卡未标注 `perf` 字段。建议新增标注的 33 张卡按维度分类:

| 维度 | 新增建议数量 | 累计（含已有） | 代表卡 |
|------|-------------|----------------|--------|
| `io-bound` | 20 | 24 | go-sync, go-fileops, go-fsutil, go-watcher, go-importer, go-recycle, go-packs, go-ysm-parser, go-avatar, go-dedup, go-instance, go-installer, go-geometry, go-tags, go-logs, go-updater, go-repoaudit, community-feature, version-updater |
| `gpu-bound` | 6 | 7 | model3d, preview_core, scene_capability_registry, render-federation, utils-export |
| `cpu-bound` | 10 | 14 | model2d, ysm-baked, ysm-anim-pipeline, bone-tools, ik_solver, perception, mc-ao-tint, go-threejs, app_content_diagnostics |
| `concurrent` | 4 | 8 | mount-preview-module-singleton-race, worker-bridge-settleerror-fallback, go-threejs, app_content_diagnostics |
| `memory-heavy` | 3 | 4 | wasm-memory-pitfalls, go-geometry, go-repoaudit, utils-export |
| `single-thread` | 1 | 3 | go-avatar-decode |

**覆盖率预测**: 5.6% → **28.9%**（8→41 张），提升约 23 个百分点。

未建议标注的卡类型: 纯 UI 组件（dialog-*, dom-*, context-menu, theme, app-sidebar 等）、纯工具函数（utils-*, core_utils 等）、纯配置（resource-registry, page-store 等）、纯协议/架构文档（pointer-events, classify-routing 等）、纯审计/分析卡片（frontend_repo_audit, cli_quality_audit 等）。

---

## 五、行动建议优先级

### 🔴 立即行动（本周）

| # | 行动 | 方式 | 预估改动量 |
|---|------|------|-----------|
| 1 | 补 Top 10 路由的 `quick_*` frontmatter | 在对应知识卡 frontmatter 添加 quick_groups/quick_intents/quick_risk_lines/pitfalls | ~10 张卡，每卡 5-10 行 |
| 2 | 补 33 张卡的 perf 标签 | 在对应知识卡 frontmatter 添加 perf 字段 | ~33 张卡，每卡 2-4 行 |

### 🟡 计划行动（本月）

| # | 行动 | 预估改动量 |
|---|------|-----------|
| 3 | 新建 `sync-manager` feature 卡 | 1 张新卡 |
| 4 | 新建 `preview-settings` feature 卡 | 1 张新卡 |
| 5 | 新建 `preview-controls` feature 卡 | 1 张新卡 |
| 6 | 为 `go/sync/` 补充精确 source_files | 修改 go-sync.md 的 source_files |
| 7 | 新建 `search` feature 编排卡 | 1 张新卡 |

### 🟢 维护行动（持续）

| # | 行动 |
|---|------|
| 8 | 清理 `utils/async/`、`utils/cache/` 空目录残留 |
| 9 | 为 `features/community/` 6 个核心文件补精确引用 |
| 10 | 为 `preview-3d/` 渲染管线 25 个文件补充覆盖 |

---

## 六、Top 5 最高价值新卡

| # | kind | name | category | 理由 |
|---|------|------|----------|------|
| 1 | `sync-manager` | 仓库同步 sync-manager | feature | 最大业务空白，多仓库+整合包是导航中枢 |
| 2 | `preview-settings` | 预览设置 preview-settings | feature | 预览页设置侧完全空白 |
| 3 | `preview-controls` | 3D 预览控制器 preview-controls | feature | MM/VRM/YSM 三种控制器是核心 UX |
| 4 | `search` | 搜索筛选编排 search | feature | 三路搜索缺 feature 层编排卡 |
| 5 | `export` | 截图导出 export | feature | 从"我要截图"用户视角串联全流程 |

---

## 七、Top 10 最高频缺失路由（routes-quick 补充）

| 排名 | 用户意图 | 首选卡 | Category |
|------|----------|--------|----------|
| 1 | 发事件 / 跨组件通信 | event-bus | core |
| 2 | 右键菜单 / 添加菜单项 | context-menu | ui |
| 3 | 加翻译 / i18n 国际化 | i18n | core |
| 4 | 弹窗 / 确认框 / modal | dialog-modal | ui |
| 5 | 标签编辑 / 打标签 | go-tags | go |
| 6 | 文件移动复制删除 | go-fileops | go |
| 7 | 截图导出 / PNG 导出 | utils-export | utils |
| 8 | 回收站 / 软删除 / 恢复 | go-recycle | go |
| 9 | 新增资源类型 / 改 registry | resource-registry | config |
| 10 | YSM 烘焙 / BlockBench 导出 | ysm-baked | utils |

---

## 八、Perf 标签建议全清单

### IO-bound（20 张）
go-sync, go-fileops, go-fsutil, go-watcher, go-importer, go-recycle, go-packs, go-ysm-parser, go-avatar, go-avatar-decode, go-dedup, go-instance, go-installer, go-geometry, go-tags, go-logs, go-updater, go-repoaudit, community-feature, version-updater, app-sync-manager, app-modules, import-queue, recycle-bin, oldest-models

### GPU-bound（6 张）
model3d, preview_core, mount3d-584-giant, scene_capability_registry, render-federation, preview_panel_declarative

### CPU-bound（10 张）
model2d, ysm-baked, ysm-anim-pipeline, bone-tools, ground_surface_spec, ik_solver, perception, mc-ao-tint, go-threejs, app_content_diagnostics

### Concurrent（4 张）
mount-preview-module-singleton-race, worker-bridge-settleerror-fallback, go-threejs, app_content_diagnostics

### Memory-heavy（3 张独有）
wasm-memory-pitfalls, go-geometry, go-repoaudit, utils-export

### Single-thread（1 张）
go-avatar-decode
