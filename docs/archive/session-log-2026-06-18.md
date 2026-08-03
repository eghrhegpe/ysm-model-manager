# 会话记录：2026-06-18 — 体系重构日

> 文档宪法 + 逻辑下沉 + Skill Python 化 + 子代理体系 + 契约测试 + 竞态修复

## 会话统计

| 指标 | 值 |
|------|-----|
| 耗时 | 94 分 44 秒 |
| 请求数 | 944 |
| 总 tokens | 274M |
| 缓存命中 | 99.98% |
| 费用 | ¥10.00 |

---

## Skill 体系重构

### Python 化（4 个）

| Skill | 改前 | 改后 | 脚本 |
|-------|------|------|------|
| `line-counter` | 7 段 bash find/wc | `python3 scripts/line-counter.py` | 92 行 |
| `doctor` | 6 段 bash grep | `python3 scripts/doctor.py` | 116 行 |
| `review` | 9 条 rg 命令 | `python3 scripts/review.py` | 145 行 |
| `ultrawork` | 5 段 bash 内联 | `python3 scripts/ultrawork.py` | 50 行 |

### 子代理 skill（10 个）

| Skill | 模式 | 说明 |
|-------|------|------|
| `release-notes-gen` | 🧠 subagent | git 差异分析 → 自动写发版说明 |
| `review` | 🧠 subagent | 14 项治理检查 → 推理修复方案 |
| `comment-checker` | 🧠 subagent | 废话注释/空 JSDoc/TODO 无编号 → 判断真伪 |
| `link-checker` | 🧠 subagent | Markdown 断链扫描 → 修复替换表 |
| `type-consistency` | 🧠 subagent | resource_types.json ↔ Go ↔ JS 三方比对 |
| `event-audit` | 🧠 subagent | EventsOn/bus.on 注册位置审计 |
| `bug-search` | 🧠 subagent | 按关键词查 bug-chronicle 并摘要 |
| `binding-check` | 🧠 subagent | Go 导出函数 vs wailsjs 绑定一致性 |
| `doctor` | 🧠 subagent | 编译+红线+Git 五合一诊断 |
| `ultrawork` | 🧠 subagent | 一键三连编排 |

### SKILL.md 设计规范

```
SKILL.md 只写：
  1. 什么时候用（场景）
  2. 怎么调（python3 scripts/xxx.py）
  3. 子代理要做什么（工作流程 + 输出格式）

复杂逻辑放 scripts/*.py，不要放 SKILL.md 里。
```

---

## 逻辑下沉（Logic Sinking）

### 已完成

| 模块 | 原文件 | 抽出到 | 测试数 |
|------|--------|--------|--------|
| 下载器 | app_download.go(318 行→待瘦身) | go/download/downloader.go | 6 |
| 头像提取 | app_avatar.go(488 行→88 行) | go/avatar/avatar.go | 8 |
| 哈希对比 | GetResourceInstanceStatus(96 行→3 行) | go/sync/CompareGlobalInstanceHashes | 2 |

### 提取条件

一个函数能从 `app_*.go` 抽到 `go/` 包的条件：

1. **不 import** `github.com/wailsapp/wails/v2/pkg/runtime`
2. **不引用** `package main` 的类型（如 `App` struct）
3. **不依赖** 前端事件命名约定（如 `"download:progress"`）

### 待提取（低优先级）

- `app_install.go` 中的 `GetInstanceSyncStatus`（198 行）→ 可抽到 `go/sync/`
- `app_scan.go` / `app_files.go` 中的厚函数（已大量引用 `go/` 包，胶水为主）

---

## 契约测试体系

`tests/python/` 目录的 6 个测试：

| 测试 | 校验对象 | 行数 |
|------|---------|------|
| test_resource_schema.py | resource_types.json 7 类型必填字段 | 130 |
| test_workshop_schema.py | workshop_sites.json 10 站点字段 | 90 |
| test_creators_schema.py | creators.json 232 创作者 name 必填 | 55 |
| test_config_defaults.py | ysm_config.json AppConfig 19 字段类型 | 95 |
| test_config_syntax.py | wails.json + go.mod + reasonix.toml 语法 | 100 |
| test_html_integrity.py | frontend/index.html 引用完整性 | 80 |

