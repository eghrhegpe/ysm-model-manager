#!/usr/bin/env python3
"""注释质量检查。检测 AI 废话注释、JSDoc 模板残留、TODO 无编号等。"""
import argparse
import json
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
        if r.returncode == 0 and out.strip():
            return [l for l in out.strip().split("\n") if l.strip()]
    except Exception:
        pass
    return []


def parse_line(line):
    parts = line.split(":", 2)
    if len(parts) >= 3:
        ps = parts[0]
        if len(parts[0]) == 1 and parts[0].isalpha() and parts[1].startswith("/"):
            ps = parts[0] + ":" + parts[1]
            rest = parts[2]
        else:
            ps = parts[0]
            rest = parts[1] + ":" + parts[2]
        rp = rest.split(":", 1)
        if rp[0].isdigit():
            return str(ps), int(rp[0]), rp[1].strip() if len(rp) > 1 else ""
    return str(line), 0, ""


def scan_ai_fluff():
    """检测 AI 废话注释：用于/这是/检查.*是否"""
    results = []
    for src in ["go", "frontend/js"]:
        for line in rg(r"^\s*//.*\u7528\u4e8e|^\s*//.*\u8fd9\u662f|^\s*//.*\u68c0\u67e5.*\u662f\u5426",
                       src, ["*.go", "*.js"]):
            f, ln, txt = parse_line(line)
            results.append({"file": f, "line": ln, "snippet": txt, "type": "AI_fluff"})
    return results


def scan_empty_jsdoc():
    """检测空 JSDoc：@param @returns 无实质描述"""
    results = []
    for line in rg(r"@param\s+\{[^}]*\}\s+\w+\s*-?\s*$|@returns\s*\{[^}]*\}\s*$",
                   "frontend/js", ["*.js"]):
        f, ln, txt = parse_line(line)
        results.append({"file": f, "line": ln, "snippet": txt, "type": "empty_jsdoc"})
    return results


def scan_commented_code():
    """检测注释掉的代码行"""
    results = []
    for line in rg(r"^\s*//\s+(var |let |const |function |if |for |return |import |export )",
                   "frontend/js", ["*.js"]):
        f, ln, txt = parse_line(line)
        results.append({"file": f, "line": ln, "snippet": txt, "type": "commented_code"})
    return results


def scan_todo_no_ticket():
    """检测无编号的 TODO/FIXME/HACK"""
    results = []
    for src in ["go", "frontend/js"]:
        for line in rg(r"TODO|FIXME|HACK|XXX|TEMP", src, ["*.go", "*.js"]):
            # 过滤有编号的
            if "#" in line or "// nolint" in line:
                continue
            # 过滤 /go/ embedded JSON 和 vendor
            if "blocks_1_12.json" in line or "zh_cn.json" in line:
                continue
            f, ln, txt = parse_line(line)
            results.append({"file": f, "line": ln, "snippet": txt, "type": "todo_no_ticket"})
    return results


def scan_debug_log():
    """检测 console.log / fmt.Print（可能有调试残留）"""
    results = []
    for line in rg(r"console\.log|console\.debug", "frontend/js", ["*.js"]):
        f, ln, txt = parse_line(line)
        # 排除业务日志
        if "[YSM]" in txt or "[3dspec]" in txt or "[Toast]" in txt or "[sync]" in txt:
            continue
        results.append({"file": f, "line": ln, "snippet": txt, "type": "debug_log"})
    return results


def run_all():
    return {
        "AI_fluff": scan_ai_fluff(),
        "empty_jsdoc": scan_empty_jsdoc(),
        "commented_code": scan_commented_code(),
        "todo_no_ticket": scan_todo_no_ticket(),
        "debug_log": scan_debug_log(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    results = run_all()
    total = sum(len(v) for v in results.values())

    if args.json:
        results["_summary"] = {"total": total}
        out = json.dumps(results, ensure_ascii=False, indent=2)
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    else:
        print(f"========== Comment Checker ==========\n")
        for cat, items in results.items():
            name = {"AI_fluff": "AI 废话注释", "empty_jsdoc": "空 JSDoc 模板",
                    "commented_code": "注释掉的代码", "todo_no_ticket": "TODO 无编号",
                    "debug_log": "调试日志"}.get(cat, cat)
            print(f"--- {name} ({len(items)} 处) ---")
            for it in items[:8]:
                print(f"  {it['file']}:{it['line']}  {it['snippet'][:80]}")
            if len(items) > 8:
                print(f"  ... 还有 {len(items)-8} 处")
            print()
        print(f"总计: {total} 处")


if __name__ == "__main__":
    main()
