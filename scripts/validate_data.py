import json
d=json.load(open(r'C:\Users\zhujieling11\ysm-model-manager\creators.json',encoding='utf-8'))
print(f'OK: {len(d)} entries')
roles={}
for e in d:
    r=e.get('role','?')
    roles[r]=roles.get(r,0)+1
print('Roles:', roles)
noRole=[e['name'] for e in d if not e.get('role')]
print(f'No role: {noRole if noRole else "none"}')
