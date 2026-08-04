# 项目结构地图

> **自动生成**：目录结构由 `node scripts/gen-project-map.mjs` 扫描磁盘 + 合并基线
> `scripts/baseline/project-dirs.json` 的用途说明。改目录结构后运行脚本刷新；
> `--check` 已接入 `doctor.mjs` 防漂移。目录用途是人工知识，维护在基线 JSON。

## Go 端

<!-- GEN: go-structure -->

| 包 | 用途 |
|----|------|
| `avatar/` | 创作者头像提取与缓存 |
| `dedup/` | 文件去重检测（纯函数，不绑回收站/UI） |
| `download/` | 纯下载逻辑（不依赖 Wails runtime） |
| `errors/` | 用户友好的中文错误信息 |
| `fileops/` | 文件操作 + 预览提取 + 包信息（ADR-003 P3 下沉） |
| `fsutil/` | 目录遍历工具（WalkDir 集中管理） |
| `geometry/` | Bedrock Geometry JSON 解析（ZIP/7z 提取，防炸弹限制） |
| `importer/` | 资源导入策略接口与内置实现 |
| `installer/` | 模型安装 |
| `instance/` | 整合包实例同步状态组装（ADR-003 补充下沉） |
| `litematic/` | Litematica 投影文件 (.litematic) 解析与预览数据 |
| `logs/` | 导入日志 |
| `packs/` | 资源包元数据读取（pack.mcmeta / 光影包 lang / 资源类型检测） |
| `paths/` | 路径安全 |
| `recycle/` | 回收站管理 |
| `scanner/` | 模型扫描 + 作者提取 + 仓库索引（ADR-003 P2 Logic Sinking） |
| `sync/` | 整合包同步 |
| `tags/` | 模型标签持久化存储 |
| `threejs/` | 3D 骨骼计算（对齐 YSMViewer 口径） |
| `types/` | 共享类型 + 注册表 |
| `updater/` | 自动更新 |
| `version/` | 版本号 |
| `watcher/` | 文件监听 |
| `ysm/` | YSM 解析 + 摘要 |

<!-- /GEN: go-structure -->

## internal（Wails Binding 入口）

<!-- GEN: internal-structure -->

| 包 | 用途 |
|----|------|
| `app/` | Wails Binding 入口（app.go / resource_bindings.go） |
| `embedded/` | 内嵌资源（updater helper 等） |

<!-- /GEN: internal-structure -->

## 前端

<!-- GEN: frontend-structure -->

| 路径 | 用途 |
|------|------|
| `components/` | Web Components（app-content / app-preview / app-tree / app-sidebar / app-resource-manager / app-sync-manager / app-nav / app-toast / context-menu） |
| `core/` | 基础设施（buttons / global-handlers / theme / context-menus） |
| `css/` | 共享样式（shared-styles） |
| `dialogs/` | 弹窗（modal / rename / batch-rename / tag-editor） |
| `features/` | 业务功能（import-queue / recycle-bin / version-updater / community） |
| `services/` | 服务注册（registry.ts） |
| `utils/` | 工具函数（display / fmt / dom / icon / summarize / model3d） |
| `wails/` | Wails 桥接（app.ts） |
| `wasm/` | WASM 生成数据（base64 豁免文件） |
| `app-modules.ts` | 组件入口 + 右键菜单映射 |
| `bus.ts` | 事件总线 |
| `test-utils.ts` | 测试公共辅助（组件编排测试复用：sleep/mount/unmount） |

<!-- /GEN: frontend-structure -->

## 根级文件

<!-- GEN: root-files -->

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | AI 入口手册（硬约束 + 导航） |
| `cli_export.go` | CLI 模式构建入口（build tag: cli） |
| `creators.json` | 创作者数据 |
| `embed.go` | 内嵌资源声明（embed 文件系统） |
| `main.go` | 程序入口（薄壳，GUI 构建） |
| `opencode.json` | opencode 配置 |
| `README.md` | 项目说明（面向用户） |
| `resource_types.json` | 资源类型单一事实来源（注册表优先） |
| `wails.json` | Wails 配置 |
| `workshop_sites.json` | 工坊站点配置 |
| `workshop-github.json` | 工坊 GitHub 关联 |

<!-- /GEN: root-files -->
