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

## Debug Path Review

> 记录排查过程中的错误推测路径，防止未来的 AI 重复踩坑。
> 原则：Round 1-N 是错误猜测，Round N+1 才是真相。

### Issue: 整合包右键"从仓库导入"导入了所有整合包

- **Round 1 (Guess)**: 以为是 Go 端 `sync:download-missing` handler 循环写错了。
  - _查了 `global-handlers.js` 的 `statusList` 循环，逻辑看起来是对的。_
- **Round 2 (Guess)**: 以为是 bus 事件发重复了。
  - _查了 `app-modules.js` 的 `ctx:show` → `menu:show` 映射，只发了一次。_
- **Round 3 (Truth)**: 事件根本没传 `instanceName`。
  - _`app-modules.js` 中 `bus.emit("sync:download-missing")` 没带参数。handler 拿不到目标整合包，只能遍历所有。_
- **Lesson**: 涉及循环/筛选的问题，**先看数据源（Event Payload）**，再看循环体。Event 没传参数，后面全白查。

### Issue: `window.showConfirm` 确认框不弹

- **Round 1 (Guess)**: 以为是 `modal.js` 没加载。
  - _查了 import 路径，✅ 正确。_
- **Round 2 (Guess)**: 以为是 Shadow DOM 作用域问题。
  - _花了 15 分钟查 `app-content` 的 Shadow DOM 隔离。_
- **Round 3 (Truth)**: `window.showConfirm` **从未被挂载到 window 上**。
  - _`confirm.js` 定义的是局部 `function showConfirm()`，没有 `window.showConfirm = showConfirm`。所有 `window.showConfirm?.()` 都是静默 `undefined`。_
- **Lesson**: 全局函数调用不工作 → 先 `console.log(window.showConfirm)` 看是不是 `undefined`，不要猜作用域。

### Issue: 批量重命名对话框复选框不显示

- **Round 1 (Guess)**: 以为是 CSS `display:none` 或 Shadow DOM 样式隔离。
  - _查了渲染出来的 HTML，发现 `<input type="checkbox">` 标签根本不存在。_
- **Round 2 (Truth)**: `renderPreview` 的 HTML 模板里没写 checkbox。
  - _`selected: true` 数据字段和事件委托逻辑都写了，就 HTML 字符串漏了。_
- **Lesson**: UI 组件不显示 → **先看 DOM 元素是否存在**（DevTools Elements），别先猜样式。

### Issue: JSON 配置读出来全是默认值

- **Round 1 (Guess)**: 以为是 `json.Unmarshal` 字段 tag 写错了。
  - _结构体和 JSON 字段名仔细对了三遍，没问题。_
- **Round 2 (Guess)**: 以为是文件路径不对。
  - _加了日志发现文件能找到。_
- **Round 3 (Truth)**: PowerShell 写入的 JSON 文件带 UTF-8 BOM（`EF BB BF`）。
  - _Go 标准库 `json.Unmarshal` 不处理 BOM，解析失败静默返回零值。_
- **Lesson**: Windows 上 JSON 文件 + PowerShell = BOM 陷阱。所有 JSON 读取加 `bytes.TrimPrefix([]byte{0xEF,0xBB,0xBF})`。

### Issue: 筛选面板不能关闭 / 批量菜单没有内容

- **Round 1 (Guess)**: 以为是筛选 toggle 逻辑少写了 close 分支。
  - _读了 `events.js` → 发现 `btn-filter-toggle` 上有**两个** click handler。第一个是旧的 batch toggle 代码残留。_
- **Round 2 (Guess)**: 以为是批量菜单渲染函数没调用。
  - _查了动态创建代码 → 菜单用 `insertBefore` 直接插在 `.hdr-row` 里，没有 `.dd-wrap` 包裹。`position:absolute` 找不到定位父元素，内容在视口外不可见。_
- **Round 3 (Truth)**: 筛选检测 class 不匹配。
  - _`renderFilterHTML()` 输出 `<div class="hdr">`，但关闭判断写 `c.querySelector(".filter-bar")` → 永远 null → 永远认为未展开 → 永远无法关闭。_
- **Lesson**: 动态 HTML 的生产（`renderFilterHTML`）和消费（toggle handler 检测）必须用相同的 class/id。先 grep 确认两端一致，不要靠记忆。

### Issue: `go build` 生成的 exe 白屏

- **Round 1 (Guess)**: 以为是前端构建失败。
  - _单独跑了 `npx vite build`，dist 目录正常。_
