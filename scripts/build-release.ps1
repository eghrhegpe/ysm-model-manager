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

# 脚本位于 scripts/，故 $MyInvocation 路径为 scripts/ 而非仓库根。
# 通过 git 解析仓库根，确保 $ProjectRoot 始终指向仓库根
# （JSON / 前端 / go 子包均相对仓库根）。无 git 时退回 scripts/ 的上级目录。
$ProjectRoot = (git rev-parse --show-toplevel 2>$null).Trim()
if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$OutputDir = "$ProjectRoot\build\release"
$ExeName = "YSM-Model-Manager_windows_amd64.exe"
$ExePath = "$OutputDir\$ExeName"

# GitHub 仓库信息
$GitHubOwner = "eghrhegpe"
$GitHubRepo = "ysm-model-manager"

# 清理旧构建
Remove-Item -Recurse -Force "$OutputDir" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$OutputDir" -Force | Out-Null

Write-Host "🔨 构建版本 $VerTag ..." -ForegroundColor Cyan

# 0. 生成 Wails 3 绑定（前端源，必须在 vite build 之前生成）
#    统一入口：npm run generate:bindings（内部 wails3 generate bindings -clean=true -ts -i，
#    产出 .ts；前端以 .js 后缀 import、由 vite wailsBindingsResolve 重定向）。
Write-Host "🧬 生成 Wails 3 绑定..." -ForegroundColor Yellow
Set-Location $ProjectRoot
npm --prefix frontend run generate:bindings 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 绑定生成失败（请确认 wails3 CLI 已安装且在 PATH 中）" -ForegroundColor Red
    exit 1
}

# 1. 构建前端
Write-Host "📦 构建前端..." -ForegroundColor Yellow
Set-Location "$ProjectRoot\frontend"
npx vite build 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "❌ 前端构建失败" -ForegroundColor Red; exit 1 }

# 1b. 构建更新助手 helper（Wails 构建前必须完成，因为 embed）
Write-Host "🔧 构建更新助手 ysm-updater-helper.exe ..." -ForegroundColor Yellow
Set-Location $ProjectRoot
go build -ldflags "-X ysm-model-manager/go/version.Version=$VerTag" -o "$ProjectRoot\go\updater\ysm-updater-helper.exe" "$ProjectRoot\cmd\updater" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ helper 构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ helper 已编译到 go/updater/" -ForegroundColor Green

# 1c. 构建并嵌入 Rust 扫描桥。前端/Wails 绑定保持不变，只有扫描热路径切到 Rust；
# bridge DLL 作为字节嵌入主 exe，发布目录仍然只有一个可执行文件。
Write-Host "🦀 构建 Rust 扫描桥..." -ForegroundColor Yellow
Set-Location $ProjectRoot
cargo build --release --locked --manifest-path rust-wails-bridge/Cargo.toml 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Rust bridge 构建失败" -ForegroundColor Red
    exit 1
}
$RustBridgeDir = "$ProjectRoot\go\rustbridge\bin"
New-Item -ItemType Directory -Path $RustBridgeDir -Force | Out-Null
Copy-Item -Force `
    "$ProjectRoot\rust-wails-bridge\target\release\ysm_model_manager_wails_bridge.dll" `
    "$RustBridgeDir\ysm_model_manager_wails_bridge.dll"
Write-Host "   ✅ Rust bridge 已嵌入准备完成" -ForegroundColor Green

# 2. 运行代码生成（litematic block_ids 等）
Write-Host "🧬 代码生成..." -ForegroundColor Yellow
Set-Location $ProjectRoot
go generate ./go/... 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 代码生成失败，构建中止" -ForegroundColor Red
    exit 1
}

