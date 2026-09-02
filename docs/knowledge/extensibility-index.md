---
kind: extensibility-index
name: 可拓展点发掘索引（extensibility inventory）
tier: architecture
category: config
use_when:
  - 可拓展点
  - 扩展入口
  - 硬编码
  - 重复实现
  - 插件化
affected: false
status: superseded
last_verified: 2026-09-01
---

<!-- 本文件为一次性发掘成果，由 AtomCode 于 2026-08-15 派发 6 个 explore 子代理汇总而成。非自动生成；如需更新请新增批次。 -->

# 可拓展点发掘索引（extensibility inventory）

> ⚠️ **批次 1 快照（2026-08-15）**：本卡为 6 个 explore 子代理的输出汇总，此后又经 ADR-064/065/067/068/069 + web M1/M2 闭环了 Top 10 的 60%。状态对账见 [extensibility-index-reconciliation.md](./extensibility-index-reconciliation.md)（2026-08-17）；新拓展点探索见 [extensibility-round2.md](./extensibility-round2.md)（2026-08-16+）。

> 范围：YSM model manager 全量非测试源码（frontend/src/** + go/**），323 TS + 181 Go 文件。
> 方法：6 个 explore 子代理按模块边界并行深读，输出按「现状 → 可拓展为 → 价值」三元组。
> 分类口径：①硬编码常量 ②未抽离重复 ③缺扩展点分支 ④未充分利用抽象 ⑤缺配置项/钩子 ⑥可插件化管线。
> 价值：低/中/高 —— 综合改造成本与收益频次的主观判断，仅作排期参考。

---

## 批次 2（2026-08-16）：对账 + Round 2 探索

> 本轮（ADR-064/065/067/068 + 硬编码清理 c30fb366 + 目录解析锚定 d517113c + web M1/M2 93cb0e8b）闭环了批次 1 Top 10 的 **60%**。
> 对账详情（逐条已闭环/存活/部分，grep 实测当前 HEAD 行号）：`extensibility-index-reconciliation.md`
> 新拓展点探索（4 维度扩展入口 + Top 10 新建议 + 残留清单）：`extensibility-round2.md`

**批次 1 Top 10 状态**：✅ 闭环 #3（文件夹级判定）/ #5（ShouldHashExt）/ #6（browser-adapter 装配）/ #7（import-dnd）/ #8（app-modules loadView）/ #10（/web 正则）；🔄 部分 #2（双检测器并存）/ #4（copyFile 6 处 wrapper 未收尽，installer 已收敛）/ #9（无显式 hook 指针）；⏸ N/A #1（RenderSession 独立立项）。

**未触达（下一批候选）**：3D 渲染管线（preview-3d 全部硬编码）、test-utils 重复模式、wasm 胶水层、Go 低价值阈值常量（MaxImportSize/CHECK_INTERVAL/logs 阈值未入 AppConfig）。

**⭐ 最痛残留（加新类型必改，见 extensibility-round2.md §残留清单）**：前端 `RESOURCE_TYPES` 键 / `RESOURCE_TYPE_LABELS` / `icon.ts` 图标 / `PREVIEW_HANDLERS` / 侧栏顶部 tab 5 处**每次必改**——待从 `resource_types.json` 派生（round2 Top 10 建议 #1-4/#7）。

## 跨模块 Top 10（按价值降序）

| # | 类型 | 位置 | 一句话 | 价值 |
|---|------|------|--------|------|
| 1 | ①+⑥ | `frontend/src/preview-3d/model3d.ts` 全文 | RenderSession 完整对象化（camera/renderer/controls/container 收敛 + 16 回调方法化，~数百处引用）——**已裁决独立立项待启动，勿在常规轮次内 rush**（陷阱 #11 高危） | 高 |
| 2 | ⑥ | `go/importer/importer_file.go` + `go/packs/mcmeta.go` | 两套资源类型检测器并存，均应注册表驱动；新增类型须改两处 | 高 |
| 3 | ③ | `go/sync/sync_dirlevel.go` / `sync_push.go` / `instance.go` / `installer.go` | 文件夹级/目录型 rtype 判定 6+ 处硬编码，应改用 registry `isDir` | 高 |
| 4 | ② | `go/fsutil/` `copyFile×6` / `copyDirRecursive×4` | 原子复制原语成对重复，应收敛进 fsutil | 高 |
| 5 | ③ | `go/types/extensions.go` `ShouldHashExt` + scanner 内嵌 CI 清单 | 哈希白名单硬编码 switch，文件头声称注册表驱动唯独此处例外；新增类型须改 2 处 Go + 1 处 CI | 高 |
| 6 | ⑥ | `frontend/src/backend/browser-adapter.ts` `webImpls` | 40+ binding 手写大对象字面量，应改 binding 注册表（各职责模块自注册 + 元数据门控） | 高 |
| 7 | ② | `frontend/src/features/import-dnd.ts` 与 `import-queue-events.ts` | 网页版导入块在 4 处近逐字重复，已有细微漂移（folderInput 分支缺 stats:refresh） | 高 |
| 8 | ② | `frontend/src/app-modules.ts` 动态加载块 | 5 个 Web Component 动态加载 catch 模板逐字重复，应抽 `loadView(name, importFn)` | 高 |
| 9 | ④ | `go/types/resource.go` `ResourceType` | 纯数据无 Go 层 hook 字段，importer/packs 的扩展点无法从 JSON 表达；增加 `plugin`/`handlerRef` 字段可打通三处硬编码根 | 高 |
| 10 | ② | `/web` 虚拟根路径解析正则散落 5 处（`web-fs.ts` + `browser-adapter.ts`） | 基于 WEB_ROOT 的统一路径模块 | 高 |

---

## 一、`frontend/src/backend/`（10 文件）

### 1.1 `app.ts` 动态 import 路径 — ①硬编码常量
- 现状：动态 import 路径 `../../bindings/ysm-model-manager/internal/app/app.js` 与模块名硬编码。
- 可拓展为：提升为构建注入常量/重导出文件。
- 价值：中（绑定改名时全站 bridge 断裂）。

### 1.2 `app.ts` 后端解析 if 链 — ③缺扩展点分支
- 现状：browser → `window.go.main.App` → 动态 import 三分支 if 链。
- 可拓展为：后端解析器注册链（按序尝试 + 测试可注册自定义 resolver）。
- 价值：中。

### 1.3 `types.ts` `AppBindings` — ①硬编码常量
- 现状：`AppBindings` 直接 `typeof import("../../bindings/...")`，与 1.1 同源路径写两处。
- 可拓展为：绑定路径集中到单一重导出文件。
- 价值：中。

### 1.4 `browser-adapter.ts` `webImpls` — ⑥可插件化管线（Top 6）
- 现状：`webImpls` 是 40+ binding 手写大对象字面量。
- 可拓展为：binding 注册表（各职责模块自注册 + 能力门控标记 + web-only 标记），adapter 只做 Proxy 装配。
- 价值：高。

### 1.5 `browser-adapter.ts` `WebImplGoKeys` — ①硬编码常量
- 现状：`type WebImplGoKeys = Exclude<...,"SelectLocalRepo"|"GetFsaAuthState">` 白名单字面量。
- 可拓展为：注册表打 `webOnly` 标记，类型对账自动排除。
- 价值：中。

### 1.6 `browser-adapter.ts` `GetAppVersion/CurrentVersion` — ①硬编码常量
- 现状：`GetAppVersion/CurrentVersion` 硬编码返回 `"web"`。
- 可拓展为：构建注入版本号，与桌面同源。
- 价值：低-中。

### 1.7 `browser-adapter.ts` `GetRepoRoot`/`DeleteModelDir` — ③缺扩展点分支
- 现状：`GetRepoRoot` 路径净化 `rtype.replace(/\//g,"_")` 与 `DeleteModelDir` 的 `/^\/web\/([^/]+)\/.+$/` 正则内联。
- 可拓展为：路径规约模块化。
- 价值：中。

### 1.8 `web-fs.ts` 多处 — ①②③（见子代理汇报）
- IDB key 规约 `dir:/file:/ban:/tags:` 跨 `web-fs.ts` ↔ `web-store.ts` ↔ `idb.ts` 字符串耦合 → 集中 key-schema 模块（高）。
- 主文件判定 `mainFileRank` 无视 `resource_types.json` 的 extensions/detector → 配置驱动注册表（高）。
- `importWebFiles` 138 行固定管线（expand → 分组 → 主目录收敛 → 写入回滚）→ 管线步骤化（中）。
- `INVALID_NAME_CHARS` Windows 非法字符集硬编码 → 与桌面 fileops 契约对齐是硬约束，放开反危险（低）。

### 1.9 `web-store.ts` 多处 — ①⑤
- `WEB_IMPORT_LOG_CAP=500`/`WEB_RUNTIME_LOG_CAP=300`/`CFG_KEY` 硬编码，注释承认人工对齐 Go → 参数化（低-中）。
- 日志环纯内存、无持久化 sink、无订阅通知 → 日志 sink 注册钩子（中，能力缺口）。
- `listByTagWeb/allTagsWeb` O(n) 逐模型查标签无索引 → 标签反查索引 store（低-中）。

### 1.10 `web-community.ts` — ②未抽离重复
- 三份 localStorage-覆盖模式复制粘贴 → `createLocalJsonStore` 工厂（中）。

### 1.11 `idb.ts` — ④⑥
- 无版本化迁移注册表 + transaction 样板四份重复 → schema 迁移 + `withStore` 助手（中）。

---

## 二、`frontend/src/preview-3d/`（20 文件）

> 注：`model3d.ts` 相关发现与已裁决的 RenderSession 完整对象化立项关联（Top 1），此处仅列其余。

### 2.1 `bone-list.ts` — ①硬编码
- 仅读 `models[0]`，与 `debug-render` 各自独立重复 → 接受 `modelIndex` 参数（低）。

### 2.2 `bone-raycast.ts` 哨兵字符串 — ①硬编码哨兵
- `"__root__"` 字符串哨兵 → 常量导出或改 `null` 键（低）。

### 2.3 `bone-raycast.ts` identity quat 判定 — ②未抽离重复
- 手写四元数 identity 判定，与 `quaternion.ts` 的 `isIdentityQuat` 重复 → 复用现成工具（低）。

### 2.4 `bone-raycast.ts` pointer→NDC — ⑤缺钩子
- pointer→NDC 换算、光标 `"pointer"/"default"` 写死、无节流 → NDC 工具 + 光标配置 + pointermove 节流钩子（低）。

### 2.5 `camera-control.ts` 拖拽灵敏度 — ①硬编码
- 拖拽灵敏度 `0.003`、俯仰钳制 `±π/2` 写死 → handle/RenderSession 配置暴露（中）。

### 2.6 `camera-setup.ts` 距离公式 — ①硬编码
- `maxSize*1.5+2` 距离公式、空场景回退 `(0,80,-120)` 写死 → 相机策略可配置（中）。

### 2.7 `cleanup-helper.ts` DebugObj — ④未充分利用抽象
- `DebugObj = Mesh|Line|Sprite` 联合 + 逐类型 if-else dispose → 统一 `Object3D` 泛型遍历（低）。

### 2.8 `cube-mesh.ts` 有限性检查 — ②未抽离重复
- 三块有限性检查同构 → `assertFinite(vals, label)` 守卫（低）。

### 2.9 `cube-mesh.ts` 6 面几何表 — ①硬编码
- 6 面几何表写死 → 与 `model3d-spec.ts` 面序统一引用（中，改渲染语义需同步两处）。

### 2.10 `cube-mesh.ts` epsilon 常量 — ②未抽离重复
- `THICKNESS_EPSILON`/`CUBE_EPSILON` 同值 0.001，`model3d-spec.ts` 又存一份 `CUBE_EPS` → 单常量表导出（低）。

### 2.11 `cube-mesh.ts` `parseUV` — ⑥可插件化管线
- `parseUV` 固定 if-else 链（faceUV→expandBoxUV→失败）→ UV 解析器注册表（中）。

### 2.12 `debug-render.ts` 标签画布 — ①硬编码
- 标签画布 256×64、pivot 线长 `+4`、颜色 `0x00ff88`/`0x44aaff` 写死 → debug 主题配置对象（低）。

### 2.13 `keymap.ts` camSpeed 钳制 — ①④
- camSpeed 钳制 `[2,200]`、`TdKeyAction` 六方向写死 → 常量导出/动作注册表（低）。

### 2.14 `mesh.ts` `modelScale` — ①硬编码
- `modelScale = 1/16` 固定（基岩 16px=1m）→ buildSceneMesh 选项或 spec 携带 scale（中）。

### 2.15 `mesh.ts` + `mesh-builder.ts` + `bone-raycast.ts` — ②未抽离重复（跨文件）
- 三处手写 identity quat 判定，`quaternion.ts` 已有 `isIdentityQuat` 未用 → 统一 `applyRotationIfNonIdentity(obj, rot)`（中，epsilon 口径可能漂移）。

### 2.16 `mesh-builder.ts` 材质参数 — ①硬编码
- FrontSide/transparent/alphaTest 0.1/depthWrite、错误色 `0xff00ff`/`0xcccccc` 写死 → 材质配置对象（中）。

### 2.17 `model-group-builder.ts` overwrite 判定 — ②未抽离重复
- 同名骨骼 overwrite 判定公式两处各写一遍 → 抽 `shouldOverwrite(existing, incoming)` 纯函数（中，bug 高发区）。

### 2.18 `model-group-builder.ts` 悬挂规则 — ③缺扩展点
- 硬编码 `"RightArm"/"LeftArm"→"Arm"` 悬挂规则 → 通用「未挂父节点重挂最近可挂祖先」策略或可注册关系表（中，非玩家模型不适用）。

### 2.19 `model-group-builder.ts` `hasTextures` — 死代码
- `hasTextures=false` 使 `textureId` 恒 null，`texIdxBase` 仅服务此死分支 → 删除或接入真实纹理（低）。

### 2.20 `model2d.ts` 头发调试启发式 — ①硬编码启发式
- 头发调试启发式写死 → 见子代理汇报（低-中）。

### 2.21 `model3d-spec.ts` — 与 `cube-mesh.ts` 面序/epsilon 重复（见 2.9/2.10）。

### 2.22 `quaternion.ts` — 已有 `isIdentityQuat` 但未被 mesh/mesh-builder/bone-raycast 复用（见 2.15）。

### 2.23 `render-loop.ts` / `renderer-setup.ts` / `session-state.ts` / `spec-builder.ts` — 见子代理汇报，价值低-中，主要为硬编码常量与可配置项。

---

## 三、`frontend/src/views/`（多文件）

> 详情见子代理汇报；此处仅列高价值项。

### 3.1 `views/app-content/site/render.ts` 等 — ①③
- 站点分组/顺序 `GROUP_LABELS`/`SITE_GROUP_ORDER` 写死，未知组回退 `{icon:"🔗",label:g}` → 移到站点配置数据中（中）。

### 3.2 `views/app-preview/` 多文件 — ②未抽离重复
- preview 模块多处骨骼/几何加载逻辑重复，见子代理汇报（中）。

### 3.3 `views/app-tree/` 多文件 — 见子代理汇报
- virtual-scroll/toolbar-search/render 各有硬编码常量与可配置项（低-中）。

---

## 四、`frontend/src/core+features+services+utils/`（多文件）

### 4.1 `features/import-queue-data.ts` + `events.ts` — ②未抽离重复
- 表单字段 id 列表 `dl-author/dl-work/dl-chara/dl-variant/dl-date` 在 4 处硬编码；「正常导入」与「覆盖导入」两分支 30 行近似重复 → 表单字段注册表 + `commitImportSuccess(editing, finalName, overwritten)`（中）。

### 4.2 `features/import-executor.ts` + `import-queue-events.ts` — ⑥可插件化
- 冲突判定靠 `errMsg.includes("FILE_EXISTS") || includes("目标已存在")` 字符串匹配（两处，中文文案也重复）→ 统一消费 `friendlyError` 的结构化 `AppError.Code`（中，会随 Go 文案漂移）。

### 4.3 `features/oldest-models.ts` + `recycle-bin.ts` — ②未抽离重复（跨文件）
- 两文件各自实现 `safeGet("repo_rtype") + bus.on("repo:rtype-changed") + _loadGen 代际守卫`，注释承认「同模式」 → 抽 `useCurrentResourceType()`（中，第三处出现在 views/init-pages）。

### 4.4 `features/version-updater.ts` — ⑤缺配置项
- `CHECK_INTERVAL=6h`、`CHECK_TIMEOUT=30s`、Windows-only 判定硬编码 → 检查频次/超时进设置项 + 平台能力表（中）。

### 4.5 `services/registry.ts` `ServiceName` — ④未充分利用抽象
- `ServiceName` 闭联合仅 2 个服务，Map 类型 `unknown` → 泛型服务名到类型映射表（低，保持简单反是优势）。

### 4.6 `utils/animation/animation.ts` BONE_CHANNELS — ①②
- 通道名 `["rotation","position","scale"]` 字面量重复 4 次 → `const BONE_CHANNELS` 单点（中）。
- Molang 求值硬编码正则链 → 可注入表达式求值器（中，渲染管线天然插件点）。

### 4.7 `utils/dom/display.ts` 括号风格 — ③缺扩展点
- `parseModelName`/`renderDisplayName` 各自硬编码 `[...]/【】/《》` 三种括号风格 → 括号风格注册表（中，YSM 生态核心约定）。

### 4.8 `utils/dom/dialogs/modal.ts` — ②未抽离重复
- 5+ 个 modal 函数各自手写 overlay+onclick+Escape+registerDlg+trapFocus+footer 脚手架 → `createDialog({title,body,footer,closable})` 工厂（中）。

### 4.9 `utils/dom/dialogs/rename-format.ts` + `batch-rename-util.ts` — ②未抽离重复
- 两套文件名模板需手工保持语义一致 → 单一命名模板引擎（选项：缺省填充/跳过空段/保留 .ban/日期格式）（中）。

### 4.10 `utils/dom/errors.ts` `CODE_KEYS` — ①硬编码
- `CODE_KEYS` 手写错误码→i18n 键映射 → 从 Go 侧 AppError 定义生成（低）。

### 4.11 `utils/format/pack-format.ts` `FORMAT_VERSION_MAP` — ①硬编码
- `FORMAT_VERSION_MAP` 86 条静态表，`n > 88 ? "最新版本"` 魔数兜底 → 抽 JSON 数据文件 + 自动更新脚本（中，随 MC 迭代线性增长）。

### 4.12 `utils/icon/icon.ts` 兜底列表 — ①硬编码
- 归档/图片/文本三类扩展名兜底列表硬编码，与 `RESOURCE_EXTS` 派生列表并存 → 见子代理汇报（低-中）。

### 4.13 `utils/format/summarize.ts` / `utils/resource/*` — 见子代理汇报（低-中）。

---

## 五、`go/avatar+geometry+litematic+ysm/`

### 5.1 `go/avatar/avatar.go` / `avatar_decode.go` / `avatar_extract.go` / `avatar_zip.go` — 见子代理汇报
- 多处硬编码常量与重复逻辑，价值低-中。

### 5.2 `go/geometry/archive.go` / `parse.go` — 见子代理汇报
- 解析管线可插件化（中）。

### 5.3 `go/litematic/parser.go` / `nbt.go` / `voxel.go` / `block_ids.go` — 见子代理汇报
- NBT 解析器固定管线 + block_colors 静态表（中）。

### 5.4 `go/ysm/parse.go` / `decode_inject.go` / `extracted.go` / `header.go` / `summary.go` / `texsize.go` / `ysm.go` / `cli.go` — 见子代理汇报
- YSM 解码管线多处硬编码偏移/魔数（中）。

---

## 六、`go/fileops+importer+installer+dedup+download+recycle+instance+scanner+sync+fsutil+executil+paths+packs+tags+watcher+types+updater+logs+threejs/`

### 6.1 `go/importer/importer_file.go` + `go/packs/mcmeta.go` — ⑥可插件化（Top 2）
- 两套资源类型检测器并存 → 注册表驱动。

### 6.2 `go/sync/sync_dirlevel.go` / `sync_push.go` / `instance.go` / `installer.go` — ③缺扩展点（Top 3）
- 文件夹级/目录型 rtype 判定 6+ 处硬编码 → registry `isDir`。

### 6.3 `go/fsutil/` `copyFile×6` / `copyDirRecursive×4` — ②未抽离重复（Top 4）
- 原子复制原语成对重复 → 收敛进 fsutil。

### 6.4 `go/types/extensions.go` `ShouldHashExt` + scanner 内嵌 CI — ③缺扩展点（Top 5）
- 哈希白名单硬编码 switch，文件头声称注册表驱动唯独此处例外 → `ResourceType` 增加 `hashable`/`hashOnScan` 字段。

### 6.5 `go/types/resource.go` `ResourceType` — ④未充分利用抽象（Top 9）
- 纯数据无 Go 层 hook 字段 → 增加 `plugin`/`handlerRef` 字段打通 importer/packs/sync 三处硬编码根。

### 6.6 `go/types/extensions.go` `MaxImportSize` — ①硬编码
- `MaxImportSize=500MB` 被 scanner/download/importer 三方引用 → AppConfig 可配置（中）。

### 6.7 `go/types/config.go` `AppConfig` — ⑤缺配置项
- 已含 Mirror/VoxelMaxBlocks/LinkMode，但扫描 TTL/日志上限/预览读取上限/下载超时未暴露 → 集中下沉多处阈值（中）。

### 6.8 `go/dedup.go` / `recycle.go` / `instance.go` — ②未抽离重复
- 同文件内成对重复逻辑 → 见子代理汇报（中）。

### 6.9 `go/updater/updater.go` — ①④
- `repoOwner/repoName` 编译期常量、资产命名模式硬编码、手写 semver 比较无预发布语义 → 见子代理汇报（低）。

### 6.10 `go/logs/logs.go` / `runtime.go` — ①硬编码
- `maxLogEntries=500`/`maxFieldLen=1024`/`corruptRetentionDays=7`/`DefaultRuntimeCap=200` → 配置项（低）。

### 6.11 `go/threejs/spec.go` — ①④
- texW/texH 为 0 默认 64 硬编码；Build/BuildMulti 错误处理分散 → 见子代理汇报（低）。

### 6.12 其余 `fileops/fileops_preview/folder_import`、`executil/hidewindow_*`、`paths/safe`、`tags`、`watcher`、`scanner` — 见子代理汇报，价值低-中，主要为硬编码常量与缺配置项。

---

## 七、`frontend/src/wasm+根+test-utils/`

### 7.1 `wasm/ysm-parser.ts` glueCode 补丁 — ①硬编码脆弱补丁
- `glueCode.replaceAll(";updateMemoryViews()", …)` 字符串替换注入 HEAPU8 导出，patch 点硬编码在生成脚本输出结构上 → 版本感知适配层 + patch 命中数断言（中）。

### 7.2 `wasm/ysm-parser.ts` 两条解码策略 — ⑥可插件化管线
- 两条固定解码策略（内存/callMain+MEMFS）硬编码为两个导出函数，返回类型不一致，FS 准备/收集/清理逻辑重复 → `decodeStrategies` 注册表 + 统一 `decode(bytes, opts)` 入口（失败自动降级）（中高）。

### 7.3 `wasm/ysm-parser.ts` 崩溃分类正则 — ②未抽离重复
- 崩溃分类正则 `/abort|trap|out of memory/i` + `"ExitStatus"` 匹配在两个 catch 块各写一遍，口径已漂移 → 抽 `classifyWasmError(err)` 分类器（中）。

### 7.4 `app-modules.ts` 动态加载块 — ②未抽离重复（Top 8）
- 5 个 Web Component 动态加载 catch 模板逐字重复 → 抽 `loadView(name, importFn)` 或懒加载组件注册表（高）。

### 7.5 `app-modules.ts` `THEME_VALID` — ①硬编码
- `THEME_VALID`（6 主题+system）与 `classList.remove("theme-cyber","theme-warm",…)` 同一列表手抄双份 → 由 `THEME_VALID.map` 推导（中）。

### 7.6 `app-modules.ts` `initTheme` — ②未抽离重复
- initTheme try/catch 两分支仅 `cfg.theme` vs `THEME_DARK` 来源不同，四步完全重复 → 单路收拢（中）。

### 7.7 `app-modules.ts` `systemThemeMap` — ⑤缺配置项
- `system` 深/浅映射硬编码为 cyber/warm；主题集合、DevTools 快捷键不可配置 → 导出 `THEME_VALID` + `systemThemeMap` 配置项（中）。

### 7.8 跨文件主题默认值漂移
- `app-modules.ts` `THEME_DARK="cyber"`，而 `settings/init.ts`、`path-cards.ts`、`theme.ts` 是 `safeGet("theme") || "dark"`——"dark" 不在 `THEME_VALID` 白名单内，会经 `normalizeTheme` 回落 system。**非法默认值被静默归一**，应一并修正（中）。

### 7.9 `bus.ts` `VOID_EVENTS` vs `emit` — ②未抽离重复
- `VOID_EVENTS` 常量定义了 8 个 void 事件，但 `emit` 里又手抄一份；`isVoidEvent()` 已抽象却未在 emit 内使用 → `emit` 内改调 `isVoidEvent(event)`（中）。

### 7.10 `bus.ts` `emit` — ⑤缺钩子
- 无通配符监听、无 emit 前拦截/日志钩子、`emit` 返回 void → `bus.on("*")` 或 middleware 注册点 + 返回投递计数（中）。

### 7.11 `bus.ts` `BusEvents` — ④未充分利用抽象
- `BusEvents` 闭合联合表，新事件必须改本文件 → `declare module` 接口合并让模块自声明事件（低-中，闭合表是特性）。

### 7.12 `test-utils/index.ts` `waitFor` vs `waitForElementToBeRemoved` — ②未抽离重复
- 各自实现 tick/firstErr/超时 reject 全套约 60 行重复 → 基于 `waitFor` 组合或抽私有 `pollLoop`（中）。

### 7.13 `test-utils/render.ts` 轮询参数 — ①⑤
- 轮询间隔 `16ms`、`connectedTimeout:1000` 硬编码；就绪条件只认 `el.shadowRoot` → `RenderOptions` 加 `ready?: (el)=>boolean` 钩子 + `interval` 配置（中）。

### 7.14 `test-utils/events.ts` `fireDrop`/`fireDrag` — ②未充分利用抽象
- `fireDrop`/`fireDrag` 的 `dataTransfer` 注入两段重复；fire* 入参类型不统一；`fireInput` 不含 select → 抽 `injectDataTransfer` 助手 + 统一类型 + 泛化 select（低）。

### 7.15 `web-spike/main.ts` — ①②⑥
- 文件列表上限 40、体积格式化内联、drop/change 取文件路径重复、输出管线写死 → 见子代理汇报（低，spike 定位）。

---

## 发掘批次元数据

- 批次：第 1 批（6 个 explore 子代理并行）
- 日期：2026-08-15
- 覆盖：323 TS + 181 Go 非测试源码文件全量
- 局限：①价值判断为主观估计；②未交叉验证子代理逐条发现的行号准确性；③未覆盖测试文件（`*.test.ts` / `*_test.go`）的可拓展点
- 后续：如需新增批次，请新增 `## 八、…` 章节并注明批次号与日期
