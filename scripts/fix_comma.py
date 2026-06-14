import json, re

with open('creators.json', encoding='utf-8') as f:
    data = json.load(f)

changed = 0
for entry in data:
    d = entry.get("desc", "")
    # Replace Chinese comma with 、
    if "，" in d:
        new = d.replace("，", "、")
        # Also clean multiple consecutive
        new = re.sub(r'、+', '、', new)
        new = new.strip('、').strip()
        if new != d:
            print(f"  {entry['name']}: {d} → {new}")
            entry["desc"] = new
            changed += 1

with open('creators.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"\n✅ 替换了 {changed} 条中的中文逗号→顿号")
