import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

window.__dumpScene = () => {
  const root = window.__rootGroup3d;
  if (!root) { console.warn("无 scene，先渲染模型"); return; }
  const wv = new THREE.Vector3();
  const stats = { bones: 0, meshes: 0, vertices: 0, indices: 0 };
  const bones = [];
  root.traverse((c) => {
    if (c.isGroup && c.name) {
      stats.bones++;
      c.getWorldPosition(wv);
      const p = c.position.toArray().map(v => +v.toFixed(2));
      const w = wv.toArray().map(v => +v.toFixed(2));
      bones.push({ name: c.name, pos: `(${p[0]},${p[1]},${p[2]})`, world: `(${w[0]},${w[1]},${w[2]})` });
    }
    if (c.isMesh) { stats.meshes++; stats.vertices += c.geometry?.attributes?.position?.count || 0; stats.indices += c.geometry?.index?.count || 0; }
  });
  console.table(bones);
  console.log("统计:", stats);
  return { bones, stats };
};

export function buildSceneMesh(spec) {
  let meshMax = 0;
  for (const mg of spec.models || [])
    for (const md of mg.meshGroups || [])
      for (let i = 0; i < (md.positions?.length || 0); i += 3) {
        const v = Math.max(Math.abs(md.positions[i]), Math.abs(md.positions[i+1]||0), Math.abs(md.positions[i+2]||0));
        if (v > meshMax) meshMax = v;
      }
  const modelScale = meshMax > 32 ? 1 / 16 : meshMax > 4 ? 1 / 4 : 1;
  const rootGroup = new THREE.Group();
  rootGroup.scale.set(modelScale, modelScale, modelScale);
  const boneGroupMap = new Map();
  for (const mg of spec.models)
    for (const bd of mg.bones || []) {
      const g = new THREE.Group();
      g.name = bd.name;
      g.position.set(bd.localPosition[0], bd.localPosition[1], bd.localPosition[2]);
      if (bd.localRotation[3] !== 1 || bd.localRotation[0] !== 0 || bd.localRotation[1] !== 0 || bd.localRotation[2] !== 0)
        g.quaternion.set(bd.localRotation[0], bd.localRotation[1], bd.localRotation[2], bd.localRotation[3]);
      boneGroupMap.set(bd.id, g);
    }
  for (const mg of spec.models)
    for (const bd of mg.bones || []) {
      const g = boneGroupMap.get(bd.id);
      if (!g) continue;
      if (bd.parentId && boneGroupMap.has(bd.parentId)) boneGroupMap.get(bd.parentId).add(g);
      else rootGroup.add(g);
    }
  return { boneGroupMap, rootGroup, modelScale, meshMax };
}

