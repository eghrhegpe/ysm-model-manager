import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GetModel3DSpec } from "../../wailsjs/go/main/App.js";

// Go spec 缓存（避免重复调用 GetModel3DSpec）
const specCache = new Map();
const SPEC_CACHE_MAX = 20;
function cacheSpec(path, data) {
  if (specCache.size >= SPEC_CACHE_MAX) {
    const firstKey = specCache.keys().next().value;
    specCache.delete(firstKey);
  }
  specCache.set(path, data);
}

// 调试用：控制台可调 window.debugGetSpec(path) 获取骨骼数据
window.debugGetSpec = async (path) => {
  try {
    const jsonStr = await GetModel3DSpec(path || "");
    const spec = JSON.parse(jsonStr);
    console.log("[DEBUG] spec:", spec);
    return spec;
  } catch (e) {
    console.error("[DEBUG]", e);
    return null;
  }
};

export async function renderModel3D(container, model, textureUrl, texIdx = 0) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b2e);
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 80, -120);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = "";
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 80, 0);
  controls.update();
  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(10, 30, 20);
  scene.add(dirLight);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
  backLight.position.set(-10, 10, -20);
  scene.add(backLight);
  const grid = new THREE.GridHelper(400, 20, 0x444488, 0x333366);
  grid.position.y = -1;
  scene.add(grid);
  const axes = new THREE.AxesHelper(60);
  scene.add(axes);
  const texMap = new Map();
  const urls = model.textures?.length > 1 ? model.textures : [textureUrl];
  if (urls?.length) {
    const loads = urls.filter(Boolean).map(
      (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.flipY = false;
            tex.minFilter = THREE.NearestFilter;
            tex.magFilter = THREE.NearestFilter;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            tex.userData.imgWidth = img.naturalWidth;
            tex.userData.imgHeight = img.naturalHeight;
            texMap.set(url, tex);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }),
    );
    await Promise.all(loads);
  }
  // 按 urls 顺序构建纹理数组（texMap 的插入顺序是图片加载完成顺序，不保证与索引一致）
  const texArr = urls
    .filter(Boolean)
    .map((url) => texMap.get(url))
    .filter(Boolean);

  // 从 Go 获取预计算的 Three.js Spec
  let spec = { models: [] };
  const forceJS = false;
  // 优先走 Go spec（基于 YSMViewer 算法，骨骼/网格数据准确）
  if (model._modelPath) {
    try {
      let jsonStr = specCache.get(model._modelPath);
      if (!jsonStr) {
        jsonStr = await GetModel3DSpec(model._modelPath);
        cacheSpec(model._modelPath, jsonStr);
      }
      const parsed = JSON.parse(jsonStr);
      if (parsed.models) spec = parsed;
    } catch (e) {
      console.warn("[3D] Fallback to JS geometry:", e);
    }
  }
  
  if (!spec.models?.length && model.bones?.length) {
    spec = buildSpecFromModel(model);
  }

  // 合并同骨骼同纹理的 mesh：将多个小 mesh 的顶点烘焙到 bone 本地坐标后合并
  for (const mg of spec.models || []) {
    if (!mg.meshGroups?.length) continue;
    // 按 (boneId, texIdx) 分组
    const grouped = new Map();
    for (const md of mg.meshGroups) {
      const key = md.boneId + ":" + (md.texIdx ?? 0);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(md);
    }
    const merged = [];
    for (const [, g] of grouped) {
      if (g.length === 1) { merged.push(g[0]); continue; }
      // 合并多个 mesh：仅合并无旋转的 mesh（identity quaternion），有旋转的保留原样
      let positions = [], normals = [], uvs = [], idx = [], idxOff = 0;
      const standalone = [];
      for (const md of g) {
        const isIdentity = md.localRotation?.[3] === 1 &&
          md.localRotation?.[0] === 0 &&
          md.localRotation?.[1] === 0 &&
          md.localRotation?.[2] === 0;
        if (!isIdentity) { standalone.push(md); continue; }
        // 将 localPosition 烘焙到顶点坐标中
        const dx = md.localPosition?.[0] || 0;
        const dy = md.localPosition?.[1] || 0;
        const dz = md.localPosition?.[2] || 0;
        for (let i = 0; i < (md.positions?.length || 0); i += 3) {
          positions.push((md.positions[i] || 0) + dx);
          positions.push((md.positions[i + 1] || 0) + dy);
          positions.push((md.positions[i + 2] || 0) + dz);
        }
        if (md.normals) normals.push(...md.normals);
        if (md.uvs) uvs.push(...md.uvs);
        for (let i = 0; i < (md.indices?.length || 0); i++) {
          idx.push((md.indices[i] || 0) + idxOff);
        }
        idxOff += (md.positions?.length || 0) / 3;
      }
      if (positions.length) {
        merged.push({
          id: g[0].boneId + "_merged",
          boneId: g[0].boneId,
          texIdx: g[0].texIdx,
          localPosition: [0, 0, 0],
          localRotation: [0, 0, 0, 1],
          positions, normals, uvs, indices: idx,
        });
      }
      merged.push(...standalone);
    }
    mg.meshGroups = merged;
  }

  const rootGroup = new THREE.Group();
  rootGroup.name = "__root__";
  // 根据模型实际尺寸动态调整缩放
  let meshMin = Infinity,
    meshMax = -Infinity;
  for (const mg of spec.models || []) {
    for (const md of mg.meshGroups || []) {
      for (let i = 0; i < (md.positions?.length || 0); i += 3) {
        const v = Math.abs(md.positions[i]);
        if (v > meshMax) meshMax = v;
        if (v < meshMin) meshMin = v;
      }
    }
  }
  const modelScale = meshMax > 32 ? 1 / 16 : meshMax > 4 ? 1 / 4 : 1;
  rootGroup.scale.set(modelScale, modelScale, modelScale);
  scene.add(rootGroup);
  const boneGroupMap = new Map();
  for (const mg of spec.models) {
    for (const bd of mg.bones || []) {
      const g = new THREE.Group();
      g.name = bd.name;
      g.position.set(
        bd.localPosition[0],
        bd.localPosition[1],
        bd.localPosition[2],
      );
      if (
        bd.localRotation[3] !== 1 ||
        bd.localRotation[0] !== 0 ||
        bd.localRotation[1] !== 0 ||
        bd.localRotation[2] !== 0
      ) {
        g.quaternion.set(
          bd.localRotation[0],
          bd.localRotation[1],
          bd.localRotation[2],
          bd.localRotation[3],
        );
      }
      boneGroupMap.set(bd.id, g);
    }
    for (const bd of mg.bones || []) {
      const g = boneGroupMap.get(bd.id);
      if (!g) continue;
      if (bd.parentId && boneGroupMap.has(bd.parentId)) {
        boneGroupMap.get(bd.parentId).add(g);
      } else {
        rootGroup.add(g);
      }
    }
    let minY = Infinity,
      maxY = -Infinity;
    for (const b of model.bones || [])
      for (const c of b.cubes || []) {
        const y = c.origin[1] + c.size[1] / 2;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    const centerY = (minY + maxY) / 2;
    const modelHeight = maxY - minY;
    // 模型缩放后的相机距离
    const camDist = Math.max(modelHeight * 1.5 * modelScale, 60 * modelScale);
    camera.position.set(camDist * 0.4, centerY * modelScale, -camDist * 0.8);
    camera.lookAt(0, centerY * modelScale, 0);
    controls.target.set(0, centerY * modelScale, 0);
    controls.update();
    for (const md of mg.meshGroups || []) {
      const boneGroup = boneGroupMap.get(md.boneId);
      if (!boneGroup) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(md.positions, 3),
      );
      geo.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(md.normals, 3),
      );
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(md.uvs, 2));
      geo.setIndex(md.indices);
      // 按 mesh 所属骨骼选择对应纹理（md.texIdx 由 buildSpecFromModel 设置）
      const meshTexIdx = md.texIdx ?? texIdx ?? 0;
      const meshTex =
        texArr.length > 0 ? texArr[meshTexIdx] || texArr[0] : null;
      // YSMViewer: texture slot > 0 的方块为发光/覆盖层，正面剔除（BackSide）
      const useBackSide = meshTexIdx > 0;
      // 主纹理（slot 0）用低 alphaTest 仅丢弃完全透明像素，避免 alphaTest 0.5 把纹理
      // 中半透明区域（如 UV 映射到抗锯齿边缘的方块面）整面丢弃。
      // 覆盖层（slot > 0）保持 0.5 以干净裁掉透明部分。
      const mat = meshTex
        ? new THREE.MeshBasicMaterial({
            map: meshTex,
            alphaTest: useBackSide ? 0.5 : 0.02,
            transparent: true,
            side: useBackSide ? THREE.BackSide : THREE.DoubleSide,
          })
        : new THREE.MeshBasicMaterial({
            color: 0x44aa88,
            side: THREE.DoubleSide,
          });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        md.localPosition[0],
        md.localPosition[1],
        md.localPosition[2],
      );
      if (
        md.localRotation[3] !== 1 ||
        md.localRotation[0] !== 0 ||
        md.localRotation[1] !== 0 ||
        md.localRotation[2] !== 0
      ) {
        mesh.quaternion.set(
          md.localRotation[0],
          md.localRotation[1],
          md.localRotation[2],
          md.localRotation[3],
        );
      }
      boneGroup.add(mesh);
    }
  }
  let _rafId = null;
  const _onResize = () => {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  };
  window.addEventListener("resize", _onResize);
  function renderLoop() {
    _rafId = requestAnimationFrame(renderLoop);
    controls.update();
    renderer.render(scene, camera);
  }
  _rafId = requestAnimationFrame(renderLoop);
  renderer.render(scene, camera);
  return {
    cleanup: () => {
      // 停止动画循环（最重要的！否则每次开/关都产生一个僵尸 loop）
      if (_rafId != null) cancelAnimationFrame(_rafId);
      _rafId = null;
      controls.dispose();
      window.removeEventListener("resize", _onResize);
      renderer.dispose();
      container.innerHTML = "";
      scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material))
            child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
      texMap.forEach((tex) => tex.dispose());
      texMap.clear();
    },
  };
}

