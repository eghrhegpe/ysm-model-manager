#!/usr/bin/env python3
"""契约测试：resource_types.json schema 校验。
禁止修改本文件。AI 必须保证修改后的 JSON 能通过此测试。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
JSON_FILE = ROOT / "resource_types.json"

VALID_PREVIEWS = {"3d", "thumbnail", "none"}
VALID_DETECTORS = {"mcmeta", "shader", "ysm", "extension"}
VALID_ACTIONS = {"import", "toggle", "delete", "openFolder", "view"}
REQUIRED_FIELDS = ["id", "name", "icon", "extensions", "installDir", "instanceLevel", "preview", "detector", "actions"]


def validate():
    errors = []

    if not JSON_FILE.exists():
        errors.append(f"MISSING: {JSON_FILE}")
        return errors

    data = json.loads(JSON_FILE.read_text("utf-8"))

    if "resourceTypes" not in data:
        errors.append("SCHEMA: missing top-level 'resourceTypes' key")
        return errors

    types = data["resourceTypes"]
    if not isinstance(types, list) or len(types) == 0:
        errors.append("SCHEMA: 'resourceTypes' must be a non-empty array")
        return errors

    ids = set()
    for i, rt in enumerate(types):
        prefix = f"[{i}] {rt.get('id', '?')}"

        # 必填字段
        for field in REQUIRED_FIELDS:
            if field not in rt:
                errors.append(f"{prefix}: missing required field '{field}'")

        # id 校验
        tid = rt.get("id", "")
        if not tid:
            errors.append(f"{prefix}: 'id' must be non-empty")
        elif not all(c.isalnum() or c == '-' for c in tid):
            errors.append(f"{prefix}: 'id' must be kebab-case (got '{tid}')")
        elif tid in ids:
            errors.append(f"{prefix}: duplicate id '{tid}'")
        ids.add(tid)

        # name 校验
        if not rt.get("name", ""):
            errors.append(f"{prefix}: 'name' must be non-empty")

        # icon 校验（至少 1 字符）
        if not rt.get("icon", ""):
            errors.append(f"{prefix}: 'icon' must be non-empty")

        # extensions 校验
        exts = rt.get("extensions", [])
        if not isinstance(exts, list) or len(exts) == 0:
            errors.append(f"{prefix}: 'extensions' must be a non-empty array")
        else:
            for j, ext in enumerate(exts):
                if not isinstance(ext, str) or not ext.startswith("."):
                    errors.append(f"{prefix}: extensions[{j}] must start with '.' (got '{ext}')")

        # installDir 校验
        inst = rt.get("installDir", "")
        if inst and not inst.endswith("/") and "{instance}" not in inst:
            errors.append(f"{prefix}: 'installDir' must end with '/' (got '{inst}')")

        # instanceLevel 校验
        if not isinstance(rt.get("instanceLevel"), bool):
            errors.append(f"{prefix}: 'instanceLevel' must be boolean")

        # preview 校验
        preview = rt.get("preview", "")
        if preview not in VALID_PREVIEWS:
            errors.append(f"{prefix}: 'preview' must be one of {VALID_PREVIEWS} (got '{preview}')")

        # detector 校验
        detector = rt.get("detector", "")
        if detector not in VALID_DETECTORS:
            errors.append(f"{prefix}: 'detector' must be one of {VALID_DETECTORS} (got '{detector}')")

        # actions 校验
        actions = rt.get("actions", [])
        if not isinstance(actions, list) or len(actions) == 0:
            errors.append(f"{prefix}: 'actions' must be a non-empty array")
        else:
            for act in actions:
                if act not in VALID_ACTIONS:
                    errors.append(f"{prefix}: unknown action '{act}', must be one of {VALID_ACTIONS}")

        # configField 如果存在，必须是 PascalCase+Root
        cf = rt.get("configField", "")
        if cf and not (cf[0].isupper() and cf.endswith("Root")):
            errors.append(f"{prefix}: 'configField' should be PascalCase+Root (got '{cf}')")

    return errors


def main():
    errors = validate()
    if errors:
        print(f"FAILED: {len(errors)} schema violation(s)\n")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print(f"OK: all resource types passed schema checks")


if __name__ == "__main__":
    main()
