import json

# Fix desc entries where spaces were removed between name and VUP
fixes = {
    "咩栗": "MeUmy VUP、白色蓝边休闲裙",
    "早稻叽": "ChaosLive VUP、白色紧身短衣、潮妹服",
    "鈴木ヒナ": "HIMEHINA VUP、蓝色露脐吊带短裤",
    "田中ヒメ": "HIMEHINA VUP、红色金纹短旗袍",
    "天帝フォルテ": "Neo-Porte VUP",
    "嗒啦啦": "TapTap VUP个人势、白色短款偶像运动服",
    "雨海ルカ": "WeatherPlanet VUP、深蓝色学院服",
    "水星やむ": "あいまに VUP、白紫梦幻裙",
    "紫水キキ": "元ななしいんく VUP、黑色镂空街舞服",
    "泠鸢yousa": "VUP、临时映画、海盐柠檬夏裙",
    "星见时璃_Tokiri": "原创、StellaFantacy",
    "爱吃园田海味": "东方Project、LoveLive、开源分享",
    "伊洛是哥斯拉嘛": "碧蓝档案、少女前线、映素作坊成员",
    "墓野奈奈": "东方Project、可自定义服饰",
    "纸盒ALifang": "免费、付费",
    "瀛猫": "与VUP合作、梦音茶糯、花火、兰音",
}

with open('creators.json', encoding='utf-8') as f:
    data = json.load(f)

changed = 0
for entry in data:
    name = entry["name"]
    if name in fixes:
        old = entry["desc"]
        new = fixes[name]
        if old != new:
            print(f"  {name}: {old} → {new}")
            entry["desc"] = new
            changed += 1

with open('creators.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"\n✅ 修改了 {changed} 条 desc")
