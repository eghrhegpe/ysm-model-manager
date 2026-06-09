# 预览图系统重构复盘

> 日期: 2025-06-07
> 涉及文件: `workshop-render.js`, `workshop-events.js`
> 轮次: 6 次迭代

---

## 演化历程

### Round 1: 每行独立创建/销毁（原始实现）

每行在 `mouseenter` 时 `document.createElement("img")`，`mouseleave` 时 `element.remove()`。

**问题**: 列表重渲染时（搜索/筛选）旧行的 `mouseleave` 不触发，预览节点变成僵尸堆积在 `document.body` 上。

### Round 2: 模块级共享单例

改为模块级 `let _previewEl = null`，每次 `showPreview` 前先 `hideGlobalPreview()` 清理上一次。

**问题**: 仍是「惰性清理」——预览的销毁依赖下一次用户操作（hover 另一行），而非列表重渲染事件。搜索时预览幽灵可能残留。

### Round 3: 响应式销毁（守墓人）

在 `renderModelList` 入口加 `hideGlobalPreview()`，确保列表重绘前必然清理。

**问题**: 创建/销毁循环仍然存在——每行 hover 都要 `createElement → appendChild → remove → createElement → ...`，DOM 操作频繁。

### Round 4: 永久单元素架构

一个固定的 `div#ws-preview`（内嵌 `img` + fallback `div`），hover 时只切换 `display` 和 `src`，永不创建/销毁 DOM。

```js
// 模块初始化时创建一次，永不清除
const _previewEl = document.createElement("div");
document.body.appendChild(_previewEl);

// hover: 只更新 src 和位置
_previewImg.src = newUrl;
_previewEl.style.display = "block";

// leave: 只隐藏
_previewEl.style.display = "none";
```

### Round 5: 异步坐标过时

`tryShowPreview` 用 `new Image()` 异步测试 `.png`/`.jpg`/`.webp`。`mouseenter` 事件的 `e.clientX/Y` 在异步回调触发时已过时。

修复：固化 `mouseenter` 坐标通过异步链传递。

```js
// mouseenter 时冻结坐标
const anchorX = e.clientX, anchorY = e.clientY;
tryShowPreview(anchorX, anchorY);
// → 异步 onload 回调: showPreview(anchorX, anchorY, url)
//                      ↑ 无论过多久，坐标都是当初悬停的位置
```

### Round 6: 串行 → 并行加速

三个后缀 `.png`/`.jpg`/`.webp` 从串行测试改为并行：

```js
// 之前: png 404 → jpg 404 → webp 加载 → 显示 (三次网络往返)
// 现在: png、jpg、webp 同时请求，谁先成功用谁 (一次网络往返)
urls.forEach(url => {
    const img = new Image();
    img.onload = () => showPreview(anchorX, anchorY, url);
    img.onerror = () => { /* 全部失败才显示 🎨 */ };
    img.src = url;
});
```

---

## 关键教训

### 1. DOM 节点的生命周期必须绑定到它的容器

创建/销毁循环有本质缺陷：列表重渲染会暴力替换 `innerHTML`，旧节点的 `mouseleave` 永不触发。正确的做法是**一个永久节点 + display 切换**。

### 2. 异步链中的事件坐标会过时

`mouseenter` → `new Image()` 异步测试 → `onload` 回调，这个链条里的 `e.clientX/Y` 在回调执行时已经过时。必须**固化坐标值**在闭包中传递。

### 3. 网络请求是预览延迟的主因

串行测试三个后缀意味着最多三次网络往返（每次等 404 返回）。并行请求将延迟降为**最快的那次往返时间**。

### 4. 最终架构

```
模块加载时:
  createElement("div#ws-preview") → appendChild(document.body)
  ├── _previewImg (img, 主显示)
  └── _previewFallback (div 🎨, 降级占位)

mouseenter → 固化坐标 → 并行 new Image() 测试 .png/.jpg/.webp
                     ├── 成功 → showPreview(anchorX, anchorY, url)
                     │           ├── _previewImg.src = url
                     │           └── _previewEl.style.display = "block"
                     └── 全失败 → _previewFallback.style.display = "flex"

mousemove → _previewEl.style.left/top = mouseX/Y

mouseleave → _previewEl.style.display = "none"

renderModelList → hideGlobalPreview() → _previewEl.style.display = "none"

永不 createElement/removeChild，只有 display 切换 + src 更新。
```
