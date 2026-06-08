/**
 * 3D 模型预览 — 基于 Three.js（通过 importmap 加载 CDN）
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * 创建 3D 模型预览
 * @param {HTMLElement} container - 挂载容器
 * @param {object} model - BedrockModel（含 bones, cubes, texWidth, texHeight）
 * @param {string} [textureUrl] - 纹理图片 URL（base64 data URI）
 * @param {object} [player] - AnimationPlayer 实例（可选，连接后自动同步动画）
 * @returns {Promise<{cleanup: Function, setPlayer: Function}>}
 */
export async function renderModel3D(container, model, textureUrl, player) {
  // ---- 场景 ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b2e);

  // ---- 相机 ----
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(20, 15, 25);
  camera.lookAt(0, 10, 0);

  // ---- 渲染器 ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  // ---- 轨道控制 ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 10, 0);
  controls.update();

  // ---- 灯光 ----
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(10, 30, 20);
  scene.add(dirLight);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
  backLight.position.set(-10, 10, -20);
  scene.add(backLight);

  // ---- 地面网格 ----
  const grid = new THREE.GridHelper(40, 20, 0x444488, 0x333366);
  grid.position.y = -1;
  scene.add(grid);

  // ---- 加载纹理 ----
  let texture = null;
  if (textureUrl) {
    const loader = new THREE.TextureLoader();
    texture = loader.load(textureUrl);
  }

  // ---- 构建骨骼层级 ----
  // name → THREE.Group 映射
  const boneGroupMap = new Map();
  // 先创建所有骨骼的 Group
  for (const bone of model.bones) {
    const g = new THREE.Group();
    g.name = bone.name;
    // 存储骨骼级 pivot 和 cubes 数据以便后续动画
    g.userData = { pivot: bone.pivot || [0, 0, 0] };
    boneGroupMap.set(bone.name, g);
  }

  // 按 parent 关系挂载
  const rootGroup = new THREE.Group();
  rootGroup.name = "__root__";
  scene.add(rootGroup);

  for (const bone of model.bones) {
    const g = boneGroupMap.get(bone.name);
    if (bone.parent && boneGroupMap.has(bone.parent)) {
      boneGroupMap.get(bone.parent).add(g);
    } else {
      rootGroup.add(g);
    }
  }

  // ---- 为每个骨骼生成立方体 Mesh ----
  // 材质：带纹理或纯色
  const defaultMat = new THREE.MeshStandardMaterial({
    color: 0x7c83ff,
    roughness: 0.6,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  });

  for (const bone of model.bones) {
    const group = boneGroupMap.get(bone.name);
    if (!group) continue;
    const bonePivot = bone.pivot || [0, 0, 0];

    for (const c of bone.cubes || []) {
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;
      const [pvx, pvy, pvz] = c.pivot || [0, 0, 0];

      // BoxGeometry 以中心为原点
      const geo = new THREE.BoxGeometry(sx, sy, sz);

      let mat;
      if (texture) {
        // 基岩版 Box UV 映射（简化：整张纹理贴到每个面）
        // 更好的 UV 映射需要按面计算 UV 坐标
        const uvs = geo.attributes.uv;
        // 一个面一个面的 UV 计算
        // Box UV: 每个面对应纹理上的一个矩形区域
        // 此处简化处理，使用纹理整体映射
        mat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.7,
          metalness: 0.05,
          transparent: true,
          opacity: 0.95,
        });
        // 尝试设置更精确的 UV
        applyBoxUV(geo, c, model.texWidth || 512, model.texHeight || 512);
      } else {
        mat = defaultMat;
      }

      const mesh = new THREE.Mesh(geo, mat);
      // cube 原点在底面一角，Three.js Box 以中心为原点
      mesh.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
      // pivot 以世界坐标为基准，存下来供动画使用
      mesh.userData.pivot = [pvx, pvy, pvz];
      mesh.userData.origin = [ox, oy, oz];
      mesh.userData.size = [sx, sy, sz];

      // 计算相对于骨骼 pivot 的偏移
      const relPivot = [
        pvx - bonePivot[0],
        pvy - bonePivot[1],
        pvz - bonePivot[2],
      ];
      mesh.userData.relPivot = relPivot;
      // cube 位置相对于骨骼 pivot
      mesh.position.set(
        ox + sx / 2 - bonePivot[0],
        oy + sy / 2 - bonePivot[1],
        oz + sz / 2 - bonePivot[2],
      );

      group.add(mesh);
    }
  }

  // 调整根骨骼位置（使模型居中）
  rootGroup.position.set(0, 0, 0);

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

  function renderLoop() {
    _animFrameId = requestAnimationFrame(renderLoop);

    // 同步动画变换到骨骼 Group
    if (_player) {
      const transforms = _player.getCurrentTransforms();
      if (transforms) {
        for (const [boneName, t] of transforms) {
          const g = boneGroupMap.get(boneName);
          if (!g) continue;
          const pivot = g.userData.pivot || [0, 0, 0];

          // 位移
          if (t.position) {
            g.position.set(t.position[0], t.position[1], t.position[2]);
          }
          // 旋转（欧拉角 → 弧度）
          if (t.rotation) {
            // Three.js 使用弧度
            g.rotation.set(
              ((t.rotation[0] || 0) * Math.PI) / 180,
              ((t.rotation[1] || 0) * Math.PI) / 180,
              ((t.rotation[2] || 0) * Math.PI) / 180,
              "XYZ",
            );
          }
          // 缩放
          if (t.scale) {
            g.scale.set(t.scale[0] || 1, t.scale[1] || 1, t.scale[2] || 1);
          }
        }
      }
    }

    controls.update();
    renderer.render(scene, camera);
  }
  renderLoop();

  // ---- 返回控制接口 ----
  return {
    setPlayer: (p) => {
      _player = p;
    },
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

/**
 * 基岩版 Box UV 映射
 * 根据 cube 位置/大小和纹理尺寸计算每个面的 UV 坐标
 */
function applyBoxUV(geo, cube, texW, texH) {
  const [ox, oy, oz] = cube.origin;
  const [sx, sy, sz] = cube.size;
  const [uvx, uvy] = cube.uv || [0, 0];

  // 基岩版 Box UV 面顺序（Three.js 默认顺序）：
  // 0: right (+x), 1: left (-x), 2: top (+y), 3: bottom (-y), 4: front (+z), 5: back (-z)
  // 每个面 4 个顶点，共 24 个 UV 坐标 [u, v]
  const uvs = geo.attributes.uv;
  const array = uvs.array;

  // 纹理像素 → UV 坐标
  const pu = (v) => v / texW;
  const pv = (v) => 1 - v / texH; // 纹理 Y 轴翻转

  // 每个面的 UV 四角
  // 面顺序: right, left, top, bottom, front, back
  const faceUVs = [
    // right (+x): 东面, 宽 sz, 高 sy
    [pu(uvx + 2 * sz + sx), pv(uvy), pu(uvx + 2 * sz + sx + sz), pv(uvy + sy)],
    // left (-x): 西面
    [pu(uvx), pv(uvy), pu(uvx + sz), pv(uvy + sy)],
    // top (+y): 顶面, 宽 sx, 深 sz
    [pu(uvx + sz), pv(uvy + sy), pu(uvx + sz + sx), pv(uvy + sy + sz)],
    // bottom (-y): 底面
    [pu(uvx + sz + sx), pv(uvy + sy), pu(uvx + 2 * sz + sx), pv(uvy + sy + sz)],
    // front (+z): 正面（南面）, 宽 sx, 高 sy
    [pu(uvx + sz), pv(uvy), pu(uvx + sz + sx), pv(uvy + sy)],
    // back (-z): 背面（北面）
    [pu(uvx + sz + sx), pv(uvy), pu(uvx + 2 * sz + sx), pv(uvy + sy)],
  ];

  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = faceUVs[f];
    const idx = f * 8;
    // 每个面 4 个顶点：用 u0,v0 到 u1,v1 映射
    array[idx] = u0;
    array[idx + 1] = v0;
    array[idx + 2] = u1;
    array[idx + 3] = v0;
    array[idx + 4] = u1;
    array[idx + 5] = v1;
    array[idx + 6] = u0;
    array[idx + 7] = v1;
  }

  uvs.needsUpdate = true;
}
