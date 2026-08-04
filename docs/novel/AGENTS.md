# AI 行为约束（小说续写 · 区域志）

> 本文件锁定区域志（vol 4+）的目录规范与决策链路。创业三部曲（第一~三幕）的约束见 [SKELETON.md](SKELETON.md)，世界观与角色表见其第一~三节。

## 一、目录规范：10 区域 + appendix

续写章节**必须且只能**放入以下 10 个顶级文件夹之一，或 `appendix/` 下的 4 个分组之一。优先利用已有文档与文件夹。

| 区域 | 文件夹 | 锚定代码 | 主题 |
|------|--------|---------|------|
| 01 | `01-解码与几何/` | `go/ysm` `go/geometry` `go/threejs` `frontend/js/wasm` `app-preview` | YSMParser WASM/CLI、格式解析、2D/3D 预览、骨骼/立方体 |
| 02 | `02-模型仓库/` | `go/importer` `installer` `instance` `packs` `scanner` `dedup` `resource_types.json` `app-tree` `services` | 导入/安装/实例/整合包/扫描/去重、资源注册表 |
| 03 | `03-UI器官/` | `frontend/js/components` `dialogs` `features` | Web Components、对话框、功能页、卡片 UI |
| 04 | `04-事件中枢/` | `frontend/js/core`（`bus` `global-handlers` `page-store` `context-menus` `menu-defs`） | 事件总线、全局处理器、页面状态、菜单定义 |
| 05 | `05-同步与更新/` | `go/sync` `download` `updater` `handler-sync` | 同步、下载、更新器、进度队列 |
| 06 | `06-创作者社区/` | `go/avatar` `creators.json` `workshop_sites.json` `workshop-github.json` `community` | 创作者库、头像、工坊站点、社区索引 |
| 07 | `07-文件与路径/` | `go/fileops` `fsutil` `paths` `recycle` `watcher` `litematic` `internal/embedded` | 硬链接/复制、路径安全、回收站、监听、嵌入资源 |
| 08 | `08-配置与状态/` | `go/version` `logs` `errors` `tags` `settings` `page-store` | 版本、日志、错误、标签、设置持久化 |
| 09 | `09-工具链/` | `scripts` `Taskfile.yml` `wails.json` `cmd/build-release.ps1` `doctor` `funcmap` `codemod` | 自检/审计、构建发布、代码迁移工具 |
| 10 | `10-文档治理/` | `AGENTS.md` `docs/knowledge` `docs/adr` `docs/archive/bug-chronicle.md` `audits` | 文档宪法、知识卡、ADR、审计 |

`appendix/` 下分 4 组，收纳非代码目录锚定的章节：

| 分组 | 主题 | 典型内容 |
|------|------|---------|
| `appendix/跨模块重构/` | 多模块同时动刀的工程事件 | 全仓体检、逆天设计审计、大重构 |
| `appendix/Go后端/` | Go 代码与 Wails 框架 | `app.go` `internal/app` `main.go` 绑定 `wails.json` |
| `appendix/安全横切/` | 横切多模块的安全问题 | XSS 攻坚战、路径穿越、权限 |
| `appendix/其他/` | 原始稿存档、代码块附录 | 巨石原始稿、代码块附录 |

## 二、AI 决策链路（核心规则）

**改了代码 → 看路径前缀 → 命中 01–10 某一区域 → 直接去更新该章尾部。**

```
go/ysm geometry threejs / frontend/js/wasm / app-preview            → 01-解码与几何
go/importer installer instance packs scanner dedup / resource_types.json / app-tree / services → 02-模型仓库
frontend/js/components dialogs features                              → 03-UI器官
frontend/js/core (bus global-handlers page-store context-menus menu-defs) → 04-事件中枢
go/sync download updater / handler-sync                             → 05-同步与更新
go/avatar / creators workshop json / community                      → 06-创作者社区
go/fileops fsutil paths recycle watcher litematic / internal/embedded → 07-文件与路径
go/version logs errors tags / settings / page-store                 → 08-配置与状态
scripts / Taskfile / wails.json / build-release / doctor / funcmap / codemod → 09-工具链
AGENTS.md / docs/knowledge / docs/adr / bug-chronicle / audits      → 10-文档治理
多模块同时动刀（审计/重构/体检）                                    → appendix/跨模块重构
app.go / internal/app / main.go / Wails 绑定                        → appendix/Go后端
安全/XSS/路径穿越横切                                               → appendix/安全横切
```

