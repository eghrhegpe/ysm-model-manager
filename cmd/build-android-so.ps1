# YSM Model Manager Android .so 编译脚本 (Windows PowerShell)
# 用法: .\cmd\build-android-so.ps1 v1.0.0 [-Arch arm64|amd64|x86_64] [-Production]
# 结构参照 MikuMikuAR scripts/build-android-so.ps1（已验证的 NDK 交叉编译链路），
# 适配 ysm：版本传参、无 MPR tag、version 包注入。
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,          # 形如 v1.0.0
    [ValidateSet("arm64", "amd64", "x86_64")]
    [string]$Arch = "arm64",
    [switch]$Production
)

$VerTag = if ($Version -match '^v') { $Version } else { "v$Version" }

# 解析项目目录（脚本位于仓库根的 cmd/ 下）
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (git rev-parse --show-toplevel 2>$null).Trim()
if (-not $repoRoot) { $repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$projectDir = "$repoRoot\"

# SDK / NDK 自动定位（兼容 CI Process 级 + 本地 User 级环境变量）
$sdkDir = $env:ANDROID_HOME
if (-not $sdkDir) { $sdkDir = $env:ANDROID_SDK_ROOT }
if (-not $sdkDir) { $sdkDir = [Environment]::GetEnvironmentVariable("ANDROID_HOME", "User") }
if (-not $sdkDir) { $sdkDir = [Environment]::GetEnvironmentVariable("ANDROID_SDK_ROOT", "User") }
if (-not $sdkDir) { $sdkDir = "C:\Android\Sdk" }

$ndkDir = $env:ANDROID_NDK_HOME
if (-not $ndkDir) { $ndkDir = [Environment]::GetEnvironmentVariable("ANDROID_NDK_HOME", "User") }
if (-not $ndkDir -and (Test-Path "$sdkDir\ndk")) {
    $ndkDir = Get-ChildItem "$sdkDir\ndk" -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $ndkDir) {
    Write-Error "Android NDK not found. Set ANDROID_NDK_HOME or install via sdkmanager."
    exit 1
}

$toolchain = "$ndkDir\toolchains\llvm\prebuilt\windows-x86_64"
$minSdk = "21"

if ($Arch -eq "arm64") {
    $CC = "$toolchain\bin\aarch64-linux-android$minSdk-clang.cmd"
    $CXX = "$toolchain\bin\aarch64-linux-android$minSdk-clang++.cmd"
    $GOARCH = "arm64"
    $jniDir = "arm64-v8a"
} else {
    $CC = "$toolchain\bin\x86_64-linux-android$minSdk-clang.cmd"
    $CXX = "$toolchain\bin\x86_64-linux-android$minSdk-clang++.cmd"
    $GOARCH = "amd64"
    $jniDir = "x86_64"
}

$outputDir = "$projectDir\build\android\app\src\main\jniLibs\$jniDir"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

# 保存原始环境变量，以便编译后恢复，防止污染后续构建
$origCGO_ENABLED = $env:CGO_ENABLED
$origGOOS = $env:GOOS
$origGOARCH = $env:GOARCH
$origCC = $env:CC
$origCXX = $env:CXX

$env:CGO_ENABLED = "1"
$env:GOOS = "android"
$env:GOARCH = $GOARCH
$env:CC = $CC
$env:CXX = $CXX

# ysm 无 MPR/物理多线程 tag：仅 production/debug + android
$buildFlags = if ($Production) {
    @("-tags", "production,android", "-trimpath", "-buildvcs=false")
} else {
    @("-tags", "android,debug", "-buildvcs=false", "-gcflags=all=-l")
}

# 注入版本信息（与 Windows/Linux 一致，避免 关于/检查更新 显示 dev）
$buildFlags += '-ldflags'
$buildFlags += "-X ysm-model-manager/go/version.Version=$VerTag"

$overlayJson = "$projectDir\build\android\overlay.json"
if (-not (Test-Path $overlayJson)) {
    Write-Error "overlay.json not found. Run 'wails3 android overlay:gen' first."
    exit 1
}

$startDir = Get-Location
Set-Location $projectDir

try {
    Write-Output "[build-android-so] 编译 Go -> libwails.so ($Arch)..."
    & go build -buildmode=c-shared -overlay $overlayJson $buildFlags -o "$outputDir\libwails.so" 2>&1
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    # 恢复原始环境变量（Cleanup GOARCH / CC / GOOS / CXX / CGO_ENABLED）
    if ($null -eq $origCGO_ENABLED) { Remove-Item Env:\CGO_ENABLED -ErrorAction SilentlyContinue } else { $env:CGO_ENABLED = $origCGO_ENABLED }
    if ($null -eq $origGOOS) { Remove-Item Env:\GOOS -ErrorAction SilentlyContinue } else { $env:GOOS = $origGOOS }
    if ($null -eq $origGOARCH) { Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue } else { $env:GOARCH = $origGOARCH }
    if ($null -eq $origCC) { Remove-Item Env:\CC -ErrorAction SilentlyContinue } else { $env:CC = $origCC }
    if ($null -eq $origCXX) { Remove-Item Env:\CXX -ErrorAction SilentlyContinue } else { $env:CXX = $origCXX }
    Set-Location $startDir
}

Write-Output "[build-android-so] 完成: $outputDir\libwails.so"
