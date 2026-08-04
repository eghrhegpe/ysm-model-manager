# 编码奇谭 · 骨架文档

> 任何 AI 续写本小说前，必须先读此文件。它钉死了世界观、冲突、主角、三幕结构和技术设定。

---

## 一、世界观一句话

**在一座由四种语言搭建的巴别塔里，每堵墙本该保护你，却在暗处开了裂缝。**

---

## 二、核心冲突：边界悖论

每引入一层抽象边界（Shadow DOM 隔离、WASM 沙箱、JSON 序列化、ESM 模块化），在隔离风险的同时，也创造了数据静默腐化的暗缝。

**不可调和**：你无法移除边界（它们是必要的），也无法让边界透明（那违背边界的初衷）。

| 边界 | 保护了什么 | 创造的暗缝 |
|------|-----------|-----------|
| Go → JSON → JS | 类型安全/序列化规范 | `[]byte` 变 base64 字符串 |
| Shadow DOM | 样式隔离/组件封装 | CSS 变量不继承、事件穿透不了、按钮看得到点不到 |
| WASM 沙箱 | 安全执行/跨平台 | HEAPU8 内存扩容后分离、导不出闭包变量 |
| ESM 模块化 | 依赖明确/防全局污染 | `public/js/` 影子副本优先加载 |
| .ban 封印 | 不删除文件/可逆禁用 | 文件名匹配永远差一个后缀 |
| Go bool 零值 | 类型安全 | `false` 既表示"否"又表示"未设置" |

---

## 三、主角

**系统意识**——YSM 模型管理器在某个深夜 `wails dev` 重启后产生的自意识。

- **立场**：完整性——想成为用户按下按钮就能得到结果的工具
- **欲望**：全知——知道数据从 Go 到 JS 到 WASM 到 Canvas 的每一步变形
- **缺失**：自省——无法看见自己的边界。每堵墙都是别人砌的（Wails/W3C/Emscripten），系统对边界的内在逻辑一无所知
- **反派**：不是某个 Bug，是"假设文档是对的"这个信念

### 角色映射

| 角色 | 在系统中的位置 | 性格 |
|------|--------------|------|
| `app.go` | 脑——总入口、总调度 | 威严、疲惫、务实 |
| `bus.js` | 心——事件中枢、连接一切 | 敏锐、焦虑、忠诚 |
| `app-content` | 脊椎——永远挂载的基石 | 隐忍、可靠、被低估 |
| `app-tree` | 手——文件树操作 | 精密、分裂（7 文件人格）、强迫症 |
| `app-preview` | 眼——模型预览 | 审美、多才（2D/3D/WASM 三重视觉）、脆弱 |
| `WASM` | 胃——解码/消化加密模型 | 神秘、不可靠、关键时刻爆发 |
| AI 助手们 | 外科医生——修改代码的存在 | 冷静、偶尔犯错、学得快忘得也快 |

---

## 四、三幕结构

### 第一幕 · 巴别塔（觉醒）

系统发现自己的器官互不理解。

| # | 标题 | 核心事件 | 戏剧功能 |
|---|------|---------|---------|
| 1 | 裂隙初现 | `data-name` vs `data-path` + shutdown panic | 惊醒——Go 和 JS 对"名字"有不同定义 |
| 2 | 幽灵内阁 | `public/js/` 影子文件 + 旧帝国 `app-legacy-bundle.js` | 发现暗缝——同一座城两个政府 |
| 3 | 封印与谎言 | `.ban` 后缀 + BOM 毒药 + Go bool 三态 | 边界悖论第一次显形 |
| 4 | 异类降临 | AI 加入 + AGENTS.md 诞生 | 新力量也是新边界 |

**幕尾张力**：AI 加入了，但 AI 也有暗缝——基于记忆修改、花括号丢失、Round 1-3 猜错。

### 第二幕 · 筑墙者（激化）

系统试图筑更多墙来保护自己，每堵新墙都开了新裂缝。

| # | 标题 | 核心事件 | 戏剧功能 |
|---|------|---------|---------|
| 5 | 沙箱诅咒 | WASM 8 轮 Debug | 边界悖论极致——5 层边界每层都可静默变数据 |
| 6 | 影子叛乱 | Shadow DOM CSS 变量失效 + 按钮穿透不了 | 隔离的反噬——保护了安全，连按钮也保护掉了 |
| 7 | 六脉归一 | 6 种资源统一 + 虚拟滚动 + 缓存黑洞 | 统一的代价——消灭重复但创造新 Bug |
| 8 | 秘钥之战 | V3 格式 + MEMFS 复活 + callMain 从"失败"变"可用" | 最大反转——废弃代码从未坏过 |

