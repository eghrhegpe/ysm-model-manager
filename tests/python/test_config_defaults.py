#!/usr/bin/env python3
"""契约测试：AppConfig JSON 结构校验。匹配 Go types.AppConfig。"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def _config_path():
    """解析 AppConfig 实际落点（与 Go 端 configPath() 对齐）。

    Wails 3 迁移（ADR-0001 §7 #5）后配置落在 os.UserConfigDir()/YSM-Model-Manager/ysm_config.json，
    仓库根的 ysm_config.json 已被 .gitignore 排除、不再作为 canonical 位置。
    返回首个存在的候选路径；都不存在（首次运行/纯净环境）返回 None。
    """
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.path.expanduser("~/.config")
    candidates = []
    if base:
        candidates.append(Path(base) / "YSM-Model-Manager" / "ysm_config.json")
    candidates.append(ROOT / "ysm_config.json")  # 遗留位置（迁移兼容）
    for p in candidates:
        if p.exists():
            return p
    return None

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
    cfg = _config_path()
    if cfg is None:
        # 首次运行或纯净环境无配置文件，属合法状态，不视为违规
        return errors
    data = json.loads(cfg.read_text("utf-8"))

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
