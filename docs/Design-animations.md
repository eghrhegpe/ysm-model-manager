# 前端动画系统文档

## 概述

YSM 模型管理器采用纯 CSS + vanilla JS 实现所有动画效果，无第三方动画库依赖。所有动画均尊重用户的 `.no-animations` 无障碍设置。

## 动画清单

### 1. 整合包卡片交错瀑布流入场
- **文件**: `sidebar-css.js` + `render.js`
- **效果**: 卡片从左侧依次弹入，带 overshoot 回弹
- **实现**: `@keyframes vcCardIn` + 每张卡递增 40ms `animation-delay`
- **曲线**: `cubic-bezier(.34, 1.56, .64, 1)` — 弹性回弹

### 2. 整合包卡片涟漪选中
- **文件**: `sidebar-css.js` + `events.js`
- **效果**: 点击时从鼠标位置扩散 radial-gradient 光晕
- **实现**: CSS 变量 `--ripple-x` / `--ripple-y` 定位，`::after` 伪元素 + `opacity` 过渡
- **持续**: 500ms 渐隐

### 3. 右键菜单弹性弹出 + 菜单项逐条滑入
- **文件**: `context-menu.js`
- **效果**: 菜单从 scale(.85) 弹性放大；每个菜单项从左侧滑入
- **实现**: `@keyframes menuPop` + 每项递增 25ms `animation-delay`

### 4. 模型树行入场动画
- **文件**: `app-tree-styles.js`
- **效果**: `.fl` / `.fh` 行从 translateY(-4px) 淡入
- **实现**: `@keyframes treeRowIn` 配合虚拟滚动重绘

### 5. 主题切换涟漪扩散
- **文件**: `theme.js`
- **效果**: 点击主题按钮时从点击位置 clip-path circle() 扩散覆盖全屏
- **实现**: `@keyframes themeRipple` + CSS 变量定位
- **持续**: 500ms

### 6. 赛博朋克网格背景
- **文件**: `layout.css`
- **效果**: 仅 theme-cyber 主题下显示半透明网格 + 20s 慢速滚动扫描线
- **实现**: `repeating-linear-gradient` + `@keyframes gridScroll`

### 7. 顶栏 Logo 呼吸光晕
- **文件**: `app-nav.js`
- **效果**: 💎 图标 text-shadow 3s 周期呼吸发光
- **实现**: `@keyframes logoBreathe` + `color-mix()` 控制透明度

### 8. Toast 弹性弹出
- **文件**: `app-toast.js`
- **效果**: 从 translateY(20px) scale(.95) 弹入，带 overshoot 回弹
- **实现**: `@keyframes toastIn` + `cubic-bezier(.34, 1.56, .64, 1)`

### 9. 诊断页日志行交错入场
- **文件**: `content-css.js` + `community-diagnostics.js`
- **效果**: 日志行从左侧依次滑入，每行递增 20ms delay
- **实现**: `@keyframes logRowIn` + JS 设置 `animation-delay`

### 10. 冲突扫描雷达动画
- **文件**: `content-css.js`
- **效果**: 扫描按钮旋转脉冲 + 扫描线动画
- **实现**: `@keyframes scanPulse` + `@keyframes scanLine`

### 11. 冲突行脉冲高亮
- **文件**: `content-css.js`
- **效果**: 冲突行从左侧滑入 + 偶数行带微弱脉冲背景
- **实现**: `@keyframes conflictRowIn` + `@keyframes conflictPulse`

## 无障碍支持

所有动画均受 `.no-animations` 类控制：
- 设置页 → UI 偏好 → 关闭动画 → `localStorage.setItem('ui-animations', 'off')`
- `app-modules.js` 中 `applyUIPrefs()` 读取设置并添加/移除 `.no-animations` 类

禁用时：
- 入口动画（cardIn, menuPop, logRowIn 等）→ `animation: none`
- 悬停过渡 → `transition-duration: 0s`
- 装饰性动画（呼吸光晕、网格滚动）→ `animation: none`
- 布局过渡（grid-template-columns）→ 保留

## 性能考量

| 动画类型 | GPU 加速 | 重绘区域 | 建议 |
|----------|----------|----------|------|
| transform/opacity | ✅ 合成层 | 无 | 推荐 |
| box-shadow | ⚠️ 触发重绘 | 元素区域 | 控制频率 |
| clip-path | ✅ 合成层 | 无 | 推荐 |
| grid-template-rows | ⚠️ 触发布局 | 容器 | 慎用 |
| text-shadow | ⚠️ 触发重绘 | 文字区域 | 控制频率 |

## 新增动画模板

```css
/* 1. 定义关键帧 */
@keyframes myAnimation {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 2. 应用动画 */
.my-element {
  animation: myAnimation .3s cubic-bezier(.34,1.56,.64,1) both;
}

/* 3. 无障碍支持 */
.no-animations .my-element {
  animation: none !important;
}
```

## 文件索引

| 文件 | 动画内容 |
|------|----------|
| `css/variables.css` | `.no-animations` 规则 |
| `css/layout.css` | 赛博网格背景 |
| `js/components/app-nav.js` | Logo 呼吸光晕 |
| `js/components/app-toast.js` | Toast 弹性弹出 |
| `js/components/context-menu.js` | 菜单弹性弹出 |
| `js/components/app-sidebar/sidebar-css.js` | 卡片入场 + 涟漪 |
| `js/components/app-sidebar/render.js` | 卡片 stagger delay |
| `js/components/app-sidebar/events.js` | 涟漪点击坐标 |
| `js/components/app-tree-styles.js` | 树行入场 |
| `js/core/theme.js` | 主题切换涟漪 |
| `js/components/app-content/content-css.js` | 诊断页动画 |
| `js/components/app-content/community-diagnostics.js` | 日志行 stagger |
