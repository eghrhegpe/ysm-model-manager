import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GetModel3DSpec } from "../../wailsjs/go/main/App.js";
import { buildSpecFromModel } from "./model3d-spec.js";

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

// 调试用：控制台可调 window.debugGetSpec(path) 获取骨骼数据（仅开发模式）
if (
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
) {
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
}

export async function renderModel3D(container, model, textureUrl, texIdx = 0) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b2e);
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 80, -120);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
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
      if (g.length === 1) {
        merged.push(g[0]);
        continue;
      }
      // 合并多个 mesh：仅合并无旋转的 mesh（identity quaternion），有旋转的保留原样
      let positions = [],
        normals = [],
        uvs = [],
        idx = [],
        idxOff = 0;
      const standalone = [];
      for (const md of g) {
        const isIdentity =
          md.localRotation?.[3] === 1 &&
          md.localRotation?.[0] === 0 &&
          md.localRotation?.[1] === 0 &&
          md.localRotation?.[2] === 0;
        if (!isIdentity) {
          standalone.push(md);
          continue;
        }
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
          positions,
          normals,
          uvs,
          indices: idx,
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
        const vx = Math.abs(md.positions[i]);
        const vy = Math.abs(md.positions[i + 1] || 0);
        const vz = Math.abs(md.positions[i + 2] || 0);
        const v = Math.max(vx, vy, vz);
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

  const _keys = {};
  const _onKeyDown = (e) => {
    _keys[e.key.toLowerCase()] = true;
    if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  };
  const _onKeyUp = (e) => { _keys[e.key.toLowerCase()] = false; };
  document.addEventListener("keydown", _onKeyDown);
  document.addEventListener("keyup", _onKeyUp);

  let _lastTime = performance.now();
  let _camSpeed = 20;
  let _orbitMode = true;
  const _orbitTarget = controls.target.clone();
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  let _mouseDown = false;
  let _lastMouse = { x: 0, y: 0 };

  function onMouseDown(e) {
    if (!_orbitMode && e.button === 0) { _mouseDown = true; _lastMouse.x = e.clientX; _lastMouse.y = e.clientY; }
  }
  function onMouseUp() { _mouseDown = false; }
  function onMouseMove(e) {
    if (_orbitMode || !_mouseDown) return;
    const dx = e.clientX - _lastMouse.x;
    const dy = e.clientY - _lastMouse.y;
    _lastMouse.x = e.clientX;
    _lastMouse.y = e.clientY;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= dx * 0.003;
    _euler.x -= dy * 0.003;
    _euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, _euler.x));
    camera.quaternion.setFromEuler(_euler);
  }
  renderer.domElement.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);

  controls.enableRotate = true;

  function renderLoop() {
    _rafId = requestAnimationFrame(renderLoop);
    const now = performance.now();
    const dt = Math.min((now - _lastTime) / 1000, 0.1);
    _lastTime = now;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const forward = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();

    if (_keys["w"] || _keys["arrowup"])    move.add(forward);
    if (_keys["s"] || _keys["arrowdown"])  move.sub(forward);
    if (_keys["a"] || _keys["arrowleft"])  move.sub(right);
    if (_keys["d"] || _keys["arrowright"]) move.add(right);
    if (_keys[" "]) move.y += 1;
    if (_keys["shift"]) move.y -= 1;

    if (move.length() > 0) {
      move.normalize().multiplyScalar(_camSpeed * dt);
      camera.position.add(move);
      _orbitTarget.add(move);
    }

    if (_orbitMode) {
      controls.target.copy(_orbitTarget);
      controls.update();
      _orbitTarget.copy(controls.target);
    } else {
      controls.target.copy(camera.position).addScaledVector(camDir, 10);
      controls.update();
    }

    renderer.render(scene, camera);
  }
  _rafId = requestAnimationFrame(renderLoop);
  renderer.render(scene, camera);
  return {
    setSpeed: (v) => { _camSpeed = v; },
    setRotationMode: (orbit) => {
      _orbitMode = orbit;
      if (orbit) {
        controls.enableRotate = true;
        _orbitTarget.copy(controls.target);
      } else {
        _euler.setFromQuaternion(camera.quaternion);
        controls.enableRotate = false;
      }
    },
    cleanup: () => {
      if (_rafId != null) cancelAnimationFrame(_rafId);
      _rafId = null;
      document.removeEventListener("keydown", _onKeyDown);
      document.removeEventListener("keyup", _onKeyUp);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
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
