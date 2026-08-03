# ADR-014：前端 TypeScript 渐进迁移

- **状态**：✅ 已采纳
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/`（120 个业务 JS）/ `frontend/vite.config.js` / `frontend/wailsjs/go/main/App.d.ts` / `AGENTS.md` §审核体系（B1 盲区 #1）

---

## 1. 背景（Context）

前端为原生 JavaScript（Web Components + Shadow DOM），120 个业务文件。B 类审查盲区清单中 **#1「原生 JS 无类型系统」** 是自动化无能为力的最大缺口：

- 类型安全只能靠 review 人工盘问，`data.js` 传错参数、`bus.emit` 事件名拼错**编译期不可见**；
- 联邦（MikuMikuAR）为 TypeScript 项目（365 个 .ts + Vitest 4328 测试），已实证类型系统的收益；
- 联邦的 `check-consumers` / `check-circular` / `codemod` 等工具**依赖 TS AST**，不迁则无法搬运。

### 1.1 有利信号（降低迁移成本）

| 信号 | 证据 |
|------|------|
| 规模可控 | 120 个业务 JS（联邦 365 个 .ts 的 1/3） |
| Wails 类型已生成 | `frontend/wailsjs/go/main/App.d.ts` 存在，前端 JS 却未消费 |
| Vite 已半铺路 | `vite.config.js` 已有 `wails-bindings-resolve` 插件（.js import 解析到 .ts） |
| Vite 原生转译 | esbuild 转 TS 零配置，`.js` / `.ts` 可混编共存 |

### 1.2 反对方案

- **全量重写**（120 文件一次性 .js→.ts）：高风险、破坏存量稳定性，违背「复用已有函数、引导长治久安」的原则；
- **保持 JS 不动**：B1 盲区 #1 永久存在，联邦工具链无法搬运。

---

## 2. 决策（Decision）

**决策**：采用**渐进迁移**——`.js` / `.ts` 混编共存，新代码一律 `.ts`，存量 `.js` 随改随迁，不一次性重写。

### 2.1 阶段划分

| 阶段 | 内容 | 验收 |
|------|------|------|
| P0 地基 | `tsconfig.json`（`strict: true` + `allowJs: true`）+ Vite 确认 TS 转译 | 新旧混编可构建 |
| P1 基础设施 | `bus.ts`（类型化 emit/on）→ `wails/app.ts`（类型化 getApp）→ `registry.ts` | 全项目类型红利，风险最低 |
| P2 纯函数层 | `utils/`（display/fmt/dom/icon/summarize）全迁 | 零 DOM 依赖，最好迁 |
| P3 核心组件 | `download-queue` / `app-content/index` 等复杂逻辑 | 高价值模块类型化 |
| P4 收口 | `tsc --noEmit` 进 CI；`allowJs` 随覆盖率收紧 | 类型检查成为门禁 |
| P5 红利 | 搬联邦 `check-consumers` / `codemod`；评估 Vitest | 工具链质变（独立 ADR） |

### 2.2 约束

- **三层解耦架构不变**：`index/data/render/events/tpl` 拆分规范保留，迁移只加类型不改职责；
- **Wails 绑定**：消费 `App.d.ts` 类型，`getApp()` 返回类型化 App；
- **不引入重型框架**：保持 Web Components + Shadow DOM，TS 只做类型层；
- **构建产物**：`.ts` 经 esbuild 转译，`vite build` 输出不变。

---

## 3. 后果（Consequences）

### 正面
- B1 盲区 #1（类型安全）从「人工盘问」升级为「编译期门禁」；
- `bus.emit` / `getApp()` 调用获得类型提示，事件名/绑定函数名拼错即时暴露；
- 重构安全：改签名全项目标红；
- 解锁联邦工具链（check-consumers / check-circular / codemod）；
- 渐进迁移不破坏存量，风险持续可控。

### 负面
- P0-P2 需要 tsconfig 严格度磨合（存量 JS 的类型错误逐批修复）；
- 迁移周期长（数周量级零散工作量，非大块投入）；
- 前端无单测框架（Vitest）暂不引入，测试覆盖维度仍靠 review（P5 另行决策）。

### 已知遗留
- `wailsjs/go/main/App.js` 为生成产物，不迁移；以 `App.d.ts` 为类型源；
- `frontend/dist/` 构建产物不受影响。

---

## 4. 与 AGENTS.md 的关系

| AGENTS.md 条款 | 本 ADR 覆盖 |
|----------------|-------------|
| §审核代码可用性「类型安全（JS 版）」 | 迁移完成后升级为「TS 版」，undefined 守卫由编译器兜底 |
| §硬约束「改完即验」 | P4 起补 `tsc --noEmit` |
| B 类盲区 #1 | 本 ADR 的直接解药 |

---

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| `find frontend/js -name "*.js"` | 120 个业务文件（排除 node_modules/dist） |
| `frontend/wailsjs/go/main/App.d.ts` | Wails v3 已生成绑定类型声明 |
| `frontend/vite.config.js` | 已有 wails-bindings-resolve 插件（.js→.ts） |
| 联邦（MikuMikuAR） | 365 个 .ts + Vitest 4328 测试，TS 收益实证 |
| `AGENTS.md` §审核体系 | B1 盲区 #1：原生 JS 无类型系统 |
