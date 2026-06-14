"""
creators.json 批量改造脚本：
1. 新增 role 字段（official/creator/vup/repo/oc）
2. 标准化 desc（去废话、统一顿号分隔）
3. 增量修改，保留原有结构
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / "creators.json"
BAK = ROOT / "creators.json.bak"

# ============================================================
# 1. 备份
# ============================================================
shutil.copy2(SRC, BAK)
print(f"✅ 已备份 -> {BAK}")

with open(SRC, encoding="utf-8") as f:
    creators = json.load(f)

# ============================================================
# 2. 分类规则
# ============================================================
def classify(entry):
    name = entry["name"]
    types = set(entry.get("type", "").split(";"))
    tag = entry.get("tag", "")
    desc = entry.get("desc", "")

    # 已有 tag 的保持对应 role
    if tag == "vup":
        return "vup"
    if tag == "oc":
        return "oc"

    # 模之屋官方IP
    if "mzhouse" in types and name in [
        "明日方舟", "碧蓝航线", "赛马娘", "碧蓝档案", "FGO",
        "东方Project", "苍蓝誓约", "兽耳科技", "崩坏3", "原神",
        "崩坏：星穹铁道", "少女前线", "Nekopara", "绝区零",
        "鸣潮", "公主连结", "异环", "卡拉彼丘", "炼金工房",
        "华硕主板", "幻书启世录", "无限大", "机动战队",
        "战双帕弥什", "尘白禁区", "幻塔", "深空之眼",
        "交错战线", "锚点降临", "二重螺旋", "记忆法则",
        "千年之旅", "依露希尔", "少女前线2：追放",
    ]:
        return "official"

    # GitHub 仓库
    if "github" in types:
        return "repo"

    # 剩下的都是个人创作者
    return "creator"

# ============================================================
# 3. desc 清理规则
# ============================================================
def clean_desc(desc, entry):
    """清理 desc：去掉废话，统一分隔符"""
    d = desc

    # 去掉"免费YSM"、"免费YSM模型"、"YSM模型免费分享"等垃圾词
    d = re.sub(r'免费(YSM|CSM)?[模型]*[分享]*', '', d)
    d = re.sub(r'YSM[模型]*[免费]*[分享]*', '', d)
    d = re.sub(r'付费YSM[模型]*', '', d)
    d = re.sub(r'付费高精度模型', '', d)
    d = re.sub(r'\(付费\)', '', d)
    d = re.sub(r'（付费）', '', d)
    d = re.sub(r'仅学习使用', '', d)
    d = re.sub(r'侵删', '', d)
    d = re.sub(r'模型来自网络', '', d)
    d = re.sub(r'来源于网络', '', d)
    d = re.sub(r'分享YSM模型', '', d)
    d = re.sub(r'YSM模型(免费)?(分享)?', '', d)
    d = re.sub(r'我的世界YSM[模组]*', '', d)
    d = re.sub(r'我的世界模型', '', d)
    d = re.sub(r'萌动世界', '', d)
    d = re.sub(r'YSM人模制作', '', d)
    d = re.sub(r'游戏同人', '', d)
    d = re.sub(r'订阅制', '', d)
    d = re.sub(r'开源模型', '', d)

    # 统一分隔符：/、(（等 → 、
    d = d.replace('/', '、')
    d = d.replace('/', '、')
    d = d.replace('／', '、')
    d = d.replace('（', '、')
    d = d.replace('）', '')
    d = d.replace('(', '、')
    d = d.replace(')', '')
    d = d.replace(' ', '')
    d = d.replace('　', '')
    # 等 → 去掉
    d = re.sub(r'等[的]*', '', d)

    # 去掉多余的顿号
    d = re.sub(r'、+', '、', d)
    d = d.strip('、')
    d = d.strip()

    # 如果清空后完全为空，给个默认描述
    if not d:
        types = entry.get("type", "").split(";")
        if "afdian" in types:
            d = "YSM"
        elif "bilibili" in types:
            d = "YSM"
        else:
            d = "YSM"

    return d

# ============================================================
# 4. 执行改造
# ============================================================
changes = []
for i, entry in enumerate(creators):
    old_desc = entry.get("desc", "")
    new_desc = clean_desc(old_desc, entry)

    role = classify(entry)
    old_role = entry.get("role")
    old_tag = entry.get("tag", "")

    # 记录变更
    desc_changed = new_desc != old_desc
    role_changed = old_role != role
    tag_removed = "tag" in entry and old_tag

    if desc_changed or role_changed:
        changes.append(f"#{i+1} {entry['name']}: role={old_role or '无'}→{role}" +
                       (f" desc='{old_desc}'→'{new_desc}'" if desc_changed else ""))

    entry["role"] = role
    entry["desc"] = new_desc
    # 删除旧的 tag 字段（已映射到 role）
    if "tag" in entry:
        del entry["tag"]

# ============================================================
# 5. 写回
# ============================================================
with open(SRC, "w", encoding="utf-8") as f:
    json.dump(creators, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"\n✅ 已写入 {SRC}")
print(f"📊 共 {len(creators)} 条记录")
print(f"🔄 {len(changes)} 条变更:\n")
for c in changes:
    print(f"  {c}")
