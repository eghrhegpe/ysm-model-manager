# YSM-Model-Manager 发版程序（Release Process）

> **作用**：本文件是人类操作视角的发版标准作业程序（SOP）。机器视角见 `.github/workflows/release.yml`，版本发布说明见同目录 `vX.Y.Z.md`。
> **单一事实源**：版本号无 json 事实源，以 **tag 名**（`vX.Y.Z`）为准；`build-release.ps1` 参数、CI `github.ref_name`、notes 文件名三处必须与此一致。
> **平台范围**：仅 Windows（单 exe + `ysm-cli.exe` + 更新助手，打包为 zip）。Linux/macOS/Android 分支在本仓库不存在。

---

## AI 一键发版入口

> **给 AI 用**：下面 §2 的 9 步已被封装为 `scripts/release.ps1`，幂等可跑。
> AI 接到发版请求时，**先读本节**，再决定是直接调脚本还是按 §2 手动走。

### 快速用法

```powershell
# 演练（只打印不执行，确认流程无误）
.\scripts\release.ps1 -Version 1.9.4 -DryRun

# 正式发版（校验 notes → 提交 → 推 main → 打 tag → 监控 CI → 核对 Release）
.\scripts\release.ps1 -Version 1.9.4
```

### 脚本不替你做的事（需 AI 或人类补）

| 事项 | 原因 | 谁来补 |
|------|------|--------|
| 写 `docs/releases/vX.Y.Z.md` | 创意性写文档，无法模板化 | AI 跑 `node scripts/release-notes-gen.mjs` 收集数据后按既有 `v1.9.3.md` 格式写 |
| 应用内版本核对 | 需启动应用读「关于」页 | 人类或 E2E |
| 本地构建自检 | 可选步骤，`build-release.ps1` 已独立存在 | AI 跑 `.\cmd\build-release.ps1 vX.Y.Z -SkipUpload` |

### 与本文件各节的对应关系

| 脚本步骤 | 对应文档章节 |
|----------|-------------|
| step 2（校验 notes 存在） | §2 步 2、§4 发布说明约定 |
| step 3（提交+推 main） | §2 步 3 |
| step 4（打 tag） | §2 步 4、§3 版本一致性 |
| step 5（监控 CI） | §2 步 5 |
| step 6（核对 Release） | §2 步 6、§5 回滚/补发 |

---

## 0. 触发机制总览

