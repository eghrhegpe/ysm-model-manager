# R30 审核：go/updater + go/importer（两模块并行）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 2 explore 子代理｜状态：⏳ 修复闭环中
> 前置：R26 installer+recycle+download / R27 sync+dedup / R28 cli+litematic / R29 ysm+geometry

## 范围与岔开依据

**审核**（两模块并行，single 深度，只读）：

| 模块 | 非测试文件 | 规模 | 前置审核 |
|---|---|---|---|
| updater | 3 个（updater.go 615 行 + updater_windows.go 21 行 + updater_other.go 14 行） | 650 行 | 无 R 级系统审核 |
| importer | 3 个（importer.go 274 行 + importer_file.go 182 行 + detect_tail.go 117 行） | 573 行 | 无 R 级系统审核 |

**岔开**：R29 完结 ysm+geometry。updater 是自更新核心（远程代码下载 + 可执行文件替换），安全敏感度极高；importer 是整合包导入（zip 解压 + 文件落盘），与 R28 litematic 的归档解压耦合。两包同属「外部输入处理 + 文件系统写入」域，一次性过。

## 总体结论：通过（6 项 P2 + 5 项 P3 + 8 项 P4）

两包安全态势分化显著：

- **go/updater**：当前实现已有不少防御（状态码检查、Content-Type/Range 拒绝、截断探测、SHA256 校验、PE 魔数），但在三个关键维度存在系统性缺口：(1) HTTP client 未做重定向安全校验（P2-1），与 download 包已有成熟防御脱节；(2) SHA256 校验可被静默降级绕过（P2-3），且无哈希时仅靠 2 字节魔数把关；(3) 完全未复用 download 包的基础设施，导致两套平行实现口径已开始分歧（P4-12）。建议优先级：P2-1（重定向 SSRF）→ P2-3（哈希降级）→ P4-12（复用 download 基础设施消除平行实现）。
- **go/importer**：核心安全面（zip 解压路径穿越、解压炸弹）在 `go/container` / `go/scanner` 包处理，importer 只做「类型检测 + 整包落盘」。残留风险集中在 `copyDirContents` 的符号链接复制无路径穿越防护（P2-1）。`detect_tail.go` 的尾部探针是否真正接入了导入主链路存疑（P4-3）。

## 发现项汇总

| 模块 | P2 | P3 | P4 | deep 复审 |
|---|---|---|---|---|
| updater | 6 | 5 | 4 | 是（重定向 SSRF + 哈希降级 + 平行实现分歧） |
| importer | 2 | 3 | 3 | 是（symlink 路径穿越 + 尾部探针调用链） |
| **合计** | **8** | **8** | **7** | — |

## updater 发现项

