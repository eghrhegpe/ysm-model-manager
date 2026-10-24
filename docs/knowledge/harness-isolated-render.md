---
kind: harness-isolated-render
name: 组件隔离渲染 harness 视觉验证层
tier: leaf
category: ui
status: active
source_files:
  - frontend/harness/main.ts
  - frontend/harness/shot.mjs
  - frontend/harness/mock-install.ts
use_when:
  - 想看单个 UI 组件长什么样（秒级截图回看，不起全 app）
  - 改样式/布局后快速视觉回归
  - e2e 全量太重、只要一张组件截图取证
pitfalls:
  - 固定端口 + 复用旧 server = 对着旧代码假绿（现已 --port 0 从启动横幅解析真实 URL，读不到即抛错）
  - 就绪判据若只看「子元素非空」，只有一段 CSS 的空壳 / 空态 / 错误态全都能过（现改为每条目声明 probe）
  - 空态不是渲染成功：probe 必须命中「有数据的行」，命中空态容器不算（app-sidebar 曾查骨架屏按钮）
  - e2e 的 MOCK_DATA 故意把部分 binding 留 undefined 以覆盖降级路径，截图看正常路径须在条目内 mock 覆写，勿改 MOCK_DATA 迁就截图
  - 嵌套组件（app-content → app-tree）的正文在各自 shadowRoot，probe 不穿透 shadow 边界就永远查不到
quick_groups:
  - 测试与验证
quick_intents:
  - 单组件截图、隔离渲染、秒级视觉回看
quick_risk_lines:
  - 组件清单单源在 main.ts REGISTRY（shot.mjs 从页面读取并静态校验完整性），新增组件只登记 REGISTRY 一处
---

# 组件隔离渲染 harness 视觉验证层

## 概览

`frontend/harness/` 四件套：单 Web Component 隔离挂载 + mock 桥 + 秒级截图 + 画面内容闸门。零新增依赖；mock 数据单一来源 = `e2e/mock-data.ts` 的 MOCK_DATA，vite 配置复用 `vite.e2e.config.ts`。

## 四层视觉验证分工（勿混用）

| 层 | 入口 | 管什么 |
|----|------|--------|
| 纯逻辑探针 | `artifacts/*-probe` | 算法/像素生成器，零浏览器 |
| **harness（本卡）** | `cd frontend && npm run shot [组件名]` | 单组件隔离视觉，秒级，改样式即拍 |
| e2e（mock 桥） | playwright.config.ts | 全 app 行为回归 + 硬断言 |
| e2e-web（真 WebGL） | playwright.web.config.ts | 真 3D 会话像素取证 |

定位判据（2026-10 锐评确认不重叠）：e2e/menu-visual 是「全 app 启动 + 带断言结构巡检」，harness 是「单组件、零启动链、纯截图回看」——粒度与诉求不同。

## 对外 API / 入口

```bash
cd frontend && npm run shot            # 全量 REGISTRY
cd frontend && npm run shot app-tree   # 单组件（等价 node harness/shot.mjs app-tree）
```

- 页面：`/harness/index.html?c=<name>`
- 退出码 = 失败条目数（0 才算全绿）；成功行形如
  `SHOT <name> -> <path>  [hits=N text=N nodes=N cov=X% buckets=N]`

## 三道判据（2026-10-24 锐评后重写，勿回退）

### 1. 端口不复用（P0-1）

旧实现固定 `:5199 --strictPort`：端口被残留 server 占住时新 vite 秒退，而探测 fetch 照样成功 → 全程对着**旧代码**截图，只 `console.warn` 一句。不阻断的警告等于行为艺术。

现在：`--port 0` 由系统分配，真实 URL 只从 vite 自己的启动横幅 `Local: http://…` 解析（vite 8 走 **stdout** 不是 stderr）；30s 读不到、或进程先退出 → 抛错，不存在「猜一个端口试试看」。

### 2. 就绪看 probe 命中，不看子元素非空（P1-1）

旧判据 `root.childElementCount > 0 || shadowRoot.innerHTML.length > 0`——`<style>` 壳、空态占位、错误态骨架全都能满足。

现在每个 REGISTRY 条目必须声明 `probe: { selector, min }`，且是**有数据的行**而不是容器：

| 条目 | probe | 为什么是这个 |
|------|-------|--------------|
| app-tree | `[data-testid=tree-file], [data-testid=tree-dir]` | 只查 tree-root 空容器 = 扫描未回 |
| app-sync-manager | `.sm-item, .sm-dir` | `.sm-empty` 空态不算成功 |
| app-sidebar | `[data-testid=sidebar-check]` | toolbar 按钮在骨架屏阶段就有，查它 = 刚打开就判就绪 |
| app-content | `[data-testid=tree-file], [data-testid=tree-dir]` | 面板壳不够，要求仓库树真出数据 |
| app-preview | `#preview-content .md-row` | 占位/错误态也有 #preview-content，只有真卡片有 .md-row |
| context-menu | `[data-testid=ctx-item]` ×3 | 4 项菜单里 1 个是 divider，只有 3 个 ctx-item |

