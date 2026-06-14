import json
import os
script_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(script_dir, 'creators.json.bak'), encoding='utf-8') as f:
    data = json.load(f)
# Find nicovideo entries and show their JSON structure
for i, e in enumerate(data):
    if 'nicovideo' in (e.get('type','') or ''):
        print(f'Index {i}: {json.dumps(e, ensure_ascii=False)}')
