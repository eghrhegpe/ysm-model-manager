// ===== 3D 模型渲染器（类型化版 — ADR-014 P2 大件收尾）=====
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ── Spec 结构（Go 返回的 models 结构）────────────────

export interface SpecBone3D {
  id: string;
  name: string;
  parentId?: string;
  localPosition: number[];
  localRotation: number[];
}

export interface SpecMeshGroup3D {
  id?: string;
  boneId: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texIdx?: number;
  localPosition?: number[];
  localRotation?: number[];
}

export interface SpecModelGroup3D {
  id?: string;
  name?: string;
  defaultVisible?: boolean;
  bones?: SpecBone3D[];
  meshGroups?: SpecMeshGroup3D[];
}

export interface Spec3D {
  models?: SpecModelGroup3D[];
}

/** 骨骼选中信息（window._3dOnBoneSelect 回调参数） */
export interface BoneSelectInfo {
  name: string;
  path: string;
  parent: string | null;
  children: string[];
  meshCount: number;
  localPos: number[];
  worldPos: number[];
  localRot: number[] | null;
  cubeRot: number[] | null;
  cubePos: number[] | null;
}

/** renderModel3D 返回的渲染句柄 */
export interface RenderModel3DHandle {
  resetCamera: () => void;
  setSpeed: (v: number) => void;
  setRotationMode: (orbit: boolean) => void;
  setBoneVisible: (name: string, visible: boolean) => void;
  getBoneList: () => Array<{ id: string; name: string; parentId?: string }>;
  toggleBone: (name: string) => void;
  showModelGroup: (idx: number) => void;
  getModelGroupCount: () => number;
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  setDebugMode: (mode: "normal" | "pivot" | "bone") => void;
  cleanup: () => void;
}

// ── 3D 操作键位 / 偏好（持久化于 localStorage，与界面设置同源）──
export type TdKeyAction = "forward" | "back" | "left" | "right" | "up" | "down";

/** 默认键位以 KeyboardEvent.code 存储（物理键，跨键盘布局一致） */
export const DEFAULT_TD_KEYMAP: Record<TdKeyAction, string> = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  up: "Space",
  down: "ShiftLeft",
};

const TD_KEYMAP_KEY = "td-keymap";
const TD_CAMSPEED_KEY = "td-cam-speed";
const TD_ROTMODE_KEY = "td-rot-mode";

/** 读取用户自定义键位（无/非法时回退默认） */
export function loadTdKeymap(): Record<TdKeyAction, string> {
  try {
    const raw = localStorage.getItem(TD_KEYMAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<TdKeyAction, string>>;
      const merged: Record<TdKeyAction, string> = { ...DEFAULT_TD_KEYMAP };
      (Object.keys(DEFAULT_TD_KEYMAP) as TdKeyAction[]).forEach((k) => {
        if (typeof parsed[k] === "string" && parsed[k]!.length > 0) merged[k] = parsed[k]!;
      });
      return merged;
    }
  } catch {
    /* 解析失败回退默认 */
  }
  return { ...DEFAULT_TD_KEYMAP };
}

/** 相机移动速度（2–200），默认 20 */
export function loadTdCamSpeed(): number {
  const v = Number(localStorage.getItem(TD_CAMSPEED_KEY));
  return Number.isFinite(v) && v >= 2 && v <= 200 ? v : 20;
}

/** true = 环绕（orbit），false = 自身（free） */
export function loadTdRotMode(): boolean {
  return localStorage.getItem(TD_ROTMODE_KEY) !== "free";
}

// 模块级 3D 渲染状态（治理红线 R1：零全局调试变量）
let _scene3d: THREE.Scene | null = null;
let _camera3d: THREE.PerspectiveCamera | null = null;
let _renderer3d: THREE.WebGLRenderer | null = null;
let _rootGroup3d: THREE.Group | null = null;
/** 当前活跃的 RAF ID（入口复用守卫 + cleanup 共享） */
let _rafIdGuard: number | null = null;

/** 组件作用域骨骼 key（YSMViewer 式多组件：同名骨骼跨组件不冲突）。
 * 导出供截图渲染器（screenshot-renderer）与 buildSceneMesh 消费方共用，防 key 口径漂移。 */
