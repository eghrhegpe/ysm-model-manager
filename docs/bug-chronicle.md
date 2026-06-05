# 问题排查记录

## 1. 文件夹开关「toggleFolderBatch」只读不写

### 症状

- 点击文件夹开关（绿色/灰色/黄色）没有任何效果
- 日志输出 `toggleFolderBatch: 所有文件已经是目标状态 {enable: false, total: 8}`
- 但实际上文件状态没有被翻转

### 根因

`toggleFolderBatch` 中的逻辑错误：

```js
// ❌ 旧逻辑：根据 ck class 取反，然后筛选 "已经不需要操作" 的文件
const currentlyOn = ck.classList.contains("on");
const enable = !currentlyOn;
const snapshot = targets.filter((e) => e.banned === !enable);
```

当 `currentlyOn = true`（绿色）：`enable = false`（禁用）→ 筛选 `banned === true`（已禁用的文件）→ 这些文件已经是禁用状态 → snapshot 为空 → 跳过。

**循环论证**：通过 UI 状态决定翻转方向，然后筛选不需要操作的，结果是永远没文件要操作。

### 修复

```js
// ✅ 新逻辑：不看 UI class，直接看数据
const allEnabled = targets.every((e) => !e.banned);
const enable = allEnabled ? false : true;
// 全启用→全部禁用；全禁用或混合→全部启用
```

直接根据 `e.banned` 数据判断，不依赖 UI 的 `on` class。

---

## 2. 仓库按钮「全部启用/全部禁用」写反

### 症状

- 点击「✅ 全部启用」→ 所有模型变成灰色（禁用）
- 点击「⛔ 全部禁用」→ 所有模型变成绿色（启用）

### 根因

筛选条件写反：

```js
// ❌ 旧逻辑
const snapshot = entries.filter((e) => e.banned === !enable);
// enable = true（启用）时：筛选 banned === false（已启用的）→ 跳过已启用的 → 对已禁用的无操作
// 实际要找的是 banned === true（已禁用的）来启用
```

### 修复

```js
// ✅ 新逻辑
const snapshot = entries.filter((e) => e.banned === enable);
// enable = true：筛选 banned === true（已禁用的）→ 启用它们
// enable = false：筛选 banned === false（已启用的）→ 禁用它们
```

---

## 3. 文件夹右键菜单按钮冗余

### 症状

- 文件夹开关（大按钮 UI）已支持：全启用/全禁用/混合翻转
- 右键菜单还保留了同样的「全部启用」「全部禁用」两个按钮
- 用户容易混淆，且 UI 和菜单行为可能不一致

### 修复

删除文件夹右键菜单中的两个按钮，统一走大按钮开关。

---

## 4. 树箭头旋转混乱

### 症状

- 程序自动展开的文件夹，箭头 `▼` 旋转了 45° 变成 `↘`
- 关闭状态箭头 `▶`
- `ar.open` class 和 CSS `rotate(90deg)` 叠加 Unicode 文字导致了双重旋转

### 根因

```js
// row-tpl.js：展开用 ▼，折叠用 ▶
const ar = isOpen ? "▼" : "▶";
// CSS：同时有 rotate
.fh .ar.open { transform: rotate(90deg); }
// events.js：切换时还加 open class
ar.classList.toggle("open", !open);
```

展开时文字是 `▼`，CSS 再旋转 90° → `↘`。

### 修复

去掉 CSS rotate，直接通过文字切换：

```js
ar.textContent = open ? "▾" : "▸";
```

不使用 `open` class，不旋转。

---

## 5. 模型详情 tips 显示为恐怖原始数据

### 症状

```
乐园的可爱巫女 版本v1.3 包含内容: §3 ·基础动作适配及更改 §3 ·新版main动画控制器...
```

- `§3` 等 MC 格式代码未清洗
- `\n` 换行符被 HTML 吞掉，所有文字挤在一行

### 根因

`summary.tips` 直接赋值了原始 ysm.json 中的 `tips` 字段，未经任何清洗。

### 修复

```js
function cleanTips(text) {
  return text
    .replace(/§[0-9a-fk-or]/gi, "") // 去掉 MC 格式码
    .replace(/\n/g, "<br>"); // 换行转 HTML
}
function cleanText(text) {
  return text.replace(/§[0-9a-fk-or]/gi, "").trim();
}
```

对所有展示的文本字段统一用 `cleanText` 清洗。

---

## 6. 动画组名称未翻译（extra0 → 模型配置）

### 症状

- 模型详情中显示 `extra0 (3)` 而不是 `模型配置 (3)`
- ysm.json 中 `extra_animation_classify` 只有 `id`（extra0），没有 `name`
- 真实名称在 `properties.extra_animation` 中：`{"#extra0": "模型配置", ...}`

### 根因

Go 端 `summary.go` 只读取了 `g.Name`（为空），没有从 `properties.extra_animation` 中根据 `#id` 查找。

### 修复

```go
if name == "" && root.Properties.ExtraAnimation != nil {
    if v, ok := root.Properties.ExtraAnimation["#"+g.ID]; ok {
        if s, ok2 := v.(string); ok2 {
            name = s
        }
    }
}
```

