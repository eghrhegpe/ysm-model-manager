# 项目结构地图

> **自动生成**：目录结构由 `node scripts/gen-project-map.mjs` 扫描磁盘生成；
> 目录用途是人工知识，直接维护在本文档的表格里（脚本从本文件读回复用，无外部基线）。
> 改目录结构后运行脚本刷新；`--check` 已接入 `doctor.mjs` 防漂移。
> 🤖 **AI 代理优先** `node scripts/gen-project-map.mjs --json` 取结构化路径（源码/测试/子目录区分，含文件清单），
> 别按表格猜路径——平铺文件（如 `features/import-dnd.ts`）不是子目录。

## Go 端

<!-- GEN: go-structure -->

| 包 | 用途 |
|----|------|
| `avatar/` | 创作者头像提取与缓存 〔源码 4: avatar.go avatar_decode.go avatar_extract.go avatar_zip.go · 测试 5〕 |
| `cli/` | CLI 命令（脱离 GUI 的模型管理/诊断/缓存操作，入口 main.go 经 cli.RunCLI 接线） 〔源码 25 · 测试 3〕 |
| `container/` | 统一容器桥接层（zip/7z/目录 Entry-Reader 抽象，ADR-068） 〔源码 1: container.go · 测试 2〕 |
| `dedup/` | 文件去重检测（纯函数，不绑回收站/UI） 〔源码 2: dedup.go strategy.go · 测试 5〕 |
| `download/` | 纯下载逻辑（不依赖 Wails runtime） 〔源码 1: download.go · 测试 6〕 |
| `executil/` | 外部进程工具（HideWindow 平台双实现，收敛自三处副本） 〔源码 2: hidewindow_other.go hidewindow_windows.go · 测试 3〕 |
| `fileops/` | 文件操作 + 预览提取 + 包信息（ADR-003 P3 下沉） 〔源码 4: fileops.go fileops_enable.go fileops_preview.go folder_import.go · 测试 10〕 |
| `fsutil/` | 目录遍历工具（WalkDir 集中管理） 〔源码 10: bom.go copy.go crossdevice_other.go crossdevice_windows.go format.go hardlink_other.go hardlink_w… · 测试 9〕 |
| `geometry/` | Bedrock Geometry JSON 解析（ZIP/7z 提取，防炸弹限制） 〔源码 3: archive.go parse.go ysm_parser.go · 测试 14 · 子目录 1: testdata/〕 |
| `importer/` | 资源导入策略接口与内置实现 〔源码 2: importer.go importer_file.go · 测试 7〕 |
| `installer/` | 模型安装 〔源码 1: installer.go · 测试 4〕 |
| `instance/` | 整合包实例同步状态组装（ADR-003 补充下沉） 〔源码 1: instance.go · 测试 1〕 |
| `internal/` | Go 内部工具（testutil 测试工具） 〔子目录 1: testutil/〕 |
| `litematic/` | Litematica 投影文件 (.litematic) 解析与预览数据 〔源码 6: block_colors.go block_ids.go block_ids_data.go nbt.go parser.go voxel.go · 测试 7 · 子目录 1: gen/〕 |
| `logs/` | 导入日志 〔源码 2: logs.go runtime.go · 测试 4〕 |
| `packs/` | 资源包元数据读取（pack.mcmeta / 光影包 lang / 资源类型检测） 〔源码 1: mcmeta.go · 测试 4 · 子目录 1: testdata/〕 |
| `paths/` | 路径安全 〔源码 1: safe.go · 测试 2〕 |
| `recycle/` | 回收站管理 〔源码 2: recycle.go recycle_clean.go · 测试 9〕 |
| `repoaudit/` | 仓库健康审计核心（GUI 绑定层与 CLI 共用，防双轨口径漂移） 〔源码 1: repoaudit.go · 测试 1〕 |
| `rustbridge/` | Windows Rust 扫描 DLL 的嵌入、校验、加载与窄 ABI 适配层 〔源码 4: bridge_windows.go doc.go embedded_windows.go types_windows.go · 子目录 1: bin/〕 |
| `scanner/` | 模型扫描 + 作者提取 + 仓库索引（ADR-003 P2 Logic Sinking） 〔源码 3: rust_backend_stub.go rust_backend_windows.go scanner.go · 测试 6〕 |
| `sync/` | 整合包同步 〔源码 8: conflict.go sync.go sync_diff.go sync_dirlevel.go sync_discovery.go sync_hash.go sync_push.go syn… · 测试 12〕 |
| `tags/` | 模型标签持久化存储 〔源码 1: tags.go · 测试 3〕 |
| `texture_cache/` | 纹理缓存管理（KTX2/PNG 缓存，支持后台编码与快速命中） 〔源码 1: texture_cache.go · 测试 2〕 |
| `threejs/` | 3D 骨骼计算（对齐 YSMViewer 口径） 〔源码 3: spec-bones.go spec-cube.go spec.go · 测试 6〕 |
| `types/` | 共享类型 + 注册表 〔源码 7: bedrock.go config.go extensions.go findinst.go location.go resource.go types.go · 测试 16〕 |
| `updater/` | 自动更新 〔源码 3: updater.go updater_other.go updater_windows.go · 测试 8〕 |
| `version/` | 版本号 〔源码 1: version.go · 测试 1〕 |
| `watcher/` | 文件监听 〔源码 1: watcher.go · 测试 2〕 |
| `ysm/` | YSM 解析 + 摘要 〔源码 8: cli.go decode_inject.go extracted.go header.go parse.go summary.go texsize.go ysm.go · 测试 15〕 |
| `ysmhub/` | YSM Hub 公开模型浏览、OAuth PKCE 登录、令牌存储与安全下载 〔源码 3: client.go oauth.go token_store.go · 测试 2〕 |

