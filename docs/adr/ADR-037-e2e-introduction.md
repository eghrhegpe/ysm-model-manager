# ADR-037：E2E 测试引入（Playwright + vite dev 纯前端模式）

- **状态**：✅ 已采纳（推翻了 ADR-021「C 层 E2E 不引入」决策）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/adr/ADR-021-declarative-menu-testing.md`（被推翻条款 C 层） / `frontend/package.json`（Playwright devDependency） / `frontend/vite.config.js` / `frontend/e2e/` / `frontend/js/test-utils/`（G-1 基础设施） / `docs/Design.md` §19.1（testid 规范） / `tests/test_testid_contract.mjs`（testid 契约守护）

---

## 1. 背景（Context）

### 1.1 ADR-021 的原始决策

ADR-021（2026-08-03）将前端测试分为三层：

| 层 | 范围 | 技术 | ADR-021 状态 |
|----|------|------|-------------|
| A 层 | 映射 + 组件单测 | vitest + jsdom | ✅ 已实施 |
| B 层 | 声明式规格测试 | vitest + jsdom | ✅ 已实施 |
| **C 层** | **E2E / UI 自动化** | **Playwright 等** | **❌ 不引入，列为远期** |

原始顾虑：Wails 桌面应用跑在 WebView2，Playwright 直测桌面成本高；`vite dev` 纯前端模式 + mock Wails bridge 的方案收益与成本权衡后暂不引入。

### 1.2 现状变化（推翻决策的理由）

自 ADR-021 以来，以下条件已成熟：

1. **G-1 抗脆弱测试基础设施已落地**（ADR-035 / Design.md §19.1）：
   - `data-testid` 稳定钩子已覆盖全部关键交互元素（16+ 个 testid）
   - `test-utils/index.ts` helper 已就位（`getByTestId` / `waitFor`）
   - `tests/test_testid_contract.mjs` 契约守护已运行
   - 组件级测试已覆盖 4 个主要组件（app-toast / app-nav / app-sync-manager / app-resource-manager）

2. **vitest 组件测试的局限性已暴露**：
   - jsdom 不支持 Shadow DOM 完整生命周期（`adoptedCallback` / `slotchange` 等）
   - jsdom 不支持真实布局（`getBoundingClientRect` 返回 0）
   - jsdom 不支持 `DragEvent` `dataTransfer`（需 polyfill）
   - 右键菜单（`context-menu`）无法在 jsdom 中模拟真实右键
   - 文件拖拽导入无法在 jsdom 中模拟

3. **Playwright 的可行性路径已验证**（隔壁 MikuMikuAR 实证）：
   - `vite dev` 纯前端模式启动快（<2s）
   - mock Wails bridge 通过 `window.go` 替换或 `vi.mock` 模式已在 vitest 中验证
   - 关键 testid 为 Playwright 选择器提供了稳定锚点

### 1.3 收益与成本重估

| 维度 | ADR-021 时 | 现在 |
|------|-----------|------|
| testid 基础设施 | 无 | 16+ 个稳定钩子 + 契约守护 |
| mock 模式 | 未验证 | 44 个 vitest 测试已验证 |
| WebView2 直测 | 唯一路径 | `vite dev` 纯前端模式已可测 |
| 右键/拖拽覆盖 | 0 | 手动测试 |
| 维护成本 | 高（零基础） | 低（基础设施已就位） |

---

## 2. 决策（Decision）

**决策**：引入 Playwright，在 `vite dev` 纯前端模式下运行 E2E 测试，mock Wails bridge 阻断后端依赖。保留 vitest 单测层，E2E 专注「用户操作路径」验证。

### 2.1 架构

```
vite dev（纯前端，无 Wails 后端）
  │
  ├─ Playwright 启动浏览器
  │   ├─ 加载 http://localhost:5173（vite 开发服务器）
  │   ├─ 注入 mock Wails bridge（window.go 替换）
  │   └─ 按 data-testid 定位元素执行交互
  │
  └─ 测试断言
      ├─ 状态：DOM 结构 / 事件总线 / 组件状态
      └─ 视觉：截图对比（可选，按需引入）
