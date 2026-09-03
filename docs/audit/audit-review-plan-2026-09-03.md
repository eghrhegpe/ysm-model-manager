# YSM model manager 文件布局梳理 · 修复趋势 · 审核计划

> 制定日期：2026-09-03 ｜ 视角：联邦架构审核（鲸鱼架构师）
> 事实来源：git log（近 90 天）、ADR-109 代码审查 Checklist、前端治理规则手册、致命陷阱手册、锐评修复计划、当前工作树状态。

---

## 一、文件布局梳理（城邦地图）

项目为六层联邦结构，职责边界由 `AGENTS.md` 红线锁定——**Go 判定类型、前端只读消费**。

| 层级 | 路径 | 规模 | 职责 |
|------|------|------|------|
| 桌面外壳 | `main.go` / `cmd/` / `internal/app/` | Go 425 | Wails v3 桥；`internal/app/app_*.go` 为**类型判定唯一事实源** |
| Go 内核 | `go/` | 353 .go | 扫描 / 解析 / CLI / 缓存 / 容器；绑定经 `window.go` 下发 |
| Rust 内核 | `rust-core/` `rust-wails-bridge/` | 5.2k | 扫描 FFI（cgo 桥），独立栈，与 Go 双重维护 |
| 前端 | `frontend/` | 882 .ts | 原生 DOM + Web Components/Shadow DOM + Three.js 预览器 |
| 脚本门禁 | `scripts/` | 155 | GEN_CMDS 生成物 + 红线门禁 + 契约测试 + 知识卡 |
| 文档知识 | `docs/` | 2073 | adr / audit / knowledge / review / releases（治理与决策沉淀） |

**前端 `frontend/src` 主要子域（按体量）：**

| 子域 | .ts | 定位 |
|------|-----|------|
| `preview-3d/` | 239 | 3D 预览统一外壳 + 各格式适配器 + caps（资源生命周期主战场） |
| `views/` | 198 | 57 面板（声明式 Schema，ADR-093 已迁移） |
| `utils/` | 120 | 资源 schema / 路径 / DOM / 转义等通用逻辑 |
| `backend/` | 54 | Wails 绑定消费层 |
| `features/` | 34 | recycle-bin / dedup / 下载队列等业务功能 |
| `core/` `ui/` `services/` `wasm/` `workers/` | 30/30/6/7/5 | 状态中枢 / UI 控件 / 服务注册 / WASM / Worker |

**数据事实源（非代码）：** `resource_types.json`（类型与 variants 单一事实源）、`creators.json`、`workshop_sites.json`、`workshop-github.json`。

**判定：** 布局清晰、分层合理。主要风险不在结构，而在**跨层职责漂移**与**3D 资源生命周期**——后者是修复最高频区。

---

## 二、近期修复趋势（近 90 天，截至 2026-09-03）

### 提交构成（类型前缀统计，约 834 条带类型提交）

| 类型 | 数量 | 占比 | 信号 |
|------|------|------|------|
| `fix` | 237 | 28% | **最高频**——纵深加固期，非功能爆发期 |
| `docs` | 213 | 25% | 知识卡/ADR/门禁说明高频刷新（治理反哺） |
| `refactor` | 126 | 15% | 收敛、去全局、拆大文件 |
| `feat` | 107 | 13% | 功能仍在推进但节奏放缓 |
| `test` | 71 | 8% | 契约/单测补强，伴随修复 |
| `chore`/`perf`/`style`/`ci` | 80 | 10% | 门禁与构建维护 |

### 关键信号

1. **🔴 资源生命周期是头号修复域**：dispose / 泄漏 / 引用计数 / release 相关 fix 达 **54 条**。GPU 纹理、render target、WASM 解码器、worker pool 的"acquire 不 release"反复出现（screenshot、mmd-adapter、caps、scene-registry）。
2. **🔴 修复域高度集中 3D**：`preview`(45) + `3d`(44) 合计 ~89，是 `scripts`(44) 同级规模。3D 适配器与 caps 的释放闭环是主战场。
3. **🟡 治理型修复成体系**："锐评"(go_design_critique) 线程贯穿 **21 次提交**——刀①②③④⑤ 驱动去全局、拆大文件、收编截断陷阱（ADR-033）、knip 死代码契约。说明项目正系统性"整顿城邦"。
4. **🟡 类型纪律硬化连带 fix**：`exactOptionalPropertyTypes` / `noFallthroughCasesInSwitch` / `verbatimModuleSyntax` / `noUncheckedIndexedAccess` 陆续启用，e2e/脚本门禁被卡多日（如 `e2e` TS6133、`postprocessing` 收集期崩溃）。
5. **🔴 回归密度高**：多处 fix 标注"回归 / 吞异常 / 漏网"（mmd-adapter 守卫短路回归、litematic 吞异常回归、ysm-adapter dispose 回归）——印证 ADR-109「端到端断言前置」未被充分落实。

### 趋势结论

