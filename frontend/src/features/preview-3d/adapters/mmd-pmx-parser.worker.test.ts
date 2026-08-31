// ===== PMX 权威解析 + 转换器测试（对齐 babylon-mmd pmxReader 权威实现）=====
// 背景：Worker 解析内核已从自研 PmxReader 切换为 babylon-mmd 权威解析器
// （vendor/babylon-mmd/pmxReader.js，@moeru/three-mmd 同源内核），产物经
// pmxObjectToResponse 转成 PmxParseResponse。本测试构造真实 PMX 二进制字节，
// 端到端验证：权威解析 → 转换 → PmxParseResponse 形状（与主线程构建契约零漂移）。
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { PmxReader } from "../vendor/babylon-mmd/pmxReader.js";
import { pmxObjectToResponse } from "./mmd-pmx-convert.ts";
import type { PmxObject } from "../vendor/babylon-mmd/pmxReader.js";
import type { PmxParseResponse } from "./mmd-pmx-parser.worker.ts";

/** 权威解析 + 转换的便捷入口（id 固定 0，断言形状与 worker 产物一致） */
async function parseResponse(buf: ArrayBuffer): Promise<PmxParseResponse> {
  return pmxObjectToResponse(await PmxReader.ParseAsync(buf), 0);
}

// ===== 字节构造工具（PMX 2.0 规范）=====

/** 动态字节写入器 */
class ByteWriter {
  private chunks: number[] = [];
  push(...bytes: number[]): void { this.chunks.push(...bytes); }
  int32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    this.push(...b);
  }
  uint16(v: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.push(...b);
  }
  /** u32 小端写（PMX 刚体索引等无符号 4 字节字段；与 uint16 对称） */
  uint32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.push(...b);
  }
  float32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.push(...b);
  }
  /** text：int32 长度 + UTF-8 字节（PMX 字符串编码） */
  text(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.int32(bytes.length);
    this.push(...bytes);
  }
  /** boneIndex（boneIndexSize=1 时 1 字节有符号） */
  boneIndex(v: number): void {
    this.push(v & 0xff);
  }
  toArrayBuffer(): ArrayBuffer {
    return new Uint8Array(this.chunks).buffer;
  }
}

/** 构造一条骨骼的完整字节（权威顺序） */
function boneBytes(opts: {
  name: string;
  englishName?: string;
  position: [number, number, number];
  parent: number;
  transformOrder?: number;
  flag: number;
  tailIsIndex?: boolean;
  tailIndex?: number;
  tailVec?: [number, number, number];
  append?: { parentIndex: number; ratio: number };
  axisLimit?: [number, number, number];
  localVector?: { x: [number, number, number]; z: [number, number, number] };
  externalParent?: number;
  ik?: {
    target: number;
    iteration: number;
    rotationConstraint: number;
    links: Array<{ boneIndex: number; limitation?: [number, number, number] }>;
  };
}): Uint8Array {
  const w = new ByteWriter();
  w.text(opts.name);
  w.text(opts.englishName ?? opts.name);
  w.float32(opts.position[0]); w.float32(opts.position[1]); w.float32(opts.position[2]);
  w.boneIndex(opts.parent);
  w.int32(opts.transformOrder ?? 0);
  w.uint16(opts.flag);
  // tailPosition：flag 0x0001 → boneIndex；否则 vec3（总是存在）
  if (opts.tailIsIndex) {
    w.boneIndex(opts.tailIndex ?? 0);
  } else {
    const v = opts.tailVec ?? [0, 0, 0];
    w.float32(v[0]); w.float32(v[1]); w.float32(v[2]);
  }
  // append transform：0x0100 HasAppendRotate | 0x0200 HasAppendMove
  if ((opts.flag & 0x0300) !== 0 && opts.append) {
    w.boneIndex(opts.append.parentIndex);
    w.float32(opts.append.ratio);
  }
  // axis limit：0x0400
  if ((opts.flag & 0x0400) !== 0 && opts.axisLimit) {
    w.float32(opts.axisLimit[0]); w.float32(opts.axisLimit[1]); w.float32(opts.axisLimit[2]);
  }
  // local vector：0x0800
  if ((opts.flag & 0x0800) !== 0 && opts.localVector) {
    w.float32(opts.localVector.x[0]); w.float32(opts.localVector.x[1]); w.float32(opts.localVector.x[2]);
    w.float32(opts.localVector.z[0]); w.float32(opts.localVector.z[1]); w.float32(opts.localVector.z[2]);
  }
  // external parent transform：0x2000
  if ((opts.flag & 0x2000) !== 0 && opts.externalParent !== undefined) {
    w.int32(opts.externalParent);
  }
  // IK：0x0020 → target + iteration(int32) + rotationConstraint(float32) + linksCount(int32) + links[]
  if ((opts.flag & 0x0020) !== 0 && opts.ik) {
    w.boneIndex(opts.ik.target);
    w.int32(opts.ik.iteration);
    w.float32(opts.ik.rotationConstraint);
    w.int32(opts.ik.links.length);
    for (const link of opts.ik.links) {
      w.boneIndex(link.boneIndex);
      if (link.limitation) {
        w.push(1); // limitation 存在标志
        w.float32(link.limitation[0]); w.float32(link.limitation[1]); w.float32(link.limitation[2]);
        // minimumAngle（3）+ maximumAngle（3）——权威实现读 6 个 float
        w.float32(0); w.float32(0); w.float32(0);
      } else {
        w.push(0);
      }
    }
  }
  return new Uint8Array(w.toArrayBuffer());
}

