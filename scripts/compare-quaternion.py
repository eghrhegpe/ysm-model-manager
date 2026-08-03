#!/usr/bin/env python3
"""
eulerToQuaternion 对比脚本
对比 Go spec.go 与 ysmview ThreeJsPayloadBuilder.cs 的四元数计算
"""

import math

# ===== Go spec.go 版本 =====
# eulerToQuaternion 对应 YSMViewer CreateBlockbenchQuaternion()
# 旋转顺序: Rx * Ry * Rz
# ！！！输入角度已经被调用方取反过！！！

def go_eulerToQuaternion(rxDeg, ryDeg, rzDeg):
    rx = rxDeg * math.pi / 180.0
    ry = ryDeg * math.pi / 180.0
    rz = rzDeg * math.pi / 180.0

    cosX = math.cos(rx)
    sinX = math.sin(rx)
    cosY = math.cos(ry)
    sinY = math.sin(ry)
    cosZ = math.cos(rz)
    sinZ = math.sin(rz)

    # M = Rx * Ry * Rz
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


# ===== ysmview C# 版本 =====
# CreateBlockbenchQuaternion(Vector3 eulerDegrees)
# 直接使用传入的欧拉角（已在 YsmLoaderService 中被转换过）
# 旋转顺序: Rx * Ry * Rz

def cs_createBlockbenchQuaternion(rxDeg, ryDeg, rzDeg):
    rx = rxDeg * math.pi / 180.0
    ry = ryDeg * math.pi / 180.0
    rz = rzDeg * math.pi / 180.0

    # Matrix4x4.CreateRotationX(rx) * Matrix4x4.CreateRotationY(ry) * Matrix4x4.CreateRotationZ(rz)
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


# ===== 测试用例 =====
# 格式: (名称, 原始欧拉角(raw), Go调用方的取反方式, ysmview调用方的取反方式)
# 注意: Go调用方是 spec.go 的 threejs.Build()
#        ysmview调用方是 ThreeJsPayloadBuilder.BuildSpecJson()
#        两者在调用前的取反方式可能不同

test_cases = [
    # (名称, raw_rx, raw_ry, raw_rz, go_sign, cs_sign)
    # Go:   eulerToQuaternion(go_sign * raw_rx, go_sign * raw_ry, go_sign * raw_rz)
    # C#:   CreateBlockbenchQuaternion(cs_sign[0]*raw_rx, cs_sign[1]*raw_ry, cs_sign[2]*raw_rz)
    ("无旋转",     0,   0,   0,  -1,  (-1, -1, -1)),
    ("纯 X 旋转",  45,   0,   0,  -1,  (-1, -1, -1)),
    ("纯 Y 旋转",   0,  45,   0,  -1,  (-1, -1, -1)),
    ("纯 Z 旋转",   0,   0,  45,  -1,  (-1, -1, +1)),  # Z 符号差异
    ("XYZ 混合",  10,  20,  30,  -1,  (-1, -1, -1)),
    ("XYZ Z取反", 10,  20,  30,  -1,  (-1, -1, +1)),  # Z 符号差异
    ("手臂扭转",   0,   0,  -30, -1,  (-1, -1, +1)),  # Z 符号差异
    ("典型骨骼",  15, -10,   5,  -1,  (-1, -1, -1)),
    ("骨骼 Z取反",15, -10,   5,  -1,  (-1, -1, +1)),  # Z 符号差异
]

# 也测试 ysmview 的完整调用链（YsmLoaderService 已经做了转换）
# ConvertBedrockRotationDoc: (-raw_rx, -raw_ry, +raw_rz)
# 然后 ThreeJsPayloadBuilder 直接传给 CreateBlockbenchQuaternion
ysmview_chain_cases = [
    ("无旋转",    0,   0,   0),
    ("纯 X",     45,   0,   0),
    ("纯 Y",      0,  45,   0),
    ("纯 Z",      0,   0,  45),
    ("XYZ 混合", 10,  20,  30),
    ("手臂扭转",  0,   0, -30),
    ("典型骨骼", 15, -10,   5),
]

print("=" * 90)
print("对比 1: Go spec.go 调用方式 vs ysmview ThreeJsPayloadBuilder 调用方式")
print(f"{'测试用例':<12} {'Go(全部取反)':<35} {'ysmv(仅Z不取反)':<35}")
print("-" * 90)