在 `ysmProperties` 结构体中添加 `ExtraAnimation map[string]interface{}` 字段。

---

## 7. 模型详情显示冗余信息

### 症状

- 显示了「体积 453.6 KB」「格式 YSM 模型」「⚙️ 配置 (xx 项)」等用户不关心的信息
- 配置菜单列表太长（`基础配置 (5 项) 常态眼睛配置 (6 项) ...`）
- 动画组没有换行，挤在一行

### 修复

- 移除「体积」「格式」行
- 移除全部「⚙️ 配置」行
- 动画组改为每行一个（`<div>` 换行）

---

## 8. 安装模型失败「源文件不在仓库目录内」

### 症状

```
❌ [Almeta_owx]... → ...custom:
问题描述：源文件不在仓库目录内
操作：安装模型
解决建议：请确保模型文件位于已选择的仓库目录中
```

### 根因

Go 端 `Install` 函数中 `isInsideRepo` 检查失败。传入的 `src` 只是文件名（如 `steve_skin.ysm`），不是带 `repoRoot` 前缀的完整路径。

问题链路：

1. `GetInstanceStatus` 返回的 `Missing` 列表只存了 `e.Name`（文件名）
2. 前端把文件名直接传给 `InstallModelTo`
3. Go 端拿文件名检查 `isInsideRepo` → 不在仓库目录内 → 拒绝

### 修复

```go
// go/sync/sync.go：Missing 存完整路径
status.Missing = append(status.Missing, e.Path)  // 之前是 e.Name
```

前端侧：

- `bus-handlers.js`：不再从 `vm._entries` 补路径，直接传 `st.Missing`（已为完整路径）
- `loader.js`：缺失列表从 `st.Missing`（完整路径）提取 basename 用于显示
- `render.js`：渲染用 `it.displayName`
- `actions.js`：`data-name` 存完整路径，传给 `InstallModelTo`

---

## 9. 模型文件名高亮

### 描述

文件名格式为 `[作者]【项目名】模型名.ysm`，用户希望：

- `[作者]` 用紫色高亮
- `【项目名】` 用蓝色高亮
- 大小和日期保持右侧（flex 布局）

### 实现

```js
// render.js
function highlightName(name) {
  return name
    .replace(/\[([^\]]+)\]/g, '<span class="nm-tag">[$1]</span>')
    .replace(/【([^】]+)】/g, '<span class="nm-bracket">【$1】</span>');
}
```

```css
.fl .nm .nm-tag {
  color: #cba6f7;
} /* [] 紫色 */
.fl .nm .nm-bracket {
  color: #89b4fa;
} /* 【】蓝色 */
```

搜索模式（`hasSearch`）下使用原有的 `hl()` 高亮，不叠加颜色高亮。

---

## 2026-06-05 新增 bug 记录

### 10. 窗口尺寸逐次缩小（bug-chronicle #10）

#### 症状

- 每次重启窗口变小一圈
- 从 1280×800 → 逐渐缩到很小

#### 根因

前端 resize 监听保存 `window.innerWidth/innerHeight`（**内容区**尺寸），Go shutdown 用这些值设置**外层窗口**尺寸。外层窗口 = 内容区 + 标题栏 + 边框，每次都少了标题栏高度。

```js
// ❌ 前端保存内容区尺寸，Go 拿来做窗口尺寸
window.addEventListener("resize", () => {
  App.SaveWindowPosition(x, y, window.innerWidth, window.innerHeight);
});
```

#### 修复

- 移除前端 resize handler
- Go shutdown 时读取真实窗口尺寸（含标题栏/边框）保存

---

### 11. 关闭窗口时 panic（bug-chronicle #11）

#### 症状

```
panic: runtime error: invalid memory address or nil pointer dereference
```

发生在 Wails `WindowGetSize()` 调用时，偶现于特定 Windows 配置。

#### 根因

Wails runtime 在 shutdown 流程中某些条件下返回 nil，`WindowGetSize` 无防御。

#### 修复

```go
func (a *App) shutdown() {
    defer func() {
        if r := recover(); r != nil {
            // 忽略 panic，安全退出
        }
    }()
    // ... 保存窗口状态
}
```

---

### 12. Go 正则表达式不支持负向前瞻（bug-chronicle #12）

#### 症状

