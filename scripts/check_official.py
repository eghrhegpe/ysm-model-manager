import json
with open('creators.json', encoding='utf-8') as f:
    data = json.load(f)
for i, e in enumerate(data):
    if e.get('role') == 'official':
        print(f"{i}: {e['name']} | {e['desc']}")
