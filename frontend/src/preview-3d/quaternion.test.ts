// @vitest-environment node
// ===== quaternion.ts 单元测试（2026-09-04 覆盖率盲区补测）=====
// 背景：修好覆盖率采集后（vitest.config.ts testTimeout 治本），本文件以 77.1% 位列
// 非 vendor 文件覆盖率倒数第一，且**无独立测试文件**——77.1% 全靠 cube-mesh /
// model-group-builder 等消费方间接命中。未覆盖语句为 eulerToQuaternion 的
// 第 3、4 分支（行 55-66）：trace <= 0 且 m11 最大 / m22 最大的大角度旋转路径。
// 消费方（cube-mesh.ts:242、model-group-builder.ts:150）传入的 cube 旋转多在
// ±45° 内（恒走 trace>0 分支），故这两条路径长期裸奔；骨骼 rotation 可达 ±180°，
// 一旦经过即踩中，且四元数错误是**静默的**（不报错，只让模型姿势微妙地错）。
//
// 验证策略（三重，避免自证）：
//   1. 语义验证——用四元数旋转已知向量，比对解析解（不依赖任何外部实现）；
//   2. 交叉验证——与 Three.js Euler(order="ZYX") 逐分量比对（源码注释自称对齐它，
//      Three.js 是权威第三方实现，可捕获本仓公式写错的风险）；
//   3. 性质验证——任意角度下输出恒为单位四元数（|q| = 1）。
import { describe, it, expect } from "vitest";
import { Euler, Quaternion } from "three";
import {
  eulerToQuaternion,
  isIdentityQuat,
  hasBoneRotation,
  applyRotationIfNonIdentity,
} from "./quaternion.ts";

type Quat = [number, number, number, number];
type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
/** 浮点比较容差：度→弧度 + 开方运算累积误差，1e-12 足够严格又不脆弱 */
const EPS = 1e-12;

/**
 * 用四元数旋转向量：v' = v + 2w(qv × v) + 2(qv × (qv × v))。
 * 独立于被测实现之外写出的参考公式，用于语义验证。
 */
function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

function expectVec(actual: Vec3, expected: Vec3, label: string) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i]), `${label} 分量${i}`).toBeLessThan(1e-9);
  }
}

/** 与 Three.js Euler("ZYX") 交叉验证；四元数 q 与 -q 表同一旋转，故先对齐符号 */
function expectMatchesThree(rxDeg: number, ryDeg: number, rzDeg: number) {
  const mine = eulerToQuaternion(rxDeg, ryDeg, rzDeg);
  const ref = new Quaternion().setFromEuler(
    new Euler(rxDeg * DEG, ryDeg * DEG, rzDeg * DEG, "ZYX"),
  );
  const sign =
    mine[0] * ref.x + mine[1] * ref.y + mine[2] * ref.z + mine[3] * ref.w < 0 ? -1 : 1;
  expect(Math.abs(mine[0] - sign * ref.x), "qx").toBeLessThan(EPS);
  expect(Math.abs(mine[1] - sign * ref.y), "qy").toBeLessThan(EPS);
  expect(Math.abs(mine[2] - sign * ref.z), "qz").toBeLessThan(EPS);
  expect(Math.abs(mine[3] - sign * ref.w), "qw").toBeLessThan(EPS);
}

