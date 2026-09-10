# ADR-224：mock 路径守卫：vi.mock 目标存在性静态校验（M1 内部硬报 / M2 裸包 WARN / 豁免通道）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/_lib/alias-resolve.ts`、`scripts/check-path-hygiene.ts`

---

## 1. 背景（Context）

vitest 的 `vi.mock("<path>")` 对**不存在的模块路径静默不命中也不报错**（host 视为 auto-mock）。当某个模块因重构迁移/rename 被移动后，测试里指向旧路径的 `vi.mock` 失效——mock 不生效、被测文件真实 import 链被拉起，测试仍可能通过，但隔离意图悄悄丢失。

本仓实证（2026-09-10 sync 迁移）：`app-content.methods.test.ts` 的 `vi.mock("@/features/sync.ts")` 在 sync 迁到独立目录 `sync/sync.ts` 后失效，vitest 无任何告警。这是「改代码→测试→提交」闭环之外的静默病灶，无门禁覆盖。

## 2. 决策（Decision）

新增静态守卫 `scripts/check-mock-paths.ts`：扫描 frontend 测试文件的 `vi.mock / vi.doMock / vi.unmock` 说明符，解析目标存在性，按三级规则报告。

### 规则分级（对齐 check-path-hygiene 语法）

- **M1 内部 spec（`@/`、`#root/`、`./`、`../`）解析失败 → FAIL**（唯一 fail-closed 阻断项）。
  目标文件不存在 / `@/` 别名未登记 / `.js→.ts` 兜底后仍无 → 阻断。这正是 sync 那类病灶。
- **M2 裸包 spec 三判据皆无 → WARN（默认）/ FAIL（`--strict`）**。
  三判据 = `package.json deps ∪ devDeps ∪ optionalDeps` 命中 / `frontend/node_modules/<spec>` 存在。默认 WARN 不阻断。
- **M3 `.js` 胶水兜底成功但写法过时 → INFO**（只统计，不催改）：
  spec 以 `.js` 结尾、但实际解析到 `.ts` 源（如 `bindings/...app.js` → `app.ts`）。它是合规写法（vite 插件解析），但提示可写 `.ts`。

### 判定口径（E1 增强，关键）

- 裸包以 **deps 为主导**，`node_modules` 是**补充**而非硬判据。实证 `frontend/node_modules` 仅 10 个条目，`three`/`@wailsio/runtime` 子包未安装——若以 node_modules 做 fail-closed，本仓会立即炸约 20 条误报。故 node_modules 只作「deps 未命中的兜底放行」，且默认只 WARN。
- 预留 `.js→.ts` 扩展名兜底：spec 指向不存在的 `.js` 时尝试 `.ts`（bindings 单类 14 处，最大头）。

### 豁免通道（E3）

- 行内 `// mock-path-ignore: <理由>` + 文件级集中白名单（`mock-path-exempt`）。
- 用途：虚拟模块（`virtual:*`）、故意 mock 不存在路径以阻断加载的写法。没有豁免通道的守卫，第一次误报就会被 `--no-verify` 绕过，故豁免通道与门禁同批落地。

### 覆盖范围（E4）

- 含 `vi.doMock`、`vi.unmock`：unmock 路径写错同样是静默失效，且更难发现（测试反而「通过」）。

## 3. 后果（Consequences）

正面：
- 路径重构/rename 驱动的 `vi.mock` 失效从此被 M1 fail-closed 拦截，杜绝静默隔离丢失。
- 复用 `alias-resolve.tryResolveAlias` 解析 `@/`「`#root/`」，与 check-path-hygiene 同源，不引入第二套解析逻辑。

负面 / 已知遗留：
- 静态扫描无法覆盖运行时动态拼接的 spec（少见，接受）。
- M2 默认 WARN 意味着裸包漂移不阻断——换取本仓环境（node_modules 不完整）零环境噪声。

接入策略（存量清理优先）：
- 首跑 `--json` 全量扫出存量清单，**修净 M1 存量后再挂 FAIL 闸**——否则闸门一上来就是红的，等于没有闸门。

## 4. 数据溯源

实证来源 → 结果：
- vitest 对不存在模块路径的 `vi.mock` 静默不命中（本仓 before-sync 实测）→ 决定 M1 fail-closed。
- `frontend/node_modules` 仅 10 个条目、`three` 未装、`@wailsio/runtime` 子包缺失 → 否决「裸包硬报」（选项 2），裸包改为 deps 主导 + 默认 WARN。
- 裸包 mock 全量仅 3 类（`@wailsio/runtime`×10/`three`×7/`three/addons`×3），100% 命中 package.json deps → deps 判据零误报。
- bindings `app.js` mock 14 处、磁盘仅 `app.ts` → `.js→.ts` 兜底为必做项。
- 全仓 spec 引号 100% 双引号、0 单引号 → 提取正则无需双形态。

<!-- 文件名: mock-vi-mock-m1-m2-warn.md → 实际文件 ADR-224-mock-vi-mock-m1-m2-warn.md -->