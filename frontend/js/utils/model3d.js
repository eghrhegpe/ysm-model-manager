/**
 * 3D 模型预览 — 基于 Three.js（通过 importmap 加载 CDN）
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { evaluateClip } from "./animation.js";

/**
 * 创建 3D 模型预览
 * @param {HTMLElement} container - 挂载容器
 * @param {object} model - BedrockModel（含 bones, cubes）
 * @param {string} [textureUrl] - 纹理图片 URL（base64 data URI）
 * @param {object} [player] - AnimationPlayer 实例（用于读取当前时间和 clip）
 * @param {number} [texIdx=0] - 使用的纹理索引
 * @returns {Promise<{cleanup: Function}>}
 */
export async function renderModel3D(
  container,
  model,
  textureUrl,
  player,
  texIdx,
) {
  // ---- 场景 ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b2e);

  // ---- 相机 ----
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 80, -120);
  camera.lookAt(0, 80, 0);

  // ---- 渲染器 ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  // ---- 轨道控制 ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 80, 0);
  controls.update();

  // ---- 灯光 ----
  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(10, 30, 20);
  scene.add(dirLight);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
  backLight.position.set(-10, 10, -20);
  scene.add(backLight);

  // ---- 地面网格 + 坐标轴 ----
  const grid = new THREE.GridHelper(400, 20, 0x444488, 0x333366);
  grid.position.y = -1;
  scene.add(grid);
  const axes = new THREE.AxesHelper(60);
  scene.add(axes);

  // ---- 加载所有纹理 ----
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
    console.log(`[3D] 已加载 ${texMap.size} 张纹理`);
  }

  // ---- 构建骨骼层级（仅标签+动画用，cube 放世界坐标与 2D 一致） ----
  const PXL = 1;
  const boneGroupMap = new Map();
  const rootGroup = new THREE.Group();
  rootGroup.name = "__root__";
  scene.add(rootGroup);

  // 创建骨骼 Group（放在 pivot 位置，用于标签和后续动画旋转）
  for (const bone of model.bones) {
    const g = new THREE.Group();
    g.name = bone.name;
    g.scale.set(1, 1, 1);
    const p = bone.pivot || [0, 0, 0];
    g.position.set(p[0] * PXL, p[1] * PXL, p[2] * -PXL);
    boneGroupMap.set(bone.name, g);
    if (bone.parent && boneGroupMap.has(bone.parent)) {
      boneGroupMap.get(bone.parent).add(g);
    } else {
      rootGroup.add(g);
    }
  }

  // ---- 计算模型中心（基于 cube 世界坐标） ----
  let minY = Infinity,
    maxY = -Infinity;
  for (const bone of model.bones) {
    for (const c of bone.cubes || []) {
      const y = c.origin[1] + c.size[1] / 2;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const centerY = ((minY + maxY) / 2) * PXL;
  const modelHeight = (maxY - minY) * PXL;
  const camDist = Math.max(modelHeight * 1.5, 60);
  camera.position.set(camDist * 0.4, centerY, -camDist * 0.8);
  camera.lookAt(0, centerY, 0);
  controls.target.set(0, centerY, 0);
  controls.update();

  // ---- 为每个骨骼生成立方体 Mesh（直接放 rootGroup，cube.origin 是世界坐标） ----
  for (const bone of model.bones) {
    const group = boneGroupMap.get(bone.name);
    if (!group) continue;

    for (const c of bone.cubes || []) {
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;

      // 选择该骨骼对应的纹理
      let cubeTex = null;
      if (texMap.size > 0) {
        const texArr = [...texMap.values()];
        cubeTex = texArr[texIdx ?? 0] || texArr[0];
      }

      const geo = new THREE.BoxGeometry(sx * PXL, sy * PXL, sz * PXL);

      // UV 映射
      if (cubeTex) {
        if (c.faceUV) {
          applyFaceUV(geo, c, cubeTex, model.texWidth, model.texHeight);
        } else {
          applyBoxUV(geo, c, cubeTex);
        }
      }

      let mat;
      if (cubeTex) {
        mat = new THREE.MeshBasicMaterial({
          map: cubeTex,
          transparent: false,
          side: THREE.DoubleSide,
        });
      } else {
        mat = new THREE.MeshBasicMaterial({
          color: 0x44aa88,
          side: THREE.DoubleSide,
        });
      }

      const mesh = new THREE.Mesh(geo, mat);
      // cube 位置相对骨骼 pivot，挂到骨骼 Group 下
      const bp = bone.pivot || [0, 0, 0];
      mesh.position.set(
        (ox + sx / 2 - bp[0]) * PXL,
        (oy + sy / 2 - bp[1]) * PXL,
        -(oz + sz / 2 - bp[2]) * PXL,
      );
      // 应用 cube 初始旋转
      if (c.rotation) {
        mesh.rotation.set(
          (c.rotation[0] * Math.PI) / 180,
          (c.rotation[1] * Math.PI) / 180,
          (c.rotation[2] * Math.PI) / 180,
        );
      }
      group.add(mesh);
    }

    // 骨骼名标签
    if (bone.cubes?.length > 0) makeBoneLabel(group, bone.name);
  }

  // ---- 窗口大小自适应 ----
  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  };
  window.addEventListener("resize", onResize);

  // ---- 动画同步 ----
  let _player = player || null;
  let _animFrameId = null;
  // 骨骼 pivot 查询表
  const pivotMap = new Map();
  for (const b of model.bones) {
    if (b.pivot) pivotMap.set(b.name, b.pivot);
  }

  function renderLoop() {
    _animFrameId = requestAnimationFrame(renderLoop);

    // 同步动画变换到骨骼 Group（局部变换，层级由 Three.js 自动传播）
    if (_player) {
      const clip = _player.currentClip;
      if (clip) {
        const localTransforms = evaluateClip(clip, _player.time, null, true);
        for (const [boneName, t] of localTransforms) {
          const g = boneGroupMap.get(boneName);
          if (!g) continue;
          // 复位到 pivot 位置，防止动画位置数据干扰
          const bp = pivotMap.get(boneName);
          if (bp) g.position.set(bp[0] * PXL, bp[1] * PXL, bp[2] * -PXL);
          if (t.rotation) {
            g.rotation.set(
              ((t.rotation[0] || 0) * Math.PI) / 180,
              ((t.rotation[1] || 0) * Math.PI) / 180,
              ((t.rotation[2] || 0) * Math.PI) / 180,
              "XYZ",
            );
          }
        }
      }
    }

    controls.update();
    renderer.render(scene, camera);
  }
  renderLoop();
  renderer.render(scene, camera);

  // ---- 返回控制接口 ----
  return {
    cleanup: () => {
      _player = null;
      cancelAnimationFrame(_animFrameId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      container.innerHTML = "";
      // 释放 Three.js 资源
      scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    },
  };
}

/** 生成骨骼名标签 Sprite */
function makeBoneLabel(group, name) {
  if (!name || name.length > 20) return;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 40, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(205,214,244,0.85)";
  ctx.font = "20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 128, 24);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(8, 1.5, 0.5);
  sprite.position.set(0, 1.5, 0);
  group.add(sprite);
}

/**
 * 基岩版 Box UV 映射 — 使用纹理图片的实际尺寸
 * cube.uv = [u_off, v_off] 纹理像素坐标（左上原点）
 * face 排列匹配 BoxGeometry: +X / -X / +Y / -Y / +Z / -Z
 */
function applyBoxUV(geo, cube, tex) {
  const texW = tex.userData.imgWidth;
  const texH = tex.userData.imgHeight;
  if (!texW || !texH) return;
  const [uvx, uvy] = Array.isArray(cube.uv) ? cube.uv : [0, 0];
  const [sx, sy, sz] = cube.size;

  const pu = (v) => v / texW;
  const pv = (v) => 1 - v / texH; // 基岩版 Y-down → Three.js Y-up

  // 6 faces: 每个面在纹理上的矩形区域 (像素坐标)
  // 标准 Bedrock Box UV 布局（正确版）：
  // 行1: [left(-x) @ (0,0)] [right(+x) @ (sz,0)] [front(+z) @ (sz,0)] [back(-z) @ (sz+sx,0)]
  // 行2: [top(+y) @ (sz,sy)] [bottom(-y) @ (sz+sx,sy)]
  const rects = [
    { u0: uvx + sz, v0: uvy, w: sz, h: sy }, // 0: +X right
    { u0: uvx, v0: uvy, w: sz, h: sy }, // 1: -X left
    { u0: uvx + sz, v0: uvy + sy, w: sx, h: sz }, // 2: +Y top
    { u0: uvx + sz + sx, v0: uvy + sy, w: sx, h: sz }, // 3: -Y bottom
    { u0: uvx + sz * 2, v0: uvy, w: sx, h: sy }, // 4: +Z front
    { u0: uvx + sz * 2 + sx, v0: uvy, w: sx, h: sy }, // 5: -Z back
  ];

  // BoxGeometry → 24 verts → 48 UV floats
  const uvArr = new Float32Array(48);
  for (let f = 0; f < 6; f++) {
    const r = rects[f];
    const u0 = pu(r.u0),
      v0 = pv(r.v0);
    const u1 = pu(r.u0 + r.w),
      v1 = pv(r.v0 + r.h);
    const i = f * 8;
    // quad: bottom-left, bottom-right, top-right, top-left
    uvArr[i] = u0;
    uvArr[i + 1] = v1;
    uvArr[i + 2] = u1;
    uvArr[i + 3] = v1;
    uvArr[i + 4] = u1;
    uvArr[i + 5] = v0;
    uvArr[i + 6] = u0;
    uvArr[i + 7] = v0;
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
}

/**
 * 每面独立 UV 映射 — 直接使用 faceUV 中各面的 uv/uv_size
 * faceUV JSON 格式: {"north":{"uv":[x,y],"uv_size":[w,h]}, "east":{...}, ...}
 * Three.js BoxGeometry face order: +X/-X/+Y/-Y/+Z/-Z
 * 映射: east→+X, west→-X, up→+Y, down→-Y, south→+Z, north→-Z
 */
function applyFaceUV(geo, cube, tex, modelTexW, modelTexH) {
  const texW = tex.userData.imgWidth;
  const texH = tex.userData.imgHeight;
  if (!texW || !texH) return;

  // UV 坐标是模型声明的 texWidth/texHeight 空间，须缩放到实际图片尺寸
  const scaleX = texW / (modelTexW || texW);
  const scaleY = texH / (modelTexH || texH);

  let faceData;
  try {
    faceData = JSON.parse(cube.faceUV);
  } catch (e) {
    console.log("[3D] faceUV 解析失败:", e);
    return;
  }

  const faceMap = ["east", "west", "up", "down", "south", "north"];
  const pu = (v) => (v * scaleX) / texW;
  const pv = (v) => 1 - (v * scaleY) / texH;

  const uvArr = new Float32Array(48);
  for (let f = 0; f < 6; f++) {
    const name = faceMap[f];
    const fd = faceData[name];
    if (!fd) continue;

    const [u, v] = fd.uv || [0, 0];
    let [w, h] = fd.uv_size || [0, 0];
    let flipped = false;
    if (h < 0) {
      h = -h;
      flipped = true;
    }
    const i = f * 8;
    if (flipped) {
      // 负高度: v 是底部（uv 起始位置），v-h 是顶部
      uvArr[i] = pu(u);
      uvArr[i + 1] = pv(v);
      uvArr[i + 2] = pu(u + w);
      uvArr[i + 3] = pv(v);
      uvArr[i + 4] = pu(u + w);
      uvArr[i + 5] = pv(v - h);
      uvArr[i + 6] = pu(u);
      uvArr[i + 7] = pv(v - h);
    } else {
      // 正高度: v 是顶部，v+h 是底部
      uvArr[i] = pu(u);
      uvArr[i + 1] = pv(v + h);
      uvArr[i + 2] = pu(u + w);
      uvArr[i + 3] = pv(v + h);
      uvArr[i + 4] = pu(u + w);
      uvArr[i + 5] = pv(v);
      uvArr[i + 6] = pu(u);
      uvArr[i + 7] = pv(v);
    }
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
}
