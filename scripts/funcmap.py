#!/usr/bin/env python3
"""提取 Go/JS 函数与类型注释，输出函数映射表。"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def extract_go_comments(filepath):
    """提取 Go 文件的注释 → 函数/类型映射。"""
    entries = []
    try:
        text = filepath.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return entries

    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # 收集连续的单行注释（// ...）
        comments = []
        while i < len(lines) and re.match(r"^\s*//", lines[i]):
            # 跳过 === 分隔线
            if "====" in lines[i] or "=====" in lines[i]:
                comments = []
                i += 1
                continue
            c = lines[i].strip()
            if c != "//":
                comments.append(c)
            i += 1

        # 检查注释后是否有函数/类型定义
        if comments and i < len(lines):
            sig = lines[i].strip()
            m = re.match(
                r"^(func\s+\([^)]*\)\s+\w+|func\s+\w+|type\s+\w+)", sig
            )
            if m:
                name = m.group(1)
                # 取第一条注释作为摘要
                summary = comments[0].lstrip("/ ")
                entries.append((filepath, i + 1, name, summary))
                comments = []
                continue

        if not comments:
            i += 1
            continue

        # 检查多行 /* ... */ JSDoc 风格的注释
        if re.match(r"^\s*/\*", line):
            jsdoc_lines = []
            while i < len(lines) and "*/" not in lines[i]:
                jsdoc_lines.append(lines[i].strip())
                i += 1
            if i < len(lines):
                jsdoc_lines.append(lines[i].strip())  # */ 行
                i += 1

            # 取 @summary 或第一行描述
            summary = ""
            for jl in jsdoc_lines:
                jl = jl.strip().lstrip("/* \t")
                if jl.startswith("@summary"):
                    summary = jl.replace("@summary", "").strip()
                    break
            if not summary:
                for jl in jsdoc_lines:
                    jl = jl.strip().lstrip("/* \t")
                    if jl and not jl.startswith("@"):
                        summary = jl[:80]
                        break

            # 检查后面是否有定义
            if i < len(lines):
                sig = lines[i].strip()
                m = re.match(
                    r"^(func\s+\([^)]*\)\s+\w+|func\s+\w+|type\s+\w+)", sig
                )
                if m:
                    name = m.group(1)
                    entries.append((filepath, i + 1, name, summary or "(no desc)"))
            continue

        i += 1

    return entries


def extract_js_comments(filepath):
    """提取 JS 文件的 JSDoc → 函数映射。"""
    entries = []
    try:
        text = filepath.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return entries

    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # 收集 JSDoc 块
        if re.match(r"^\s*/\*\*", line):
            jsdoc_lines = []
            while i < len(lines) and "*/" not in lines[i]:
                jsdoc_lines.append(lines[i].strip())
                i += 1
            if i < len(lines):
                jsdoc_lines.append(lines[i].strip())
                i += 1

            # 提取 @description 或第一行
            summary = ""
            for jl in jsdoc_lines:
                jl = jl.strip().lstrip("/* \t")
                if jl.startswith("@description"):
                    summary = jl.replace("@description", "").strip()
                    break
            if not summary:
                for jl in jsdoc_lines:
                    jl = jl.strip().lstrip("/* \t")
                    if jl and not jl.startswith("@"):
                        summary = jl[:80]
                        break

            # 跳过空行
            while i < len(lines) and not lines[i].strip():
                i += 1

            # 检查后面是否有函数定义
            if i < len(lines):
                sig = lines[i].strip()
                m = re.match(
                    r"^(export\s+)?(async\s+)?(function\s+\w+|const\s+\w+)", sig
                )
                if m:
                    name = m.group(0)
                    entries.append((filepath, i + 1, name, summary or "(no desc)"))
            continue

        # 单行 // 注释 + 函数
        m = re.match(r"^\s*//\s*(.+)$", line)
        if m:
            summary = m.group(1).strip()
            # 看下一行是否是函数定义
            if i + 1 < len(lines):
                sig = lines[i + 1].strip()
                m2 = re.match(
                    r"^(export\s+)?(async\s+)?(function\s+\w+|const\s+\w+)", sig
                )
                if m2:
                    name = m2.group(0)
                    entries.append((filepath, i + 2, name, summary))

        i += 1

    return entries


def main():
    import argparse

    parser = argparse.ArgumentParser(description="提取代码注释 → 函数映射表")
    parser.add_argument("--go", nargs="*", help="Go 文件或目录")
    parser.add_argument("--js", nargs="*", help="JS 文件或目录")
    parser.add_argument("--output", "-o", help="输出文件 (默认 stdout)")
    args = parser.parse_args()

    all_entries = []

    # 扫描 Go
    go_paths = args.go or ["go", "."]
    for p in go_paths:
        path = ROOT / p
        if path.is_file() and path.suffix == ".go":
            all_entries.extend(extract_go_comments(path))
        elif path.is_dir():
            for f in sorted(path.rglob("*.go")):
                if "node_modules" not in f.parts:
                    all_entries.extend(extract_go_comments(f))

    # 扫描 JS
    js_paths = args.js or ["frontend/js"]
    for p in js_paths:
        path = ROOT / p
        if path.is_file() and path.suffix == ".js":
            all_entries.extend(extract_js_comments(path))
        elif path.is_dir():
            for f in sorted(path.rglob("*.js")):
                if "node_modules" not in f.parts:
                    all_entries.extend(extract_js_comments(f))

    # 按文件路径排序输出
    all_entries.sort(key=lambda e: (e[0], e[1]))

    lines = ["# 函数映射表", "", "| 文件 | 行 | 签名 | 注释 |", "|------|----|------|------|"]
    for fp, lineno, name, summary in all_entries:
        rel = fp.relative_to(ROOT)
        lines.append(f"| {rel} | {lineno} | `{name}` | {summary} |")

    output = "\n".join(lines)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"已输出 {len(all_entries)} 条记录到 {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
