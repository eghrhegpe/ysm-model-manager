# YSM Model Manager 发布构建脚本
# 用法: .\build-release.ps1 v1.0.0

param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputDir = "$ProjectRoot\build\release"
$ExeName = "YSM-Model-Manager.exe"
$ZipName = "YSM-Model-Manager_windows_amd64.zip"

# 清理旧构建
Remove-Item -Recurse -Force "$OutputDir" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$OutputDir" -Force | Out-Null

Write-Host "🔨 构建版本 $Version ..." -ForegroundColor Cyan

# 1. 构建前端
Write-Host "📦 构建前端..." -ForegroundColor Yellow
Set-Location "$ProjectRoot\frontend"
npx vite build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "❌ 前端构建失败" -ForegroundColor Red; exit 1 }

# 2. Wails 构建（自动嵌入前端资源 + 注入版本号）
Write-Host "🦫 Wails 编译 v$Version ..." -ForegroundColor Yellow
Set-Location $ProjectRoot
wails build -clean -ldflags "-X ysm-model-manager/go/version.Version=$Version" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ wails build 失败 - 常见原因：旧进程锁定了 build/bin/" -ForegroundColor Red
    Write-Host "   请先运行: Get-Process -Name 'YSM-Model-Manager*' | Stop-Process -Force" -ForegroundColor Yellow
    Write-Host "   然后重试本脚本。不能用 go build 替代（缺少 Wails build tags）。" -ForegroundColor Yellow
    exit 1
} else {
    # wails build 成功，exe 在 build/bin/ 下
    Copy-Item "$ProjectRoot\build\bin\$ExeName" "$OutputDir\$ExeName"
}

# 3. 复制 YSMParser sidecar（-clean 会清掉 build/bin，需从备份恢复或提示用户）
$ysmParserSrc = "$ProjectRoot\build\bin\YSMParser.exe"
if (Test-Path $ysmParserSrc) {
    Copy-Item $ysmParserSrc "$OutputDir\"
    Write-Host "🔧 YSMParser.exe 已复制" -ForegroundColor Yellow
} else {
    Write-Host "⚠️ 未找到 YSMParser.exe - 骨骼预览功能不可用" -ForegroundColor Yellow
    Write-Host "   下载地址: https://github.com/OpenYSM/YSMParser/releases" -ForegroundColor Yellow
}

# 4. 复制配置文件
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
Write-Host "   版本: $Version" -ForegroundColor Cyan
Write-Host "   输出: $OutputDir\$ZipName" -ForegroundColor Cyan
Write-Host "   大小: $("{0:N1}" -f $FileSize) MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步: 在 GitHub Releases 上传 $ZipName" -ForegroundColor Magenta
