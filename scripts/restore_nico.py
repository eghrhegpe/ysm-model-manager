"""从备份恢复 nicovideo + 其他丢失的条目到当前 creators.json"""
import json

with open('creators.json.bak', encoding='utf-8') as f:
    bak = json.load(f)

with open('creators.json', encoding='utf-8') as f:
    cur = json.load(f)

# 找出丢失的条目（在备份中有但当前没有的）
cur_names = set(e['name'] for e in cur)
lost = [e for e in bak if e['name'] not in cur_names]

print(f'当前: {len(cur)} 条, 备份: {len(bak)} 条')
print(f'丢失: {len(lost)} 条')

# 添加 role 字段给丢失的条目
for e in lost:
    tag = e.get('tag', '')
    types = set(e.get('type', '').split(';'))
    name = e['name']
    
    # 从备份推断 role
    if tag == 'vup':
        e['role'] = 'vup'
    elif tag == 'oc':
        e['role'] = 'oc'
    elif 'github' in types:
        e['role'] = 'repo'
    elif 'mzhouse' in types and name in [
        '明日方舟', '碧蓝航线', '赛马娘', '碧蓝档案', 'FGO',
        '东方Project', '苍蓝誓约', '兽耳科技', '崩坏3', '原神',
        '崩坏：星穹铁道', '少女前线', 'Nekopara', '绝区零',
        '鸣潮', '公主连结', '异环', '卡拉彼丘', '炼金工房',
        '华硕主板', '幻书启世录', '无限大', '机动战队',
        '战双帕弥什', '尘白禁区', '幻塔', '深空之眼',
        '交错战线', '锚点降临', '二重螺旋', '记忆法则',
        '千年之旅', '依露希尔', '少女前线2：追放',
    ]:
        e['role'] = 'official'
    else:
        e['role'] = 'creator'
    
    # 清理 desc
    import re
    d = e.get('desc', '')
    d = re.sub(r'免费(YSM|CSM)?[模型]*[分享]*', '', d)
    d = re.sub(r'YSM[模型]*[免费]*[分享]*', '', d)
    d = re.sub(r'付费YSM[模型]*', '', d)
    d = re.sub(r'付费高精度模型', '', d)
    d = re.sub(r'仅学习使用', '', d)
    d = re.sub(r'侵删', '', d)
    d = re.sub(r'模型来自网络', '', d)
    d = re.sub(r'来源于网络', '', d)
    d = re.sub(r'分享YSM模型', '', d)
    d = d.replace('，', '、').replace('／', '、').replace('（', '、').replace('）', '')
    d = re.sub(r'、+', '、', d).strip('、').strip()
    if not d:
        d = 'YSM'
    e['desc'] = d
    # Remove old tag
    if 'tag' in e:
        del e['tag']
    
    print(f'  + {e["name"]} type={e["type"]} role={e["role"]}')

# 追加到当前列表
cur.extend(lost)

with open('creators.json', 'w', encoding='utf-8') as f:
    json.dump(cur, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f'\n✅ 恢复后: {len(cur)} 条')
