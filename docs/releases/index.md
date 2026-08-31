# 发版说明索引

> 发版说明按 `vX.Y.Z.md` 命名存放于本目录。
> **历史 `vX.Y.Z-compare.md` 双文件模式（v1.0.2 ~ v1.5.8）为早期遗留，不再新增**；新版本只产出单一 `vX.Y.Z.md`。
> 完整版本清单以 `git tag --list "v*" --sort=-version:refname` 为准。

<!-- GEN: releases-index -->
## 最近版本

| 版本 | 说明 |
|------|------|
| [v1.14.0](v1.14.0.md) | — |
| [v1.13.2](v1.13.2.md) | — |
| [v1.13.1](v1.13.1.md) | — |
| [v1.13.0](v1.13.0.md) | — |
| [v1.12.0](v1.12.0.md) | — |
| [v1.11.1](v1.11.1.md) | — |
| [v1.11.0](v1.11.0.md) | — |
| [v1.10.0](v1.10.0.md) | — |

## 版本全览（按大版本）

| 大版本 | 发布记录 |
|--------|----------|
| v1.0 | v1.0.0 ~ v1.0.9 |
| v1.1 | v1.1.0 |
| v1.2 | v1.2.0 |
| v1.3 | v1.3.0 ~ v1.3.6 |
| v1.4 | v1.4.0 ~ v1.4.7 |
| v1.5 | v1.5.0 ~ v1.5.9 |
| v1.6 | v1.6.0 ~ v1.6.9 |
| v1.7 | v1.7.0 ~ v1.7.13 |
| v1.8 | v1.8.0 ~ v1.8.11 |
| v1.9 | v1.9.0 ~ v1.9.3 |
| v1.10 | v1.10.0 |
| v1.11 | v1.11.0 ~ v1.11.1 |
| v1.12 | v1.12.0 |
| v1.13 | v1.13.0 ~ v1.13.2 |
| v1.14 | v1.14.0 |
<!-- /GEN: releases-index -->

---

# YSM Model Manager 发版 SOP

> **一句话发版**：写 notes → 打 tag → 推 tag 等 CI 打包上传 → 核对 Release。本地自检用 `build-release.ps1`。
> **完整 SOP 以 [release-process.md](release-process.md) 为准**（含 AI 一键发版入口 `scripts/release.ps1`、`build/config.yml` 版本单点校验、四平台打包矩阵与 Secrets）；本节为裁剪摘要，细节冲突以 release-process.md 为准。

## 0. 触发机制总览

