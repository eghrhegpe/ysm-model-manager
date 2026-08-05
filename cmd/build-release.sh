#!/usr/bin/env bash
# YSM Model Manager 发布构建脚本（跨平台 bash 版，逻辑与 build-release.ps1 一一对应）
# 用法: ./build-release.sh v1.0.0 [-skip-upload]
#   -skip-upload  跳过 GitHub Release 上传（仅本地构建）

set -euo pipefail

# 参数解析
VERSION=""
SKIP_UPLOAD=false
for arg in "$@"; do
  case "$arg" in
    -skip-upload|--skip-upload) SKIP_UPLOAD=true ;;
    -h|--help)
      echo "用法: $0 <版本号> [-skip-upload]"
      echo "  例: $0 v1.0.0"
      echo "  -skip-upload  跳过 GitHub Release 上传"
      exit 0 ;;
    *) VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "❌ 缺少版本号参数" >&2
  echo "用法: $0 <版本号> [-skip-upload]" >&2
  exit 1
fi

# 统一版本号格式：内部统一用 vX.Y.Z
if [[ "$VERSION" =~ ^v ]]; then
  VER_TAG="$VERSION"
else
  VER_TAG="v$VERSION"
fi
VER_NUM="${VER_TAG#v}"

# 仓库根（脚本已迁入 cmd/，通过 git 解析；无 git 时退回 cmd/ 的上级目录）
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$PROJECT_ROOT" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
fi

OUTPUT_DIR="$PROJECT_ROOT/build/release"
EXE_NAME="YSM-Model-Manager.exe"
ZIP_NAME="YSM-Model-Manager_windows_amd64.zip"
ZIP_PATH="$OUTPUT_DIR/$ZIP_NAME"

# GitHub 仓库信息
GITHUB_OWNER="eghrhegpe"
GITHUB_REPO="ysm-model-manager"

# 清理旧构建
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo -e "\033[36m🔨 构建版本 $VER_TAG ...\033[0m"

# 0. 生成 Wails 3 绑定（前端源，必须在 vite build 之前生成）
#    契约：必须带 -ts 产出 .ts，前端以 .js 后缀 import、由 vite wailsBindingsResolve 重定向；
#    漏 -ts 会生成 .js 破坏该契约（回归教训 2026-08-05）。
echo -e "\033[33m🧬 生成 Wails 3 绑定...\033[0m"
cd "$PROJECT_ROOT"
if ! wails3 generate bindings -ts 2>&1; then
  echo -e "\033[31m❌ 绑定生成失败（请确认 wails3 CLI 已安装且在 PATH 中）\033[0m" >&2
  exit 1
fi

# 1. 构建前端
echo -e "\033[33m📦 构建前端...\033[0m"
cd "$PROJECT_ROOT/frontend"
if ! npx vite build 2>&1; then
  echo -e "\033[31m❌ 前端构建失败\033[0m" >&2
  exit 1
fi

# 1b. 构建更新助手 helper（Wails 构建前必须完成，因为 embed）
echo -e "\033[33m🔧 构建更新助手 ysm-updater-helper.exe ...\033[0m"
cd "$PROJECT_ROOT"
if ! go build -ldflags "-X ysm-model-manager/go/version.Version=$VER_TAG" -o "$PROJECT_ROOT/go/updater/ysm-updater-helper.exe" "$PROJECT_ROOT/cmd/updater" 2>&1; then
  echo -e "\033[31m❌ helper 构建失败\033[0m" >&2
  exit 1
fi
echo -e "\033[32m   ✅ helper 已编译到 go/updater/\033[0m"

# 2. 运行代码生成（litematic block_ids 等）
echo -e "\033[33m🧬 代码生成...\033[0m"
cd "$PROJECT_ROOT"
if ! go generate ./go/... 2>&1; then
  echo -e "\033[31m❌ 代码生成失败，构建中止\033[0m" >&2
  exit 1
fi

# 3. 主程序编译（go build 直接注入版本号并嵌入前端资源）
echo -e "\033[33m🦫 编译主程序 $VER_TAG ...\033[0m"
cd "$PROJECT_ROOT"
if ! go build -ldflags "-X ysm-model-manager/go/version.Version=$VER_TAG" -o "$OUTPUT_DIR/$EXE_NAME" . 2>&1; then
  echo -e "\033[31m❌ go build 失败\033[0m" >&2
  exit 1