| 触发方式 | 入口 | 行为 |
|----------|------|------|
| 推 tag | `git push origin vX.Y.Z` | `release.yml` 先跑 test job（契约测试/Go vet+test/前端 typecheck+vitest+vite build）→ release job 打包 zip + SHA256SUMS → 建 GitHub Release |
| 本地自检 | `.\cmd\build-release.ps1 vX.Y.Z [-SkipUpload]` | 本地 8 步构建产物到 `build\release\`；`-SkipUpload` 只构建不上传 |
| 写发版说明 | `node scripts/release-notes-gen.mjs` | 收集 git 提交数据，供写 `docs/releases/vX.Y.Z.md` 参考 |

产物：`build/release/YSM-Model-Manager_windows_amd64.zip`（含主 exe + `ysm-cli.exe` + 更新助手）+ `SHA256SUMS`。

---

## 1. 前置条件

### 1.1 依赖与版本
- Go `1.24`（CI 固定；`wails/v3` 版本从 `go.mod` 动态读取，禁写死 `@latest`）。
- Node `22`、`npm ci` 基于 `frontend/package-lock.json`。
- Wails v3 CLI：本地需 `go install github.com/wailsapp/wails/v3/cmd/wails3@<go.mod 中版本>`。
- `gh` CLI：上传 GitHub Release 用（`build-release.ps1` 优先走 gh，退回 GH_TOKEN 环境变量）。
- Task（Wails v3 构建脚手架）：CI 用 `go install github.com/go-task/task/v3/cmd/task@latest`；本地 `task package` 需此。

### 1.2 Secrets
| Secret | 用途 |
|--------|------|
| `GITHUB_TOKEN` | runner 自动提供，建 Release + 上传资产 |

> 本项目无 Android 签名、无跨平台缓存预热，Secret 列表极简。

---

## 2. 标准发版步骤（9 步）

> 可一步到位执行的命令序列见附录 §8。

1. **定版本号**：按 semver 决定 `X.Y.Z`（参考 `git tag --list "v*" --sort=-version:refname` 最新值）。

2. **写发布说明**：
   - （可选）`node scripts/release-notes-gen.mjs` 收集 git 提交数据，供参考。
   - 手写 `docs/releases/vX.Y.Z.md`（格式参考既有 `v1.9.3.md`）。
   - ⚠️ **路径大小写敏感**：`docs/releases/`（小写 `releases`）。`build-release.ps1:143` 读 `docs\releases\$VerTag.md`，写错大小写在 Windows 上可能命中但 CI（Linux runner 如果未来引入）不会命中。

3. **提交发布说明**：
   ```bash
   git add docs/releases/vX.Y.Z.md
   git commit -m "docs: add vX.Y.Z release notes"
   git push origin main
   ```

4. **打 tag 触发**：
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

5. **等 CI 完成**：`gh run list --workflow release.yml --limit 3` 监控进度。两个 job 全绿：
   - **test job**：契约测试（`tests/*.mjs`）→ 构建 `ysm-updater-helper.exe`（embed 前置）→ `go vet` → `go test` → 前端 `npm ci` → `tsc --noEmit` → `vitest run` → `vite build`。
   - **release job**（仅 tag 触发）：`go install task` → `task package`（Taskfile → `build/windows/package`）→ 上传 zip + SHA256SUMS 到 GitHub Release。

6. **核对 Release**：
   - 到 `https://github.com/eghrhegpe/ysm-model-manager/releases/tag/vX.Y.Z` 确认 zip + SHA256SUMS 齐全、body 为手写 notes（非占位文本 `YSM Model Manager vX.Y.Z`）。
   - 若 body 不对：`gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md` 修正（无需重跑 CI）。
   - 应用内「检查更新」应显示真实版本（`go/version.Version` 由 ldflags 注入 `$VerTag`，默认 `dev`）。

---

## 3. 版本一致性（重要）

- **版本号无单一 json 事实源**：`build-release.ps1` 用 `-Version` 参数、CI 用 `github.ref_name`（tag 名）、notes 文件名用 `vX.Y.Z.md`。
- **操作者必须保证**：`build-release.ps1` 参数 / tag 名 / notes 文件名三处的 `X.Y.Z` 完全一致（`v` 前缀统一）。
- **版本注入路径**：
  | 产物 | 注入方式 | 代码位置 |
  |------|----------|----------|
  | 主程序 | `go build -ldflags "-X ysm-model-manager/go/version.Version=$VerTag"` | `cmd/build-release.ps1:79`、`release.yml` `task package` 步 |
  | CLI 工具 | 同上，`-tags cli` | `cmd/build-release.ps1:93` |
  | 更新助手 | 同上，编译到 `go/updater/ysm-updater-helper.exe` | `cmd/build-release.ps1:57` |
- **默认值**：未注入时 `go/version.Version = "dev"`（`go/version/version.go:6`）。若应用内显示 `dev`，说明 ldflags 注入失败。

---

## 4. 发布说明约定

- 路径：`docs/releases/vX.Y.Z.md`（小写 `releases`，文件名带 `v` 前缀与 tag 一致）。
- `build-release.ps1` 上传时**优先用该文件作 Release body**（`build-release.ps1:143-151`）；缺失则用默认占位文本 `YSM Model Manager $VerTag`。
- CI 侧 `softprops/action-gh-release@v2` 上传 zip + SHA256SUMS，body 由 `build-release.ps1` 已写入（若走 CI 路径，body 为空，需 `gh release edit` 补）。
- 应用内更新日志：`go/updater` 的 `Check` 聚合 GitHub Release `body`（`UpdateInfo.ReleaseNotes`），展示未读版本日志。
- **历史 `vX.Y.Z-compare.md` 双文件模式（v1.0.2 ~ v1.7.0）为早期遗留，不再新增**；新版本只产出单一 `vX.Y.Z.md`。

---

## 5. 回滚 / 补发

- **产物可复用，仅 body 有误**：直接 `gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md`，无需重跑 CI。
- **需重新构建**：修正代码后，必须 **删除旧 tag 并重建同名 tag** 才能复触发：
  ```bash
  git tag -d vX.Y.Z && git push origin :vX.Y.Z
  # 修正代码，提交
  git tag vX.Y.Z && git push origin vX.Y.Z
  ```
- **撤销已发布 Release**：GitHub 删除 Release 即可，tag 可保留或同步删除；不涉及代码回退时无需 revert commit。

---

## 6. 发版验证清单

### 发版前
- [ ] 版本号 `X.Y.Z` 已定，与既有 tag 无冲突。（§2 步 1）
- [ ] `docs/releases/vX.Y.Z.md` 已手写并提交（路径确认小写 `releases`）。（§2 步 2-3）
- [ ] （可选）本地 `.\cmd\build-release.ps1 vX.Y.Z -SkipUpload` 构建通过。（§0 本地自检）

### 发版中
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z` 已执行。（§2 步 4）
- [ ] `gh run list --workflow release.yml` 两个 job（test + release）全绿，无 `go vet` / `tsc` 报错。（§2 步 5）

### 发版后
- [ ] GitHub Release 已建，zip + SHA256SUMS 齐全。（§2 步 6）
- [ ] Release body 为手写 notes（非占位文本 `YSM Model Manager vX.Y.Z`）。（§2 步 6；不符则 `gh release edit`）
- [ ] 应用内「检查更新」显示真实版本（非 `dev`）。（§3 版本注入路径）

---

## 7. 常见坑

| 坑 | 现象 | 根因 | 对策 |
|----|------|------|------|
| notes 路径写错 | Release body 变占位文本 | `build-release.ps1:143` 读 `docs\releases\vX.Y.Z.md`，曾误写 `release-notes\` 单数 | 确认 `docs/releases/` 小写路径存在该文件 |
| tag 触发失效 | 推 tag 后 CI 不跑 | `release.yml` `on.push` 曾只限 `branches: [main]`，缺 `tags: ['v*']`（已修） | 确认 workflow 的 `on.push.tags` 存在 |
| 版本号不一致 | 产物「关于」版本与 tag 不符 | 三处（参数/tag/notes）版本号手改不一致 | 统一 `X.Y.Z` 三处一致；用 `scripts/release.ps1` 自动化 |
| 依赖更新后 CI 失败 | test job 挂 | Go/Node 依赖与 lockfile 不同步 | 先本地 `go build ./go/...` + 前端 `npx tsc --noEmit` 再发版 |
| `ysm-updater-helper.exe` 缺失 | `go vet`/`go build` 报 embed 找不到文件 | 该文件由 `cmd/updater/main.go` 编译生成，被 `.gitignore(*.exe)` 忽略，CI checkout 不含 | CI 已在 test job 前构建（`release.yml:37-38`）；本地跑 `go build -o "go/updater/ysm-updater-helper.exe" "./cmd/updater"` |
| ldflags 注入失败 | 应用内显示 `dev` | `-ldflags "-X ysm-model-manager/go/version.Version=$VerTag"` 路径写错 | 确认包路径 `ysm-model-manager/go/version.Version` 与 `go.mod` module 名一致 |
| 契约测试修改测试文件 | CI 挂 | `tests/*.mjs` 禁止修改（`release.yml:26-30`） | 只改实现，不改测试 |

---

## 8. 发版快速命令序列

一行接一行执行，按需跳步。

> ⚠️ **跨平台坑**：本项目主开发环境为 Windows PowerShell，下方命令以 PowerShell 为主。`sed`/`grep` 等 Unix 命令在 Git Bash 可用，但 tag 推送、`gh` 调用建议用 PowerShell 原生语法。

### Windows PowerShell（本项目主开发环境）

```powershell
$VER = "1.9.4"   # ← 改成实际版本号

# 步骤 2：写 notes（可选：先用生成器收集 git 数据）
node scripts/release-notes-gen.mjs
# 手写 docs/releases/v$VER.md（格式参考 v1.9.3.md）

# 步骤 3：提交 + 推 main
git add docs/releases/v$VER.md
git commit -m "docs: add v$VER release notes"
git push origin main

# 步骤 4：打 tag 触发 CI
git tag v$VER
git push origin v$VER

# 步骤 5：监控 CI（阻塞至 test + release 两 job 完成）
gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')

# 步骤 6：核对 Release
gh release view v$VER --json body,tagName,assets --jq '{tag: .tagName, body: (.body[0:80]+"..."), assets: (.assets | length)}'
# 若 body 不对（占位文本或空）：
gh release edit v$VER --notes-file docs/releases/v$VER.md
```

### 本地自检（可选，CI 前跑）

```powershell
# 本地 8 步构建到 build\release\，不上传
.\cmd\build-release.ps1 v1.9.4 -SkipUpload

# 或调 scripts/release.ps1 的 DryRun 演练
.\scripts\release.ps1 -Version 1.9.4 -DryRun
```

---

*SOP 骨架移植自 MikuMikuAR `docs/releases/release-process.md`，裁剪三平台/缓存/签名部分，对齐 YSM-Model-Manager 单平台 Windows 发布的实际机制。*