export function compKey(mi: number, id: string) {
  return mi + ":" + id;
}

/** 构建骨骼层级场景（bone group 树），返回组映射与根节点 */
export function buildSceneMesh(spec: Spec3D): {
  boneGroupMap: Map<string, THREE.Group>;
  rootGroup: THREE.Group;
  modelScale: number;
  modelGroups: THREE.Group[];
} {
  // 显示尺寸：固定 1/16（基岩标准：16 像素 = 1 米），严格对齐 YSMViewer ExportScale。
  // 历史：曾动态 scale（>32→1/16、>4→1/4、else→1）把小模型放大，渲染对齐裁决后移除。
  const modelScale = 1 / 16;
  const rootGroup = new THREE.Group();
  rootGroup.scale.set(modelScale, modelScale, modelScale);
  // 组件级 modelGroup（YSMViewer 式多组件同屏）：每个 spec.model 一个组，
  // bone 树挂各自 modelGroup，可见性由 defaultVisible 控制（arm 等组件独立渲染）。
  const modelGroups = (spec.models || []).map((mg) => {
    const g = new THREE.Group();
    g.name = mg.id || "comp";
    g.visible = mg.defaultVisible !== false;
    return g;
  });
  for (const g of modelGroups) rootGroup.add(g);
  const boneGroupMap = new Map<string, THREE.Group>();
  for (const [mi, mg] of (spec.models || []).entries())
    for (const bd of mg.bones || []) {
      const g = new THREE.Group();
      g.name = bd.name;
      const pos = bd.localPosition || [0, 0, 0];
      g.position.set(
        pos[0] ?? 0,
        pos[1] ?? 0,
        pos[2] ?? 0,
      );
      const rot = bd.localRotation;
      if (
        rot?.[3] !== 1 ||
        rot?.[0] !== 0 ||
        rot?.[1] !== 0 ||
        rot?.[2] !== 0
      )
        g.quaternion.set(
          rot?.[0] ?? 0,
          rot?.[1] ?? 0,
          rot?.[2] ?? 0,
          rot?.[3] ?? 1,
        );
      boneGroupMap.set(compKey(mi, bd.id), g);
      // 全局 key：main 组件优先（先到先得），供 hover/UI/动画（v1 单组件语义）
      if (!boneGroupMap.has(bd.id)) boneGroupMap.set(bd.id, g);
    }
  for (const [mi, mg] of (spec.models || []).entries())
    for (const bd of mg.bones || []) {
      const g = boneGroupMap.get(compKey(mi, bd.id));
      if (!g) continue;
      if (bd.parentId && boneGroupMap.has(compKey(mi, bd.parentId)))
        boneGroupMap.get(compKey(mi, bd.parentId))!.add(g);
      else modelGroups[mi].add(g);
    }
  return { boneGroupMap, rootGroup, modelScale, modelGroups };
}

