---
kind: scripts_jscpd_go
name: Go 端 jscpd 重复检测脚本
tier: architecture
category: config
source_files:
  - scripts/jscpd-go.mjs
use_when:
  - jscpd
  - go 重复代码
  - 复制粘贴检测
  - duplicate
  - 重复对
  - 增量门禁
  - 新增重复
  - 独立 baseline
---

# Go 端 jscpd 重复检测脚本

## 概览

`scripts/jscpd-go.mjs` 是 Go 端复制粘贴检测工具：调用复用前端的 jscpd v5（Rust 内核）二进制，扫描 `./go/**/*.go`，与独立 baseline `scripts/baseline/jscpd-go-baseline.json` 比对，只拦「新增重复对」。与前端 `deadcode-baseline.json` 的 `jscpd` 数组零耦合，属治理/门禁类（config）脚本。接入决策见 `docs/adr/ADR-135-go-jscpd.md`。

## 核心职责

- **扫描**：复用 `frontend/node_modules/jscpd/run-jscpd.js`，`--pattern ./go/**/*.go --format go --no-gitignore`，排除 `upstream/` vendor、`rust-core/target` 编译产物、前端 `.ts`。
- **比对**：json reporter 产物（顶层 `duplicates[]`，每元素 `firstFile.name`/`secondFile.name`，Windows `\` 分隔）归一化为 `A#B` POSIX 文件对，与 baseline `clones[]` 集合差集。
- **门禁**：新增对 → exit 1；无新增 → exit 0；无 baseline → exit 2。`--update` 将当前对冻结写 baseline。
- **契约**：`--json` 输出 `{"_summary":{ok,issues,added,fixed,baseline,current}}` 供 `pre-push-gate.mjs` 的 `runTools` 解析（rc 判定兜底）。

## 对外 API / 入口

```bash
node scripts/jscpd-go.mjs            # 门禁:有新增重复对 → exit 1
node scripts/jscpd-go.mjs --update   # 冻结当前债务 / 治理后收紧
node scripts/jscpd-go.mjs --json     # _summary 契约(JSON 模式)
node scripts/jscpd-go.mjs --verbose  # 打印 jscpd statistics 明细
```

- 退出码：0（通过/已更新）/ 1（门禁失败：新增重复对）/ 2（未找到 baseline）。

## 与其他子系统关系

- `scripts/pre-push-gate.mjs`：`GO_STATIC_TOOLS` + `ALL_STATIC_TOOLS` 均登记 `jscpd-go.mjs`（单一实现源，`doctor --all` 与真实 `git push` 双路径生效）。
- `scripts/baseline/jscpd-go-baseline.json`：Go 重复账本（生成物，首版 174 对），由手写 `--update` 维护，pre-commit 的 `GEN_CMDS` 不覆盖。
- `scripts/baseline/deadcode-baseline.json`：**绝不写回**其 `jscpd` 段，前端 78 条基线零污染、零重洗。
- `check-deadcode-baseline.mjs`：前端 jscpd 门禁，与本工具平行、互不相交。

## 不变量

- **范围锁死**：只扫 `./go/**/*.go`，不碰 `upstream/`/`rust-core/`/`frontend/`——跨语言混 baseline 不可维护（否决方案③）。
- **增量不惩罚存量**：baseline 冻结现状，只拦新增；存量重复靠 `--update` 治理后收紧，不阻断推送。
- **独立账本**：baseline 文件独立、格式仿前端但路径不回写前端；前端/Go/rust 三账本分离演进，rust 账本待 poc 出后单开（方案②思路）。
- **脚本卫生合规**：纯 bool flag（`process.argv.includes('--flag')`），不消费 positional，属 `scripts_argv.md` 豁免（无需迁 `parse-args`）；文件头 JSDoc 满足 `check-script-hygiene` 5 字段（文件名+描述/依赖/用法/退出码/设计意图）。

## 相关

- `scripts/jscpd-go.mjs`（本卡 source）
- `scripts/pre-push-gate.mjs`（门禁挂载）
- `scripts/baseline/jscpd-go-baseline.json`（Go 账本）
- `scripts/baseline/deadcode-baseline.json`（前端账本，零耦合）
- `docs/adr/ADR-135-go-jscpd.md`（接入决策）
