#!/usr/bin/env python3
"""契约测试：wails.json + go.mod + reasonix.toml 语法与结构校验。"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def check_wails():
    errors = []
    fp = ROOT / "wails.json"
    if not fp.exists():
        errors.append("MISSING: wails.json")
        return errors

    try:
        data = json.loads(fp.read_text("utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"SYNTAX: wails.json 解析失败: {e}")
        return errors

    # Wails 3 契约：v2 平铺结构（outputfilename / frontend:* / bind）已弃用。
    # 迁移依据见 docs/architecture/adr/ADR-0001-wails3-migration.md §3。
    if not data.get("name"):
        errors.append("'name' must be non-empty")

    schema = data.get("$schema", "")
    if "v3.wails.io" not in schema:
        errors.append("'$schema' 必须指向 v3.wails.io（v2 配置不应残留）")

    frontend = data.get("frontend")
    if not isinstance(frontend, dict):
        errors.append("'frontend' 必须是对象")
    else:
        if not frontend.get("dir"):
            errors.append("'frontend.dir' must be non-empty")
        if not frontend.get("install"):
            errors.append("'frontend.install' must be non-empty")
        if not frontend.get("build"):
            errors.append("'frontend.build' must be non-empty")

    # v2 残留守卫：v3 已弃用顶层 bind 字段（service 自动发现替代）
    if "bind" in data:
        errors.append("'bind' 字段在 v3 已弃用（v2 残留，应移除）")
    return errors


def check_gomod():
    errors = []
    fp = ROOT / "go.mod"
    if not fp.exists():
        errors.append("MISSING: go.mod")
        return errors

    text = fp.read_text("utf-8", errors="replace")
    lines = text.split("\n")

    if not text.startswith("module "):
        errors.append("must start with 'module <name>'")

    go_version = None
    for line in lines:
        m = re.match(r"^go\s+(\S+)", line)
        if m:
            go_version = m.group(1)
            break
    if not go_version:
        errors.append("missing 'go X.Y.Z' version line")
    else:
        parts = go_version.split(".")
        if len(parts) >= 2:
            try:
                if int(parts[0]) < 1 or int(parts[1]) < 20:
                    errors.append(f"go version {go_version} too old, need 1.20+")
            except ValueError:
                errors.append(f"invalid go version '{go_version}'")

    require_start = require_end = -1
    for i, line in enumerate(lines):
        if re.match(r"^require\s*\($", line):
            require_start = i
        if require_start >= 0 and line.strip() == ")":
            require_end = i
            break
    if require_start < 0:
        errors.append("missing 'require (...)' block")
    elif require_end - require_start < 2:
        errors.append("too few dependencies in require block")

    return errors


def check_reasonix():
    errors = []
    fp = ROOT / "reasonix.toml"
    if not fp.exists():
        errors.append("MISSING: reasonix.toml")
        return errors

    text = fp.read_text("utf-8", errors="replace")

    if "config_version" not in text:
        errors.append("missing 'config_version'")
    if "default_model" not in text:
        errors.append("missing 'default_model'")
    if "[agent]" not in text:
        errors.append("missing [agent] section")
    if "[permissions]" not in text:
        errors.append("missing [permissions] section")
    if "[sandbox]" not in text:
        errors.append("missing [sandbox] section")
    return errors


def main():
    errors = []
    errors += [("wails.json", e) for e in check_wails()]
    errors += [("go.mod", e) for e in check_gomod()]
    errors += [("reasonix.toml", e) for e in check_reasonix()]

    if errors:
        sys.stdout.buffer.write(f"FAILED: {len(errors)} issue(s)\n\n".encode("utf-8"))
        for src, e in errors:
            sys.stdout.buffer.write(f"  [{src}] {e}\n".encode("utf-8"))
        sys.exit(1)
    else:
        sys.stdout.buffer.write(b"OK: wails.json + go.mod + reasonix.toml syntax checks passed\n")


if __name__ == "__main__":
    main()
