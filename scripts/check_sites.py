import json
with open('workshop_sites.json', encoding='utf-8') as f:
    data = json.load(f)
for s in data:
    ps = s.get("presetSearches", [])
    print(f'{s["id"]}: label={s.get("label","?")}  ps={len(ps)}')
