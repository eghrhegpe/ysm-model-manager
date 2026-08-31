// ===== quaternion.ts — 欧拉角→四元数旋转工具 =====
// 从 cube-mesh.ts 拆出（ADR-040 ≤400 行红线），仅含自包含的四元数工具函数。
// 对齐 Go threejs/spec.go eulerToQuaternion / isIdentityQuat / hasBoneRotation。
// cube-mesh.ts 与 spec-builder.ts re-export 保兼容，消费方零改动。

// ===== eulerToQuaternion — Go threejs/spec.go eulerToQuaternion（L756-812）=====

/**
 * 欧拉角（度）→ 四元数，旋转顺序: Rz * Ry * Rx (ZYX intrinsic = XYZ extrinsic)。
 * 口径：调用方传入的是已取反角度（X/Y 取反、Z 不取反）。
 * 对齐 Blockbench Format.euler_order='ZYX'（io/format.ts:704）+ Three.js Euler(order='ZYX')。
 * ADR-042 §2.1 裁决：从 Rx×Ry×Rz（ADR-041 YSMViewer 口径）改为 Rz×Ry×Rx（Blockbench 活规范），
 * 修复三轴非零 cube 旋转顶点错位（主题正确、小部件错）。
 */
export function eulerToQuaternion(rxDeg: number, ryDeg: number, rzDeg: number): [number, number, number, number] {
  const rx = rxDeg * Math.PI / 180.0;
  const ry = ryDeg * Math.PI / 180.0;
  const rz = rzDeg * Math.PI / 180.0;

  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);

  // 3x3 rotation matrix: M = Rz * Ry * Rx (ZYX intrinsic order)
  // 展开式：M = Rz(cz,sz) × Ry(cy,sy) × Rx(cx,sx)
  const m00 = cosZ * cosY;
  const m01 = cosZ * sinY * sinX - sinZ * cosX;
  const m02 = cosZ * sinY * cosX + sinZ * sinX;
  const m10 = sinZ * cosY;
  const m11 = sinZ * sinY * sinX + cosZ * cosX;
  const m12 = sinZ * sinY * cosX - cosZ * sinX;
  const m20 = -sinY;
  const m21 = cosY * sinX;
  const m22 = cosY * cosX;

  // 旋转矩阵 → 四元数
  const trace = m00 + m11 + m22;
  let qw: number, qx: number, qy: number, qz: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  return [qx, qy, qz, qw];
}

// ===== isIdentityQuat — Go threejs/spec.go isIdentityQuat（L819-822）=====

/**
 * 判定四元数是否≈单位四元数（浮点 epsilon）。
 * 对齐 Go threejs/spec.go isIdentityQuat（L819-822）。
 */
export function isIdentityQuat(q: [number, number, number, number]): boolean {
  const eps = 1e-9;
  return Math.abs(q[0]) < eps && Math.abs(q[1]) < eps && Math.abs(q[2]) < eps && Math.abs(q[3] - 1) < eps;
}

// ===== hasBoneRotation — Go threejs/spec.go hasBoneRotation（L828-830）=====

/**
 * 判定骨骼旋转是否实际生效（四元数 ≠ 单位四元数，epsilon 口径）。
 * 对齐 Go threejs/spec.go hasBoneRotation（L828-830）。
 */
export function hasBoneRotation(rot: [number, number, number]): boolean {
  return !isIdentityQuat(eulerToQuaternion(-rot[0], -rot[1], rot[2]));
}

// ===== applyRotationIfNonIdentity — 旋转赋值工具 =====

/**
 * 若旋转四元数非单位四元数，则赋值到 Three.js 对象的 quaternion；单位四元数跳过（保持默认）。
 * 收敛 mesh.ts / mesh-builder.ts 两处同构手写判定（对 `[x,y,z,w]` 数组、严格相等口径、判后赋值）。
 * 口径保持严格相等（与原两处一致），不复用 isIdentityQuat 的 epsilon 1e-9 以免触发口径漂移。
 * @param obj Three.js 对象（Mesh/Group 等，含 .quaternion）
 * @param rot 可选的 `[x, y, z, w]` 四元数数组；null/undefined 跳过
 */
export function applyRotationIfNonIdentity(
  obj: { quaternion: { set: (x: number, y: number, z: number, w: number) => void } },
  rot: number[] | undefined | null,
): void {
  if (
    rot &&
    (rot[3] !== 1 ||
      rot[0] !== 0 ||
      rot[1] !== 0 ||
      rot[2] !== 0)
  ) {
    obj.quaternion.set(
      rot[0] ?? 0,
      rot[1] ?? 0,
      rot[2] ?? 0,
      rot[3] ?? 1,
    );
  }
}