// ===== JS 兜底算法（与 Go threejs.Build() 逻辑一致） =====
function buildSpecFromModel(model) {
  const texW = model.texWidth || 64;
  const texH = model.texHeight || 64;
  const bones = [];
  const meshes = [];
  const boneIdx = {};
  const boneCubes = {}; // name → cube[] after merge
  // 收集 bone pivots（同名骨骼优先保留有 parent 的 pivot，与 Go spec.go 一致）
  const firstPivot = {};
  for (const b of model.bones || []) {
    const bp = b.pivot || [0, 0, 0];
    if (firstPivot[b.name] === undefined) {
      firstPivot[b.name] = bp;
    } else if (b.parent) {
      // 同名骨骼且当前有 parent → 覆盖（main.json 的正确层级优先于 arm.json 扁平版）
      firstPivot[b.name] = bp;
    }
  }
  for (const b of model.bones || []) {
    const bp = b.pivot || [0, 0, 0];
    let localPos = [-bp[0], bp[1], bp[2]];
    if (b.parent) {
      // 从 firstPivot 中取父骨骼 pivot（与 Go spec.go 一致，使用去重后的 pivot）
      const pp = firstPivot[b.parent] || [0, 0, 0];
      localPos = [-bp[0] - -pp[0], bp[1] - pp[1], bp[2] - pp[2]];
    }
    const entry = {
      id: b.name,
      name: b.name,
      parentId: b.parent || null,
      localPosition: localPos,
      localRotation: b.rotation
        ? eulerToQuaternionJS(
            -(b.rotation[0] || 0),
            -(b.rotation[1] || 0),
            b.rotation[2] || 0,
          )
        : [0, 0, 0, 1],
    };
    const isDuplicate = boneIdx[b.name] !== undefined;
    if (isDuplicate) {
      const existing = bones[boneIdx[b.name]];
      // 同名骨骼去重：优先保留数据更完整的骨骼
      // 规则1: 现有无 parent + 新有 parent → 补全
      // 规则2: 两者都有 parent 但现有无旋转 + 新有旋转 → 更新旋转
      const existingHasParent = !!existing.parentId;
      const newHasParent = !!b.parent;
      const existingHasRot = existing.localRotation.some((v) => v !== 0);
      const newHasRot = entry.localRotation.some((v) => v !== 0);
      if (
        (!existingHasParent && newHasParent) ||
        (existingHasParent && newHasParent && !existingHasRot && newHasRot)
      ) {
        existing.parentId = b.parent;
        existing.localPosition = localPos;
        existing.localRotation = entry.localRotation;
      }
    } else {
      boneIdx[b.name] = bones.length;
      bones.push(entry);
    }
    // cubes：同名骨骼时合并（替换重叠 cube，保留非重叠 cube）
    if (!isDuplicate) {
      // 首次出现：保存 cube 到 per-bone 列表
      boneCubes[b.name] = (b.cubes || []).map((c) => ({ ...c }));
    } else {
      // 后续出现：合并 cube
      const existing = boneCubes[b.name] || [];
      const merged = mergeCubesJS(existing, b.cubes || []);
      boneCubes[b.name] = merged;
    }
  }

  // 第二遍：将合并后的 cube 转为 mesh
  for (const b of model.bones || []) {
    const entry = bones[boneIdx[b.name]];
    if (!entry) continue;
    const fp = firstPivot[b.name] || b.pivot || [0, 0, 0];
    const bTexW = b._texWidth || texW;
    const bTexH = b._texHeight || texH;
    const cubes = boneCubes[b.name] || [];
    for (let ci = 0; ci < cubes.length; ci++) {
      const c = cubes[ci];
      const md = buildCubeMeshDataJS(c, fp, bTexW, bTexH, b.name, ci);
      if (md) {
        md.texIdx = (c.texSlot > 0 ? c.texSlot : b._texIdx) ?? 0;
        meshes.push(md);
      }
    }
  }

  // 后处理：将 RightArm/LeftArm 挂到 Arm 下面（YSMParser 解码 .ysm 后丢失的层级）
  const armBone = bones.find((b) => b.name === "Arm" && b.parentId);
  const rightArmBone = bones.find((b) => b.name === "RightArm" && !b.parentId);
  const leftArmBone = bones.find((b) => b.name === "LeftArm" && !b.parentId);
  if (armBone && rightArmBone) {
    const armPivot = model.bones.find((b) => b.name === "Arm")?.pivot || [
      0, 0, 0,
    ];
    const raPivot = model.bones.find((b) => b.name === "RightArm")?.pivot || [
      0, 0, 0,
    ];
    rightArmBone.parentId = "Arm";
    rightArmBone.localPosition = [
      -raPivot[0] - -armPivot[0],
      raPivot[1] - armPivot[1],
      raPivot[2] - armPivot[2],
    ];
  }
  if (armBone && leftArmBone) {
    const armPivot = model.bones.find((b) => b.name === "Arm")?.pivot || [
      0, 0, 0,
    ];
    const laPivot = model.bones.find((b) => b.name === "LeftArm")?.pivot || [
      0, 0, 0,
    ];
    leftArmBone.parentId = "Arm";
    leftArmBone.localPosition = [
      -laPivot[0] - -armPivot[0],
      laPivot[1] - armPivot[1],
      laPivot[2] - armPivot[2],
    ];
  }

  return {
    models: [
      {
        id: "main",
        name: "main",
        defaultVisible: true,
        textureWidth: texW,
        textureHeight: texH,
        bones,
        meshGroups: meshes,
      },
    ],
  };
}

