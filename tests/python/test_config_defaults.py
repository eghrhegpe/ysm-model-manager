#!/usr/bin/env python3
"""契约测试：AppConfig JSON 结构校验。匹配 Go types.AppConfig。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
JSON_FILE = ROOT / "ysm_config.json"

# 对应 Go types.AppConfig 的 json tag
STRING_FIELDS = [
    "filesRoot", "ysmRoot", "repoRoot", "resourcepackRoot", "shaderpackRoot",
    "schematicRoot", "litematicRoot", "mmdRoot", "vrcRoot", "mcRoot",
    "linkMode", "theme", "mirror",
]
INT_FIELDS = [
    "winX", "winY", "winW", "winH", "winRelX", "winRelY", "winScrW", "winScrH",
]
ALWAYS_REQUIRED = [
    "filesRoot", "ysmRoot", "resourcepackRoot", "shaderpackRoot",
    "schematicRoot", "mmdRoot", "vrcRoot", "mcRoot",
    "linkMode", "theme", "mirror",
    "winX", "winY", "winW", "winH", "winRelX", "winRelY", "winScrW", "winScrH",
]
STRING_FIELDS = ALWAYS_REQUIRED[:11] + ["litematicRoot", "repoRoot"]
INT_FIELDS = ALWAYS_REQUIRED[11:] + ["voxelMaxBlocks"]


def validate():
    errors = []

    if not JSON_FILE.exists():
        errors.append(f"OK: no config file ({JSON_FILE.name}) — first-run state")
        return errors

    data = json.loads(JSON_FILE.read_text("utf-8"))

    for field in ALWAYS_REQUIRED:
        if field not in data:
            errors.append(f"MISSING: '{field}' not in config")
            continue

    for field in STRING_FIELDS:
        val = data.get(field)
        if val is not None and not isinstance(val, str):
            errors.append(f"TYPE: '{field}' must be string (got {type(val).__name__})")

    for field in INT_FIELDS:
        val = data.get(field)
        if val is not None and not isinstance(val, int):
            errors.append(f"TYPE: '{field}' must be int (got {type(val).__name__})")

    vm = data.get("voxelMaxBlocks")
    if vm is not None and not isinstance(vm, int):
        errors.append(f"TYPE: 'voxelMaxBlocks' must be int (got {type(vm).__name__})")

    link_mode = data.get("linkMode", "")
    if link_mode and link_mode not in ("copy", "hardlink", "symlink", ""):
        errors.append(f"VALUE: 'linkMode' must be copy/hardlink/symlink (got '{link_mode}')")

    theme = data.get("theme", "")
    valid_themes = {"cyber", "warm", "pro", "default-dark", "mint", "ocean", ""}
    if theme and theme not in valid_themes:
        errors.append(f"VALUE: 'theme' must be one of {valid_themes} (got '{theme}')")

    vr = data.get("vrcRoot", "")
    mm = data.get("mmdRoot", "")
    if vr and not mm:
        pass  # VRChat fallback to MMD is valid

    return errors


def main():
    errors = validate()
    if errors:
        sys.stdout.buffer.write(f"FAILED: {len(errors)} violation(s)\n\n".encode("utf-8"))
        for e in errors:
            sys.stdout.buffer.write(f"  {e}\n".encode("utf-8"))
        sys.exit(1)
    else:
        sys.stdout.buffer.write(b"OK: config schema checks passed\n")


if __name__ == "__main__":
    main()
