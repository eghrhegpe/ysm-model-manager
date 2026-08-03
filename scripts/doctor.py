#!/usr/bin/env python3
"""项目健康诊断。一键检查 Go 编译、前端构建、文件完整性、治理红线。"""
import subprocess
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PASS = "[OK]"
FAIL = "[FAIL]"
WARN = "[WARN]"


def run(cmd, cwd=None):
    """运行命令，返回 (returncode, stdout+stderr)。"""
    cwd = cwd or ROOT
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=120)
        out = r.stdout.decode("utf-8", errors="replace")
        return r.returncode, out
    except FileNotFoundError:
        return -1, "command not found: " + cmd[0]
    except subprocess.TimeoutExpired:
        return -1, "timeout"


def check_go_build():
    print("=== Go Build ===")
    rc, out = run(["go", "build", "./go/..."])
    if rc == 0:
        print(f"  {PASS} Go build passed")
    else:
        print(f"  {FAIL} Go build failed")
        for line in out.strip().split("\n")[-5:]:
            print(f"    {line}")


def check_frontend_build():
    print("\n=== Frontend Build ===")
    # 先检查 npx 是否可用
    rc_which, _ = run(["which", "npx"])
    if rc_which != 0:
        print(f"  {WARN} npx not found in PATH — skip frontend build")
        print(f"        run manually: cd frontend && npx vite build")
        return
    rc, out = run(["npx", "vite", "build"], cwd=ROOT / "frontend")
    if rc == 0:
        print(f"  {PASS} Frontend build passed")
    else:
        print(f"  {FAIL} Frontend build failed")
        for line in out.strip().split("\n")[-5:]:
            print(f"    {line}")


def check_key_files():
    print("\n=== Key Files ===")
    files = [
        "app.go", "main.go", "wails.json", "resource_bindings.go",
        "resource_types.json", "go.mod", "reasonix.toml", "AGENTS.md",
        "frontend/index.html", "frontend/js/bus.js", "frontend/js/app-modules.js",
    ]
    for f in files:
        p = ROOT / f
        print(f"  {PASS if p.exists() else FAIL} {f}")


def check_governance():
    print("\n=== Governance Rules ===")
    issues = 0

    # 规则 1: window.__* 全局变量
    r1 = run(["grep", "-rn", r"window\.__", str(ROOT / "frontend/js/"),
              "--include=*.js", "-l"])[1].strip()
    if r1:
        issues += 1
        print(f"  {WARN} [rule1] window.__ global vars:")
        for f in r1.split("\n"):
            print(f"    {f}")

    # 规则 5: 硬编码颜色
    r5 = run(["grep", "-rn", r"#[0-9a-f]\{6\}\b", str(ROOT / "frontend/"),
              "--include=*.js", "--include=*.css"])[1].strip()
    if r5:
        issues += 1
        lines = r5.split("\n")
        print(f"  {WARN} [rule5] hardcoded colors ({len(lines)} hits, top 10):")
        for line in lines[:10]:
            print(f"    {line}")

    # 规则 8: innerHTML 拼接
    r8 = run(["grep", "-rn", r"innerHTML\s*=", str(ROOT / "frontend/js/"),
              "--include=*.js"])[1].strip()
    if r8:
        issues += 1
        print(f"  {WARN} [rule8] innerHTML concat:")
        for line in r8.split("\n"):
            print(f"    {line}")

    # Wails 调用检查
    w = run(["grep", "-rn", r"window\.go\.main\.App", str(ROOT / "frontend/js/"),
             "--include=*.js"])[1].strip()
    if w:
        issues += 1
        print(f"  {WARN} [Wails] direct window.go calls:")
        for line in w.split("\n"):
            print(f"    {line}")

    if issues == 0:
        print(f"  {PASS} all rules passed")
    else:
        print(f"  {WARN} {issues} issue(s) found")


def check_config():
    print("\n=== Config Consistency ===")
    rc, out = run(["grep", "-c", r"^\[\[plugins\]\]", str(ROOT / "reasonix.toml")])
    print(f"  reasonix.toml plugins: {rc}")

    rc, out = run(["grep", "-o", r'"name"[[:space:]]*:[[:space:]]*"[^"]*"', str(ROOT / "wails.json")])
    if rc == 0:
        name = out.strip().split("\n")[0] if out.strip() else "?"
        print(f"  {PASS} wails.json: {name}")
    else:
        print(f"  {FAIL} wails.json parse failed")


def check_git():
    print("\n=== Git Status ===")
    rc, out = run(["git", "status", "--short"])
    if out.strip():
        print(out)
    else:
        print(f"  {PASS} clean")


def main():
    print("========== YSM Doctor ==========")
    check_go_build()
    check_frontend_build()
    check_key_files()
    check_governance()
    check_config()
    check_git()
    print("\n========== Done ==========")


if __name__ == "__main__":
    main()