fi
if [ ! -f "$OUTPUT_DIR/$EXE_NAME" ]; then
  echo -e "\033[31m❌ 主 exe 未生成: $OUTPUT_DIR/$EXE_NAME\033[0m" >&2
  exit 1
fi
echo -e "\033[32m   ✅ 主程序已编译到 $OUTPUT_DIR/$EXE_NAME\033[0m"

# 3b. 构建 CLI 工具
echo -e "\033[33m🔧 构建 CLI 工具 ysm-cli.exe ...\033[0m"
cd "$PROJECT_ROOT"
if go build -tags cli -ldflags "-X ysm-model-manager/go/version.Version=$VER_TAG" -o "$OUTPUT_DIR/ysm-cli.exe" . 2>&1; then
  echo -e "\033[32m   ✅ ysm-cli.exe 已构建\033[0m"
else
  echo -e "\033[33m⚠️ CLI 构建失败（不影响主程序）\033[0m"
fi

# 4. 复制配置文件
echo -e "\033[33m📋 复制资源配置...\033[0m"
for f in workshop_sites.json creator.json workshop-github.json resource_types.json; do
  [ -f "$PROJECT_ROOT/$f" ] && cp "$PROJECT_ROOT/$f" "$OUTPUT_DIR/" || true
done

# 5. 打包 zip
echo -e "\033[33m📦 打包 $ZIP_NAME ...\033[0m"
if [ ! -f "$OUTPUT_DIR/$EXE_NAME" ]; then
  echo -e "\033[31m❌ 缺少主 exe，无法打包\033[0m" >&2
  exit 1
fi
cd "$OUTPUT_DIR"
if command -v zip >/dev/null 2>&1; then
  zip -r "$ZIP_NAME" . >/dev/null
else
  # 无 zip 命令时用 tar 生成 .zip 兼容包（或提示安装）
  echo -e "\033[31m❌ 未找到 zip 命令，请安装 zip（Debian/Ubuntu: sudo apt install zip）\033[0m" >&2
  exit 1
fi
if [ ! -f "$ZIP_PATH" ]; then
  echo -e "\033[31m❌ ZIP 打包失败\033[0m" >&2
  exit 1
fi

# 5b. 生成 SHA256SUMS（用于下载后校验，防 MITM 攻击）
echo -e "\033[33m🔐 生成 SHA256SUMS ...\033[0m"
SHA_SUMS_PATH="$OUTPUT_DIR/SHA256SUMS"
ZIP_HASH="$(sha256sum "$ZIP_PATH" | awk '{print $1}')"
echo "$ZIP_HASH  $ZIP_NAME" > "$SHA_SUMS_PATH"
echo -e "\033[90m   SHA256: $ZIP_HASH\033[0m"

# 6. 输出结果
FILE_SIZE_MB="$(du -m "$ZIP_PATH" | awk '{printf "%.1f", $1}')"
echo -e "\033[32m✅ 构建完成!\033[0m"
echo -e "\033[36m   版本: $VER_TAG\033[0m"
echo -e "\033[36m   输出: $ZIP_PATH\033[0m"
echo -e "\033[36m   大小: $FILE_SIZE_MB MB\033[0m"
echo ""
echo -e "\033[35m下一步: 在 GitHub Releases 上传 $ZIP_NAME 和 SHA256SUMS\033[0m"
echo -e "\033[35m       或添加 -skip-upload 参数跳过上传\033[0m"

