#!/usr/bin/env python3
"""
完整 spec 对比脚本
比较不同版本的骨骼位置/旋转计算结果

对比版本:
- v1.9.3:   rotation=(-rx,-ry,-rz), pivot=raw, cubeOrigin=raw, cubePivot=raw
- ysmview:  rotation=(-rx,-ry,+rz), pivot=-x, cubeOrigin=-x, cubePivot=-x, from.x=ox-sx
"""

import math, json

# ===== 工具函数 =====

def euler_to_quaternion(rxDeg, ryDeg, rzDeg):
    rx = rxDeg * math.pi / 180.0
    ry = ryDeg * math.pi / 180.0
    rz = rzDeg * math.pi / 180.0

    cosX = math.cos(rx)
    sinX = math.sin(rx)
    cosY = math.cos(ry)
    sinY = math.sin(ry)
    cosZ = math.cos(rz)
    sinZ = math.sin(rz)

    m00 = cosY * cosZ
    m01 = -cosY * sinZ
    m02 = sinY
    m10 = cosX*sinZ + sinX*sinY*cosZ
    m11 = cosX*cosZ - sinX*sinY*sinZ
    m12 = -sinX * cosY
    m20 = sinX*sinZ - cosX*sinY*cosZ
    m21 = sinX*cosZ + cosX*sinY*sinZ
    m22 = cosX * cosY

    trace = m00 + m11 + m22
    if trace > 0:
        s = 0.5 / math.sqrt(trace + 1.0)
        qw = 0.25 / s
        qx = (m21 - m12) * s
        qy = (m02 - m20) * s
        qz = (m10 - m01) * s
    elif m00 > m11 and m00 > m22:
        s = 2.0 * math.sqrt(1.0 + m00 - m11 - m22)
        qw = (m21 - m12) / s
        qx = 0.25 * s
        qy = (m01 + m10) / s
        qz = (m02 + m20) / s
    elif m11 > m22:
        s = 2.0 * math.sqrt(1.0 + m11 - m00 - m22)
        qw = (m02 - m20) / s
        qx = (m01 + m10) / s
        qy = 0.25 * s
        qz = (m12 + m21) / s
    else:
        s = 2.0 * math.sqrt(1.0 + m22 - m00 - m11)
        qw = (m10 - m01) / s
        qx = (m02 + m20) / s
        qy = (m12 + m21) / s
        qz = 0.25 * s
    return (qx, qy, qz, qw)

# ===== 模拟骨骼数据 =====
# 用一个典型 YSM 模型的骨骼数据

bones = [
    {"name": "Root",       "parent": "",       "pivot": [0.0, 0.0, 0.0],  "rot": [0, 0, 0]},
    {"name": "AllBody",    "parent": "Root",   "pivot": [0.0, 24.0, 0.0], "rot": [0, 0, 0]},
    {"name": "UpBody",     "parent": "AllBody","pivot": [0.0, 30.0, 0.0], "rot": [0, 0, 0]},
    {"name": "Arm",        "parent": "UpBody", "pivot": [0.0, 30.0, 0.0], "rot": [0, 0, 0]},
    {"name": "LeftArm",    "parent": "Arm",    "pivot": [-6.0, 30.0, 0.0], "rot": [0, 0, -30]},
    {"name": "RightArm",   "parent": "Arm",    "pivot": [6.0, 30.0, 0.0],  "rot": [0, 0, 30]},
    {"name": "Head",       "parent": "UpBody", "pivot": [0.0, 36.0, 0.0], "rot": [10, 15, 0]},
    {"name": "LeftLeg",    "parent": "AllBody","pivot": [-3.0, 12.0, 0.0],"rot": [0, 0, 5]},
    {"name": "RightLeg",   "parent": "AllBody","pivot": [3.0, 12.0, 0.0], "rot": [0, 0, -5]},
]

cubes = [
    # 左臂上的衣服
    {"bone": "LeftArm", "origin": [-7.0, 28.0, -1.5], "size": [2.0, 6.0, 3.0], "pivot": [-6.0, 30.0, 0.0], "rot": [0, 0, 0]},
    {"bone": "LeftArm", "origin": [-7.0, 24.0, -1.5], "size": [2.0, 4.0, 3.0], "pivot": [-6.0, 30.0, 0.0], "rot": [0, 0, 15]},
]

# ===== 计算骨骼位置 =====
def compute_bones(bones, version):
    """version: 'v193' = v1.9.3 原始, 'ysmview' = ysmview 变换"""
    pivots = {}
    for b in bones:
        if version == 'v193':
            pivots[b["name"]] = (b["pivot"][0], b["pivot"][1], b["pivot"][2])
        else:  # ysmview
            pivots[b["name"]] = (-b["pivot"][0], b["pivot"][1], b["pivot"][2])

    results = []
    for b in bones:
        bp = pivots[b["name"]]
        if b["parent"]:
            pp = pivots[b["parent"]]
            localPos = (bp[0] - pp[0], bp[1] - pp[1], bp[2] - pp[2])
        else:
            localPos = bp

        rx, ry, rz = b["rot"]
        if version == 'v193':
            rot = euler_to_quaternion(-rx, -ry, -rz)
        else:  # ysmview
            rot = euler_to_quaternion(-rx, -ry, rz)

        results.append({
            "name": b["name"],
            "parent": b["parent"] or "-",
            "localPos": localPos,
            "quat": rot,
        })
    return results

