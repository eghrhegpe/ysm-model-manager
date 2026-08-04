# 编码奇谭：YSM 巴别塔演义

> 在一座由四种语言搭建的巴别塔里，每堵墙本该保护你，却在暗处开了裂缝。

---

## 目录

### 第一幕 · 巴别塔（觉醒）

系统发现自己的器官互不理解。

| 章 | 标题 | 文件 |
|----|------|------|
| 1 | 裂隙初现 | [act-1-babel/01-裂隙初现.md](act-1-babel/01-裂隙初现.md) |
| 2 | 幽灵内阁 | [act-1-babel/02-幽灵内阁.md](act-1-babel/02-幽灵内阁.md) |
| 3 | 封印与谎言 | [act-1-babel/03-封印与谎言.md](act-1-babel/03-封印与谎言.md) |
| 4 | 异类降临 | [act-1-babel/04-异类降临.md](act-1-babel/04-异类降临.md) |

### 第二幕 · 筑墙者（激化）

系统试图筑更多墙来保护自己，每堵新墙都开了新裂缝。

| 章 | 标题 | 文件 |
|----|------|------|
| 5 | 沙箱诅咒 | [act-2-walls/05-沙箱诅咒.md](act-2-walls/05-沙箱诅咒.md) |
| 6 | 影子叛乱 | [act-2-walls/06-影子叛乱.md](act-2-walls/06-影子叛乱.md) |
| 7 | 六脉归一 | [act-2-walls/07-六脉归一.md](act-2-walls/07-六脉归一.md) |
| 8 | 秘钥之战 | [act-2-walls/08-秘钥之战.md](act-2-walls/08-秘钥之战.md) |

### 第三幕 · 绘图师（和解）

系统放弃消灭裂缝，转而绘制裂缝地图。

| 章 | 标题 | 文件 |
|----|------|------|
| 9 | 逆天审判 | [act-3-cartographer/09-逆天审判.md](act-3-cartographer/09-逆天审判.md) |
| 10 | 铁律成典 | [act-3-cartographer/10-铁律成典.md](act-3-cartographer/10-铁律成典.md) |
| 11 | 照妖镜 | [act-3-cartographer/11-照妖镜.md](act-3-cartographer/11-照妖镜.md) |
| 12 | 创作者之面 | [act-3-cartographer/12-创作者之面.md](act-3-cartographer/12-创作者之面.md) |
| 13 | 心跳图谱 | [act-3-cartographer/13-心跳图谱.md](act-3-cartographer/13-心跳图谱.md) |
| 14 | 正名之书 | [act-3-cartographer/14-正名之书.md](act-3-cartographer/14-正名之书.md) |
| 15 | 呼吸之灯 | [act-3-cartographer/15-呼吸之灯.md](act-3-cartographer/15-呼吸之灯.md) |
| 16 | 第三只眼 | [act-3-cartographer/16-第三只眼.md](act-3-cartographer/16-第三只眼.md) |

---

## 骨架

续写前必读：[SKELETON.md](SKELETON.md)

---

## 区域志（vol 4+ · 代码区域锚定）

> 创业三部曲（第一~三幕）已冻结，见上。自第四卷起改为**代码区域锚定**：改了代码 → 看路径 → 命中下方区域 → 更新该章尾部。
> 决策链路与禁则见 [AGENTS.md](AGENTS.md)；世界观与角色见 [SKELETON.md](SKELETON.md) 第八节。

| 区域 | 锚定代码 | 章节索引 |
|------|---------|---------|
| [01-解码与几何](01-解码与几何/README.md) | `go/ysm` `go/geometry` `go/threejs` `frontend/js/wasm` `app-preview` | （待续写） |
| [02-模型仓库](02-模型仓库/README.md) | `go/importer` `installer` `instance` `packs` `scanner` `dedup` `resource_types.json` `app-tree` `services` | （待续写） |
| [03-UI器官](03-UI器官/README.md) | `frontend/js/components` `dialogs` `features` | （待续写） |
| [04-事件中枢](04-事件中枢/README.md) | `frontend/js/core`（`bus` `global-handlers` `page-store` `context-menus` `menu-defs`） | （待续写） |
| [05-同步与更新](05-同步与更新/README.md) | `go/sync` `download` `updater` `handler-sync` | （待续写） |
| [06-创作者社区](06-创作者社区/README.md) | `go/avatar` `creators.json` `workshop_sites.json` `workshop-github.json` `community` | （待续写） |
| [07-文件与路径](07-文件与路径/README.md) | `go/fileops` `fsutil` `paths` `recycle` `watcher` `litematic` `internal/embedded` | （待续写） |
| [08-配置与状态](08-配置与状态/README.md) | `go/version` `logs` `errors` `tags` `settings` `page-store` | （待续写） |
| [09-工具链](09-工具链/README.md) | `scripts` `Taskfile.yml` `wails.json` `cmd/build-release.ps1` `doctor` `funcmap` `codemod` | （待续写） |
| [10-文档治理](10-文档治理/README.md) | `AGENTS.md` `docs/knowledge` `docs/adr` `docs/archive/bug-chronicle.md` `audits` | （待续写） |

### 附录

| 分组 | 主题 | 章节索引 |
|------|------|---------|
| [appendix/跨模块重构](appendix/跨模块重构/README.md) | 多模块同时动刀（全仓体检、逆天审计、大重构） | [01 全塔体检](appendix/跨模块重构/01-全塔体检.md) |
| [appendix/Go后端](appendix/Go后端/README.md) | `app.go` `internal/app` `main.go` Wails 绑定 | （待续写） |
| [appendix/安全横切](appendix/安全横切/README.md) | XSS、路径穿越、权限 | （待续写） |
| [appendix/其他](appendix/其他/README.md) | 原始稿存档、代码块附录 | （待续写） |
