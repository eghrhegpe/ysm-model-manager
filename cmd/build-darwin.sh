#!/usr/bin/env bash
# YSM Model Manager macOS (Darwin) 构建脚本
# 用法: ./build-darwin.sh v1.0.0 [--clean]
#   在 macOS 本机执行（Wails v3 需 CGO + WebKit，不支持纯 Go 交叉编译）。
# 结构参照 MikuMikuAR scripts/build-darwin.sh（已验证的平台脚本），
# 适配 ysm：版本传参（同 build-release.sh）、绑定生成前置、go generate、version 包注入。

set -euo pipefail

# 参数解析
VERSION=""
CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=true ;;
    -h|--help)
      echo "用法: $0 <版本号> [--clean]"
      echo "  例: $0 v1.0.0"
      exit 0 ;;
    *) VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "❌ 缺少版本号参数" >&2
  echo "用法: $0 <版本号> [--clean]" >&2
  exit 1
fi

# 统一版本号格式：内部统一用 vX.Y.Z
if [[ "$VERSION" =~ ^v ]]; then
  VER_TAG="$VERSION"
else
  VER_TAG="v$VERSION"
fi

# 仓库根（脚本已迁入 cmd/，通过 git 解析；无 git 时退回 cmd/ 的上级目录）
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$PROJECT_ROOT" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
fi

BIN_DIR="$PROJECT_ROOT/bin"
DIST_DIR="$PROJECT_ROOT/dist"
BIN_NAME="YSM-Model-Manager"

# 同步 config.yml version（Wails 框架会读取此字段）
CONFIG_YML="$PROJECT_ROOT/build/config.yml"
if [ -f "$CONFIG_YML" ]; then
  sed -i '' "s/^\(\s*version:\s*\)\".*\"/\1\"$VER_TAG\"/" "$CONFIG_YML"
  echo "[build-darwin] 同步 config.yml version -> $VER_TAG"
fi

# 清理
if [ "$CLEAN" = true ]; then
  echo "[build-darwin] 清理构建产物..."
  rm -rf "$BIN_DIR"
fi
mkdir -p "$BIN_DIR" "$DIST_DIR"

cd "$PROJECT_ROOT"

# 0. 生成 Wails 3 绑定（前端源，必须在 vite build 之前生成）
#    统一入口：npm run generate:bindings（内部 wails3 generate bindings -clean=true -ts -i）
echo "[build-darwin] 🧬 生成 Wails 3 绑定..."
if ! (cd frontend && npm run generate:bindings) 2>&1; then
  echo "❌ 绑定生成失败（请确认 wails3 CLI 已安装且在 PATH 中）" >&2
  exit 1
fi

# 1. 构建前端
echo "[build-darwin] 📦 构建前端..."
cd "$PROJECT_ROOT/frontend"
if ! npx vite build 2>&1; then
  echo "❌ 前端构建失败" >&2
  exit 1
fi
cd "$PROJECT_ROOT"

# 2. 运行代码生成（litematic block_ids 等）
echo "[build-darwin] 🧬 代码生成..."
cd "$PROJECT_ROOT"
if ! go generate ./go/... 2>&1; then
  echo "❌ 代码生成失败，构建中止" >&2
  exit 1
fi

# 3. 主程序编译（注入版本号并嵌入前端资源；macOS 无 windowsgui 标志）
echo "[build-darwin] 🦫 编译主程序 $VER_TAG ..."
if ! go build -ldflags "-X ysm-model-manager/go/version.Version=$VER_TAG" -o "$BIN_DIR/$BIN_NAME" . 2>&1; then
  echo "❌ go build 失败" >&2
  exit 1
fi

# 4. 构建 CLI 工具（可选，失败不阻断）
echo "[build-darwin] 🔧 构建 CLI 工具 ysm-cli ..."
if go build -tags cli -ldflags "-X ysm-model-manager/go/version.Version=$VER_TAG" -o "$BIN_DIR/ysm-cli" . 2>&1; then
  echo "   ✅ ysm-cli 已构建"
else
  echo "⚠️ CLI 构建失败（不影响主程序）"
fi

# 5. 复制配置文件
echo "[build-darwin] 📋 复制资源配置..."
for f in workshop_sites.json creators.json workshop-github.json resource_types.json; do
  [ -f "$PROJECT_ROOT/$f" ] && cp "$PROJECT_ROOT/$f" "$BIN_DIR/" || true
done

# 6. 重命名产物到 dist/
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH_STR="amd64" ;;
  arm64)   ARCH_STR="arm64" ;;
  *)       ARCH_STR="$ARCH" ;;
esac
DST_BIN="$DIST_DIR/YSM-Model-Manager-$VER_TAG-darwin-$ARCH_STR"
if [ -f "$BIN_DIR/$BIN_NAME" ]; then
  cp "$BIN_DIR/$BIN_NAME" "$DST_BIN"
  chmod +x "$DST_BIN"
  SIZE="$(du -h "$DST_BIN" | cut -f1)"
  echo ""
  echo "✅ [build-darwin] 构建完成"
  echo "   版本: $VER_TAG"
  echo "   产物: $DST_BIN"
  echo "   大小: $SIZE"
else
  echo "❌ 未找到构建产物: $BIN_DIR/$BIN_NAME" >&2
  exit 1
fi
