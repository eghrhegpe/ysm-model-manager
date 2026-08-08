// ===== C# ThreeJsPayloadBuilder 的 JS 忠实复刻 =====
// 来源：
//   - upstream/YesSteveModel-Viewer/YSMViewer/Rendering/ThreeJs/ThreeJsPayloadBuilder.cs
//   - upstream/YesSteveModel-Viewer/YSMViewer.Core/Services/YsmLoaderService.cs（ConvertBones 翻转）
//   - upstream/YesSteveModel-Viewer/YSMViewer/Models/MinecraftGeometry.cs（box UV Expand）
// 输入：Bedrock geometry JSON（minecraft:geometry 格式，即 YSMParser 解码输出）
// 输出：与 C# BuildSpecJson 等价的 spec JSON（{ models: [...] }）
// 用途：渲染对齐黄金对比——C# 侧参考实现，严禁按 Go 侧口径"修正"。

const ExportScale = 1 / 16;

class Vec3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  add(o) { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o) { return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z); }
  scale(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  static zero() { return new Vec3(0, 0, 0); }
}

function vec3FromArr(a) {
  if (!Array.isArray(a) || a.length < 3) return Vec3.zero();
  return new Vec3(a[0], a[1], a[2]);
}
function toArr(v) { return [v.x, v.y, v.z]; }

// ---- ConvertBones（YsmLoaderService.cs:653-721）----
// 把 Bedrock 坐标翻转为 YSM 文档坐标（YsmModelDocument）
function convertBedrockPivot(p) {
  const v = vec3FromArr(p);
  return new Vec3(-v.x, v.y, v.z);
}
function convertBedrockRotation(r) {
  const v = vec3FromArr(r);
  return new Vec3(-v.x, -v.y, v.z); // X/Y 取反，Z 不变
}
function convertBones(bones) {
  const bonePivots = {};
  for (const bone of bones) {
    bonePivots[bone.name] = Array.isArray(bone.pivot) && bone.pivot.length >= 3
      ? convertBedrockPivot(bone.pivot) : Vec3.zero();
  }
  const result = [];
  for (const bone of bones) {
    const rotation = Array.isArray(bone.rotation) && bone.rotation.length >= 3
      ? convertBedrockRotation(bone.rotation) : Vec3.zero();
    const cubes = [];
    if (Array.isArray(bone.cubes)) {
      let cubeIdx = 0;
      for (const cube of bone.cubes) {
        if (!Array.isArray(cube.origin) || cube.origin.length < 3 ||
            !Array.isArray(cube.size) || cube.size.length < 3) continue; // C# continue
        cubes.push({
          id: `cube_${bone.name}_${cubeIdx}`,
          origin: new Vec3(-cube.origin[0], cube.origin[1], cube.origin[2]),
          size: new Vec3(cube.size[0], cube.size[1], cube.size[2]),
          pivot: Array.isArray(cube.pivot) && cube.pivot.length >= 3
            ? convertBedrockPivot(cube.pivot) : Vec3.zero(),
          rotation: Array.isArray(cube.rotation) && cube.rotation.length >= 3
            ? convertBedrockRotation(cube.rotation) : Vec3.zero(),
          inflate: typeof cube.inflate === "number" ? cube.inflate : 0,
          uv: cubeUVFromBedrock(cube),
        });
        cubeIdx++;
      }
    }
    result.push({
      id: bone.name, name: bone.name,
      parentId: bone.parent ?? null,
      pivot: bonePivots[bone.name],
      rotation, cubes,
    });
  }
  return result;
}

// ---- MinecraftCubeUV（MinecraftGeometry.cs）----
// Bedrock cube 的 uv 字段可能是 [u,v]（box）或 { north/south/east/west/up/down }（face）
function cubeUVFromBedrock(cube) {
  const uv = cube.uv;
  if (Array.isArray(uv) && uv.length >= 2) {
    return { isBoxUV: true, boxU: uv[0], boxV: uv[1], north: null, south: null, east: null, west: null, up: null, down: null };
  }
  if (uv && typeof uv === "object") {
    const f = (face) => {
      if (!face) return null;
      const uvArr = Array.isArray(face.uv) ? face.uv : null;
      const sizeArr = Array.isArray(face.uv_size) ? face.uv_size : null;
      return { uvCoords: uvArr, uvSize: sizeArr };
    };
    return {
      isBoxUV: false, boxU: null, boxV: null,
      north: f(uv.north), south: f(uv.south), east: f(uv.east), west: f(uv.west),
      up: f(uv.up), down: f(uv.down),
    };
  }
  return { isBoxUV: false, boxU: null, boxV: null, north: null, south: null, east: null, west: null, up: null, down: null };
}