| 触发方式 | 入口 | 行为 |
|----------|------|------|
| 推 tag | `git push origin vX.Y.Z` | `release.yml` 先跑 test job（契约测试/Go/前端）→ release job 打包 zip + SHA256SUMS → 建 GitHub Release |
| 本地自检 | `.\cmd\build-release.ps1 vX.Y.Z` | 本地构建产物到 `build\release\`（`-SkipUpload` 只构建不上传） |
| 写发版说明 | `node scripts/release-notes-gen.mjs` | 收集 git 提交数据，供写 `docs/releases/vX.Y.Z.md` 参考 |

产物：`build/release/YSM-Model-Manager_windows_amd64.exe`（裸 exe，v1.13.0 起不再打包 zip）+ `SHA256SUMS`。数据（resource_types/creators/workshop 系列）编译期内嵌，下载单个 exe 即具备全部数据能力；用户可编辑数据与配置在 `%APPDATA%/YSM-Model-Manager`（自动生成/迁移）。

## 1. 前置条件

- **本地构建**：`wails3` CLI 在 PATH（`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`）、Go 1.24+、Node 22+、`gh` CLI（上传用）。
- **CI**：无需配置（`GITHUB_TOKEN` runner 自动提供）；tag 触发已配置（`release.yml` `on.push.tags: ['v*']`）。

## 2. 标准发版步骤（9 步）

1. **定版本号**：semver `X.Y.Z`（参考 `git tag --list "v*" --sort=-version:refname` 最新值）。
2. **写发布说明**：`node scripts/release-notes-gen.mjs` 收集 git 数据 → 手写 `docs/releases/vX.Y.Z.md`（格式参考既有 `v1.9.3.md`；**路径小写 `releases`**，CI 按此路径查找）。
3. **提交发布说明**：`git add docs/releases/vX.Y.Z.md && git commit -m "docs: add vX.Y.Z release notes" && git push origin main`。
4. **打 tag 触发**：`git tag vX.Y.Z && git push origin vX.Y.Z`。
5. **等 CI 完成**：`gh run list --workflow release.yml --limit 3` 监控；test job 与 release job 全绿。
6. **核对 Release**：到 GitHub Releases 页确认 zip + SHA256SUMS 齐全、body 为手写 notes（build-release.ps1 上传时自动读取 `docs/releases/vX.Y.Z.md`；CI 侧 `softprops/action-gh-release` 上传）。
7. **body 修正**（如不对）：`gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md`，无需重跑 CI。
8. **应用内核对**：更新器「检查更新」显示真实版本（`go/version.Version` 由 ldflags 注入 `$VerTag`）。

> **本地自检**（可选，CI 前）：`.\cmd\build-release.ps1 vX.Y.Z -SkipUpload` → 构建 8 步（绑定生成 → 前端构建 → 更新助手 → 代码生成 → 主程序 → CLI）→ 核对 `build\release\` 产物。

## 3. 版本一致性（重要）

- **版本号无单一 json 事实源**：`build-release.ps1` 用 `-Version` 参数、CI 用 `github.ref_name`（tag 名）。
- **操作者必须保证**：`build-release.ps1` 参数 / tag 名 / notes 文件名三者的 `X.Y.Z` 完全一致（`v` 前缀统一）。
- 版本注入：`go build -ldflags "-X ysm-model-manager/go/version.Version=$VerTag"`（主程序 / CLI / 更新助手三处）。

## 4. 发布说明约定

- 路径：`docs/releases/vX.Y.Z.md`（小写 `releases`，文件名带 `v` 前缀与 tag 一致）。
- 本地 `build-release.ps1` 上传时**优先用该文件作 Release body**；缺失则用默认占位文本（`YSM Model Manager vX.Y.Z`）。
- 应用内更新日志：`go/updater` 的 `Check` 聚合 GitHub Release `body`（`UpdateInfo.ReleaseNotes`），展示未读版本日志。

## 5. 回滚 / 补发

- **产物可复用**：直接编辑 GitHub Release body / 重新上传资产，无需重跑 CI。
- **需重新构建**：修正后 `git tag -d vX.Y.Z && git push origin :vX.Y.Z` 删旧 tag，再重新打 tag 推送（同名 tag 重推复用 CI 缓存，但代码变更必触发新构建）。
- **撤销 Release**：GitHub 删除 Release 即可；tag 可保留或同步删除。

## 6. 发版验证清单

### 发版前
- [ ] 版本号 `X.Y.Z` 已定，与既有 tag 无冲突
- [ ] `docs/releases/vX.Y.Z.md` 已手写并提交（路径确认小写 `releases`）
- [ ] （可选）本地 `build-release.ps1 vX.Y.Z -SkipUpload` 构建通过

### 发版中
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z` 已执行
- [ ] `gh run list --workflow release.yml` 两个 job 全绿

### 发版后
- [ ] GitHub Release 已建，zip + SHA256SUMS 齐全
- [ ] Release body 为手写 notes（非占位文本）
- [ ] 应用内「检查更新」显示真实版本

## 7. 常见坑

| 坑 | 现象 | 根因 | 对策 |
|----|------|------|------|
| notes 路径写错 | Release body 变占位文本 | `build-release.ps1` 读 `docs\releases\vX.Y.Z.md`（曾误写 `release-notes\` 单数） | 确认 `docs/releases/` 小写路径存在该文件 |
| tag 触发失效 | 推 tag 后 CI 不跑 | `release.yml` `on.push` 曾只限 `branches: [main]`，缺 `tags: ['v*']`（已修） | 确认 workflow 的 `on.push.tags` 存在 |
| 版本号不一致 | 产物「关于」版本与 tag 不符 | 三处（参数/tag/notes）版本号手改不一致 | 统一 `X.Y.Z` 三处一致 |
| 依赖更新后 CI 失败 | test job 挂 | Go/Node 依赖与 lockfile 不同步 | 先本地 `go build ./go/...` + 前端 `npx tsc --noEmit` 再发版 |
| 四段补丁号 | 版本写成 `v1.0.8.1` 这种 `X.Y.Z.W` | 早期一次性补丁命名（仅 v1.0.8.1 一例遗留） | 只用三段 `vX.Y.Z`，四段补丁号不再使用 |

## 8. 快速命令序列

```bash
VER="X.Y.Z"  # ← 改成实际版本号

# 写 notes（可选：先用生成器收集 git 数据）
node scripts/release-notes-gen.mjs
# 手写 docs/releases/v$VER.md

# 提交 + 推 main
git add docs/releases/v$VER.md
git commit -m "docs: add v$VER release notes"
git push origin main

# 本地自检（可选）
.\cmd\build-release.ps1 v$VER -SkipUpload

# 打 tag 触发 CI
git tag v$VER && git push origin v$VER

# 监控 + 核对
gh run list --workflow release.yml --limit 3
gh release view v$VER --json body,tagName,assets --jq '{tag: .tagName, body: (.body[0:80]+"..."), assets: (.assets | length)}'
```

---

*本索引由人工维护（后续接入 release-notes-gen 自动更新）。SOP 骨架移植自 MikuMikuAR `docs/releases/release-process.md`，裁剪三平台/缓存/签名部分。*
