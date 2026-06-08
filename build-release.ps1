# YSM Model Manager 发布构建脚本
# 用法: .\build-release.ps1 v1.0.0 [-SkipUpload]
#   -SkipUpload  跳过 GitHub Release 上传（仅本地构建）

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    [switch]$SkipUpload
)

# 统一版本号格式：去掉可能的 v 前缀，内部统一用 vX.Y.Z
$VerTag = if ($Version -match '^v') { $Version } else { "v$Version" }
$VerNum = $VerTag -replace '^v', ''

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputDir = "$ProjectRoot\build\release"
$ExeName = "YSM-Model-Manager.exe"
$ZipName = "YSM-Model-Manager_windows_amd64.zip"
$ZipPath = "$OutputDir\$ZipName"

# GitHub 仓库信息
$GitHubOwner = "eghrhegpe"
$GitHubRepo = "ysm-model-manager"

# 清理旧构建
Remove-Item -Recurse -Force "$OutputDir" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$OutputDir" -Force | Out-Null

Write-Host "🔨 构建版本 $VerTag ..." -ForegroundColor Cyan

# 1. 构建前端
Write-Host "📦 构建前端..." -ForegroundColor Yellow
Set-Location "$ProjectRoot\frontend"
npx vite build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "❌ 前端构建失败" -ForegroundColor Red; exit 1 }

# 2. Wails 构建（自动嵌入前端资源 + 注入版本号）
Write-Host "🦫 Wails 编译 $VerTag ..." -ForegroundColor Yellow
Set-Location $ProjectRoot
wails build -clean -ldflags "-X ysm-model-manager/go/version.Version=$VerTag" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ wails build 失败 - 常见原因：旧进程锁定了 build/bin/" -ForegroundColor Red
    Write-Host "   请先运行: Get-Process -Name 'YSM-Model-Manager*' | Stop-Process -Force" -ForegroundColor Yellow
    Write-Host "   然后重试本脚本。不能用 go build 替代（缺少 Wails build tags）。" -ForegroundColor Yellow
    exit 1
} else {
    # wails build 成功，exe 在 build/bin/ 下
    Copy-Item "$ProjectRoot\build\bin\$ExeName" "$OutputDir\$ExeName"
}

# 3. 复制配置文件
Write-Host "📋 复制资源配置..." -ForegroundColor Yellow
Copy-Item "$ProjectRoot\workshop_sites.json" "$OutputDir\" -ErrorAction SilentlyContinue
Copy-Item "$ProjectRoot\workshop_creators.json" "$OutputDir\" -ErrorAction SilentlyContinue

# 4. 打包 zip
Write-Host "📦 打包 $ZipName ..." -ForegroundColor Yellow
Set-Location $OutputDir
Compress-Archive -Path "$OutputDir\*" -DestinationPath "$OutputDir\$ZipName" -Force

# 5. 输出结果
$FileSize = (Get-Item "$OutputDir\$ZipName").Length / 1MB
Write-Host "✅ 构建完成!" -ForegroundColor Green
Write-Host "   版本: $VerTag" -ForegroundColor Cyan
Write-Host "   输出: $OutputDir\$ZipName" -ForegroundColor Cyan
Write-Host "   大小: $("{0:N1}" -f $FileSize) MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步: 在 GitHub Releases 上传 $ZipName" -ForegroundColor Magenta
Write-Host "       或添加 -SkipUpload 参数跳过上传" -ForegroundColor Magenta