// MinecraftCubeUV.Expand（MinecraftGeometry.cs:57-88）
function expandBoxUV(cubeUV, sx, sy, sz) {
  if (!cubeUV.isBoxUV) return cubeUV;
  const u = cubeUV.boxU, v = cubeUV.boxV;
  const x = sx, y = sy, z = sz;
  const face = (uv, size) => ({ uvCoords: uv, uvSize: size });
  return {
    isBoxUV: false, boxU: null, boxV: null,
    north: face([u + z, v + z], [x, y]),
    south: face([u + z + z + x, v + z], [x, y]),
    east: face([u, v + z], [z, y]),
    west: face([u + z + x, v + z], [z, y]),
    up: face([u + z + x, v + z], [-x, -z]),   // 注意负 UvSize
    down: face([u + z + x + x, v], [-x, z]),
  };
}

// ---- ThreeJsPayloadBuilder（ThreeJsPayloadBuilder.cs）----

// CreateBlockbenchQuaternion（:246-255）：正角度 Rx*Ry*Rz → 矩阵 → CreateFromRotationMatrix
function createBlockbenchQuaternion(euler) {
  const rx = euler.x * Math.PI / 180;
  const ry = euler.y * Math.PI / 180;
  const rz = euler.z * Math.PI / 180;
  // 行主序旋转矩阵（与 C# Matrix4x4 同约定：行向量 v' = v·M）
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const M = matMul3(matMul3(Rx, Ry), Rz); // M = Rx·Ry·Rz
  return quaternionFromRotationMatrix3(M);
}
function matMul3(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}
// .NET Quaternion.CreateFromRotationMatrix（Shepperd 法，标量路径）
function quaternionFromRotationMatrix3(m) {
  const m11 = m[0][0], m12 = m[0][1], m13 = m[0][2];
  const m21 = m[1][0], m22 = m[1][1], m23 = m[1][2];
  const m31 = m[2][0], m32 = m[2][1], m33 = m[2][2];
  const trace = m11 + m22 + m33;
  let x, y, z, w;
  if (trace > 0.0) {
    const s = Math.sqrt(trace + 1.0) * 2.0;
    x = (m32 - m23) / s; y = (m13 - m31) / s; z = (m21 - m12) / s; w = 0.25 * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = Math.sqrt(1.0 + m11 - m22 - m33) * 2.0;
    x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s; w = (m32 - m23) / s;
  } else if (m22 > m33) {
    const s = Math.sqrt(1.0 + m22 - m11 - m33) * 2.0;
    x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s; w = (m13 - m31) / s;
  } else {
    const s = Math.sqrt(1.0 + m33 - m11 - m22) * 2.0;
    x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s; w = (m21 - m12) / s;
  }
  return [x, y, z, w];
}

// GetFaceUV（:226-244）：u0=fu/tw, v0=fv/th, u1=(fu+du)/tw, v1=(fv+dv)/th
// 四角 (u0,v0)(u1,v0)(u0,v1)(u1,v1)，不翻转 V
function getFaceUV(faceUv, texW, texH) {
  if (faceUv && Array.isArray(faceUv.uvCoords) && faceUv.uvCoords.length >= 2) {
    const fu = faceUv.uvCoords[0];
    const fv = faceUv.uvCoords[1];
    const du = Array.isArray(faceUv.uvSize) && faceUv.uvSize.length >= 2 ? faceUv.uvSize[0] : 0;
    const dv = Array.isArray(faceUv.uvSize) && faceUv.uvSize.length >= 2 ? faceUv.uvSize[1] : 0;
    const u0 = fu / texW, v0 = fv / texH;
    const u1 = (fu + du) / texW, v1 = (fv + dv) / texH;
    return { u0, v0, u1, v1: v0, u2: u0, v2: v1, u3: u1, v3: v1 };
  }
  return { u0: 0, v0: 0, u1: 0, v1: 0, u2: 0, v2: 0, u3: 0, v3: 0 };
}