- **Round 2 (Guess)**: 以为是 Wails 版本问题。
  - _`wails.json` 版本号是对的。_
- **Round 3 (Truth)**: Wails 项目必须用 `wails build`。
  - _普通 `go build` 缺少 Wails build tags，前端资源没有被嵌入二进制。_
- **Lesson**: 框架项目用框架的构建工具。Wails = `wails build`，不用猜 `go build` 为什么不行。

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

### 14. 多文件 YSM 模型骨骼偏移 — pivot map 覆盖（bug-chronicle #14）

#### 症状

- 多 geometry 文件模型（main.json + arm.json）中，arm.json 的手部/袖子立方体位置偏移
- 头发、帽子、裙子等部位未正常展开

#### 根因

`spec.go` 中 `pivots` map 被同名骨骼的第二次出现覆盖：

```go
// ❌ 同名骨骼的 pivot 被后加载的文件覆盖
pivots := make(map[string]vec3)
for _, b := range model.Bones {
    pivots[b.Name] = vec3{-b.Pivot[0], b.Pivot[1], b.Pivot[2]}
}
// 后续 cube 计算全用这个最终 pivot
bp := pivots[b.Name]
buildCubeMeshData(c, bp, ...) // ❌ arm.json 的 cube 用了 main.json 的 pivot
```

`Bone2D` 缺少 `Rotation` 字段，导致骨骼旋转丢失：

```go
type Bone2D struct {
    Name   string
    Parent string
    Pivot  [3]float64
    // ❌ Rotation 字段不存在
}
```

ZIP/7z 解析路径使用 `seen` map 跳过同名骨骼的 cubes，导致立方体丢失：

```go
// ❌ 同名骨骼的 cubes 被静默丢弃
for _, b := range g.Bones {
    if !seen[b.Name] {
        geo.Bones = append(geo.Bones, b)
    }
}
```

#### 修复

1. `pivots` map 同名骨骼保留首次出现的 pivot：
   ```go
   if _, exists := pivots[b.Name]; !exists {
       pivots[b.Name] = vec3{-b.Pivot[0], b.Pivot[1], b.Pivot[2]}
   }
   ```
2. Cube 计算使用当前骨骼自身 pivot（`bpSelf = vec3{-b.Pivot[0],...}`），不依赖共享 map。
3. `Bone2D` 新增 `Rotation [3]float64` 字段 + 解析。
4. `spec.go` 将骨骼欧拉角转四元数（`eulerToQuaternion(-b.Rotation[0], -b.Rotation[1], b.Rotation[2])`）。
5. ZIP/7z 解析路径改为全追加（`geo.Bones = append(geo.Bones, g.Bones...)`），去重统一交给 `threejs.Build()`。

#### 影响文件

`go/types/bedrock.go`, `app.go`, `go/threejs/spec.go`, `frontend/js/utils/model3d.js`, `frontend/js/components/app-preview/utils.js`

---

### 15. Three.js 透明度遮挡 — alphaTest（bug-chronicle #15）

#### 症状

- 透明纹理的透明区域遮挡后面模型的渲染
- 可见效果：皮肤透过衣服看到，但透明部分有「空洞」或遮挡

#### 根因

WebGL 深度缓冲行为：

- `transparent: true` + `depthWrite: true`（默认）→ 透明像素写入深度缓冲，阻塞后面物体
- `transparent: true` + `depthWrite: false` → 透明物体覆盖在所有物体之上，顺序错乱

#### 解决

Minecraft 像素风贴图为**二元透明度**（全透明/全不透明），使用 `alphaTest` 代替 `transparent`：

```js
// ✅ 标准做法：alphaTest 丢弃透明像素，不参与深度缓冲
const mat = new THREE.MeshBasicMaterial({
  map: cubeTex,
  alphaTest: 0.5, // alpha < 0.5 的像素直接丢弃
  side: THREE.DoubleSide,
  // 无 transparent: true → 渲染在不透明通道，深度缓冲正常工作
});
```

#### 参考