### P2（正确性 / 安全）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | updater.go:281-283, 576 | 下载与哈希获取的 HTTP client 未设 `CheckRedirect`，默认无限跟随重定向到任意 scheme。go/download 包已有 `restrictedHTTPClient()`（拒绝 file/ftp、限制跳数），updater 完全没复用。中间人/被劫持的 ghproxy 可 302 到 `file:///etc/passwd` 或内网地址（SSRF）。 | 为下载 client 注入与 download 包同口径的 CheckRedirect（https/http only + 跳数上限），或直接复用 download 包的受限 client 构造。 |
| P2-2 | updater.go:257-264 | 多源回退无 scheme/域名白名单，且 `ghProxyPrefixes` 为第三方明文 HTTP 代理前缀，assetURL 经其拼接后下载内容无独立完整性绑定。任何中间人或代理本身被入侵都可替换 exe。 | 当 `expectedHash==""` 时应拒绝下载而非降级；代理前缀应允许运维覆盖且优先直连。 |
| P2-3 | updater.go:222-228, 395-401 | SHA256 校验在 `expectedHash==""` 时静默跳过，无哈希的更新包仅靠 MZ 魔数装机。`fetchExpectedHash` 失败（404/403/网络）时 `expectedHash` 保持空字符串，`downloadOnce` 第 395 行 `if expectedHash != ""` 直接跳过校验。攻击者只需阻断 SHA256SUMS 获取（或发布不含 SUMS 的 release）即可绕过完整性校验。 | 哈希不可得时至少警告并要求用户显式确认，或对 release 强制要求 SUMS 存在才标记 `Available: true`。 |
| P2-4 | updater.go:327 | 临时下载文件创建在系统临时目录（`os.CreateTemp("", ...)`），未校验目录权限/是否符号链接。若 `TMPDIR` 被设为攻击者可写路径，或临时目录存在符号链接劫持，下载的 exe 可被替换。 | 在程序安装目录下创建临时文件，或创建后 `os.Lstat` 校验非 symlink。 |
| P2-5 | updater.go:451-456 | PE 魔数校验仅读前 2 字节 "MZ"，不校验完整 PE 头，攻击者可在合法 MZ 后附带任意 payload。2 字节校验只能排除"完全不是 exe"的情况，无法防御"合法 PE 壳 + 恶意载荷"。 | 此为纵深防御一层，核心仍应落在强制 SHA256；可额外校验 PE header 的 `PE\0\0` 签名偏移。 |
| P2-6 | updater.go:431-491 | `InstallUpdate` 无回滚机制：helper 替换失败后旧 exe 已被 rename，新 exe 若损坏则程序无法启动。`CleanupOldVersion`（407-426）有 `.old` 恢复逻辑，但 helper 的实际替换语义不可见（二进制内嵌）。 | 确保 helper 采用"rename 旧→.old，rename 新→目标，失败时 rename .old→目标"的原子三步；审查 helper 源码。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | updater.go:327-375 | 下载失败/超时时 `.tmp` 文件清理依赖手动 `os.Remove`，多个 early-return 路径未清理。第 335-342 行 ContentLength 超限分支有清理，但第 294-296 行 `client.Do` 失败时虽未创建文件无需清理——真正的问题是：若 `io.Copy` 过程中发生 `ErrDownloadTooBig` 截断（358-366），清理是正确的；但 `f.Close()` 在 367 行，而 362-365 的清理路径先 `f.Close()` 再 `os.Remove`——逻辑正确但与 339 行的清理风格不一致，易在后续修改中漏掉一处。 | 引入 `defer func(){ if err != nil { os.Remove(tmp) } }()` 模式统一清理。 |
| P3-2 | updater.go:286-404 | 无磁盘空间预检；`io.Copy` 写满磁盘后返回 `ENOSPC` 但临时文件残留。大包（接近 500MB 上限）在磁盘空间不足时，Copy 会写到一半返回 `no space` 错误。 | 可选地在 Copy 前做 `syscall.Statfs` 预检；或对 `ENOSPC` 错误做映射。 |
| P3-3 | updater.go:431-490 | `InstallUpdate` 在第 489 行直接 `os.Exit(0)`，helper 启动失败后的 `os.RemoveAll(tmpDir)` 在 479 行已执行，但 helper 进程的清理（tmpDir、下载临时文件）依赖 helper 自身，主进程无法保证 helper 真正运行。`cmd.Start()` 成功仅表示进程已 fork，不保证 helper 执行成功。 | 主进程应在 `cmd.Start()` 后短暂等待 helper 写入一个 "ready" 信号文件再 Exit；或 helper 完成替换后写状态文件供下次启动校验。 |
| P3-4 | updater.go:524-542 | `isNewer` 的 stripMeta + splitVer 回退路径对 `v1.0.0` 与 `v1.0.0-beta` 判等（`preReleaseSemantics=false`），但 `semver.Compare` 对同 base 不同 pre-release 会区分——两条路径语义不一致。 | 要么开启 preReleaseSemantics 走标准排序，要么 stripMeta 后对预发布 tag 加降权。 |
| P3-5 | updater.go:484-486 | `os.Remove(exePath)` 清理下载临时文件在 `cmd.Start()` 之后、`os.Exit` 之前执行，但 exePath 此刻可能仍被 helper 进程通过 newPath（copyFile 副本）间接引用——实际安全，但时序脆弱。 | exePath 是 `Download` 返回的系统临时文件，删除时机正确；建议加注释说明 newPath 已是独立副本。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | updater.go 整体 | updater 未复用 go/download 包的成熟基础设施（CheckRedirect、validateHTTPResponse 的三道守卫、TruncationError、atomicFile），而是用内联 if 重新实现了一遍 Content-Type/Content-Range/截断校验。download 包的 `validateHTTPResponse`（306-328）与 updater 的 309-323 是逐行平行的逻辑，但 updater 用 `strings.Contains` 判断 Content-Type 而 download 用 `isBinaryContentType`——两套实现口径已经分歧。 | 提取共享的 `httputil.ValidateBinaryResponse(resp)` 供两个包复用；或 updater 直接 import download 包的导出函数。 |
| P4-2 | updater.go:26-27 | `repoOwner = "eghrhegpe"` 看起来像占位符/混淆值，与 `repoName = "ysm-model-manager"` 的正式命名不匹配。若 `eghrhegpe` 是真实 GitHub 用户名则无问题，但视觉上极易被误认为 TODO 占位符。 | 确认是真实 owner 并加注释说明，或改为常量。 |
| P4-3 | updater.go:520 | `preReleaseSemantics` 作为包级 `var` 暴露为可变全局开关，但无文档说明何时由谁切换，且默认 `false` 导致 P3-4 的语义不一致。注释说"未来发布 rc/beta 时开启"，但这是一个运行时可变全局，任何包内代码可翻转它且无锁保护——与 `updateLock` 的并发模型脱节。 | 改为 `const` 或 `init` 时一次性决定，避免运行时翻转引入竞态。 |
| P4-4 | updater_windows.go:11-20 | `extractEmbeddedHelper` 用 `os.WriteFile(dest, data, 0755)` 释放 helper，但 dest 在 `InstallUpdate` 中是 `tmpDir` 下的路径——tmpDir 由 `os.MkdirTemp` 创建（默认 0700），helper 文件权限 0755 在私有临时目录下无实际意义但也不出错。无 bug，但 0755 与目录 0700 的权限组合略显随意。 | 统一为 0700（仅所有者可执行）以减少 attack surface。 |

