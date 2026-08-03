#!/usr/bin/env python3
"""三方一致性检查。对比 resource_types.json ↔ Go 常量 ↔ JS 常量。"""
import argparse
import json
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_resource_types():
    fp = ROOT / "resource_types.json"
    data = json.loads(fp.read_text("utf-8"))
    types = {}
    for rt in data["resourceTypes"]:
        types[rt["id"]] = rt
    return types


def read_js_extensions():
    fp = ROOT / "frontend/js/utils/extensions.js"
    text = fp.read_text("utf-8", errors="replace")
    # 提取 RESOURCE_EXTS 对象
    m = re.search(r"export const RESOURCE_EXTS = \{([^}]+)\}", text, re.DOTALL)
    if not m:
        return {}
    body = m.group(1)
    types = {}
    for line in body.split("\n"):
        line = line.strip().rstrip(",")
        if not line or line.startswith("//"):
            continue
        # "key": [".ext1", ".ext2"]
        m2 = re.match(r'"?(\w[\w-]*)"?\s*:\s*\[([^\]]+)\]', line)
        if m2:
            key = m2.group(1)
            exts = re.findall(r'"([^"]+)"', m2.group(2))
            types[key] = exts
    return types


def read_go_constants():
    """从 Go 源码提取静态 map（仅限 hardcoded fallback）。"""
    fp = ROOT / "go/types/extensions.go"
    text = fp.read_text("utf-8", errors="replace")
    return text  # 目前 Go 端全动态，没有静态 map


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    json_types = read_resource_types()
    js_types = read_js_extensions()

    issues = []

    # JSON → JS: 检查 JS 是否缺失类型
    for tid, rt in json_types.items():
        if tid not in js_types:
            issues.append({
                "type": "missing_in_js", "id": tid,
                "json_exts": rt["extensions"],
                "detail": f"resource_types.json 有 {tid}，但 extensions.js 没有"
            })
        else:
            js_exts = js_types[tid]
            json_exts = rt["extensions"]
            if set(js_exts) != set(json_exts):
                issues.append({
                    "type": "ext_mismatch", "id": tid,
                    "json_exts": json_exts, "js_exts": js_exts,
                    "detail": f"{tid}: JSON={json_exts} JS={js_exts}"
                })

    # JS → JSON: 检查 JS 是否有多余的类型
    for tid in js_types:
        if tid not in json_types:
            issues.append({
                "type": "extra_in_js", "id": tid,
                "js_exts": js_types[tid],
                "detail": f"extensions.js 有 {tid}，但 resource_types.json 没有"
            })

    if args.json:
        out = {"_summary": {"issues": len(issues)}, "issues": issues}
        sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False, indent=2).encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    else:
        if issues:
            for i in issues:
                sys.stdout.buffer.write(f"[{i['type']}] {i['detail']}\n".encode("utf-8"))
        else:
            sys.stdout.buffer.write("全部一致\n".encode("utf-8"))

if __name__ == "__main__":
    main()
