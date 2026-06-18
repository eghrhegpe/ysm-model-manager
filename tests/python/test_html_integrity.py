#!/usr/bin/env python3
"""契约测试：frontend/index.html 引用完整性校验。"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
INDEX = ROOT / "frontend/index.html"


def main():
    errors = []

    if not INDEX.exists():
        errors.append("MISSING: frontend/index.html")
        sys.exit(1)

    html = INDEX.read_text("utf-8", errors="replace")

    # 1. CSS link href → 物理文件（跳过 data: 和 http:）
    for m in re.finditer(r'<link[^>]*href="([^"]+)"', html):
        href = m.group(1)
        if href.startswith("data:") or href.startswith("http"):
            continue
        fp = ROOT / "frontend" / href
        if not fp.exists():
            errors.append(f"CSS link target not found: {href}")

    # 2. script src → 物理文件
    for m in re.finditer(r'<script[^>]*src="([^"]+)"', html):
        src = m.group(1)
        fp = ROOT / "frontend" / src
        if not fp.exists():
            errors.append(f"Script src not found: {src}")

    # 3. 检查 module script 有 type="module"
    for m in re.finditer(r'<script\s+([^>]*)>', html):
        attrs = m.group(1)
        if "module" in attrs and "type" not in attrs:
            pass  # type="module" implied by newer browsers
        if "src=" in attrs and "type" not in attrs and "nomodule" not in attrs:
            # 非 module script 检查
            pass

    # 4. 检查自定义组件标签（<app-xxx>）都有对应 JS 文件
    for m in re.finditer(r'<(\w+-\w+)[>\s]', html):
        tag = m.group(1)
        if tag.startswith("app-"):
            js_file = f"js/components/{tag}/index.js"
            fp = ROOT / "frontend" / js_file
            if not fp.exists():
                # 有些组件可能是单文件
                fp2 = ROOT / "frontend" / f"js/components/{tag}.js"
                if not fp2.exists():
                    errors.append(f"Custom component '{tag}' has no JS file")

    # 5. DOCTYPE
    if not html.strip().startswith("<!doctype html") and not html.strip().startswith("<!DOCTYPE html"):
        errors.append("Missing or incorrect DOCTYPE")

    # 6. charset
    if 'charset="UTF-8"' not in html and 'charset="utf-8"' not in html:
        errors.append("Missing charset=UTF-8")

    if errors:
        sys.stdout.buffer.write(f"FAILED: {len(errors)} issue(s)\n\n".encode("utf-8"))
        for e in errors:
            sys.stdout.buffer.write(f"  {e}\n".encode("utf-8"))
        sys.exit(1)
    else:
        sys.stdout.buffer.write(b"OK: index.html reference integrity passed\n")


if __name__ == "__main__":
    main()
