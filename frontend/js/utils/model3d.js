import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GetModel3DSpec } from "../../wailsjs/go/main/App.js";

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
  // 调试用：暴露 model 和 buildSpecFromModel 到全局
  window.__lastModel = model;
  window.__buildSpecFromModel = buildSpecFromModel;

  // 从 Go 获取预计算的 Three.js Spec
  let spec = { models: [] };
  const forceJS = window.$forceJSSpec; // 调试用：设 true 强制走 JS 兜底
  // 多纹理模型 Go spec 没有 per-mesh 纹理索引，强制走 JS 兜底
  const multiTex = (model.textures?.length > 1) || false;
  if (!forceJS && !multiTex) {
    try {
      const jsonStr = await GetModel3DSpec(model._modelPath || "");
      const parsed = JSON.parse(jsonStr);
      if (parsed.models) spec = parsed;
    } catch (e) {
      console.warn("[3D] Fallback to JS geometry:", e);
    }
  }
  if (!spec.models?.length && model.bones?.length) {
    spec = buildSpecFromModel(model);
  }
  // 调试用：暴露最近一次 spec 到全局（在 JS 兜底之后）
  window.__last3DSpec = spec;
  const rootGroup = new THREE.Group();
  rootGroup.name = "__root__";
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
    const camDist = Math.max(modelHeight * 1.5, 60);
    camera.position.set(camDist * 0.4, centerY, -camDist * 0.8);
    camera.lookAt(0, centerY, 0);
    controls.target.set(0, centerY, 0);
    controls.update();
    let cubeTex = null;
    const texArr = texMap.size > 0 ? [...texMap.values()] : [];
    if (texArr.length > 0) {
      cubeTex = texArr[texIdx ?? 0] || texArr[0];
    }
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
      const meshTex = texArr.length > 0
        ? texArr[md.texIdx ?? (texIdx ?? 0)] || texArr[0]
        : null;
      const mat = meshTex
        ? new THREE.MeshBasicMaterial({
            map: meshTex,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
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
  window.addEventListener("resize", () => {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  });
  function renderLoop() {
    requestAnimationFrame(renderLoop);
    controls.update();
    renderer.render(scene, camera);
  }
  renderLoop();
  renderer.render(scene, camera);
  return {
    cleanup: () => {
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
  // 首次出现的骨骼 pivot（同名骨骼用首次的）
  const firstPivot = {};
  for (const b of model.bones || []) {
    if (firstPivot[b.name] === undefined) {
      firstPivot[b.name] = b.pivot || [0, 0, 0];
    }
  }
  for (const b of model.bones || []) {
    const bp = b.pivot || [0, 0, 0];
    let localPos = [-bp[0], bp[1], bp[2]];
    if (b.parent) {
      const pp = model.bones.find((x) => x.name === b.parent)?.pivot || [
        0, 0, 0,
      ];
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
    if (boneIdx[b.name] !== undefined) {
      const existing = bones[boneIdx[b.name]];
      // 同名骨骼：如果现有骨骼没有 parent 但当前骨骼有 parent → 补全层级和旋转
      if (!existing.parentId && b.parent) {
        existing.parentId = b.parent;
        existing.localPosition = localPos;
        existing.localRotation = entry.localRotation;
      }
    } else {
      boneIdx[b.name] = bones.length;
      bones.push(entry);
    }
    // cubes 全部追加（同名骨骼的也加入）
    // 使用统一的 bone pivot（首次出现的 pivot），确保所有 cube 相对于同一根骨骼位置
    const fp = firstPivot[b.name] || bp;
    // 用骨骼自身所属几何体的纹理尺寸算 UV（YSMViewer 每几何体独立处理）
    const bTexW = b._texWidth || texW;
    const bTexH = b._texHeight || texH;
    for (let ci = 0; ci < (b.cubes || []).length; ci++) {
      const c = b.cubes[ci];
      const md = buildCubeMeshDataJS(c, fp, bTexW, bTexH, b.name, ci);
      if (md) {
        // 标记此 mesh 所属骨骼的纹理索引（多纹理模型用）
        md.texIdx = b._texIdx ?? 0;
        meshes.push(md);
      }
    }
  }

  // 后处理：将 RightArm/LeftArm 挂到 Arm 下面（YSMParser 解码 .ysm 后丢失的层级）
  const armBone = bones.find(b => b.name === "Arm" && b.parentId);
  const rightArmBone = bones.find(b => b.name === "RightArm" && !b.parentId);
  const leftArmBone = bones.find(b => b.name === "LeftArm" && !b.parentId);
  if (armBone && rightArmBone) {
    const armPivot = model.bones.find(b => b.name === "Arm")?.pivot || [0, 0, 0];
    const raPivot = model.bones.find(b => b.name === "RightArm")?.pivot || [0, 0, 0];
    rightArmBone.parentId = "Arm";
    rightArmBone.localPosition = [-raPivot[0] - -armPivot[0], raPivot[1] - armPivot[1], raPivot[2] - armPivot[2]];
  }
  if (armBone && leftArmBone) {
    const armPivot = model.bones.find(b => b.name === "Arm")?.pivot || [0, 0, 0];
    const laPivot = model.bones.find(b => b.name === "LeftArm")?.pivot || [0, 0, 0];
    leftArmBone.parentId = "Arm";
    leftArmBone.localPosition = [-laPivot[0] - -armPivot[0], laPivot[1] - armPivot[1], laPivot[2] - armPivot[2]];
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
      return faces;
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
