# ADR-045：前端 i18n 轻量框架

- **状态**：✅ 已采纳
- **日期**：2026-08-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：MikuMikuAR ADR-059

---

## 1. 背景（Context）

前端 UI 文案全部硬编码为中文，分布在 100+ 文件中。项目用户群以中文为主，暂无迫切多语言需求，但「可以没有，不能不用」——为未来拓展预留 i18n 能力。

技术约束：
- Wails v3 桌面应用，不能用 Web 的 `fetch` 加载 JSON（WebView 场景下 fetch 可用但需考虑离线）
- 原生 TS + Shadow DOM 组件，无虚拟 DOM，语言切换需全量重渲染
- 已有事件总线 `bus.ts` 和 `safeGet/safeSet` 存储工具

参考项目 MikuMikuAR（同技术栈）已验证自研轻量方案可行（ADR-059），1868 key、5 语言对齐。

## 2. 决策（Decision）

采用**自研轻量 i18n 方案**，不引入第三方库（i18next 等与命令式 DOM 重渲染模型冲突）。

### 2.1 架构

```
frontend/src/core/i18n/
  locale.ts        # 语言状态管理（signal + localStorage 持久化）
  t.ts             # 翻译函数 t(key, params?) + 运行时加载
  locales/
    zh-CN.ts       # 基准语言包（TS 导出对象，唯一编辑入口）

frontend/public/locales/
  zh-CN.json       # 运行时 JSON（构建产物，由脚本生成）
```

### 2.2 核心 API

```ts
// locale.ts
export function getLang(): string;           // 当前语言代码
export function setLang(code: string): void;  // 切换语言（触发 lang:changed 事件）
export async function initI18n(): Promise<void>; // 启动时调用

// t.ts
export function t(key: string, params?: Record<string, string | number>): string;
export async function loadLocale(lang: string): Promise<void>;
```

### 2.3 翻译 key 格式

扁平化命名空间，`.` 分隔，无嵌套对象：

```ts
export const zhCN: Record<string, string> = {
  'nav.repository': '模型仓库',
  'settings.title': '设置',
  'menu.rename': '重命名…',
};
```

### 2.4 语言决策优先级

```
用户手选（localStorage 'uiLang'）> 系统语言（navigator.languages）> 基准 zh-CN
```

### 2.5 语言切换机制

切换语言时：
1. `setLang()` 更新 reactive state + localStorage
2. 触发 `bus.emit("lang:changed")` 事件
3. 各组件在 `updateControls()` / 渲染时调用 `t()` 获取当前语言文案
4. 需要即时刷新的页面由 `lang:changed` listener 触发重渲染

### 2.6 构建管线

`scripts/generate-locale-json.mjs`：用 esbuild 编译 `locales/*.ts` → CJS → 提取导出对象 → 写入 `public/locales/*.json`。在 `vite build` 和 `vite dev` 启动前自动调用。

## 3. 后果（Consequences）

**正面**：
- 零第三方依赖，与现有命令式 DOM 架构零摩擦
- TS 源文件编辑，编译期类型检查 key 合法性
- 运行时 fetch JSON，不全部打包进主 bundle
- 与 MikuMikuAR 方案一致，可复用经验

**负面**：
- 需自建翻译对齐检查脚本（`i18n-check.mjs`）
- 100+ 文件的文案提取是渐进式工作

**已知遗留**：
- Go 端错误 i18n 信封模式（ADR-051 模式）待后续评估
- 首批仅覆盖 P0 模块（导航、模板、菜单），其余渐进替换

## 4. 数据溯源

- MikuMikuAR ADR-059：自研 i18n 方案验证
- 本项目 `docs/archive/design/YSM-UI-Translation-Plan.md`：历史草案（已废弃）
- 2026-08-09 命名一致性审计：P1/P2 问题已修复，为 i18n 铺路