```
panic: regexp.MustCompile: (?!(...)): error parsing regexp: invalid or unsupported Perl syntax: `(?!`
```

#### 根因

Go 使用 RE2 引擎，**不支持** `(?!`（负向前瞻）。`proxy.go` 中用 `regexp.MustCompile` 编译了含 `(?!` 的模式。

#### 修复

```go
// ❌ 不支持
re := regexp.MustCompile(`(?i)((?!src|href)\w+)="(/[^"]+)"`)
// ✅ 改用简单匹配 + 辅助函数
func isAbsolute(u string) bool {
    return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "//")
}
```

---

### 13. iframe 安全警告（bug-chronicle #13）

#### 症状

```
The iframe sandbox attribute 'allow-scripts' and 'allow-same-origin' combined is a security risk
```

#### 根因

`allow-scripts` + `allow-same-origin` 组合允许 iframe 内脚本访问父页面 DOM，是已知安全风险。

#### 修复

去掉 `allow-same-origin`：

```html
<!-- ❌ 有安全警告 -->
<iframe
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
></iframe>
<!-- ✅ 修复 -->
<iframe sandbox="allow-scripts allow-forms allow-popups"></iframe>
```

---

### 14. CSV 编码破坏中文和 Emoji（bug-chronicle #14）

#### 症状

- 中文字符变成乱码（如 `碎de帆` → `ç¢deå¸`）
- Emoji 丢失

#### 根因

Go 的 `encoding/csv` 默认 UTF-8 输出，但 Excel/WPS 打开 CSV 时按系统 ANSI 编码（Windows GBK）解析，导致双字节字符损坏。

#### 修复

废弃 CSV 方案，全部改用 JSON：

- `workshop_sites.json` — 站点配置
- `workshop_creators.json` — 创作者配置（单文件 + type 标签）
- 导出/导入统一走 JSON

---

### 15. 下载 404 — Windows 反斜杠路径（bug-chronicle #15）

#### 症状

```
⬇️ 下载 → HTTP 404
```

GitHub raw URL 中出现 `\` 导致路径不合法。

#### 根因

`index.json` 中路径使用 Windows `\`（如 `folder\file.ysm`），前端拼接 URL 时未转换：

```js
// ❌ 反斜杠传入 URL
const url = "https://raw.githubusercontent.com/repo/main/" + m.path;
// → .../main/folder\file.ysm  (404)
```

#### 修复

前端和 genindex 工具统一将 `\` 替换为 `/`：

```js
const url =
  "https://raw.githubusercontent.com/" +
  repo +
  "/main/" +
  m.path.replace(/\\/g, "/");
```

---

### 16. fetch 无超时 — 等待过久（bug-chronicle #16）

#### 症状

- 点击「📦 浏览」后按钮卡在 ⏳ 状态最长 30+ 秒
- 用户不知道是网络问题还是无 index.json

#### 根因

`fetch()` 默认无超时，浏览器内置超时通常在 30~90 秒。

#### 修复

```js
const ctrl = new AbortController();
const tmr = setTimeout(() => ctrl.abort(), 6000); // 6 秒超时
const resp = await fetch(indexURL, { signal: ctrl.signal });
clearTimeout(tmr);
```

---

### 17. 整合包强制展开第一个（bug-chronicle #17）

#### 症状

- 即使没有保存的记录，第一个整合包也自动展开
- 只有第一个的行为和其他不一致

#### 根因

```js
// ❌ idx === 0 导致第一个始终展开
if ((idx === 0 && savedOpen) || savedOpen === name) { ... }
```

#### 修复

纯粹由 `localStorage.getItem("sidebar_open")` 决定，不特殊处理 `idx === 0`。

---

### 18. 文件名颜色被转义吞掉（bug-chronicle #18）

#### 症状

- `[作者]` 紫色和 `【项目】` 蓝色不显示
- 显示为纯文本代码

#### 根因

`esc()` 函数将 HTML 标签转义，把颜色高亮的 `<span>` 变成了纯文本：

```js
// ❌ esc() 把高亮 span 也转义了
display.innerHTML = esc(highlightName(name));
```

#### 修复

先高亮再 esc（只 esc 文件名内容，保留高亮标签）→ 改用不 esc 高亮部分的渲染方式，或者单独处理。

---

### 19. 创意工坊遗留 handler 冲突（bug-chronicle #19）

#### 症状

- 离开创意工坊再回来，编辑模式状态混乱
- 事件绑定重复

#### 根因

每次 `_initWorkshop()` 都重新绑定事件，但 `wsEditMode` 变量在函数闭包内，重新初始化时重置了状态。同时旧的事件监听没有被清理。

#### 修复

- `wsEditMode` 用 `let` 声明在 `_initWorkshop` 闭包顶部（保持持久化）
- 确保 `showSiteView` 每次完全重建 DOM 避免事件堆积

---

## 通用教训（补充）

6. **fetch 永远要加超时** — 浏览器默认超时太长（30~90s），AbortController 是标准方案
7. **避免 CSV 传输非 ASCII 文本** — Go CSV + Windows = 编码灾难，JSON 无此问题
8. **Go RE2 不支持前瞻/后顾** — `(?!` `(?<=` 等 Perl 语法在 Go 中 panic，用辅助函数替代
9. **Window 尺寸保存要区分内外** — 外层窗口尺寸 ≠ 内容区尺寸，Go 端保存才准确
10. **shutdown 必须 recover** — Wails runtime 关闭时可能 nil panic，必须有防御性 recover
11. **路径格式要面向 URL** — Windows `\` 只在本地文件系统有效，跨网络/跨平台必须用 `/`
12. **按钮状态要区分「加载中」和「不可用」** — ⏳ 表示还在等，❌ 表示已确认失败，避免用户反复点
