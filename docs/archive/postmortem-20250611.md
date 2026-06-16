# Postmortem: 导航重构 + YSM 头部修复 + v1.4.x 发布周期（2026-06-09/11）

> 历时约 3 天，横跨 UI 重构、Go 后端 Bug 修复、内容运营、三次发布

## 目标

1. 导航栏 UI 精炼（宽度缩减、! 标记移除、仓库元老晋升主菜单）
2. GitHub 仓库分离为独立「创意工坊」页面
3. YSM 文件头解析彻底修复（二进制泄露 + 纯二进制检测 + free 标签三态）
4. 整合包同步状态修复（哈希去重导致误标）
5. 创作者数据库扩充（21→87 位）
6. 发布 v1.4.1 / v1.4.2 / v1.4.3

## 最终结果

| 指标       | 值                                                       |
| ---------- | -------------------------------------------------------- |
| 代码改动   | Go 端 6 文件修改 + 前端 20+ 文件修改                     |
| 发布次数   | 3（v1.4.1, v1.4.2, v1.4.3）                              |
| 新增创作者 | 66 位（21→87）                                           |
| 删除死代码 | canvas-export.js 移除                                    |
| 新增文件   | workshop_sites.json, workshop_gitHub.json, creators.json |
| 重命名     | workshop_creators.json → creators.json                   |

## Debug 路径

### Round 1: 创意工坊 CSS 样式在分离到 JS 后失效

**症状**: 创意工坊页面样式不加载，元素错乱

**错误猜测**: 怀疑是 CSS 类名定义重复或遗漏

**查了什么**: 对比 `content-css.js`（Shadow DOM 样式表）和 `components.css`（全局样式）

**真相**: 创意工坊的模型列表行和预览元素通过 `document.createElement` 创建并追加到 `document.body`（而非 Shadow DOM），但这些元素的 CSS 类（`.ws-preview`, `.ws-row`, `.ws-cb`, `.ws-name`, `.ws-badge`, `.ws-size`, `.ws-dl-model`, `.ws-empty`, `.model-row` 等）只存在于 `components.css` 中，未被迁移到 `content-css.js`

**修复**: 将全部遗漏的 workshop 样式类从 `components.css` 复制到 `content-css.js`，然后在 `components.css` 中移除（避免重复）

**Lesson**: Shadow DOM 组件中通过 `document.createElement` 创建并挂载到 `document.body` 的元素，其样式必须定义在全局 CSS（`components.css`）中。如果所有内容都在 Shadow DOM 内渲染，则样式应放在 `content-css.js`。**同一套样式不能部分在 Shadow DOM、部分在全局**。

---

### Round 2: githubHTML 返回 undefined

**症状**: 点击「创意工坊」导航项，页面空白

**查了什么**: 检查 `tpl.js` 中 githubHTML 函数，发现是之前删除重复函数时损坏

**真相**: `githubHTML` 函数缺少 `return` 语句，且缺少 `ws-page` div 的起始标签。Wails 渲染了 `undefined`，导致 app-content 内容区清空但无内容填入。

**修复**: 添加 return 语句 + 补齐 ws-page div

**Lesson**: 删除重复函数时必须验证剩余的签名完整。修改后立即 `vite build` 检测。

---

### Round 3: loadOldestModel 未导出

**症状**: 「仓库元老」页面报 `loadOldestModel is not a function`

**查了什么**: 检查 `pages/repository.js` 的 export

**真相**: `loadOldestModel` 函数定义在 `pages/repository.js` 但未加 `export` 关键字，动态 `import()` 后拿不到

**修复**: 添加 `export` 关键字

**Lesson**: 动态 `import()` 引入的模块，必须在被引入文件中显式 `export` 目标函数。忘记 export 时错误信息不直观（"not a function" vs "undefined"）。

---

### Round 4: Shadow DOM 按钮点击无响应

**症状**: 整合包管理的「安装」按钮点击无任何反应

**错误猜测**: 事件绑定写错了

**查了什么**: grep 搜索 `btn-install-one` 的绑定代码

**真相 ×2**:

1. `btn-install-one` 按钮在 `app-content/tpl.js` 模板中渲染，但 click handler 绑定在 `app-sidebar/events.js` 中。Shadow DOM 隔离意味着 `app-sidebar` 的 `querySelector` 无法找到 `app-content` Shadow DOM 内的元素。
2. 修复后，点击按钮报错 `⏳ 导入中` 不消失——`sidebar` 监听 `queue:status` 事件恢复按钮状态，但 handler 实际上 emit 的是 `sync:download-complete`。

**修复**:

- 按钮 handler 移动到 `app-content/index.js`（按钮所在 Shadow DOM 树）
- 事件监听名统一为 `sync:download-complete`

**Lesson**: 跨 Shadow DOM 的 `querySelector` 无法穿透。**元素的 click handler 必须注册在元素所在 Shadow DOM 树内**。事件名必须精确匹配——emit 和 on 必须在代码审查时一一对照。

---

