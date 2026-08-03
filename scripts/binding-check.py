#!/usr/bin/env python3
"""Wails Binding 签名检查。对比 Go 端导出函数 vs 前端生成的 wailsjs。"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Go 文件，搜索 func (a *App) FuncName(
GO_FILES = [
    "app.go", "app_avatar.go", "app_config.go", "app_download.go",
    "app_files.go", "app_install.go", "app_model.go", "app_scan.go",
    "app_tags.go", "app_workshop.go", "resource_bindings.go",
    "proxy.go", "wasm_decoder.go", "wasm_embed.go",
]

WAILSJS_FILE = ROOT / "frontend/wailsjs/go/main/App.js"


def extract_go_exports():
    """从 Go 源码提取所有 func (a *App) 导出函数。"""
    exports = {}
    for fname in GO_FILES:
        fp = ROOT / fname
        if not fp.exists():
            continue
        text = fp.read_text("utf-8", errors="replace")
        for m in re.finditer(r"func \(a \*App\) (\w+)\(", text):
            name = m.group(1)
            # 跳过大写开头的非导出函数（Go 惯例）
            if name[0].islower():
                continue
            if name not in exports:
                exports[name] = fp.name
    return exports


def extract_wailsjs_exports():
    """从 wailsjs App.js 提取所有导出的包装函数。"""
    exports = {}
    if not WAILSJS_FILE.exists():
        return exports
    text = WAILSJS_FILE.read_text("utf-8", errors="replace")
    for m in re.finditer(r"export function (\w+)\(", text):
        exports[m.group(1)] = WAILSJS_FILE.name
    return exports


def main():
    go_exports = extract_go_exports()
    js_exports = extract_wailsjs_exports()

    issues = []

    # Go 有但 JS 没有
    for name, f in sorted(go_exports.items()):
        if name not in js_exports:
            issues.append({"type": "missing_in_js", "func": name, "go_file": f})

    # JS 有但 Go 没有
    js_names = set(js_exports.keys())
    go_names = set(go_exports.keys())
    for name in sorted(js_names - go_names):
        issues.append({"type": "extra_in_js", "func": name, "js_file": str(WAILSJS_FILE.relative_to(ROOT))})

    out = {"_summary": {"go_functions": len(go_exports), "js_functions": len(js_exports), "issues": len(issues)}, "issues": issues}
    sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False, indent=2).encode("utf-8"))
    sys.stdout.buffer.write(b"\n")


if __name__ == "__main__":
    main()
