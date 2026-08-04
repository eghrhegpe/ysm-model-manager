# YSM-Model-Manager 一键发版脚本（骨架）
# 用法: .\scripts\release.ps1 -Version 1.9.4 [-DryRun]
# 对应 docs/releases/release-process.md §2 的 9 步 + §8 命令序列。
#
# 设计原则（AI 可幂等跑）：
#   1. 每步前打印 [release] step N: <desc>，失败即 throw，不吞错。
#   2. tag 已存在则中止（防 §5 重推同名 tag 覆盖 body）。
#   3. 不替你写 docs/releases/vX.Y.Z.md——只校验文件存在。
#   4. 不做本地构建——那是 cmd/build-release.ps1 的职责；本脚本只走 tag → CI → 核对。
#
# 未实现的占位（标 # TODO）：应用内版本核对（需启动应用读「关于」页）。

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,          # 形如 1.9.4，不带 v 前缀
    [switch]$DryRun            # 只打印不执行，用于发版前演练
)

$ErrorActionPreference = 'Stop'

# ── 防呆：版本号格式校验 ──────────────────────────────────────
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "版本号格式错：$Version。应为 X.Y.Z，如 1.9.4（不带 v 前缀）"
}
$tag = "v$Version"
Write-Output "[release] 目标版本：$Version (tag: $tag)"

if ($DryRun) { Write-Output "[release] === DryRun 模式：只打印不执行 ===" }

# ── 工作目录定位 ──────────────────────────────────────────────
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptsDir\.." | Select-Object -ExpandProperty Path
Set-Location $repoRoot
Write-Output "[release] 工作目录：$repoRoot"

# ── 前置校验：gh CLI 是否可用 ─────────────────────────────────
$ghOk = $true
try { $null = Get-Command gh -ErrorAction Stop } catch { $ghOk = $false }
if (-not $ghOk) {
    Write-Warning "[release] gh CLI 未安装，步骤 5/6 的 CI 监控与核对将无法自动化。请先 winget install GitHub.cli。"
}

# ═══════════════════════════════════════════════════════════════
# 步骤 2：校验 docs/releases/vX.Y.Z.md 存在
# ═══════════════════════════════════════════════════════════════
$notesPath = "docs/releases/v$Version.md"
Write-Output "[release] step 2: 校验发布说明 $notesPath"
if (-not (Test-Path $notesPath)) {
    throw "发布说明缺失：$notesPath。请先手写 notes（格式参考 docs/releases/v1.9.3.md），再重跑本脚本。"
}
Write-Output "[release] ✓ 发布说明已存在"

# ═══════════════════════════════════════════════════════════════
# 步骤 3：提交发布说明，推 main
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 3: 提交并推 main"

# 防呆：tag 已存在则中止（§5 回滚/补发）
$tagExists = $false
try { git rev-parse $tag 2>$null | Out-Null; $tagExists = $true } catch {}
if ($tagExists) {
    throw "tag $tag 已存在。若需重建，先 git tag -d $tag && git push origin :$tag。"
}

if (-not $DryRun) {
    git add $notesPath
    # 若 notes 无变更（已提交过），git commit 会失败；吞掉该错误
    try {
        git commit -m "docs: add v$Version release notes"
    } catch {
        Write-Output "[release] notes 无新变更或已提交，跳过 commit"
    }
    git push origin main
}
Write-Output "[release] ✓ 已提交发布说明并推 main"

# ═══════════════════════════════════════════════════════════════
# 步骤 4：打 tag 触发 release.yml
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 4: 打 tag $tag"
if (-not $DryRun) {
    git tag $tag
    git push origin $tag
}
Write-Output "[release] ✓ tag 已推送，release.yml 已触发"

# ═══════════════════════════════════════════════════════════════
# 步骤 5：监控 release.yml（test job + release job）
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 5: 监控 release.yml"
if ($ghOk -and -not $DryRun) {
    $runId = gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
    if ($runId) {
        Write-Output "[release] gh run watch $runId （阻塞至 test + release 两 job 完成）"
        gh run watch $runId
        # 检查最终结论
        $conclusion = gh run view $runId --json conclusion --jq '.conclusion'
        if ($conclusion -ne 'success') {
            throw "release.yml 结论为 $conclusion，请到 Actions 页排查"
        }
    } else {
        Write-Warning "[release] 未找到最近的 release run，请手动监控"
    }
} elseif (-not $ghOk) {
    Write-Warning "[release] gh 不可用，请手动 gh run list --workflow release.yml --limit 3 监控"
}
Write-Output "[release] ✓ release.yml 两 job 全绿"

# ═══════════════════════════════════════════════════════════════
# 步骤 6：核对 GitHub Release
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 6: 核对 GitHub Release"
if ($ghOk -and -not $DryRun) {
    $release = gh release view $tag --json body,tagName,assets --jq '{tag: .tagName, body: (.body[0:80]+\"...\"), assets: (.assets | length)}'
    Write-Output "[release] Release 概览：$release"

    # TODO: 校验 body 是否为手写 notes（非占位文本 "YSM Model Manager vX.Y.Z"）
    #       若是占位文本或空，则 gh release edit $tag --notes-file $notesPath 修正

    # TODO: 校验产物齐全（zip + SHA256SUMS）
    #       通过 assets[].name 过滤，确认两项都在
}
Write-Output "[release] ✓ 发版完成：$tag"

# ═══════════════════════════════════════════════════════════════
# 附录：本地自检（可选，CI 前跑）
# ═══════════════════════════════════════════════════════════════
# .\cmd\build-release.ps1 v$Version -SkipUpload   # 本地 8 步构建，不上传