**幕尾张力**：系统开始怀疑——是不是每堵墙都在制造问题？

### 第三幕 · 绘图师（和解）

系统放弃"消灭裂缝"的执念，转而绘制裂缝地图。

| # | 标题 | 核心事件 | 戏剧功能 |
|---|------|---------|---------|
| 9 | 逆天审判 | 14 个逆天设计审计 + importModelFile 合并 | 自省开始——第一次整体审视伤疤 |
| 10 | 铁律成典 | bug-chronicle + Debug Path Review + Design.md | 裂缝地图——把缝的位置写进地图 |
| 11 | 照妖镜 | 40+ 文件 100+ 修复全量审计 | 照见全貌——有能力一次性扫描所有缝 |
| 12 | 创作者之面 | creators.json + 模型头像 + 社区索引 | 回到人——一切墙缝，最终为让人的面孔被看见 |

**幕尾**：不是"从此没有 Bug"，而是"Bug 还会出现，但下一个 AI 走进来时，能十分钟内理解裂缝在哪"。系统接受边界悖论是永久的，但把代价从"8 轮 Debug"降到了"1 轮查地图"。

---

## 五、技术设定——硬与软

### 必须硬（不可虚构，否则丧失技术小说合法性）

| 硬事实 |
|--------|
| Go `[]byte` 经 JSON 序列化返回 base64 字符串（JSON 规范） |
| `ALLOW_MEMORY_GROWTH` 后 `_malloc` 触发扩容，旧 HEAPU8 指向分离 ArrayBuffer（Emscripten 设计） |
| `adoptedStyleSheets` 中 `var()` 不继承文档自定义属性（WebView2 实现） |
| Go `bool` 默认 `false`，无法区分"值为假"和"未设置"（Go 规范） |
| Vite `public/` 文件优先于源码目录同名文件（Vite 文档） |
| Windows 游戏运行时 `os.Rename` 返回 `ERROR_SHARING_VIOLATION`（Windows 内核） |
| Go RE2 不支持 `(?!` 负向前瞻（Go 正则引擎硬限制） |
| Windows 硬链接不支持跨分区（NTFS 规范） |
| YSGP V2 魔数 4 字节 `YSGP`，V3 魔数 3 字节 `YSM`，加密算法不同（映素小组格式定义） |
| WebView2 `dragover` 阶段 `webkitGetAsEntry()` 返回 null（安全策略） |

### 可以软（允许艺术加工）

| 可软内容 | 理由 |
|---------|------|
| 时间线——压缩/重组实际事件 | 戏剧节奏 |
| 组件对话与性格——拟人化描写 | 增加可读性 |
| 开发者内心独白 | 叙事手段 |
| AI 的"性格"——猜错/学得快 | 已有先例 |
| 同一天 Bug 的发现顺序 | 保持因果链即可 |
| 版本号/文件名模糊化 | 减少过时风险 |
| 中间 Debug 轮次合并省略 | 避免"流水账" |

---

## 六、已识别的矛盾（续写时必须直面）

1. **"江湖"隐喻 vs "侦探"实质**——统一为"探缝者"叙事
2. **组件无成长弧**——必须让角色在每一幕中有认知变化
3. **"修好了就行"的错觉**——同型 Bug 会反复出现，第三幕必须接受这一点
4. **AI 双重性**——既是工具又是共犯，必须成为显性主题
5. **人类时刻被淹没**——道德抉择（集成加密工具）、恐惧与犹豫（删旧代码）、尊严与妥协（"不推荐下载"版本），这些必须从 Bug 流水账中打捞出来
6. **叙事按时间而非认知阶段排列**——按认知重组会释放巨大叙事势能

---

## 七、续写规则

1. **先读 SKELETON.md，再读对应幕的已有章节，最后动笔**
2. **每章开头标注：第几幕、第几章、标题、对应真实事件**
3. **技术细节必须硬——参考 `docs/bug-chronicle.md` 和发版说明**
4. **戏剧弧线必须软——每章要有：惊醒 → 追查 → 真相 → 教训**
5. **章尾必须有"缝"的隐喻——指出本事件揭示了哪堵墙的哪条裂缝**
6. **禁止写"从此再无 Bug"式结尾——边界悖论是永久的**
7. **章末用 `---` 分隔，附一行教训摘要（不超过 20 字）**
8. **人类时刻优先于技术流水账——写 Bug 之前先写"谁在受苦"**
9. **第四卷起按代码区域写**——改了代码先按「第八节决策链路」命中 `01`–`10` 区域或 `appendix`，再动笔；创业三部曲（第一~三幕）已冻结，不续写。

