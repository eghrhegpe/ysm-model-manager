import json
with open('workshop_sites.json', encoding='utf-8') as f:
    data = json.load(f)
print(f'Sites: {len(data)}')
for s in data:
    ps = s.get('presetSearches', [])
    print(f'  {s["id"]}: {len(ps)} searches')
