---
kind: ci-tuning
name: CI 调优与缓存决策
tier: architecture
category: config
status: active
last_verified: 2026-10-08
invariant_anchors:
  - .github/workflows/test.yml|GOOS: windows
  - .github/workflows/test.yml|needs: [contracts]
  - .github/workflows/test.yml|YSM_DEADCODE_BASE
  - .github/workflows/test.yml|frontend-gates
  - .github/workflows/test.yml|./.github/actions/playwright-spine
  - .github/actions/playwright-spine/action.yml|/var/cache/apt/archives/*.deb
  - .github/actions/playwright-spine/action.yml|playwright install --with-deps chromium
  - go/executil/executil_test.go|HideWindow
  - frontend/src/workers/coi-sw.ts|location.reload
  - .github/workflows/release.yml|cancel-in-progress: true
source_files:
  - .github/workflows/test.yml
  - .github/workflows/release.yml
  - .github/workflows/ci.yml
  - .github/actions/playwright-spine/action.yml
  - scripts/_lib/gate-blocks/schedule.ts
auto_fields:
  symbols_with_lines:
    - CI_INDEPENDENT_TOOLS
    - runContractTestsBlock
    - runScriptsTypecheck
    - runStaticToolsDispatch
use_when:
  - 改 GitHub Actions workflow 前
  - 缓存不生效 / CI 时长反常
  - 某步为何钉在 Windows 或 Linux
  - lint 或覆盖率迁移评估
  - 判断某门禁该删还是该留（去重 vs 覆盖损失）
  - 想知道 CI 是门禁还是报告（本仓现状：无强制拦截）
pitfalls:
  - 日期事故注脚写进 YAML ⇒ 文件变考古层，改一处要滚几百行找上下文（复盘一律写本卡）
  - setup-go 默认 cache:true 在 Windows 是负优化（1133MB 单包解压 94s）
  - apt archives 整目录缓存：lock/partial 是 root 专属，tar 归档必挂
  - hashFiles 指向 node_modules 内文件时，缓存步必须在 pnpm install 之后，否则 key 冻结成常量
  - 覆盖率/diff-coverage 无法迁 Linux（测试代码含 Windows 专有符号）
  - fetch-depth:0 全量克隆后再 git fetch --depth=1 会把整仓退化成浅克隆，HEAD~1 失明
  - 归属基线类 env（YSM_DEADCODE_BASE）挂 step 级 ⇒ 同 job 内 --static 第二次执行拿不到，退严格模式假红
  - 同一 job 内同一工具跑两遍时第二遍上下文更差（CI 跑在 push 之后，暂存区空 ⇒ 无归属可解析）
  - 「远端防线」措辞不等于仓库真有强制拦截：本仓 main 无 branch protection / ruleset（须 gh api 核）
  - 治理闸与功能测试同 job 且顺序在前 ⇒ 治理失败 skipped 掉 tsc/vitest，功能正确性在 CI 上永不被回答
quick_groups:
  - 门禁与脚本
quick_intents:
  - CI 缓存为什么没生效
  - 某步为什么只能在 Windows
  - 为什么把 lint/测试拆成并行 job
  - e2e 为什么慢或超时
quick_risk_lines:
  - 改 workflow YAML 须用 commit-with-check --files .github/workflows/<文件>，勿裸 git commit
  - 事故复盘写进本卡，别往 YAML 堆日期注脚
---

# CI 调优与缓存决策

> 本卡承载 `.github/workflows/*.yml` 的全部事故复盘与取舍理由。YAML 内**只留一行不变量 + 指针**；
> 想知道「为什么这样配 / 曾经踩过什么坑」读这里，不要往 YAML 里再堆 `（2026-10-08 实测…）` 这类注脚。
> 判据同 AGENTS.md 瘦身纪律：**历史踩过什么 = 知识卡；当下该怎么做 = YAML 一行**。

## 概览

`ci.yml`（main/PR）与 `release.yml`（tag）共享可复用 workflow `test.yml`（测试门禁），避免 main push
与 tag push 各跑一遍完整测试。`test.yml` 现为 **6 job 并行**：3×Windows（contracts / frontend / go）
+ 3×Ubuntu（go-analysis / e2e / e2e-web），墙钟 ≈ max(各 job)。

## 核心决策（不变量）

### 1. Go 工具链：单一事实源 + 关缓存

- `go-version-file: go.mod`，**不用** `vars.GO_VERSION`——后者与 go.mod 是平行双源，go.mod 升级时
  没有守卫跟着同步。
- `setup-go` 一律 `cache: false`（勿回退为默认 true）。默认把「工具链 + GOMODCACHE + GOCACHE」打成
  单个 1133MB 包，Windows 上解压 94s（下载仅 7s），且与手工 go-mod 缓存内容重叠 ⇒ 每次空烧近 3 分钟
  纯 I/O。关掉后工具链走 runner 自带的 hostedtoolcache（实测 0s 命中）。Linux 冷取模块本就快，同口径
  关闭。

### 2. 版本双源守卫（WAILS / ripgrep）

- `WAILS_VERSION`（仓库 Variables + YAML 兜底）与 `go.mod|github.com/wailsapp/wails/v3` 是平行双源。
  go.mod 升级而 Variables 不同步 ⇒ wails3 CLI 与库版本静默错配，发版与 CI 都发现不了。故 contracts
  job 紧跟 checkout 做「WAILS 版本双源守卫」（纯文件读取、fail-fast，先于一切 wails3 步骤）。
- ripgrep 官方 release **不附 windows zip 的 sha256 sidecar**（已实证），故 CI 内联钉死 SHA256——防
  镜像污染/传输截断静默进 CI。升级版本号须同步换哈希。

### 3. 三个 Windows job 的 setup 段必须一致

go job 要用 `pnpm install` + `vite build`（`//go:embed all:frontend/dist` 前置），必须有 pnpm/action-setup
+ setup-node——拆分时漏过二者，CI 报「The term 'pnpm' is not recognized」直接红。

### 4. golangci-lint 迁 Linux + 跨平台类型检查

- lint 是**纯静态**（只类型检查、不执行），原串在 windows go job 里计入关键路径 + 背 Defender 扫描税。
  迁 `ubuntu-24.04`（钉版本，防 ubuntu-latest 未来静默换血）并行。
- **关键手法：`GOOS=windows` 跨平台类型检查，而非在 Linux 编译 Linux 目标**。原因：
  ① 默认 `GOOS=linux` 会选中 wails 的 `linux_cgo.go`，要求 `pkg-config gtk4 webkitgtk-6.0`（gtk3 tag
     下为 gtk+-3.0/webkit2gtk-4.1），ubuntu runner 不带这些 dev 库 ⇒ 类型检查失败；
  ② `go/executil/executil_test.go` 用 Windows 专有 `SysProcAttr|HideWindow`（仅 `runtime.GOOS` 跳过、
     **非编译期 build tag 排除**）⇒ GOOS=linux 下该包根本编译不过。
  而 `GOOS=windows` + `CGO_ENABLED=0` 类型检查 Windows 目标**不需要任何 GUI 库**（wails 的 Windows
  实现是纯 Go，无 pkg-config 依赖）。语义与原先在 Windows 上 lint 完全一致（同 GOOS、同 build tag）。
- ⚠️ `$GITHUB_PATH` 只对**后续 step** 生效，同一 step 内不能靠裸命令名调用（否则 exit 127）。装
  golangci-lint 后须用**绝对路径**验证版本。

### 5. 覆盖率两件套只能留 Windows

`check-go-diff-coverage` 与覆盖率报告都靠**真跑 `go test`** 取数，而本仓测试代码含 Windows 专有符号
（见 4②）⇒ Linux 上连编译都过不了，Windows 测试二进制也无法在 Linux 执行。**只能留 Windows**。
（曾评估 headless `-tags server` 迁 Linux：可编过，但会跑出一套「把 Windows 专有分支全算未覆盖」的
门禁，比留着更糟。已否决。）

- **覆盖率报告 = 仅 main + continue-on-error**：cover 插桩是独立编译键（与 race 缓存不复用），趋势
  数据由 main 累积即可，PR 零成本。该步 coverprofile 下 `internal/app|go/scanner` 有已知 flaky，显式
  `continue-on-error` 兑现「非阻断」（否则一个趋势展示能让 main 因抖动误红）。
- **方案 A 试错（已回退）**：曾试 main 上把覆盖率并进 race 一次编译（race+cover 同键 + `-p 1`）——
  实测 Go job 从约 6 分钟涨到约 8 分钟，`-p 1` 串行化 race 的成本超过省下的编译键。故维持「并行 race +
  独立仅 main cover」。教训：**两条慢路径的并行/串行取舍 ≠「少一个编译键就更快」**，别凭直觉合并。
- PowerShell 坑：`-coverprofile=.coverage/go-cover.out` **必须加引号**——否则 PS 把 `.coverage/...`
  解析成成员访问（值为 null），profile 落盘 0 字节，`go tool cover -func=` 收到空参数报 too many
  arguments。

### 6. 浅克隆与基线解析（反复踩的坑）

- 覆盖率 / lint 基线需要真实历史：`merge-base(origin/main, HEAD)`，直推兜底 `HEAD~1`——浅克隆（默认
  depth=1）连 `HEAD~1` 都不可解析 ⇒ 门禁硬阻断。
- ⚠️ **凡 `fetch-depth: 0` 全量克隆之后，git fetch 一律不带 `--depth=1`**：`--depth=1` 会把整仓
  **退化为浅克隆**（生成 `.git/shallow`），`HEAD~1` 随即失明 ⇒ 兜底抛 `fatal: ambiguous argument`
  ⇒ 门禁硬阻断（main 恒红事故，与改动无关）。`--depth=1` 不是「少拿点数据」而是**改变仓库形态**。
  lint 里的浅 fetch 是同族复刻，已拔除。护栏见 `tests/test_diff_coverage_shallow.ts`。

### 7. Playwright / apt 缓存（e2e + e2e-web 两处同款）

- ⚠️ **缓存步骤必须位于 `pnpm install` 之后**：key 的 `hashFiles` 指向 git 不跟踪的
  `frontend/node_modules/playwright-core/package.json`，放在 install 之前 hashFiles 恒为空串 ⇒ key
  冻结成常量（`pw-browsers-Linux-`），Playwright 升级后缓存**永不更新**。
- key 钉 **playwright-core 版本**而非整个 pnpm-lock：浏览器二进制只随 Playwright 版本变，前端其他依赖
  变动不应让浏览器缓存全 miss；restore-keys 给前缀回退。
- **apt archives 缓存两步前置**（否则形同虚设）：
  ① restore 侧：runner 镜像里 `/var/cache/apt/archives` 是 root:root 755，runner 用户写不进 ⇒ 不预置
     `sudo chmod a+rw` 则 .deb 恢复不进目录；
  ② save 侧：apt 每次以 root 重写 `lock`(0600) 与 `partial/`(0700)，runner 不可读 ⇒ 整目录归档必报
     `Cannot open: Permission denied` → exit 2 → 存不进去。
  故 cache path 只收 `/var/cache/apt/archives/*.deb`，绕开这两个 root 专属条目；apt 自身经 sudo/root
  运行不受 chmod 影响。
- 保留 `--with-deps`：CJK 字体（wqy-zenhei 等）是中文 UI 截图渲染必需；apt 缓存命中即跳过慢镜像重下，
  只留解包。

### 8. 阶段门控与超时预算

- **e2e / e2e-web `needs: [contracts]`**：契约失败大概率前端契约崩，最贵的一档（真浏览器/WebGL）不空跑；
  其余 job 保持并行取 max，不拖墙钟。
- 每个 job 都显式 `timeout-minutes`——Playwright 的总限只管测试段，webServer/浏览器下载/apt 卡死不受
  其管，缺省 ceiling 是 360min 静默干烧。SwiftShader 软渲染显著慢于 headless Chromium，e2e-web 预算
  放宽一档。
- **e2e-web `globalTimeout` 5min→7min**（`playwright.web.config.ts|globalTimeout`）：慢 runner 上真
  WebGL 全量用例实测会顶满 5min，把最后一个用例掐掉，报「1 did not run + 2 errors not a part of any
  test」⇒ 全部 passed 仍 exit 1。扩到 7min 对齐主配置 `playwright.config.ts|globalTimeout`。
- `web-smoke` beforeEach 不做第二次导航（reload）：应用启动链会自触发一次同 URL reload
  （`frontend/src/workers/coi-sw.ts|reload` 为解锁跨源隔离），手动 reload 与之相撞 ⇒ 竞态。就绪判据
  交 `web-ready.ts|waitForAppReady`（自带导航静默窗口），与 `web-preview.spec.ts` 一致。

### 8b. 治理闸与功能测试必须分 job（2026-10-08 门禁锐评 R5）

- **病灶（实测，非推测）**：`test.yml|frontend` 原把治理闸排在功能检查**之前**——死代码基线 6s +
  `pre-push-gate --static` 1m25s，其后的 `vite build` / `tsc` / `vitest`（3m49s，全 CI 最重的功能验证）。
  治理闸任一失败 ⇒ 后续步骤全部 `skipped`。v1.16.0 首轮 CI 实证：一个**5 秒**的治理检查把
  **3m49s** 的核心测试与 4s 的类型检查全部饿死，CI 上「功能是否正常」这个问题**根本没被回答**。
  本地手动跑 tsc/vitest 感知不到这一层——这是 CI 独有的失明模式。
- **根因是顺序而非检查本身**：治理闸（改动纪律）与功能测试（正确性）关注点正交，却因同 job 串行
  获得了**对后者的一票否决权**。
- **修法**：治理闸拆入独立 job `frontend-gates`，与 `frontend` **并行**。
  ① 功能检查前置且不被治理闸阻断；② 两步各自报红，归因清晰（功能坏了 vs 纪律破了）；
  ③ 关键路径 frontend 5m27s → 3m56s（-1m31s）。
- **⚠️ 拆分时必须保持的前提**：`YSM_DEADCODE_BASE` 仍挂**新 job 的 job 级 `env:`**——
  死代码扫描在本 job 内有两处执行点（独立步骤 + `--static` 内部清单），挂 step 级会让第二处
  拿不到归属基线而退严格模式假红（§11 同款病灶）。护栏 `tests/test_gate_schedule.ts` 断言
  `check-deadcode-baseline.ts` 在 `test.yml` 中仍有独立步骤调用——**拆分只能在本文件内的 job 之间
  进行**，迁到别的 workflow 文件会让该护栏失败（它是「换个地方查」的声明，不是「CI 不查」）。
- **下游依赖无需改**：`release.yml|build-*` 的 `needs: [prepare, test]` 覆盖 `test.yml` 全部 job，
  治理闸仍是发版前置，只是从「串行饿死功能测试」变为「并行各自报红」。

### 8c. 文档域检查归位 pages-deploy（2026-10-08 门禁锐评 R5 续）

- **归位**：`adr-check`（ADR 文件 ↔ `adr/index.md` 登记表一致性）自 `test.yml|contracts` 迁入
  `pages-deploy.yml`，与 `link-checker --strict` 同 job 收口。
- **判据是「消费方是谁」**：`adr/index.md` 的唯一消费者是 VitePress 侧边栏
  （`docs/.vitepress/sidebar.gen.mjs` 据此生成 ADR 导航），故这是**文档站自洽**问题，与
  「应用能否构建/运行」正交。放应用 CI 的代价：纯 Go/前端 push 白付文档检查，且**发版被文档问题
  卡死**（v1.16.0 实证：ADR-326 登记表有、文件缺 ⇒ 前端 job 红 ⇒ 四平台 build 全 skipped）。
- **两检查的分工边界**（实测确立）：`link-checker` 能抓「登记了但文件不存在」这一类
  （注入幽灵登记 ADR-999 实测报 `[BROKEN] docs/adr/index.md: 链接 ADR-999 -> …`）；`adr-check`
  补它抓不到的其余五类——撞号 / 漏登 / 跳号 / 状态行格式 / 文件名编号 vs 标题编号一致。
  **不是二选一，是互补**，故同 job 并存。
- **覆盖不因迁出而丢**（三处互补，均为 `docs/**` 或 ADR 域触发）：
  ① 本地 pre-push 的 ADR 域（`_lib/gate-blocks/data-docs-domain.ts|runAdrDomain`，`plan.adr` 时触发）；
  ② 文档域 CI `pages-deploy.yml`（`paths: docs/**` ⇒ ADR 改动必然触发）；
  ③ 迁移只从**应用 CI** 移除。
- **迁移纪律**：迁走一个检查时必须回答「它现在谁在跑」。本例的答案是上面三处——尤其 ②
  的 `paths` 必须覆盖该检查的输入域（`docs/**` 覆盖 `docs/adr/**`），否则等于静默失守。

### 9. 契约 job 不装前端依赖（隐性防线）
原「契约测试排在 pnpm install 之前」这一顺序是**有意的**（曾暴露 `scripts/port-align.ts` 在模块顶层
resolve esbuild 的缺陷）——拆分后本 job 仍不装前端依赖，保持「测试不得依赖前端依赖」这道防线。故其
setup-node **不配 `cache: pnpm`**（全程不跑 pnpm install，配缓存只会空恢复/空保存 store 包，白交
Windows Defender 的 I/O 税）。
- 契约测试统一走 `scripts/contract-tests.ts`（与本地 pre-push-gate 同源：域裁剪 + `@/` 别名运行时注入）。
  ⚠️ **勿退回手写 `for f in tests/*.ts | node $f` 裸跑循环**——裸跑缺 ts-alias-register 的 `@/` 注入，
  任何 import 链进 frontend `@/` 别名的测试都会 ERR_MODULE_NOT_FOUND（本地绿、CI 红）。护栏见
  `tests/test_workflow_contract_runner.ts`（pages-deploy 曾长期踩此坑——它只挂 Pages 不挂 CI，故无人察觉）。

### 10. release 通道：触发/串行/并发取消

- **`workflow_dispatch` 已移除**：prepare/release 仅在 tag ref 生效；dispatch（branch ref）下 prepare
  被 skip ⇒ 全部 build 连带 skip，实际只跑 test 却整体报「success」（面板看着绿、发布啥也没做）。手动
  只跑测试已由 `ci.yml` 的 dispatch 覆盖。
- **test `needs: prepare`**（串行止损）：秒级版本校验失败时重型测试根本不启动，不白烧分钟；四平台 build
  原本就 `needs [prepare, test]`。
- **concurrency `release-<ref>` + `cancel-in-progress: true`**：同 ref 重推/重触发只保留最新一轮（旧 run
  产物已被新 run 作废，排队干烧四平台构建分钟纯浪费）；不同 tag 独立分组，发版流水线仍并行不互取消。
  ⚠️ 副作用：**重推 tag 会砍掉在跑的旧 run，其已部分上传的 artifact 随之悬空**——但 `release` job 走
  `download-artifact` 重新拉取合并，旧 run 被砍只是不发版，重推后新 run 用全新 artifact 覆盖发布，故
  悬空 artifact 无实际危害；若发现某 tag 产物缺失，**先确认是不是被重推取消**，不是构建失败。
- changed-base：新 tag 的 `event.before` 是全零 SHA（非提交对象），不能直传——解析层
  （`scripts/_lib/deadcode-attrib.ts`）遇全零 base 时试 `git describe` 找上一可达 tag 作归属基线，取不到
  仍退回本地解析兜底。

### 11. 单一执行点：同一 job 内同一工具不得跑两遍（2026-10-08 锐评）

- **病灶**：`check-deadcode-baseline` 在 `test.yml|frontend` 有独立步骤，而同 job 的
  `pre-push-gate --static` 清单又含同款工具 ⇒ 一次 CI 跑两遍 knip+jscpd 全扫。真正致命的是
  **第二遍的判定上下文更差**：`YSM_DEADCODE_BASE` 只挂在那一个 step 的 `env:`，
  `pre-push-gate` 内部经 `gate-blocks/static-tools.ts` 通用调用再起一次进程，**拿不到它**；
  而 CI 跑在 push 之后、暂存区干净 ⇒ `resolveResponsibleFiles` 返回 null ⇒ 严格模式 ⇒
  **一切新增发现项无条件阻断**。实测同一 run 内「死代码基线门禁 success + 静态治理门禁 failure」，
  两步对同一个发现项给出相反结论（假红）。
- **修法（双保险，缺一不可）**：
  ① `YSM_DEADCODE_BASE` 提到 **job 级 `env:`**（step 级挂载只覆盖该 step）；
  ② `--static` 清单**剔除** `CI_INDEPENDENT_TOOLS`（`gate-blocks/schedule.ts`）声明的 CI 已独立承担项。
- **口径纪律**：剔除**只针对 CI 档（`--static`）**。`--all` / push 模式仍照跑——本地没有
  `test.yml` 的独立步骤，剔了就是真覆盖损失（`tech-debt-ledger` R1 实证：CI 静态层曾真抓到过
  `check-file-lines` 红线突破）。
- **剔除 ≠ 不查**，是「换个地方查，且那一处才带归属基线」。故护栏
  `tests/test_gate_schedule.ts` 双向锁定：每项必须在 `test.yml` 中真有独立步骤调用，
  且必须仍在 `--all`/push 清单中。

### 12. CI 是报告而非门禁（2026-10-08 决策）

- 实证：`branches/main/protection` 返回 **404 not protected**、`rulesets` 为空数组 ⇒ 仓库无任何强制
  拦截。`git push --no-verify` / `YSM_SKIP_GATE=1` 可零痕迹直推 main。
- **决策：承认 CI 在本仓是「报告」而非「门禁」**（单人直提 main 是有意工作流）。故优化方向定为
  **削减重复执行 + 把预算花在真正有价值的档位**，而非加固一道无牙的幻影门禁。
- 推论（改 workflow 时必须记住）：`test.yml` 里任何标注「远端防线」「唯一防线」的措辞都是**对
  git 行为的描述，不是对仓库状态的断言**——没有分支保护时它们不成立。新写此类注释前先核
  `gh api repos/:owner/:repo/branches/main/protection`。
- 该决策**不豁免**本卡的其余不变量：门禁仍必须自身可信（假红 = 噪声，噪声会让人忽略真红）。

### 13. Playwright 工具链 spine 抽 composite action

- `e2e` 与 `e2e-web` 的 setup 段（pnpm/node/install/浏览器缓存/apt 缓存/chromium 安装）原**逐字重复
  47 行**，含两段各 5 行的缓存坑注释。现抽 `.github/actions/playwright-spine/action.yml`
  （与 `release.yml` 的 `release-toolchain` 同范式：GHA 不支持 YAML 锚点，composite 是唯一合规 DRY）。
- **动机不只是行数**：缓存 key 是**单点**——原先改一次要改两处，改漏一处**不报错**，
  只让其中一个 job 静默全 miss（§7 那条「key 必须钉 playwright-core 版本」的经验正悬在这个风险上）。
- 两 job 的差异只剩 `playwright config`（`--config playwright.web.config.ts`）与各自报告上传；
  类型检查仍只在 `e2e` 跑（双套件同域，不重复）。

## 不变量（YAML 只留这一层，复盘见上）

1. `setup-go` 一律 `cache: false`（Linux/Windows 皆然）。
2. 基线类 fetch 一律**不带 `--depth=1`**（配合 `fetch-depth: 0`）。
3. Playwright/apt 缓存步在 `pnpm install` **之后**；apt path 仅 `*.deb` + 前置 `chmod`。
4. go-analysis 用 `GOOS=windows` + `CGO_ENABLED=0` 跨平台 lint；覆盖率两件套留 Windows。
5. 版本双源（go.mod↔WAILS、ripgrep 内联 SHA）必须有守卫。
6. 契约 job 不装前端依赖（无 cache:pnpm）。
7. 每 job 显式 `timeout-minutes`；e2e / e2e-web `needs: contracts`。
8. 事故复盘写本卡；YAML 注脚只留一行不变量 + 「详见 ci-tuning」。
9. **同一 job 内同一工具只有一个执行点**：CI 已独立承担的项从 `--static` 清单剔除
   （`CI_INDEPENDENT_TOOLS`），其归属基线（`YSM_DEADCODE_BASE` 等）挂 **job 级 `env:`**。
10. CI 的 Playwright 工具链走 `./.github/actions/playwright-spine`（e2e / e2e-web 共用，
    缓存 key 单点）。

## 与其他子系统关系

- 门禁链全景见 `gate-chain-map`；golangci-lint 本地口径见 `golangci-lint`；pre-push 逃生阀/债务策略见
  `pre-push-gate`（含「本地 PASS ≠ CI 绿」推论：CI 单独跑且非零退出的检查项，debt 策略救不了它）。