def compute_cubes(bones, cubes, version):
    pivots = {}
    for b in bones:
        if version == 'v193':
            pivots[b["name"]] = (b["pivot"][0], b["pivot"][1], b["pivot"][2])
        else:
            pivots[b["name"]] = (-b["pivot"][0], b["pivot"][1], b["pivot"][2])

    results = []
    for c in cubes:
        bp = pivots[c["bone"]]
        if version == 'v193':
            ox, oy, oz = c["origin"]
            cp = (c["pivot"][0], c["pivot"][1], c["pivot"][2])
            fx, fy, fz = ox, oy, oz
        else:
            ox, oy, oz = -c["origin"][0], c["origin"][1], c["origin"][2]
            cp = (-c["pivot"][0], c["pivot"][1], c["pivot"][2])
            fx = ox - c["size"][0]
            fy = oy
            fz = oz

        # localPosition = cubePivot - bonePivot
        meshPos = (cp[0] - bp[0], cp[1] - bp[1], cp[2] - bp[2])

        # vertices (relative to cubePivot)
        tx = fx + c["size"][0]
        ty = fy + c["size"][1]
        tz = fz + c["size"][2]
        lx = fx - cp[0]; ly = fy - cp[1]; lz = fz - cp[2]
        hx = tx - cp[0]; hy = ty - cp[1]; hz = tz - cp[2]

        rx, ry, rz = c["rot"]
        if version == 'v193':
            q = euler_to_quaternion(-rx, -ry, -rz)
        else:
            q = euler_to_quaternion(-rx, -ry, rz)

        results.append({
            "bone": c["bone"],
            "origin": (ox, oy, oz),
            "meshPos": meshPos,
            "vertRange": ((lx, ly, lz), (hx, hy, hz)),
            "quat": q,
        })
    return results


# ===== 输出对比 =====

v193_bones = compute_bones(bones, 'v193')
ysm_bones = compute_bones(bones, 'ysmview')

print("=" * 110)
print("骨骼位置/旋转对比")
print(f"{'骨骼名':<12} {'v1.9.3 localPos':<35} {'ysmview localPos':<35} {'localPos差异':<20}")
print("-" * 110)

for v193, ysm in zip(v193_bones, ysm_bones):
    lp_diff = tuple(v193["localPos"][i] - ysm["localPos"][i] for i in range(3))
    q_diff = max(abs(v193["quat"][i] - ysm["quat"][i]) for i in range(4))
    v193_s = f"({v193['localPos'][0]:.2f}, {v193['localPos'][1]:.2f}, {v193['localPos'][2]:.2f})"
    ysm_s  = f"({ysm['localPos'][0]:.2f}, {ysm['localPos'][1]:.2f}, {ysm['localPos'][2]:.2f})"
    diff_s = f"({lp_diff[0]:+.2f}, {lp_diff[1]:+.2f}, {lp_diff[2]:+.2f})"
    flag = " ***" if q_diff > 0.001 else ""
    print(f"{v193['name']:<12} {v193_s:<35} {ysm_s:<35} {diff_s:<20}{flag}")

print()
print("=" * 110)
print("立方体位置对比")
print(f"{'骨骼/部件':<16} {'v1.9.3 origin':<25} {'ysmview origin':<25} {'v1.9.3 meshPos':<25} {'ysmview meshPos':<25}")
print("-" * 110)

v193_cubes = compute_cubes(bones, cubes, 'v193')
ysm_cubes = compute_cubes(bones, cubes, 'ysmview')

for v193, ysm in zip(v193_cubes, ysm_cubes):
    o_diff = tuple(v193["origin"][i] - ysm["origin"][i] for i in range(3))
    mp_diff = tuple(v193["meshPos"][i] - ysm["meshPos"][i] for i in range(3))
    v193_o  = f"({v193['origin'][0]:.0f}, {v193['origin'][1]:.0f}, {v193['origin'][2]:.0f})"
    ysm_o   = f"({ysm['origin'][0]:.0f}, {ysm['origin'][1]:.0f}, {ysm['origin'][2]:.0f})"
    v193_mp = f"({v193['meshPos'][0]:.2f}, {v193['meshPos'][1]:.2f}, {v193['meshPos'][2]:.2f})"
    ysm_mp  = f"({ysm['meshPos'][0]:.2f}, {ysm['meshPos'][1]:.2f}, {ysm['meshPos'][2]:.2f})"
    # 显示顶点范围差异
    vr_diff = tuple(abs(v193["vertRange"][0][i] - ysm["vertRange"][0][i]) for i in range(3))
    flag = ""
    if max(vr_diff) > 0.01:
        flag = f" vertDiff=({vr_diff[0]:.1f},{vr_diff[1]:.1f},{vr_diff[2]:.1f})"
    print(f"{v193['bone']:<12} {v193_o:<25} {ysm_o:<25} {v193_mp:<25} {ysm_mp:<25}{flag}")

print()
print("=" * 110)
print("差异总结")
print(f"{'字段':<20} {'v1.9.3':<40} {'ysmview':<40}")
print("-" * 110)

for v193, ysm in zip(v193_bones, ysm_bones):
    lp_diff = max(abs(v193["localPos"][i] - ysm["localPos"][i]) for i in range(3))
    q_diff = max(abs(v193["quat"][i] - ysm["quat"][i]) for i in range(4))
    if lp_diff > 0.01 or q_diff > 0.001:
        print(f"{v193['name'] + ' localPos':<20} {str(v193['localPos']):<40} {str(ysm['localPos']):<40}")
    if q_diff > 0.001:
        print(f"{v193['name'] + ' quat':<20} {str(tuple(round(x,4) for x in v193['quat'])):<40} {str(tuple(round(x,4) for x in ysm['quat'])):<40}")