Three.js 官方文档 [How to Draw Transparent Objects](https://threejs.org/manual/en/transparency.html)："For sharp edged textures, alpha test works well — pixels below threshold are not drawn, so depth issues disappear."

---

## Debug Path Review

### Issue: 多文件模型手臂位置错误

- **Round 1 (Guess)**: 以为是同名骨骼覆盖了正确层级信息（main.json 覆盖 arm.json）。
  - _改成了"overwrite"逻辑（后加载覆盖前加载），但发现 arm.json 和 main.json 的骨骼名称完全不重叠。_
- **Round 2 (Guess)**: 以为是加载顺序问题（arm.json 先于 main.json 加载）。
  - _把"skip duplicates"改成"overwrite"→ 但 main.json 没有 RightArm，无效。_
- **Round 3 (Truth)**: debug 日志显示 `RightArm → RightArm`（自指父骨骼）。
  - _main.json 中有同名 RightArm 但 parent 为空或为自身。覆盖逻辑让后加载的 main.json 覆盖了 arm.json 的正确 parent（Arm）。_
  - _修复：同名骨骼保留首次出现的层级信息，仅追加 cubes。_
- **Round 4 (Trump)**: 修复层级后，头发/裙子仍有偏移。
  - _`pivots` 共享 map 被同名骨骼的第二次出现覆盖。arm.json 的 cube 用 main.json 的 pivot 计算位置。_
  - _修复：每个骨骼的 cube 使用自身 pivot 计算，不依赖共享 map。_
- **Round 5 (Final)**: 手臂仍无旋转。
  - _`Bone2D` 类型没有 `Rotation` 字段，JSON 解析也漏了。YSMViewer 用 `CreateBlockbenchQuaternion(bone.Rotation)`。_
  - _修复：添加 `Rotation` 字段 + 解析 + 转四元数。_
- **Lesson**: 跨语言（C#→Go→JS）移植时，**逐字段对比数据模型**。YSMViewer 读了的字段，我们这边也要读。不要只看 visual 效果猜原因，先加日志看实际 spec 数据。`pivots` 等共享 map 在有同名 key 时要考虑覆盖问题。

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

---

## 2026-06-06 新增 bug 记录

### 20. 文件夹回收/重命名/新建传递相对路径（bug-chronicle #20）

#### 症状

- 右键文件夹 → 移入回收站 → `回收了 0 个文件`
- 重命名/新建文件夹也失败

#### 根因

仓库树中的 `data-dir` 存的是**相对路径**（如 `[Almeta_owx]【galgame】`），但 `ScanModelEntries`、`RenameDir`、`CreateDir` 等 Go 绑定需要**绝对路径**。

#### 修复

三个文件夹操作（`dir:recycle`、`dir:rename`、`dir:mkdir`）都在调用 Go 绑定前先加载 `LoadAppConfig` 获取 `repoRoot`，拼接绝对路径。

---

### 21. ClearCustomDir 因 .ban 后缀匹配失败（bug-chronicle #21）

#### 症状

- 右键整合包 → 清空 → `已清空 0 个文件`
- 仓库中已禁用的模型不会被清理

#### 根因

`ClearCustomDir` 用 `filepath.Base(p)` 作为文件名查仓库映射。如果仓库文件已被禁用（加 `.ban` 后缀），仓库中的文件名是 `file.ysm.ban`，custom 目录中是 `file.ysm`，匹配不上。

#### 修复

`lookupName := strings.TrimSuffix(fileName, ".ban")` 去掉后缀再匹配。

---

### 22. wails build -o 不支持 Windows 绝对路径（bug-chronicle #22）

#### 症状

`mkdir C:\...\build\bin\C:: The filename is incorrect.`

#### 根因

`wails build -o C:\path\to\exe.exe` 中 `-o` 参数在 Windows 上被错误解析——把 `C:\` 当作子目录名。

#### 修复

去掉 `-o` 参数，默认输出到 `build/bin/`，再用 `Copy-Item` 复制到目标目录。

---

### 23. 游戏运行时文件被锁定，同步失败（bug-chronicle #23）

#### 症状

- 禁用模型后，整合包内对应文件未被加 `.ban`
- 无任何提示

#### 根因

YSM 加载模型时文件被进程锁定，`os.Rename` 返回 `ERROR_SHARING_VIOLATION`。

#### 实际表现（来自测试）

- **正常情况**：YSM 仅在一瞬间读取文件到内存，读取完毕即释放锁。等模型加载完毕即可继续管理。
- **软链接 + 启动器权限问题**：如果模型是符号链接，且启动器（PCL/HMCL）未以管理员权限运行，YSM 可能无法解析链接目标，导致文件一直被"挂起"无法释放锁。
- **后果**：同步功能失效，需退出游戏，禁用符号链接模式，改用硬链接或复制。

#### 修复

添加 `isFileLocked(err)` 函数检测共享违例，文件被锁时跳过不报错，下次 watcher 触发再试。但软链接 + 权限问题需要用户退出游戏后手动调整链接模式。

---

## 通用教训（补充）

13. **树中的路径永远是相对的** — `data-dir` 存相对路径，调用 Go 绑定前必须拼接 `repoRoot + "/" + dir`
14. **.ban 后缀无处不在** — 任何文件名匹配的地方都要考虑 `.ban` 后缀的存在

---

## 2026-06-06 新增 bug 记录

### 24. AI 写的新代码块漏/多花括号（bug-chronicle #24）

#### 症状

- Vite 构建报 `Parse error @:1648:1`，指向文件末尾的类关闭 `}`
- 编辑器中文件看起来语法正确，但 esbuild 解析失败

#### 根本原因

AI（我）在两次 `replace_string_in_file` 中写错了新代码块的括号结构：

| #   | 错误                       | 位置                                  | 表现                             |
| --- | -------------------------- | ------------------------------------- | -------------------------------- |
| 1   | `.map()` 回调丢了 `return` | `renderList` 函数                     | esbuild 报 `Unexpected ')'`      |
| 2   | `const` 声明后多了一个 `}` | `showRepoModels` 中的 `dlPrefix` 赋值 | Vite 报 `Parse error` 在文件末尾 |

#### Debug 路径

- **Round 1**: 以为是 esbuild 版本太旧不兼容某些 JS 语法
  - _试了 acorn 解析、Node.js --check，都报同样的错误_
- **Round 2**: 以为文件末尾有不可见字符
  - _hex dump 确认只是纯文本 `}`_
- **Round 3**: 检查花括号深度
  - _发现多余的 `}` 在 `dlPrefix` 赋值语句后面_
  - **真相**: 手写的 `newString` 里多打了一个 `}`

#### Lesson

`replace_string_in_file` 的 `newString` 完全靠手写，没有语法校验。写块状代码（特别是多层嵌套的 if/return/闭包）时，少一个 `{` 或多一个 `}` 都很难发现。应该：

- 每次改完立即跑 `npx vite build` 验证（而不是攒一堆再构建）
- 用编辑器先写/验证小段代码，再组装到大块替换中

15. **wails build -o 在 Windows 有 bug** — 用默认输出路径 + Copy-Item 替代
16. **Windows 文件锁不可绕过** — 游戏运行中不能改文件，检测后跳过，等待下次触发

---

## 10. WASM 内嵌 YSMParser 解码（8 轮 Debug）

### 症状

加密 .ysm 模型通过 WASM 解码始终报 `Unsupported file version detected`，但同一份源码编译的 CLI exe 正常。

### 排查路径

#### Round 1: 怀疑 Emscripten 编译裁剪

- 查 `YSMParser.cpp` 确认版本检测逻辑是纯字节比较，无平台依赖
- 确认 `__EMSCRIPTEN__` 和 `YSM_WASM_TARGET` 宏正确设置
- **真相**: 数据链路 `Go ReadFileBytes → JSON → JS → FS.writeFile → WASM ifstream` 已损坏
- **尝试**：加 `-sINVOKE_RUN=0`、重写文件清理、加 `-sFORCE_FILESYSTEM`
- **最终**：放弃 MEMFS callMain，改为内存解析 bridge

#### Round 2: 新增 `ysm_decode_from_memory` bridge

- 绕开文件 I/O，直接 `YSMParserFactory::Create(const char* data, size_t size)`
- 但仍报 `Unsupported file version` — 因为数据根本没写进 WASM 内存

#### Round 3: HEAPU8 不可访问（新 Emscripten 闭包变量）

- `wasmModule.HEAPU8` 是 `undefined`
- `wasmModule.asm?.memory` 也不存在
- **修复**: 胶水代码注入 `Module["HEAPU8"]=HEAPU8`

#### Round 4: `const glueCode` 重赋值（低级语法错）

- `glueCode = glueCode.replace(...)` 报 `Assignment to constant variable`
- **修复**: `const` → `let`

#### Round 5: `.replace()` 误改函数定义

- `"updateMemoryViews()"` 同时匹配了函数定义 `function updateMemoryViews(){`
- 导致 `function updateMemoryViews();Module["HEAPU8"]=HEAPU8{` 语法错误
- **修复**: 改用 `";updateMemoryViews()"`（带分号前缀）

#### Round 6: ALLOW_MEMORY_GROWTH 后 HEAPU8 分离

- `_malloc(284KB)` → WASM 内存扩容 → 旧 HEAPU8 指向已分离 ArrayBuffer
- `heap.set(data, ptr)` 写入旧 buffer，WASM 代码读新 buffer → 全零
- **修复**: `_malloc` 之后重新 `_getHeap()` 获取最新引用

#### Round 7: `new Uint8Array(string)` 在 WebView2 返回空

- `Array.from(src.slice(0,8))` 返回空数组
- **修复**: 改用 `Uint8Array.from(data, c => c.charCodeAt(0))`

#### Round 8: 🔑 `ReadFileBytes` 返回 base64 字符串

- JS 侧 `atob(bytes)` 解码后显示正确文件头 `ef bb bf 59 53 47 50`
- WASM 侧收到的是原始 base64 字符 `%7u/WVNHUA0K...`
- **真相**: Wails Go `[]byte` 通过 JSON 序列化返回 **base64 编码的字符串**
- **修复**: `atob()` 解码后再传入 WASM

### 修复后的数据流

```
[]byte(Go) → base64 string(JSON) → atob()(JS) → Uint8Array → heap.set() → WASM
```

### Lesson

跨语言数据传递（Go → JSON → JS → WASM HEAPU8 → C++）每层都可能改变数据类型，**必须每层验证**。写诊断代码时先用 `console.log(typeof data, data[0].toString(16))` 确认数据类型。

---

## 2026-06-08 新增 bug 记录

### 25. 筛选面板点击后不能收起（bug-chronicle #25）

#### 症状

- 点击 🔍 筛选 展开第三行筛选栏（骨骼≥/≤、立方≥/≤）
- 再次点击无法收起
- 按钮文字一直显示「🔍 筛选 ▾」

#### 根因

双重 bug：

1. **重复 click handler** — `events.js` 中 `btn-filter-toggle` 上注册了两个 `addEventListener("click", ...)`。第一个是旧的 batch toggle 残留代码，第二个才是正确的筛选 toggle。每次点击：旧 handler 把 `#hdr-container` 填入批量按钮 → 新 handler 检测到内容不是 `.filter-bar` 就清空 → 筛选面板永远无法正常展开。

2. **类名不匹配** — `renderFilterHTML()` 输出的外层 div 是 `<div class="hdr" ...>`，但 toggle handler 的判断条件是 `c.querySelector(".filter-bar")`。没有任何元素有 `filter-bar` 类 → `querySelector` 永远返回 null → 关闭分支永远不执行。

#### 修复

- 删除残留的旧 batch toggle handler（339-352 行）
- `renderFilterHTML()` 外层 div 加上 `filter-bar` 类名：`<div class="filter-bar hdr" ...>`

---

### 26. 批量 ⚡ 下拉菜单无内容（bug-chronicle #26）

#### 症状

- 点击或悬停 ⚡ 批量 按钮
- 下拉菜单展开但空白

#### 根因

动态创建的 `<div class="dd-menu batch-menu">` 用 `insertBefore` 直接插在 `.hdr-row` 里，没有用 `.dd-wrap` 包裹。`.dd-menu` 有 `position:absolute`，但没有任何祖先元素有 `position:relative`，导致菜单定位到视口外不可见区域。

其他下拉按钮（作者、纹理）都在模板中有 `.dd-wrap { position:relative }` 包裹，唯独批量是动态创建时漏了这一步。

#### 修复

```js
const batchWrap = document.createElement("div");
batchWrap.className = "dd-wrap";
batchWrap.style.display = "inline-block";
batchBtn?.parentNode.insertBefore(batchWrap, batchBtn);
batchWrap.appendChild(batchBtn);
batchWrap.appendChild(menuBatch);
```

#### Lesson

动态创建的 DOM 元素和模板中已有的元素，**定位/布局容器必须一致**。动态创建不能只用 `insertBefore`，要考虑 `position:absolute` 需要定位父容器。下次动态创建带下拉的 UI，先确认是否要 `.dd-wrap` 包装。

---

### 排查路径汇总

**Round 1**: 筛选 toggle 逻辑 → 发现重复 handler（旧代码残留）
**Round 2**: 批量菜单渲染 → 发现没有 `.dd-wrap` 定位父容器
**Round 3**: 筛选检测 class → 发现 `renderFilterHTML()` 和 toggle handler 用的类名不一致

**Lesson**: 涉及 toggle 开关的 UI，先确认"生产"（HTML 生成）和"消费"（状态检测）用的是同一个 class/id。动态 DOM 操作注意定位父容器。

---

## 2026-06-09 新增 bug 记录

### 27. ZIP 模型手臂竖直朝下 / 位置偏移（bug-chronicle #27）

#### 症状

- `.zip` 模型的 3D 预览中手臂竖直朝下，裙子/帽子等正常
- `.ysm` 模型（同一作者同模型）渲染正常
- `GetModel3DSpec` 返回的 spec 骨骼数据与 JS 兜底不一致

#### 根因

ZIP 模型包含多个几何 JSON 文件（`arm.json`、`main.json`），`parseBedrockFromZip` 按字母顺序追加骨骼。`arm.json`（先）和 `main.json`（后）中都有 `RightArm`/`LeftArm`，但：

1. **Bone pivot 用错** — `pivots` map 存储首次出现的 pivot（`arm.json` 的 `[1.9,27.8]`），导致骨骼位置计算用了错误 pivot。应使用**有 parent 的那个 occurrence**（`main.json` 的 `[3.15,27.3]`）。
2. **Cube pivot 不一致** — bone 和 cube 使用了不同的 pivot（bone 用当前骨骼、cube 用首次出现的），导致 cube 位置偏移。
3. **Rotation 丢失** — 去重时只更新了 parent 和 position，`main.json` 的骨骼旋转未传递到最终骨骼。

#### 修复

**`go/threejs/spec.go`**:

```go
// 1. pivots 优先保留有 parent 的骨骼 pivot
pivots := make(map[string]vec3)
for _, b := range model.Bones {
    np := vec3{-b.Pivot[0], b.Pivot[1], b.Pivot[2]}
    if _, exists := pivots[b.Name]; !exists {
        pivots[b.Name] = np
    } else if b.Parent != "" {
        pivots[b.Name] = np  // 有 parent 的覆盖
    }
}

// 2. 去重时同时更新 rotation
if bones[idx].ParentID == nil && b.Parent != "" {
    bones[idx].ParentID = &b.Parent
    bones[idx].LocalPosition = localPos
    bones[idx].LocalRotation = localRot  // 新加
}
```

**`frontend/js/utils/model3d.js`** — 同上 rotation 补全逻辑。

#### 影响文件

- `go/threejs/spec.go`
- `frontend/js/utils/model3d.js`

#### Debug Path Review

**Round 1 (Parent 补全)**: 发现同名骨骼去重时，`arm.json` 的扁平 RightArm 在 main.json 之前处理，正确层级被丢弃。
→ 修复: 现有骨骼无 parent 且新骨骼有 parent 时补全 parent + localPosition。
→ 效果: 骨骼层级正确了（`RightArm → Arm`），但渲染仍有偏移。

**Round 2 (bp vs pivots)**: 对比 Go 和 JS spec 发现 `RightArm` localPosition 不一致（Go: `[1.9,0.5,0]` vs JS: `[3.15,0,0]`）。
→ 根因: `bp := pivots[b.Name]` 用了首次出现的 pivot，应改为当前骨骼的 pivot。
→ 修复: `pivots` 优先保留有 parent 的骨骼（`main.json` 的正确 pivot 覆盖 `arm.json` 的扁平版本）。
→ 效果: Go 和 JS 数据一致了，但渲染仍有偏差。

**Round 3 (Cube pivot 不一致)**: Cube 用首次出现的 pivot 计算相对位置，但 bone 用当前骨骼 pivot，导致 cube 偏移。
→ 修复: bone 和 cube 统一使用 `pivots[b.Name]`（已优先保留有 parent 的 pivot）。

**Round 4 (Rotation 丢失)**: 去重时只更新 parent/position，`main.json` 的骨骼旋转未传递。
→ 修复: 去重时同步更新 `LocalRotation`。
→ 最终效果: ZIP 模型渲染正常 ✅

**Lesson**: 多文件合并时，同名骨骼的**所有属性**（parent、pivot、rotation）都必须统一到有 parent 的那个 occurrence。`pivots` 共享 map 不能简单保留首次出现，要优先保留有层级关系的数据。每次改完用对比诊断（Go spec vs JS spec）验证一致性。命令行 + 生产版 EXE 是两个东西，必须确保测试的是正确版本。