// ===== cube 合并（与 Go mergeCubes 一致） =====

const CUBE_EPS = 0.001;

function mergeCubesJS(oldCubes, newCubes) {
  const result = oldCubes.map((c) => ({ ...c }));
  const matched = new Array(oldCubes.length).fill(false);
  for (const nc of newCubes) {
    let found = -1;
    for (let i = 0; i < oldCubes.length; i++) {
      if (!matched[i] && cubesOverlapJS(oldCubes[i], nc)) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      result[found] = { ...nc };
      matched[found] = true;
    } else {
      result.push({ ...nc });
    }
  }
  return result;
}

function cubesOverlapJS(a, b) {
  return floatEqualJS(a.origin, b.origin) &&
    floatEqualJS(a.size, b.size) &&
    floatEqualJS(a.rotation, b.rotation);
}

function floatEqualJS(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (Math.abs((a[i] || 0) - (b[i] || 0)) > CUBE_EPS) return false;
  }
  return true;
}

function buildCubeMeshDataJS(c, bonePivot, texW, texH, boneID, cubeIdx) {
  const [ox, oy, oz] = c.origin;
  const [sx, sy, sz] = c.size;
  if (!sx || !sy || !sz) return null;
  const cp = c.pivot || [0, 0, 0];
  const oxN = -ox,
    cpXN = -cp[0];
  const fx = oxN - sx,
    fy = oy,
    fz = oz;
  const tx = fx + sx,
    ty = fy + sy,
    tz = fz + sz;
  const cx = (fx + tx) / 2,
    cy = (fy + ty) / 2,
    cz = (fz + tz) / 2;
  const hx2 = (tx - fx) / 2,
    hy2 = (ty - fy) / 2,
    hz2 = (tz - fz) / 2;
  let lx = cx - hx2 - cpXN,
    ly = cy - hy2 - cp[1],
    lz = cz - hz2 - cp[2];
  let hx = cx + hx2 - cpXN,
    hy = cy + hy2 - cp[1],
    hz = cz + hz2 - cp[2];
  if (lx === hx) hx += 0.001;
  if (ly === hy) hy += 0.001;
  if (lz === hz) hz += 0.001;
  const faceUVs = parseUVJS(c, sx, sy, sz, texW, texH);
  const pos = [],
    nrm = [],
    uvs = [],
    idx = [];
  const faceDefs = [
    { v: [hx, hy, hz, hx, hy, lz, hx, ly, hz, hx, ly, lz], n: [1, 0, 0], f: 0 },
    {
      v: [lx, hy, lz, lx, hy, hz, lx, ly, lz, lx, ly, hz],
      n: [-1, 0, 0],
      f: 1,
    },
    { v: [lx, hy, lz, hx, hy, lz, lx, hy, hz, hx, hy, hz], n: [0, 1, 0], f: 2 },
    {
      v: [lx, ly, hz, hx, ly, hz, lx, ly, lz, hx, ly, lz],
      n: [0, -1, 0],
      f: 3,
    },
    { v: [lx, hy, hz, hx, hy, hz, lx, ly, hz, hx, ly, hz], n: [0, 0, 1], f: 4 },
    {
      v: [hx, hy, lz, lx, hy, lz, hx, ly, lz, lx, ly, lz],
      n: [0, 0, -1],
      f: 5,
    },
  ];
  for (const fd of faceDefs) {
    const bi = pos.length / 3;
    pos.push(...fd.v);
    for (let i = 0; i < 4; i++) nrm.push(...fd.n);
    const uv = faceUVs?.[fd.f];
    if (uv) {
      uvs.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]);
    } else {
      for (let i = 0; i < 8; i++) uvs.push(0);
    }
    idx.push(bi, bi + 2, bi + 1, bi + 2, bi + 3, bi + 1);
  }
  return {
    id: boneID + "_" + cubeIdx,
    boneId: boneID,
    localPosition: [
      cpXN - -bonePivot[0],
      cp[1] - bonePivot[1],
      cp[2] - bonePivot[2],
    ],
    localRotation: eulerToQuaternionJS(
      -(c.rotation?.[0] || 0),
      -(c.rotation?.[1] || 0),
      c.rotation?.[2] || 0,
    ),
    positions: pos,
    normals: nrm,
    uvs,
    indices: idx,
  };
}