配套两条实现细节：
- **穿透 shadow 边界**：`countProbe` 逐层下潜 shadowRoot 累加命中（app-content 的树在 app-tree 自己的 shadow 里）。
- **文本长度不数 CSS**：`visibleTextLen` 自行走树跳过 `<style>/<script>`（不能 `cloneNode`——ShadowRoot 不可克隆）；且必须认 `DOCUMENT_NODE`，否则弹窗（挂在 document 下）文本恒为 0。

超时 8s 未命中 → `body[data-error]` 写明 `probe "<selector>" hits=X/Y textLen=Z`，shot.mjs 转成非零退出。

### 3. 画面不是纯色（内容闸门）

probe 保证「该出现的元素出现了」，`imageStats()` 再兜一次「整张图是不是一片背景」：用 `e2e-web/png-color-count.ts` 的零依赖 PNG 解码器按 RGB>>3 三通道分桶，主色占比 → coverage。阈值 `buckets ≥ 20` 且 `coverage ≥ 0.2%`——只拦纯色极端（正常组件 cov 1~14% / buckets 120~680，空壳曾 0.0%）。

### 不 sleep

动画由 main.ts 打在 `<html>` 的 `no-animations` 类冻结（`noAnimationsCSS` 挂 `:host-context(.no-animations)`）。旧实现固定 `waitForTimeout(400)` 既慢又是假绿来源。

## 清单完整性守卫

shot.mjs 起浏览器前先静态扫 `src/views/**/index.ts` 的 `customElements.define("tag")`，与 REGISTRY 比对；有定义却无截图条目 → 抛错并点名。锐评 P1-2 的教训是 `context-menu` 定义了却从没登记——这种漏登运行期完全无声。当前基线：8 个 custom element / 11 条截图条目（3 条为 imperative 弹窗）。

## 不变量

- mock 数据只从 `e2e/mock-data.ts` import，禁止在 harness 内另造数据源（双源漂移）。
- **截图看正常路径，e2e 看降级路径**：e2e 的 MOCK_DATA 故意把 `ExtractYsmSummary`/`ExtractYSMHeader`/`GetSyncScanDirs` 留 undefined 以覆盖错误态用例。harness 需要正常路径时，在 REGISTRY 条目的 `mock` 字段**就地覆写**（在 `entry.load()` 之前写入 `window.go.main.App`），不要反过来改 MOCK_DATA 让 e2e 失去错误态覆盖。
- 组件属性（`attrs`）必须在 `append` 前写好：`connectedCallback` 里读 `getAttribute` 决定初始化分支。
- 兄弟组件（`preload`）必须在建标签前 import 完成 define，否则拿到的是未升级的空标签。
- import 形态豁免登记：`mock-install.ts → ../e2e/mock-data.ts` 跨域相对路径是唯一通路（e2e 域不在 `@/` 别名内）；`main.ts → ../src/bus.ts` 同理。属 ADR-146 表述边界灰区，显式豁免于此。
- harness 的 .ts 受 `tsconfig.e2e.json` 管辖（typecheck 覆盖，防静默烂）；`_shots/` 被根 .gitignore `**/_shots/` 覆盖，截图不进版本库。

## 已知脆弱面

1. **启动链复刻**：main.ts 复刻 app-modules 的 `setLocaleHost → initI18n` 子集。启动链新增必经步骤时 harness 静默过期（症状=截图「看起来对但少了东西」）。改 app-modules 启动序列时须同步检查 harness/main.ts。
2. **i18n fail-open**：initI18n 内部 fetch 语言包失败只 console.warn 不抛错、无重渲染通道——组件已挂载则裸 key。harness 靠「先 init 后挂载」时序规避；若再见裸 key，先查 Network 里 locales fetch。
3. **Windows vite 树杀**：收尾用 `taskkill /PID <pid> /T /F`（spawnSync 等完再 exit，fire-and-forget 会被 process.exit 抢跑）；只 `proc.kill()` 会残留孙进程占端口。已不用 `shell:true`（顺带消掉 DEP0190），vite 入口走 `createRequire(...).resolve("vite/package.json")` + `bin/vite.js`（直接 resolve `vite/bin/vite.js` 报 ERR_PACKAGE_PATH_NOT_EXPORTED）。

## 场景注入现状

11 条条目（2026-10-24 扩容并全部转为「有数据」态）：

- **纯展示**：app-tree / app-nav / app-sidebar / app-content
- **事件驱动**（不派事件就是一个像素都不画）：app-toast（三条不同类型 toast）、app-preview（`model:select`）、context-menu（`menu:show` 四项菜单）
- **属性驱动**：app-sync-manager（`attrs: { instance: "1.20.1-Fabric", "default-type": "ysm" }`——生产里由 `init-pages.mountSyncManager` 在 `package:selected` 时写入，隔离渲染没有侧栏点击，不补属性组件就走 `_showNoInstance()` 的「未指定整合包」占位）
- **imperative 弹窗**：dialog-rename / dialog-tag-editor / dialog-adv-filter（直接调 `showXxxDialog`/`modalXxx`，模板经 views 侧 tpl 注入，不 await resolve——弹窗开着即可截图）

## 相关

- `docs/knowledge/e2e-visual-feedback.md` — 上层（全 app / 真 WebGL）方法论，本卡管单组件层
- `frontend/e2e/mock-data.ts` — mock 数据单一来源
- `frontend/e2e-web/png-color-count.ts` — 零依赖 PNG 解码器（内容闸门复用）