// ===== 测试用例 =====

describe("权威解析 + 转换 — 骨骼字节序（babylon-mmd _ParseBones 对齐）", () => {
  it("基础骨骼：读 name/position/parent/flag（BDEF 顶点 + 1 根骨骼）", async () => {
    const bone = boneBytes({
      name: "センター",
      englishName: "center",
      position: [1, 2, 3],
      parent: -1,
      transformOrder: 0,
      flag: 0,
    });
    const out = await parseResponse(buildPmx({ bones: bone }));
    expect(out.ok).toBe(true);
    expect(out.bones?.length).toBe(1);
    const b = out.bones![0];
    expect(b.name).toBe("センター");
    expect(b.position).toEqual([1, 2, 3]);
    expect(b.parentBoneIndex).toBe(-1);
    expect(b.hasIK).toBe(false);
  });

  it("两条骨骼连续：光标不错位（第二条读对 = 第一条字节序对）", async () => {
    const bones = [
      boneBytes({ name: "root", position: [0, 0, 0], parent: -1, flag: 0 }),
      boneBytes({ name: "hip", position: [10, 20, 30], parent: 0, flag: 0 }),
    ];
    const out = await parseResponse(buildPmx({ bones: new Uint8Array([...bones[0], ...bones[1]]), boneCount: 2 }));
    expect(out.bones?.length).toBe(2);
    expect(out.bones![1].name).toBe("hip");
    expect(out.bones![1].position).toEqual([10, 20, 30]);
    expect(out.bones![1].parentBoneIndex).toBe(0);
  });

  it("tailIsIndex（flag 0x0001）与 tail vec3 混排：光标不错位", async () => {
    const bones = [
      boneBytes({ name: "a", position: [0, 0, 0], parent: -1, flag: 0x0001, tailIsIndex: true, tailIndex: 1 }),
      boneBytes({ name: "b", position: [1, 1, 1], parent: 0, flag: 0, tailVec: [5, 6, 7] }),
      boneBytes({ name: "c", position: [2, 2, 2], parent: 1, flag: 0x0001, tailIsIndex: true, tailIndex: 0 }),
    ];
    const buf = new Uint8Array(bones.reduce<number[]>((acc, b) => [...acc, ...b], []));
    const out = await parseResponse(buildPmx({ bones: buf, boneCount: 3 }));
    expect(out.bones!.map((b) => b.name)).toEqual(["a", "b", "c"]);
    expect(out.bones![2].position).toEqual([2, 2, 2]);
  });

  it("IK 骨骼：读 target/iteration/rotationConstraint/links（含 limitation）", async () => {
    const bone = boneBytes({
      name: "ik_leg",
      position: [0, 0, 0],
      parent: 0,
      flag: 0x0020,
      ik: {
        target: 3,
        iteration: 4,
        rotationConstraint: 0.5,
        links: [
          { boneIndex: 1 },
          { boneIndex: 2, limitation: [0.1, 0.2, 0.3] },
        ],
      },
    });
    const out = await parseResponse(buildPmx({ bones: bone }));
    expect(out.bones![0].hasIK).toBe(true);
    expect(out.bones![0].ikTarget).toBe(3);
    expect(out.bones![0].ikIteration).toBe(4);
    expect(out.bones![0].ikRotationConstraint).toBeCloseTo(0.5);
    expect(out.bones![0].ikLinks!.length).toBe(2);
    expect(out.bones![0].ikLinks![1].boneIndex).toBe(2);
  });

  it("IK 骨骼后跟普通骨骼：IK 可选段长度正确，光标不错位", async () => {
    const bones = [
      boneBytes({
        name: "ik_a",
        position: [0, 0, 0],
        parent: -1,
        flag: 0x0020,
        ik: { target: 1, iteration: 2, rotationConstraint: 0.1, links: [{ boneIndex: 0 }] },
      }),
      boneBytes({ name: "plain", position: [9, 9, 9], parent: 0, flag: 0 }),
    ];
    const buf = new Uint8Array(bones.reduce<number[]>((acc, b) => [...acc, ...b], []));
    const out = await parseResponse(buildPmx({ bones: buf, boneCount: 2 }));
    expect(out.bones![0].hasIK).toBe(true);
    expect(out.bones![1].name).toBe("plain");
    expect(out.bones![1].position).toEqual([9, 9, 9]);
  });

  it("append(0x0300)/axisLimit(0x0400)/localVector(0x0800)/externalParent(0x2000) 可选段：光标不错位", async () => {
    const bones = [
      boneBytes({
        name: "complex",
        position: [0, 0, 0],
        parent: -1,
        flag: 0x0300 | 0x0400 | 0x0800 | 0x2000,
        append: { parentIndex: 0, ratio: 0.5 },
        axisLimit: [1, 2, 3],
        localVector: { x: [0, 1, 0], z: [0, 0, 1] },
        externalParent: 7,
      }),
      boneBytes({ name: "after", position: [4, 5, 6], parent: 0, flag: 0 }),
    ];
    const buf = new Uint8Array(bones.reduce<number[]>((acc, b) => [...acc, ...b], []));
    const out = await parseResponse(buildPmx({ bones: buf, boneCount: 2 }));
    expect(out.bones![0].name).toBe("complex");
    expect(out.bones![1].name).toBe("after");
    expect(out.bones![1].position).toEqual([4, 5, 6]);
  });

  it("非 IK flag 位（0x0002 可旋转等）不误判为 IK", async () => {
    const bone = boneBytes({ name: "rot", position: [0, 0, 0], parent: -1, flag: 0x0002 | 0x0004 | 0x0008 });
    const out = await parseResponse(buildPmx({ bones: bone }));
    expect(out.bones![0].hasIK).toBe(false);
    expect(out.bones![0].name).toBe("rot");
  });
});

