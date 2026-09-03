# ADR-033：更新包下载截断检测与版本比较加固

- **状态**：✅ 已采纳
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/updater/updater.go, frontend/src/features/version-updater.ts`

---

## 1. 背景（Context）

自动更新模块（`go/updater` + `version-updater.ts`）审核发现五个缺陷：

1. **下载截断静默**：`Download` 的 500MB `LimitReader` 截断不报错——`expectedHash` 为空（SHA256SUMS 拉取失败）时截断更新包会被直接接受并装盘；
2. **API 错误不可读**：`Check` 无 `resp.StatusCode` 检查，GitHub 403（rate limit）的错误体 JSON 解到 `[]Release` 失败，返回误导性 Decode 错误；
3. **多段版本比较错误**：`splitVer` 用 `SplitN(s, ".", 4)` 截断，`1.2.3.4.5` 第 4 段变 `"4.5"`，Atoi 失败归零成 `[1,2,3,0]`；
4. **CLI 不随更新落地**：核对 `cmd/build-release.ps1` 确认发布 zip = 主 exe + `ysm-cli.exe` + 4 个 JSON（前端资源 go:embed 进 exe，不进 zip），但 `InstallUpdate` 的覆盖分支漏掉 `ysm-cli.exe`；
5. **前端频次与职责说明**：`checkUpdateSilent` 在请求**前** `markChecked`（检查失败也计入 6h 频次）；`doUpdate` 中 `RestartApplication` 实际不可达（Go 侧 `InstallUpdate` 末尾 `os.Exit(0)` 已终止进程，更新助手负责替换重启），易误导维护者。

## 2. 决策（Decision）

1. **Download 防护加固**：沿用既有 500MB 网络流限长（`io.LimitReader(resp.Body, 500<<20)`，属网络流通用语义，ADR-033 前已存在）+ **新增** Content-Length 预检超限直接拒绝（省流量、防磁盘写满）+ **新增**读满后再读 1 字节的截断检测（无 Content-Length 的分块传输兜底）——预检或探测命中即删文件报错（`LimitReader` 自身不报错，触发删文件的是其后探测读，二者非并列「命中」层）；
2. **Check 显式状态码**：非 200 时读取受限 body 解析 GitHub 错误 `message`，给出可读提示（如 rate limit）；
3. **splitVer 全段解析**：`strings.Split` 替代 `SplitN` 4 段截断；脏 tag 防御（Atoi 失败 → 0，恒不误触发）行为不变，测试锁定；
4. **`ysm-cli.exe` 纳入 `alwaysOverwrite`**：zip 内含则随更新覆盖（zip 不含时循环自然跳过，安全）；
5. **前端**：`markChecked` 移到 `CheckUpdate` 成功之后（失败不阻塞下次启动重试）；`RestartApplication` 保留作防御并注释说明真实职责链（helper 替换 exe 并重启新进程）。

## 3. 后果（Consequences）

**正面**：

- 截断/超限更新包不再被装盘（三种检测路径全覆盖）；
- rate limit / API 错误可读；多段版本比较正确（新增测试用例锁定）；
- CLI 工具随 GUI 更新同步落地；
- 检查失败不占频次，下次启动可重试。

**负面 / 已知遗留**：

- `Check` 依赖 GitHub API，URL 硬编码无注入点，错误路径无集成单测（本地单测覆盖 `fetchExpectedHash` / `Download` 等可注入部分）；
- 非 Windows 平台 `assetPattern` 返回 `.tar.gz` 但 `InstallUpdate` 仅 `zip.OpenReader` 解压——跨平台装包不支持（项目以 Windows 桌面为主，未处理，记录在案）；
- 更新重启依赖 embed 的 `ysm-updater-helper.exe`（构建脚本 `cmd/build-release.ps1` 生成，需随源码管理）；
- `RestartApplication` 保留为防御性代码（不可达但有注释说明）。

## 4. 数据溯源

- **来源**：更新器模块审核报告（2026-08-04）——P2 下载截断静默 / P2 覆盖范围（经发布流程核对后收敛为 ysm-cli.exe 遗漏）/ P3 API 错误不可读 / P3 多段版本截断 / P4 频次时机；
- **决策落地**：commit `a8e43efe`（`fix(updater): 下载截断检测与版本比较加固`）+ `0fc54416`（`fix(updater): 检查更新频次时机与重启职责说明`）；ADR-033~035 补录提交 `57a50456`；
- **验证**：`go build ./go/... ./internal/app/...` 通过；`go test ./go/updater/` 10/10 PASS（新增 Download 正常/hash 不符/Content-Length 超限 + 多段版本用例）；前端 `npm run typecheck` 通过。

<!-- 文件名: updater-download-truncation-version-compare.md → 实际文件 ADR-033-updater-download-truncation-version-compare.md -->
