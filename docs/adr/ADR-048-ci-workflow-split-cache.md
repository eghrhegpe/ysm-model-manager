# ADR-048：CI 工作流架构：双 workflow 拆分 + 可复用测试门禁 + 三层缓存 + 版本单点

- **状态**：已采纳（Accepted）
- **日期**：2026-08-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`.github/workflows/{ci,release,test}.yml; docs/releases/release-process.md; 仓库级 Variables（GO_VERSION/NODE_VERSION/WAILS_VERSION）`

---

## 1. 背景（Context）

v1.11.0 全平台矩阵发版（ADR-046 落地）后，CI 暴露三个问题：

1. **测试重复执行**：`release.yml` 的 `on.push` 同时匹配 `branches: [main]` 与 `tags: ['v*']`——推 main 与推 tag 是**两个独立 push 事件**（GitHub Actions 逐 ref 触发），每次发版 test 门禁（约 3 分钟）跑两遍。
2. **版本多源维护**：`GO_VERSION` / `WAILS_VERSION` 硬编码在 release.yml；`NODE_VERSION` 硬编码在 pages-deploy.yml——升级一个版本要翻多个文件。
3. **零缓存 + Node 20 弃用**：4 平台每次 `go install wails3@...` 重新下载模块并编译（`go: downloading github.com/wailsapp/wails/v3`）；setup-go 默认缓存基于项目 `go.sum`，**覆盖不到 `go install @version` 的模块**。同时 `actions/checkout@v4` / `setup-go@v5` / `setup-node@v4` / `upload-artifact@v5` 跑在 node20，GitHub 弃用警告 7 job 全有。

## 2. 决策（Decision）

### 2.1 双 workflow 拆分（消除重复 run）

```
test.yml（on: workflow_call）── 测试门禁单一实现（含 helper embed 前置、三层缓存）
   ├─ ci.yml（on: push main / pull_request / dispatch）  → 调用 test.yml
   └─ release.yml（on: push tag / dispatch）             → 调用 test.yml + Prepare + 4 平台打包 + Release
```

- main push / PR 只触发 `ci.yml`；tag push 只触发 `release.yml`——**测试各跑一次**。
- 打包 job `needs: [prepare, test]`（原 `needs: prepare`）：发版必过测试门禁才打包，杜绝"test 失败但 Release 已上传"。

### 2.2 版本单点：仓库级 Variables

`GO_VERSION` / `NODE_VERSION` / `WAILS_VERSION` 全部移入 GitHub 仓库级 Variables，3 个 workflow 一律 `$&#123;&#123; vars.* &#125;&#125;` 引用。版本号唯一入口 = Settings → Secrets and variables。

### 2.3 三层缓存（actions/cache@v5.1.0，node24）

| 层 | key | 覆盖 |
|----|-----|------|
| Go 模块 | `go-mod-$&#123;&#123;runner.os&#125;&#125;-$&#123;&#123;env.WAILS_VERSION&#125;&#125;-$&#123;&#123;hashFiles('**/go.sum')&#125;&#125;`（restore-keys 两级放宽）| wails3 模块 + 项目依赖免下载 |
| wails3 二进制 | `wails3-$&#123;&#123;runner.os&#125;&#125;-$&#123;&#123;env.WAILS_VERSION&#125;&#125;` | `go install` 免编译（`command -v wails3` 跳过）|
| npm | setup-node `cache: npm` + `cache-dependency-path: frontend/package-lock.json` | `npm ci` 免重下载 |

- key 含 `runner.os`：四平台缓存互相隔离，防止误恢复。
- wails3 安装步骤统一 `shell: bash` + `command -v` 跳过——Windows/Android（默认 pwsh）兼容。

### 2.4 actions 升级到 node24

`checkout@v5` / `setup-go@v6` / `setup-node@v5` / `upload-artifact@v6` / `download-artifact@v6` / `cache@v5.1.0`。

> ⚠️ 踩坑记录：`setup-go@v5` 与 `upload-artifact@v5` **默认仍是 node20**（官方 v5 未完全迁移），必须升 v6；只有 `checkout@v5` / `setup-node@v5` 是 node24。

## 3. 后果（Consequences）

**正面：**
- main/tag 双 run 消除，测试不再重复计算。
- 发版门禁增强：test 不过不打包。
- v1.11.1 发版实测：Windows/Android Go 缓存命中（之前 run 预热），Linux/macOS 首次建立、下次全命中；ANNOTATIONS 零警告。
- 版本升级一处改（仓库变量），三个 workflow 六处生效。

**负面 / 成本：**
- 打包 job 增加 `needs: test`，发版总时长 +约 3 分钟（test 串行前置）。
- 首次构建多 2 个 `actions/cache` 步骤（约 15s 开销），wails3 模块首个平台首次下载仍需一次。

**已知遗留：**
- `ADR-009` 编号空缺（既有登记表问题，非本 ADR 引入）。
- Release body 仍为 softprops 占位文本，需 `gh release edit` 补 notes（v1.10.0/v1.11.x 实测流程，SOP 已记录）。

## 4. 数据溯源

来源 → 结果：
- 触发模型（推分支/推 tag 各一次 run）→ 双 workflow 拆分（ci/release/test）。
- v1.11.1 发版 run `31323285840`：7 job 全绿、零警告；Prepare 校验（config.yml=1.11.1）通过；Windows/Android `go-mod` 缓存 hit、Linux/macOS 首次 miss（已建缓存）。
- v1.11.1 Release 资产：zip + APK + darwin + linux + SHA256SUMS，非 draft。