```

### 2.2 分层

| 层 | 技术 | 覆盖 | 负责人 |
|----|------|------|--------|
| E2E 冒烟 | Playwright | 核心用户路径：导航切换 / 文件树浏览 / 菜单交互 / 拖拽导入 | 本 ADR |
| vitest 组件 | vitest + jsdom | 纯函数 / 组件逻辑 / 事件总线 / 生命周期 | 既有（44 文件） |
| 契约测试 | Node `.mjs` | 配置 / 数据 / 引用完整性 / testid 存在性 | 既有（10 文件） |

### 2.3 技术选型

- **Playwright**（非 Cypress）：与联邦 MikuMikuAR 对齐，TypeScript 原生支持，`locator` API 与 testid 天然契合
- **`vite dev` 模式**（非 `vite preview`）：热更新快，mock 注入方便
- **mock Wails bridge**：启动时替换 `window.go.main.App` 为 vi.fn() 桩，与 vitest 共用 mock 数据
- **`data-testid` 选择器**：统一使用 Design.md §19.1 规范，与 G-1 基础设施一致

### 2.4 首批测试范围

| 路径 | 操作 | 断言 |
|------|------|------|
| 导航切换 | 点击 `nav-item` → 页面切换 | 对应页面内容可见 |
| 文件树浏览 | 展开 `tree-dir` → 文件列表 | `tree-file` 数量 > 0 |
| 右键菜单 | 右键 `tree-file` → 菜单出现 | `ctx-item` 可见 |
| Toast 通知 | 触发 `toast:show` → toast 出现 | `toast` 可见 |
| 同步管理器 | 查看同步状态 | `sm-push` / `sm-pull` 按钮存在 |

### 2.5 排除范围（不做的）

- **不替代 vitest 单测**：E2E 只测用户操作路径，不测纯函数/组件逻辑
- **不测 Wails 后端**：后端逻辑通过 Go 单测覆盖
- **不引入截图对比**：视觉回归测试暂不纳入，留待未来评估
- **不接入 CI**：首批手动运行，稳定后接入 `release.yml`（CI 可行性已论证但暂不绑定）

---

## 3. 后果（Consequences）

### 正面

- 补齐测试金字塔最上层：vitest（组件逻辑）→ Playwright（用户路径）→ 人工（视觉/体验）
- 右键菜单、拖拽导入等 jsdom 无法覆盖的交互获得自动化防线
- Playwright 的 `locator.waitFor` 天然防竞态，比 `waitFor` + `sleep` 更可靠
- 与联邦 MikuMikuAR 工具链对齐（Playwright + testid 模式可搬运）

### 负面 / 成本

- 新增 devDependency `@playwright/test`（~30MB）
- 需维护 mock Wails bridge 的同步（与 vitest mock 双源）
- `vite dev` 模式需额外启动一个开发服务器（测试前启动）
- Playwright 浏览器实例下载（首次 `npx playwright install chromium`）

### 已知限制（不修复）

- **不测 Wails 原生能力**：文件对话框、系统通知、WebView2 特定行为
- **不测真实网络**：下载/上传等网络操作仍由 vitest mock 覆盖
- **不测 3D 渲染**：Three.js WebGL 渲染在无头浏览器中受限

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/adr/ADR-021-declarative-menu-testing.md` §2.3 | 推翻 C 层「不引入，列为远期」决策 |
| `docs/adr/ADR-035-forward-governance-initiatives.md` G-1 | 抗脆弱测试基础设施（testid + helper + 契约）已落地 |
| `docs/Design.md` §19.1 | testid 命名规范已定稿 |
| `frontend/js/test-utils/index.ts` | `getByTestId` / `getAllByTestId` / `waitFor` helper 已投产 |
| `tests/test_testid_contract.mjs` | 16 个关键 testid 契约守护已运行 |
| `frontend/package.json` | vitest ^0.34.6 + jsdom ^29 已安装（Playwright 为新加） |
| 联邦 MikuMikuAR ADR-060 | Playwright + testid 模式实证可用 |
| 项目 vitest 测试（44 文件 / 401 用例） | mock Wails bridge 模式已验证可行 |

<!-- 文件名: e2e-introduction.md → 实际文件 ADR-037-e2e-introduction.md -->