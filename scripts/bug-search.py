#!/usr/bin/env python3
"""bug-chronicle 搜索。按关键词查找相关 bug，输出结构化摘要。"""
import argparse
import json
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUG_FILE = ROOT / "docs/architecture/bug-chronicle.md"


def load_bugs():
    """将 bug-chronicle 解析为 bug 列表。"""
    text = BUG_FILE.read_text("utf-8", errors="replace")
    bugs = []
    current = None
    current_section = ""

    for line in text.split("\n"):
        m = re.match(r"^## (\d+\.\s*.+)$", line)
        if m:
            if current:
                bugs.append(current)
            current = {"title": m.group(1), "sections": {}}
            current_section = ""
            continue

        m2 = re.match(r"^### (.+)$", line)
        if m2 and current:
            current_section = m2.group(1)
            current["sections"][current_section] = ""
            continue

        if current and current_section:
            current["sections"][current_section] += line + "\n"

    if current:
        bugs.append(current)
    return bugs


def search(keyword, bugs):
    """在 bug 列表中搜索关键词，返回匹配的 bug 子集。"""
    kw = keyword.lower()
    results = []
    for b in bugs:
        full_text = json.dumps(b, ensure_ascii=False).lower()
        if kw in full_text:
            results.append(b)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("keyword", nargs="?", help="搜索关键词")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    bugs = load_bugs()

    if args.keyword:
        results = search(args.keyword, bugs)
    else:
        results = bugs

    summary = {"total_bugs": len(bugs), "matched": len(results)}

    if args.json:
        out = {"_summary": summary, "bugs": results}
        sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False, indent=2).encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    else:
        if not args.keyword:
            print(f"共 {len(bugs)} 条 bug 记录")
            return
        print(f"关键词 '{args.keyword}' 匹配 {len(results)} 条:\n")
        for b in results:
            print(f"  ## {b['title']}")
            for sec, text in b["sections"].items():
                first_line = text.strip().split("\n")[0][:80] if text.strip() else ""
                print(f"    {sec}: {first_line}")


if __name__ == "__main__":
    main()
