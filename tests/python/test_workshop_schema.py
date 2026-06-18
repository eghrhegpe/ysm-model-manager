#!/usr/bin/env python3
"""契约测试：workshop_sites.json schema 校验。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
JSON_FILE = ROOT / "workshop_sites.json"
VALID_GROUPS = {"search", "github", "repo"}
REQUIRED_FIELDS = ["id", "icon", "label", "url", "desc", "group"]


def validate():
    errors = []

    if not JSON_FILE.exists():
        errors.append(f"MISSING: {JSON_FILE}")
        return errors, 0

    data = json.loads(JSON_FILE.read_text("utf-8"))
    if not isinstance(data, list) or len(data) == 0:
        errors.append("SCHEMA: must be a non-empty array")
        return errors, 0

    ids = set()
    for i, site in enumerate(data):
        prefix = f"[{i}] {site.get('id', '?')}"

        for field in REQUIRED_FIELDS:
            if field not in site:
                errors.append(f"{prefix}: missing required field '{field}'")
            elif not isinstance(site.get(field), str) or not site[field]:
                errors.append(f"{prefix}: '{field}' must be non-empty string")

        tid = site.get("id", "")
        if tid:
            if tid in ids:
                errors.append(f"{prefix}: duplicate id '{tid}'")
            ids.add(tid)

        group = site.get("group", "")
        if group and group not in VALID_GROUPS:
            errors.append(f"{prefix}: 'group' must be one of {VALID_GROUPS} (got '{group}')")

        # searchUrl if present must contain {{q}} or be a valid URL
        su = site.get("searchUrl", "")
        if su and "{{q}}" not in su and not su.startswith("http"):
            errors.append(f"{prefix}: 'searchUrl' should contain {{{{q}}}} or be a URL")

        # presetSearches if present
        ps = site.get("presetSearches", [])
        if ps:
            if not isinstance(ps, list):
                errors.append(f"{prefix}: 'presetSearches' must be an array")
            else:
                for j, p in enumerate(ps):
                    if not isinstance(p, dict) or "label" not in p:
                        errors.append(f"{prefix}: presetSearches[{j}] missing 'label'")

    return errors, len(data)


def main():
    errors, count = validate()
    if errors:
        print(f"FAILED: {len(errors)} schema violation(s) in {JSON_FILE.name}\n")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print(f"OK: {count} sites, all schema checks passed")


if __name__ == "__main__":
    main()