describe("eulerToQuaternion — 分支覆盖（4 条路径）", () => {
  // 分支 1：trace > 0（小角度，消费方 cube 旋转的常态）
  it("分支1 trace>0：45° 单轴与三轴组合", () => {
    expectMatchesThree(45, 0, 0);
    expectMatchesThree(0, 45, 0);
    expectMatchesThree(0, 0, 45);
    expectMatchesThree(30, 40, 50);
  });

  // 分支 2：trace<=0 且 m00 最大 —— rx=180° 触发（m00=1 > m11=m22=-1）
  it("分支2 m00 最大：绕 X 轴 180°", () => {
    const q = eulerToQuaternion(180, 0, 0);
    expectMatchesThree(180, 0, 0);
    // X 轴 180° 应保持 X 分量不变、翻转 Y/Z
    expectVec(rotateVec(q, [1, 0, 0]), [1, 0, 0], "X180 对 X 轴");
    expectVec(rotateVec(q, [0, 1, 0]), [0, -1, 0], "X180 对 Y 轴");
  });

  // 分支 3：trace<=0 且 m11 最大 —— ry=180° 触发（m11=1 > m00=m22=-1）
  it("分支3 m11 最大：绕 Y 轴 180°", () => {
    const q = eulerToQuaternion(0, 180, 0);
    expectMatchesThree(0, 180, 0);
    expectVec(rotateVec(q, [1, 0, 0]), [-1, 0, 0], "Y180 对 X 轴");
    expectVec(rotateVec(q, [0, 1, 0]), [0, 1, 0], "Y180 对 Y 轴");
  });

  // 分支 4：trace<=0 且 m22 最大 —— rz=180° 触发（m22=1，m00=m11=-1）
  it("分支4 else：绕 Z 轴 180°", () => {
    const q = eulerToQuaternion(0, 0, 180);
    expectMatchesThree(0, 0, 180);
    expectVec(rotateVec(q, [1, 0, 0]), [-1, 0, 0], "Z180 对 X 轴");
    expectVec(rotateVec(q, [0, 1, 0]), [0, -1, 0], "Z180 对 Y 轴");
    expectVec(rotateVec(q, [0, 0, 1]), [0, 0, 1], "Z180 对 Z 轴");
  });
});

describe("eulerToQuaternion — 旋转语义（Rz * Ry * Rx）", () => {
  it("零旋转 → 单位四元数 [0,0,0,1]", () => {
    const q0 = eulerToQuaternion(0, 0, 0);
    expectVec([q0[0], q0[1], q0[2]], [0, 0, 0], "零旋转前三分量");
    expect(q0[3]).toBeCloseTo(1, 12);
  });

  it("绕 Z 轴 90°：X 轴 → Y 轴（右手系）", () => {
    expectVec(rotateVec(eulerToQuaternion(0, 0, 90), [1, 0, 0]), [0, 1, 0], "Z90");
  });

  it("绕 Y 轴 90°：X 轴 → -Z 轴", () => {
    expectVec(rotateVec(eulerToQuaternion(0, 90, 0), [1, 0, 0]), [0, 0, -1], "Y90");
  });

  it("绕 X 轴 90°：Y 轴 → Z 轴", () => {
    expectVec(rotateVec(eulerToQuaternion(90, 0, 0), [0, 1, 0]), [0, 0, 1], "X90");
  });

  // 陷阱记录（易错点，勿删）：R(-rx,-ry,-rz) **不是** R(rx,ry,rz) 的逆。
  // R = Rz·Ry·Rx 的逆是 Rx(-rx)·Ry(-ry)·Rz(-rz)——矩阵乘序必须反转；而"各轴角度
  // 取反"只翻符号、不换乘序，两者仅在单轴旋转时等价。消费方 cube-mesh.ts:242 /
  // model-group-builder.ts:150 传的是 (-rot[0], -rot[1], rot[2])（X/Y 取反、Z 不取反），
  // 那是 Blockbench 口径约定，**不是**求逆操作，勿照此推导逆变换。
  it("旋转与其共轭（正确的逆旋转）复合后还原原向量", () => {
    const v: Vec3 = [0.3, -0.5, 0.81];
    const q = eulerToQuaternion(30, 40, 50);
    const qConj: Quat = [-q[0], -q[1], -q[2], q[3]]; // 单位四元数的逆 = 其共轭
    expectVec(rotateVec(qConj, rotateVec(q, v)), v, "q* · q 还原");
  });
});