启动约束中固定了：「必须通过 tests/python/ 下所有测试（禁止修改测试文件）」。

---

## JS 测试基线

前端 `vitest` 环境已有：

| 测试文件 | 测试数 | 覆盖 |
|---------|--------|------|
| fmt.test.js | 14 | 字节格式化、日期格式化 |
| dom.test.js | 12 | DOM 操作工具 |
| icon.test.js | 17 | 10+ 文件类型图标映射 |
| extensions.test.js | 16 | RESOURCE_EXTS 去重+归属查询 |
| display.test.js | 10 | parseModelName 四种括号+日期+ban |
| stagger.test.js | 6 | 动画延迟计算+封顶 |
| data.test.js | 4 | 创意工坊数据加载 |

运行：`cd frontend && npx vitest run`

---

## 竞态 Bug 模式

### 发现的问题

创意工坊仓库列表：`tryFetchModels` 用 3 个延时并发的 HTTP 请求（p1 立即、p2 2s、p3 4s），p1 成功后 Promise.any 已返回并渲染了界面，但 p2/p3 的 `setTimeout` 依然触发 `onProgress` 回调，覆盖已渲染的内容。

```
p1(jsd) 成功 → renderModels() → 内容正常 ✅
                     ↓
p2 2s 后触发 onProgress("⏳ 发出第二个请求…") → 覆盖 ❌
p3 4s 后触发 onProgress("⏳ 发出第三个请求…") → 再覆盖
```

### 修复方案

```js
let fetchDone = false;
const result = await tryFetchModels(repo, mirror, (pct, label) => {
  if (fetchDone) return;  // 请求已结束，忽略后续延时进度
  resultsBody.innerHTML = ...;
});
fetchDone = true;
```

类似问题在 `review.py` 中通过 W5 规则自动检测：
- 检测：回调闭包中的 `innerHTML` 赋值
- 扫描：`rg "=>\s*\{[^}]*innerHTML\s*="`

---

## GBK 编码兼容方案

所有 Python 脚本（review.py / doctor.py / comment-checker.py 等）都遇到了 Windows GBK 编码问题：

| 问题 | 表现 | 修复 |
|------|------|------|
| subprocess text=True | 二进制文件解码失败 → `NoneType` | `capture_output=True` + 手动 `decode("utf-8", errors="replace")` |
| print() 含 emoji | GBK 无法编码 `'\U0001f4c1'` | `sys.stdout.buffer.write(data.encode("utf-8"))` 替代 `print()` |
| 文件写 UTF-8 emoji | 读取时 GBK 崩溃 | 始终用 `.read_text("utf-8")` + `.write_bytes(...)` |

---

## AGENTS.md 宪法核心约束

当前启动约束（每次会话粘贴）：

```
- 只读 AGENTS.md 文档地图列出的文件
- 禁止 ls / glob / 目录枚举
- 禁止启动子代理（task / explore / research），预定义 subagent skill 例外
- 先输出修改计划或替换表 → 我确认 → 再 apply
- 必须通过 tests/python/ 下所有测试（禁止修改测试文件）
- 优先运行命令而非读取文件全文
- 失败熔断：同一命令连续失败 2 次 → 停止并进 Plan 模式
- 逻辑下沉优先：能放 go/ 包不放 app_*.go
```

---

## 遗留问题

1. `window.__` 调试挂载 10 处（model3d.js 等）
2. `window.go.main.App` 直接调用 3 处残留
3. `npx vite build` 在 Python subprocess 中 PATH 问题
4. `app_install.go` 1251 行（`GetInstanceSyncStatus` 198 行未抽）

---

## 相关文件索引

| 文件 | 说明 |
|------|------|
| AGENTS.md | 文档宪法 |
| docs/core/NAMING_GUIDELINES.md | 命名规范 |
| docs/architecture/logic-sinking.md | 逻辑下沉方案 |
| scripts/脚本体系全景.md | 所有脚本调用索引 |
| docs/tasks/SESSION_HANDOFF.md | 会话交接日志 |
| docs/architecture/bug-chronicle.md | bug 记录 |