### Round 5: YSM 文件头二进制数据泄露

**症状**: 模型摘要面板显示乱码文本（`<name>`、`<free>` 等标签出现异常值）

**错误猜测**: header 解析逻辑有问题

**查了什么**: 读 `go/ysm/header.go` 的 `scanHeader` 函数

**真相**: `scanHeader` 固定读取 200 行，但部分 YSM 文件的文本头部不到 200 行就结束了。后续读取的二进制数据被解析为 ASCII 文本，偶尔匹配到 `<tag>` 模式（如 `<free>`），被误认为元数据。

**修复**: 新增退出条件——遇到 `---` 分隔线即停止扫描。新增 `hasTextHeader()` 预检，纯二进制 YSGP V2 文件跳过头部扫描。

**Lesson**: **不要假设文件头部有多少行**。纯文本→二进制的混合格式必须检测终止标记。

---

### Round 6: `<free>` 标签不存在时显示「付费」

**症状**: 无 `<free>` 标签的模型摘要显示 🔒 付费标记

**查了什么**: Go struct `YSMHeader` 的默认值

**真相**: `HasFree bool` 默认值为 `false`（Go 零值），前端 `header.hasFree` → `false` → 显示付费。但无法区分"明确标记为付费"和"没有设置"。

**修复**: 新增 `HasFree` bool 字段，仅当文本头部包含 `<free>` 标签时才设为 `true`。前端 `freeBadge` 从 `header.isYsm` 改为 `header.hasFree`。

**Lesson**: **Go struct bool 零值无法区分"未设置"和"明确为 false"**。对于三态字段（付费/免费/未标注），需要额外的标志位或改用指针。

---

### Round 7: 整合包同步状态误标「已同步」

**症状**: 整合包管理中某些文件显示「✅ 已同步」，但实际不在整合包 custom 目录中

**查了什么**: 读 `go/sync/sync.go` 的同步状态计算逻辑

**真相**: `repoByHash` 使用 `map[string]types.ModelEntry`，同 SHA256 哈希的多个文件只有最后一个被保留。当整合包缺少某个文件，但仓库中有另一个同哈希（内容相同）的文件时，`repoByHash` 认为该哈希已存在→误标为已同步。

**修复**: 改为 `map[string][]types.ModelEntry`，同哈希的多个文件全部保留在缺失列表中。

**Lesson**: **map 去重会隐式丢弃数据**。在 Go 中，`map[K]V` 对相同 key 的后续赋值会静默覆盖前值。当业务逻辑要求保留所有条目时，必须使用 `map[K][]V`。

---

### Round 8: Preset 搜索按钮 HTML 结构破坏

**症状**: 创作者频道预设搜索按钮显示异常

**查了什么**: 检查 `workshop-site-view.js` 中按钮 HTML

**真相**: `data-q` 属性缺少闭合引号，导致 HTML 属性解析错误，按钮文本被截断

**修复**: 添加 `'">'` + `esc(ps.label)` 完整闭合

**Lesson**: 模板字符串中拼接 HTML 属性必须仔细检查引号闭合。建议用 `esc()` 统一处理属性值。

---

## 关键发现

### Shadow DOM CSS 架构

```
Shadow DOM 内的元素                    → 样式定义在 content-css.js
document.body 挂载的元素（预览浮层等）  → 样式定义在 components.css（全局）
```

**同一组件不能混合使用两种方式**：如果主要 UI 在 Shadow DOM 内，但部分元素通过 `document.createElement` 挂载到 `document.body`，这些元素的 CSS 类必须在全局 CSS 中已存在，而不能仅仅在 Shadow DOM 样式表中。

### Go 后端的三态陷阱

| 字段      | Go 类型                 | 问题                        | 修复方案                       |
| --------- | ----------------------- | --------------------------- | ------------------------------ |
| `HasFree` | `bool`                  | 零值 false 与「未设置」混淆 | 仅当明确检测到标签时设为 true  |
| 同步状态  | `map[string]ModelEntry` | 哈希覆盖导致数据丢失        | 改为 `map[string][]ModelEntry` |

### 发布周期管理

v1.4.2 发布后用户反复说「发布 v1.4.2」，但实际上 v1.4.2 已发布，未提交的更改应归为 v1.4.3。**每次发布后应立即打 tag + push，避免混淆**。

## 工具链改进

- `.github/copilot-instructions.md` 新增多条规则（Shadow DOM 按钮绑定、YSM 头部扫描陷阱等）
- `docs/release-notes/README.md` 版本索引表持续维护
- `build-release.ps1` 完善（新增 creators.json / workshop_gitHub.json 复制）

## 四、预防措施对照表

