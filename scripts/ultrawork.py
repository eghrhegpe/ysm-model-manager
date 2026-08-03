#!/usr/bin/env python3
"""Ultrawork — 一键三连。顺序执行：Go 编译 → 前端构建 → 测试 → 红线审查 → Git 状态。"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PASS = "[OK]"
FAIL = "[FAIL]"


def run(cmd, cwd=None, label="", stop_on_fail=True, tail=10):
    cwd = cwd or ROOT
    sys.stdout.buffer.write(f"\n=== {label} ===\n".encode("utf-8"))
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=180)
        out = r.stdout.decode("utf-8", errors="replace") + r.stderr.decode("utf-8", errors="replace")
        if r.returncode == 0:
            sys.stdout.buffer.write(f"  {PASS} {label} passed\n".encode("utf-8"))
            return True
        else:
            sys.stdout.buffer.write(f"  {FAIL} {label} failed (showing last {tail} lines)\n".encode("utf-8"))
            for line in out.strip().split("\n")[-tail:]:
                sys.stdout.buffer.write(f"    {line}\n".encode("utf-8"))
            if stop_on_fail:
                sys.exit(1)
            return False
    except FileNotFoundError:
        print(f"  {FAIL} command not found: {cmd[0]}")
        if stop_on_fail:
            sys.exit(1)
        return False
    except subprocess.TimeoutExpired:
        print(f"  {FAIL} timeout")
        if stop_on_fail:
            sys.exit(1)
        return False


def main():
    print("========== Ultrawork ==========")

    run(["go", "build", "./go/..."], label="[1/5] Go Build")
    run(["npx", "vite", "build"], ROOT / "frontend", label="[2/5] Frontend Build")
    run(["go", "test", "./go/...", "-count=1"], label="[3/5] Go Test")
    run(["python3", "scripts/review.py"], stop_on_fail=False, label="[4/5] Code Review")
    run(["git", "status", "--short"], stop_on_fail=False, label="[5/5] Git Status")

    print(f"\n{PASS} Ultrawork complete")


if __name__ == "__main__":
    main()