// ===== 块级字节构造 helper =====

/** 构造完整 PMX 字节：头部 + 各数据块（无 blockSize 前缀，顺序 [count][data...]） */
function buildPmx(opts: {
  vertexIndexSize?: number;
  boneIndexSize?: number;
  textureIndexSize?: number;
  rigidBodyIndexSize?: number;
  vertices?: Array<{ pos: [number, number, number]; normal?: [number, number, number]; uv?: [number, number] }>;
  bones?: Uint8Array; // 已序列化骨骼区（可选，缺省不写 bone 块数据）
  boneCount?: number; // 骨骼块 count（默认 1；多根骨骼时传实际数量）
  faceCount?: number; // 面块 count = 索引总数（权威语义，非三角形数）
  faceIndices?: number[]; // 面索引数据（按 vertexIndexSize 写；缺省不写数据区）
  morphs?: Uint8Array; // 已序列化变形区（可选，缺省不写 morph 块数据）
  morphCount?: number; // morph 块 count（默认 1，与 bones 对齐；多 morph 时传实际数量）
  materials?: Uint8Array; // 已序列化材质区
  materialCount?: number; // 材质块 count（默认 1）
  rigidBodies?: Uint8Array; // 已序列化刚体区
  rigidBodyCount?: number; // 刚体块 count（默认 1）
  joints?: Uint8Array; // 已序列化关节区
  jointCount?: number; // 关节块 count（默认 1）
  displayFrames?: Uint8Array; // 已序列化显示帧区
  displayFrameCount?: number; // 显示帧块 count（默认 1）
}): ArrayBuffer {
  const w = new ByteWriter();
  // --- 头部（权威字节序）---
  w.push(0x50, 0x4d, 0x58, 0x20); // "PMX "
  w.float32(2.0);                 // version
  w.push(8);                      // globalsCount
  w.push(1);                      // encoding = UTF-8（权威：1=UTF-8，0=UTF-16LE）
  w.push(0);                      // additionalVec4Count
  w.push(opts.vertexIndexSize ?? 1); // vertexIndexSize
  w.push(opts.textureIndexSize ?? 1); // textureIndexSize
  w.push(1);                      // materialIndexSize
  w.push(opts.boneIndexSize ?? 1);  // boneIndexSize
  w.push(1);                      // morphIndexSize
  w.push(opts.rigidBodyIndexSize ?? 1); // rigidBodyIndexSize
  w.text("");                     // modelName
  w.text("");                     // englishModelName
  w.text("");                     // comment
  w.text("");                     // englishComment

  // --- 顶点块：count + 数据（无 blockSize）---
  const verts = opts.vertices ?? [];
  w.int32(verts.length);
  for (const v of verts) {
    const n = v.normal ?? [0, 0, 1];
    const uv = v.uv ?? [0, 0];
    w.float32(v.pos[0]); w.float32(v.pos[1]); w.float32(v.pos[2]);
    w.float32(n[0]); w.float32(n[1]); w.float32(n[2]);
    w.float32(uv[0]); w.float32(uv[1]);
    w.push(0); // weightType = BDEF1（权威：1 boneIndex，无 weight 字段）
    w.push(0); // boneIndex（indexSize=1）
    w.float32(0); // edgeScale
  }

  // --- 面块：count（索引总数）+ 索引数据 ---
  const faceCount = opts.faceCount ?? 0;
  w.int32(faceCount);
  if (opts.faceIndices) {
    const vis = opts.vertexIndexSize ?? 1;
    for (const idx of opts.faceIndices) {
      if (vis === 2) { w.push(idx & 0xff); w.push((idx >> 8) & 0xff); }
      else if (vis === 4) { w.uint32(idx); }
      else { w.push(idx & 0xff); }
    }
  }
  // --- 纹理块：count=0 ---
  w.int32(0);
  // --- 材质块：count + 数据 ---
  if (opts.materials) {
    w.int32(opts.materialCount ?? 1);
    w.push(...opts.materials);
  } else {
    w.int32(0);
  }
  // --- 骨骼块：count + 数据 ---
  if (opts.bones) {
    w.int32(opts.boneCount ?? 1);
    w.push(...opts.bones);
  } else {
    w.int32(0);
  }
  // --- 变形块（morph）：count + 数据 ---
  if (opts.morphs) {
    w.int32(opts.morphCount ?? 1);
    w.push(...opts.morphs);
  } else {
    w.int32(0);
  }
  // --- 显示帧块（displayFrame）：count + 数据 ---
  if (opts.displayFrames) {
    w.int32(opts.displayFrameCount ?? 1);
    w.push(...opts.displayFrames);
  } else {
    w.int32(0);
  }
  // --- 刚体块（rigidBody）：count + 数据 ---
  if (opts.rigidBodies) {
    w.int32(opts.rigidBodyCount ?? 1);
    w.push(...opts.rigidBodies);
  } else {
    w.int32(0);
  }
  // --- 关节块（joint）：count + 数据 ---
  if (opts.joints) {
    w.int32(opts.jointCount ?? 1);
    w.push(...opts.joints);
  } else {
    w.int32(0);
  }
  return w.toArrayBuffer();
}