# ===== GitHub Release 上传 =====
if (-not $SkipUpload) {
    Write-Host ""
    Write-Host "🚀 准备上传到 GitHub Releases..." -ForegroundColor Cyan

    # 读取发版说明
    $ReleaseNotesPath = "$ProjectRoot\docs\release-notes\$VerTag.md"
    $ReleaseBody = ""
    if (Test-Path $ReleaseNotesPath) {
        $ReleaseBody = Get-Content $ReleaseNotesPath -Raw
        Write-Host "   📄 已读取发版说明: $ReleaseNotesPath" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️ 未找到 $ReleaseNotesPath，将使用默认说明" -ForegroundColor Yellow
        $ReleaseBody = "YSM Model Manager $VerTag"
    }

    # 优先用 gh CLI
    $ghAvailable = $null -ne (Get-Command "gh" -ErrorAction SilentlyContinue)
    if ($ghAvailable) {
        Write-Host "   🔑 使用 GitHub CLI (gh) ..." -ForegroundColor Gray
        $ghAuth = gh auth status 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   ⚠️ gh 未登录，尝试用 GH_TOKEN 环境变量..." -ForegroundColor Yellow
            $ghAvailable = $false
        }
    }

    if ($ghAvailable) {
        # ---- 方案 A: gh CLI ----
        # 发版说明写入临时文件（gh --notes 不支持多行）
        $notesTmp = [System.IO.Path]::GetTempFileName()
        $ReleaseBody | Out-File -FilePath $notesTmp -Encoding utf8
        Write-Host "   📤 创建 Release $VerTag ..." -ForegroundColor Gray
        $ghOutput = gh release create "$VerTag" `
            --repo "$GitHubOwner/$GitHubRepo" `
            --title "$VerTag" `
            --notes-file "$notesTmp" `
            "$ZipPath" 2>&1
        Remove-Item $notesTmp -Force -ErrorAction SilentlyContinue
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   ✅ Release 已发布: https://github.com/$GitHubOwner/$GitHubRepo/releases/tag/$VerTag" -ForegroundColor Green
        } else {
            Write-Host "   ❌ gh release create 失败: $ghOutput" -ForegroundColor Red
            Write-Host "   请手动上传 $ZipPath" -ForegroundColor Yellow
        }
    } else {
        # ---- 方案 B: GitHub API (需要 GH_TOKEN 环境变量) ----
        $token = $env:GH_TOKEN
        if (-not $token) {
            # 尝试从项目外配置文件读取
            $tokenFile = "$env:USERPROFILE\.ysm-release\token.txt"
            if (Test-Path $tokenFile) {
                $token = Get-Content $tokenFile -Raw | ForEach-Object { $_.Trim() }
            }
        }
        if (-not $token) {
            Write-Host "   ⚠️ 未设置 GH_TOKEN 环境变量，跳过 GitHub 上传" -ForegroundColor Yellow
            Write-Host "   设置方法: `$env:GH_TOKEN = 'ghp_xxxx'" -ForegroundColor Gray
            Write-Host "   或写到 $env:USERPROFILE\.ysm-release\token.txt" -ForegroundColor Gray
            Write-Host "   手动上传: $ZipPath" -ForegroundColor Magenta
        } else {
            $apiBase = "https://api.github.com"
            $authHeader = @{ Authorization = "Bearer $token" }
            $repoApi = "$apiBase/repos/$GitHubOwner/$GitHubRepo"

            Write-Host "   📤 创建 Release $VerTag ..." -ForegroundColor Gray

            # 创建 release
            $releaseBodyJson = @{
                tag_name         = "$VerTag"
                target_commitish = "main"
                name             = "$VerTag"
                body             = $ReleaseBody
                draft            = $false
                prerelease       = $false
            } | ConvertTo-Json -Compress

            try {
                $createResult = Invoke-RestMethod -Uri "$repoApi/releases" `
                    -Method Post `
                    -Headers $authHeader `
                    -ContentType "application/json" `
                    -Body $releaseBodyJson
                $uploadUrl = $createResult.upload_url -replace '\{.*',''
                Write-Host "   ✅ Release 已创建，上传中..." -ForegroundColor Green

                # 上传 zip 资产
                $zipBytes = [System.IO.File]::ReadAllBytes($ZipPath)
                $uploadResult = Invoke-RestMethod -Uri "$uploadUrl?name=$ZipName" `
                    -Method Post `
                    -Headers $authHeader `
                    -ContentType "application/octet-stream" `
                    -Body $zipBytes
                Write-Host "   ✅ 资产上传完成!" -ForegroundColor Green
                Write-Host "   🌐 $createResult.html_url" -ForegroundColor Cyan
            } catch {
                Write-Host "   ❌ 上传失败: $_" -ForegroundColor Red
                Write-Host "   请手动上传: $ZipPath" -ForegroundColor Yellow
            }
        }
    }
}