/** 渲染 3D 模型到容器，返回控制句柄 */
export async function renderModel3D(
  container: HTMLElement,
  texArr: THREE.Texture[],
  spec: Spec3D,
  texIdx = 0,
): Promise<RenderModel3DHandle> {
  // P1 修复：入口复用守卫——若上一场景未 cleanup，先主动清理旧 RAF/renderer，避免僵尸循环
  if (_renderer3d) {
    if (_rafIdGuard != null) cancelAnimationFrame(_rafIdGuard);
    try {
      _renderer3d.dispose();
    } catch { /* renderer 已被 dispose 则忽略 */ }
    if (_renderer3d.domElement.parentNode) {
      _renderer3d.domElement.parentNode.removeChild(_renderer3d.domElement);
    }
    _renderer3d = null;
    _scene3d = null;
    _camera3d = null;
    _rootGroup3d = null;
  }

  const scene = new THREE.Scene();
  _scene3d = scene;
  scene.background = new THREE.Color(0x1a1b2e);
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  _camera3d = camera;
  // 默认相机在 Z 正侧（对齐 YSMViewer 默认方位，其相机为 (0,0,+CAMERA_DISTANCE)）
  // 历史：曾用 (0, 80, -120)（Z 负侧），渲染对齐（ADR-041）后与 YSMViewer 视角相反，改回 +Z
  camera.position.set(0, 80, 120);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  _renderer3d = renderer;
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
  dl.position.set(10, 30, 20);
  scene.add(dl);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
  backLight.position.set(-10, 10, -20);
  scene.add(backLight);
  const grid = new THREE.GridHelper(400, 20, 0x8888cc, 0x6666aa);
  grid.position.y = -1;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(60));

  const { boneGroupMap, rootGroup, modelGroups } = buildSceneMesh(spec);
  _rootGroup3d = rootGroup;
  scene.add(rootGroup);

  for (const [mi, mg] of (spec.models || []).entries()) {
    if (!mg.meshGroups?.length) continue;
    const grouped = new Map<string, SpecMeshGroup3D[]>();
    for (const md of mg.meshGroups) {
      const key = md.boneId + ":" + (md.texIdx ?? 0);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(md);
    }
    const merged: SpecMeshGroup3D[] = [];
    for (const [, g] of grouped) {
      if (g.length === 1) {
        merged.push(g[0]);
        continue;
      }
      let positions: number[] = [];
      let normals: number[] = [];
      let uvs: number[] = [];
      let idx: number[] = [];
      let idxOff = 0;
      const standalone: SpecMeshGroup3D[] = [];
      for (const md of g) {
        const isId =
          md.localRotation?.[3] === 1 &&
          md.localRotation?.[0] === 0 &&
          md.localRotation?.[1] === 0 &&
          md.localRotation?.[2] === 0;
        if (!isId) {
          standalone.push(md);
          continue;
        }
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
        for (let i = 0; i < (md.indices?.length || 0); i++)
          idx.push((md.indices[i] || 0) + idxOff);
        idxOff += (md.positions?.length || 0) / 3;
      }
      if (positions.length)
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
      merged.push(...standalone);
    }
    mg.meshGroups = merged;
    for (const md of mg.meshGroups) {
      const bg = boneGroupMap.get(compKey(mi, md.boneId));
      if (!bg) continue;
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
      // 多组件：md.texIdx 是 Go 端全局组件槽位（组件序 0,1,2...），必须用；
      // 单组件：Go 端恒输出 texIdx 字段（无 omitempty，单组件=0），若用 ?? 则
      // 纹理选择器（调用方 texIdx 参数）被架空——永远贴第 0 张（P2）。
      const mti = (spec.models?.length ?? 1) > 1 ? (md.texIdx ?? 0) : (texIdx ?? 0);
      const mt = texArr.length > 0 ? texArr[mti] || texArr[0] : null;
      // ysmview 风格材质：统一 FrontSide + transparent + alphaTest 0.1 + depthWrite。
      // alphaTest 把 <0.1 alpha 像素直接裁剪（硬透明，边缘干净）；
      // depthWrite: true 让不透明像素写深度，避免透明面穿透后方网格（YSMViewer 同款）。
      // 历史：曾仅 transparent: true（alpha 混合 + 不写深度）→ 材质边缘虚化/内部穿帮。
      const mat = mt
        ? new THREE.MeshBasicMaterial({
            map: mt,
            side: THREE.FrontSide,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: true,
          })
        : new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.FrontSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        md.localPosition?.[0] ?? 0,
        md.localPosition?.[1] ?? 0,
        md.localPosition?.[2] ?? 0,
      );
      if (
        md.localRotation?.[3] !== 1 ||
        md.localRotation?.[0] !== 0 ||
        md.localRotation?.[1] !== 0 ||
        md.localRotation?.[2] !== 0
      )
        mesh.quaternion.set(
          md.localRotation?.[0] ?? 0,
          md.localRotation?.[1] ?? 0,
          md.localRotation?.[2] ?? 0,
          md.localRotation?.[3] ?? 1,
        );
      bg.add(mesh);
    }
  }

  // ysmview 风格相机定位：从 mesh 包围盒计算
  scene.updateMatrixWorld();
  const box = new THREE.Box3();
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) box.expandByObject(child);
  });
  let centerY = 0;
  if (!box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    centerY = center.y;
    const size = new THREE.Vector3();
    box.getSize(size);
    const dist = Math.max(size.x, size.y, size.z) * 1.5 + 2;
    camera.position.set(center.x, center.y, center.z + dist);
    camera.lookAt(center);
    controls.target.copy(center);
  } else {
    camera.position.set(0, 80, 120);
    controls.target.set(0, 80, 0);
  }
  controls.update();
  const _initCamPos = camera.position.clone();
  const _initCamTarget = controls.target.clone();

  let _rafId: number | null = null;
  const _onResize = (): void => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  };
  window.addEventListener("resize", _onResize);
  const _onFSChange = (): void => {
    setTimeout(_onResize, 50);
  };
  document.addEventListener("fullscreenchange", _onFSChange);
  document.addEventListener("webkitfullscreenchange", _onFSChange);
  const _keys: Record<string, boolean> = {};
  let _debugMode: "normal" | "pivot" | "bone" = "normal";
  // 用户自定义键位（物理键 code，跨键盘布局一致）；方向键保留为通用兜底
  const _keymap = loadTdKeymap();
  const _isShift = (code: string): boolean => code === "ShiftLeft" || code === "ShiftRight";
  const _movementCodes = new Set<string>([
    _keymap.forward, _keymap.back, _keymap.left, _keymap.right, _keymap.up, _keymap.down,
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ]);
  const _isEditable = (el: EventTarget | null): boolean => {
    const node = el as HTMLElement | null;
    return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
  };
  const _onKeyDown = (e: KeyboardEvent): void => {
    if (_isEditable(e.target)) return; // 弹窗输入框打字时不吞键
    _keys[e.code] = true;
    // 吞掉移动键默认行为（空格滚动/方向键滚动）；Shift 作为修饰键不阻止默认
    if (_movementCodes.has(e.code) && !_isShift(e.code)) e.preventDefault();
    if (e.key.toLowerCase() === "f") {
      const modes: Array<"normal" | "pivot" | "bone"> = ["normal", "pivot", "bone"];
      const next = (modes.indexOf(_debugMode) + 1) % modes.length;
      _debugMode = modes[next];
      rebuildDebug();
    }
  };
  const _onKeyUp = (e: KeyboardEvent): void => {
    _keys[e.code] = false;
  };
  document.addEventListener("keydown", _onKeyDown);
  document.addEventListener("keyup", _onKeyUp);
  let _lastTime = performance.now();
  let _camSpeed = loadTdCamSpeed();
  let _orbitMode = loadTdRotMode();
  const _orbitTarget = controls.target.clone();
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  let _mouseDown = false;
  let _lastMouse = { x: 0, y: 0 };
  const onMouseDown = (e: MouseEvent): void => {
    if (!_orbitMode && e.button === 0) {
      _mouseDown = true;
      _lastMouse = { x: e.clientX, y: e.clientY };
    }
  };
  const onMouseUp = (): void => {
    _mouseDown = false;
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (_orbitMode || !_mouseDown) return;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= (e.clientX - _lastMouse.x) * 0.003;
    _euler.x -= (e.clientY - _lastMouse.y) * 0.003;
    _euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, _euler.x));
    camera.quaternion.setFromEuler(_euler);
    _lastMouse = { x: e.clientX, y: e.clientY };
  };
  renderer.domElement.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  controls.enableRotate = true;
  const loop = (): void => {
    _rafId = requestAnimationFrame(loop);
    _rafIdGuard = _rafId;
    const dt = Math.min((performance.now() - _lastTime) / 1000, 0.1);
    _lastTime = performance.now();
    const cd = new THREE.Vector3();
    camera.getWorldDirection(cd);
    const fwd = new THREE.Vector3(cd.x, 0, cd.z).normalize();
    const right = new THREE.Vector3()
      .crossVectors(fwd, new THREE.Vector3(0, 1, 0))
      .normalize();
    const mv = new THREE.Vector3();
    if (_keys[_keymap.forward] || _keys["ArrowUp"]) mv.add(fwd);
    if (_keys[_keymap.back] || _keys["ArrowDown"]) mv.sub(fwd);
    if (_keys[_keymap.left] || _keys["ArrowLeft"]) mv.sub(right);
    if (_keys[_keymap.right] || _keys["ArrowRight"]) mv.add(right);
    if (_keys[_keymap.up]) mv.y += 1;
    if (_keys[_keymap.down]) mv.y -= 1;
    if (mv.length() > 0) {
      mv.normalize().multiplyScalar(_camSpeed * dt);
      camera.position.add(mv);
      if (_orbitMode) _orbitTarget.add(mv);
    }
    if (_orbitMode) {
      controls.target.copy(_orbitTarget);
      controls.update();
      _orbitTarget.copy(controls.target);
    } else {
      controls.target.copy(camera.position).addScaledVector(cd, 10);
      controls.update();
    }
    renderer.render(scene, camera);
  };
  _rafId = requestAnimationFrame(loop);
  renderer.render(scene, camera);

  // ===== 鼠标悬停骨骼名 + 点击复制层级 =====
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let _hoveredBone: string | null = null;
  let _hoveredMesh: THREE.Object3D | null = null;

  // 构建骨骼层级路径映射
  const _boneParentMap = new Map<string, string | null>();
  const _boneNameMap = new Map<string, string>();
  const _boneChildrenMap = new Map<string, string[]>();
  for (const mg of spec.models || []) {
    for (const bd of mg.bones || []) {
      _boneNameMap.set(bd.id, bd.name);
      _boneParentMap.set(bd.id, bd.parentId || null);
      if (!_boneChildrenMap.has(bd.parentId || "__root__")) {
        _boneChildrenMap.set(bd.parentId || "__root__", []);
      }
      _boneChildrenMap.get(bd.parentId || "__root__")!.push(bd.id);
    }
  }

  // 工具：骨骼名 → 全路径
  const getBonePath = (boneId: string): string => {
    const parts: string[] = [];
    let current: string | null | undefined = boneId;
    while (current && _boneNameMap.has(current)) {
      parts.unshift(_boneNameMap.get(current)!);
      current = _boneParentMap.get(current);
    }
    return parts.join(" / ");
  };

  // 工具：骨骼名 → 第一个子骨骼名（用于区分同层骨骼）
  const getMeshBoneId = (mesh: THREE.Object3D): string | null => {
    // mesh 属于一个 boneGroup，boneGroup 的 parent 链指向根
    let obj: THREE.Object3D | null = mesh;
    while (obj) {
      if ((obj as THREE.Group).isGroup && obj.name && _boneNameMap.has(obj.name)) {
        return obj.name;
      }
      obj = obj.parent;
    }
    return null;
  };

  const onPointerMove = (e: PointerEvent): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    let foundBone: string | null = null;
    let foundMesh: THREE.Object3D | null = null;
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

  const onPointerClick = (e: MouseEvent): void => {
    if (!_hoveredBone) return;
    const boneId = _hoveredBone; // 局部收窄（闭包捕获变量 TS 不做控制流收窄）
    if (handle.onBoneSelect) {
      const bg = boneGroupMap.get(boneId);
      const wp = new THREE.Vector3();
      if (bg) bg.getWorldPosition(wp);
      const lp = bg ? bg.position : new THREE.Vector3();
      const lq = bg ? bg.quaternion : new THREE.Quaternion();
      let lr: number[] | null = null;
      if (lq.x !== 0 || lq.y !== 0 || lq.z !== 0 || lq.w !== 1)
        lr = [lq.x, lq.y, lq.z, lq.w];
      // Cube（mesh）级数据
      let cq: number[] | null = null;
      let cp: number[] | null = null;
      if (_hoveredMesh && (_hoveredMesh as THREE.Mesh).isMesh) {
        cq = [
          _hoveredMesh.quaternion.x,
          _hoveredMesh.quaternion.y,
          _hoveredMesh.quaternion.z,
          _hoveredMesh.quaternion.w,
        ];
        cp = [
          _hoveredMesh.position.x,
          _hoveredMesh.position.y,
          _hoveredMesh.position.z,
        ];
      }
      handle.onBoneSelect({
        name: _boneNameMap.get(boneId) || boneId,
        path: getBonePath(boneId),
        parent: _boneParentMap.get(boneId) ?? null,
        children: _boneChildrenMap.get(boneId) || [],
        meshCount: (function () {
          const bg2 = boneGroupMap.get(boneId);
          let mc = 0;
          if (bg2)
            bg2.traverse(function (c) {
              if ((c as THREE.Mesh).isMesh) mc++;
            });
          return mc;
        })(),
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
  let _debugGroup: THREE.Group | null = null;

  const rebuildDebug = (): void => {
    if (_debugGroup) {
      // 释放旧 debug 组内的几何体/材质/纹理，防止内存泄漏
      _debugGroup.traverse((c) => {
        const obj = c as THREE.Mesh | THREE.Line | THREE.Sprite;
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).geometry?.dispose();
          const m = (obj as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose();
        } else if ((obj as THREE.Line).isLine) {
          (obj as THREE.Line).geometry?.dispose();
          const lm = (obj as THREE.Line).material;
          if (Array.isArray(lm)) lm.forEach((x) => x.dispose());
          else lm?.dispose();
        } else if ((obj as THREE.Sprite).isSprite) {
          (obj as THREE.Sprite).material.map?.dispose();
          (obj as THREE.Sprite).material?.dispose();
        }
      });
      scene.remove(_debugGroup);
      _debugGroup = null;
    }
    if (_debugMode === "normal") return;
    _debugGroup = new THREE.Group();
    scene.add(_debugGroup);

    // 获取骨骼世界坐标
    rootGroup.updateMatrixWorld(true);
    const boneWorldPositions = new Map<
      string,
      { pos: THREE.Vector3; name: string; parentId?: string }
    >();
    // v1：boneWorldPositions 只收集 main 组件（spec.models[0]，全局 key 即 main），
    // 动画驱动 main 骨骼；arm 等组件独立树静止（跨组件骨骼绑定留 v2）
    for (const bd of spec.models?.[0]?.bones || []) {
      const bg = boneGroupMap.get(bd.id);
      if (!bg) continue;
      const wp = new THREE.Vector3();
      bg.getWorldPosition(wp);
      boneWorldPositions.set(bd.id, {
        pos: wp,
        name: bd.name,
        parentId: bd.parentId,
      });
    }

    if (_debugMode === "pivot") {
      for (const [, data] of boneWorldPositions) {
        const top = data.pos.clone();
        top.y += 4;
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          data.pos,
          top,
        ]);
        const line = new THREE.Line(
          lineGeo,
          new THREE.LineBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.25,
          }),
        );
        _debugGroup.add(line);
        // 骨骼名标签（固定像素大小，不影响缩放）
        const tex = makeTextTexture(data.name, "#88ffaa");
        const mat = new THREE.SpriteMaterial({
          map: tex,
          depthTest: false,
          sizeAttenuation: false,
          transparent: true,
        });
        const label = new THREE.Sprite(mat);
        label.position.copy(top);
        label.scale.set(120, 24, 1);
        _debugGroup.add(label);
      }
    } else if (_debugMode === "bone") {
      for (const [, data] of boneWorldPositions) {
        const parentPos = data.parentId
          ? boneWorldPositions.get(data.parentId)?.pos
          : null;
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
  function makeTextTexture(text: string, color?: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    // 显式设为透明黑色背景
    if (ctx) {
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = color || "#ffffff";
      ctx.font = "24px sans-serif";
      ctx.textBaseline = "bottom";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 3;
      ctx.fillText(text, 4, 58);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.premultiplyAlpha = true;
    return tex;
  }

  const handle: RenderModel3DHandle = {
    resetCamera: () => {
      camera.position.copy(_initCamPos);
      controls.target.copy(_initCamTarget);
      _orbitTarget.copy(_initCamTarget);
      if (_orbitMode) controls.enableRotate = true;
      else {
        controls.enableRotate = false;
        const d = new THREE.Vector3();
        camera.getWorldDirection(d);
        controls.target.copy(camera.position).addScaledVector(d, 10);
      }
      camera.quaternion.set(0, 0, 0, 1);
      _euler.set(0, 0, 0);
      _camSpeed = 20;
      _mouseDown = false;
      Object.keys(_keys).forEach((k) => (_keys[k] = false));
      controls.update();
    },
    setSpeed: (v: number) => {
      _camSpeed = v;
    },
    setRotationMode: (orbit: boolean) => {
      _orbitMode = orbit;
      if (orbit) {
        controls.enableRotate = true;
        if (_orbitTarget) controls.target.copy(_orbitTarget);
        _mouseDown = false;
      } else {
        _euler.setFromQuaternion(camera.quaternion);
        controls.enableRotate = false;
        const d = new THREE.Vector3();
        camera.getWorldDirection(d);
        controls.target.copy(camera.position).addScaledVector(d, 10);
        controls.update();
        _mouseDown = false;
      }
    },
    setBoneVisible: (name: string, visible: boolean) => {
      const g = boneGroupMap.get(name);
      if (g) g.traverse((c) => (c.visible = visible));
    },
    getBoneList: () =>
      spec.models?.[0]?.bones?.map((b) => ({
        id: b.id,
        name: b.name,
        parentId: b.parentId,
      })) || [],
    toggleBone: (name: string) => {
      const g = boneGroupMap.get(name);
      if (g) g.traverse((c) => (c.visible = !c.visible));
    },
    showModelGroup: (idx: number) => {
      // 组件级控制（YSMViewer modelGroup.visible 式）：整组件显隐，不受同名骨骼冲突影响。
      // idx < 0（如 -1）= 全部显示（默认态，对应 UI「全部组件」选项）。
      modelGroups.forEach((g, i) => (g.visible = i === idx || idx < 0));
    },
    getModelGroupCount: () => spec.models?.length || 0,
    onBoneSelect: null, // 外部设置的回调: (boneInfo) => void
    setDebugMode: (mode: "normal" | "pivot" | "bone") => {
      _debugMode = mode;
      rebuildDebug();
    },
    cleanup: () => {
      if (_rafId != null) cancelAnimationFrame(_rafId);
      _rafIdGuard = null;
      document.removeEventListener("keydown", _onKeyDown);
      document.removeEventListener("keyup", _onKeyUp);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onPointerClick);
      controls.dispose();
      window.removeEventListener("resize", _onResize);
      document.removeEventListener("fullscreenchange", _onFSChange);
      document.removeEventListener("webkitfullscreenchange", _onFSChange);
      // 先移除 debug 组，再逐层 dispose 所有场景资源（含纹理），最后 dispose renderer
      if (_debugGroup) {
        _debugGroup.traverse((c) => {
          const obj = c as THREE.Mesh | THREE.Line | THREE.Sprite;
          if ((obj as THREE.Mesh).isMesh) {
            (obj as THREE.Mesh).geometry?.dispose();
            const m = (obj as THREE.Mesh).material;
            if (Array.isArray(m)) m.forEach((x) => disposeMaterial(x));
            else disposeMaterial(m);
          } else if ((obj as THREE.Line).isLine) {
            (obj as THREE.Line).geometry?.dispose();
            const lm = (obj as THREE.Line).material;
            if (Array.isArray(lm)) lm.forEach((x) => x.dispose());
            else lm?.dispose();
          } else if ((obj as THREE.Sprite).isSprite) {
            disposeMaterial((obj as THREE.Sprite).material);
          }
        });
        scene.remove(_debugGroup);
        _debugGroup = null;
      }
      scene.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material))
            mesh.material.forEach((m) => disposeMaterial(m));
          else disposeMaterial(mesh.material);
        }
      });
      renderer.dispose();
      _renderer3d = null;
      _scene3d = null;
      _camera3d = null;
      _rootGroup3d = null;
      container.innerHTML = "";
    },
  };
  return handle;
}

/** 截取当前 3D 预览画面（PNG base64，无 data: 前缀），无渲染器时返回 null */
export function screenshotPreview(): string | null {
  if (!_renderer3d || !_scene3d || !_camera3d) {
    console.warn("[screenshot] 无 3D 渲染器");
    return null;
  }
  _renderer3d.render(_scene3d, _camera3d);
  return _renderer3d.domElement.toDataURL("image/png").split(",")[1];
}

/** 带 map 纹理的材质接口（MeshStandardMaterial/MeshPhongMaterial 等共有） */
interface MaterialWithMap {
  map: { dispose(): void } | null;
  dispose(): void;
}

/**
 * 释放材质及其 map 纹理。
 * Material 基类无 map 属性，需运行时探测（类型层面用 MaterialWithMap 收窄）。
 */
function disposeMaterial(m: THREE.Material | null | undefined): void {
  if (!m) return;
  const withMap = m as THREE.Material & Partial<MaterialWithMap>;
  if (withMap.map) withMap.map.dispose();
  m.dispose();
}
