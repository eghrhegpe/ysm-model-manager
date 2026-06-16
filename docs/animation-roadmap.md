# 动画路线图 — 全部完成

**创建日期：** 2026-06-16
**最后更新：** 2026-06-16
**关联文档：** `docs/animations.md` · `docs/release-notes/v1.7.6.md` · `docs/Design.md`

---

## 统一动画系统

### Keyframe（3 个）

| keyframe | 方向 | 用途 |
|----------|------|------|
| `fadeSlideUp` | 向上 6px | 卡片、列表项、行、面板 |
| `fadeSlideLeft` | 向左 8px | 侧栏、嵌套菜单、日志行 |
| `fadeSlideDown` | 向下 4px | 顶栏 Tab |

### 通用 Stagger

```css
/* 父容器加 class="stagger-in"，子元素自动 stagger */
.stagger-in > *:nth-child(1)  { animation-delay: 0ms }
.stagger-in > *:nth-child(2)  { animation-delay: 30ms }
/* ...最多 11 级 */
```

```js
// JS 工具函数
import { stagger } from './utils/stagger.js';
style="animation-delay:${stagger(i)}ms"
```

### 设计令牌

| 类别 | 变量 |
|------|------|
| 圆角 | `--radius-xs/sm/md/lg/xl/pill` |
| 过渡 | `--tr-fast/normal/slow/enter` |
| 阴影 | `--shadow-sm/md/lg/xl` |
| 按钮 | `--accent-btn-bg/color/border` |

---

## 已完成（v1.7.6）

### P0 — 高优先级
- ✅ 对话框入场/退场动画
- ✅ 按钮 :active scale 反馈

### P1 — 中高优先级
- ✅ 页面切换淡入
- ✅ 模型树文件夹展开子行淡入
- ✅ 预览面板内容过渡

### P2 — 中优先级
- ✅ 创作者频道卡片筛选淡出
- ✅ 导入队列项目滑入
- ✅ 设置页高级面板展开/折叠
- ✅ 同步管理器标签切换过渡

### P3 — 低优先级
- ✅ 回收站项目动画
- ✅ 资源管理器详情过渡
- ✅ GitHub 仓库卡片交错入场
- ✅ 诊断页面板切换交叉淡入
- ✅ 批量重命名预览列表脉冲
- ✅ 导航侧栏激活指示器滑动

### 新增
- ✅ 一级 Tab 淡入+微下移（`fadeSlideDown`）
- ✅ 二级菜单 淡入+微右移（`fadeSlideLeft`）
- ✅ GitHub 仓库卡片 stagger + hover 上浮 + 图标旋转
- ✅ 预设搜索词 / 筛选标签 stagger 入场
- ✅ 设置页卡片 stagger 入场
- ✅ 关于页区块 stagger 入场

---

## 技术约束

- 所有动画必须遵守 `.no-animations` 无障碍开关
- 优先使用 `transform` / `opacity`（GPU 合成层，不触发重排）
- 避免在虚拟滚动组件上使用 `height` / `max-height` 过渡
- Shadow DOM 组件的动画需在各自的 `<style>` 中定义
- 新增动画统一使用 3 个 keyframe 之一
- Stagger 延迟统一使用 `stagger()` 工具函数或 `.stagger-in` CSS 类