/** 序列化一条材质（权威字段顺序，englishName 非空以覆盖光标错位场景）
 *  textureIndexSize>1 时 toonIndex 分支（sharedToon ? 1字节 : textureIndexSize）才会产生宽度差异 */
function materialBytes(opts?: { textureIndexSize?: number; sharedToon?: number; name?: string }): Uint8Array {
  const w = new ByteWriter();
  const tis = opts?.textureIndexSize ?? 1;
  w.text(opts?.name ?? "mat0"); w.text("Mat0_EN"); // name + englishName（旧实现漏读 englishName）
  w.float32(1); w.float32(1); w.float32(1); w.float32(1); // diffuse
  w.float32(0.5); w.float32(0.5); w.float32(0.5);          // specular
  w.float32(10);                                           // shininess
  w.float32(0.2); w.float32(0.2); w.float32(0.2);          // ambient
  w.push(0);                                               // flag
  w.float32(0); w.float32(0); w.float32(0); w.float32(0);  // edgeColor
  w.float32(0);                                            // edgeSize
  w.push(0); // textureIndex = -1（按 textureIndexSize 写足字节）
  if (tis === 2) w.push(0);
  w.push(0); // sphereTextureIndex
  if (tis === 2) w.push(0);
  w.push(0); // sphereMode
  const sharedToon = opts?.sharedToon ?? 0;
  w.push(sharedToon); // isSharedToon
  if (sharedToon === 1) {
    w.push(0); // toonTextureIndex（shared → 1 字节）
  } else {
    w.push(0); // toonTextureIndex（非 shared → textureIndexSize 字节）
    if (tis === 2) w.push(0);
  }
  w.text(""); // comment
  w.int32(0); // indexCount
  return new Uint8Array(w.toArrayBuffer());
}

/** 序列化一条刚体（权威字段顺序：englishName + collisionMask 2 字节） */
function rigidBodyBytes(): Uint8Array {
  const w = new ByteWriter();
  w.text("rb0"); w.text("Rb0_EN"); // name + englishName（旧实现漏读）
  w.push(0);  // boneIndex = 0
  w.push(1);  // collisionGroup
  w.push(0xff); w.push(0xff); // collisionMask（2 字节 uint16，旧实现按 1 字节读错位）
  w.push(0);  // shapeType = sphere
  w.float32(1); w.float32(1); w.float32(1); // shapeSize
  w.float32(0); w.float32(0); w.float32(0); // position
  w.float32(0); w.float32(0); w.float32(0); // rotation
  w.float32(1); // mass
  w.float32(0); // linearDamping
  w.float32(0); // angularDamping
  w.float32(0); // restitution（反発力，权威在 friction 前）
  w.float32(0.5); // friction
  w.push(0); // mode
  return new Uint8Array(w.toArrayBuffer());
}

/** 序列化一条关节（权威字段顺序：englishName + type 前移 + 无条件读全部约束）
 *  rigidBodyIndexSize>1 时索引写足宽度（>255 刚体模型，锁 jointIndexSize 复用修复） */
function jointBytes(opts?: { rigidBodyIndexSize?: number; rbA?: number; rbB?: number }): Uint8Array {
  const w = new ByteWriter();
  const ris = opts?.rigidBodyIndexSize ?? 1;
  w.text("jt0"); w.text("Jt0_EN"); // name + englishName（旧实现漏读）
  w.push(0); // type = Spring6dof
  const writeIdx = (v: number): void => {
    if (ris === 2) { w.push(v & 0xff); w.push((v >> 8) & 0xff); }
    else if (ris === 4) {
      // PMX 刚体索引按 u32 位模式序列化（0xffffffff 无刚体哨兵），
      // 显式无符号小端写；与解析侧有符号 readInt32 读回 -1 哨兵对应。
      w.uint32(v);
    }
    else { w.push(v & 0xff); }
  };
  writeIdx(opts?.rbA ?? 0);
  writeIdx(opts?.rbB ?? 1);
  w.float32(0); w.float32(0); w.float32(0); // position
  w.float32(0); w.float32(0); w.float32(0); // rotation
  w.float32(-1); w.float32(-1); w.float32(-1); // positionMin
  w.float32(1); w.float32(1); w.float32(1); // positionMax
  w.float32(-1); w.float32(-1); w.float32(-1); // rotationMin
  w.float32(1); w.float32(1); w.float32(1); // rotationMax
  w.float32(0); w.float32(0); w.float32(0); // springPosition
  w.float32(0); w.float32(0); w.float32(0); // springRotation
  return new Uint8Array(w.toArrayBuffer());
}

/** 序列化一条显示帧（权威字段顺序：name + englishName + isSpecialFrame(1) + 元素[frameType(1)+index]）
 *  旧实现漏 englishName/isSpecialFrame 且每元素多读 value(float32)——光标漂移 4 字节/元素 */
function displayFrameBytes(): Uint8Array {
  const w = new ByteWriter();
  w.text("df0"); w.text("Df0_EN"); // name + englishName（旧实现漏读）
  w.push(0);  // isSpecialFrame = false
  w.int32(2); // 2 个元素
  w.push(0); w.push(0); // frameType=0(Bone) + boneIndex=0
  w.push(1); w.push(1); // frameType=1(Morph) + morphIndex=1
  return new Uint8Array(w.toArrayBuffer());
}

