# ADR-318：测试套件分组与发版冒烟组（反馈回路提速）

- **状态**：✅ 已采纳
- **日期**：2026-10-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-206（pre-push gate 工具层）、ADR-244（变更范围归属）、`docs/releases/release-process.md`、`scripts/release-smoke.ts`

---

## 1. 背景（Context）

v1.15.0 发版跑了 **五轮 CI** 才发布成功。复盘每轮抓到的都是真问题（门禁零误报），但问题串行堆积在发版最后一公里才暴露，本质是三类工程病：

1. **跨平台盲区**：`write_diag.go` 无条件 import `x/sys/windows`（缺 `//go:build windows`），本机 Windows 上 `go build ./...` 永远测不到；Wails beta.26 升级一个月内从未在非 Windows 平台编译过，第一次真正的 Linux/darwin 编译就是发版。
2. **锁文件与清单不同步**：依赖升级动了 `package.json` 但漏动三个 lockfile（frontend/pnpm-lock、根 package-lock、coverage 大版本配套），本地 `npm install` / vitest 不带 `--coverage` 全部绿灯，只有 CI 的 frozen-lockfile / coverage 步骤会炸。
3. **CI 与本地环境漂移**：tag 检出无 `refs/heads/main`、vitest 5.0.3 严格化、CI 静态门禁归属口径——全是「本地绿 CI 红」经典形态；这些门禁/测试多为上个发版周期后新增，首次在 tag 触发场景下运行。

结论：**不是测试太严，是「本地验证命令」与「CI 实际命令」不同构**。每次发版 = 两种口径的第一次对撞。

## 2. 决策（Decision）

### D1：套件按「触发时机」分组，不按目录分组（五组封顶）

| 组 | 内容 | 触发时机 |
|---|---|---|
| **冒烟组**（新增） | lockfile 一致性（pnpm frozen-lockfile + npm ci --dry-run）+ 跨平台 import 执法 + CI 敏感契约测试抽样 + binding-check | 本地发版前必跑；目标 ≤3 分钟 |
| 单测组 | 现有 444 文件 / 7171 用例全量 | pre-push / CI test job |
| 契约组 | tests/*.ts（106 个） | 已有独立跑法，维持 |
| E2E 组 | Playwright | CI 专属，维持 |

**反模式警告**：禁止按目录拆成几十个组——「该跑哪个组」的映射本身会变成新的漂移源。组数上限 5，每组必须有唯一明确的触发时机。

### D2：冒烟组以「CI 同口径」为设计第一原则

每一条冒烟检查必须回答「CI 的哪个步骤会被这条检查预演」；回答不了的不要进冒烟组（那是单测组/契约组的事）。

### D3：跨平台执法走静态 import 检查，不做本地交叉编译

Wails 应用交叉编译受 CGO 约束（本地 CGO_ENABLED=0 下 wails 自身编不过），`GOOS=linux go build` 冒烟不可行。替代：静态检查「import OS 专属包（x/sys/windows、syscall/js 等）的 .go 文件必须带对应 `//go:build` 标签」——这正是 v1.15.0 第四轮雷的病灶类，检查在毫秒级且零工具链依赖。

### D4：冒烟组接入点 = 发版手册（人工/ AI SOP），不进 pre-push

pre-push 已 40+ 项（全绿 ~数分钟），冒烟组的价值在发版前定向预演，塞进 pre-push 会稀释其「快」的定位。`docs/releases/release-process.md` 的发版前置清单加冒烟组步骤；`doctor` 全量不动。

## 3. 后果（Consequences）

**正面**：
- 发版预演从「全量 CI 20 分钟 × N 轮」变为「本地冒烟 ≤3 分钟 × 1 轮」，lockfile/跨平台/import 类雷在发版前暴露。
- 失败定位按组隔离，不再每次等完整 job 才知道下一个雷。

**负面 / 已知遗留**：
- CI 敏感契约测试抽样靠人工维护清单，新加 tag 敏感测试不会自动入组（知识卡记录缓解）。
- 静态 import 检查只覆盖「包名级」OS 绑定，build tag 内更深层的平台逻辑漂移仍依赖 CI 真机。
- Go 测试未单独分组（多包散布），维持现状；若未来 CI Go 时长成为瓶颈再议分组。

## 4. 数据溯源

- v1.15.0 五轮发版 CI 排雷记录（2026-10-03 会话）：round 2 = pnpm-lock 过期（E2E frozen-lockfile）；round 3 = tag 检出契约测试两连红；round 4 = coverage 大版本错配 + write_diag 跨平台编译失败；round 5 = 全绿。
- 本地 pre-push 门禁 vs CI 静态门禁（`pre-push-gate --static`）归属口径差异实证。

<!-- 文件名: test-suite-groups-release-smoke.md → 实际文件 ADR-318-test-suite-groups-release-smoke.md -->