export async function renderModel3D(container, texArr, spec, texIdx = 0) {
  const scene = new THREE.Scene();
  window.__scene3d = scene;
  scene.background = new THREE.Color(0x1a1b2e);
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  window.__camera3d = camera;
  camera.position.set(0, 80, -120);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  window.__renderer3d = renderer;
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = "";
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 80, 0);
  controls.update();
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 2);
  dl.position.set(10, 30, 20); scene.add(dl);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
  backLight.position.set(-10, 10, -20); scene.add(backLight);
  const grid = new THREE.GridHelper(400, 20, 0x6666aa, 0x444488);
  grid.position.y = -1; scene.add(grid);
  scene.add(new THREE.AxesHelper(60));

  const { boneGroupMap, rootGroup, modelScale, meshMax } = buildSceneMesh(spec);
  window.__rootGroup3d = rootGroup;
  scene.add(rootGroup);

  for (const mg of spec.models || []) {
    if (!mg.meshGroups?.length) continue;
    const grouped = new Map();
    for (const md of mg.meshGroups) {
      const key = md.boneId + ":" + (md.texIdx ?? 0);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(md);
    }
    const merged = [];
    for (const [, g] of grouped) {
      if (g.length === 1) { merged.push(g[0]); continue; }
      let positions = [], normals = [], uvs = [], idx = [], idxOff = 0;
      const standalone = [];
      for (const md of g) {
        const isId = md.localRotation?.[3] === 1 && md.localRotation?.[0] === 0 && md.localRotation?.[1] === 0 && md.localRotation?.[2] === 0;
        if (!isId) { standalone.push(md); continue; }
        const dx = md.localPosition?.[0] || 0, dy = md.localPosition?.[1] || 0, dz = md.localPosition?.[2] || 0;
        for (let i = 0; i < (md.positions?.length || 0); i += 3) { positions.push((md.positions[i]||0)+dx); positions.push((md.positions[i+1]||0)+dy); positions.push((md.positions[i+2]||0)+dz); }
        if (md.normals) normals.push(...md.normals);
        if (md.uvs) uvs.push(...md.uvs);
        for (let i = 0; i < (md.indices?.length || 0); i++) idx.push((md.indices[i]||0)+idxOff);
        idxOff += (md.positions?.length||0)/3;
      }
      if (positions.length) merged.push({ id: g[0].boneId+"_merged", boneId: g[0].boneId, texIdx: g[0].texIdx, localPosition: [0,0,0], localRotation: [0,0,0,1], positions, normals, uvs, indices: idx });
      merged.push(...standalone);
    }
    mg.meshGroups = merged;
    for (const md of mg.meshGroups) {
      const bg = boneGroupMap.get(md.boneId);
      if (!bg) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(md.positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(md.normals, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(md.uvs, 2));
      geo.setIndex(md.indices);
      const mti = md.texIdx ?? texIdx ?? 0;
      const mt = texArr.length > 0 ? texArr[mti] || texArr[0] : null;
      const mat = mt
        ? new THREE.MeshBasicMaterial({ map: mt, alphaTest: mti > 0 ? 0.5 : 0.02, side: mti > 0 ? THREE.BackSide : THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({ color: 0x44aa88, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(md.localPosition[0], md.localPosition[1], md.localPosition[2]);
      if (md.localRotation[3] !== 1 || md.localRotation[0] !== 0 || md.localRotation[1] !== 0 || md.localRotation[2] !== 0)
        mesh.quaternion.set(md.localRotation[0], md.localRotation[1], md.localRotation[2], md.localRotation[3]);
      bg.add(mesh);
    }
  }

  // AABB 计算世界空间中心 Y（已含 modelScale）
  scene.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(rootGroup);
  const centerY = box.isEmpty() ? 0 : box.getCenter(new THREE.Vector3()).y;

  const camDist = Math.max(meshMax * 1.5 * modelScale, 60 * modelScale);
  camera.position.set(camDist * 0.4, centerY, -camDist * 0.8);
  camera.lookAt(0, centerY, 0);
  controls.target.set(0, centerY, 0);
  controls.update();
  const _initCamPos = camera.position.clone();
  const _initCamTarget = controls.target.clone();

  let _rafId = null;
  const _onResize = () => { const w = container.clientWidth, h = container.clientHeight; if (w > 0 && h > 0) { camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); } };
  window.addEventListener("resize", _onResize);
  const _onFSChange = () => setTimeout(_onResize, 50);
  document.addEventListener("fullscreenchange", _onFSChange);
  document.addEventListener("webkitfullscreenchange", _onFSChange);
  const _keys = {};
  const _onKeyDown = (e) => { _keys[e.key.toLowerCase()] = true; if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) e.preventDefault(); if (e.key.toLowerCase() === "f") { const modes = ["normal", "pivot", "bone"]; const next = (modes.indexOf(_debugMode) + 1) % modes.length; _debugMode = modes[next]; rebuildDebug(); } };
  const _onKeyUp = (e) => { _keys[e.key.toLowerCase()] = false; };
  document.addEventListener("keydown", _onKeyDown);
  document.addEventListener("keyup", _onKeyUp);
  let _lastTime = performance.now();
  let _camSpeed = 20;
  let _orbitMode = true;
  const _orbitTarget = controls.target.clone();
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  let _mouseDown = false, _lastMouse = { x: 0, y: 0 };
  const onMouseDown = (e) => { if (!_orbitMode && e.button === 0) { _mouseDown = true; _lastMouse = { x: e.clientX, y: e.clientY }; } };
  const onMouseUp = () => { _mouseDown = false; };
  const onMouseMove = (e) => {
    if (_orbitMode || !_mouseDown) return;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= (e.clientX-_lastMouse.x)*0.003; _euler.x -= (e.clientY-_lastMouse.y)*0.003;
    _euler.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, _euler.x));
    camera.quaternion.setFromEuler(_euler); _lastMouse = { x: e.clientX, y: e.clientY };
  };
  renderer.domElement.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  controls.enableRotate = true;
  const loop = () => {
    _rafId = requestAnimationFrame(loop);
    const dt = Math.min((performance.now()-_lastTime)/1000, 0.1); _lastTime = performance.now();
    const cd = new THREE.Vector3(); camera.getWorldDirection(cd);
    const fwd = new THREE.Vector3(cd.x, 0, cd.z).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize();
    const mv = new THREE.Vector3();
    if (_keys["w"]||_keys["arrowup"]) mv.add(fwd);
    if (_keys["s"]||_keys["arrowdown"]) mv.sub(fwd);
    if (_keys["a"]||_keys["arrowleft"]) mv.sub(right);
    if (_keys["d"]||_keys["arrowright"]) mv.add(right);
    if (_keys[" "]) mv.y += 1; if (_keys["shift"]) mv.y -= 1;
    if (mv.length() > 0) { mv.normalize().multiplyScalar(_camSpeed*dt); camera.position.add(mv); if (_orbitMode) _orbitTarget.add(mv); }
    if (_orbitMode) { controls.target.copy(_orbitTarget); controls.update(); _orbitTarget.copy(controls.target); }
    else { controls.target.copy(camera.position).addScaledVector(cd, 10); controls.update(); }
    // 调试标签自适应缩放
    if (_debugLabels) {
      for (var i = 0; i < _debugLabels.length; i++) {
        var dl = _debugLabels[i];
        var dist = dl.camera.position.distanceTo(dl.label.position);
        var s = dl.label.userData.baseScale * dist;
        dl.label.scale.set(s * 256, s * 64, 1);
      }
    }
    renderer.render(scene, camera);
  };
  _rafId = requestAnimationFrame(loop);
  renderer.render(scene, camera);

  // ===== 鼠标悬停骨骼名 + 点击复制层级 =====
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let _hoveredBone = null;
  let _hoveredMesh = null;

  // 构建骨骼层级路径映射
  const _boneParentMap = new Map();
  const _boneNameMap = new Map();
  const _boneChildrenMap = new Map();
  for (const mg of spec.models || []) {
    for (const bd of mg.bones || []) {
      _boneNameMap.set(bd.id, bd.name);
      _boneParentMap.set(bd.id, bd.parentId || null);
      if (!_boneChildrenMap.has(bd.parentId || "__root__")) {
        _boneChildrenMap.set(bd.parentId || "__root__", []);
      }
      _boneChildrenMap.get(bd.parentId || "__root__").push(bd.id);
    }
  }

  // 工具：骨骼名 → 全路径
  const getBonePath = (boneId) => {
    const parts = [];
    let current = boneId;
    while (current && _boneNameMap.has(current)) {
      parts.unshift(_boneNameMap.get(current));
      current = _boneParentMap.get(current);
    }
    return parts.join(" / ");
  };

  // 工具：骨骼名 → 第一个子骨骼名（用于区分同层骨骼）
  const getMeshBoneId = (mesh) => {
    // mesh 属于一个 boneGroup，boneGroup 的 parent 链指向根
    let obj = mesh;
    while (obj) {
      if (obj.isGroup && obj.name && _boneNameMap.has(obj.name)) {
        return obj.name;
      }
      obj = obj.parent;
    }
    return null;
  };

  const onPointerMove = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    let foundBone = null;
    let foundMesh = null;
    for (const hit of intersects) {
      const boneId = getMeshBoneId(hit.object);
      if (boneId) {
        foundBone = boneId;
        foundMesh = hit.object;
        break;
      }
    }
    if (foundBone !== _hoveredBone) {
      _hoveredBone = foundBone;
      _hoveredMesh = foundMesh;
      if (foundBone) {
        renderer.domElement.style.cursor = "pointer";
      } else {
        renderer.domElement.style.cursor = "default";
      }
    }
  };

  const onPointerClick = (e) => {
    if (!_hoveredBone) return;
    if (window._3dOnBoneSelect) {
      var bg = boneGroupMap.get(_hoveredBone);
      var wp = new THREE.Vector3();
      if (bg) bg.getWorldPosition(wp);
      var lp = bg ? bg.position : new THREE.Vector3();
      var lq = bg ? bg.quaternion : new THREE.Quaternion();
      var lr = null;
      if (lq.x !== 0 || lq.y !== 0 || lq.z !== 0 || lq.w !== 1) lr = [lq.x, lq.y, lq.z, lq.w];
      // Cube（mesh）级数据
      var cq = null;
      var cp = null;
      if (_hoveredMesh && _hoveredMesh.isMesh) {
        cq = [_hoveredMesh.quaternion.x, _hoveredMesh.quaternion.y, _hoveredMesh.quaternion.z, _hoveredMesh.quaternion.w];
        cp = [_hoveredMesh.position.x, _hoveredMesh.position.y, _hoveredMesh.position.z];
      }
      window._3dOnBoneSelect({
        name: _boneNameMap.get(_hoveredBone) || _hoveredBone,
        path: getBonePath(_hoveredBone),
        parent: _boneParentMap.get(_hoveredBone),
        children: _boneChildrenMap.get(_hoveredBone) || [],
        meshCount: (function() { var bg2 = boneGroupMap.get(_hoveredBone); var mc = 0; if (bg2) bg2.traverse(function(c) { if (c.isMesh) mc++; }); return mc; })(),
        localPos: [lp.x, lp.y, lp.z],
        worldPos: [wp.x, wp.y, wp.z],
        localRot: lr,
        cubeRot: cq,
        cubePos: cp,
      });
    }
  };

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("click", onPointerClick);

  // ===== 可视化模式切换 =====
  let _debugMode = "normal"; // "normal" | "pivot" | "bone"
  let _debugGroup = null;
  let _debugLabels = null;

  const rebuildDebug = () => {
    if (_debugGroup) {
      scene.remove(_debugGroup);
      _debugGroup = null;
    }
    _debugLabels = null;
    if (_debugMode === "normal") return;
    _debugGroup = new THREE.Group();
    scene.add(_debugGroup);

    // 获取骨骼世界坐标
    rootGroup.updateMatrixWorld(true);
    const boneWorldPositions = new Map();
    for (const mg of spec.models || []) {
      for (const bd of mg.bones || []) {
        const bg = boneGroupMap.get(bd.id);
        if (!bg) continue;
        const wp = new THREE.Vector3();
        bg.getWorldPosition(wp);
        boneWorldPositions.set(bd.id, { pos: wp, name: bd.name, parentId: bd.parentId });
      }
    }

    if (_debugMode === "pivot") {
      for (const [, data] of boneWorldPositions) {
        const top = data.pos.clone();
        top.y += 4; // 名称在骨骼上方 4 单位
        // 绿线：从骨骼位置到名称位置
        const lineGeo = new THREE.BufferGeometry().setFromPoints([data.pos, top]);
        const line = new THREE.Line(
          lineGeo,
          new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.6 }),
        );
        _debugGroup.add(line);
        // 骨骼名标签（使用 Sprite，在 render loop 中调整大小）
        const tex = makeTextTexture(data.name, "#00ff88");
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false });
        const label = new THREE.Sprite(mat);
        label.position.copy(top);
        label.userData.baseScale = 0.04; // 基础缩放，渲染循环会调整
        label.scale.set(0.04 * 256, 0.04 * 64, 1);
        _debugGroup.add(label);
        // 存储 label 以便在 render loop 中更新缩放
        if (!_debugLabels) _debugLabels = [];
        _debugLabels.push({ label, camera });
      }
    } else if (_debugMode === "bone") {
      for (const [, data] of boneWorldPositions) {
        const parentPos = data.parentId ? boneWorldPositions.get(data.parentId)?.pos : null;
        if (!parentPos) continue;
        const points = [data.pos.clone(), parentPos.clone()];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: 0x44aaff }),
        );
        _debugGroup.add(line);
      }
    }
  };

  // 文字纹理生成
  function makeTextTexture(text, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = color || "#ffffff";
    ctx.font = "24px sans-serif";
    ctx.fillText(text, 4, 40);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }
  return {
    resetCamera: () => {
      camera.position.copy(_initCamPos);
      controls.target.copy(_initCamTarget);
      _orbitTarget.copy(_initCamTarget);
      if (_orbitMode) controls.enableRotate = true;
      else { controls.enableRotate = false; const d = new THREE.Vector3(); camera.getWorldDirection(d); controls.target.copy(camera.position).addScaledVector(d, 10); }
      camera.quaternion.set(0, 0, 0, 1);
      _euler.set(0, 0, 0);
      _camSpeed = 20;
      _mouseDown = false;
      Object.keys(_keys).forEach(k => _keys[k] = false);
      controls.update();
    },
    setSpeed: (v) => { _camSpeed = v; },
    setRotationMode: (orbit) => {
      _orbitMode = orbit;
      if (orbit) { controls.enableRotate = true; if (_orbitTarget) controls.target.copy(_orbitTarget); _mouseDown = false; }
      else { _euler.setFromQuaternion(camera.quaternion); controls.enableRotate = false; const d = new THREE.Vector3(); camera.getWorldDirection(d); controls.target.copy(camera.position).addScaledVector(d,10); controls.update(); _mouseDown = false; }
    },
    setBoneVisible: (name, visible) => {
      const g = boneGroupMap.get(name);
      if (g) g.traverse(c => { c.visible = visible; });
    },
    getBoneList: () => spec.models[0]?.bones?.map(b => ({ id: b.id, name: b.name, parentId: b.parentId })) || [],
    toggleBone: (name) => {
      const g = boneGroupMap.get(name);
      if (g) g.traverse(c => { c.visible = !c.visible; });
    },
    showModelGroup: (idx) => {
      spec.models.forEach((mg, i) => {
        const vis = i === idx;
        for (const bd of mg.bones || [])
          setBoneVisible(bd.id, vis);
      });
    },
    getModelGroupCount: () => spec.models?.length || 0,
    onBoneSelect: null, // 外部设置的回调: (boneInfo) => void
    setDebugMode: (mode) => {
      _debugMode = mode;
      rebuildDebug();
    },
    cleanup: () => {
      if (_rafId != null) cancelAnimationFrame(_rafId);
      document.removeEventListener("keydown", _onKeyDown); document.removeEventListener("keyup", _onKeyUp);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp); window.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onPointerClick);
      if (_debugGroup) scene.remove(_debugGroup);
      controls.dispose(); window.removeEventListener("resize", _onResize);
      document.removeEventListener("fullscreenchange", _onFSChange);
      document.removeEventListener("webkitfullscreenchange", _onFSChange);
      renderer.dispose(); container.innerHTML = "";
      scene.traverse((c) => { if (c.isMesh) { c.geometry?.dispose(); if (Array.isArray(c.material)) c.material.forEach(m => m.dispose()); else c.material?.dispose(); } });
    },
  };
}

window.__screenshotPreview = () => {
  const r = window.__renderer3d, s = window.__scene3d, c = window.__camera3d;
  if (!r || !s || !c) { console.warn("[screenshot] 无 3D 渲染器"); return null; }
  r.render(s, c); return r.domElement.toDataURL("image/png").split(",")[1];
};

// 延迟加载批量截图
window.__batchRepoScreenshots = async (repoRoot) => {
  const mod = await import("./screenshot-renderer.js");
  return mod.batchRepoScreenshots(repoRoot);
};