// ===== 头部与块流程测试（权威无 blockSize 结构）=====
describe("权威解析 + 转换 — 头部与块流程（无 blockSize 前缀）", () => {
  it("头部正确：globalsCount=8 + 4 字符串读过后，顶点块 count 定位正确", async () => {
    const buf = buildPmx({ vertices: [{ pos: [1, 2, 3] }] });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.vertices?.count).toBe(1);
    expect(out.vertices?.positions[0]).toBeCloseTo(1);
    expect(out.vertices?.positions[1]).toBeCloseTo(2);
    expect(out.vertices?.positions[2]).toBeCloseTo(3);
  });

  it("索引大小从头部声明读（vertexIndexSize=4 时顶点块仍正确定位）", async () => {
    const buf = buildPmx({ vertexIndexSize: 4, vertices: [{ pos: [0, 0, 0] }] });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.vertices?.count).toBe(1);
  });

  it("骨骼块紧跟顶点/材质块：count 定位正确（无 blockSize 前缀顺序解析）", async () => {
    const bone = boneBytes({ name: "root", position: [0, 0, 0], parent: -1, flag: 0 });
    const buf = buildPmx({ bones: bone });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("root");
    expect(out.bones![0].parentBoneIndex).toBe(-1);
  });

  it("多顶点 + 多块：顺序解析光标不错位（顶点与骨骼数据都正确）", async () => {
    const bone = boneBytes({ name: "hip", position: [10, 20, 30], parent: 0, flag: 0 });
    const buf = buildPmx({
      vertices: [
        { pos: [1, 1, 1] },
        { pos: [2, 2, 2] },
      ],
      bones: bone,
    });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.vertices?.count).toBe(2);
    expect(out.vertices?.positions[3]).toBeCloseTo(2); // 第 2 个顶点 x
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].position).toEqual([10, 20, 30]);
  });

  it("face 非零块：count = 索引总数（非三角形数，权威 _ParseIndices 语义），光标不错位", async () => {
    // 3 个索引 = 1 个三角形：count 写 3（非 1）——旧实现 count*3 会多读 9 个索引越界
    const bone = boneBytes({ name: "afterFace", position: [5, 6, 7], parent: 0, flag: 0 });
    const buf = buildPmx({
      faceCount: 3,
      faceIndices: [0, 1, 2],
      bones: bone,
    });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.faces?.count).toBe(3);
    expect(out.faces!.indices.length).toBe(3);
    expect(Array.from(out.faces!.indices)).toEqual([0, 1, 2]);
    // face 后骨骼光标不错位（旧实现多读 3 倍索引会连累这里）
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("afterFace");
    expect(out.bones![0].position).toEqual([5, 6, 7]);
  });

  it("morph type 0/2/3 字节布局对齐权威：光标不错位（morph 后骨骼仍正确）", async () => {
    // 权威 morph 布局（babylon-mmd pmxReader）：
    //   头部 name + englishName + category(int8) + type(int8) + elementCount(int32)
    //   type 0 GroupMorph: morphIndex + ratio(float32)
    //   type 1 VertexMorph: vertexIndex + position(3×float32)
    //   type 2 BoneMorph: boneIndex + position(3) + rotation(4×float32)
    //   type 3 UvMorph: vertexIndex + offsets(4×float32)
    const w = new ByteWriter();
    w.text("m0"); w.text(""); w.push(0); w.push(0); w.int32(3); // name/english/category/type=0 GroupMorph, 3 元素
    for (let i = 0; i < 3; i++) { w.boneIndex(0); w.float32(0.5); }
    w.text("m1"); w.text(""); w.push(0); w.push(2); w.int32(1); // type=2 BoneMorph, 1 元素
    w.boneIndex(0); w.float32(1); w.float32(2); w.float32(3); w.float32(0); w.float32(0); w.float32(0); w.float32(1);
    w.text("m2"); w.text(""); w.push(0); w.push(3); w.int32(1); // type=3 UvMorph, 1 元素
    w.boneIndex(0); w.float32(0.1); w.float32(0.2); w.float32(0.3); w.float32(0.4);
    const morphs = new Uint8Array(w.toArrayBuffer());
    const bone = boneBytes({ name: "after", position: [7, 8, 9], parent: 0, flag: 0 });
    const buf = buildPmx({ bones: bone, morphs, morphCount: 3 });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.morphs?.length).toBe(3);
    expect(out.morphs![0].name).toBe("m0");
    expect(out.morphs![0].type).toBe(0);
    expect(out.morphs![1].type).toBe(2);
    expect(out.morphs![2].type).toBe(3);
    // morph 后骨骼光标不错位
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("after");
    expect(out.bones![0].position).toEqual([7, 8, 9]);
  });

  it("材质非零块（englishName 非空）：光标不错位（材质后骨骼仍正确）", async () => {
    const bone = boneBytes({ name: "matBone", position: [3, 4, 5], parent: 0, flag: 0 });
    const buf = buildPmx({ materials: materialBytes(), bones: bone });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.materials?.length).toBe(1);
    expect(out.materials![0].name).toBe("mat0");
    // 材质后骨骼光标不错位（若漏读 englishName 会偏移）
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("matBone");
    expect(out.bones![0].position).toEqual([3, 4, 5]);
  });

  it("textureIndexSize=2：toonIndex 条件分支（sharedToon 1字节 vs 2字节）光标不错位", async () => {
    const mShared = materialBytes({ textureIndexSize: 2, sharedToon: 1, name: "shared" });
    const mPlain = materialBytes({ textureIndexSize: 2, sharedToon: 0, name: "plain" });
    const bone = boneBytes({ name: "after2", position: [1, 2, 3], parent: 0, flag: 0 });
    const buf = buildPmx({
      textureIndexSize: 2,
      materials: new Uint8Array([...mShared, ...mPlain]),
      materialCount: 2,
      bones: bone,
    });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.materials?.length).toBe(2);
    expect(out.materials![0].name).toBe("shared");
    expect(out.materials![0].sharedToon).toBe(1);
    expect(out.materials![1].name).toBe("plain");
    expect(out.materials![1].sharedToon).toBe(0);
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("after2");
    expect(out.bones![0].position).toEqual([1, 2, 3]);
  });

  it("刚体非零块（englishName + collisionMask 2 字节）：光标不错位（刚体后关节仍正确）", async () => {
    const buf = buildPmx({
      rigidBodies: rigidBodyBytes(),
      joints: jointBytes(),
    });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.rigidBodies?.length).toBe(1);
    expect(out.rigidBodies![0].name).toBe("rb0");
    expect(out.rigidBodies![0].collisionGroup).toBe(0xffff); // 2 字节 mask 读全
    // 刚体物理参数：restitution 在 friction 前（权威顺序）——锁字段交换回归
    expect(out.rigidBodies![0].restitution).toBe(0);
    expect(out.rigidBodies![0].friction).toBeCloseTo(0.5);
    // 刚体后关节光标不错位
    expect(out.joints?.length).toBe(1);
    expect(out.joints![0].name).toBe("jt0");
    expect(out.joints![0].rigidBodyIndexA).toBe(0);
    expect(out.joints![0].rigidBodyIndexB).toBe(1);
  });

  it("rigidBodyIndexSize=2：关节索引按 2 字节读（>255 刚体模型）", async () => {
    const jt = jointBytes({ rigidBodyIndexSize: 2, rbA: 0x0102, rbB: 0x7fff });
    const buf = buildPmx({ rigidBodyIndexSize: 2, joints: jt });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.joints?.length).toBe(1);
    expect(out.joints![0].rigidBodyIndexA).toBe(0x0102);
    expect(out.joints![0].rigidBodyIndexB).toBe(0x7fff);
  });

  it("rigidBodyIndexSize=4：关节索引按 4 字节读（含 0xffffffff 位模式，锁有符号读哨兵）", async () => {
    const jt = jointBytes({ rigidBodyIndexSize: 4, rbA: 0xffffffff, rbB: 0x00000100 });
    const buf = buildPmx({ rigidBodyIndexSize: 4, joints: jt });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.joints?.length).toBe(1);
    // 4 字节位模式 0xffffffff：权威按 getInt32 有符号读（babylon-mmd _getNonVertexIndex），
    // PMX 无刚体哨兵 = -1。0x100 读回完整。
    expect(out.joints![0].rigidBodyIndexA).toBe(-1);
    expect(out.joints![0].rigidBodyIndexB).toBe(0x100);
  });

  it("displayFrame 非零块（englishName + isSpecialFrame + 元素无多余 value）：光标不错位", async () => {
    const df = displayFrameBytes();
    const rb = rigidBodyBytes();
    const jt = jointBytes();
    const buf = buildPmx({
      displayFrames: df,
      rigidBodies: rb,
      joints: jt,
    });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.displayFrames?.length).toBe(1);
    expect(out.displayFrames![0].name).toBe("df0");
    expect(out.displayFrames![0].elements.length).toBe(2);
    expect(out.displayFrames![0].elements[0].value).toBe(0); // frameType=Bone
    expect(out.displayFrames![0].elements[1].value).toBe(1); // frameType=Morph
    // displayFrame 后 rigidBody/joint 光标不错位
    expect(out.rigidBodies?.length).toBe(1);
    expect(out.rigidBodies![0].name).toBe("rb0");
    expect(out.joints?.length).toBe(1);
    expect(out.joints![0].name).toBe("jt0");
  });

  it("编码字节 1=UTF-8：非 ASCII 名字正确解码（权威映射 0=UTF-16LE/1=UTF-8）", async () => {
    const bone = boneBytes({ name: "センター", position: [0, 0, 0], parent: -1, flag: 0 });
    const buf = buildPmx({ bones: bone });
    const out = await parseResponse(buf);
    expect(out.ok).toBe(true);
    expect(out.bones?.[0].name).toBe("センター");
  });
});