# 3. 主程序编译（Wails 3 下用 go build 直接注入版本号并嵌入前端资源）
#    说明：wails3 build 不支持 -ldflags，故版本注入改走 go build -ldflags。
#          vite build 已在步骤 1 完成，main.go 通过 //go:embed all:frontend/dist
#          将前端资源打包进单文件 exe；更新助手 ysm-updater-helper.exe 已在步骤 1b 构建。
Write-Host "🦫 编译主程序 $VerTag ..." -ForegroundColor Yellow
Set-Location $ProjectRoot
$MainLdflags = "-X ysm-model-manager/go/version.Version=$VerTag"
if (-not [string]::IsNullOrWhiteSpace($env:YSMHUB_API_KEY)) {
    # The key is intentionally read from the build environment and never
    # printed or committed. This makes an explicitly configured test/release
    # package usable out of the box while source builds remain credential-free.
    $MainLdflags += " -X ysm-model-manager/go/cli.embeddedHubAPIKey=$($env:YSMHUB_API_KEY)"
    Write-Host "   ✅ 已注入 YSM Hub 只读 Key（未输出凭据）" -ForegroundColor Gray
}
go build -tags "rust_backend" -ldflags $MainLdflags -o "$OutputDir\$ExeName" . 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ go build 失败" -ForegroundColor Red
    exit 1
}
if (!(Test-Path "$OutputDir\$ExeName")) {
    Write-Host "❌ 主 exe 未生成: $OutputDir\$ExeName" -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ 主程序已编译到 $OutputDir\$ExeName" -ForegroundColor Green

# 3. 纯 exe 发布（v1.13.0 起）：主程序编译期内嵌全部数据（resource_types/creators/
#    workshop 系列）与前端/WASM 资产，用户可编辑数据在用户目录
#    （%APPDATA%/YSM-Model-Manager）——Release 资产直接为裸 exe，不再打包 zip。
#    注意：OutputDir 每次构建前已清理重建，不会混入旧产物。

# 4. 校验产物（无 zip 打包环节）
Write-Host "✅ 校验产物 $ExeName ..." -ForegroundColor Yellow
if (!(Test-Path "$OutputDir\$ExeName")) {
    Write-Host "❌ 缺少主 exe，构建失败" -ForegroundColor Red
    exit 1
}

# 4b. 生成 SHA256SUMS（用于下载后校验，防 MITM 攻击）
Write-Host "🔐 生成 SHA256SUMS ..." -ForegroundColor Yellow
$ShaSumsPath = "$OutputDir\SHA256SUMS"
$exeHash = (Get-FileHash -Path "$ExePath" -Algorithm SHA256).Hash.ToLower()
"$exeHash  $ExeName" | Out-File -FilePath $ShaSumsPath -Encoding ascii
Write-Host "   SHA256: $exeHash" -ForegroundColor Gray

# 5. 输出结果
$FileSize = (Get-Item "$ExePath").Length / 1MB
Write-Host "✅ 构建完成!" -ForegroundColor Green
Write-Host "   版本: $VerTag" -ForegroundColor Cyan
Write-Host "   输出: $ExePath" -ForegroundColor Cyan
Write-Host "   大小: $("{0:N1}" -f $FileSize) MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步: 在 GitHub Releases 上传 $ExeName 和 SHA256SUMS" -ForegroundColor Magenta
Write-Host "       或添加 -SkipUpload 参数跳过上传" -ForegroundColor Magenta

# ===== GitHub Release 上传 =====
if (-not $SkipUpload) {
    Write-Host ""
    Write-Host "🚀 准备上传到 GitHub Releases..." -ForegroundColor Cyan

    # 读取发版说明
    $ReleaseNotesPath = "$ProjectRoot\docs\releases\$VerTag.md"
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
            "$ExePath" "$ShaSumsPath" 2>&1
        Remove-Item $notesTmp -Force -ErrorAction SilentlyContinue
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   ✅ Release 已发布: https://github.com/$GitHubOwner/$GitHubRepo/releases/tag/$VerTag" -ForegroundColor Green
        } else {
            Write-Host "   ❌ gh release create 失败: $ghOutput" -ForegroundColor Red
            Write-Host "   请手动上传 $ExePath" -ForegroundColor Yellow
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
            Write-Host "   手动上传: $ExePath" -ForegroundColor Magenta
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

                # 上传 exe 资产（裸 exe 发布）
                $exeBytes = [System.IO.File]::ReadAllBytes($ExePath)
                $uploadResult = Invoke-RestMethod -Uri "$uploadUrl?name=$ExeName" `
                    -Method Post `
                    -Headers $authHeader `
                    -ContentType "application/octet-stream" `
                    -Body $exeBytes

                # 上传 SHA256SUMS
                $sumsBytes = [System.IO.File]::ReadAllBytes($ShaSumsPath)
                $uploadResult2 = Invoke-RestMethod -Uri "$uploadUrl?name=SHA256SUMS" `
                    -Method Post `
                    -Headers $authHeader `
                    -ContentType "application/octet-stream" `
                    -Body $sumsBytes
                Write-Host "   ✅ 资产上传完成!" -ForegroundColor Green
                Write-Host "   🌐 $createResult.html_url" -ForegroundColor Cyan
            } catch {
                Write-Host "   ❌ 上传失败: $_" -ForegroundColor Red
                Write-Host "   请手动上传: $ExePath" -ForegroundColor Yellow
            }
        }
    }
}
