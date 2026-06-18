#!/usr/bin/env python3
"""契约测试：creators.json schema 校验。
type/role 是自由标签，只校验必填字段和格式。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
JSON_FILE = ROOT / "creators.json"


def validate():
    errors = []

    if not JSON_FILE.exists():
        errors.append(f"MISSING: {JSON_FILE}")
        return errors

    data = json.loads(JSON_FILE.read_text("utf-8"))
    if not isinstance(data, list) or len(data) == 0:
        errors.append("SCHEMA: must be a non-empty array")
        return errors

    names = set()
    for i, creator in enumerate(data):
        if not isinstance(creator, dict):
            continue

        prefix = f"[{i}] {creator.get('name', '?')}"

        name = creator.get("name", "")
        if not name or not isinstance(name, str):
            errors.append(f"{prefix}: 'name' must be non-empty string")
        elif name in names:
            pass  # duplicate names are allowed (multiple source entries)
        names.add(name)

        for field in ["desc", "type", "role"]:
            val = creator.get(field, "")
            if val and not isinstance(val, str):
                errors.append(f"{prefix}: '{field}' must be string")

    return errors


def main():
    errors = validate()
    if errors:
        sys.stdout.buffer.write(f"FAILED: {len(errors)} schema violation(s) in {JSON_FILE.name}\n\n".encode("utf-8"))
        for e in errors:
            sys.stdout.buffer.write(f"  {e}\n".encode("utf-8"))
        sys.exit(1)
    else:
        sys.stdout.buffer.write(b"OK: all creators passed schema checks\n")


if __name__ == "__main__":
    main()