// ===== 转换器单测（合成 PmxObject → pmxObjectToResponse，不经过字节解析）=====
describe("pmxObjectToResponse — 转换器（权威 PmxObject → PmxParseResponse）", () => {
  /** 最小合成 PmxObject（默认空数据，用例按需覆盖字段） */
  function syntheticPmx(overrides?: Partial<PmxObject>): PmxObject {
    return {
      header: {
        signature: "PMX ",
        version: 2.0,
        globalsCount: 8,
        encoding: 1, // UTF-8
        additionalVec4Count: 0,
        vertexIndexSize: 1,
        textureIndexSize: 1,
        materialIndexSize: 1,
        boneIndexSize: 1,
        morphIndexSize: 1,
        rigidBodyIndexSize: 1,
      },
      vertices: [],
      indices: new Uint8Array([0, 1, 2]),
      textures: [],
      materials: [],
      bones: [],
      morphs: [],
      displayFrames: [],
      rigidBodies: [],
      joints: [],
      softBodies: [],
      ...overrides,
    };
  }

  /** 合成一个 BDEF 顶点（weightType + boneWeight 由用例传入） */
  function vertex(weightType: number, boneWeight: PmxObject["vertices"][number]["boneWeight"]): PmxObject["vertices"][number] {
    return {
      position: [1, 2, 3],
      normal: [0, 0, 1],
      uv: [0.5, 0.25],
      additionalVec4: [],
      weightType,
      boneWeight,
      edgeScale: 1,
    };
  }

  it("header 映射：version.toFixed(2) + encoding 枚举 → utf-8/utf-16 + additionalVec4Count", () => {
    const r = pmxObjectToResponse(syntheticPmx(), 7);
    expect(r.ok).toBe(true);
    expect(r.id).toBe(7);
    expect(r.header).toEqual({ version: "2.00", encoding: "utf-8", additionalDataFlags: 0 });
  });

  it("encoding=0（UTF-16LE）→ 'utf-16'", () => {
    const pmx = syntheticPmx();
    pmx.header.encoding = 0;
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.header!.encoding).toBe("utf-16");
  });

  it("顶点展平：positions/normals/uvs 压缩数组对齐", () => {
    const pmx = syntheticPmx({
      vertices: [vertex(0, { boneIndices: 0, boneWeights: null })],
    });
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.vertices!.count).toBe(1);
    expect(Array.from(r.vertices!.positions)).toEqual([1, 2, 3]);
    expect(Array.from(r.vertices!.normals)).toEqual([0, 0, 1]);
    expect(Array.from(r.vertices!.uvs)).toEqual([0.5, 0.25]);
  });

  it("BDEF1：单骨骼权重展开为 [1,0,0,0]", () => {
    const pmx = syntheticPmx({ vertices: [vertex(0, { boneIndices: 3, boneWeights: null })] });
    const r = pmxObjectToResponse(pmx, 0);
    expect(Array.from(r.vertices!.boneIndices)).toEqual([3, 0, 0, 0]);
    expect(Array.from(r.vertices!.boneWeights)).toEqual([1, 0, 0, 0]);
  });

  it("BDEF2：权重展开为 [w0, 1-w0, 0, 0]", () => {
    const pmx = syntheticPmx({ vertices: [vertex(1, { boneIndices: [2, 5], boneWeights: 0.7 })] });
    const r = pmxObjectToResponse(pmx, 0);
    expect(Array.from(r.vertices!.boneIndices)).toEqual([2, 5, 0, 0]);
    expect(r.vertices!.boneWeights[0]).toBeCloseTo(0.7);
    expect(r.vertices!.boneWeights[1]).toBeCloseTo(0.3);
  });

  it("BDEF4：4 列原样", () => {
    const pmx = syntheticPmx({
      vertices: [vertex(2, { boneIndices: [1, 2, 3, 4], boneWeights: [0.4, 0.3, 0.2, 0.1] })],
    });
    const r = pmxObjectToResponse(pmx, 0);
    expect(Array.from(r.vertices!.boneIndices)).toEqual([1, 2, 3, 4]);
    // Float32Array 存储：0.4 → 0.4000000059604645，用 toBeCloseTo 容忍 float32 精度
    const w = Array.from(r.vertices!.boneWeights);
    [0.4, 0.3, 0.2, 0.1].forEach((exp, i) => expect(w[i]).toBeCloseTo(exp));
  });

  it("SDEF：主权重 + 补零（近似 BDEF2）", () => {
    const pmx = syntheticPmx({
      vertices: [vertex(3, { boneIndices: [1, 2], boneWeights: { boneWeight0: 0.6, c: [0, 0, 0], r0: [0, 0, 0], r1: [0, 0, 0] } })],
    });
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.vertices!.boneWeights[0]).toBeCloseTo(0.6);
    expect(r.vertices!.boneWeights[1]).toBeCloseTo(0.4);
  });

  it("boneIndexSize=2 → boneIndices 为 Uint16Array（宽度随骨骼索引声明，非顶点索引）", () => {
    // review P3：宽度必须随头部 boneIndexSize——否则 >255 骨骼模型（vertexIndexSize=1
    // 但 boneIndexSize=2）的索引写进 Uint8Array 被截断，蒙皮静默损坏
    const pmx = syntheticPmx({ vertices: [vertex(0, { boneIndices: 258, boneWeights: null })] });
    pmx.header.vertexIndexSize = 1; // 顶点索引 1 字节（不参与骨骼索引宽度）
    pmx.header.boneIndexSize = 2;   // 骨骼索引 2 字节（>127 骨骼）
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.vertices!.boneIndices).toBeInstanceOf(Uint16Array);
    expect(r.vertices!.boneIndices[0]).toBe(258); // 不截断
  });

  it("boneIndexSize < vertexIndexSize：骨骼索引宽度仍随 boneIndexSize", () => {
    const pmx = syntheticPmx({ vertices: [vertex(0, { boneIndices: 300, boneWeights: null })] });
    pmx.header.vertexIndexSize = 4;
    pmx.header.boneIndexSize = 2;
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.vertices!.boneIndices).toBeInstanceOf(Uint16Array);
    expect(r.vertices!.boneIndices[0]).toBe(300);
  });

  it("faces：indices 转 Uint32Array + count = 索引总数", () => {
    const r = pmxObjectToResponse(syntheticPmx({ indices: new Uint16Array([0, 1, 2, 2, 3, 0]) }), 0);
    expect(r.faces!.count).toBe(6);
    expect(r.faces!.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(r.faces!.indices)).toEqual([0, 1, 2, 2, 3, 0]);
  });

  it("materials 映射：textureIndex/toonIndex/flags/sharedToon/sphere 字段对齐", () => {
    const pmx = syntheticPmx({
      materials: [{
        name: "mat", englishName: "mat_en",
        diffuse: [1, 0, 0, 1], specular: [0.5, 0.5, 0.5], shininess: 10, ambient: [0.2, 0.2, 0.2],
        flag: 1, edgeColor: [0, 0, 0, 1], edgeSize: 1,
        textureIndex: 2, sphereTextureIndex: 3, sphereTextureMode: 1,
        isSharedToonTexture: true, toonTextureIndex: 0, comment: "", indexCount: 3,
      }],
    });
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.materials![0]).toMatchObject({
      name: "mat", diffuse: [1, 0, 0, 1], textureIndex: 2, toonIndex: 0,
      flags: 1, sphereIndex: 3, sphereMode: 1, sharedToon: 1,
    });
  });

  it("bones 映射：hasIK/ikTarget/ikLinks（flag 32 位 + ik 段）", () => {
    const pmx = syntheticPmx({
      bones: [{
        name: "ik", englishName: "ik_en", position: [0, 0, 0], parentBoneIndex: -1,
        transformOrder: 0, flag: 32, tailPosition: [0, 1, 0],
        ik: { target: 4, iteration: 3, rotationConstraint: 0.5, links: [{ target: 1 }, { target: 2, limitation: { minimumAngle: [-1, -1, -1], maximumAngle: [1, 1, 1] } }] },
      }],
    });
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.bones![0].hasIK).toBe(true);
    expect(r.bones![0].ikTarget).toBe(4);
    expect(r.bones![0].ikIteration).toBe(3);
    expect(r.bones![0].ikLinks![1]).toEqual({ boneIndex: 2, hasLimitation: true });
    // rotation：PMX 骨骼无旋转数据 → identity quaternion
    expect(r.bones![0].rotation).toEqual([0, 0, 0, 1]);
  });

  it("rigidBody 字段交换：group←collisionGroup、collisionGroup←collisionMask、restitution←repulsion、mode←physicsMode", () => {
    const pmx = syntheticPmx({
      rigidBodies: [{
        name: "rb", englishName: "rb_en", boneIndex: 0,
        collisionGroup: 1, collisionMask: 0xffff, shapeType: 0, shapeSize: [1, 1, 1],
        shapePosition: [0, 0, 0], shapeRotation: [0, 0, 0],
        mass: 1, linearDamping: 0, angularDamping: 0, repulsion: 0.25, friction: 0.5, physicsMode: 1,
      }],
    });
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.rigidBodies![0]).toMatchObject({
      group: 1, collisionGroup: 0xffff, restitution: 0.25, friction: 0.5, mode: 1,
    });
  });

  it("morphs：VertexMorph elements 映射位移；GroupMorph offset 借位存 ratio", () => {
    const pmx = syntheticPmx({
      morphs: [
        { name: "v", englishName: "", category: 2, type: 1, indices: new Int32Array([0, 1]), positions: new Float32Array([0.1, 0.2, 0.3, -0.1, -0.2, -0.3]) },
        { name: "g", englishName: "", category: 0, type: 0, indices: new Int32Array([2]), ratios: new Float32Array([0.5]) },
      ],
    });
    const r = pmxObjectToResponse(pmx, 0);
    // Float32 精度：offset 分量用 toBeCloseTo（0.1 → 0.10000000149011612）
    expect(r.morphs![0].elements.length).toBe(2);
    expect(r.morphs![0].elements[0].index).toBe(0);
    expect(r.morphs![0].elements[0].offset[0]).toBeCloseTo(0.1);
    expect(r.morphs![0].elements[0].offset[1]).toBeCloseTo(0.2);
    expect(r.morphs![0].elements[0].offset[2]).toBeCloseTo(0.3);
    expect(r.morphs![0].elements[1].index).toBe(1);
    expect(r.morphs![0].elements[1].offset[0]).toBeCloseTo(-0.1);
    expect(r.morphs![0].elements[1].offset[1]).toBeCloseTo(-0.2);
    expect(r.morphs![0].elements[1].offset[2]).toBeCloseTo(-0.3);
    // 0.5/0 在 float32 下精确，保留精确断言
    expect(r.morphs![1].elements).toEqual([{ index: 2, offset: [0.5, 0, 0] }]);
  });

  it("displayFrames：elements value ← frame.type（Bone=0/Morph=1）", () => {
    const pmx = syntheticPmx({
      displayFrames: [{ name: "df", englishName: "", isSpecialFrame: false, frames: [{ type: 0, index: 1 }, { type: 1, index: 2 }] }],
    });
    const r = pmxObjectToResponse(pmx, 0);
    expect(r.displayFrames![0].elements).toEqual([{ index: 1, value: 0 }, { index: 2, value: 1 }]);
  });

  it("缺 vertices/indices → ok:false（防御：坏数据不产出半截结果）", () => {
    const bad = syntheticPmx({ vertices: undefined as unknown as PmxObject["vertices"], indices: undefined as unknown as PmxObject["indices"] });
    const r = pmxObjectToResponse(bad, 0);
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });
});
