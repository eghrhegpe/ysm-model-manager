# 函数映射表

| 文件 | 行 | 签名 | 注释 |
|------|----|------|------|
| app.go | 32 | `func (a *App) ysmRoot` | repoRoot 动态返回 YSM 模型存储根目录（始终从配置推导，无需手动维护缓存） |
| app.go | 115 | `func (a *App) OpenInBrowser` | OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌） |
| app.go | 120 | `func (a *App) GetAppVersion` | GetAppVersion 返回当前版本号 |
| app_avatar.go | 20 | `func creatorAvatarCacheDir` | creatorAvatarCacheDir 头像缓存目录（exe 同目录下的 creators_cache/） |
| app_avatar.go | 26 | `func (a *App) CachedCreatorAvatar` | CachedCreatorAvatar 检查缓存中是否有作者头像，返回 data URI |
| app_avatar.go | 39 | `func (a *App) BatchExtractCreatorAvatars` | BatchExtractCreatorAvatars 批量提取所有有本地模型的创作者头像 |
| app_avatar.go | 91 | `func (a *App) DebugExtractCreatorAvatar` | DebugExtractCreatorAvatar 调试版：提取指定作者头像，返回详细步骤信息 |
| app_avatar.go | 147 | `func (a *App) decodeOneAvatar` | decodeOneAvatar 从模型文件中提取指定所有者的头像 |
| app_avatar.go | 151 | `type authorEntry` | 读取 ysm.json 获取作者→头像路径映射 |
| app_avatar.go | 330 | `func readFileFromZip` | readFileFromZip 从 ZIP 读取指定路径的文件 |
| app_avatar.go | 352 | `func (a *App) CacheModelAvatars` | CacheModelAvatars 从解压目录的 ysm.json 读取所有作者头像，缓存到 creators_cache/ |
| app_avatar.go | 395 | `func safeFilename` | safeFilename 安全文件名 |
| app_avatar.go | 404 | `func decodeYSMFiles` | decodeYSMFiles 底层解码，复用 Node.js + WASM，返回完整文件列表 |
| app_config.go | 148 | `func (a *App) GetSubDirMap` | GetSubDirMap 返回资源类型→子目录映射表（前端右键菜单等场景使用） |
| app_config.go | 194 | `func getVirtualScreen` | getVirtualScreen 获取 Windows 虚拟屏幕边界（所有显示器合起来的矩形） |
| app_download.go | 23 | `type QueueStatusInfo` | QueueStatusInfo 队列状态（替代多返回值，Wails 自动映射为 JS object） |
| app_download.go | 29 | `type DownloadTask` | DownloadTask 下载队列任务 |
| app_download.go | 37 | `type DownloadQueue` | DownloadQueue 串行下载队列 |
| app_download.go | 311 | `func (a *App) GetModelTexSizes` | GetModelTexSizes 扫描仓库文件提取纹理尺寸（轻量级，不解析完整模型） |
| app_files.go | 261 | `func (a *App) CopyModelFile` | CopyModelFile 将 src 复制到 dstDir 目录下（保留原文件名） |
| app_install.go | 97 | `func (a *App) DetectZipType` | DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用） |
| app_install.go | 185 | `func detectZipType` | detectZipType 通过 ZIP 内容检测真实资源类型（资源包/光影包/YSM） |
| app_install.go | 274 | `func (a *App) findRecycleRoot` | findRecycleRoot 查找包含 src 路径的资源根目录（用于多类型回收） |
| app_install.go | 351 | `func (a *App) CountInstanceResources` | CountInstanceResources 统计指定整合包中可清空的资源文件数 |
| app_install.go | 390 | `func (a *App) ClearInstanceResources` | ClearInstanceResources 清空指定整合包中已同步的文件（走回收站） |
| app_install.go | 437 | `func (a *App) countInstanceDir` | countInstanceDir 递归统计指定目录中的文件数（不限扩展名） |
| app_install.go | 442 | `func (a *App) countMatchingInDir` | countMatchingInDir 统计实例目录中与仓库同名的文件数（仅用于清空提示） |
| app_install.go | 457 | `func isResourcePackFolder` | isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta） |
| app_install.go | 464 | `func (a *App) clearInstanceDir` | clearInstanceDir 只删除仓库中已有的文件，跳过整合包自带的资源 |
| app_install.go | 594 | `func (a *App) allRecycleRoots` | allRecycleRoots 返回所有配置了路径的资源根目录 |
| app_install.go | 619 | `func (a *App) GetResourceInstanceStatus` | GetResourceInstanceStatus 按资源类型获取整合包同步状态 |
| app_install.go | 722 | `func (a *App) RelinkCustomDir` | RelinkCustomDir 重新应用链接模式到指定目录（兼容旧版） |
| app_install.go | 736 | `func (a *App) relinkDir` | relinkDir 重新应用链接模式到单个目录 |
| app_install.go | 794 | `func (a *App) RelinkAllInstanceResources` | RelinkAllInstanceResources 重新应用链接模式到整合包所有资源类型目录 |
| app_install.go | 829 | `func (a *App) SyncResources` | SyncResources 获取全局 ↔ 整合包的资源同步状态 |
| app_install.go | 862 | `func (a *App) PushResourceToInstance` | PushResourceToInstance 将全局中缺失的资源推送到整合包 |
| app_install.go | 913 | `func (a *App) PullResourceFromInstance` | PullResourceFromInstance 将整合包中多余的资源拉取到全局 |
| app_install.go | 989 | `func (a *App) PullSingleResourceFromInstance` | PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库 |
| app_install.go | 1040 | `func (a *App) PushSingleResourceToInstance` | PushSingleResourceToInstance 推送单个文件/文件夹到整合包 |
| app_install.go | 1075 | `func (a *App) GetInstanceSyncStatus` | GetInstanceSyncStatus 获取整合包下所有资源类型的同步状态（扁平列表） |
| app_model.go | 129 | `func (a *App) SaveScreenshotFile` | SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用） |
| app_scan.go | 81 | `func (a *App) ExportModelStructureJSON` | ExportModelStructureJSON 导出单模型骨骼结构 |
| app_scan.go | 171 | `func (a *App) GenerateRepoIndex` | GenerateRepoIndex 扫描仓库目录，生成 index.json |
| app_scan.go | 277 | `type progressReader` | progressReader 包装 io.Reader，下载时通过回调推送进度 |
| app_scan.go | 317 | `func (a *App) ClearScanCache` | ClearScanCache 清除扫描缓存（下载/导入后调用） |
| app_scan.go | 394 | `func InvalidateScanCache` | InvalidateScanCache 清空扫描缓存（同步完成后调用，确保下次扫描取最新数据） |
| app_scan.go | 402 | `func computeFileHash` | computeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配） |
| app_scan.go | 470 | `func (a *App) ListAllFilePaths` | ListAllFilePaths 递归列出指定目录下的所有文件完整路径（不限制扩展名） |
| app_scan.go | 481 | `func (a *App) ScanLocalAuthors` | ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者 |
| app_scan.go | 486 | `type scanTarget` | 定义要扫描的目录和对应的类型标签 |
| app_scan.go | 565 | `func (a *App) OpenInstanceFolder` | OpenInstanceFolder 按资源类型打开整合包子目录；目录不存在时回退到实例根目录 |
| app_tags.go | 12 | `func (a *App) configDir` | configDir 返回应用配置目录（%APPDATA%/YSM-Model-Manager/） |
| app_tags.go | 21 | `func (a *App) getTagsStore` | getTagsStore 初始化或获取标签存储实例（懒加载） |
| app_tags.go | 29 | `func (a *App) GetModelTags` | GetModelTags 返回指定模型文件的所有标签 |
| app_tags.go | 34 | `func (a *App) SetModelTags` | SetModelTags 设置指定模型文件的标签列表（覆盖写入） |
| app_tags.go | 39 | `func (a *App) ListByTag` | ListByTag 返回所有打了指定标签的文件路径列表 |
| app_tags.go | 44 | `func (a *App) AllTags` | AllTags 返回所有被使用的标签（按使用次数降序） |
| app_workshop.go | 19 | `func atomicWrite` | atomicWrite 原子写入：写 tmp → rename，防崩溃半写 |
| app_workshop.go | 117 | `func (a *App) SaveWorkshopCreatorsBySite` | SaveWorkshopCreatorsBySite 只替换指定站点的创作者，其他站点不动 |
| app_workshop.go | 133 | `func (a *App) SaveWorkshopPresetsBySite` | SaveWorkshopPresetsBySite 只替换指定站点的搜索词，其他站点不动 |
| cli_export.go | 717 | `func hasMolangInJSON` | hasMolangInJSON 检测动画 JSON 字符串中是否包含 Molang 表达式 |
| cmd\updater\main.go | 80 | `func copyFile` | copyFile 复制文件（保留原始文件在出错时不变） |
| frontend\js\app-modules.js | 42 | `const THEME_DARK` | ===== 全局主题控制 ===== |
| frontend\js\app-modules.js | 68 | `async function initTheme` | 从 Go 配置或 localStorage 加载主题 */ |
| frontend\js\app-modules.js | 83 | `function applyUIPrefs` | 应用 UI 偏好（字号/字体/密度/动画），不依赖设置页打开 */ |
| frontend\js\app-modules.js | 100 | `const scaleMap` | 通过 --fs-scale 控制字号缩放（与设置页 community-settings.js 一致） |
| frontend\js\app-modules.js | 171 | `const _devMode` | 通过查询参数 ?dev=1 或 localStorage 标志启用 |
| frontend\js\bus.js | 7 | `function createBus` | 创建一个新 bus 实例 */ |
| frontend\js\bus.js | 41 | `const bus` | 默认实例（组件直接使用） */ |
| frontend\js\bus.js | 44 | `export function setBus` | 替换 bus 实例（入口层 / 测试用） */ |
| frontend\js\components\app-content\community\core.js | 9 | `export async function loadCommunityData` | 加载站点 + 创作者数据（纯数据，不碰 DOM） |
| frontend\js\components\app-content\community\core.js | 51 | `async function tryAutoMergeCommunity` | 后台静默拉取社区索引并合并 */ |
| frontend\js\components\app-content\community\core.js | 60 | `const siteMap` | 按站点分组，逐站点原子保存 |
| frontend\js\components\app-content\community\core.js | 79 | `export const fillSearch` | 替换 {{q}} 为查询词 |
| frontend\js\components\app-content\community\core.js | 87 | `export async function fetchCommunityCreators` | 从 GitHub 社区索引拉取 creators.json |
| frontend\js\components\app-content\community\core.js | 143 | `export function mergeCommunityCreators` | 合并社区索引到本地 creators.json |
| frontend\js\components\app-content\community\core.js | 179 | `export async function fetchCommunitySites` | 从 GitHub 拉取 workshop_sites.json（三路回退） |
| frontend\js\components\app-content\community\core.js | 235 | `export function mergeCommunitySites` | 合并社区站点到本地 workshop_sites.json |
| frontend\js\components\app-content\community\core.js | 253 | `export const DEFAULT_COMMUNITY_URL` | 社区索引的默认 URL（可配置为社区维护的独立 creators JSON） |
| frontend\js\components\app-content\community\core.js | 259 | `export async function getRepoModelsData` | 获取仓库模型列表 + 本地映射 |
| frontend\js\components\app-content\community\diagnostics.js | 12 | `export function initDiagnostics` | 初始化诊断页所有功能 |
| frontend\js\components\app-content\community\diagnostics.js | 41 | `const activePanel` | 重启入场动画 |
| frontend\js\components\app-content\community\diagnostics.js | 63 | `const logSearch` | 日志搜索 |
| frontend\js\components\app-content\community\diagnostics.js | 85 | `const activeBtn` | 读筛选状态 |
| frontend\js\components\app-content\community\diagnostics.js | 164 | `const targets` | 收集目标目录 |
| frontend\js\components\app-content\community\diagnostics.js | 183 | `const allResults` | 逐目录扫描 |
| frontend\js\components\app-content\community\diagnostics.js | 348 | `const scanBtn` | 扫描按钮雷达动画 |
| frontend\js\components\app-content\community\diagnostics.js | 427 | `function buildHeatmap` | 构建年度热力图数据 */ |
| frontend\js\components\app-content\community\diagnostics.js | 429 | `const dayMap` | 按天统计活动次数 |
| frontend\js\components\app-content\community\diagnostics.js | 437 | `const today` | 生成过去 364 天的网格 (52周×7天) |
| frontend\js\components\app-content\community\diagnostics.js | 451 | `const weeks` | 按周分组 (52列×7行) |
| frontend\js\components\app-content\community\diagnostics.js | 461 | `const monthLabels` | 月份标签 (每4周一个) |
| frontend\js\components\app-content\community\diagnostics.js | 471 | `function fmtSize` | 👴 资历最深 + 📊 仓库评分 + 🎲 每日推荐 + 热力图 */ |
| frontend\js\components\app-content\community\settings.js | 11 | `export async function initSettings` | 初始化设置页所有事件绑定 |
| frontend\js\components\app-content\community\settings.js | 24 | `const reg` | 从 Go 端 resource_types.json 加载注册表 |
| frontend\js\components\app-content\community\settings.js | 27 | `const _cardRefreshers` | 所有路径卡片的刷新函数列表 |
| frontend\js\components\app-content\community\settings.js | 30 | `function bindPathClick` | 工具：绑定路径卡片点击 |
| frontend\js\components\app-content\community\settings.js | 57 | `const saveCfg` | 保存 cfg 辅助（保留各字段原值） |
| frontend\js\components\app-content\community\settings.js | 92 | `const advancedTypes` | 从注册表构建高级设置条目 |
| frontend\js\components\app-content\community\settings.js | 235 | `const detectBtn` | 游戏路径 - 自动搜索 |
| frontend\js\components\app-content\community\settings.js | 387 | `const savedTheme` | 主题卡片：直接点击切换 |
| frontend\js\components\app-content\community\settings.js | 398 | `const autoSelect` | 关闭自动切换 |
| frontend\js\components\app-content\community\settings.js | 406 | `const savedAuto` | 自动切换下拉框 |
| frontend\js\components\app-content\community\settings.js | 438 | `function applyTimeTheme` | 时间段主题切换 |
| frontend\js\components\app-content\community\settings.js | 445 | `const savedMirror` | 镜像源 |
| frontend\js\components\app-content\community\settings.js | 479 | `const updateLinkHint` | 链接模式提示切换 |
| frontend\js\components\app-content\community\settings.js | 488 | `const doRelink` | 链接模式变更（下拉菜单）+ 重新应用按钮 |
| frontend\js\components\app-content\community\settings.js | 553 | `const showVersion` | 显示版本号 |
| frontend\js\components\app-content\community\settings.js | 577 | `const applyUIPref` | 读取/应用 UI 偏好（localStorage） |
| frontend\js\components\app-content\community\settings.js | 595 | `const scaleMap` | 小=-1px, 标准=0px, 大=+2px |
| frontend\js\components\app-content\community\settings.js | 612 | `const padding` | 卡片密度 |
| frontend\js\components\app-content\community\settings.js | 628 | `const resolvePx` | 解析 CSS 变量的计算像素值（getComputedStyle 对 calc() 返回原始表达式， |
| frontend\js\components\app-content\community\settings.js | 640 | `const updateSizePreview` | 读取当前 --fs-* 和 --space-* 的计算值并显示 |
| frontend\js\components\app-content\community\settings.js | 647 | `const basePx` | 按钮高示例：secondary 按钮 = padding-v(space-sm) * 2 + font-size * 1.4 |
| frontend\js\components\app-content\community\site-view.js | 31 | `function createCrCard` | ===== 创作者卡片工厂 ===== |
| frontend\js\components\app-content\community\site-view.js | 124 | `const authorCountMap` | 作者模型计数查找表 |
| frontend\js\components\app-content\community\site-view.js | 187 | `const faved` | 收藏置顶 |
| frontend\js\components\app-content\community\site-view.js | 195 | `const tagSet` | 收集所有标签 |
| frontend\js\components\app-content\community\site-view.js | 369 | `const emptyLocalBtn` | 无创作者时「浏览本地模型」按钮 |
| frontend\js\components\app-content\community\site-view.js | 377 | `const grid` | 用工厂函数填充创作者网格（替代内联字符串） |
| frontend\js\components\app-content\community\site-view.js | 418 | `const grid` | 重新排序：收藏→移到首部，取消→移到尾部（不 remove 以免丢失事件） |
| frontend\js\components\app-content\community\site-view.js | 560 | `const cardStar` | 同时更新卡片 |
| frontend\js\components\app-content\community\site-view.js | 586 | `const localBtn` | 📦 查看本地模型 |
| frontend\js\components\app-content\community\site-view.js | 597 | `const crGrid` | 键盘导航 ←↑↓→ |
| frontend\js\components\app-content\community\site-view.js | 634 | `const refreshView` | 📦 浏览 GitHub 仓库模型 |
| frontend\js\components\app-content\community\site-view.js | 859 | `const siteCreators` | 按站点保存 — 只传当前站点的创作者 |
| frontend\js\components\app-content\community\site-view.js | 882 | `const dropZone` | ===== 拖拽 JSON 导入创作者/站点配置 ===== |
| frontend\js\components\app-content\community\site-view.js | 940 | `const fresh` | 刷新内存中的 allCreators |
| frontend\js\components\app-content\community\site-view.js | 1026 | `const clearDragState` | 拖拽状态清理：防止 JS 异常后 class 卡死在 DOM 上 |
| frontend\js\components\app-content\community\workshop-data.js | 8 | `export const PLATFORM_NAMES` | ===== 站点名称映射 ===== |
| frontend\js\components\app-content\community\workshop-data.js | 20 | `export function getCreatorIdentity` | ===== 创作者身份识别 ===== |
| frontend\js\components\app-content\community\workshop-data.js | 47 | `export function parseDescTags` | ===== 描述标签解析 ===== |
| frontend\js\components\app-content\community\workshop-data.js | 57 | `export function loadFavs` | ===== 收藏工具 ===== |
| frontend\js\components\app-content\community\workshop-icons.js | 3 | `export const ICONS` | 统一管理所有角色和平台的矢量图标 |
| frontend\js\components\app-content\index.js | 149 | `const savedWidth` | 从 localStorage 恢复宽度 |
| frontend\js\components\app-content\index.js | 209 | `const root` | 资源类型 subtab 切换（全局生效） |
| frontend\js\components\app-content\index.js | 302 | `const _unsub` | 全局类型切换时自动重复 |
| frontend\js\components\app-content\index.js | 402 | `const showCreatorsBySite` | B站/爱发电 tab 点击 → 在右侧显示对应站点的创作者（不打开网站） |
| frontend\js\components\app-content\index.js | 423 | `const tabsEl` | 动态生成 Tab |
| frontend\js\components\app-content\index.js | 437 | `const last` | 恢复上次选中的 tab |
| frontend\js\components\app-content\index.js | 476 | `const openSite` | 卡片点击 → 正文切换右侧视图，右侧 ↗ 按开关打开 |
| frontend\js\components\app-content\index.js | 488 | `const PROXY_PORT` | 内嵌浏览 |
| frontend\js\components\app-content\index.js | 564 | `const showSiteView` | ===== 右栏：JSON驱动的站点视图 ===== |
| frontend\js\components\app-content\index.js | 594 | `const toggleBtn` | 外链/内嵌切换（按钮在 renderSiteView 中动态渲染） |
| frontend\js\components\app-content\index.js | 627 | `const showRepoModels` | 📦 显示 GitHub 仓库模型列表（比对本地已有文件） |
| frontend\js\components\app-content\index.js | 652 | `const dlPrefix` | 选 jsDelivr 时下载优先走 CDN；选 GitHub API 时走 raw（Go 端内部会按配置回退） |
| frontend\js\components\app-content\index.js | 700 | `const listContainer` | 初始渲染 |
| frontend\js\components\app-content\index.js | 823 | `const openBtn` | 绑定打开 GitHub 按钮 |
| frontend\js\components\app-preview\index.js | 26 | `const urls` | geometry.textures 数组中的 blob URL |
| frontend\js\components\app-preview\index.js | 121 | `const cached` | 查缓存（模块级，跨组件生命周期持久） |
| frontend\js\components\app-preview\preview-actions.js | 7 | `function setGlobalButtonsEnabled` | 设置全局按钮启用/禁用 */ |
| frontend\js\components\app-preview\preview-actions.js | 19 | `export function resetGlobalButtons` | 恢复全局按钮文字和启用状态 */ |
| frontend\js\components\app-preview\preview-actions.js | 44 | `export function bindActions` | 绑定预览面板操作按钮（导入/上传/同步/日志/卡片） */ |
| frontend\js\components\app-preview\preview-actions.js | 46 | `const btnImport` | ===== 全局操作栏 ===== |
| frontend\js\components\app-preview\preview-actions.js | 72 | `const logToggle` | ===== 日志展开/折叠 ===== |
| frontend\js\components\app-preview\preview-actions.js | 98 | `const logSearch` | 日志搜索 |
| frontend\js\components\app-preview\preview-bone-export.js | 9 | `export function setupBoneExport` | 在容器底部添加 "📋 导出骨骼名" 按钮 |
| frontend\js\components\app-preview\preview-detail.js | 11 | `export async function showModelDetail` | 显示模型详情（YSM 模型） */ |
| frontend\js\components\app-preview\preview-detail.js | 95 | `export async function showResourcePack` | 显示资源包信息（pack.mcmeta + pack.png） */ |
| frontend\js\components\app-preview\preview-detail.js | 119 | `export async function showShaderPack` | 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 */ |
| frontend\js\components\app-preview\preview-litematic-3d.js | 55 | `const sep` | 分层渲染分隔 |
| frontend\js\components\app-preview\preview-litematic-3d.js | 179 | `const chunkMap` | 按空间分块：同色方块分散到各 chunk，每个 chunk 独立 InstancedMesh |
| frontend\js\components\app-preview\preview-litematic-3d.js | 208 | `const rawGroups` | 分层渲染逻辑 |
| frontend\js\components\app-preview\preview-litematic-meta.js | 58 | `export async function showLitematic` | 显示投影文件详情面板（tab 布局） */ |
| frontend\js\components\app-preview\preview-litematic-meta.js | 75 | `const switchTab` | Tab 切换 |
| frontend\js\components\app-preview\preview-litematic-meta.js | 92 | `const btn3dTab` | 3D tab 按钮 |
| frontend\js\components\app-preview\preview-loader.js | 12 | `export async function loadModelData` | 加载模型几何数据 + 纹理 + 作者信息 |
| frontend\js\components\app-preview\preview-loader.js | 20 | `const cached` | 查缓存 |
| frontend\js\components\app-preview\preview-logs.js | 9 | `export function loadLogsPreview` | 加载日志到预览面板（含筛选和搜索） */ |
| frontend\js\components\app-preview\preview-logs.js | 18 | `const activeBtn` | 读取筛选状态 |
| frontend\js\components\app-preview\preview-pack.js | 32 | `export function showPackageDetail` | 更新预览面板显示整合包详情 */ |
| frontend\js\components\app-preview\preview-pack.js | 49 | `const nameEl` | 头部：包名 + 状态指示灯 |
| frontend\js\components\app-preview\preview-pack.js | 71 | `const syncedNum` | 三张状态卡片（带数字跳动） |
| frontend\js\components\app-preview\preview-pack.js | 79 | `const isMmd` | MMD 类型：变体聚合显示 |
| frontend\js\components\app-preview\preview-pack.js | 95 | `function renderFlatLists` | 渲染普通的扁平列表（非 MMD 类型） */ |
| frontend\js\components\app-preview\preview-pack.js | 120 | `function renderMmdVariantLists` | 渲染 MMD 类型的变体聚合列表。 |
| frontend\js\components\app-preview\preview-pack.js | 122 | `const syncedEl` | 已同步列表保持扁平的逐文件显示（不聚合） |
| frontend\js\components\app-preview\preview-pack.js | 189 | `export function registerMmdEvents` | 注册 MMD 变体的事件委托（折叠头 + 同步按钮）。 |
| frontend\js\components\app-preview\preview-pack.js | 196 | `const hdr` | 折叠头事件 |
| frontend\js\components\app-preview\preview-pack.js | 207 | `const btn` | 同步按钮事件 |
| frontend\js\components\app-preview\preview-skeleton.js | 12 | `export async function loadModel2D` | 加载模型 2D 骨骼线条图 + 统计面板 |
| frontend\js\components\app-preview\preview-skeleton.js | 28 | `const loaded` | 统一加载：缓存 → WASM → Go 兜底 |
| frontend\js\components\app-preview\preview-skeleton.js | 44 | `const canvas` | ---- 模型轨迹图 ---- |
| frontend\js\components\app-preview\preview-skeleton.js | 62 | `const toggleRow` | ---- 骨骼名开关 + 放大按钮 ---- |
| frontend\js\components\app-preview\preview-skeleton.js | 77 | `const zoomBtn` | 放大按钮 |
| frontend\js\components\app-preview\preview-skeleton.js | 92 | `const authors` | 作者列表（从 ysm.json 解析） |
| frontend\js\components\app-preview\preview-skeleton.js | 102 | `const avatarContainer` | 同步填充详情页的作者头像区 |
| frontend\js\components\app-preview\preview-skeleton.js | 180 | `const boneRow` | ---- 导出骨骼名按钮 ---- |
| frontend\js\components\app-preview\preview-skeleton.js | 330 | `const modelSel` | 模型选择下拉（多 section 时显示） |
| frontend\js\components\app-preview\preview-skeleton.js | 371 | `const body` | 主体：左 3D 视图 + 右信息面板 |
| frontend\js\components\app-preview\preview-skeleton.js | 382 | `const resizeHandle` | 面板宽度拖拽柄 |
| frontend\js\components\app-preview\preview-skeleton.js | 396 | `const sec` | 辅助函数 |
| frontend\js\components\app-preview\preview-skeleton.js | 400 | `const panelToggle` | 折叠按钮 |
| frontend\js\components\app-preview\preview-skeleton.js | 428 | `const mg` | 填充面板 |
| frontend\js\components\app-preview\preview-skeleton.js | 459 | `const mgCount` | 模型选择器 |
| frontend\js\components\app-preview\preview-skeleton.js | 474 | `const boneList` | 骨骼：搜索 + 全显/全隐 + 缩进列表 |
| frontend\js\components\app-preview\preview-skeleton.js | 492 | `const searchInput` | 搜索框 |
| frontend\js\components\app-preview\preview-skeleton.js | 498 | `const depthMap` | 构建层级深度映射 |
| frontend\js\components\app-preview\preview-skeleton.js | 594 | `const btn3d` | 接线 🎨 3D tab 按钮 |
| frontend\js\components\app-preview\preview-utils.js | 5 | `export const devLog` | DEV 模式下输出调试日志 */ |
| frontend\js\components\app-preview\preview-utils.js | 21 | `export function buildStdYsgpFromTextVariant` | 将带 UTF-8 BOM + 文本头部的 YSGP 变体重建为标准 YSGP 二进制格式 |
| frontend\js\components\app-preview\preview-utils.js | 31 | `const tagMatch` | 找到文本头部结束位置（从 "> 文件内容" 或 "</ysm>" 后） |
| frontend\js\components\app-preview\preview-utils.js | 58 | `const encryptedStart` | V3: 二进制段 = 纯加密数据（hash 仅在 <hash> 标签中） |
| frontend\js\components\app-preview\preview-utils.js | 76 | `export function stripYsgpTextHeader` | 剥离 YSGP 文本头部，返回标准二进制格式 |
| frontend\js\components\app-preview\preview-wasm.js | 16 | `export async function decodeYsmViaWasm` | 通过前端 WASM 解码 .ysm，返回 { texture, geometry, animations } |
| frontend\js\components\app-preview\preview-wasm.js | 199 | `const textures` | 收集所有纹理文件（同时收集头像） |
| frontend\js\components\app-preview\preview-wasm.js | 284 | `const modelTexIdxMap` | 构建模型文件→纹理索引映射 |
| frontend\js\components\app-preview\preview-wasm.js | 489 | `const animations` | 解析动画 |
| frontend\js\components\app-preview\preview-wasm.js | 516 | `function parseYsmJsonDirect` | 直接解析纯 JSON 格式的 ysm.json（解压后的 YSM 模型文件） */ |
| frontend\js\components\app-preview\preview-wasm.js | 520 | `const playerFiles` | 从 files.player.model 提取 geometry 信息 |
| frontend\js\components\app-preview\preview-wasm.js | 535 | `const authors` | 解析作者信息（用于头像显示） |
| frontend\js\components\app-preview\preview-wasm.js | 560 | `const root` | 标准 Bedrock geometry 格式（minecraft.geometry） |
| frontend\js\components\app-preview\preview-zoom.js | 4 | `export async function openFullPreview` | 全窗放大预览（独立函数，不依赖组件实例） */ |
| frontend\js\components\app-preview\render.js | 4 | `export function updateDisplay` | 更新所有统计 DOM */ |
| frontend\js\components\app-preview\tpl.js | 4 | `export function statsHTML` | 整合包详情面板（stat mode） */ |
| frontend\js\components\app-preview\tpl.js | 59 | `export function modelDetailHTML` | 模型详情面板（仓库页面） */ |
| frontend\js\components\app-preview\tpl.js | 104 | `export function statsCardHTML` | 模型统计卡片 */ |
| frontend\js\components\app-preview\utils.js | 6 | `export function parseBedrockGeometryFromJSON` | 从 JSON 字符串解析 Bedrock geometry */ |
| frontend\js\components\app-preview\utils.js | 30 | `const texSlot` | 每个方块可指定纹理槽索引（YSMViewer 据此区分主纹理与发光/覆盖层） |
| frontend\js\components\app-preview\utils.js | 32 | `const toArr` | 统一对象→数组格式（某些导出工具输出 {x,y,z} 对象而非数组） |
| frontend\js\components\app-resource-manager\index.js | 223 | `const searchInput` | 搜索过滤 |
| frontend\js\components\app-resource-manager\index.js | 239 | `const type` | 从 resource_types.json 获取当前类型的扩展名列表 |
| frontend\js\components\app-resource-manager\index.js | 247 | `const baseName` | .disabled 后缀处理：去后缀后判断扩展名 |
| frontend\js\components\app-resource-manager\index.js | 271 | `const searchInput` | 如果有搜索关键字，应用过滤 |
| frontend\js\components\app-resource-manager\index.js | 328 | `const descs` | 取前几条 option 描述作为简介 |
| frontend\js\components\app-resource-manager\index.js | 363 | `const type` | 从配置读取 isDir 字段，文件夹型资源（如 mmd-skin/vrchat-avatar）删整个目录 |
| frontend\js\components\app-resource-manager\tpl.js | 11 | `export function sidebarHTML` | 侧栏布局（路径 + 操作栏 + 列表） |
| frontend\js\components\app-resource-manager\tpl.js | 53 | `export function itemHTML` | 列表项 HTML |
| frontend\js\components\app-resource-manager\tpl.js | 90 | `export function detailHTML` | 详情面板 HTML |
| frontend\js\components\app-resource-manager\tpl.js | 146 | `export function placeholderHTML` | 空状态占位 |
| frontend\js\components\app-sidebar\actions.js | 6 | `export function bindInstanceActions` | 绑定整合包卡片中的操作按钮和缺失条目点击事件 */ |
| frontend\js\components\app-sidebar\data.js | 4 | `export function fallbackInstances` | Go 不可用时的后备模拟数据 |
| frontend\js\components\app-sidebar\events.js | 43 | `const rect` | 涟漪效果：记录点击坐标，触发涟漪动画 |
| frontend\js\components\app-sidebar\events.js | 49 | `const idx` | 发送选中事件 |
| frontend\js\components\app-sidebar\events.js | 101 | `function restoreSelectedCard` | 根据 localStorage 选中最匹配的整合包 */ |
| frontend\js\components\app-sidebar\events.js | 121 | `export function bindFooter` | 绑定底部按钮 + 路径显示 |
| frontend\js\components\app-sidebar\events.js | 137 | `const paths` | 没设置时自动检测：用第一个有效路径 |
| frontend\js\components\app-sidebar\index.js | 12 | `const _checkedSet` | 持久化勾选状态（跨重新渲染保持） |
| frontend\js\components\app-sidebar\index.js | 37 | `const btn` | 更新导入按钮文字 |
| frontend\js\components\app-sidebar\index.js | 112 | `const closeAllMenus` | 关闭所有下拉菜单 |
| frontend\js\components\app-sidebar\loader.js | 14 | `export async function loadInstances` | 从 Go 加载整合包实例列表，转换为 render 需要的格式 */ |
| frontend\js\components\app-sidebar\loader.js | 23 | `const rawInstances` | 获取整合包列表 |
| frontend\js\components\app-sidebar\loader.js | 27 | `const rtypeActual` | 只按当前资源类型查询同步状态 |
| frontend\js\components\app-sidebar\loader.js | 123 | `function groupMmdVariants` | 对 MMD 类型，按父文件夹聚合 .pmx 变体文件。 |
| frontend\js\components\app-sidebar\loader.js | 130 | `const key` | 单层路径，无父文件夹 |
| frontend\js\components\app-sidebar\loader.js | 137 | `const parent` | 父文件夹路径（去掉最后一级文件名） |
| frontend\js\components\app-sidebar\loader.js | 148 | `const missingGroups` | 生成聚合后的组列表 |
| frontend\js\components\app-sidebar\render.js | 5 | `export function renderVersionCards` | 渲染所有整合包卡片到容器 |
| frontend\js\components\app-sidebar\tpl.js | 48 | `export function skeletonHTML` | 加载骨架屏 */ |
| frontend\js\components\app-sidebar\tpl.js | 61 | `export function vcHeaderHTML` | 单个整合包卡片头部。 |
| frontend\js\components\app-sync-manager\index.js | 81 | `const unsub` | 监听刷新 |
| frontend\js\components\app-sync-manager\index.js | 160 | `const typeCounts` | — 类型统计 — |
| frontend\js\components\app-sync-manager\index.js | 188 | `const renderGroup` | — 类型标签（分组：模型类 | 资源类）— |
| frontend\js\components\app-sync-manager\index.js | 224 | `const curCounts` | — 状态筛选标签 — |
| frontend\js\components\app-sync-manager\tpl.js | 8 | `export function containerHTML` | 容器骨架 |
| frontend\js\components\app-sync-manager\tpl.js | 47 | `export function statusTabHTML` | 状态筛选标签 HTML |
| frontend\js\components\app-sync-manager\tpl.js | 72 | `export function itemHTML` | 列表项 HTML |
| frontend\js\components\app-sync-manager\tpl.js | 136 | `export function emptyHTML` | 空状态 HTML |
| frontend\js\components\app-sync-manager\tpl.js | 150 | `export function loadingHTML` | 加载中 |
| frontend\js\components\app-tree\authors.js | 7 | `export async function loadAuthors` | 从 Go 端加载作者列表 |
| frontend\js\components\app-tree\data.js | 4 | `export const selectState` | 多选状态 |
| frontend\js\components\app-tree\data.js | 14 | `export function toggleSelect` | 切换选中状态（支持 Ctrl/Shift） |
| frontend\js\components\app-tree\events.js | 16 | `export function updateSelectCount` | 更新底部"已选 N 个文件"统计（被工具栏复用，避免重复实现） |
| frontend\js\components\app-tree\events.js | 29 | `function collectDirEntries` | 递归收集文件夹下所有条目 |
| frontend\js\components\app-tree\events.js | 87 | `export function bindTreeEvents` | ——— 事件委托：一次性绑定，虚拟滚动替换 innerHTML 后仍然有效 ——— |
| frontend\js\components\app-tree\events.js | 91 | `const fhCk` | 文件夹开关 |
| frontend\js\components\app-tree\events.js | 99 | `const fh` | 文件夹展开/折叠 |
| frontend\js\components\app-tree\events.js | 116 | `const flCk` | 文件开关 |
| frontend\js\components\app-tree\events.js | 136 | `const haPreview` | 悬停快捷操作（在文件选中前检查，因为它们也在 .fl 内部） |
| frontend\js\components\app-tree\events.js | 162 | `const haCopy` | 悬停快捷操作：📋 复制文件名 |
| frontend\js\components\app-tree\events.js | 177 | `const fl` | 左键点击文件 → 多选 |
| frontend\js\components\app-tree\events.js | 253 | `const selectedPaths` | 获取当前选中的文件路径列表 |
| frontend\js\components\app-tree\events.js | 275 | `const banned` | 单个文件菜单 |
| frontend\js\components\app-tree\index.js | 51 | `const treeEl` | 事件委托绑定（只一次，虚拟滚动换 innerHTML 仍有效） |
| frontend\js\components\app-tree\index.js | 187 | `const repoBtn` | 仓库路径显示在按钮上 |
| frontend\js\components\app-tree\instance-actions.js | 21 | `export function initInstanceActions` | 安装模型到整合包：打开文件选择器 -> 导入 |
| frontend\js\components\app-tree\instance-actions.js | 30 | `const cfg` | 获取整合包目录 |
| frontend\js\components\app-tree\instance-actions.js | 124 | `const insNames` | 下载仓库有但整合包没有的 |
| frontend\js\components\app-tree\loader.js | 12 | `export async function loadEntries` | 从 Go 后端加载仓库文件列表，返回格式化的 entries */ |
| frontend\js\components\app-tree\loader.js | 21 | `const exts` | 按类型过滤扩展名（防止共享仓库中混入其他类型的文件） |
| frontend\js\components\app-tree\loader.js | 32 | `const bannedResults` | 并发检查禁用状态 |
| frontend\js\components\app-tree\render.js | 20 | `const RENDER_MODE_KEY` | localStorage key for render mode |
| frontend\js\components\app-tree\render.js | 23 | `export function getRenderMode` | Get render mode from localStorage, default to 'grid' */ |
| frontend\js\components\app-tree\render.js | 33 | `export function setRenderMode` | Set render mode to localStorage */ |
| frontend\js\components\app-tree\render.js | 40 | `function buildTree` | ——— 树构建（与原版一致） ——— |
| frontend\js\components\app-tree\render.js | 97 | `function dirEntries` | 收集文件夹下所有条目 */ |
| frontend\js\components\app-tree\render.js | 134 | `const e` | — 文件行 — |
| frontend\js\components\app-tree\render.js | 139 | `const entryKey` | selectState.keys 存的是 data-fullpath（绝对路径），必须用 e.fullPath 匹配 |
| frontend\js\components\app-tree\render.js | 143 | `const html` | 根据模式选择模板 |
| frontend\js\components\app-tree\render.js | 164 | `const isLocked` | — 文件夹行 — |
| frontend\js\components\app-tree\render.js | 170 | `const html` | 根据模式选择模板 |
| frontend\js\components\app-tree\render.js | 209 | `function renderSlice` | ——— 仅渲染可见行的 HTML，用 padding 撑出滚动高度 ——— |
| frontend\js\components\app-tree\render.js | 212 | `const range` | 首次渲染时容器可能还没布局（clientHeight=0），全量渲染 |
| frontend\js\components\app-tree\render.js | 236 | `function _cleanupVS` | 断开虚拟滚动相关监听 */ |
| frontend\js\components\app-tree\render.js | 309 | `export function updateStat` | ——— 选中计数用（兼容旧接口） ——— |
| frontend\js\components\app-tree\row-tpl-list.js | 5 | `export function listFileRowHTML` | 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） */ |
| frontend\js\components\app-tree\row-tpl-list.js | 21 | `export function listFolderRowHTML` | 文件夹行 HTML（紧凑列表模式：arrow + folder icon + name） */ |
| frontend\js\components\app-tree\row-tpl.js | 5 | `export function fileRowHTML` | 文件行 HTML（indent = padding-left，rowCls 用于选中高亮等行级类） */ |
| frontend\js\components\app-tree\row-tpl.js | 34 | `export function folderRowHTML` | 文件夹行 HTML（indent = padding-left，扁平化无 .ch 容器） */ |
| frontend\js\components\app-tree\toolbar-events.js | 14 | `async function openAdvFilterDialog` | 打开弹窗版筛选器（应用结果到 inline 面板 + 后端搜索） |
| frontend\js\components\app-tree\toolbar-events.js | 35 | `const setVal` | 统一回填 inline 面板（null/undefined → ""） |
| frontend\js\components\app-tree\toolbar-events.js | 87 | `const hasRange` | 2. 按骨骼/纹理等条件搜索（如果有关键词或范围条件） |
| frontend\js\components\app-tree\toolbar-events.js | 165 | `function fillAuthorMenu` | 填充作者下拉（hover 或 click 都触发，避免鼠标快速点击时未填充） |
| frontend\js\components\app-tree\toolbar-events.js | 193 | `export function bindToolbarEvents` | 绑定工具栏事件 |
| frontend\js\components\app-tree\toolbar-events.js | 198 | `const selAllBtn` | 全选 / 反选 — 基于当前过滤后可见的行 |
| frontend\js\components\app-tree\toolbar-events.js | 255 | `const viewModeBtn` | 视图模式切换（grid ⇄ list） |
| frontend\js\components\app-tree\toolbar-events.js | 269 | `const advBtn` | 高级筛选按钮：触发弹窗版筛选器 |
| frontend\js\components\app-tree\toolbar-events.js | 298 | `const menuAuthors` | 作者下拉菜单 — hover 或 click 都触发填充（避免快速点击时未填充） |
| frontend\js\components\app-tree\toolbar-events.js | 312 | `const menuBatch` | 批量按钮下拉菜单 |
| frontend\js\components\app-tree\toolbar-events.js | 325 | `const menuMore` | 「⋮ 更多」下拉菜单 |
| frontend\js\components\app-tree\toolbar-events.js | 341 | `const exts` | 列出所有支持的扩展名（后端 SelectImportFile 用 | 解析 "显示名|*.ext1;*.ext2"） |
| frontend\js\components\app-tree\toolbar-events.js | 373 | `const errMsg` | 后端 ImportByType → SimpleCopyImporter / DirectoryCopyImporter 都判 info.IsDir()，目录/文件都支持 |
| frontend\js\components\app-tree\utils.js | 4 | `export function flashBtn` | 按钮闪烁反馈 |
| frontend\js\components\app-tree\virtual-scroll.js | 3 | `export const ROW_H_GRID` | 支持动态行高：grid=28px, list=24px |
| frontend\js\components\app-tree\virtual-scroll.js | 14 | `export function calcVisibleRange` | 根据滚动位置计算可见行范围（支持动态行高） |
| frontend\js\components\app-tree\virtual-scroll.js | 27 | `export function installScrollSync` | 在容器上安装滚动监听，当滚动到新范围时自动重新渲染可见行 |
| frontend\js\core\context-menus.js | 7 | `function refreshUI` | 通知树组件和统计面板刷新 */ |
| frontend\js\core\context-menus.js | 13 | `function toast` | 显示 toast 通知 */ |
| frontend\js\core\global-handlers.js | 11 | `export function registerGlobalHandlers` | 注册所有全局 handler，返回 unsub 函数数组 */ |
| frontend\js\core\handler-dnd.js | 18 | `const shouldEnterForm` | 判断文件是否需要进入命名表单（异步） |
| frontend\js\core\handler-dnd.js | 139 | `const f` | fallback: 浏览器不支持 webkitGetAsEntry 时用 getAsFile |
| frontend\js\core\handler-dnd.js | 180 | `const ysmFiles` | 分类：YSM 进命名队列，非 YSM 直接导入（ZIP 需调 Go 端 DetectZipType 内容判定） |
| frontend\js\core\handler-sync.js | 49 | `const allStatuses` | 提前获取一次状态列表（避免循环内重复调用） |
| frontend\js\core\theme.js | 2 | `const TLABEL` | ===== 主题切换 ===== |
| frontend\js\core\theme.js | 15 | `const rippleStyle` | 注入涟漪动画样式 |
| frontend\js\core\theme.js | 47 | `function bindThemeBtn` | 延迟到 DOM 就绪后获取按钮 |
| frontend\js\dialogs\adv-filter.js | 16 | `export function modalAdvFilter` | 弹出高级筛选弹窗 |
| frontend\js\dialogs\adv-filter.js | 158 | `const allInputs` | Enter 提交（任意输入框） |
| frontend\js\dialogs\batch-rename.js | 12 | `const items` | 解析每个文件的 [作者]【作品】角色(日期) |
| frontend\js\dialogs\batch-rename.js | 36 | `const cnt` | 重置正则错误标志，允许每次调用都提示 |
| frontend\js\dialogs\batch-rename.js | 41 | `const extMatch` | 分离扩展名，只对文件名主体做替换 |
| frontend\js\dialogs\batch-rename.js | 51 | `const cnt` | 正则无效时保持原名，提示用户 |
| frontend\js\dialogs\batch-rename.js | 76 | `const batchAuthor` | 批量修改作者/作品 |
| frontend\js\dialogs\batch-rename.js | 131 | `const modeSelect` | 模式切换 |
| frontend\js\dialogs\batch-rename.js | 172 | `const presetsBtn` | 预设切换（行内展开/收起） |
| frontend\js\dialogs\batch-rename.js | 298 | `const selectAll` | 全选联动 |
| frontend\js\dialogs\modal.js | 20 | `export function closeDlg` | 带退场动画关闭对话框 |
| frontend\js\dialogs\modal.js | 40 | `export function modalPrompt` | 弹出带输入框的模态框，类似 styled prompt() |
| frontend\js\dialogs\modal.js | 110 | `export function modalSelect` | 弹出下拉选择框 |
| frontend\js\dialogs\modal.js | 171 | `export function modalConfirm` | 弹出确认对话框 |
| frontend\js\dialogs\rename.js | 143 | `const illegal` | 检查非法字符 |
| frontend\js\dialogs\rename.js | 152 | `const newName` | 检查新文件名长度 |
| frontend\js\dialogs\tag-editor.js | 13 | `export function modalTagEditor` | 弹出标签编辑弹窗 |
| frontend\js\features\community\data.js | 6 | `export function showProgress` | 创建进度条 UI（插入到 searchResults 容器） |
| frontend\js\features\community\data.js | 32 | `export async function tryFetchModels` | 从 GitHub 获取 index.json（并发竞速：同时请求所有镜像源，取最快响应） |
| frontend\js\features\community\data.js | 52 | `const sorted` | 按镜像策略调整顺序（仅影响 which 最先被展示，并发竞速时无实质区别） |
| frontend\js\features\community\data.js | 114 | `const p1` | 启动第一个请求 |
| frontend\js\features\community\data.js | 165 | `const reasons` | 全部失败 — 诊断根因 |
| frontend\js\features\community\download-queue.js | 12 | `const STATE` | (no desc) |
| frontend\js\features\community\download-queue.js | 31 | `export function subscribe` | 订阅 STATE 变更。返回取消订阅函数。 |
| frontend\js\features\community\download-queue.js | 41 | `export function getState` | (no desc) |
| frontend\js\features\community\download-queue.js | 50 | `export async function resume` | 页面切回时调用，从 Go 端恢复当前队列状态。 |
| frontend\js\features\community\download-queue.js | 84 | `export async function enqueueDownloads` | 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。 |
| frontend\js\features\community\download-queue.js | 107 | `export async function cancelDownloads` | 模块级取消 — 纯粹的 Go 调用。 |
| frontend\js\features\community\download-queue.js | 213 | `export function createDownloadQueue` | 创建一个下载队列 UI 控制器。 |
| frontend\js\features\community\download-queue.js | 266 | `function handleFileStart` | 新文件开始下载 → 渲染进度行 + 取消按钮 */ |
| frontend\js\features\community\download-queue.js | 288 | `function handleProgress` | 下载进度更新 → 更新进度条和百分比 */ |
| frontend\js\features\community\download-queue.js | 320 | `const hasCL` | 大文件卡进度防骗（CLIP / VAE / UNET 结尾） |
| frontend\js\features\community\download-queue.js | 371 | `function handleFileDone` | 文件下载完成 → 更新本地缓存 / 清勾选 / 显示错误 */ |
| frontend\js\features\community\download-queue.js | 374 | `const pctEl` | file-done 到达时强制覆盖卡在 99% 的进度条 |
| frontend\js\features\community\download-queue.js | 402 | `function handleQueueEnded` | 队列结束 → 显示错误摘要 / 清理 UI / 通知外部 */ |
| frontend\js\features\community\download-queue.js | 449 | `const qs` | 队列启动或 resume 恢复 — 确保 UI 就绪 |
| frontend\js\features\community\events.js | 25 | `export function bindRepoEvents` | 绑定仓库模型页面的所有事件。 |
| frontend\js\features\community\events.js | 44 | `const queue` | ============================================================ |
| frontend\js\features\community\events.js | 61 | `const renderList` | ============================================================ |
| frontend\js\features\community\events.js | 98 | `const srch` | ==== 搜索过滤 ==== |
| frontend\js\features\community\events.js | 107 | `const toggleBtn` | ==== 📁 仅显示缺失 切换 ==== |
| frontend\js\features\community\events.js | 120 | `const selContainer` | ==== 复选框 → 更新选中计数 ==== |
| frontend\js\features\community\events.js | 132 | `const dlSelBtn` | ==== ⬇️ 下载选中 ==== |
| frontend\js\features\community\events.js | 150 | `const selAllCb` | ==== ☐ 全选 / 取消全选 ==== |
| frontend\js\features\community\events.js | 164 | `const listEl` | ==== 右键模型行 → 查看索引信息 ==== |
| frontend\js\features\community\events.js | 189 | `const dlContainer` | ==== ⬇️ 单文件下载（事件委托） ==== |
| frontend\js\features\community\events.js | 195 | `const dlBtn` | 下载按钮 |
| frontend\js\features\community\events.js | 203 | `const searchBtn` | B站搜索按钮 |
| frontend\js\features\community\events.js | 221 | `async function handleSingleDownload` | 提取单文件下载逻辑 |
| frontend\js\features\community\events.js | 246 | `const cb` | 同步勾选 |
| frontend\js\features\community\events.js | 259 | `const externalCleanup` | 对外暴露的清理函数（供上层在视图销毁时调用） |
| frontend\js\features\community\render.js | 9 | `export function isModelMissing` | 判断模型是否缺失（本地不存在） |
| frontend\js\features\community\render.js | 22 | `export function countMissing` | 计算缺失数量 |
| frontend\js\features\community\render.js | 31 | `function formatSize` | 格式化文件大小 |
| frontend\js\features\community\render.js | 45 | `function createIconBtn` | 创建图标按钮 |
| frontend\js\features\community\render.js | 63 | `export function renderModelList` | 渲染模型列表（DocumentFragment） |
| frontend\js\features\community\render.js | 91 | `const nameWrap` | 列1: 复选框(缺失时) + 名称 |
| frontend\js\features\community\render.js | 108 | `const metaCell` | 列2: 大小 + B站搜索按钮 |
| frontend\js\features\community\render.js | 119 | `const actionsCell` | 列3: 下载按钮或已有徽章 |
| frontend\js\features\community\render.js | 145 | `export const GROUP_LABELS` | 分组标签映射 |
| frontend\js\features\community\render.js | 157 | `export function renderCardsHTML` | 生成左栏站点卡片 HTML |
| frontend\js\features\community\render.js | 208 | `export function renderRepoHeaderHTML` | 生成仓库模型页面的头部 HTML（含返回按钮、计数、筛选按钮等） |
| frontend\js\features\import-queue.js | 20 | `const shouldEnterForm` | 判断文件是否需要进入命名表单（异步） |
| frontend\js\features\import-queue.js | 58 | `const toggleForm` | 切换拖拽区 ↔ 表单（简单 display 切换） |
| frontend\js\features\import-queue.js | 143 | `const loadHeaderFromBase64` | 从 Go 端解析 base64 头部元数据（复用 header.go 的完整解析逻辑） |
| frontend\js\features\import-queue.js | 180 | `const tipsEl` | 取消勾选时隐藏 tips，不清空已填入的作者（用户可能想保留） |
| frontend\js\features\import-queue.js | 214 | `const files` | 回退到 files |
| frontend\js\features\import-queue.js | 357 | `const subpath` | 从 relPath 提取子目录，如 "folder/sub/model.ysm" → "folder/sub" |
| frontend\js\features\import-queue.js | 409 | `const importedIdx` | 从队列中移除已导入的文件 |
| frontend\js\features\import-queue.js | 511 | `const dup` | 检查文件名是否已在队列中 |
| frontend\js\features\import-queue.js | 533 | `const readEntry` | 递归读取文件夹内的模型文件 |
| frontend\js\features\import-queue.js | 582 | `const processDropItems` | 处理拖入的 items（支持文件和文件夹） |
| frontend\js\features\import-queue.js | 633 | `const directImport` | 非 YSM 文件直接导入（跳过命名表单） |
| frontend\js\features\import-queue.js | 660 | `const renderImportedList` | 渲染已导入列表（含队列） |
| frontend\js\features\import-queue.js | 790 | `const processPendingImport` | 处理待导入文件的通用函数 |
| frontend\js\features\import-queue.js | 823 | `const importPendingUnsub` | 已在导入页时处理拖入文件 |
| frontend\js\features\oldest-models.js | 12 | `export async function loadOldestModel` | 加载资历最深、仓库评分、热力图和每日推荐 |
| frontend\js\features\oldest-models.js | 18 | `function handleContainerClick` | 命名函数，用于安全地移除/添加 click 监听，避免重复绑定 |
| frontend\js\features\oldest-models.js | 80 | `const monthCounts` | 热力图 |
| frontend\js\features\oldest-models.js | 121 | `const sorted` | 资历最深 |
| frontend\js\features\oldest-models.js | 162 | `const renderPicks` | 每日推荐 |
| frontend\js\features\oldest-models.js | 164 | `const shuffled` | Fisher-Yates 洗牌后取前 3 个，避免重复且简洁可靠 |
| frontend\js\features\oldest-models.js | 293 | `function buildMonthHeatmap` | ====== 工具函数 ====== |
| frontend\js\features\recycle-bin.js | 78 | `const currentRoot` | 获取当前类型的根目录（用于路径过滤） |
| frontend\js\features\recycle-bin.js | 82 | `const entries` | 过滤：只显示路径在当前类型根目录下的文件 |
| frontend\js\features\resource-packs.js | 10 | `export async function initResourcePacks` | 初始化资源包 tab |
| frontend\js\features\resource-packs.js | 20 | `const manager` | 监听 Toast 事件，改用事件总线确保 Toast 始终可达 |
| frontend\js\features\version-updater.js | 7 | `const CHECK_KEY` | 频次限制 key */ |
| frontend\js\features\version-updater.js | 9 | `const CHECK_INTERVAL` | 最短检查间隔（6 小时） */ |
| frontend\js\features\version-updater.js | 12 | `function canCheck` | 检查是否超过频次限制 */ |
| frontend\js\features\version-updater.js | 18 | `function markChecked` | 记录本次检查时间 */ |
| frontend\js\features\version-updater.js | 23 | `async function doUpdate` | 下载并应用更新（公共逻辑） */ |
| frontend\js\features\version-updater.js | 38 | `async function promptUpdate` | 弹出更新确认对话框（手动/静默共用） — 含格式化的更新日志区域 */ |
| frontend\js\features\version-updater.js | 65 | `const d` | 转义 HTML 后保留换行，样式通过 CSS 变量适应主题 |
| frontend\js\features\version-updater.js | 111 | `export async function checkUpdateSilent` | 启动时静默检查更新（受 6h 频次限制） |
| frontend\js\features\version-updater.js | 133 | `export function initVersionUpdater` | 手动检查更新（设置页按钮） |
| frontend\js\services\registry.js | 8 | `export function register` | 注册一个服务 */ |
| frontend\js\services\registry.js | 13 | `export function get` | 获取一个服务 */ |
| frontend\js\services\registry.js | 20 | `export function has` | 检查服务是否已注册 */ |
| frontend\js\services\registry.js | 25 | `export function unregister` | 注销（测试用） */ |
| frontend\js\services\registry.js | 30 | `export function clear` | 清空所有（测试用） */ |
| frontend\js\utils\animate.js | 18 | `const frames` | 例: from=0, to=141 → [1, 41, 141]（个位→十位→百位） |
| frontend\js\utils\animate.js | 32 | `const unique` | 去重 + 去头（去掉与 from 相同的） |
| frontend\js\utils\animate.js | 40 | `const stepDuration` | 逐帧播放（从右到左逐位进位） |
| frontend\js\utils\animation-player.js | 179 | `const displayTime` | 显示用时间：循环动画取模，非循环动画 clamp |
| frontend\js\utils\animation.js | 7 | `function isMolang` | 判断值是否为 Molang 字符串（非纯数字） */ |
| frontend\js\utils\animation.js | 16 | `function foldMolangConstant` | 常量折叠：尝试从 Molang 字符串中提取纯数字。 |
| frontend\js\utils\animation.js | 19 | `const direct` | 尝试直接解析为数字 |
| frontend\js\utils\animation.js | 43 | `function parseKeyValue` | 尝试将关键帧值解析为 [x,y,z] 数字数组 */ |
| frontend\js\utils\animation.js | 67 | `function extractKeyframe` | 从关键帧对象解析 {post, pre, lerp_mode} */ |
| frontend\js\utils\animation.js | 82 | `const n` | 单数值 |
| frontend\js\utils\animation.js | 88 | `function parseChannel` | 解析单个 channel（rotation/position/scale）的数据 */ |
| frontend\js\utils\animation.js | 104 | `function hasMolangInChannelData` | 检测 channel 原始数据中是否含 Molang 表达式（字符串值） */ |
| frontend\js\utils\animation.js | 134 | `export function parseBedrockAnimationJSON` | 解析完整的基岩版动画 JSON 字符串 |
| frontend\js\utils\animation.js | 154 | `const bones` | 跳过无效动画 |
| frontend\js\utils\animation.js | 219 | `export function evaluateKeyframes` | 在指定时间 t 对一组关键帧求值 |
| frontend\js\utils\animation.js | 243 | `const dt` | 线性插值（防御空值） |
| frontend\js\utils\animation.js | 263 | `export function evaluateClip` | 对整个动画 clip 在指定时间求值（支持骨骼层级） |
| frontend\js\utils\animation.js | 275 | `const local` | 1. 计算各骨骼的局部变换 |
| frontend\js\utils\animation.js | 291 | `const parentMap` | 2. 构建名称→父级映射 |
| frontend\js\utils\animation.js | 300 | `const allBoneNames` | 先找出根骨骼（无父级或有父级但父级不在列表中的） |
| frontend\js\utils\animation.js | 306 | `const sorted` | 拓扑排序：父级在前 |
| frontend\js\utils\canvas-export.js | 9 | `export function addExportButton` | 在 canvas 下方附加"导出 PNG"按钮 |
| frontend\js\utils\canvas-export.js | 33 | `function exportCanvasPNG` | 将 canvas 内容导出为 PNG 文件下载 |
| frontend\js\utils\constants.js | 4 | `export const PREVIEW_CANVAS_SIZE` | 骨骼预览 Canvas 尺寸 */ |
| frontend\js\utils\constants.js | 8 | `export const DEFAULT_TEX_SIZE` | 纹理尺寸默认值 */ |
| frontend\js\utils\constants.js | 11 | `export const LABEL_MAX_WIDTH` | 骨骼名标注最大文本宽度阈值 */ |
| frontend\js\utils\constants.js | 14 | `export const ZOOM_MIN` | 缩放范围 */ |
| frontend\js\utils\constants.js | 20 | `export const ROTATION_PER_PX` | 旋转增量（度/像素拖拽） */ |
| frontend\js\utils\constants.js | 23 | `export const MINI_MAP_SIZE` | 预览缩略图尺寸 */ |
| frontend\js\utils\constants.js | 26 | `export const MAX_LOG_ITEMS` | 日志最大显示条数 */ |
| frontend\js\utils\constants.js | 29 | `export const STUCK_GUARD_DELAY` | 下载队列 */ |
| frontend\js\utils\constants.js | 33 | `export const ANIMATE_MAX_STEPS` | 数字跳动动画 */ |
| frontend\js\utils\debug.js | 8 | `const ENABLED` | - 写完调试后请删除调用（按 .github/copilot-instructions.md 规则 18 须请示用户） |
| frontend\js\utils\debug.js | 16 | `export function dbg` | 输出调试日志（保留 tag 用于过滤） */ |
| frontend\js\utils\debug.js | 33 | `export function dbgWarn` | 输出警告（即使关闭调试也保留） */ |
| frontend\js\utils\display.js | 9 | `export function parseModelName` | 解析模型文件名 → 结构化字段 |
| frontend\js\utils\display.js | 55 | `export function renderDisplayName` | 渲染美化文件名 HTML（通用接口） |
| frontend\js\utils\display.js | 63 | `const matches` | 先找到所有匹配位置，按文件中的原始顺序排序 |
| frontend\js\utils\display.js | 135 | `function escRegex` | 转义正则特殊字符 */ |
| frontend\js\utils\display.js | 140 | `export function renderModelName` | renderModelName = renderDisplayName 别名，options.showExt 支持 */ |
| frontend\js\utils\display.js | 151 | `export function renderModelNameWithHighlight` | 搜索高亮版 */ |
| frontend\js\utils\dom.js | 2 | `export function esc` | ===== HTML 转义 ===== |
| frontend\js\utils\dom.js | 12 | `export function hl` | ===== 搜索高亮（返回 HTML 字符串） ===== |
| frontend\js\utils\errors.js | 10 | `export function friendlyError` | 将 Go 错误转换为中文友好提示 |
| frontend\js\utils\errors.js | 19 | `const patterns` | 优先级：社区抓取常见错误 > 通用文件/网络错误 |
| frontend\js\utils\extensions.js | 8 | `export const RESOURCE_EXTS` | 每种资源类型对应的扩展名 */ |
| frontend\js\utils\extensions.js | 19 | `export const ALL_EXTS` | 所有支持的扩展名列表（去重，用于 UI 提示文案） */ |
| frontend\js\utils\extensions.js | 34 | `export function getExts` | 获取某资源类型支持的扩展名 */ |
| frontend\js\utils\extensions.js | 39 | `export function isSupportedExt` | 检查扩展名是否被某资源类型支持 */ |
| frontend\js\utils\extensions.js | 44 | `export function extBelongsTo` | 返回扩展名所属的资源类型 ID */ |
| frontend\js\utils\fmt.js | 2 | `export function fmt` | ===== 文件大小格式化 ===== |
| frontend\js\utils\fmt.js | 10 | `export function sizeColor` | 文件大小颜色 class：<1MB 绿色，1-3MB 正常，>3MB 红色 */ |
| frontend\js\utils\fmt.js | 18 | `export function fmtDate` | ===== 日期格式化 ===== |
| frontend\js\utils\icon.js | 2 | `export function fileIcon` | ===== 文件名 → 图标 ===== |
| frontend\js\utils\mc-format.js | 23 | `const FORMAT_TAGS` | 格式码：§l 粗体 §o 斜体 §n 下划线 §m 删除线 |
| frontend\js\utils\mc-format.js | 46 | `export function renderFormattedText` | 将含 Minecraft § 分节符的文本渲染为带颜色的 HTML。 |
| frontend\js\utils\model2d.js | 15 | `export function renderModel2D` | 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转） |
| frontend\js\utils\model2d.js | 19 | `const cubesWithRotation` | 调试：检查是否有 cube rotation |
| frontend\js\utils\model2d.js | 42 | `const firstCube` | 额外调试：检查第一个 cube 是否有 pivot |
| frontend\js\utils\model2d.js | 64 | `const rot` | 旋转点 [x,y,z] 绕 Y 轴，返回 {x, z} |
| frontend\js\utils\model2d.js | 79 | `const corners` | 8 个角中取旋转后 X 最左/最右、Y 最上/最下 |
| frontend\js\utils\model2d.js | 103 | `const boneHitZones` | 计算骨骼屏幕坐标热区，供鼠标拾取 |
| frontend\js\utils\model2d.js | 301 | `const rzRad` | Z 旋转（绕 pivot，屏幕平面内最可见） |
| frontend\js\utils\model2d.js | 312 | `const rxRad` | X 旋转（Y 方向压缩） |
| frontend\js\utils\model2d.js | 320 | `const scrX` | 全局 Y 旋转投影 |
| frontend\js\utils\model2d.js | 326 | `const pw` | 投影后的宽高（不含 Z 旋转，因为 Z 旋转由 canvas.rotate 负责） |
| frontend\js\utils\model2d.js | 349 | `const cubeRot` | ---- 静态骨骼：应用 cube rotation ---- |
| frontend\js\utils\model2d.js | 354 | `const pivot` | 有 rotation，使用简化方法：先计算旋转后的中心点，然后用 Canvas rotate 绘制 |
| frontend\js\utils\model2d.js | 357 | `const rxRad` | 获取旋转角度 |
| frontend\js\utils\model2d.js | 383 | `const scrX` | 全局 Y 轴旋转投影 |
| frontend\js\utils\model2d.js | 389 | `const drawW` | 计算尺寸（考虑 X 轴旋转对高度的影响） |
| frontend\js\utils\model2d.js | 410 | `const rx` | 无 rotation，使用原有快速路径 |
| frontend\js\utils\model2d.js | 545 | `const rx` | 俯视图也用旋转坐标 |
| frontend\js\utils\model3d-spec.js | 8 | `export function buildSpecFromModel` | 构建 Three.js 可消费的 spec 结构 { bones[], meshes[] } */ |
| frontend\js\utils\model3d-spec.js | 142 | `const fw` | 标准 box UV 映射 |
| frontend\js\utils\pack-format.js | 96 | `export function formatVersion` | 根据 pack_format 数值获取可读 Minecraft 版本描述 |
| frontend\js\utils\pack-format.js | 105 | `export function describeVersionRange` | 根据 meta 对象生成格式号 + 版本号描述 |
| frontend\js\utils\preview-cache.js | 12 | `const _cache` | (no desc) |
| frontend\js\utils\preview-cache.js | 15 | `const _order` | 插入顺序队列（FIFO 淘汰用） */ |
| frontend\js\utils\preview-cache.js | 24 | `export function cacheSetEvictHandler` | 注册 evict 回调，淘汰条目时调用 |
| frontend\js\utils\preview-cache.js | 87 | `export function cacheSize` | 缓存大小 */ |
| frontend\js\utils\resource-registry.js | 7 | `export async function loadResourceRegistry` | 加载资源类型注册表 */ |
| frontend\js\utils\resource-registry.js | 24 | `export function getResourceType` | 获取某资源类型的注册表条目 */ |
| frontend\js\utils\resource-registry.js | 29 | `export function getStorageSubDir` | 获取存储子目录（对应 resource_types.json 的 storageSubDir 字段） */ |
| frontend\js\utils\screenshot-renderer.js | 7 | `export async function renderMultiAngle` | renderMultiAngle 透明背景多角度截图 |
| frontend\js\utils\screenshot-renderer.js | 80 | `export async function batchRepoScreenshots` | repoRoot: 仓库根目录（传空则尝试从 App config 读取） |
| frontend\js\utils\stagger.js | 11 | `export const stagger` | (no desc) |
| frontend\js\utils\summarize.js | 6 | `function renderTips` | 渲染 MC 格式代码为带颜色的 HTML */ |
| frontend\js\utils\summarize.js | 12 | `function cleanText` | 清洗纯文本（名称/ID 类字段，去除 § 和控制字符） */ |
| frontend\js\utils\summarize.js | 24 | `function headerOnlyCardHTML` | 仅基于头部信息渲染的简约卡片（加密/闭源模型） */ |
| frontend\js\utils\summarize.js | 26 | `const p` | 头部无名称时从文件名回退解析 |
| frontend\js\utils\summarize.js | 57 | `const titleHtml` | 标题行：优先用文件名解析的标签，其次 header.name |
| frontend\js\utils\summarize.js | 153 | `const freeBadge` | 免费/付费标记 |
| frontend\js\wails\app.js | 4 | `export const getApp` | 获取 Go App 绑定的缓存引用，避免重复动态 import */ |
| frontend\js\wails\app.js | 11 | `export const resetAppCache` | 重置缓存（测试用） */ |
| frontend\js\wasm\ysm-glue-data.js | 4 | `export function _getGlueCode` | (no desc) |
| frontend\js\wasm\ysm-parser.js | 42 | `const factory` | 5. 调用工厂 |
| frontend\js\wasm\ysm-parser.js | 59 | `function _getHeap` | 安全获取最新的 WASM HEAPU8（patch 注入到 Module 上，内存扩容后自动更新） */ |
| frontend\js\wasm\ysm-parser.js | 61 | `const h` | 每次从 window.Module.HEAPU8 取最新的（内存扩容后 updateMemoryViews 会更新它） |
| frontend\js\wasm\ysm-parser.js | 69 | `function _writeHeap` | 将 JS 数据写入 WASM 内存，返回指针 */ |
| frontend\js\wasm\ysm-parser.js | 71 | `const src` | data 现在是 Uint8Array（已在 _decodeYsmViaWasm 中从 base64 解码） |
| frontend\js\wasm\ysm-parser.js | 84 | `export async function decodeYsmFileFromMemory` | 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组） |
| frontend\js\wasm\ysm-parser.js | 99 | `const ptr` | 使用辅助函数分配内存并写入数据 |
| frontend\js\wasm\ysm-parser.js | 120 | `export function diagYsmHeader` | 诊断：打印 .ysm 文件头信息到控制台 |
| frontend\js\wasm\ysm-parser.js | 142 | `export function detectYsmVersion` | 检测 .ysm 文件版本（不解析，仅检查文件头） |
| frontend\js\wasm\ysm-parser.js | 164 | `export async function decodeYsmFile` | 通过 callMain + MEMFS 解码 .ysm（回退路径） |
| frontend\js\wasm\ysm-wasm-data.js | 4 | `export function _getWasmBinary` | (no desc) |
| go\dedup\dedup.go | 16 | `type FileEntry` | FileEntry 文件条目 |
| go\dedup\dedup.go | 16 | `type FileEntry` | FileEntry 文件条目 |
| go\dedup\dedup.go | 24 | `type Group` | Group 重复文件分组 |
| go\dedup\dedup.go | 24 | `type Group` | Group 重复文件分组 |
| go\dedup\dedup.go | 32 | `func FindDuplicateFiles` | FindDuplicateFiles 扫描目录，按 SHA256 哈希分组，返回包含重复的分组 |
| go\dedup\dedup.go | 32 | `func FindDuplicateFiles` | FindDuplicateFiles 扫描目录，按 SHA256 哈希分组，返回包含重复的分组 |
| go\dedup\dedup.go | 124 | `func CountDuplicates` | CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数） |
| go\dedup\dedup.go | 124 | `func CountDuplicates` | CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数） |
| go\dedup\dedup.go | 178 | `func CleanEmptyDirs` | CleanEmptyDirs 递归删除指定目录下的所有空子目录。 |
| go\dedup\dedup.go | 178 | `func CleanEmptyDirs` | CleanEmptyDirs 递归删除指定目录下的所有空子目录。 |
| go\dedup\dedup.go | 189 | `func removeEmptyDirs` | removeEmptyDirs 递归后序遍历删除空目录 |
| go\dedup\dedup.go | 189 | `func removeEmptyDirs` | removeEmptyDirs 递归后序遍历删除空目录 |
| go\dedup\dedup.go | 210 | `func isEmptyDir` | isEmptyDir 检查目录是否为空（不含任何文件和非空子目录） |
| go\dedup\dedup.go | 210 | `func isEmptyDir` | isEmptyDir 检查目录是否为空（不含任何文件和非空子目录） |
| go\errors\errors.go | 11 | `func Friendly` | Friendly 将错误转换为用户能看懂的中文提示。 |
| go\errors\errors.go | 11 | `func Friendly` | Friendly 将错误转换为用户能看懂的中文提示。 |
| go\fsutil\walk.go | 12 | `func WalkAllFiles` | WalkAllFiles 递归遍历目录返回所有文件的完整路径（不限制扩展名） |
| go\fsutil\walk.go | 12 | `func WalkAllFiles` | WalkAllFiles 递归遍历目录返回所有文件的完整路径（不限制扩展名） |
| go\fsutil\walk.go | 36 | `func WalkAllDirs` | WalkAllDirs 递归遍历目录，返回所有子目录路径（广度优先，后序遍历用） |
| go\fsutil\walk.go | 36 | `func WalkAllDirs` | WalkAllDirs 递归遍历目录，返回所有子目录路径（广度优先，后序遍历用） |
| go\fsutil\walk.go | 65 | `func CountFiles` | CountFiles 统计目录中的文件数（不限制扩展名） |
| go\fsutil\walk.go | 65 | `func CountFiles` | CountFiles 统计目录中的文件数（不限制扩展名） |
| go\fsutil\walk.go | 70 | `func CleanEmptyDirs` | CleanEmptyDirs 递归删除空子目录，返回删除数 |
| go\fsutil\walk.go | 70 | `func CleanEmptyDirs` | CleanEmptyDirs 递归删除空子目录，返回删除数 |
| go\geometry\archive.go | 23 | `func ExtractFirstPNGFromZip` | ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览） |
| go\geometry\archive.go | 23 | `func ExtractFirstPNGFromZip` | ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览） |
| go\geometry\archive.go | 45 | `func ExtractFirstPNGFrom7z` | ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览） |
| go\geometry\archive.go | 45 | `func ExtractFirstPNGFrom7z` | ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览） |
| go\geometry\archive.go | 67 | `func ParseFromZip` | ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画 |
| go\geometry\archive.go | 67 | `func ParseFromZip` | ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画 |
| go\geometry\archive.go | 321 | `func ParseFrom7z` | ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理 |
| go\geometry\archive.go | 321 | `func ParseFrom7z` | ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理 |
| go\geometry\archive.go | 423 | `type geoEntry` | 按 modelOrder 排序 geo 文件 |
| go\geometry\archive.go | 423 | `type geoEntry` | 按 modelOrder 排序 geo 文件 |
| go\geometry\parse.go | 17 | `func ParseBedrockGeometry` | ParseBedrockGeometry 解析标准 Bedrock geometry JSON（minecraft:geometry 格式） |
| go\geometry\parse.go | 17 | `func ParseBedrockGeometry` | ParseBedrockGeometry 解析标准 Bedrock geometry JSON（minecraft:geometry 格式） |
| go\importer\importer.go | 19 | `type Handler` | Handler 资源导入策略接口 |
| go\importer\importer.go | 19 | `type Handler` | Handler 资源导入策略接口 |
| go\importer\importer.go | 29 | `func Register` | Register 注册导入策略 |
| go\importer\importer.go | 29 | `func Register` | Register 注册导入策略 |
| go\importer\importer.go | 34 | `func Get` | Get 获取指定类型的导入策略 |
| go\importer\importer.go | 34 | `func Get` | Get 获取指定类型的导入策略 |
| go\importer\importer.go | 41 | `func sanitizePath` | sanitizePath 清理路径，确保不含路径遍历组件（..） |
| go\importer\importer.go | 41 | `func sanitizePath` | sanitizePath 清理路径，确保不含路径遍历组件（..） |
| go\importer\importer.go | 60 | `func NewSimpleCopy` | NewSimpleCopy 创建简单文件复制导入器 |
| go\importer\importer.go | 60 | `func NewSimpleCopy` | NewSimpleCopy 创建简单文件复制导入器 |
| go\importer\importer.go | 126 | `func copyDirRecursive` | copyDirRecursive 递归复制目录（先复制到临时目录再 rename，保证原子性） |
| go\importer\importer.go | 126 | `func copyDirRecursive` | copyDirRecursive 递归复制目录（先复制到临时目录再 rename，保证原子性） |
| go\importer\importer.go | 147 | `func copyDirContents` | copyDirContents 递归复制目录内容到目标（无原子性保证，供 copyDirRecursive 内部调用） |
| go\importer\importer.go | 147 | `func copyDirContents` | copyDirContents 递归复制目录内容到目标（无原子性保证，供 copyDirRecursive 内部调用） |
| go\importer\importer.go | 190 | `func NewDirectoryCopy` | NewDirectoryCopy 创建文件夹复制导入器 |
| go\importer\importer.go | 190 | `func NewDirectoryCopy` | NewDirectoryCopy 创建文件夹复制导入器 |
| go\importer\importer.go | 199 | `func (d *DirectoryCopyImporter) Import` | Import 复制源文件夹到目标目录 |
| go\importer\importer.go | 199 | `func (d *DirectoryCopyImporter) Import` | Import 复制源文件夹到目标目录 |
| go\importer\importer.go | 288 | `func copyFile` | copyFile 复制单文件（工具函数） |
| go\importer\importer.go | 288 | `func copyFile` | copyFile 复制单文件（工具函数） |
| go\installer\installer.go | 20 | `func cleanAbs` | cleanAbs 封装 filepath.Abs(filepath.Clean(path)) |
| go\installer\installer.go | 20 | `func cleanAbs` | cleanAbs 封装 filepath.Abs(filepath.Clean(path)) |
| go\installer\installer.go | 30 | `func Install` | Install 安装模型到目标目录（支持链接模式） |
| go\installer\installer.go | 30 | `func Install` | Install 安装模型到目标目录（支持链接模式） |
| go\installer\installer.go | 98 | `func InstallDir` | InstallDir 安装整个目录下的所有文件到目标目录（支持链接模式） |
| go\installer\installer.go | 98 | `func InstallDir` | InstallDir 安装整个目录下的所有文件到目标目录（支持链接模式） |
| go\installer\installer.go | 126 | `func installDirRecursive` | installDirRecursive 递归安装目录树 |
| go\installer\installer.go | 126 | `func installDirRecursive` | installDirRecursive 递归安装目录树 |
| go\installer\installer.go | 197 | `func InstallToGlobal` | InstallToGlobal 安装到全局 custom 目录 |
| go\installer\installer.go | 197 | `func InstallToGlobal` | InstallToGlobal 安装到全局 custom 目录 |
| go\installer\installer.go | 217 | `func InstallWithOverlay` | InstallWithOverlay 带冲突检查的安装 |
| go\installer\installer.go | 217 | `func InstallWithOverlay` | InstallWithOverlay 带冲突检查的安装 |
| go\installer\installer.go | 244 | `func CopyFile` | CopyFile 复制文件到目标目录 |
| go\installer\installer.go | 244 | `func CopyFile` | CopyFile 复制文件到目标目录 |
| go\installer\installer.go | 345 | `func IsValidRepoRoot` | IsValidRepoRoot 禁止选择系统敏感目录作为仓库 |
| go\installer\installer.go | 345 | `func IsValidRepoRoot` | IsValidRepoRoot 禁止选择系统敏感目录作为仓库 |
| go\installer\installer_test.go | 10 | `func setupTestDirs` | setupTestDirs 创建测试用目录结构并返回 (repoRoot, customDir, mcRoot, ysmFile) |
| go\installer\installer_test.go | 10 | `func setupTestDirs` | setupTestDirs 创建测试用目录结构并返回 (repoRoot, customDir, mcRoot, ysmFile) |
| go\litematic\block_colors.go | 10 | `func MapColor` | MapColor 返回 minecraft 方块名对应的近似十六进制颜色。 |
| go\litematic\block_colors.go | 10 | `func MapColor` | MapColor 返回 minecraft 方块名对应的近似十六进制颜色。 |
| go\litematic\block_colors.go | 30 | `func fuzzyMatch` | fuzzyMatch 尝试用名称前缀匹配已知颜色 |
| go\litematic\block_colors.go | 30 | `func fuzzyMatch` | fuzzyMatch 尝试用名称前缀匹配已知颜色 |
| go\litematic\block_colors.go | 52 | `func hashColor` | hashColor 对名称做哈希，生成一致的 HSL 颜色（饱和度 50%，亮度 60%） |
| go\litematic\block_colors.go | 52 | `func hashColor` | hashColor 对名称做哈希，生成一致的 HSL 颜色（饱和度 50%，亮度 60%） |
| go\litematic\block_colors.go | 61 | `func hslToHex` | hslToHex 将 HSL 转为十六进制颜色字符串 |
| go\litematic\block_colors.go | 61 | `func hslToHex` | hslToHex 将 HSL 转为十六进制颜色字符串 |
| go\litematic\block_ids.go | 12 | `func ResolveBlockName` | ResolveBlockName 把旧版数字 ID（schematic v1）解析为注册名。 |
| go\litematic\block_ids.go | 12 | `func ResolveBlockName` | ResolveBlockName 把旧版数字 ID（schematic v1）解析为注册名。 |
| go\litematic\block_ids.go | 26 | `func ResolveBlockZH` | ResolveBlockZH 把注册名映射为中文名（自动去除 minecraft: 前缀）。 |
| go\litematic\block_ids.go | 26 | `func ResolveBlockZH` | ResolveBlockZH 把注册名映射为中文名（自动去除 minecraft: 前缀）。 |
| go\litematic\gen\main.go | 70 | `type variantEntry` | 为了输出稳定，先收集再排序 |
| go\litematic\gen\main.go | 70 | `type variantEntry` | 为了输出稳定，先收集再排序 |
| go\litematic\nbt.go | 13 | `func readRootCompound` | readRootCompound 用 go-mc/nbt 解码根 Compound，返回 map[string]any。 |
| go\litematic\nbt.go | 13 | `func readRootCompound` | readRootCompound 用 go-mc/nbt 解码根 Compound，返回 map[string]any。 |
| go\litematic\nbt.go | 100 | `func extractBits` | Litematica 使用小端位序将方块索引打包到 LongArray： |
| go\litematic\nbt.go | 100 | `func extractBits` | Litematica 使用小端位序将方块索引打包到 LongArray： |
| go\litematic\voxel.go | 12 | `type regionInfo` | regionInfo 标准化后的 region 遍历信息 |
| go\litematic\voxel.go | 12 | `type regionInfo` | regionInfo 标准化后的 region 遍历信息 |
| go\litematic\voxel.go | 21 | `func BuildVoxelData` | BuildVoxelData 构建体素渲染数据（按颜色分组） |
| go\litematic\voxel.go | 21 | `func BuildVoxelData` | BuildVoxelData 构建体素渲染数据（按颜色分组） |
| go\litematic\voxel.go | 122 | `func buildRegionInfo` | buildRegionInfo 标准化一个 region 的遍历信息 |
| go\litematic\voxel.go | 122 | `func buildRegionInfo` | buildRegionInfo 标准化一个 region 的遍历信息 |
| go\litematic\voxel.go | 388 | `func filterSurfaceOnly` | filterSurfaceOnly 剔除被 6 个邻居完全包围的不可见方块。 |
| go\litematic\voxel.go | 388 | `func filterSurfaceOnly` | filterSurfaceOnly 剔除被 6 个邻居完全包围的不可见方块。 |
| go\logs\logs.go | 14 | `type Logger` | Logger 导入日志管理器 |
| go\logs\logs.go | 14 | `type Logger` | Logger 导入日志管理器 |
| go\logs\logs.go | 22 | `func NewLogger` | NewLogger 创建日志管理器 |
| go\logs\logs.go | 22 | `func NewLogger` | NewLogger 创建日志管理器 |
| go\logs\logs.go | 59 | `func (l *Logger) save` | save 将日志写入磁盘。 |
| go\logs\logs.go | 59 | `func (l *Logger) save` | save 将日志写入磁盘。 |
| go\logs\logs.go | 78 | `func (l *Logger) Add` | Add 添加一条日志 |
| go\logs\logs.go | 78 | `func (l *Logger) Add` | Add 添加一条日志 |
| go\logs\logs.go | 97 | `func (l *Logger) GetAll` | GetAll 获取所有日志 |
| go\logs\logs.go | 97 | `func (l *Logger) GetAll` | GetAll 获取所有日志 |
| go\logs\logs.go | 106 | `func (l *Logger) Clear` | Clear 清空日志 |
| go\logs\logs.go | 106 | `func (l *Logger) Clear` | Clear 清空日志 |
| go\packs\mcmeta.go | 18 | `func ReadPackMeta` | ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图 |
| go\packs\mcmeta.go | 18 | `func ReadPackMeta` | ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图 |
| go\packs\mcmeta.go | 93 | `func DetectResourceType` | DetectResourceType 检测文件属于哪种资源类型 |
| go\packs\mcmeta.go | 93 | `func DetectResourceType` | DetectResourceType 检测文件属于哪种资源类型 |
| go\packs\mcmeta.go | 132 | `func isYsmFile` | isYsmFile 检查文件是否为 YSM 模型 |
| go\packs\mcmeta.go | 132 | `func isYsmFile` | isYsmFile 检查文件是否为 YSM 模型 |
| go\packs\mcmeta.go | 159 | `func hasMcmeta` | hasMcmeta 检查 zip 内是否有 pack.mcmeta（区分 ZIP 资源包/模型） |
| go\packs\mcmeta.go | 159 | `func hasMcmeta` | hasMcmeta 检查 zip 内是否有 pack.mcmeta（区分 ZIP 资源包/模型） |
| go\packs\mcmeta.go | 178 | `func hasShaders` | hasShaders 检查 zip 内是否有 shaders/ 目录（光影包特征） |
| go\packs\mcmeta.go | 178 | `func hasShaders` | hasShaders 检查 zip 内是否有 shaders/ 目录（光影包特征） |
| go\packs\mcmeta.go | 201 | `func ReadShaderpackLang` | ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名 |
| go\packs\mcmeta.go | 201 | `func ReadShaderpackLang` | ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名 |
| go\paths\safe.go | 10 | `type ErrPathEscalation` | ErrPathEscalation 路径越权错误 |
| go\paths\safe.go | 10 | `type ErrPathEscalation` | ErrPathEscalation 路径越权错误 |
| go\paths\safe.go | 23 | `func IsInside` | IsInside 检查 path 是否在 baseDir 下，防止路径遍历。 |
| go\paths\safe.go | 23 | `func IsInside` | IsInside 检查 path 是否在 baseDir 下，防止路径遍历。 |
| go\paths\safe.go | 51 | `func ContainsMinecraftMarker` | ContainsMinecraftMarker 检查路径中是否包含 .minecraft 或 minecraft 标记 |
| go\paths\safe.go | 51 | `func ContainsMinecraftMarker` | ContainsMinecraftMarker 检查路径中是否包含 .minecraft 或 minecraft 标记 |
| go\recycle\recycle.go | 19 | `type MoveResult` | MoveResult 回收操作结果 |
| go\recycle\recycle.go | 19 | `type MoveResult` | MoveResult 回收操作结果 |
| go\recycle\recycle.go | 25 | `type TrashManager` | TrashManager 可配置的回收站管理器 |
| go\recycle\recycle.go | 25 | `type TrashManager` | TrashManager 可配置的回收站管理器 |
| go\recycle\recycle.go | 30 | `func New` | New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle |
| go\recycle\recycle.go | 30 | `func New` | New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle |
| go\recycle\recycle.go | 35 | `func (tm *TrashManager) RecycleDir` | RecycleDir 返回回收站目录路径 |
| go\recycle\recycle.go | 35 | `func (tm *TrashManager) RecycleDir` | RecycleDir 返回回收站目录路径 |
| go\recycle\recycle.go | 40 | `func (tm *TrashManager) Move` | Move 移动文件到回收站 |
| go\recycle\recycle.go | 40 | `func (tm *TrashManager) Move` | Move 移动文件到回收站 |
| go\recycle\recycle.go | 46 | `func (tm *TrashManager) MoveEx` | MoveEx 移动文件到回收站，返回操作详情 |
| go\recycle\recycle.go | 46 | `func (tm *TrashManager) MoveEx` | MoveEx 移动文件到回收站，返回操作详情 |
| go\recycle\recycle.go | 108 | `func isHardLink` | isHardLink 跨平台判断文件是否为硬链接（nlink > 1） |
| go\recycle\recycle.go | 108 | `func isHardLink` | isHardLink 跨平台判断文件是否为硬链接（nlink > 1） |
| go\recycle\recycle.go | 139 | `func (tm *TrashManager) List` | List 列出回收站中的文件 |
| go\recycle\recycle.go | 139 | `func (tm *TrashManager) List` | List 列出回收站中的文件 |
| go\recycle\recycle.go | 170 | `func (tm *TrashManager) Restore` | Restore 从回收站恢复到原目录 |
| go\recycle\recycle.go | 170 | `func (tm *TrashManager) Restore` | Restore 从回收站恢复到原目录 |
| go\recycle\recycle.go | 205 | `func (tm *TrashManager) Delete` | Delete 永久删除回收站中的文件 |
| go\recycle\recycle.go | 205 | `func (tm *TrashManager) Delete` | Delete 永久删除回收站中的文件 |
| go\recycle\recycle.go | 214 | `func (tm *TrashManager) Empty` | Empty 清空回收站 |
| go\recycle\recycle.go | 214 | `func (tm *TrashManager) Empty` | Empty 清空回收站 |
| go\recycle\recycle.go | 262 | `func copyFile` | copyFile 复制文件（跨分区兼容） |
| go\recycle\recycle.go | 262 | `func copyFile` | copyFile 复制文件（跨分区兼容） |
| go\sync\link_unix.go | 12 | `func checkHardLink` | checkHardLink 检查文件是否为硬链接（Unix/macOS 上通过 stat.Nlink 判断） |
| go\sync\link_unix.go | 12 | `func checkHardLink` | checkHardLink 检查文件是否为硬链接（Unix/macOS 上通过 stat.Nlink 判断） |
| go\sync\link_windows.go | 11 | `func checkHardLink` | checkHardLink 检查文件是否为硬链接（Windows 上通过 nlink 判断） |
| go\sync\link_windows.go | 11 | `func checkHardLink` | checkHardLink 检查文件是否为硬链接（Windows 上通过 nlink 判断） |
| go\sync\sync.go | 17 | `type ScanFunc` | ScanFunc 扫描模型（函数类型，由 app.go 注入） |
| go\sync\sync.go | 17 | `type ScanFunc` | ScanFunc 扫描模型（函数类型，由 app.go 注入） |
| go\sync\sync.go | 20 | `type ListVersionsFunc` | ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock） |
| go\sync\sync.go | 20 | `type ListVersionsFunc` | ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock） |
| go\sync\sync.go | 23 | `func GetInstanceStatus` | GetInstanceStatus 获取整合包状态（使用真实 ListVersions） |
| go\sync\sync.go | 23 | `func GetInstanceStatus` | GetInstanceStatus 获取整合包状态（使用真实 ListVersions） |
| go\sync\sync.go | 28 | `func GetInstanceStatusWith` | GetInstanceStatusWith 可注入的整合包状态获取（测试用） |
| go\sync\sync.go | 28 | `func GetInstanceStatusWith` | GetInstanceStatusWith 可注入的整合包状态获取（测试用） |
| go\sync\sync.go | 131 | `func SyncToggleStatus` | SyncToggleStatus 同步启用/禁用状态 |
| go\sync\sync.go | 131 | `func SyncToggleStatus` | SyncToggleStatus 同步启用/禁用状态 |
| go\sync\sync.go | 246 | `func HasDotMinecraftSubdirs` | HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录） |
| go\sync\sync.go | 246 | `func HasDotMinecraftSubdirs` | HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录） |
| go\sync\sync.go | 263 | `func FindMinecraftDir` | FindMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径 |
| go\sync\sync.go | 263 | `func FindMinecraftDir` | FindMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径 |
| go\sync\sync.go | 274 | `func listVanillaInstances` | listVanillaInstances 标准 .minecraft/versions/{name}/ 布局 |
| go\sync\sync.go | 274 | `func listVanillaInstances` | listVanillaInstances 标准 .minecraft/versions/{name}/ 布局 |
| go\sync\sync.go | 303 | `func listPrismInstances` | listPrismInstances PrismLauncher 布局: {instancesDir}/{name}/.minecraft/ 或 minecraft/ |
| go\sync\sync.go | 303 | `func listPrismInstances` | listPrismInstances PrismLauncher 布局: {instancesDir}/{name}/.minecraft/ 或 minecraft/ |
| go\sync\sync.go | 369 | `func isResourcePackFolder` | isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta） |
| go\sync\sync.go | 369 | `func isResourcePackFolder` | isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta） |
| go\sync\sync.go | 377 | `func SyncResources` | SyncResources 对比两个目录的资源文件差异，按文件名匹配 |
| go\sync\sync.go | 377 | `func SyncResources` | SyncResources 对比两个目录的资源文件差异，按文件名匹配 |
| go\sync\sync.go | 451 | `func isDirTypeModelFolder` | isDirTypeModelFolder 检查一个子目录是否包含 YSM/MMD 模型文件（即文件夹级资源） |
| go\sync\sync.go | 451 | `func isDirTypeModelFolder` | isDirTypeModelFolder 检查一个子目录是否包含 YSM/MMD 模型文件（即文件夹级资源） |
| go\sync\sync.go | 470 | `func isModelFile` | isModelFile 检查文件名（已 lowercase，去 .ban）是否为对应类型的模型文件 |
| go\sync\sync.go | 470 | `func isModelFile` | isModelFile 检查文件名（已 lowercase，去 .ban）是否为对应类型的模型文件 |
| go\sync\sync.go | 486 | `func SyncResourcesDirLevel` | SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹） |
| go\sync\sync.go | 486 | `func SyncResourcesDirLevel` | SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹） |
| go\sync\sync.go | 552 | `func SortEntries` | SortEntries 按名称排序模型条目 |
| go\sync\sync.go | 552 | `func SortEntries` | SortEntries 按名称排序模型条目 |
| go\sync\sync.go | 560 | `func GetLinkType` | getLinkType 判断文件的链接类型 |
| go\sync\sync.go | 560 | `func GetLinkType` | getLinkType 判断文件的链接类型 |
| go\sync\sync.go | 575 | `func isFileLocked` | isFileLocked 判断错误是否因为文件被其他进程锁定 |
| go\sync\sync.go | 575 | `func isFileLocked` | isFileLocked 判断错误是否因为文件被其他进程锁定 |
| go\sync\sync_test.go | 16 | `func mockScanDir` | mockScanDir returns a ScanFunc that returns different data based on dir. |
| go\sync\sync_test.go | 16 | `func mockScanDir` | mockScanDir returns a ScanFunc that returns different data based on dir. |
| go\tags\tags.go | 17 | `type Store` | Store 是标签存储，线程安全 |
| go\tags\tags.go | 17 | `type Store` | Store 是标签存储，线程安全 |
| go\tags\tags.go | 24 | `func NewStore` | NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取） |
| go\tags\tags.go | 24 | `func NewStore` | NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取） |
| go\tags\tags.go | 31 | `func (s *Store) load` | load 从磁盘读取 tags.json（如果存在） |
| go\tags\tags.go | 31 | `func (s *Store) load` | load 从磁盘读取 tags.json（如果存在） |
| go\tags\tags.go | 52 | `func (s *Store) save` | save 将内存数据写入磁盘 |
| go\tags\tags.go | 52 | `func (s *Store) save` | save 将内存数据写入磁盘 |
| go\tags\tags.go | 68 | `func (s *Store) GetTags` | GetTags 返回指定路径的所有标签（已排序） |
| go\tags\tags.go | 68 | `func (s *Store) GetTags` | GetTags 返回指定路径的所有标签（已排序） |
| go\tags\tags.go | 85 | `func (s *Store) SetTags` | SetTags 设置指定路径的标签列表（覆盖写入） |
| go\tags\tags.go | 85 | `func (s *Store) SetTags` | SetTags 设置指定路径的标签列表（覆盖写入） |
| go\tags\tags.go | 112 | `func (s *Store) AddTag` | AddTag 追加单个标签（不会重复） |
| go\tags\tags.go | 112 | `func (s *Store) AddTag` | AddTag 追加单个标签（不会重复） |
| go\tags\tags.go | 130 | `func (s *Store) RemoveTag` | RemoveTag 移除单个标签 |
| go\tags\tags.go | 130 | `func (s *Store) RemoveTag` | RemoveTag 移除单个标签 |
| go\tags\tags.go | 152 | `func (s *Store) ListByTag` | ListByTag 返回所有打了指定标签的文件路径列表 |
| go\tags\tags.go | 152 | `func (s *Store) ListByTag` | ListByTag 返回所有打了指定标签的文件路径列表 |
| go\tags\tags.go | 176 | `func (s *Store) AllTags` | AllTags 返回所有被使用的标签（按使用次数降序） |
| go\tags\tags.go | 176 | `func (s *Store) AllTags` | AllTags 返回所有被使用的标签（按使用次数降序） |
| go\threejs\spec.go | 55 | `func Build` | Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec |
| go\threejs\spec.go | 55 | `func Build` | Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec |
| go\threejs\spec.go | 443 | `func mergeCubes` | mergeCubes 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加 |
| go\threejs\spec.go | 443 | `func mergeCubes` | mergeCubes 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加 |
| go\threejs\spec.go | 467 | `func cubesOverlap` | cubesOverlap 判断两个 cube 是否在空间上重叠（origin + size + rotation 均相等） |
| go\threejs\spec.go | 467 | `func cubesOverlap` | cubesOverlap 判断两个 cube 是否在空间上重叠（origin + size + rotation 均相等） |
| go\threejs\spec.go | 489 | `func parseUV` | face order: east(0), west(1), up(2), down(3), south(4), north(5) |
| go\threejs\spec.go | 489 | `func parseUV` | face order: east(0), west(1), up(2), down(3), south(4), north(5) |
| go\threejs\spec.go | 500 | `func expandBoxUV` | expandBoxUV 对应 YSMViewer MinecraftCubeUV.Expand() |
| go\threejs\spec.go | 500 | `func expandBoxUV` | expandBoxUV 对应 YSMViewer MinecraftCubeUV.Expand() |
| go\threejs\spec.go | 540 | `func parseFaceUV` | parseFaceUV 对应 YSMViewer GetFaceUV() — 每面独立 UV |
| go\threejs\spec.go | 540 | `func parseFaceUV` | parseFaceUV 对应 YSMViewer GetFaceUV() — 每面独立 UV |
| go\threejs\spec.go | 580 | `func eulerToQuaternion` | eulerToQuaternion 对应 YSMViewer CreateBlockbenchQuaternion() |
| go\threejs\spec.go | 580 | `func eulerToQuaternion` | eulerToQuaternion 对应 YSMViewer CreateBlockbenchQuaternion() |
| go\types\bedrock.go | 4 | `type BedrockModel` | BedrockModel 基岩版模型几何体摘要（用于 2D 预览） |
| go\types\bedrock.go | 4 | `type BedrockModel` | BedrockModel 基岩版模型几何体摘要（用于 2D 预览） |
| go\types\bedrock.go | 17 | `type Bone2D` | Bone2D 骨骼简化信息（只用于 2D 线条图） |
| go\types\bedrock.go | 17 | `type Bone2D` | Bone2D 骨骼简化信息（只用于 2D 线条图） |
| go\types\bedrock.go | 27 | `type Cube2D` | Cube2D 立方体信息 |
| go\types\bedrock.go | 27 | `type Cube2D` | Cube2D 立方体信息 |
| go\types\config.go | 4 | `type AppConfig` | AppConfig 应用持久化配置 |
| go\types\config.go | 4 | `type AppConfig` | AppConfig 应用持久化配置 |
| go\types\config.go | 31 | `type PackInfo` | PackInfo 模型整合包信息（ysm-pack.json） |
| go\types\config.go | 31 | `type PackInfo` | PackInfo 模型整合包信息（ysm-pack.json） |
| go\types\config.go | 38 | `type WorkshopPresetSearch` | WorkshopPresetSearch 预设搜索词 |
| go\types\config.go | 38 | `type WorkshopPresetSearch` | WorkshopPresetSearch 预设搜索词 |
| go\types\config.go | 44 | `type WorkshopSite` | WorkshopSite 创意工坊站点配置 |
| go\types\config.go | 44 | `type WorkshopSite` | WorkshopSite 创意工坊站点配置 |
| go\types\config.go | 57 | `type WorkshopCreator` | WorkshopCreator 创作者条目 |
| go\types\config.go | 57 | `type WorkshopCreator` | WorkshopCreator 创作者条目 |
| go\types\extensions.go | 13 | `func AllExts` | AllExts 返回所有支持的扩展名（去重后） |
| go\types\extensions.go | 13 | `func AllExts` | AllExts 返回所有支持的扩展名（去重后） |
| go\types\extensions.go | 29 | `func IsSupportedExt` | IsSupportedExt 检查扩展名是否被任何资源类型支持 |
| go\types\extensions.go | 29 | `func IsSupportedExt` | IsSupportedExt 检查扩展名是否被任何资源类型支持 |
| go\types\extensions.go | 43 | `func ExtBelongsTo` | ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个） |
| go\types\extensions.go | 43 | `func ExtBelongsTo` | ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个） |
| go\types\extensions.go | 58 | `func SupportedExtsForType` | SupportedExtsForType 返回指定资源类型的所有扩展名 |
| go\types\extensions.go | 58 | `func SupportedExtsForType` | SupportedExtsForType 返回指定资源类型的所有扩展名 |
| go\types\extensions.go | 72 | `func FindInstDir` | FindInstDir 查找整合包中指定资源类型的子目录： |
| go\types\extensions.go | 72 | `func FindInstDir` | FindInstDir 查找整合包中指定资源类型的子目录： |
| go\types\extensions.go | 115 | `func StorageSubDir` | StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录 |
| go\types\extensions.go | 115 | `func StorageSubDir` | StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录 |
| go\types\extensions.go | 123 | `type SubDirEntry` | SubDirEntry 资源类型的版本子目录信息 |
| go\types\extensions.go | 123 | `type SubDirEntry` | SubDirEntry 资源类型的版本子目录信息 |
| go\types\extensions.go | 129 | `func SubDirMap` | SubDirMap 返回指定资源类型在整合包实例版本目录中的扫描子目录 |
| go\types\extensions.go | 129 | `func SubDirMap` | SubDirMap 返回指定资源类型在整合包实例版本目录中的扫描子目录 |
| go\types\extensions.go | 141 | `func SubDirAll` | SubDirAll 返回所有资源类型在整合包实例中的版本扫描子目录映射 |
| go\types\extensions.go | 141 | `func SubDirAll` | SubDirAll 返回所有资源类型在整合包实例中的版本扫描子目录映射 |
| go\types\extensions.go | 153 | `func AllSubDirs` | AllSubDirs 返回所有资源类型的版本子目录信息（遍历用） |
| go\types\extensions.go | 153 | `func AllSubDirs` | AllSubDirs 返回所有资源类型的版本子目录信息（遍历用） |
| go\types\resource.go | 12 | `type ResourceTypeRegistry` | ResourceTypeRegistry 资源类型注册表 |
| go\types\resource.go | 12 | `type ResourceTypeRegistry` | ResourceTypeRegistry 资源类型注册表 |
| go\types\resource.go | 17 | `type ResourceType` | ResourceType 一种受支持的资源类型定义 |
| go\types\resource.go | 17 | `type ResourceType` | ResourceType 一种受支持的资源类型定义 |
| go\types\resource.go | 39 | `func SetRegistryPath` | SetRegistryPath 设置注册表文件路径（仅测试用） |
| go\types\resource.go | 39 | `func SetRegistryPath` | SetRegistryPath 设置注册表文件路径（仅测试用） |
| go\types\resource.go | 48 | `func LoadRegistry` | LoadRegistry 加载资源类型注册表 |
| go\types\resource.go | 48 | `func LoadRegistry` | LoadRegistry 加载资源类型注册表 |
| go\types\resource.go | 67 | `func RegistryType` | RegistryType 按 id 查找资源类型，不存在时返回 nil |
| go\types\resource.go | 67 | `func RegistryType` | RegistryType 按 id 查找资源类型，不存在时返回 nil |
| go\types\resource.go | 78 | `type FormatRange` | FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]） |
| go\types\resource.go | 78 | `type FormatRange` | FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]） |
| go\types\resource.go | 84 | `func (fr *FormatRange) UnmarshalJSON` | UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式 |
| go\types\resource.go | 84 | `func (fr *FormatRange) UnmarshalJSON` | UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式 |
| go\types\resource.go | 120 | `func descString` | descString 从 json.RawMessage 提取可读的描述文本 |
| go\types\resource.go | 120 | `func descString` | descString 从 json.RawMessage 提取可读的描述文本 |
| go\types\resource.go | 167 | `type PackMeta` | PackMeta 资源包信息（来自 pack.mcmeta） |
| go\types\resource.go | 167 | `type PackMeta` | PackMeta 资源包信息（来自 pack.mcmeta） |
| go\types\resource.go | 178 | `func (pm *PackMeta) Desc` | Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组） |
| go\types\resource.go | 178 | `func (pm *PackMeta) Desc` | Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组） |
| go\types\resource.go | 185 | `type LitematicMeta` | LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound） |
| go\types\resource.go | 185 | `type LitematicMeta` | LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound） |
| go\types\resource.go | 202 | `type LitematicBlockStat` | LitematicBlockStat 方块类型统计 |
| go\types\resource.go | 202 | `type LitematicBlockStat` | LitematicBlockStat 方块类型统计 |
| go\types\resource.go | 208 | `type LitematicVoxelData` | LitematicVoxelData 体素渲染数据 |
| go\types\resource.go | 208 | `type LitematicVoxelData` | LitematicVoxelData 体素渲染数据 |
| go\types\resource.go | 216 | `type VoxelGroup` | VoxelGroup 同一颜色的方块组 |
| go\types\resource.go | 216 | `type VoxelGroup` | VoxelGroup 同一颜色的方块组 |
| go\types\types.go | 6 | `type WindowState` | WindowState 窗口位置 |
| go\types\types.go | 6 | `type WindowState` | WindowState 窗口位置 |
| go\types\types.go | 14 | `type AuthorInfo` | AuthorInfo 作者信息（含模型计数） |
| go\types\types.go | 14 | `type AuthorInfo` | AuthorInfo 作者信息（含模型计数） |
| go\types\types.go | 21 | `type ModelEntry` | ModelEntry 模型文件条目 |
| go\types\types.go | 21 | `type ModelEntry` | ModelEntry 模型文件条目 |
| go\types\types.go | 32 | `type VersionInstance` | VersionInstance 整合包信息 |
| go\types\types.go | 32 | `type VersionInstance` | VersionInstance 整合包信息 |
| go\types\types.go | 40 | `type SearchResult` | SearchResult 模型搜索结果 |
| go\types\types.go | 40 | `type SearchResult` | SearchResult 模型搜索结果 |
| go\types\types.go | 51 | `type ImportLog` | ImportLog 导入日志 |
| go\types\types.go | 51 | `type ImportLog` | ImportLog 导入日志 |
| go\types\types.go | 62 | `type LinkType` | LinkType 链接类型 |
| go\types\types.go | 62 | `type LinkType` | LinkType 链接类型 |
| go\types\types.go | 72 | `type CustomFileInfo` | CustomFileInfo custom 目录下的文件信息 |
| go\types\types.go | 72 | `type CustomFileInfo` | CustomFileInfo custom 目录下的文件信息 |
| go\types\types.go | 78 | `type InstanceStatus` | InstanceStatus 整合包状态 |
| go\types\types.go | 78 | `type InstanceStatus` | InstanceStatus 整合包状态 |
| go\types\types.go | 113 | `type ResourceSyncResult` | ResourceSyncResult 资源同步结果 |
| go\types\types.go | 113 | `type ResourceSyncResult` | ResourceSyncResult 资源同步结果 |
| go\types\types.go | 120 | `type SyncStatus` | SyncStatus 资源文件同步状态 |
| go\types\types.go | 120 | `type SyncStatus` | SyncStatus 资源文件同步状态 |
| go\types\types.go | 131 | `type ResourceSyncItem` | ResourceSyncItem 单个资源文件的同步状态 |
| go\types\types.go | 131 | `type ResourceSyncItem` | ResourceSyncItem 单个资源文件的同步状态 |
| go\updater\update.go | 35 | `type ReleaseAsset` | ReleaseAsset GitHub Release 中的文件 |
| go\updater\update.go | 35 | `type ReleaseAsset` | ReleaseAsset GitHub Release 中的文件 |
| go\updater\update.go | 41 | `type Release` | Release GitHub Release 信息 |
| go\updater\update.go | 41 | `type Release` | Release GitHub Release 信息 |
| go\updater\update.go | 50 | `type UpdateInfo` | UpdateInfo 更新信息（序列化给前端） |
| go\updater\update.go | 50 | `type UpdateInfo` | UpdateInfo 更新信息（序列化给前端） |
| go\updater\update.go | 61 | `func assetPattern` | assetPattern 返回当前系统匹配的 asset 名 |
| go\updater\update.go | 61 | `func assetPattern` | assetPattern 返回当前系统匹配的 asset 名 |
| go\updater\update.go | 71 | `func Check` | Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志） |
| go\updater\update.go | 71 | `func Check` | Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志） |
| go\updater\update.go | 150 | `func Download` | Download 下载更新包到临时目录，返回 zip 路径。 |
| go\updater\update.go | 150 | `func Download` | Download 下载更新包到临时目录，返回 zip 路径。 |
| go\updater\update.go | 199 | `func CleanupOldVersion` | CleanupOldVersion 启动时清理上一次更新留下的 .old 文件 |
| go\updater\update.go | 199 | `func CleanupOldVersion` | CleanupOldVersion 启动时清理上一次更新留下的 .old 文件 |
| go\updater\update.go | 214 | `func InstallUpdate` | InstallUpdate 解压更新包并通过 helper 进程替换当前 exe。 |
| go\updater\update.go | 214 | `func InstallUpdate` | InstallUpdate 解压更新包并通过 helper 进程替换当前 exe。 |
| go\updater\update.go | 308 | `func extractZipFile` | extractZipFile 解压 zip 中的单个文件到目标路径（限制解压大小 200MB） |
| go\updater\update.go | 308 | `func extractZipFile` | extractZipFile 解压 zip 中的单个文件到目标路径（限制解压大小 200MB） |
| go\updater\update.go | 359 | `func extractEmbeddedHelper` | extractEmbeddedHelper 将内嵌的 ysm-updater-helper.exe 释放到目标路径 |
| go\updater\update.go | 359 | `func extractEmbeddedHelper` | extractEmbeddedHelper 将内嵌的 ysm-updater-helper.exe 释放到目标路径 |
| go\updater\update.go | 368 | `func fetchExpectedHash` | fetchExpectedHash 从 SHA256SUMS 文件中解析指定文件名的 hash |
| go\updater\update.go | 368 | `func fetchExpectedHash` | fetchExpectedHash 从 SHA256SUMS 文件中解析指定文件名的 hash |
| go\watcher\watcher.go | 16 | `type ScanFunc` | ScanFunc matches mdsync.ScanFunc |
| go\watcher\watcher.go | 16 | `type ScanFunc` | ScanFunc matches mdsync.ScanFunc |
| go\watcher\watcher.go | 22 | `type Watcher` | Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包 |
| go\watcher\watcher.go | 22 | `type Watcher` | Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包 |
| go\watcher\watcher.go | 35 | `func New` | New 创建文件监听器 |
| go\watcher\watcher.go | 35 | `func New` | New 创建文件监听器 |
| go\watcher\watcher.go | 50 | `func (w *Watcher) Start` | Start 开始监听 |
| go\watcher\watcher.go | 50 | `func (w *Watcher) Start` | Start 开始监听 |
| go\watcher\watcher.go | 91 | `func (w *Watcher) Stop` | Stop 停止监听 |
| go\watcher\watcher.go | 91 | `func (w *Watcher) Stop` | Stop 停止监听 |
| go\watcher\watcher.go | 109 | `func (w *Watcher) IsRunning` | IsRunning 返回是否正在运行 |
| go\watcher\watcher.go | 109 | `func (w *Watcher) IsRunning` | IsRunning 返回是否正在运行 |
| go\watcher\watcher.go | 140 | `func (w *Watcher) debounceSync` | debounceSync 防抖触发同步 |
| go\watcher\watcher.go | 140 | `func (w *Watcher) debounceSync` | debounceSync 防抖触发同步 |
| go\watcher\watcher.go | 150 | `func (w *Watcher) syncAll` | syncAll 同步所有整合包的启用/禁用状态 |
| go\watcher\watcher.go | 150 | `func (w *Watcher) syncAll` | syncAll 同步所有整合包的启用/禁用状态 |
| go\watcher\watcher_test.go | 16 | `func setupMinecraftRoot` | setupMinecraftRoot 创建一个伪 mcRoot，含 versions/{name}/config/yes_steve_model/custom/ 结构 |
| go\watcher\watcher_test.go | 16 | `func setupMinecraftRoot` | setupMinecraftRoot 创建一个伪 mcRoot，含 versions/{name}/config/yes_steve_model/custom/ 结构 |
| go\ysm\cli.go | 11 | `func FindCLI` | FindCLI 查找 YSMParser.exe 可执行文件路径 |
| go\ysm\cli.go | 11 | `func FindCLI` | FindCLI 查找 YSMParser.exe 可执行文件路径 |
| go\ysm\extracted.go | 21 | `func FindGeometryInExtractedYSM` | FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理 |
| go\ysm\extracted.go | 21 | `func FindGeometryInExtractedYSM` | FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理 |
| go\ysm\header.go | 12 | `type YSMHeader` | YSMHeader 从 YSM 文件文本头部提取的元数据（适用于加密和非加密模型） |
| go\ysm\header.go | 12 | `type YSMHeader` | YSMHeader 从 YSM 文件文本头部提取的元数据（适用于加密和非加密模型） |
| go\ysm\header.go | 42 | `func scanHeader` | scanHeader 从 bufio.Scanner 读取 YSM 头部，提取元数据 |
| go\ysm\header.go | 42 | `func scanHeader` | scanHeader 从 bufio.Scanner 读取 YSM 头部，提取元数据 |
| go\ysm\header.go | 167 | `func AnalyzeYSMHeader` | AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据 |
| go\ysm\header.go | 167 | `func AnalyzeYSMHeader` | AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据 |
| go\ysm\header.go | 228 | `func hasTextHeader` | hasTextHeader 检查 YSGP 文件是否包含可读的文本头部 |
| go\ysm\header.go | 228 | `func hasTextHeader` | hasTextHeader 检查 YSGP 文件是否包含可读的文本头部 |
| go\ysm\header.go | 260 | `func detectYSGPHeader` | detectYSGPHeader 检测 YSGP（YSM V2）二进制格式并提取基本信息 |
| go\ysm\header.go | 260 | `func detectYSGPHeader` | detectYSGPHeader 检测 YSGP（YSM V2）二进制格式并提取基本信息 |
| go\ysm\header.go | 320 | `func AnalyzeYSMHeaderFromBytes` | AnalyzeYSMHeaderFromBytes 从字节数据解析 YSM 头部（适用于 base64 导入场景） |
| go\ysm\header.go | 320 | `func AnalyzeYSMHeaderFromBytes` | AnalyzeYSMHeaderFromBytes 从字节数据解析 YSM 头部（适用于 base64 导入场景） |
| go\ysm\header.go | 356 | `func stripClosingTag` | stripClosingTag removes the closing XML tag from a value string. |
| go\ysm\header.go | 356 | `func stripClosingTag` | stripClosingTag removes the closing XML tag from a value string. |
| go\ysm\parse.go | 13 | `type YSMModelMeta` | YSMModelMeta 模型元数据（从 model.json 提取） |
| go\ysm\parse.go | 13 | `type YSMModelMeta` | YSMModelMeta 模型元数据（从 model.json 提取） |
| go\ysm\parse.go | 27 | `type ysmModelJSON` | 内部用——model.json 的完整结构（只关心需要的字段） |
| go\ysm\parse.go | 27 | `type ysmModelJSON` | 内部用——model.json 的完整结构（只关心需要的字段） |
| go\ysm\parse.go | 43 | `func AnalyzeYSMModel` | AnalyzeYSMModel 解析 .ysm 文件，提取模型元数据 |
| go\ysm\parse.go | 43 | `func AnalyzeYSMModel` | AnalyzeYSMModel 解析 .ysm 文件，提取模型元数据 |
| go\ysm\summary.go | 45 | `type YsmSummary` | YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要 |
| go\ysm\summary.go | 45 | `type YsmSummary` | YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要 |
| go\ysm\summary.go | 131 | `func ExtractYsmSummary` | ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要 |
| go\ysm\summary.go | 131 | `func ExtractYsmSummary` | ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要 |
| go\ysm\summary.go | 417 | `func extractTexSizeFromGeometry` | 解析 bedrock geometry JSON 的纹理尺寸 |
| go\ysm\summary.go | 417 | `func extractTexSizeFromGeometry` | 解析 bedrock geometry JSON 的纹理尺寸 |
| go\ysm\summary.go | 433 | `func extractFileStats` | 从 files.player 统计纹理、模型主体、动画数量，并收集几何体文件路径 |
| go\ysm\summary.go | 433 | `func extractFileStats` | 从 files.player 统计纹理、模型主体、动画数量，并收集几何体文件路径 |
| go\ysm\summary.go | 498 | `func extractKeys` | 从 extra_animation 对象中提取键名列表 |
| go\ysm\summary.go | 498 | `func extractKeys` | 从 extra_animation 对象中提取键名列表 |
| go\ysm\summary.go | 525 | `func extractDisplayValues` | 从 extra_animation map 提取中文显示名 |
| go\ysm\summary.go | 525 | `func extractDisplayValues` | 从 extra_animation map 提取中文显示名 |
| go\ysm\summary.go | 563 | `func extractControlTypes` | 从 config_forms 提取控件类型摘要 |
| go\ysm\summary.go | 563 | `func extractControlTypes` | 从 config_forms 提取控件类型摘要 |
| go\ysm\summary.go | 589 | `func truncate` | 截断字符串 |
| go\ysm\summary.go | 589 | `func truncate` | 截断字符串 |
| go\ysm\summary.go | 597 | `func isYSGP` | isYSGP 检测文件是否是 YSGP（YSM V2）二进制格式（支持带 BOM 的变体） |
| go\ysm\summary.go | 597 | `func isYSGP` | isYSGP 检测文件是否是 YSGP（YSM V2）二进制格式（支持带 BOM 的变体） |
| go\ysm\texsize.go | 14 | `type TexInfo` | TexInfo 轻量级纹理尺寸（不解析完整模型） |
| go\ysm\texsize.go | 14 | `type TexInfo` | TexInfo 轻量级纹理尺寸（不解析完整模型） |
| go\ysm\texsize.go | 22 | `func ScanModelTexSizes` | ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM |
| go\ysm\texsize.go | 22 | `func ScanModelTexSizes` | ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM |
| go\ysm\texsize.go | 37 | `type ModelEntry` | ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径） |
| go\ysm\texsize.go | 37 | `type ModelEntry` | ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径） |
| go\ysm\texsize.go | 43 | `func readTexSizeFromFile` | readTexSizeFromFile 从文件读取纹理尺寸，不解析模型骨骼 |
| go\ysm\texsize.go | 43 | `func readTexSizeFromFile` | readTexSizeFromFile 从文件读取纹理尺寸，不解析模型骨骼 |
| go\ysm\texsize.go | 57 | `func readTexFromZip` | readTexFromZip 从 zip 中提取 geometry JSON 读取纹理尺寸 |
| go\ysm\texsize.go | 57 | `func readTexFromZip` | readTexFromZip 从 zip 中提取 geometry JSON 读取纹理尺寸 |
| go\ysm\texsize.go | 106 | `func readTexFrom7z` | readTexFrom7z 尝试从 7z 读取纹理尺寸（简化为仅扫描第一层） |
| go\ysm\texsize.go | 106 | `func readTexFrom7z` | readTexFrom7z 尝试从 7z 读取纹理尺寸（简化为仅扫描第一层） |
| go\ysm\texsize.go | 130 | `func extractTexSizeFromGeometryBytes` | extractTexSizeFromGeometryBytes 从 geometry JSON 字节提取纹理尺寸 |
| go\ysm\texsize.go | 130 | `func extractTexSizeFromGeometryBytes` | extractTexSizeFromGeometryBytes 从 geometry JSON 字节提取纹理尺寸 |
| go\ysm\texsize.go | 146 | `func ScanFiles` | ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用） |
| go\ysm\texsize.go | 146 | `func ScanFiles` | ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用） |
| go\ysm\ysm.go | 12 | `func IsYSMJar` | IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml） |
| go\ysm\ysm.go | 12 | `func IsYSMJar` | IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml） |
| go\ysm\ysm.go | 71 | `func HasYSMMod` | HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP） |
| go\ysm\ysm.go | 71 | `func HasYSMMod` | HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP） |
| go\ysm\ysm.go | 100 | `func HasModInDir` | HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar |
| go\ysm\ysm.go | 100 | `func HasModInDir` | HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar |
| proxy.go | 22 | `func (a *App) StartProxy` | StartProxy 启动本地反代服务器（127.0.0.1 仅本机可访问） |
| proxy.go | 44 | `func (a *App) StopProxy` | StopProxy 关闭反代服务器 |
| proxy.go | 59 | `func (a *App) IsProxyRunning` | IsProxyRunning 检查代理是否运行中 |
| proxy.go | 130 | `func rewriteRelativeURLs` | rewriteRelativeURLs 将 HTML 中的相对路径改写为绝对路径 |
| proxy.go | 171 | `func isAbsolute` | isAbsolute 判断路径是否为绝对/外部链接，无需改写 |
| proxy.go | 183 | `func rewriteSrcset` | rewriteSrcset 处理 srcset 属性中的相对路径 |
| resource_bindings.go | 23 | `func (a *App) LoadResourceTypes` | LoadResourceTypes 加载资源类型注册表 |
| resource_bindings.go | 32 | `func (a *App) ReadPackMeta` | ReadPackMeta 读取资源包信息（pack.mcmeta + pack.png） |
| resource_bindings.go | 57 | `func (a *App) ReadShaderpackLang` | ReadShaderpackLang 读取光影包 lang/en_US.lang 提取显示名 |
| resource_bindings.go | 64 | `func marshalVoxelData` | marshalVoxelData 调用体素构建函数并序列化为 JSON。 |
| resource_bindings.go | 75 | `func (a *App) voxelMaxBlocks` | voxelMaxBlocks 从配置读取体素渲染上限，未设置时默认 200000。 |
| resource_bindings.go | 84 | `func (a *App) GetNbtVoxelData` | GetNbtVoxelData 读取 .nbt 结构文件体素数据 |
| resource_bindings.go | 89 | `func (a *App) GetSchematicVoxelData` | GetSchematicVoxelData 读取 .schematic 文件体素数据 |
| resource_bindings.go | 94 | `func (a *App) ReadSchematic` | ReadSchematic 读取 .schematic 文件基本信息 |
| resource_bindings.go | 104 | `func (a *App) ReadNbtStructure` | ReadNbtStructure 读取 .nbt 结构文件基本信息 |
| resource_bindings.go | 114 | `func (a *App) ReadLitematicMeta` | ReadLitematicMeta 读取投影文件元数据（作者/时间/版本/方块统计/预览图） |
| resource_bindings.go | 125 | `func (a *App) GetLitematicVoxelData` | GetLitematicVoxelData 读取投影文件体素数据（按颜色分组的方块位置） |
| resource_bindings.go | 130 | `func (a *App) SetVoxelMaxBlocks` | SetVoxelMaxBlocks 设置 3D 体素渲染上限，0=恢复默认 200000 |
| resource_bindings.go | 137 | `func (a *App) DetectResourceType` | DetectResourceType 检测指定文件的资源类型 |
| resource_bindings.go | 146 | `func (a *App) GetRepoRoot` | GetRepoRoot 根据资源类型返回对应的仓库根目录 |
| resource_bindings.go | 167 | `func specificRoot` | specificRoot 返回资源类型的专属覆写路径，从 resource_types.json 注册表驱动 |
| resource_bindings.go | 185 | `func (a *App) ToggleResourcePack` | ToggleResourcePack 切换资源包的启用/禁用状态（.zip ↔ .zip.disabled） |
| resource_bindings.go | 202 | `func (a *App) IsResourcePackEnabled` | IsResourcePackEnabled 检查资源包是否启用 |
| resource_bindings.go | 207 | `func (a *App) SelectImportZip` | SelectImportZip 打开文件选择器选取 .zip 文件 |
| resource_bindings.go | 222 | `func (a *App) SelectImportFile` | SelectImportFile 打开文件选择器，按给定扩展名过滤 |
| resource_bindings.go | 247 | `func (a *App) SetResourceRoot` | SetResourceRoot 设置指定资源类型的自定义根路径（空=恢复默认） |
| resource_bindings.go | 271 | `func (a *App) ResetResourceRoot` | ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值） |
| resource_bindings.go | 276 | `func (a *App) saveConfig` | saveConfig 写入配置到文件 |
| resource_bindings.go | 297 | `func (a *App) ImportResourcePack` | ImportResourcePack 使用策略模式导入资源包 |
| resource_bindings.go | 310 | `func (a *App) ImportByType` | ImportByType 统一导入入口——根据资源类型自动选择导入策略 |
| resource_bindings.go | 323 | `func (a *App) DeleteResourcePack` | DeleteResourcePack 删除资源包文件 |
| resource_bindings.go | 328 | `func (a *App) DeleteModelDir` | DeleteModelDir 删除文件夹型资源（MMD 模型等），删除文件所在父文件夹 |
| resource_bindings.go | 333 | `func (a *App) FindDuplicateFiles` | FindDuplicateFiles 扫描目录返回所有重复文件分组（JSON 字符串） |
| resource_bindings.go | 343 | `func (a *App) CountDuplicateFiles` | CountDuplicateFiles 快速统计重复文件数量 |
| resource_bindings.go | 353 | `func (a *App) InvalidateScanCache` | InvalidateScanCache 清空扫描缓存，下次扫描获取最新数据 |
| resource_bindings.go | 359 | `func (a *App) InstallResourceToInstance` | InstallResourceToInstance 将资源文件安装到指定整合包 |
| wasm_decoder.go | 43 | `func decodeYSMViaNodeJS` | decodeYSMViaNodeJS 用 Node.js + WASM 解码 .ysm 文件 |
| wasm_embed.go | 14 | `func (a *App) GetWasmBinary` | GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用） |
| wasm_embed.go | 19 | `func getWasmBinary` | getWasmBinary 包级函数（供 CLI 使用） |
| wasm_embed.go | 24 | `func getGlueCode` | getGlueCode 返回内嵌的 YSMParser.js 胶水代码（供 CLI Node.js 解码使用） |