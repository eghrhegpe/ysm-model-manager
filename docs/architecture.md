# YSM 模型管理器 — 前端架构（新架构）

## 核心原则

**每个组件目录 = 1 个标签 + 1 个目录 + 若干文件，每文件 ≤ 80 行。**

```
app-tree/
├── index.js       # 生命周期编排（constructor → shadow → connected→disconnected）
├── tpl.js         # 布局级 HTML 模板（纯字符串，不做事件绑定）
├── row-tpl.js     # 节点级 HTML 模板（文件行/文件夹行等）
├── data.js        # 数据逻辑（纯函数，不碰 DOM，不写 this.shadowRoot）
├── render.js      # 渲染逻辑（输入数据 → 输出 HTML 字符串）
├── events.js      # 事件绑定（onclick / oninput / oncontextmenu）
└── utils.js       # 该组件特有的工具函数
```

## 三层解耦

```
index.js（编排）
  ├── data.js（纯数据，无 DOM）
  ├── render.js（HTML 生成，无事件）
  └── events.js（事件绑定，无模板）
       ↑ 引用
  tpl.js / row-tpl.js（纯 HTML 模板）
```

### 层间契约

| 文件        | 可以做的                    | 不可以做的            |
| ----------- | --------------------------- | --------------------- |
| `index.js`  | 调 render / bindEvents      | 不写业务逻辑          |
| `data.js`   | 数组操作、判断              | 不碰 DOM              |
| `render.js` | innerHTML / textContent     | 不写 addEventListener |
| `events.js` | addEventListener / bus.emit | 不拼 HTML             |
| `tpl.js`    | HTML 模板字符串             | 不做事件绑定          |

## 共享工具

```
js/utils/
├── fmt.js     # 文件大小/日期格式化
├── dom.js     # HTML 转义/搜索高亮
└── icon.js    # 文件图标映射
```

## 当前组件状态

| 组件             | 位置              | 状态      | 文件数 | 总行数 |
| ---------------- | ----------------- | --------- | ------ | ------ |
| `<app-tree>`     | `app-tree/`       | ✅ 已拆   | 7 文件 | 321    |
| `<app-sidebar>`  | `app-sidebar/`    | ✅ 已拆   | 6 文件 | 227    |
| `<app-preview>`  | `app-preview/`    | ✅ 已拆   | 6 文件 | 107    |
| `<app-content>`  | `app-content/`    | ✅ 已拆   | 3 文件 | 96     |
| `<app-toast>`    | `app-toast.js`    | ✅ 已精简 | 1 文件 | 75     |
| `<app-nav>`      | `app-nav.js`      | 🔄 待评估 | 1 文件 | 115    |
| `<context-menu>` | `context-menu.js` | 🔄 待评估 | 1 文件 | 98     |
| `<app-header>`   | `app-header.js`   | ⏸️ 未引用 | 1 文件 | 95     |

## 新增组件检查清单

- [ ] 目录名与标签一致：`app-xxx/`
- [ ] 有 `index.js`（生命周期编排）
- [ ] 模板与数据分离（`data.js` 不碰 DOM）
- [ ] 每文件 ≤ 80 行
- [ ] 通用工具引用 `js/utils/` 而非重写
- [ ] `index.html` 中非 module 组件用 `<script src="...">`，module 组件用 `<script type="module" src="...">`

## 参考

- 旧版代码：`frontend/js/legacy/`（26 个 JS 文件，全局变量 + DOM 直操）
- 事件总线：`frontend/js/bus.js`
- Vite 构建：`frontend/vite.config.js`
