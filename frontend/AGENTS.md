# 前端（frontend/）— AI 行为手册

> AI 处理 `frontend/` 代码时自动加载的前端专属约束。全项目规则见仓库根 `AGENTS.md`；3D 渲染标准见 `docs/architecture.md`；前端治理规则见 `docs/governance-rules.md`；组件 API 见 `docs/Design.md` §15。

## 构建 / 验证

```bash
npx vite build                    # 前端构建
npm run typecheck                 # tsc --noEmit（ADR-014 门槛）
cd .. && go build ./go/...        # 改 Go 后必跑（前端改动可跳过）
```

- 改前端代码 → **必须** `vite build` 通过 + `typecheck` 无错误
- 改完即提交（`git add frontend/`），别攒批

## 目录结构

```
frontend/src/
├── app-modules.ts         # 组件入口 + 主题/隐私模式启动链
├── backend/app.ts         # Wails 绑定桥（getApp() 唯一入口）
├── core/                  # 基础设施：bus / i18n / page-store / context-menus
├── features/              # 业务功能模块（import-queue / recycle-bin / community）
├── services/registry.ts   # 服务注册表（register / get）
├── test-utils/            # 测试工具（ADR-035）
├── utils/                 # 工具函数（dom / debug / format / icon / resource / 3d / animation）
├── views/app-xxx/         # Web Component 视图组件（按职责独立文件）
└── wasm/                  # YSMParser WASM 胶水层
```

- **新组件放 `views/app-xxx/`**，一个文件放一个可独立工作的功能，不按行数机械切割
- **新业务模块放 `features/`**；工具函数放 `utils/`
- 新服务先在 `app-modules.ts` 注册实例，再在 `services/registry.ts` 的 `ServiceName` 联合里登记名字；`registry` 只收"有替换价值"的依赖（数据加载 / 全局配置 / bus），渲染和纯函数直接 import

## Wails 桥接

- **唯一入口**：`import { getApp } from "../../backend/app.ts"` → `await getApp()` 返回类型化绑定
- **禁止**直接 `window.go.main.App.*`（治理红线）
- 改 Go 侧绑定签名 → 前端重新 `npm run generate:bindings`（必须带 `-ts`）
- 绑定函数名先 `grep` 在 `go/internal/app/` 确认，不要凭空写

## i18n（ADR-045）

- 翻译函数：`import { t } from "../../core/i18n/t.ts"` → `t("nav.repository", { n: 3 })`
- 语言包：`core/i18n/locales/{zh-CN,en,ja}.ts`，格式为 `{ key: "value", "nested.key": "value" }`
- 新增翻译 → **三个语言包同步补**，漏一个 `locales-consistency.test.ts` 会报
- 缺失 key 不会崩（返回 key 本身），但会 `console.warn`——发版前清理缺失 key
- 参数插值用 `{key}` 语法，值含 `$1` 等特殊字符走函数型替换（防正则注入）

## 存储与隐私模式（ADR-044）

- **永远用 `safeGet` / `safeSet` / `safeRemove`**（`utils/dom/storage.ts`），不要裸调 `localStorage`
- 隐私模式（`localStorage` 禁用）下裸调会抛错，`safe*` 静默降级
- `app-modules.ts` 顶层启动链依赖 `safeGet`——改存储逻辑前先 grep 消费者

## 调试

- **日志优先于猜测**：遇「逻辑对但没反应」，先加 `dbg()` 看实际值
- 调试函数：`import { dbg } from "../../utils/debug/debug.ts"` → `dbg("btn-click", { id, value })`
- 行为：默认 `console.log` + `[DBG:tag]` 前缀；`?nodebug=1` 关闭；`window._DBG_RING` 存最近 200 条
- **调试日志用完即删**（不留调试痕迹）
- 生产环境无控制台：`window.debugGetSpec(path)` 获取 Go 端 3D 骨骼数据

## Shadow DOM 特殊性

- `attachShadow({ mode: "open" })` 后，`adoptedStyleSheets` 中 `var()` **不继承**文档自定义属性（WebView2 实现）
- 跨 Shadow 边界传数据：组件间用 `bus.emit`（不靠 `window` 全局变量透传）
- Shadow 组件的 CSS 用 `:host` 选择器，跨组件主题切分用 `:host-context`
- 事件穿透不了 Shadow 边界——`dispatchEvent` 时设 `composed: true`

## WebView2 DnD 特殊性

- `dragover` 阶段无法读取文件名（`getAsFile()` 返回 null，`webkitGetAsEntry()` 返回 null），只能 `preventDefault()` + 显示遮罩
- `drop` 阶段优先用 `dataTransfer.items` + `webkitGetAsEntry()`，兜底用 `dataTransfer.files`
- `FileSystemEntry.file(callback)` 是回调，须 Promise 化：`entry.file(callback)` → `new Promise(resolve => entry.file(resolve))`，再用 `await`
- `DataTransferItem` 没有 `.name` 属性（`File` 才有）

## Web Component 生命周期

- 组件 `connectedCallback` / `disconnectedCallback` 必须成对出现
- 事件监听：`connectedCallback` 注册 → `disconnectedCallback` 移除，防泄漏
- 计时器（`setInterval` / `setTimeout`）：`disconnectedCallback` 必须 `clear`
- 并发防护：跨事件操作的入口加 `Promise.resolve().then()` 或 `queueMicrotask`

## 测试

- 测试钩子：UI 测试用 `data-testid` 定位（ADR-035），避免靠 CSS 选择器
- 测试工具：`test-utils/` 提供 `render` / `queryByTestId` / `waitFor`
- 测试文件与源文件同目录，`*.test.ts` 命名
- 测试跑：`npx vitest`（单文件用 `npx vitest --run <file>`）

## 路径别名与反桶契约（ADR-146）

- **目录级别名（已登记）**：新写跨目录 import 优先用 `@/<顶层目录>/...`（如 `@/utils/dom/...`、`@/core/bus/...`）；
  `#root/<file>` 仅用于读仓库根 JSON（过渡措施，只减不增）。catch-all `@/*` **永久禁止**。
- **闸控**：当前为闸一（配置闸），`check-path-hygiene.ts` 的 R0 规则**禁止任何含别名的 import**——
  在 `check-layering`/`check-circular`/`check-tpl-refs`/`auto-import*` 改造为别名感知解析（闸二）前，写别名会门禁 FAIL。
- **反桶契约（禁聚合桶）**：
  1. 不新增以 re-export 为主体的聚合文件（不限于 `index.ts`，含 `*-re-export.ts` 这类命名）；
     现有 9 个入口 `index.ts` 保持真模块身份。
  2. 零依赖 / 纯模块禁止从聚合模块导入，必须引具体叶（单文件 re-export 来源模块数 ≥ 3 即 R1 嫌疑）。
  3. 不为省一行 import 建「公共出口」聚合文件；需多符号时逐个 import 具体模块。
  4. `src/utils/types-re-export.ts` 是 bindings 转发垫层（来源数=1），白名单存量保留，与别名互补。
- **迁移策略**：新文件自闸二起用别名；存量文件保持相对路径，仅当该文件因他故被改时顺手切别名，**禁止一次性 codemod 全量重写**。