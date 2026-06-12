// ===== JS 兜底 Spec 构建 =====
// 从 model3d.js 拆分：Go spec 不可用时 JS 端兜底算法
// 算法逻辑与 Go threejs.Build() 一致

const CUBE_EPS = 0.001;

/** 构建 Three.js 可消费的 spec 结构 { bones[], meshes[] } */
export function buildSpecFromModel(model) {
  const texW = model.texWidth || 64;
  const texH = model.texHeight || 64;
  const meshes = [];
  const boneIdx = {};
  const boneCubes = {}; // name → cube[] after merge
  const firstPivot = {};

  // Phase 1: 收集每个 bone 的 first pivot
  for (const b of model.bones || []) {
    if (!boneIdx.hasOwnProperty(b.name)) {
      boneIdx[b.name] = true;
      firstPivot[b.name] = b.pivot || [0, 0, 0];
    }
  }
  // 同名骨骼优先保留有 parent 的 pivot
  for (const b of model.bones || []) {
    if (b.parent && firstPivot[b.name]) {
      firstPivot[b.name] = b.pivot || firstPivot[b.name];
    }
  }

  // Phase 2: 每组同名骨骼收集所有 cube，merge 后保留一个
  for (const b of model.bones || []) {
    const cubes = (b.cubes || []).map((c) => {
      const origin = c.origin || [0, 0, 0];
      const size = c.size || [1, 1, 1];
      const pivot = c.pivot || [0, 0, 0];
      const rotation = c.rotation || [0, 0, 0];
      return { origin, size, pivot, rotation, uv: c.uv, faceUV: c.faceUV };
    });
    if (!boneCubes[b.name]) {
      boneCubes[b.name] = cubes;
    } else {
      boneCubes[b.name] = mergeCubesJS(boneCubes[b.name], cubes);
    }
  }

  // Phase 3: 遍历 boneCubes 生成 mesh data
  let cubeIdx = 0;
  const boneNames = Object.keys(boneCubes);
  for (const boneID of boneNames) {
    const groupPivot = firstPivot[boneID] || [0, 0, 0];
    const cubes = boneCubes[boneID];
    if (!cubes || cubes.length === 0) continue;

    for (const c of cubes) {
      const data = buildCubeMeshDataJS(
        c,
        groupPivot,
        texW,
        texH,
        boneID,
        cubeIdx,
      );
      meshes.push(data);
      cubeIdx++;
    }
  }

  return { bones: model.bones || [], meshes, texWidth: texW, texHeight: texH };
}

function mergeCubesJS(oldCubes, newCubes) {
  const result = [];
  for (const nc of newCubes) {
    let replaced = false;
    for (let i = 0; i < oldCubes.length; i++) {
      const oc = oldCubes[i];
      if (
        cubesOverlapJS(oc.origin, nc.origin) &&
        cubesOverlapJS(oc.size, nc.size) &&
        cubesOverlapJS(oc.rotation, nc.rotation)
      ) {
        oldCubes[i] = nc;
        replaced = true;
        break;
      }
    }
    if (!replaced) result.push(nc);
  }
  return [...oldCubes, ...result];
}

function cubesOverlapJS(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (!floatEqualJS(a[i] || 0, b[i] || 0)) return false;
  }
  return true;
}

function floatEqualJS(a, b) {
  return Math.abs(a - b) < CUBE_EPS;
}

function buildCubeMeshDataJS(c, bonePivot, texW, texH, boneID, cubeIdx) {
  const origin = c.origin || [0, 0, 0];
  const size = c.size || [1, 1, 1];
  const pivot = c.pivot || [0, 0, 0];
  const [sx, sy, sz] = size;
  const cubeOrigin = [
    origin[0] - bonePivot[0],
    origin[1] - bonePivot[1],
    origin[2] - bonePivot[2],
  ];
  const cubePivot = [
    pivot[0] - bonePivot[0],
    pivot[1] - bonePivot[1],
    pivot[2] - bonePivot[2],
  ];
  const rot = c.rotation || [0, 0, 0];
  const faceUV = c.faceUV;
  const uvData = faceUV
    ? parseUVFromObject(faceUV, sx, sy, sz, texW, texH)
    : parseUVJS(c, sx, sy, sz, texW, texH);
  const texIdx = uvData.texIdx || 0;
  return {
    boneID,
    origin: cubeOrigin,
    size,
    pivot: cubePivot,
    rotation: rot,
    uv: uvData.uv, // 6 faces × 4 vertices × 2 coords
    faceUV: !!faceUV,
    texIdx,
    cubeIdx,
  };
}

function parseUVJS(c, sx, sy, sz, texW, texH) {
  const uv = c.uv || [0, 0];
  const [u, v] = uv;
  // 标准 box UV 映射
  const fw = sx / texW;
  const fh = sz / texH;
  const fv = (sy + sz) / texH;
  const v0 = v;
  const v1 = v + sz / texH;
  const v2 = v + (sz + sy) / texH;
  const v3 = v + (sz + sy + sz) / texH;
  const uBase = u / texW;
  const uEast = uBase + fw;
  const uWest = uEast + fw;
  const uUp = uWest + fw;
  const uDown = uUp + fw;
  const uSouth = uDown + fw;
  const uNorth = uSouth + fw;

  return {
    uv: [
      // East  (右)
      [
        [uEast, v1],
        [uEast + fh, v1],
        [uEast + fh, v0],
        [uEast, v0],
      ],
      // West  (左)
      [
        [uWest, v1],
        [uWest + fh, v1],
        [uWest + fh, v0],
        [uWest, v0],
      ],
      // Up    (上)
      [
        [uUp, v2],
        [uUp + fw, v2],
        [uUp + fw, v1],
        [uUp, v1],
      ],
      // Down  (下)
      [
        [uDown, v2],
        [uDown + fw, v2],
        [uDown + fw, v1],
        [uDown, v1],
      ],
      // South (前)
      [
        [uSouth, v0],
        [uSouth + fw, v0],
        [uSouth + fw, v3],
        [uSouth, v3],
      ],
      // North (后)
      [
        [uNorth, v0],
        [uNorth + fw, v0],
        [uNorth + fw, v3],
        [uNorth, v3],
      ],
    ],
    texIdx: 0,
  };
}

function parseUVFromObject(jsonStr, sx, sy, sz, texW, texH) {
  try {
    const faceData = JSON.parse(jsonStr);
    const faces = ["east", "west", "up", "down", "south", "north"];
    const uv = [];
    let texIdx = 0;
    for (const face of faces) {
      const fd = faceData[face] || faceData[face.toUpperCase()];
      if (fd?.uv && fd?.uv_size) {
        const [fu, fv] = fd.uv;
        const [fw, fh] = fd.uv_size;
        uv.push([
          [fu / texW, (fv + fh) / texH],
          [(fu + fw) / texW, (fv + fh) / texH],
          [(fu + fw) / texW, fv / texH],
          [fu / texW, fv / texH],
        ]);
      } else {
        uv.push([
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ]);
      }
      if (fd?.texture !== undefined) texIdx = fd.texture;
    }
    return { uv, texIdx };
  } catch (_) {
    return parseUVJS({ uv: [0, 0] }, sx, sy, sz, texW, texH);
  }
}

function eulerToQuaternionJS(rxDeg, ryDeg, rzDeg) {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx / 2),
    sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2),
    sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2),
    sz = Math.sin(rz / 2);
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}