for name, rx, ry, rz, go_s, cs_s in test_cases:
    # Go: eulerToQuaternion(-rx, -ry, -rz)
    go_q = go_eulerToQuaternion(go_s * rx, go_s * ry, go_s * rz)
    # C#: CreateBlockbenchQuaternion(-rx, -ry, rz)  (Z 不取反)
    cs_q = cs_createBlockbenchQuaternion(cs_s[0] * rx, cs_s[1] * ry, cs_s[2] * rz)

    go_str = f"({go_q[0]:.4f}, {go_q[1]:.4f}, {go_q[2]:.4f}, {go_q[3]:.4f})"
    cs_str = f"({cs_q[0]:.4f}, {cs_q[1]:.4f}, {cs_q[2]:.4f}, {cs_q[3]:.4f})"
    match = " OK" if max(abs(go_q[i] - cs_q[i]) for i in range(4)) < 0.001 else " DIFF"
    print(f"{name:<12} {go_str:<35} {cs_str:<35} {match}")

print()
print("=" * 90)
print("对比 2: ysmview 完整调用链（YsmLoaderService → ThreeJsPayloadBuilder）")
print("  YsmLoaderService.ConvertBedrockRotationDoc(-rx, -ry, +rz)")
print("  → ThreeJsPayloadBuilder.CreateBlockbenchQuaternion(rx, ry, rz)  // 直接用转换后的值")
print(f"{'测试用例':<12} {'Go(全取反)':<35} {'ysmview链(取反X,Y)':<35}")
print("-" * 90)

for name, rx, ry, rz in ysmview_chain_cases:
    # Go: eulerToQuaternion(-rx, -ry, -rz)
    go_q = go_eulerToQuaternion(-rx, -ry, -rz)
    # ysmview: YsmLoaderService 做了 (-rx, -ry, +rz)，然后直接传
    # 所以 CreateBlockbenchQuaternion 收到的就是 (-rx, -ry, +rz)
    cs_q = cs_createBlockbenchQuaternion(-rx, -ry, rz)

    go_str = f"({go_q[0]:.4f}, {go_q[1]:.4f}, {go_q[2]:.4f}, {go_q[3]:.4f})"
    cs_str = f"({cs_q[0]:.4f}, {cs_q[1]:.4f}, {cs_q[2]:.4f}, {cs_q[3]:.4f})"
    match = " OK" if max(abs(go_q[i] - cs_q[i]) for i in range(4)) < 0.001 else " DIFF"
    print(f"{name:<12} {go_str:<35} {cs_str:<35} {match}")

print()
print("=" * 90)
print("对比 3: 找到匹配的组合")
print()
# 尝试各种组合直到找到与 ysmview 完整链匹配的 Go 调用方式
from itertools import product

print(f"{'原始角度':<20} {'ysmview':<35} {'最佳匹配':<35} {'符号':<10}")
print("-" * 100)

for name, rx, ry, rz in ysmview_chain_cases:
    # ysmview 完整链结果
    cs_q = cs_createBlockbenchQuaternion(-rx, -ry, rz)

    # 尝试 Go 各种符号组合
    best = None
    best_diff = float('inf')
    for sx, sy, sz in product([-1, 1], repeat=3):
        go_q = go_eulerToQuaternion(sx * rx, sy * ry, sz * rz)
        diff = max(abs(go_q[i] - cs_q[i]) for i in range(4))
        if diff < best_diff:
            best_diff = diff
            best = (sx, sy, sz, go_q)

    sign_str = f"({best[0]}, {best[1]}, {best[2]})"
    cs_str = f"({cs_q[0]:.4f}, {cs_q[1]:.4f}, {cs_q[2]:.4f}, {cs_q[3]:.4f})"
    go_str = f"({best[3][0]:.4f}, {best[3][1]:.4f}, {best[3][2]:.4f}, {best[3][3]:.4f})"
    match = " OK" if best_diff < 0.001 else " DIFF"
    print(f"{name:<20} {cs_str:<35} {go_str:<35} {sign_str:<10} {match}")

print()
print("结论：匹配 ysmview 完整链的最佳 Go 符号组合:", end=" ")
# 取第一个有结果的组合
for name, rx, ry, rz in ysmview_chain_cases:
    cs_q = cs_createBlockbenchQuaternion(-rx, -ry, rz)
    for sx, sy, sz in product([-1, 1], repeat=3):
        go_q = go_eulerToQuaternion(sx * rx, sy * ry, sz * rz)
        diff = max(abs(go_q[i] - cs_q[i]) for i in range(4))
        if diff < 0.001:
            print(f"({sx:+d}, {sy:+d}, {sz:+d})")
            break
    else:
        continue
    break
