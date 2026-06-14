import json
with open('creators.json.bak', encoding='utf-8') as f:
    data = json.load(f)
nico = [e for e in data if 'nicovideo' in (e.get('type','') or '')]
print(f'nicovideo creators in backup: {len(nico)}')
for e in nico:
    print(f'  {e["name"]} type={e["type"]} tag={e.get("tag","")}')