## importer 发现项

### P2（正确性 / 安全）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | importer.go:172-181 | `copyDirContents` 符号链接复制无路径穿越防护。`os.Readlink(srcPath)` 拿到链接 target 后直接 `os.Symlink(target, dstPath)`，若 target 是绝对路径（如 `/etc/passwd`）或含 `..` 的相对路径，复制后的 symlink 会指向仓库外任意文件；攻击者构造含恶意 symlink 的源目录即可实现越权读取/写入。 | 复制前对 `target` 做 `filepath.Clean` + 判定是否在源目录树内（`paths.IsInside`），跨目录链接应改为物理复制目标内容或拒绝。 |
| P2-2 | importer.go:156 | `copyDirContents` 注释声明"仅保留供测试"，但函数体仍含生产级符号链接分支。注释与代码脱节会让未来维护者误以为可安全删除或忽略；实际该函数被 4 处测试直接调用，且符号链接复制逻辑（172-181）与 `copyDir` 走的 `fsutil.CopyDirRecursive` 行为可能不一致，存在"测试覆盖的代码路径 ≠ 生产路径"的隐性偏差。 | 要么将符号链接复制收敛到 `fsutil.CopyDirRecursive` 单一实现并删除此函数，要么在注释中明确"符号链接分支与 fsutil 行为有差异，仅用于向后兼容测试"。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | importer_file.go:170-171 | `DetectZipType` local-header 扫描未校验 compSize 上界，恶意 zip 可使 idx 跳过整个包。`compSize` 直接取 local header 4 字节字段（最大 0xFFFFFFFF ≈ 4GB），`idx += 30+nameLen+extraLen+compSize` 后 idx 远超 `len(data)`，循环立即退出，条目名收集为空 → 返回 "" → 交全量兜底。**不构成死循环或 panic**（64 位平台 int 不会回绕），但意味着"zip64 / 伪造巨型 compSize"场景必走全量解码兜底，对超大包是性能退化路径而非正确性 bug。 | 若需严格，加 `compSize` 上界检查（如 `<= len(data)-idx`）；现状可接受，建议补注释说明此为有意降级。 |
| P3-2 | detect_tail.go:83 | `cdStart+cdSize` 在 32 位平台理论可整数溢出。`cdSize` 来自 `int(le32(...))`，在 64 位平台 int=64bit，`cdStart+cdSize` 最大约 8GB 不溢出；但 `len(data)` 受 `tailProbeMaxRaw=4MB` 限制，实际 `cdStart+cdSize` 必 ≤ 4MB+8MB，远不溢出。**64 位平台无风险**，仅理论 32 位边角。 | 无需改动；若追求严谨可改 `cdStart > len(data)-cdSize` 形式避免加法。 |
| P3-3 | importer_file.go:98 | 魔数校验条件 `len(data) >= 4` 但 7z 分支要求 `bytes.HasPrefix(data, sevenZipSig)`（4 字节）——条件一致无 bug；但 `.ysm` 分支仅校验 zip 签名，未校验"YSM 加密头"特征，加密 YSM 包会被 warn"文件头不匹配"但仍导入——这是**已知的有意降级**（注释 105-108 说明），非 bug，仅记录。 | 无需改动。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | importer.go:273 | 注册 `"litematic"` 用 `NewSimpleCopy`，但 `litematic` 是否属于"简单文件复制"语义未注释。其他 SimpleCopy 注册（resourcepack/shaderpack/blueprint）类型语义清晰，litematic（投影模组 schematic）单独成行无说明，未来扩展时易混淆归类规则。 | 补一行注释说明 litematic 为单文件复制语义，或引用 ADR 说明注册依据。 |
| P4-2 | importer.go:190 与 importer.go:152 | 出现两处 `// ===== DirectoryCopyImporter =====` 分隔注释——152 行处是 `copyDirContents` 上方的误粘贴（实际该函数属工具函数区，非 DirectoryCopyImporter 定义区），190 行才是真正的类型定义分隔。 | 删除 152 行的重复分隔注释。 |
| P4-3 | detect_tail.go:107-109 | 返回 `("", true)` 表示"确为 zip 但无匹配类型"，与 `importer_file.go:174-176` 的 `len(entries)==0 → ""` 语义边界需调用方区分。两个 `""` 含义不同（前者"确定无类型"，后者"无法判定"），但都交调用方处理。**疑点**：`detect_tail.go` 的尾部探针是否已接入主链路？若仅定义未调用，属死代码。 | 确认调用点；若未接入，标注 `// TODO: 接入 ImportFromBase64 主路径` 或删除。 |

