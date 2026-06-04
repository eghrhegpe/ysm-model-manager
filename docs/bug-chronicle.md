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
    .replace(/§[0-9a-fk-or]/gi, "")  // 去掉 MC 格式码
    .replace(/\n/g, "<br>");          // 换行转 HTML
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
.fl .nm .nm-tag { color: #cba6f7; }      /* [] 紫色 */
.fl .nm .nm-bracket { color: #89b4fa; }   /* 【】蓝色 */
```

搜索模式（`hasSearch`）下使用原有的 `hl()` 高亮，不叠加颜色高亮。

---

## 通用教训

1. **别信任 ysm.json原始数据** — `tips` 含有 `§` 格式码、`authors.name` 可能含乱码；必须清洗后展示
2. **UI state 不等于 data state** — 文件夹开关的 `on` class 不代表所有文件都是启用状态（可能是混合状态 `partial`），判断业务逻辑应基于数据而非 UI
3. **路径传递要保持完整** — 仓库→整合包的安装路径需要在 Go 端就传完整路径（`e.Path` 而非 `e.Name`），前端不做二次拼接
4. **不要 CSS 旋转 + Unicode 箭头文字一起用** — 选一个方案，要么纯 CSS 绘制箭头，要么纯 Unicode 文字切换
5. **Go 结构体缺少字段要补** — `ysmProperties` 缺少 `ExtraAnimation` 字段导致动画组名称无法读取