function parseUVJS(c, sx, sy, sz, texW, texH) {
  if (c.faceUV) {
    try {
      const fd = JSON.parse(c.faceUV);
      const faces = [];
      const names = ["east", "west", "up", "down", "south", "north"];
      for (let fi = 0; fi < 6; fi++) {
        const f = fd[names[fi]];
        if (!f?.uv) continue;
        const fu = f.uv[0],
          fv = f.uv[1];
        let fw = f.uv_size?.[0] || 0,
          fh = f.uv_size?.[1] || 0;
        if (fw < 0) fw = -fw;
        if (fh < 0) fh = -fh;
        faces[fi] = [
          fu / texW,
          fv / texH,
          (fu + fw) / texW,
          fv / texH,
          fu / texW,
          (fv + fh) / texH,
          (fu + fw) / texW,
          (fv + fh) / texH,
        ];
      }
      const hasFaces = faces.some(Boolean);
      return hasFaces ? faces : null;
    } catch {}
  }
  if (c.uv?.length >= 2) {
    const [u, v] = c.uv;
    const x = sx,
      y = sy,
      z = sz;
    const uvData = [
      [u, v + z, z, y],
      [u + z + x, v + z, z, y],
      [u + z + x, v + z, -x, -z],
      [u + z + x + x, v, -x, z],
      [u + z + z + x, v + z, x, y],
      [u + z, v + z, x, y],
    ];
    return uvData.map(([fu, fv, fw, fh]) => [
      fu / texW,
      fv / texH,
      (fu + fw) / texW,
      fv / texH,
      fu / texW,
      (fv + fh) / texH,
      (fu + fw) / texW,
      (fv + fh) / texH,
    ]);
  }
  return null;
}

function eulerToQuaternionJS(rxDeg, ryDeg, rzDeg) {
  const rx = (rxDeg * Math.PI) / 180,
    ry = (ryDeg * Math.PI) / 180,
    rz = (rzDeg * Math.PI) / 180;
  const cosX = Math.cos(rx),
    sinX = Math.sin(rx);
  const cosY = Math.cos(ry),
    sinY = Math.sin(ry);
  const cosZ = Math.cos(rz),
    sinZ = Math.sin(rz);
  const m00 = cosY * cosZ,
    m01 = -cosY * sinZ,
    m02 = sinY;
  const m10 = cosX * sinZ + sinX * sinY * cosZ,
    m11 = cosX * cosZ - sinX * sinY * sinZ,
    m12 = -sinX * cosY;
  const m20 = sinX * sinZ - cosX * sinY * cosZ,
    m21 = sinX * cosZ + cosX * sinY * sinZ,
    m22 = cosX * cosY;
  const trace = m00 + m11 + m22;
  let qw, qx, qy, qz;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qx, qy, qz, qw];
}
