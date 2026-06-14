import json
d=json.load(open(r'C:\Users\zhujieling11\ysm-model-manager\creators.json',encoding='utf-8'))
print(f'Total: {len(d)}')
print('Last 5:')
for e in d[-5:]:
    print(f'  {e["name"]} type={e.get("type","")} role={e.get("role","")}')
print('Any nicovideo:', any('nicovideo' in (e.get('type','') or '') for e in d))
