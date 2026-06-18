# 架构变动追踪表

> 记录每次影响架构的变更，帮助新 AI 快速理解代码库演进。
> **原则**：不写"优化性能"，写具体的改动内容和影响。

| 日期 | 改动文件                                           | 架构层级 | 影响范围       | 破坏性?      | 描述                                                                                                                                                                                                      |
| ---- | -------------------------------------------------- | -------- | -------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0614 | `app_avatar.go`                                    | Go 后端  | 头像提取       | 是(需重编译) | 新增 `DebugExtractCreatorAvatar` binding，从 .ysm 的 `model/avatar/` 提取创作者头像；批量缓存到文件系统                                                                                                   |
| 0614 | `app.go`                                           | Go 后端  | 外链/注册      | 是(需重编译) | 新增 `OpenInBrowser` binding 替换所有 `window.open`；Wails 注册 `DebugExtractCreatorAvatar`                                                                                                               |
| 0614 | `workshop-site-view.js`                            | 前端     | 创作者频道     | 是(需清缓存) | 大幅重构（+966/-238 行）：创作者卡片系统（金银铜牌/旋转动画/平台徽章）、详情浮层（果冻弹入/本地模型关联）、分类标签系统（tag 筛选/type 多选）、社区索引（三路回退）、编辑模式（搜索词排序/拖拽/原子保存） |
| 0614 | `workshop-core.js`                                 | 前端     | 数据层         | 是(需清缓存) | 从 workshop-site-view.js 拆分，独立数据层：编辑/排序/导入导出管理                                                                                                                                         |
| 0614 | `workshop-events.js`                               | 前端     | 事件层         | 是(需清缓存) | -588 行，删除重复实现，统一事件入口                                                                                                                                                                       |
| 0614 | `workshop-data.js`                                 | 前端     | 缓存层         | 否           | 缓存重构；修复 `repoModelCache` 的 `}` 缺失致 esbuild 崩溃                                                                                                                                                |
| 0614 | `creators.json`                                    | 数据     | 创作者         | 是           | 全面改造：新增 `role`(个人势/社团/官方)、`tag`(game/vup/原创/官方) 字段；`desc` 规范化；120+ 条新增                                                                                                       |
| 0614 | `workshop_sites.json`                              | 数据     | 站点           | 否           | 新增 NicoNico 立体/DeviantArt/VRoid Hub/模之屋/Bowlroll/BOOTH                                                                                                                                             |
| 0614 | `.github/workflows/release.yml`                    | CI       | GitHub Actions | 是(删除)     | 持续失败发邮件，删除                                                                                                                                                                                      |
| 0614 | `content-css.js`                                   | 前端 CSS | 主题           | 是(需清缓存) | 移出 `:host-context`；创作者频道 CSS 变量化+响应式；清理 `!important`/重复类/废弃动画                                                                                                                     |
| 0611 | `go/sync/sync.go`                                  | Go 后端  | 同步状态       | 是(需重编译) | `repoByHash` 改为 `map[string][]types.ModelEntry`，修复哈希去重导致文件误标为已同步                                                                                                                       |
| 0611 | `frontend/js/components/app-content/workshop-*.js` | 前端     | 创意工坊 CSS   | 是(需清缓存) | 所有 workshop CSS 类从 `components.css` 迁移到 `content-css.js` (Shadow DOM)                                                                                                                              |
| 0611 | `frontend/js/components/app-content/tpl.js`        | 前端     | 页面模板       | 是(需清缓存) | 仓库页共享 220px 右侧预览面板；删除 githubHTML 重复函数后重建                                                                                                                                             |
| 0611 | `frontend/js/components/app-nav.js`                | 前端     | 导航           | 否           | 宽度缩减 200→160px；移除诊断 ! 标记；仓库元老晋升主菜单                                                                                                                                                   |
| 0610 | `creators.json`                                    | 数据     | 创作者         | 否           | workshop_creators.json 重命名为 creators.json，新增 workshop_gitHub.json                                                                                                                                  |