| 预防措施                | 对应本轮教训 | 实施检查项                                                              |
| ----------------------- | ------------ | ----------------------------------------------------------------------- |
| Shadow DOM 样式归属检查 | Round 1      | 创建新 UI 元素时确认它属于哪个 Shadow DOM 树，样式定义在对应位置        |
| 跨组件事件名审计        | Round 4      | `bus.emit` 和 `bus.on` 必须一一对照，建议在事件总线文档中维护事件名清单 |
| Go map 去重审计         | Round 7      | 对 `map[K]V` 的赋值操作，必须确认是否允许 key 重复                      |
| Go bool 三态审计        | Round 6      | 审查所有 Go → 前端的 bool 字段，确保零值语义正确                        |
| 发布后立即打 tag        | 发布周期     | `git tag v1.x.x && git push origin v1.x.x` 在构建成功后立即执行         |
| 文件头解析加终止条件    | Round 5      | 所有流式读取必须设退出条件，不能靠固定行数                              |

## 五、待办

- [ ] 创意工坊 GitHub 页面搜索框的绑定（用户提过但未实现）
- [ ] P7 多资源类型支持（已写计划 `docs/plan-p7-multi-resource.md` 但未开始）
- [ ] 磁盘空间仪表盘（需要新 Go Binding）

---

## V3 文本头部变体 WASM 解码（2026-06-11 下午）

> 历时约 2 小时，横跨 V2/V3 格式差异排查、MEMFS 路径复活、HideWindow 防弹窗

### 问题

部分 2025 年加密 .ysm 文件（芙兰朵露 Flandre 2025-06 等）使用 YSGP V3 格式（魔数 `YSM` 3B 而非 `YSGP` 4B），且带有 BOM + 文本头部。`decodeYsmFileFromMemory` 无法解码，回退 Go CLI。

### Debug 路径

**Round 1**: 剥离文本头部→重建标准 YSGP，V2 失败试 V3 header

- 猜测: 版本字节在加密数据中不可读，默认 V2 不对
- 修复: `buildStdYsgpFromTextVariant` 加 `forceVer` 参数
- 结果: ❌ V3 魔数是 `YSM` 不是 `YSGP`，重建格式根本不对

**Round 2**: V3 加密偏移修正

- 发现: 二进制段头 64B 中无 16B hash 匹配 `<hash>` 标签值
- 修复: V3 用 `encryptedStart = dataStart`（不 skip 16）
- 结果: ❌ 结构完全不同，不是偏移问题

**Round 3**: 启用 MEMFS + callMain 路径

- 真相: `decodeYsmFileFromMemory` → `YSMParserFactory::Create(cdata, size)` → 纯内存解析，不处理文本头部
- `decodeYsmFile` → `callMain` → `ifstream` 读 MEMFS → 和 CLI 一样能处理文本头部
- 之前 callMain 因 base64 编解码损坏被弃用，但当前 `ReadFileBytes`→base64→`Uint8Array` 已修复
- 结果: ✅ 秒级解码 ~4.7MB V3 文件，42 文件，1200 骨，4714 方

**Round 4**: HideWindow

- `exec.Command` 调 YSMParser.exe 没设 `HideWindow`，命令行窗口会闪现
- 修复: `app.go` 两处加 `cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}`

### 最终解码流程

```
detectYsmVersion
  ├─ =3 → decodeYsmFile(MEMFS) → 成功 ✅ / 失败 → Go CLI
  ├─ =2 → decodeYsmFileFromMemory(原始字节)
  │       └─ 失败 → stripYsgpTextHeader → rebuild V2 → decodeYsmFileFromMemory
  └─ =0 → decodeYsmFileFromMemory(原始字节)
          └─ 失败 → stripYsgpTextHeader → try V2/V3 → decodeYsmFileFromMemory
```

### 关键发现

1. V3 魔数是 `YSM`（3B），与 V2 的 `YSGP`（4B）完全不同，不能用 V2 风格重建
2. V3 文本头部变体的二进制段中无独立 16B hash，hash 仅在 `<hash>` 文本标签中
3. `detectYsmVersion`（C 函数 `ysm_detect_version`）能识别文本头部中的 V3 标记
4. `decodeYsmFileFromMemory` 不处理文本头部，必须用 `decodeYsmFile`（MEMFS + callMain）
5. MEMFS + callMain 之前因 base64 损坏被弃用，但损坏源已修复，V3 场景可重新启用
6. `let` TDZ: V3 块赋值 `files` 时 `let files;` 声明在后面，JS 报 `Cannot access 'files' before initialization`

### 受影响的文件

| 文件                                          | 改动                                          |
| --------------------------------------------- | --------------------------------------------- |
| `frontend/js/components/app-preview/index.js` | 新增 V3 检测 + MEMFS 路径 + geometry 解析修复 |
| `app.go`                                      | 两处 `exec.Command` 加 `HideWindow`           |
| `frontend/js/wasm/ysm-parser.js`              | 无改动（`decodeYsmFile` 已存在）              |

### 教训

- **`detectYsmVersion` 是有效的预检工具**：在触发完整解码前先检测版本，V3 走不同路径
- **MEMFS 路径不该被永久弃用**：之前因特定 bug 关闭的路径，bug 修复后应重新评估
- **JS `let` 声明必须在赋值前**：V3 块放在 `let files;` 之后的代码才会引用到已初始化的变量
