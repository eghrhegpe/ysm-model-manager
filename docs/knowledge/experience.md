---
kind: experience
name: 发版冒烟组——CI 同口径预演（ADR-318）
tier: leaf
category: config
status: active
source_files:
  - scripts/release-smoke.ts
  - docs/adr/ADR-318-test-suite-groups-release-smoke.md
use_when:
  - 发版前预演 CI（tag 推送前）
  - lockfile 与 package.json 是否同步存疑
  - Go 文件 import OS 专属包要确认 build 标签
  - 发版 CI 连红要本地快速定位口径差
pitfalls:
  - Windows 下 pnpm/npm 是 .cmd 垫片——execFileSync 直调 ENOENT，必须 shell:true（本卡 run() 已封装）
  - npm ci 真跑会清 node_modules——本地预演必须 --dry-run
  - Wails 应用本地 GOOS 交叉编译受 CGO 限制不可行——跨平台执法只能走静态 import 检查（ADR-318 D3）
  - lockfile-frontend 检查假红排查：先手动 `cd frontend && pnpm install --frozen-lockfile` 看真实报错
quick_groups:
  - 门禁与脚本
quick_intents:
  - 发版冒烟、CI 预演、lockfile 同步、跨平台标签
quick_risk_lines:
  - contract-tagsensitive 清单为人工维护——新加 tag 敏感契约测试须手动入组（ADR-318 已知遗留）
invariant_anchors:
  - scripts/release-smoke.ts|checkCrossPlatformImports
---

# 发版冒烟组——CI 同口径预演（ADR-318）

## 概览

v1.15.0 发版跑了五轮 CI 才成功，复盘结论：**不是测试太严，是本地验证口径与 CI 冻结口径不同构**。本卡记录冒烟组（`node scripts/release-smoke.ts`，≤3 分钟）的检查项与各自预演的 CI 步骤。

## 核心职责

五项检查，每项回答「CI 的哪个步骤会被预演」：

| 检查 | 预演的 CI 步骤 | 雷的历史 |
|------|----------------|----------|
| lockfile-frontend | test/e2e job `pnpm install --frozen-lockfile` | v1.15.0 round2 ERR_PNPM_OUTDATED_LOCKFILE |
| lockfile-root | android job `npm ci` | round4 EUSAGE 锁文件不同步 |
| crossplatform-imports | 四平台 go build | round4 x/sys/windows 缺 //go:build |
| contract-tagsensitive | 契约测试（tag 检出场景） | round3 无 refs/heads/main 两连红 |
| bindings | binding-check | ctx 注入 arity 假阳性 |

## 对外 API / 入口

- `node scripts/release-smoke.ts`——人读输出；`--json`——机器可读。
- 接入点：`docs/releases/release-process.md` §6 发版前清单（必跑项）；刻意**不进 pre-push**（ADR-318 D4，保持快定位）。

## 与其他子系统关系

- ADR-318 立法（分组上限 5、按触发时机分组、反模式=按目录拆几十组）。
- pre-push gate（ADR-206）跑全量静态工具；本卡冒烟组是发版前定向预演，互补不重叠。

## 不变量

- 每条检查必须归属一个真实 CI 步骤（`ciStep` 字段），回答不了的不要进冒烟组。
- 跨平台执法 = 包名级静态 import + `//go:build` 标签对账（`checkCrossPlatformImports`）；`_other.go`/`_stub.go` 命名豁免（空实现范式，如 `go/fsutil/crossdevice_other.go`）。

## 相关

- ADR-318-test-suite-groups-release-smoke.md（立法）
- docs/releases/release-process.md §6（接入点）