**判定优先级**：单一模块命中 `01`–`10` > 跨模块归 `appendix/跨模块重构` > 文档归 `10-文档治理` > Go 归 `appendix/Go后端`。

## 三、禁止行为

- ❌ **严禁在 `novel/` 根目录创建新的 `.md` 章节文件**（`README.md` / `SKELETON.md` / `AGENTS.md` 除外）
- ❌ **严禁创建新的顶级文件夹**（10 区域 + `appendix/` 已锁定）
- ❌ **严禁在 `appendix/` 下创建新的分组**（4 组已锁定）
- ✅ 新增章节时，根据改动的代码目录放入对应区域，附录内容放入对应分组
- ✅ 文件名按 `NN-标题.md` 命名，两位数字编号（同区域内连续，允许跳号补章）
- ✅ 区域文件夹内的 `README.md` 为该区域索引与范围说明，章节 `.md` 与之并列

## 四、卷号与目录解耦

- **物理目录**服从「代码区域锚定」（10 区域 + `appendix`）
- **叙事卷号**（`vol-4` `vol-5`…）是叙事时间线，写在章节文件内顶部标题，在 `README.md` 映射表中维护
- 两套体系互不干扰：AI 按物理目录定位章，读者按卷号读叙事

## 五、章的结构（每章必含）

1. **章首标题**：`# 第 N 区域 · 第 M 章 · 标题` 或 `# 第 M 章 · 标题`
2. **真实事件/代码改动标注**：`> 对应真实事件/代码改动：xxx`
3. **四段式叙事**：惊醒 → 追查 → 真相 → 教训（沿用 SKELETON 第七节硬约束）
4. **章末隐喻**：一句「边界悖论」相关的思考
5. **教训摘要**：`---` 分隔 + 一行不超过 20 字的教训

## 六、技术准确性（硬约束）

- 所有技术细节必须能在 `../../` 代码库或 `../` 文档中找到依据
- 不确定的技术细节 → 查代码 → 再写，禁止脑补
- 角色性格遵循 SKELETON 角色表，不 OOC

## 七、写作基准

**标杆章节**：[`act-3-cartographer/13-心跳图谱.md`](act-3-cartographer/13-心跳图谱.md)（创业三部曲内已成型章，四段式 + 拟人 + 精确数字达标）

AI 写作时必须以此为基准，确保以下维度达标：

| 维度 | 要求 |
|------|------|
| 叙事主体 | 系统意识（巴别塔人格）作为叙事者，外科医生（AI）通过对话推动发现 |
| Bug 驱动 | 第一章第一段必须呈现 bug 的结果，不是背景描述 |
| 情感弧线 | 至少包含「困惑→发现→感慨」三个情感节点 |
| 对话 | 至少有一个对话推动情节转折，不是装饰性对话 |
| 代码嵌入 | 代码嵌入排查过程，是角色正在读的东西，不是引用附注 |
| 反思隐喻 | 尾声用空间/物理隐喻收束，不用总结金句 |
| 精确细节 | 至少包含一个能让读者「看到」的精确数字 |

## 八、动笔前检查清单

1. 先读 `SKELETON.md`（世界观/角色/区域总表），再读对应区域已有章节，最后动笔
2. 走「第二节决策链路」确定本章归属区域
3. 查 `docs/archive/bug-chronicle.md` 与 `docs/adr/` 确认真实事件依据
4. 写完同步更新 `README.md` 区域索引表（章节链接 + 标题）
5. 不更新索引的续写 = 没写。下一个 AI 找不到，等于不存在