// AddQuadFace（:207-224）：4 顶点 + 4 法线 + 4 UV + indices [b,b+2,b+1],[b+2,b+3,b+1]
function addQuadFace(pos, normals, uvs, indices, vtx, n, uv) {
  const base = pos.length / 3;
  for (const v of vtx) pos.push(v[0], v[1], v[2]);
  for (let i = 0; i < 4; i++) normals.push(n[0], n[1], n[2]);
  uvs.push(uv.u0, uv.v0, uv.u1, uv.v1, uv.u2, uv.v2, uv.u3, uv.v3);
  indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

// BuildCubeMeshData（:125-198）
function buildCubeMeshData(cube, bonePivot, texW, texH, meshId, boneId) {
  let cubeUV = cube.uv;
  const sz = cube.size;
  if (cubeUV.isBoxUV && !(sz.x === 0 && sz.y === 0 && sz.z === 0)) {
    cubeUV = expandBoxUV(cubeUV, sz.x, sz.y, sz.z);
  }
  const inflate = cube.inflate;
  // from.x = origin.x - size.x（X 轴镜像），Y/Z 原样
  const from = new Vec3(cube.origin.x - cube.size.x, cube.origin.y, cube.origin.z);
  const to = from.add(cube.size);
  const center = from.add(to).scale(0.5);
  const halfSize = to.sub(from).scale(0.5);
  const infl = new Vec3(halfSize.x + inflate, halfSize.y + inflate, halfSize.z + inflate);
  const min = center.sub(infl).sub(cube.pivot);
  const max = center.add(infl).sub(cube.pivot);

  let lx = min.x * ExportScale, ly = min.y * ExportScale, lz = min.z * ExportScale;
  let hx = max.x * ExportScale, hy = max.y * ExportScale, hz = max.z * ExportScale;
  if (lx === hx) hx += 0.001;
  if (ly === hy) hy += 0.001;
  if (lz === hz) hz += 0.001;

  const tw = texW > 0 ? texW : 64;
  const th = texH > 0 ? texH : 64;

  const positions = [], normals = [], uvs = [], indices = [];

  // 面序：East, West, Up, Down, South, North（与 C# 完全一致）
  addQuadFace(positions, normals, uvs, indices,
    [[hx, hy, hz], [hx, hy, lz], [hx, ly, hz], [hx, ly, lz]],
    [1, 0, 0], getFaceUV(cubeUV.east, tw, th));
  addQuadFace(positions, normals, uvs, indices,
    [[lx, hy, lz], [lx, hy, hz], [lx, ly, lz], [lx, ly, hz]],
    [-1, 0, 0], getFaceUV(cubeUV.west, tw, th));
  addQuadFace(positions, normals, uvs, indices,
    [[lx, hy, lz], [hx, hy, lz], [lx, hy, hz], [hx, hy, hz]],
    [0, 1, 0], getFaceUV(cubeUV.up, tw, th));
  addQuadFace(positions, normals, uvs, indices,
    [[lx, ly, hz], [hx, ly, hz], [lx, ly, lz], [hx, ly, lz]],
    [0, -1, 0], getFaceUV(cubeUV.down, tw, th));
  addQuadFace(positions, normals, uvs, indices,
    [[lx, hy, hz], [hx, hy, hz], [lx, ly, hz], [hx, ly, hz]],
    [0, 0, 1], getFaceUV(cubeUV.south, tw, th));
  addQuadFace(positions, normals, uvs, indices,
    [[hx, hy, lz], [lx, hy, lz], [hx, ly, lz], [lx, ly, lz]],
    [0, 0, -1], getFaceUV(cubeUV.north, tw, th));

  const localPosition = cube.pivot.sub(bonePivot).scale(ExportScale);
  return {
    id: meshId, boneId,
    localPosition: toArr(localPosition),
    localRotation: createBlockbenchQuaternion(cube.rotation),
    positions, normals, uvs, indices,
  };
}

// BuildSpecJson（:41-98）
export function buildSpecFromBedrockJson(data) {
  const doc = JSON.parse(data);
  const geo = (doc["minecraft:geometry"] || [])[0];
  if (!geo) return { models: [] };
  const geoModel = {
    id: geo.description?.identifier ?? "main",
    name: geo.description?.identifier ?? "main",
    defaultVisible: geo.description?.visible ?? true,
    textureWidth: geo.description?.texture_width ?? 0,
    textureHeight: geo.description?.texture_height ?? 0,
    bones: convertBones(geo.bones ?? []),
  };

  const bones = [], meshGroups = [];
  const bonePivots = {};
  for (const bone of geoModel.bones) bonePivots[bone.id] = bone.pivot;

  for (const bone of geoModel.bones) {
    const hasParent = bone.parentId !== null && bonePivots[bone.parentId] !== undefined;
    const localPosition = hasParent
      ? bone.pivot.sub(bonePivots[bone.parentId]).scale(ExportScale)
      : bone.pivot.scale(ExportScale);
    bones.push({
      id: bone.id, name: bone.name, parentId: bone.parentId,
      localPosition: toArr(localPosition),
      localRotation: createBlockbenchQuaternion(bone.rotation),
    });
    let cubeIdx = 0;
    for (const cube of bone.cubes) {
      const mesh = buildCubeMeshData(cube, bone.pivot,
        geoModel.textureWidth, geoModel.textureHeight,
        `${bone.id}_${cubeIdx}`, bone.id);
      if (mesh) meshGroups.push(mesh);
      cubeIdx++;
    }
  }

  return {
    models: [{
      id: geoModel.id, name: geoModel.name,
      defaultVisible: geoModel.defaultVisible,
      textureWidth: geoModel.textureWidth,
      textureHeight: geoModel.textureHeight,
      textureId: null,
      bones, meshGroups,
    }],
  };
}
