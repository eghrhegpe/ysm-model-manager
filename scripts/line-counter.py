#!/usr/bin/env python3
"""代码行数统计与文件健康度分析。"""
import subprocess
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def count_lines(paths, pattern):
    """统计匹配 pattern 的文件总行数。"""
    total = 0
    for p in paths:
        for f in sorted(p.rglob(pattern)):
            if os.path.getsize(f) > 0:
                with open(f, "rb") as fh:
                    total += sum(1 for _ in fh)
    return total


def oversized_files(paths, pattern, threshold=700):
    """找出超过 threshold 行的文件。"""
    result = []
    for p in paths:
        for f in sorted(p.rglob(pattern)):
            if f.name.endswith(".min.js") or "node_modules" in f.parts:
                continue
            try:
                with open(f, "rb") as fh:
                    lines = sum(1 for _ in fh)
                    if lines > threshold:
                        result.append((lines, f, lines > 1000))
            except Exception:
                pass
    return sorted(result, reverse=True)


def package_lines(base, pattern="*.go"):
    """统计每个子目录的代码行数。"""
    stats = []
    for d in sorted(base.iterdir()):
        if d.is_dir():
            lines = sum(
                1 for f in d.rglob(pattern) if f.is_file() and os.path.getsize(f) > 0
            )
            if lines > 0:
                stats.append((d.name, lines))
    return stats


def main():
    go_dirs = [ROOT / "go"]
    go_root = ROOT  # for app.go, main.go, resource_bindings.go
    js_dir = ROOT / "frontend" / "js"
    css_dir = ROOT / "frontend" / "css"

    # === 项目总览 ===
    print("=== 项目代码统计 ===")
    go_lines = count_lines(go_dirs, "*.go")
    # 根目录 Go
    for fn in ["app.go", "main.go", "resource_bindings.go"]:
        f = ROOT / fn
        if f.exists():
            go_lines += sum(1 for _ in open(f, "rb"))
    print(f"Go:         {go_lines} 行")

    js_lines = count_lines([js_dir], "*.js")
    print(f"Frontend JS: {js_lines} 行")

    css_lines = count_lines([css_dir], "*.css")
    print(f"Frontend CSS: {css_lines} 行")

    html_lines = count_lines([ROOT / "frontend"], "*.html")
    print(f"Frontend HTML: {html_lines} 行")

    print(f"---")
    print(f"总计:       {go_lines + js_lines + css_lines + html_lines} 行")

    # === Go 包分布 ===
    print(f"\n=== Go 包行数 ===")
    for name, lines in package_lines(ROOT / "go"):
        print(f"  {name}: {lines} 行")

    # === 前端组件分布 ===
    print(f"\n=== 前端组件行数 ===")
    for name, lines in package_lines(ROOT / "frontend" / "js" / "components", "*.js"):
        print(f"  {name}: {lines} 行")

    # === 功能模块分布 ===
    print(f"\n=== 功能模块行数 ===")
    for name, lines in package_lines(ROOT / "frontend" / "js" / "features", "*.js"):
        print(f"  {name}: {lines} 行")

    # === 大文件预警 ===
    print(f"\n=== 大文件预警 (>700行) ===")
    oversized = oversized_files(go_dirs, "*.go") + oversized_files([js_dir], "*.js")
    for lines, fpath, is_red in oversized:
        tag = "RED" if is_red else "YELLOW"
        rel = fpath.relative_to(ROOT)
        print(f"  [{tag}] {rel}: {lines} 行")


if __name__ == "__main__":
    main()
