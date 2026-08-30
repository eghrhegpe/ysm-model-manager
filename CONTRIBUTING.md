# 贡献指南

感谢你考虑为 YSM 模型管理器做贡献！本项目是一个 Minecraft YSM 模型管理工具，基于 Wails v3（Go + WebView2）构建。

## 快速上手

### 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Go | 见 `go.mod` | 后端 + Wails 绑定 |
| Node.js | 见 `vars.NODE_VERSION` | 前端构建 |
| Wails v3 CLI | 见 `vars.WAILS_VERSION` | 桌面应用打包 |
| WebView2 Runtime | 最新 | Windows 渲染（预装于 Win10/11） |

### 安装开发依赖

```bash
# 前端依赖
cd frontend && npm install

# Go 依赖（自动拉取）
go mod download
```

### 开发模式

项目有四种运行模式，**不要混用**：

```bash
# ① 桌面开发模式（唯一跑通 Go 桥的模式）
task dev
# 或：wails3 dev

# ② 纯网页开发模式（web 适配器，走 browserAdapter）
cd frontend && npm run dev:web

# ③ 纯 UI 壳开发模式（无后端绑定）
cd frontend && npm run dev

# ④ CLI 模式（脱离 GUI 的命令行操作）
go run . --cli --files-root <仓库根> <命令>
```

## 项目结构

```
ysm-model-manager/
├── main.go                    # Go 入口 + 窗口参数
├── internal/app/              # Wails Binding 入口（按域拆分）
├── go/                        # Go 工具包（installer/sync/ysm/...）
├── frontend/                  # 前端源码（Web Components + Shadow DOM）
│   ├── src/
│   │   ├── backend/           # Wails/browser/android 后端适配
│   │   ├── views/             # Web Components（Shadow DOM）
│   │   ├── core/              # 基础设施（context-menus/i18n/...）
│   │   └── features/preview-3d/          # Three.js 3D 适配器
│   └── bindings/              # Wails 自动生成的 TS 绑定
├── docs/                      # 文档（GitHub Pages 主站）
├── scripts/                   # 构建/发布/工具脚本
└── tests/                     # Node 契约测试
```

## 提交规范

### Conventional Commits

本项目采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <简短描述>

[可选正文]

[可选脚注]
```

**常用 type**：

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（不改变行为） |
| `test` | 新增 / 修改测试 |
| `docs` | 文档变更 |
| `chore` | 构建 / 工具 / 配置 |
| `perf` | 性能优化 |

### 路径限定提交

**重要**：本项目采用路径限定提交策略，避免误纳入并行会话产物。

```bash
# ✅ 正确：只提交自己的文件
git commit -m "fix: 修复路径校验漏洞" -- go/paths/paths.go go/paths/paths_test.go

# ❌ 错误：全量提交可能纳入他人改动
git commit -am "..."
```

### 一键验证 + 提交

```bash
# 验证 + 提交一体（按 staged 文件裁剪门禁）
node scripts/commit-with-check.mjs -m "<type>: <描述>"

# 选项
#   --fast     跳过 vitest（快速提交）
#   --docs     仅文档变更
#   --check    只验不交
```

## 测试门禁

### 提交前必跑

| 改动类型 | 验证命令 | 说明 |
|----------|----------|------|
| Go | `go build ./go/...` | 编译检查 |
| 前端 | `cd frontend && npx vite build && npm run typecheck` | 构建 + 类型检查 |
| 文档 | `node scripts/doctor.mjs --docs` | 文档漂移检测（秒级） |
| 发版前 | `node scripts/doctor.mjs` | 全量门禁 |

### 测试类型

```bash
# 前端单元测试（vitest，316 文件 / 5019 用例）
cd frontend && npx vitest run

# Go 单元测试
go test ./go/... -timeout 60s

