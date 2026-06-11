<#
.SYNOPSIS
  YSM 模型管理器 — 集成测试脚本
  编译 + 冒烟测试，确认可执行文件能正常启动并响应 Binding 调用。

.DESCRIPTION
  此脚本会在临时目录中构建 exe，运行一组冒烟测试（CLI 模式），
  然后清理临时文件。

  用法:
    .\scripts\smoke-test.ps1
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$TmpDir = Join-Path $env:TEMP "ysm-smoke-test-$(Get-Random)"
$TestRepo = Join-Path $TmpDir "repo"
$TestCustom = Join-Path $TmpDir "custom"

try {
  Write-Host "=== YSM 集成测试 ===" -ForegroundColor Cyan
  Write-Host "项目目录: $ProjectRoot"
  Write-Host "临时目录: $TmpDir"
  New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null
  New-Item -ItemType Directory -Path $TestRepo -Force | Out-Null
  New-Item -ItemType Directory -Path $TestCustom -Force | Out-Null

  # 创建一个测试模型文件
  $TestModelPath = Join-Path $TestRepo "test_model.ysm"
  "YSGP-- [Metadata]<name>TestModel</name><free>true</free>===" | Set-Content -Path $TestModelPath -Encoding Ascii

  # 编译 Go 后端 + 前端
  Write-Host "`n[1/4] 编译 Go 后端..." -ForegroundColor Yellow
  Push-Location $ProjectRoot
  go build -o (Join-Path $TmpDir "ysm-cli.exe") ./cmd/genindex/ 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Go 编译失败" }
  Write-Host "  ✅ Go 编译成功"

  Write-Host "[2/4] 编译前端..." -ForegroundColor Yellow
  Push-Location (Join-Path $ProjectRoot "frontend")
  npm ci 2>&1 | Out-Null
  npx vite build 2>&1
  if ($LASTEXITCODE -ne 0) { throw "前端编译失败" }
  Write-Host "  ✅ 前端编译成功"

  # 运行 Go 单元测试
  Write-Host "[3/4] 运行 Go 单元测试..." -ForegroundColor Yellow
  Push-Location $ProjectRoot
  $testOutput = go test ./go/... -count=1 2>&1
  Write-Host $testOutput
  if ($LASTEXITCODE -ne 0) { throw "单元测试失败" }

  # 冒烟测试：用 genindex 生成索引
  Write-Host "[4/4] 冒烟测试: genindex..." -ForegroundColor Yellow
  $indexFile = Join-Path $TmpDir "index.json"
  & (Join-Path $TmpDir "ysm-cli.exe") -dir $TestRepo -out $indexFile 2>&1
  if ($LASTEXITCODE -ne 0) { throw "genindex 执行失败" }
  if (-not (Test-Path $indexFile)) { throw "index.json 未生成" }

  $content = Get-Content $indexFile -Raw | ConvertFrom-Json
  if ($content.models.Count -ne 1) { throw "期望 1 个模型，实际 $($content.models.Count)" }
  Write-Host "  ✅ genindex 正确生成索引 (1 个模型)"

  Write-Host "`n=== ✅ 全部集成测试通过 ===" -ForegroundColor Green
} catch {
  Write-Host "`n=== ❌ 测试失败: $_ ===" -ForegroundColor Red
  exit 1
} finally {
  # 清理
  if (Test-Path $TmpDir) {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
  }
  Pop-Location
}