项目已从「功能扩张」转入「纵深加固 + 红线治理 + 资源生命周期收口」。但**回归频发**暴露 review 后置问题：大文件/大改动的失败路径与释放闭环缺乏提交前断言。下一阶段审核应**前置到改动期**，并以 ADR-109 清单钉死。

---

## 三、审核计划

### 3.0 现状：当前工作树存在未提交重构（即时审核目标）

`git status` 显示本会话/并行会话正在推进的搬运与重构，**进入提交阶段前必须过清单**：

| 改动 | 性质 | 审核重点 |
|------|------|----------|
| `utils/resource/registry.ts` → `services/resource-registry.ts`（删旧建新） | 服务注册搬迁 | R7 魔法字面量、注册必有消费方（致命陷阱 #13）、`binding-check` 契约 |
| `features/recycle-bin.ts` + 集成测试 | 业务功能 | 软删路径（致命陷阱 #8）、`finally` 还原（陷阱 #3）、toast 反馈（#16） |
| `app-content/diagnostics/dedup.ts` 会话工厂化 | 去全局 | 重入/面板绑定/keep 策略（已补测试，需 review 断言覆盖） |
| `app-content/settings/path-cards.ts` + `init.ts` | UI | R5 颜色硬编码、R4 动画、转义（R8/R10） |

**即时动作**：`node scripts/commit-with-check.ts -m "refactor: ..." --files <仅自己文件>`（白名单防并行 docs 误卷）；推前 `doctor` 全量。

### 3.1 三轨审核矩阵

| 轨 | 范围 | 触发 | 工具/清单 | 优先级 |
|----|------|------|-----------|--------|
| **A 自动化门禁** | 全仓 | 每次 commit/push | `check-redlines` / `typecheck` / 契约测试 / `knip` / `doctor` | 保持，不重造 |
| **B 本轮 WIP** | 上表 4 组改动 | 提交前 | ADR-109 §1/§3/§4 + 治理红线 R1–R10 | 🔴 立即 |
| **C 纵深专项** | 见下表 | 排期 | ADR-109 全清单 + 端到端断言补强 | 🔴→🟡 |

### 3.2 Track C 专项排期

| # | 专项 | 对应红线/陷阱 | 交付物 | 优先级 |
|---|------|---------------|--------|--------|
| C1 | **GPU 资源生命周期审计**：preview-3d / caps / 各 adapter 的 dispose 闭环、引用计数、失败路径释放 | ADR-109 §3、fix 54 条 | 缺口清单 + 端到端释放断言 | 🔴 |
| C2 | **锐评遗留复核**：#1 variants 消费化、#4 mmd-adapter 拆分、#6 rust parity、#8 i18n build 校验、#9 感知暂停、#10 缓存告警 | sharp-review-fix-plan | 逐项闭环表（哪些仍开） | 🔴 |
| C3 | **回归热点文件专项**：model3d（9 次 fix 第一）、mmd-adapter、坐标变换（陷阱 #11/#18） | 陷阱 #11/#18、ADR-004 | `verify:port` 全顶点对拍 + 坐标断言 | 🟡 |
| C4 | **跨平台/并发边界**：rust-bridge FFI 并发、跨设备移动、符号链接、原子写入 | ADR-109 §2/§4/§5 | 边界用例 + `fsutil` 收编核对 | 🟡 |

### 3.3 锐评遗留项即时对账（来自 sharp-review-fix-plan）

| 项 | 状态 | 处置 |
|----|------|------|
| #2 LABELS 派生 | ✅ 已合（`0eeb8355`） | 关闭 |
| #3 ANDROID_UNAVAILABLE 检测 | ✅ 已合 | 关闭 |
| #1 variants 消费化 | ⬜ 仍开 | 归 C2，下次改 preview 顺手 |
| #4 mmd-adapter 拆分 | ⬜ 渐进中 | C2 跟踪 |
| #6/#8/#9/#10 | ⬜ 条件/按需 | C2 排期 |

### 3.4 门禁矩阵（已自动化，保持）

`pre-commit`（GEN_CMDS + 知识漂移 + gofmt + diffstat）、`pre-push`（全量阻断）、`prepare-commit-msg`（知识卡 + 覆盖率）。**勿重复造轮子**——Track A 交给钩子，人工精力集中在 B/C 的语义与生命周期判断。

---

## 四、执行建议（议会决议草案）

1. **即时**：对 §3.0 工作树改动逐组跑 `commit-with-check --files`，推前 `doctor` 全绿。
2. **本周**：启动 C1（GPU 生命周期）——按 adapter 拆工单，每单补一条"释放闭环"断言。
3. **双周**：C2 锐评遗留闭环评审，更新 sharp-review-fix-plan 状态表。
4. **长效**：凡大文件改动（>800 行如 mmd-adapter）强制加端到端断言，否则 review 打回（落实 ADR-109 §3 第二点）。

> 城邦已具雏形，当下要务是**收口资源生命周期 + 把 review 前置到改动期**，而非再开新功能。
