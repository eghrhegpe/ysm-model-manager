#!/usr/bin/env python3
"""Markdown 链接检查。扫所有 md 文件，验证内部链接目标是否存在。"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"node_modules", "archive", ".git", "vendor"}


def extract_links(filepath):
    """提取 md 文件中的 Markdown 链接。"""
    links = []
    try:
        text = filepath.read_text("utf-8", errors="replace")
    except Exception:
        return links

    # 匹配 [text](path) 和 [text](path "title")
    for m in re.finditer(r"\[([^\]]*)\]\(([^)\s]+(?:\s+\"[^\"]*\")?)\)", text):
        link_text = m.group(1)
        raw_path = m.group(2).split()[0]  # 去掉 title 部分
        links.append((link_text, raw_path, m.start()))

    return links


def resolve_path(filepath, raw_path):
    """将 Markdown 相对路径解析为实际文件系统路径。"""
    if raw_path.startswith("http://") or raw_path.startswith("https://"):
        return None  # 外部链接跳过
    if raw_path.startswith("#"):
        return None  # 锚点跳过
    if raw_path.startswith("/"):
        # 绝对路径从项目根开始
        candidate = ROOT / raw_path.lstrip("/")
    else:
        # 相对路径从文件目录开始
        candidate = filepath.parent / raw_path

    # 去掉 #anchor
    if "#" in candidate.name:
        candidate = candidate.parent / candidate.name.split("#")[0]

    candidate = candidate.resolve()
    return candidate


def check_links(files):
    """检查文件列表中的所有内部链接。"""
    broken = []
    ok_count = 0
    for fp in files:
        for text, raw_path, pos in extract_links(fp):
            resolved = resolve_path(fp, raw_path)
            if resolved is None:
                continue  # 外部链接
            if resolved.exists():
                ok_count += 1
            else:
                rel = fp.relative_to(ROOT)
                broken.append({
                    "file": str(rel),
                    "position": pos,
                    "link_text": text,
                    "raw_path": raw_path,
                    "resolved_path": str(resolved),
                    "type": "dir" if resolved.is_dir() else "file",
                })
    return ok_count, broken


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    # 收集所有 md 文件
    files = []
    for f in sorted(ROOT.rglob("*.md")):
        parts = f.relative_to(ROOT).parts
        if any(s in parts for s in SKIP_DIRS):
            continue
        files.append(f)

    ok, broken = check_links(files)

    if args.json:
        out = {
            "_summary": {"files_scanned": len(files), "links_ok": ok, "links_broken": len(broken)},
            "broken_links": broken,
        }
        data = json.dumps(out, ensure_ascii=False, indent=2)
        sys.stdout.buffer.write(data.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
        return
    sys.stdout.buffer.write(f"扫描 {len(files)} 个 md 文件\n有效链接: {ok}, 断链: {len(broken)}\n\n".encode("utf-8"))
    if broken:
        for b in broken:
            sys.stdout.buffer.write(f"  [BROKEN] {b['file']}: 链接 `{b['link_text']}` -> `{b['raw_path']}`\n".encode("utf-8"))
        sys.stdout.buffer.write(f"\n共 {len(broken)} 条断链\n".encode("utf-8"))
    else:
        sys.stdout.buffer.write("全部链接有效\n".encode("utf-8"))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
