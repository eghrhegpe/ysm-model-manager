# 事故复盘报告：前端架构统一（ESM 化）  

**日期**：2025-06-04  
**时长**：约 3 小时  
**涉及文件**：~20 个 JS 文件 + index.html  
**事故等级**：中等（开发体验阻塞，约 5 次构建失败）

---

## 1. 问题回顾

### 1.1 现象

| 问题 | 表现 |
|------|------|
| 🏠 仪表盘页面删不掉 | 导航栏始终显示"仪表盘"，即使代码中已移除 |
| 热更新不工作 | 改 `app-nav.js` 后需手动复制到 `dist/` |
| `bus is not defined` | 组件通过 ESM import bus.js 报错，找不到 export |
| `public/` 目录干扰 | Vite 返回旧文件而非源文件 |

### 1.2 根因

| 根因 | 详情 |
|------|------|
| **架构分裂** | 新版组件用 ESM（Vite 构建），旧版组件用全局 `<script>`（直拷） |
| **Wails dev 机制误解** | `wails dev` 启动 Vite dev server 后，非 module 的 `<script>` 文件不经过 Vite 处理，热更新不生效 |
| **Vite 的 `public/` 优先级** | `frontend/public/js/` 下的同名文件优先级高于 `frontend/js/`，导致 Vite 返回旧版无 export 的 bus.js |
| **内联 `<script>` 仍用全局 `bus`** | `index.html` 中内联脚本通过 `window.bus` 访问，但 componente 已改为 `import { bus }` |

---

## 2. 处理过程

```
发现仪表盘删不掉
  → 检查 app-nav.js → 代码已移除但 dist/ 缓存了旧文件
  → 手动复制到 dist/ → 重启后依然存在
  → 才发现是 <script> 加载的非 ESM 文件不被 Vite 管理
  
决定全部统一为 ESM
  → bus.js 加 export
  → 所有组件加 import { bus }
  → index.html 移除多余 <script>，只剩 app-modules.js
  → 构建报错：bus.js 没有 export
  → 排查发现 Vite 路由到了 public/js/bus.js（旧版无 export）
  → 删除 public/js/ 旧文件
  → 构建通过 ✅
```

### 耗时分布

| 步骤 | 耗时 | 说明 |
|------|------|------|
| 定位仪表盘问题 | 45min | 排查了 app-nav.js, dist/ 缓存, Wails dev 机制 |
| 决定 ESM 统一 | 10min | 方案对比 |
| 修改代码 | 30min | 加 import/export |
| 排查 bus.js 错误 | 60min | `public/` 优先级是主要坑点 |
| 最终构建通过 | 5min | 删 public/ 后立即生效 |

---

## 3. 经验教训

### 3.1 Wails dev 的工作原理

```
wails dev
├── 启动 frontend:dev:watcher → npm run dev → Vite dev server (port 5173)
├── 启动 Go 后端 (port 34115)
└── 浏览器从 localhost:5173 加载页面
    ├── <script type="module" src="..."> → Vite 处理 → 热更新 ✅
    ├── <script src="..."> → Vite 不处理 → 不热更新 ❌
    └── public/ 目录 → Vite 直接返回 → 不经过模块转换 ❌
```

**关键规则**：
- **只有 `type="module"` 的 `<script>`** 才会被 Vite 热更新
- **`public/` 目录中的文件** Vite 会直接返回，优先级高于同路径源文件
- **`dist/`** 是 `vite build` 的输出，Wails dev **不使用 `dist/`**

### 3.2 `public/` 目录陷阱

Vite 的 `public/` 目录设计用于静态资源（图片、字体等），但 JS 文件不应该放进去。  
**`public/js/bus.js` 会导致 Vite 忽略 `js/bus.js` 的 ESM 版本**，返回无 export 的旧文件。

### 3.3 架构统一原则

| 方案 | 结论 |
|------|------|
| 全部 ESM + Vite | ✅ **推荐** — 热更新、树摇、TypeScript 支持 |
| 全部 `<script>` 全局 | ❌ 不可行 — 无模块拆分，大型项目代码混乱 |
| 混合（当前架构） | ❌ 问题根源 — 新旧代码互相干扰，构建流程不清晰 |

### 3.4 预防措施清单

#### 修改文件前必须确认
- [ ] 文件是 ESM 还是 `<script>` 加载？
- [ ] 是否有 `public/` 下的同名文件？
- [ ] 是否需要清除 Vite 缓存（`node_modules/.vite/`）？

#### 新文件创建规则
- [ ] 所有新组件必须为 ESM（`export`/`import`）
- [ ] 所有新组件在 `app-modules.js` 中通过 `import` 引入
- [ ] 禁止在 `public/` 目录放 JS 文件
- [ ] 禁止在 `index.html` 中添加新的 `<script>` 标签

#### 构建失败排查顺序
1. `curl http://localhost:5173/xxx.js` 看 Vite 返回了什么
2. 检查 `public/` 下是否有同名旧文件
3. 检查 `vite.config.js` 的 root 配置
4. 重启 `wails dev`（清除缓存）

---

## 4. 后续行动

| 事项 | 状态 |
|------|------|
| 删除 `public/js/` 下所有 JS 文件 | ✅ 已完成 |
| `index.html` 只保留一个 `<script type="module">` | ✅ 已完成 |
| 所有组件通过 `import { bus }` 导入 | ✅ 已完成 |
| `bus.js` 同时 `export` + `window.bus` 兼容 | ✅ 已完成 |
| 旧版 `legacy/` 目录清理 | ⏳ 后续 |
| 移除 `app-legacy-bundle.js` | ⏳ 后续 |

---

## 5. 附录：确认命令

```powershell
# 确认 Vite 返回的文件内容
curl -s http://localhost:5173/js/bus.js

# 确认 public/ 下无 JS 文件
dir frontend/public/js/

# 清除 Vite 缓存
Remove-Item -Recurse -Force frontend/node_modules/.vite

# 重启 Wails dev
wails dev
```