## 修复状态注记（2026-08-31 闭环进行中）

| 级别 | 位置 | 状态 |
|---|---|---|
| updater P2-1 (重定向 SSRF) | updater.go:281-283, 576 | ⏳ 待修 |
| updater P2-2 (多源回退无白名单) | updater.go:257-264 | ⏳ 待修 |
| updater P2-3 (SHA256 静默降级) | updater.go:222-228, 395-401 | ⏳ 待修 |
| updater P2-4 (临时文件 symlink 劫持) | updater.go:327 | ⏳ 待修 |
| updater P2-5 (PE 魔数仅 2 字节) | updater.go:451-456 | ⏳ 待修 |
| updater P2-6 (InstallUpdate 无回滚) | updater.go:431-491 | ⏳ 待修 |
| updater P3-1~P3-5 | 多处 | ⏳ 待修 |
| updater P4-1~P4-4 | 多处 | ⏳ 待修 |
| importer P2-1 (copyDirContents symlink 路径穿越) | importer.go:172-181 | ⏳ 待修 |
| importer P2-2 (copyDirContents 注释脱节) | importer.go:156 | ⏳ 待修 |
| importer P3-1~P3-3 | 多处 | ⏳ 待修 |
| importer P4-1~P4-3 | 多处 | ⏳ 待修 |
