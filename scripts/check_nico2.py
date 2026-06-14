import json
with open('creators.json', encoding='utf-8') as f:
    data = json.load(f)
# Old nick names - check if they still exist
old_nico = ['hololive', 'にじさんじ', '.LIVE', 'ななしいんく', '青桐高校', 'RosenArk',
    'ぶいぱい', '朝ノ姉妹', 'WeatherPlanet', '雨海ルカ', 'あいまに', '水星やむ',
    '紫水キキ', '鈴木ヒナ', '田中ヒメ', '天帝フォルテ', 'おきつねりこ', '花园Serena',
    '花之物_はなごろも', '姫熊りぼん', '九重このの', '神野たね', '桃川うさぴ',
    '天神子兎音', '巫月しお', '星降あめる', '月紫アリア', 'ハニカムニーナ',
    '雛乃木まや', '藍沢エマ']
for name in old_nico:
    found = [e for e in data if e['name'] == name]
    if found:
        print(f'  {name}: type={found[0].get("type","?")}')
    else:
        print(f'  {name}: NOT FOUND')