# 方案 B: GitHub API（需要 GH_TOKEN 环境变量）
upload_via_api() {
  TOKEN="${GH_TOKEN:-}"
  if [ -z "$TOKEN" ] && [ -f "$HOME/.ysm-release/token.txt" ]; then
    TOKEN="$(cat "$HOME/.ysm-release/token.txt" | tr -d '[:space:]')"
  fi
  if [ -z "$TOKEN" ]; then
    echo -e "\033[33m   ⚠️ 未设置 GH_TOKEN 环境变量，跳过 GitHub 上传\033[0m" >&2
    echo -e "\033[90m   设置方法: export GH_TOKEN='ghp_xxxx'\033[0m" >&2
    echo -e "\033[90m   或写到 $HOME/.ysm-release/token.txt\033[0m" >&2
    echo -e "\033[35m   手动上传: $ZIP_PATH\033[0m" >&2
    return
  fi

  API_BASE="https://api.github.com"
  REPO_API="$API_BASE/repos/$GITHUB_OWNER/$GITHUB_REPO"

  echo -e "\033[90m   📤 创建 Release $VER_TAG ...\033[0m"

  # 创建 release（用 jq 构建 JSON，若无 jq 则用 printf 兜底）
  if command -v jq >/dev/null 2>&1; then
    RELEASE_BODY_JSON="$(jq -n --arg tag "$VER_TAG" --arg body "$RELEASE_BODY" \
      '{tag_name:$tag, target_commitish:"main", name:$tag, body:$body, draft:false, prerelease:false}')"
  else
    ESCAPED_BODY="$(printf '%s' "$RELEASE_BODY" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n')"
    RELEASE_BODY_JSON="{\"tag_name\":\"$VER_TAG\",\"target_commitish\":\"main\",\"name\":\"$VER_TAG\",\"body\":\"$ESCAPED_BODY\",\"draft\":false,\"prerelease\":false}"
  fi

  CREATE_RESP="$(curl -sS -X POST "$REPO_API/releases" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$RELEASE_BODY_JSON")"

  UPLOAD_URL="$(printf '%s' "$CREATE_RESP" | grep -o '"upload_url": *"[^"]*' | head -1 | sed 's/.*"upload_url": *"//; s/{.*//')"
  HTML_URL="$(printf '%s' "$CREATE_RESP" | grep -o '"html_url": *"[^"]*' | head -1 | sed 's/.*"html_url": *"//; s/"$//')"

  if [ -z "$UPLOAD_URL" ]; then
    echo -e "\033[31m   ❌ 创建 Release 失败: $CREATE_RESP\033[0m" >&2
    echo -e "\033[33m   请手动上传: $ZIP_PATH\033[0m" >&2
    return
  fi
  echo -e "\033[32m   ✅ Release 已创建，上传中...\033[0m"

  # 上传 zip 资产
  curl -sS -X POST "$UPLOAD_URL?name=$ZIP_NAME" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$ZIP_PATH" >/dev/null

  # 上传 SHA256SUMS
  curl -sS -X POST "$UPLOAD_URL?name=SHA256SUMS" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$SHA_SUMS_PATH" >/dev/null

  echo -e "\033[32m   ✅ 资产上传完成!\033[0m"
  if [ -n "$HTML_URL" ]; then
    echo -e "\033[36m   🌐 $HTML_URL\033[0m"
  fi
}

# ===== GitHub Release 上传 =====
if [ "$SKIP_UPLOAD" = false ]; then
  echo ""
  echo -e "\033[36m🚀 准备上传到 GitHub Releases...\033[0m"

  # 读取发版说明
  RELEASE_NOTES_PATH="$PROJECT_ROOT/docs/releases/$VER_TAG.md"
  RELEASE_BODY=""
  if [ -f "$RELEASE_NOTES_PATH" ]; then
    RELEASE_BODY="$(cat "$RELEASE_NOTES_PATH")"
    echo -e "\033[90m   📄 已读取发版说明: $RELEASE_NOTES_PATH\033[0m"
  else
    echo -e "\033[33m   ⚠️ 未找到 $RELEASE_NOTES_PATH，将使用默认说明\033[0m"
    RELEASE_BODY="YSM Model Manager $VER_TAG"
  fi

  # 优先用 gh CLI
  if command -v gh >/dev/null 2>&1; then
    echo -e "\033[90m   🔑 使用 GitHub CLI (gh) ...\033[0m"
    GH_AUTHED=false
    gh auth status >/dev/null 2>&1 && GH_AUTHED=true || true
    if [ "$GH_AUTHED" = true ]; then
      NOTES_TMP="$(mktemp)"
      printf '%s' "$RELEASE_BODY" > "$NOTES_TMP"
      echo -e "\033[90m   📤 创建 Release $VER_TAG ...\033[0m"
      if gh release create "$VER_TAG" \
          --repo "$GITHUB_OWNER/$GITHUB_REPO" \
          --title "$VER_TAG" \
          --notes-file "$NOTES_TMP" \
          "$ZIP_PATH" "$SHA_SUMS_PATH" 2>&1; then
        echo -e "\033[32m   ✅ Release 已发布: https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/tag/$VER_TAG\033[0m"
      else
        echo -e "\033[31m   ❌ gh release create 失败\033[0m" >&2
        echo -e "\033[33m   请手动上传 $ZIP_PATH\033[0m" >&2
      fi
      rm -f "$NOTES_TMP"
    else
      echo -e "\033[33m   ⚠️ gh 未登录，尝试用 GH_TOKEN 环境变量...\033[0m"
      upload_via_api
    fi
  else
    upload_via_api
  fi
fi