# Node 契约测试（前后端 API 契约）
for f in tests/*.mjs; do node "$f"; done
```

### CI 自动跑的测试

- **test.yml**（可复用门禁）：契约测试 + Go 检查 + 前端构建
- **ci.yml**：main push / PR 触发 test 门禁
- **release.yml**：tag push 触发完整发版流程
- **pages-deploy.yml**：GitHub Pages 自动部署

## Git 钩子自动化

本项目用 Git 钩子做自动化，**你只需手动做三件事**：

1. `git add` 自己的源码
2. 发版前 `node scripts/doctor.mjs` 全量验证
3. `git push`（pre-push 自然触发门禁）

### 钩子清单

| 钩子 | 触发 | 行为 |
|------|------|------|
| `pre-commit` | `git commit` | 跑生成物同步 + 知识卡漂移检测 + gofmt |
| `pre-push` | `git push` | 全量门禁（测试 + 类型 + 契约），失败阻断 |
| `prepare-commit-msg` | `git commit` | 提示受影响知识卡 + 覆盖率 |

### 逃生阀

```bash
git commit --no-verify     # 只跳 commit 钩子
YSM_SKIP_GATE=1 git push   # 连 pre-push 一起跳（慎用，绕过不留审计）
git push --no-verify       # 同上
```

## AI 协作规则

本项目重度使用 AI 协作开发，详见 [`AGENTS.md`](AGENTS.md)。关键约束：

### 职责归属红线（不可违反）

- **类型判定**：唯一事实源 = `resource_types.json` + Go（`internal/app/`）
- **前端只读不判**：tab / preview / 3d / resourcepack 归类一律由 Go 扫描结果派生
- **跨类型切换**走 `switchExternal`，**同源替换**走 `switchTo`

### Wails 绑定

```bash
# 修改 Go binding 后必须重新生成 TS 绑定
npm run generate:bindings -ts

# ⚠️ 不带 -ts 会产出 .js 并清掉 git 跟踪的 .ts
#    这是回归红线，务必注意
```

### 知识卡同步

- **铁律**：改完代码同步知识卡
- `check-knowledge-drift` 由钩子自动兜底
- 新知识卡：`node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]`

## 文档规范

### ADR（架构决策记录）

新增 ADR 走脚本，不手写编号：

```bash
node scripts/new-adr.mjs "标题" [...]
```

**ADR 状态**：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代`

**ADR 只记决策方向和理由，不记实施进度**。实施进度写进知识卡。

### 生成物 vs 手写文件

- **生成物**（`docs/` 下 index / funcmap / project-map / cli-commands / i18n locale JSON / `completions/` 等）= 全体输入的纯函数
- **生成物不承担提交归属**：改卡后由 pre-commit 自动 gen + stage，交就交当前全量态
- **手写文件**（源码、知识卡、AGENTS.md 等）→ 路径限定提交

## 性能诊断

遇到性能问题，优先用项目内置工具：

```bash
# 单模型性能基准（定位瓶颈）
go run . --cli --files-root . single-bench --model <path>

# 并发性能基准
go run . --cli --files-root . concurrent-bench --dir <path>

# MMD 模型结构分析
go run . --cli --files-root . analyze-mmd --model <path>

# 扫描目录性能
go run . --cli --files-root . scan-dir --dir <path>
```

## 常见问题

### Q: 修改 Go 文件后前端没更新？

A: Go binding 改动需要：
1. `npm run generate:bindings -ts` 重新生成 TS 绑定
2. `go build ./go/...` 编译 Go
3. 重启 `wails3 dev`

### Q: pre-push 门禁失败怎么办？

A: 读输出尾部 10 行，按 check 名定位 `.githooks/pre-push` 对应脚本。常见失败原因：
- Go 测试超时（加 `-timeout 120s`）
- 前端 typecheck 失败（`cd frontend && npm run typecheck` 修到绿）
- 契约测试失败（`api-break` 检测到破坏性变更）

### Q: 如何新增一个 CLI 命令？

A: 只改 `cli.go` 源码注册，**不维护 `docs/cli-commands.md`**——那是 `gen-cli-doc.mjs` 自动生成的。

### Q: 并行会话提交冲突怎么办？

A: 路径限定提交是唯一安全的策略：
```bash
# 各会话只提交自己的文件
git commit -m "fix: ..." -- <自己的文件...>
```

## 联系方式

- **Bug 报告**：[GitHub Issues](https://github.com/JiangKaslana/ysm-model-manager/issues)（用 Bug 模板）
- **功能请求**：同上（用 Feature 模板）
- **安全漏洞**：见 [SECURITY.md](SECURITY.md)
- **开发讨论**：GitHub Discussions（如有）

## 行为准则

参与本项目即表示你同意遵守我们的行为准则：尊重、包容、专业。针对个人的攻击、骚扰或歧视行为不被容忍，将被立即处理。

---

**本贡献指南最后更新**：2026-08-30
