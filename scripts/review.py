#!/usr/bin/env python3
"""xx. xx 9 xx + x + x + Wails x."""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def rg(pattern, paths, globs=None):
    cmd = ["rg", "--no-heading", "-n", "--path-separator", "/", pattern]
    for g in (globs or []):
        cmd += ["-g", g]
    if isinstance(paths, list):
        cmd += [str(ROOT / p) for p in paths]
    else:
        cmd += [str(ROOT / paths)]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=30)
        out = r.stdout.decode("utf-8", errors="replace")
        if r.returncode == 0:
            return [l for l in out.strip().split("\n") if l.strip()]
    except Exception:
        pass
    return []


def parse_rg_line(line):
    parts = line.split(":", 2)
    if len(parts) >= 3:
        if len(parts[0]) == 1 and parts[0].isalpha() and parts[1].startswith("/"):
            path = parts[0] + ":" + parts[1]
            rest = parts[2]
        else:
            path = parts[0]
            rest = parts[1] + ":" + parts[2]
        rest_parts = rest.split(":", 1)
        if rest_parts[0].isdigit():
            return path, int(rest_parts[0]), rest_parts[1] if len(rest_parts) > 1 else ""
    return line, 0, ""


def run_checks():
    results = []

    def add(rule_id, name, lines, fix=""):
        violations = []
        for l in lines:
            path, lineno, text = parse_rg_line(l)
            violations.append({"file": str(path), "line": lineno, "snippet": text.strip()[:120]})
        results.append({"rule_id": rule_id, "name": name, "fix": fix, "count": len(violations), "violations": violations})

    add("R1", "window.__ vars",
        rg(r"window\.__", "frontend/js", ["*.js"]),
        "let + getter, PageStore")

    add("R2", "repoRoot name",
        rg(r"repoRoot", [".", "frontend/js"], ["*.go", "*.js", "*.json"]),
        "cfg.FilesRoot / filesRoot")

    add("R3", "callback .file() API",
        rg(r"\.file\s*\(", "frontend/js", ["*.js"]),
        "new Promise(...)")

    add("R4", "display none/block",
        rg(r"display:\s*(none|block)", "frontend", ["*.js", "*.css"]),
        "opacity/transform")

    add("R5", "hardcoded colors",
        rg(r"#[0-9a-f]{6}\b", "frontend", ["*.js", "*.css"]) +
        rg(r"#[0-9a-f]{3}\b", "frontend", ["*.js", "*.css"]) +
        rg(r"rgba?\(", "frontend", ["*.js", "*.css"]) +
        rg(r"hsla?\(", "frontend", ["*.js", "*.css"]),
        "CSS vars")

    add("R6", "JS in public/",
        rg(r"public/.*\.js", [".", "frontend"], ["*.md", "*.html", "*.json"]),
        "ESM import")

    add("R7", "rtype magic strings",
        rg(r'"ysm"|"mmd-skin"|"vrchat-avatar"', "frontend/js", ["*.js"]),
        "RESOURCE_TYPES")

    add("R8", "innerHTML concat",
        rg(r"innerHTML\s*=", "frontend/js", ["*.js"]),
        "esc()")

    add("R9", "manual sidebar",
        rg(r"sidebarItem|tb-btn.*title=", "frontend", ["*.js"]),
        "renderSidebar()")

    add("W1", "backslash paths",
        [l for l in rg(r"\\", "frontend/js", ["*.js"]) if "node_modules" not in l and "bus.js" not in l and "font-display" not in l],
        "/ instead of \\")

    add("W2", "window.go.main.App calls",
        rg(r"window\.go\.main\.App", "frontend/js", ["*.js"]),
        'getApp()')

    add("W3", "empty JSDoc",
        rg(r"@param\s+\{[^}]*\}\s+\w+\s*-?\s*$|@returns\s*\{[^}]*\}\s*$", "frontend/js", ["*.js"]))

    add("W4", "TODO no ticket",
        [l for l in rg(r"TODO|FIXME|HACK|XXX", [".", "go"], ["*.go"]) if "#" not in l and "nolint" not in l])

    add("W5", "async DOM race (callback sets innerHTML without stale guard)",
        rg(r"=>\s*\{[^}]*innerHTML\s*=", "frontend/js", ["*.js"]) +
        rg(r"\.(then|finally)\s*\(.*innerHTML\s*=", "frontend/js", ["*.js"]) +
        rg(r"setTimeout\s*\(.*innerHTML\s*=", "frontend/js", ["*.js"]),
        "DOM writes in async callbacks need stale-request guards (fetchDone flag)")

    return results


def output_text(results):
    out = ["========== Code Review =========="]
    for r in results:
        if r["count"] == 0:
            out.append(f"  [OK] [{r['rule_id']}] {r['name']}")
        else:
            out.append(f"  [WARN] [{r['rule_id']}] {r['name']} ({r['count']})")
            for v in r["violations"][:10]:
                out.append(f"    {v['file']}:{v['line']}  {v['snippet'][:80]}")
            if r["fix"]:
                out.append(f"    -> {r['fix']}")
    out.append(f"{'=' * 10} Review Complete {'=' * 10}")
    sys.stdout.buffer.write("\n".join(out).encode("utf-8"))
    sys.stdout.buffer.write(b"\n")


def output_json(results):
    data = json.dumps(results, ensure_ascii=False, indent=2)
    sys.stdout.buffer.write(data.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    results = run_checks()
    if args.json:
        output_json(results)
    else:
        output_text(results)


if __name__ == "__main__":
    main()
