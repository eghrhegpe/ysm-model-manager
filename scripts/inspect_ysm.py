#!/usr/bin/env python3
"""YSM 文件格式诊断（统一版，合并 inspect_ysm v1-v5）。
检测 YSM V3 / YSGP V2 / BOM / 加密 / 内嵌文件名。"""
import argparse
import json
import os
import sys
from pathlib import Path

SEARCH_NAMES = [b'main.json', b'arm.json', b'texture.png', b'texture2.png',
                b'left_arm.json', b'right_arm.json', b'arrow.json']


def inspect(path):
    name = os.path.basename(path)
    size = os.path.getsize(path)
    result = {"file": name, "size": size, "format": "unknown", "has_bom": False,
              "has_ysgp": False, "has_ysm": False, "has_zip": False,
              "text_sections": [], "binary_offset": 0, "embedded_files": [],
              "encrypted": False, "entropy": 0}

    with open(path, 'rb') as f:
        data = f.read(20000)

    # ZIP check
    if data[:2] == b'PK':
        result["format"] = "zip"
        result["has_zip"] = True
        return result

    # BOM + YSGP
    if data[:3] == b'\xef\xbb\xbf':
        result["has_bom"] = True
        offset = 3
        if data[offset:offset+4] == b'YSGP':
            result["format"] = "ysgp_v2"
            result["has_ysgp"] = True
            offset += 4

            # Find all === markers (text section separators)
            eq_positions = []
            pos = 0
            while True:
                pos = data.find(b'===', pos)
                if pos < 0 or pos > 10000:
                    break
                eq_positions.append(pos)
                pos += 1

            sections = []
            for p in eq_positions:
                line_start = data.rfind(b'\n', 0, p)
                line = data[line_start:p].decode('utf-8', errors='replace').strip()
                if line:
                    sections.append(line[:80])
            result["text_sections"] = sections

            if eq_positions:
                last_eq = eq_positions[-1]
                line_end = data.find(b'\n', last_eq)
                if line_end > 0:
                    result["binary_offset"] = line_end + 1

    # Raw magic check
    if data[:3] == b'YSM':
        result["has_ysm"] = True
        if result["format"] == "unknown":
            result["format"] = "ysm_v3"

    # Binary analysis
    if result["binary_offset"] > 0:
        with open(path, 'rb') as f2:
            f2.seek(result["binary_offset"])
            bin_data = f2.read(500)
        unique = len(set(bin_data[:100]))
        result["entropy"] = unique
        result["encrypted"] = unique > 60  # high entropy = likely encrypted

    # Embedded file search
    with open(path, 'rb') as f2:
        full = f2.read()
    for s in SEARCH_NAMES:
        if s in full:
            result["embedded_files"].append({"name": s.decode(), "offset": full.index(s)})

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="YSM 文件路径")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = inspect(args.path)

    if args.json:
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
    else:
        r = result
        print(f"=== {r['file']} ({r['size']} bytes) ===")
        print(f"Format: {r['format']}")
        print(f"BOM: {'yes' if r['has_bom'] else 'no'}")
        print(f"YSGP: {'yes' if r['has_ysgp'] else 'no'}")
        print(f"ZIP: {'yes' if r['has_zip'] else 'no'}")
        if r["text_sections"]:
            print(f"Text sections ({len(r['text_sections'])}):")
            for s in r["text_sections"]:
                print(f"  {s}")
        if r["binary_offset"]:
            print(f"Binary at offset: {r['binary_offset']}")
            print(f"Encrypted: {'yes' if r['encrypted'] else 'no'}")
        if r["embedded_files"]:
            print(f"Embedded files ({len(r['embedded_files'])}):")
            for ef in r["embedded_files"]:
                print(f"  {ef['name']} @ {ef['offset']}")


if __name__ == "__main__":
    main()