| 日期 | 改动文件                                       | 架构层级 | 影响范围                | 破坏性?      | 描述                                                                               |
| ---- | ---------------------------------------------- | -------- | ----------------------- | ------------ | ---------------------------------------------------------------------------------- |
| 0606 | `app-content/index.js` → `features/`, `pages/` | 组件拆分 | 导入/回收站/更新/仓库页 | 否(仅重构)   | 2114 行拆为 5 个模块（主文件 1342 + 4 个业务模块），降低认知负荷                   |
| 0606 | `dialogs/modal.js`                             | 新建     | 所有弹窗                | 是(需清缓存) | 统一模态弹窗系统，替代散落的 `alert/prompt/confirm`                                |
| 0605 | `app.go` / `go/sync/sync.go`                   | Go 后端  | 文件锁定/回收站         | 是(需重编译) | 新增 `isFileLocked` 检测游戏运行时锁定文件；`CreateDir` 支持绝对路径               |
| 0605 | `frontend/wailsjs/go/main/App.js`              | Binding  | 导入覆盖                | 是(需重编译) | 新增 `ImportModelFileOverwrite` Binding                                            |
| 0605 | `go/watcher/watcher.go`                        | 新建     | .ban 自动同步           | 是(需重编译) | fsnotify 文件监听器，仓库 .ban 变更即时同步整合包                                  |
| 0605 | `go/paths/safe.go`                             | 新建     | 路径安全                | 是(需重编译) | 统一 IsInside / ContainsMinecraftMarker，替换散落各包的路径校验                    |
| 0604 | `index.html` / `bus.js`                        | 前端基建 | 全局                    | 是(需清缓存) | 统一 ESM 入口，`app-modules.js` 接管所有组件加载                                   |
| 0604 | `frontend/js/` 死代码清理                      | 清理     | 全局                    | 否           | 删除 20+ 未引用文件（`ui/`, `versions/`, `lib/`, `sync.js` 等）                    |
| 0604 | `frontend/js/dialogs/confirm.js`               | 删除     | 全局                    | 是(需清缓存) | 统一 `window.showConfirm` → `modalConfirm`，修复 9 处静默失效                      |
| 0603 | `app.go` BOM 处理                              | Go 后端  | JSON 配置读取           | 是(需重编译) | `readJSONFile` 自动去除 UTF-8 BOM，修复配置回退为默认值                            |
| 0603 | `go/sync/link_windows.go`, `link_unix.go`      | 新建     | 硬链接检测              | 是(需重编译) | platform build tag 分离硬链接检测逻辑                                              |
| 0602 | `app.go` Config 回退链                         | Go 后端  | 配置读取                | 是(需重编译) | `findConfigFile` 三级回退：exe 目录 → 父目录 → 当前目录                            |
| 0609 | `go/threejs/spec.go`                           | Go 后端  | 3D spec 生成            | 是(需重编译) | 同名骨骼保留首次层级+追加 cubes；pivot map 不覆盖；支持骨骼旋转                    |
| 0609 | `go/types/bedrock.go`                          | 类型     | Bone2D                  | 是(需重编译) | 新增 `Rotation [3]float64` 字段                                                    |
| 0609 | `app.go`                                       | Go 后端  | JSON 解析               | 是(需重编译) | parseBedrockGeometry 解析骨骼 rotation；ZIP/7z 合并改为全追加(统一委托 Build 去重) |
| 0609 | `frontend/js/utils/model3d.js`                 | 前端     | 3D 渲染                 | 否           | JS 兜底支持骨骼旋转；材质改为 `alphaTest:0.5`(代替 transparent)                    |
| 0609 | `frontend/js/components/app-preview/utils.js`  | 前端     | JSON 解析               | 否           | parseBedrockGeometryFromJSON 保留 bone.rotation                                    |
