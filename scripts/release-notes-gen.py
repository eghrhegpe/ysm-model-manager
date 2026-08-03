#!/usr/bin/env python3
"""收集 git 数据，供子智能体写发版说明。"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30, cwd=ROOT)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def collect():
    # 1. 最新 tag
    latest_tag = run(["git", "describe", "--tags", "--abbrev=0"])
    if not latest_tag:
        latest_tag = run(["git", "rev-list", "--max-parents=0", "HEAD"])

    # 2. commit 列表
    raw_log = run(["git", "log", f"{latest_tag}..HEAD", "--oneline", "--no-merges"])
    commits = []
    for line in raw_log.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split(" ", 1)
        if len(parts) == 2:
            commits.append({"hash": parts[0], "message": parts[1]})

    # 3. commit 归类
    categories = {"feat": [], "fix": [], "docs": [], "refactor": [], "test": [], "other": []}
    for c in commits:
        m = re.match(r"^(feat|fix|docs|refactor|test|perf|chore|style)", c["message"])
        key = m.group(1) if m else "other"
        if key == "perf":
            key = "feat"
        if key in categories:
            categories[key].append(c)
        else:
            categories["other"].append(c)

    # 4. diff 统计
    diff_stat = run(["git", "diff", "--stat", f"{latest_tag}..HEAD"])
    files_changed = 0
    insertions = 0
    deletions = 0
    for line in diff_stat.split("\n"):
        m = re.search(r"(\d+) files? changed", line)
        if m:
            files_changed = int(m.group(1))
        m = re.search(r"(\d+) insertions?\(\+\)", line)
        if m:
            insertions = int(m.group(1))
        m = re.search(r"(\d+) deletions?\(-\)", line)
        if m:
            deletions = int(m.group(1))

    # 5. 文件列表（按目录分组）
    changed_files = []
    raw_files = run(["git", "diff", "--name-only", f"{latest_tag}..HEAD"])
    for f in raw_files.split("\n"):
        f = f.strip()
        if f:
            changed_files.append(f)

    # 6. 目录统计
    dirs = {}
    for f in changed_files:
        parts = f.split("/")
        top = parts[0] if len(parts) > 1 else f
        dirs[top] = dirs.get(top, 0) + 1

    output = {
        "latest_tag": latest_tag,
        "commit_count": len(commits),
        "categories": {k: [c["message"] for c in v] for k, v in categories.items()},
        "stats": {
            "files_changed": files_changed,
            "insertions": insertions,
            "deletions": deletions,
        },
        "top_dirs": sorted(dirs.items(), key=lambda x: -x[1]),
        "file_list": changed_files,
    }

    # 7. 未提交改动
    raw_uncommitted = run(["git", "status", "--short"])
    uncommitted = [l for l in raw_uncommitted.split("\n") if l.strip()]
    if uncommitted:
        new_files = [l[3:].strip() for l in uncommitted if l.startswith("??")]
        modified_files = [l[3:].strip() for l in uncommitted if l[0:2].strip() and not l.startswith("??")]
        deleted_files = [l[3:].strip() for l in uncommitted if l.startswith(" D")]
        output["uncommitted"] = {
            "total": len(uncommitted),
            "new": new_files,
            "modified": modified_files,
            "deleted": deleted_files,
        }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    collect()
