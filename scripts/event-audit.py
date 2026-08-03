#!/usr/bin/env python3
"""事件注册审计。扫描 EventsOn/bus.on 注册位置是否合规。"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORRECT_FILE = "frontend/js/components/app-content/index.js"


def scan_events():
    """扫描所有 EventsOn 和 bus.on 注册位置。"""
    issues = []
    for f in sorted((ROOT / "frontend/js").rglob("*.js")):
        rel = f.relative_to(ROOT)
        text = f.read_text("utf-8", errors="replace")
        for i, line in enumerate(text.split("\n"), 1):
            stripped = line.strip()
            # 检测 EventsOn 注册
            if "EventsOn(" in stripped:
                event_name = ""
                m = re.search(r'EventsOn\("([^"]+)"', stripped)
                if m:
                    event_name = m.group(1)
                safe = str(rel).replace("\\", "/") == CORRECT_FILE
                if not safe:
                    issues.append({
                        "file": str(rel), "line": i, "code": stripped.strip()[:80],
                        "event": event_name, "type": "EventsOn",
                        "safe_location": False
                    })
            # 检测 bus.on 注册
            if re.search(r"bus\.on\(", stripped):
                event_name = ""
                m = re.search(r'bus\.on\("([^"]+)"', stripped)
                if m:
                    event_name = m.group(1)
                issues.append({
                    "file": str(rel), "line": i, "code": stripped.strip()[:80],
                    "event": event_name, "type": "bus.on",
                    "safe_location": str(rel).replace("\\", "/") == CORRECT_FILE
                })

    return issues


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    issues = scan_events()

    if args.json:
        out = {"_summary": {"total": len(issues)}, "issues": issues}
        sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False, indent=2).encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    else:
        if not issues:
            sys.stdout.buffer.write(b"No issues found\n")
            return
        for i in issues:
            flag = "OK" if i["safe_location"] else "WARN"
            sys.stdout.buffer.write(f"[{flag}] {i['file']}:{i['line']} {i['type']} `{i['event']}`\n".encode("utf-8"))


if __name__ == "__main__":
    main()