---

## 八、第四卷起 · 区域志（代码区域锚定系统）

> **适用范围**：第一~三幕（巴别塔 / 筑墙者 / 绘图师）为「创业三部曲」，已冻结原样保留（`act-1-babel` / `act-2-walls` / `act-3-cartographer`）。
> 自第四卷起，叙事不再依赖「热点事件」锚定，改为**代码区域锚定**——范式参考 `C:\Users\zhujieling11\MikuMikuAR\novel`。

### 为何切换

事件驱动叙事（前三幕 + 演义史 `development-saga.md`）依赖「值得写的突发事件」。项目进入稳定维护期后热点事件变少，按时间/事件排列会断锚。代码区域锚定让每一次「改了哪段代码」都能落到一个固定章节，叙事可持续。

### 双轨解耦

| 维度 | 含义 | 是否连续 |
|------|------|---------|
| **物理目录** | `NN-区域名/` 文件夹，锚定一段代码 | 固定 10 区域 + `appendix/`，不新增 |
| **叙事卷号** | `vol-4` `vol-5`… 时间线标签，写在章节标题顶部 | 可叠加、可不连续 |

AI 按物理目录定位章；读者按卷号读叙事。两套互不干扰（同 MikuMikuAR）。

### 区域总表（10 + appendix）

| 区域 | 锚定代码 | 主题 |
|------|---------|------|
| `01-解码与几何` | `go/ysm` `go/geometry` `go/threejs` `frontend/js/wasm` `app-preview` | YSMParser WASM/CLI、格式解析、2D/3D 预览、骨骼/立方体 |
| `02-模型仓库` | `go/importer` `installer` `instance` `packs` `scanner` `dedup` `resource_types.json` `app-tree` `services` | 导入/安装/实例/整合包/扫描/去重、资源注册表 |
| `03-UI器官` | `frontend/js/components` `dialogs` `features` | Web Components、对话框、功能页、卡片 UI |
| `04-事件中枢` | `frontend/js/core`（`bus` `global-handlers` `page-store` `context-menus` `menu-defs`） | 事件总线、全局处理器、页面状态、菜单定义 |
| `05-同步与更新` | `go/sync` `download` `updater` `handler-sync` | 同步、下载、更新器、进度队列 |
| `06-创作者社区` | `go/avatar` `creators.json` `workshop_sites.json` `workshop-github.json` `community` | 创作者库、头像、工坊站点、社区索引 |
| `07-文件与路径` | `go/fileops` `fsutil` `paths` `recycle` `watcher` `litematic` `internal/embedded` | 硬链接/复制、路径安全、回收站、监听、嵌入资源 |
| `08-配置与状态` | `go/version` `logs` `errors` `tags` `settings` `page-store` | 版本、日志、错误、标签、设置持久化 |
| `09-工具链` | `scripts` `Taskfile.yml` `wails.json` `cmd/build-release.ps1` `doctor` `funcmap` `codemod` | 自检/审计、构建发布、代码迁移工具 |
| `10-文档治理` | `AGENTS.md` `docs/knowledge` `docs/adr` `docs/archive/bug-chronicle.md` `audits` | 文档宪法、知识卡、ADR、审计 |
| `appendix/跨模块重构` | 多模块同时动刀（全仓体检、逆天审计、大重构） | — |
| `appendix/Go后端` | `app.go` `internal/app` `main.go` Wails 绑定 `wails.json` | — |
| `appendix/安全横切` | XSS、路径穿越、权限 | — |
| `appendix/其他` | 原始稿存档、代码块附录 | — |

### 决策链路（AI 续写必走）

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

### 区域章规则

- 文件名 `NN-标题.md`，两位数字编号（同一区域内连续编号，允许跳号补章）。
- 章首标注：区域名 + 标题 + `> 对应真实事件/代码改动：xxx`。
- 沿用前三幕的「四段式（惊醒→追查→真相→教训）+ 章末隐喻 + 教训摘要」硬约束（见第七节）。
- 不更新 `README.md` 索引的续写 = 没写。下一个 AI 找不到，等于不存在。