<!-- /GEN: go-structure -->

## internal（Wails Binding 入口）

<!-- GEN: internal-structure -->

| 包 | 用途 |
|----|------|
| `app/` | Wails Binding 入口（app.go / resource_bindings.go） 〔源码 39 · 测试 20〕 |

<!-- /GEN: internal-structure -->

## 前端

<!-- GEN: frontend-structure -->

| 路径 | 用途 |
|------|------|
| `backend/` | 后端适配层：Wails 绑定入口（app.ts）+ 平台判定（platform.ts）+ 浏览器适配（browser-adapter.ts）+ IndexedDB 模型库（idb.ts） 〔源码 18 · 测试 15〕 |
| `core/` | 基础设施（buttons / global-handlers / theme / context-menus） 〔源码 8: context-menu-dir-handlers.ts context-menu-file-handlers.ts context-menu-handlers.ts context-menu-… · 测试 3 · 子目录 2: handlers/ i18n/〕 |
| `features/` | 业务功能（import-queue / recycle-bin / version-updater / community） 〔源码 8: dnd-collector.ts dnd-shared.ts import-dnd.ts import-executor.ts oldest-models.ts recycle-bin.ts r… · 测试 8 · 子目录 1: community/〕 |
| `services/` | 服务注册（registry.ts） 〔源码 3: cli-bridge.ts registry.ts ysmhub.ts · 测试 3〕 |
| `test-utils/` | 测试工具（G-1 抗脆弱测试基础设施 — ADR-035 §19.1：getByTestId / getAllByTestId / waitFor） 〔源码 5: events.ts index.ts query-by-testid.ts render.ts self-healing.ts · 测试 4〕 |
| `ui/` | 🥉 ui-helpers 原生 DOM 组件库（自 MikuMikuAR 迁移：slide-row / rows / header-toggle / advanced-rows / collapsible / preset / card / loading + 自包含 CSS 模块 `ui-components-styles.ts`，经 `installUiComponentsStyles()` / `uiComponentsStyleSheet` 接入） 〔源码 18 · 子目录 1: __tests__/〕 |
| `utils/` | 工具函数（display / fmt / dom / icon / summarize / model3d） 〔源码 6: array.ts gh-links.ts main-thread-watch.ts module-loader.ts safe-error-msg.ts types-re-export.ts · 测试 3 · 子目录 8: 3d/ animation/ core/ debug/ dom/ format/ icon/ resource/〕 |
| `views/` | 页面级视图组件（app-content / app-tree / app-preview 等） 〔子目录 9: app-content/ app-nav/ app-preview/ app-resource-manager/ app-sidebar/ app-sync-manager/ app-toast/ app-tree/ context-menu/〕 |
| `wasm/` | WASM 生成数据（base64 豁免文件） 〔源码 8: ysm-glue-data-mt.js ysm-glue-data.js ysm-parser.ts ysm-wasm-data-mt.d.ts ysm-wasm-data-mt.js ysm-…〕 |
| `web-spike/` | 网页版 spike 入口（main.ts，构建/冒烟验证） 〔源码 1: main.ts〕 |
| `workers/` | Web Worker 批量统计（searchWebModels 数值条件走 Worker 线程，主线程零解析负载） 〔源码 3: stats-core.ts stats-protocol.ts stats.worker.ts · 测试 1〕 |
| `app-modules.test.ts` | app-modules 主题/隐私模式启动链测试（normalizeTheme / safeGet / initTheme / applyUIPrefs） |
| `app-modules.ts` | 组件入口 + 右键菜单映射 |
| `bus.test.ts` | 事件总线测试 |
| `bus.ts` | 事件总线 |
| `real-data-fuzz.test.ts` | 真实数据模糊测试（资源类型/schema 契约） |
| `startup-reveal.test.ts` | 首屏显示时序与幂等行为回归测试 |
| `startup-reveal.ts` | 桌面端首屏就绪后再显示窗口，避免启动阶段旧 UI 或黑色背景闪现 |
| `theme-core.ts` | 主题系统核心（normalizeTheme / applyTheme / initTheme + 隐私模式兜底） |

<!-- /GEN: frontend-structure -->

## 根级文件

<!-- GEN: root-files -->

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | AI 入口手册（硬约束 + 导航） |
| `README.md` | 项目说明（面向用户） |
| `creators.json` | 创作者数据 |
| `embed.go` | 内嵌资源声明（embed 文件系统） |
| `main.go` | 程序入口（薄壳，GUI 构建） |
| `main_test.go` | 根级测试（App 生命周期/CLI 冒烟） |
| `resource_types.json` | 资源类型注册表单一事实来源（扩展名/子目录/安装目标/预览/detector，编译期嵌入 go/types） |
| `wails.json` | Wails 配置 |
| `workshop-github.json` | 工坊 GitHub 关联 |
| `workshop_sites.json` | 工坊站点配置 |

<!-- /GEN: root-files -->
