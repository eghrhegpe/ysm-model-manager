import json
with open('creators.json', encoding='utf-8') as f:
    data = json.load(f)
nico = [e for e in data if 'nicovideo' in (e.get('type','') or '')]
print(f'nicovideo creators: {len(nico)}')
for e in nico:
    print(f'  {e["name"]} type={e["type"]} role={e.get("role","?")}')