describe("eulerToQuaternion — 单位模长（性质验证）", () => {
  // 覆盖四分支的全角度扫描：含 0/±90/±180 及三轴非零组合
  const angles = [-180, -135, -90, -45, -22.5, 0, 22.5, 45, 90, 135, 180];

  it("任意角度组合下 |q| 恒为 1", () => {
    for (const rx of angles) {
      for (const ry of angles) {
        for (const rz of angles) {
          const q = eulerToQuaternion(rx, ry, rz);
          const norm = Math.hypot(q[0], q[1], q[2], q[3]);
          expect(Math.abs(norm - 1), `(${rx},${ry},${rz}) 模长`).toBeLessThan(1e-12);
        }
      }
    }
  });

  it("全角度扫描与 Three.js Euler(ZYX) 逐分量一致", () => {
    for (const rx of angles) {
      for (const ry of angles) {
        for (const rz of angles) {
          expectMatchesThree(rx, ry, rz);
        }
      }
    }
  });
});

describe("isIdentityQuat / hasBoneRotation", () => {
  it("isIdentityQuat：单位四元数为 true，微小偏移在 epsilon 内仍为 true", () => {
    expect(isIdentityQuat([0, 0, 0, 1])).toBe(true);
    expect(isIdentityQuat([1e-10, 0, 0, 1])).toBe(true); // eps = 1e-9
    expect(isIdentityQuat([1e-8, 0, 0, 1])).toBe(false);
    expect(isIdentityQuat([0, 0, 0, -1])).toBe(false); // -1 与 1 相距 2
  });

  it("hasBoneRotation：零旋转 false，任意非零角 true，360° 归零 false", () => {
    expect(hasBoneRotation([0, 0, 0])).toBe(false);
    expect(hasBoneRotation([45, 0, 0])).toBe(true);
    expect(hasBoneRotation([0, 0, 180])).toBe(true);
    // 360° 与 0° 同姿态：三角函数周期归位后回落到单位四元数
    expect(hasBoneRotation([360, 0, 0])).toBe(false);
    expect(hasBoneRotation([0, 360, 0])).toBe(false);
    expect(hasBoneRotation([0, 0, 360])).toBe(false);
  });
});

describe("applyRotationIfNonIdentity", () => {
  const makeObj = () => ({ quaternion: { set: (..._a: number[]) => {}, value: null as Quat | null } });
  const spyObj = () => {
    const obj = makeObj();
    const calls: number[][] = [];
    obj.quaternion.set = (x: number, y: number, z: number, w: number) => {
      calls.push([x, y, z, w]);
    };
    return { obj, calls };
  };

  it("单位四元数 → 跳过赋值", () => {
    const { obj, calls } = spyObj();
    applyRotationIfNonIdentity(obj, [0, 0, 0, 1]);
    expect(calls).toHaveLength(0);
  });

  it("非单位四元数 → 赋值", () => {
    const { obj, calls } = spyObj();
    applyRotationIfNonIdentity(obj, [0, 0, 0.7071, 0.7071]);
    expect(calls).toEqual([[0, 0, 0.7071, 0.7071]]);
  });

  it("null / undefined → 跳过", () => {
    const { obj, calls } = spyObj();
    applyRotationIfNonIdentity(obj, null);
    applyRotationIfNonIdentity(obj, undefined);
    expect(calls).toHaveLength(0);
  });

  // 覆盖 quaternion.ts 行 114-117 的 `??` 兜底：稀疏数组缺尾元素时补 0/1
  it("稀疏数组（缺 w）→ 触发 ?? 兜底而非写入 undefined", () => {
    const { obj, calls } = spyObj();
    applyRotationIfNonIdentity(obj, [0.1, 0.2, 0.3] as unknown as number[]);
    expect(calls).toEqual([[0.1, 0.2, 0.3, 1]]);
  });

  it("中间元素为 undefined → ?? 补 0", () => {
    const { obj, calls } = spyObj();
    applyRotationIfNonIdentity(obj, [0.5, undefined as unknown as number, 0.5, 0.5]);
    expect(calls).toEqual([[0.5, 0, 0.5, 0.5]]);
  });
});
