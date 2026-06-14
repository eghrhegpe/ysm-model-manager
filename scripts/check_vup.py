import json
data = json.load(open('creators.json', encoding='utf-8'))
for i, e in enumerate(data):
    d = e['desc']
    if e.get('role') == 'vup' and ('VUP' in d or 'vup' in d):
        print(f"{i}: {e['name']} | {d}")
