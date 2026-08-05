// ===== Litematic 体素 3D 预览 =====

import { esc } from "../../utils/dom/html.ts";
import { getApp } from "../../wails/app.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** 体素数据（GetLitematicVoxelData 等返回 JSON） */
interface VoxelData {
  groups: Array<{ positions: number[][]; color?: string }>;
  size: number[];
  truncated?: boolean;
  maxBlocks?: number;
}

interface Voxel3DHandle {
  cleanup: () => void;
}

let _voxel3d: Voxel3DHandle | null = null;

/** 清理体素 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupVoxel3D(): void {
  if (_voxel3d) {
    _voxel3d.cleanup();
    _voxel3d = null;
  }
}

export async function createLitematic3D(
  path: string,
  voxelFn: string,
): Promise<void> {
  cleanupVoxel3D(); // 复用：再次创建先清旧的（WebGL 上下文防堆积）

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:var(--z-fullscreen);background:#1a1b2e;display:flex;flex-direction:column";
  document.body.appendChild(overlay);

  const topBar = document.createElement("div");
  topBar.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(0,0,0,0.3);flex-shrink:0;position:relative;z-index:10;color:#fff;font-size:13px;pointer-events:auto";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕ 关闭 3D";
  closeBtn.style.cssText =
    "font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  topBar.appendChild(closeBtn);

  const spacer = document.createElement("div");
  spacer.style.cssText = "flex:1";
  topBar.appendChild(spacer);

  const rotLabel = document.createElement("span");
  rotLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  rotLabel.textContent = "摄像机旋转:";
  topBar.appendChild(rotLabel);

  const rotSel = document.createElement("select");
  rotSel.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit;margin-right:8px";
  [{ v: true, t: "环绕" }, { v: false, t: "自身" }].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.v);
    opt.textContent = m.t;
    rotSel.appendChild(opt);
  });
  topBar.appendChild(rotSel);

  const spdLabel = document.createElement("span");
  spdLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  spdLabel.textContent = "摄像机速度:";
  topBar.appendChild(spdLabel);

  const spdSlider = document.createElement("input");
  spdSlider.type = "range";
  spdSlider.min = "2";
  spdSlider.max = "200";
  spdSlider.value = "20";
  spdSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  topBar.appendChild(spdSlider);

  const spdVal = document.createElement("span");
  spdVal.style.cssText = "font-size:11px;color:rgba(255,255,255,0.6);min-width:20px";
  spdVal.textContent = "20";
  topBar.appendChild(spdVal);

  // 分层渲染分隔
  const sep = document.createElement("span");
  sep.style.cssText = "width:1px;height:16px;background:rgba(255,255,255,0.15);margin:0 4px";
  topBar.appendChild(sep);

  const axisLabel = document.createElement("span");
  axisLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  axisLabel.textContent = "分层轴:";
  topBar.appendChild(axisLabel);

  const axisSel = document.createElement("select");
  axisSel.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  ["Y", "X", "Z"].forEach((a) => {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a;
    axisSel.appendChild(o);
  });
  topBar.appendChild(axisSel);

  const layerMode = document.createElement("select");
  layerMode.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  [{ v: "all", t: "全部" }, { v: "single", t: "单层" }, { v: "range", t: "范围" }].forEach((m) => {
    const o = document.createElement("option");
    o.value = m.v;
    o.textContent = m.t;
    layerMode.appendChild(o);
  });
  topBar.appendChild(layerMode);

  const layerSlider = document.createElement("input");
  layerSlider.type = "range";
  layerSlider.min = "1";
  layerSlider.max = "100";
  layerSlider.value = "100";
  layerSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff);display:none";
  topBar.appendChild(layerSlider);

  const layerInput = document.createElement("input");
  layerInput.type = "number";
  layerInput.min = "1";
  layerInput.max = "100";
  layerInput.value = "100";
  layerInput.style.cssText = "width:42px;font-size:11px;padding:1px 3px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-family:inherit;text-align:center;display:none";
  topBar.appendChild(layerInput);

  const layerSlider2 = document.createElement("input");
  layerSlider2.type = "range";
  layerSlider2.min = "1";
  layerSlider2.max = "100";
  layerSlider2.value = "100";
  layerSlider2.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff);display:none";
  topBar.appendChild(layerSlider2);

  const layerInput2 = document.createElement("input");
  layerInput2.type = "number";
  layerInput2.min = "1";
  layerInput2.max = "100";
  layerInput2.value = "100";
  layerInput2.style.cssText = "width:42px;font-size:11px;padding:1px 3px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-family:inherit;text-align:center;display:none";
  topBar.appendChild(layerInput2);

  overlay.appendChild(topBar);

  const viewContainer = document.createElement("div");
  viewContainer.style.cssText = "flex:1;position:relative";
  overlay.appendChild(viewContainer);

  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:14px;gap:12px;z-index:10;background:rgba(26,27,46,0.9)";
  loadingEl.innerHTML =
    '<div style="font-size:32px">🧊</div><div>加载体素数据...</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';
  viewContainer.appendChild(loadingEl);

  let aborted = false;
  let cleanupFn: (() => void) | null = null;
  function escH(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (cleanupFn) cleanupFn();
      else closeOverlay();
    }
  }
  function closeOverlay(): void {
    aborted = true;
    document.removeEventListener("keydown", escH);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    _voxel3d = null;
  }
  closeBtn.onclick = () => {
    if (cleanupFn) cleanupFn();
    else closeOverlay();
  };
  document.addEventListener("keydown", escH);

  try {
    const App = await getApp();
    if (aborted) return;
    const fn = (App as unknown as Record<string, (p: string) => Promise<string>>)[voxelFn || "GetLitematicVoxelData"];
    const jsonStr = await fn(path);
    if (aborted) return;
    const data = JSON.parse(jsonStr) as VoxelData;

    if (!data || !data.groups || !data.groups.length) {
      loadingEl.innerHTML = '<div style="font-size:32px">⚠️</div><div>体素数据为空</div>';
      return;
    }
    loadingEl.remove();

    if (aborted) return;

    const sizeX = data.size[0] || 10;
    const sizeY = data.size[1] || 10;
    const sizeZ = data.size[2] || 10;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1b2e");

    const camera = new THREE.PerspectiveCamera(
      50,
      viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1),
      0.5,
      2000,
    );
    const centerX = sizeX / 2,
      centerY = sizeY / 2,
      centerZ = sizeZ / 2;
    const maxDim = Math.max(sizeX, sizeY, sizeZ, 10);
    camera.position.set(centerX + maxDim * 1.5, centerY + maxDim, centerZ + maxDim * 1.5);
    camera.lookAt(centerX, centerY, centerZ);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    viewContainer.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(centerX, centerY, centerZ);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 1;
    controls.maxDistance = maxDim * 8;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dl1 = new THREE.DirectionalLight(0xffffff, 0.5);
    dl1.position.set(sizeX, sizeY * 2, sizeZ);
    scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dl2.position.set(-sizeX, sizeY, -sizeZ);
    scene.add(dl2);

    const gridSize = Math.ceil(maxDim / 10) * 10;
    const grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 50), 0x6666aa, 0x444488);
    grid.position.set(centerX, 0, centerZ);
    scene.add(grid);

    const CHUNK = 32;
    const xChunks = Math.ceil(sizeX / CHUNK);
    const yChunks = Math.ceil(sizeY / CHUNK);
    const zChunks = Math.ceil(sizeZ / CHUNK);

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const instancedMeshes: Array<import("three").InstancedMesh> = [];
    const materials: Array<import("three").MeshLambertMaterial> = [];
    for (const group of data.groups) {
      if (!group.positions || !group.positions.length) continue;
      // 按空间分块：同色方块分散到各 chunk，每个 chunk 独立 InstancedMesh
      const chunkMap = new Map<number, number[][]>();
      for (let i = 0; i < group.positions.length; i++) {
        const p = group.positions[i];
        const cx = Math.floor((p[0] || 0) / CHUNK);
        const cy = Math.floor((p[1] || 0) / CHUNK);
        const cz = Math.floor((p[2] || 0) / CHUNK);
        const ck = cx + cy * xChunks + cz * xChunks * yChunks;
        let arr = chunkMap.get(ck);
        if (!arr) {
          arr = [];
          chunkMap.set(ck, arr);
        }
        arr.push(p);
      }
      const mat = new THREE.MeshLambertMaterial({ color: group.color || "#7F7F7F" });
      materials.push(mat);
      const dummy = new THREE.Object3D();
      for (const chunkPositions of chunkMap.values()) {
        const mesh = new THREE.InstancedMesh(boxGeo, mat, chunkPositions.length);
        for (let i = 0; i < chunkPositions.length; i++) {
          const p = chunkPositions[i];
          dummy.position.set(p[0] || 0, p[1] || 0, p[2] || 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
        instancedMeshes.push(mesh);
      }
    }

    // 分层渲染逻辑
    const rawGroups = data.groups;
    let layerAxis = 1; // 默认 Y 轴: positions[p][1] = y
    let layerMax = Math.max(sizeX, sizeY, sizeZ, 1);
    let layerVal = layerMax;
    let layerVal2 = layerMax;

    function setupRange(): void {
      layerMax = [sizeX, sizeY, sizeZ][layerAxis];
      layerSlider.max = String(layerMax);
      layerInput.max = String(layerMax);
      layerSlider2.max = String(layerMax);
      layerInput2.max = String(layerMax);
    }

    function updateLayerUI(): void {
      const m = layerMode.value;
      layerSlider.style.display = m === "all" ? "none" : "";
      layerInput.style.display = m === "all" ? "none" : "";
      layerSlider2.style.display = m === "range" ? "" : "none";
      layerInput2.style.display = m === "range" ? "" : "none";
      applyLayer();
    }

    layerMode.onchange = (): void => {
      updateLayerUI();
    };

    axisSel.onchange = (): void => {
      layerAxis = { X: 0, Y: 1, Z: 2 }[axisSel.value] ?? 1;
      setupRange();
      layerSlider.value = String(layerMax);
      layerInput.value = String(layerMax);
      layerSlider2.value = String(layerMax);
      layerInput2.value = String(layerMax);
      layerVal = layerMax;
      layerVal2 = layerMax;
      applyLayer();
    };

    layerSlider.oninput = (): void => {
      layerInput.value = layerSlider.value;
      layerVal = Number(layerSlider.value);
      applyLayer();
    };
    layerInput.onchange = (): void => {
      const v = Math.max(1, Math.min(layerMax, Number(layerInput.value) || layerMax));
      layerInput.value = String(v);
      layerSlider.value = String(v);
      layerVal = v;
      applyLayer();
    };
    layerSlider2.oninput = (): void => {
      layerInput2.value = layerSlider2.value;
      layerVal2 = Number(layerSlider2.value);
      applyLayer();
    };
    layerInput2.onchange = (): void => {
      const v = Math.max(1, Math.min(layerMax, Number(layerInput2.value) || layerMax));
      layerInput2.value = String(v);
      layerSlider2.value = String(v);
      layerVal2 = v;
      applyLayer();
    };

    function applyLayer(): void {
      const dummy = new THREE.Object3D();
      const m = layerMode.value;
      for (let g = 0; g < rawGroups.length; g++) {
        const mesh = instancedMeshes[g];
        const positions = rawGroups[g].positions;
        let count = 0;
        if (m === "all") {
          while (count < positions.length) {
            const p = positions[count];
            dummy.position.set(p[0], p[1], p[2]);
            dummy.updateMatrix();
            mesh.setMatrixAt(count, dummy.matrix);
            count++;
          }
        } else if (m === "single") {
          const target = layerVal - 1;
          for (let i = 0; i < positions.length; i++) {
            if (positions[i][layerAxis] === target) {
              const p = positions[i];
              dummy.position.set(p[0], p[1], p[2]);
              dummy.updateMatrix();
              mesh.setMatrixAt(count, dummy.matrix);
              count++;
            }
          }
        } else {
          const lo = layerVal - 1;
          const hi = layerVal2;
          for (let i = 0; i < positions.length; i++) {
            if (positions[i][layerAxis] >= lo && positions[i][layerAxis] < hi) {
              const p = positions[i];
              dummy.position.set(p[0], p[1], p[2]);
              dummy.updateMatrix();
              mesh.setMatrixAt(count, dummy.matrix);
              count++;
            }
          }
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    setupRange();
    layerSlider.value = String(layerMax);
    layerInput.value = String(layerMax);
    layerSlider2.value = String(layerMax);
    layerInput2.value = String(layerMax);

    if (data.truncated) {
      const w = document.createElement("div");
      w.style.cssText = "padding:6px 12px;background:rgba(207,83,0,0.3);color:#ffa64d;font-size:12px;text-align:center;flex-shrink:0";
      const max = data.maxBlocks || 200000;
      w.textContent = "⚠️ 方块数量超过上限（" + max.toLocaleString() + "），仅显示部分内容";
      overlay.insertBefore(w, overlay.children[1]);
    }

    const tip = document.createElement("div");
    tip.style.cssText = "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
    tip.textContent = "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
    overlay.insertBefore(tip, overlay.children[1]);
    setTimeout(() => {
      if (tip.parentNode) tip.remove();
    }, 6000);

    const isDisposed = { v: false };
    const keys: Record<string, boolean> = {};
    let camSpeed = 20;
    let orbitMode = true;
    const orbitTarget = controls.target.clone();
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    let mouseDown = false,
      lastMouse = { x: 0, y: 0 };

    function onKeyDown(e: KeyboardEvent): void {
      keys[e.key.toLowerCase()] = true;
      if (
        ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(
          e.key.toLowerCase(),
        )
      ) {
        e.preventDefault();
      }
    }
    function onKeyUp(e: KeyboardEvent): void {
      keys[e.key.toLowerCase()] = false;
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    function onMouseDown(e: MouseEvent): void {
      if (!orbitMode && e.button === 0) {
        mouseDown = true;
        lastMouse.x = e.clientX;
        lastMouse.y = e.clientY;
      }
    }
    function onMouseUp(): void {
      mouseDown = false;
    }
    function onMouseMove(e: MouseEvent): void {
      if (orbitMode || !mouseDown) return;
      const dx = e.clientX - lastMouse.x,
        dy = e.clientY - lastMouse.y;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= dx * 0.003;
      euler.x -= dy * 0.003;
      euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
      camera.quaternion.setFromEuler(euler);
    }
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);

    controls.enableRotate = true;

    rotSel.onchange = (): void => {
      orbitMode = rotSel.value === "true";
      controls.enableRotate = orbitMode;
      if (orbitMode) {
        controls.target.copy(orbitTarget);
      } else {
        euler.setFromQuaternion(camera.quaternion);
      }
      mouseDown = false;
    };
    spdSlider.oninput = (): void => {
      camSpeed = Number(spdSlider.value);
      spdVal.textContent = spdSlider.value;
    };

    function onResize(): void {
      if (isDisposed.v) return;
      camera.aspect = viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    }
    window.addEventListener("resize", onResize);

    let lastTime = performance.now();
    let animId = 0;
    function animate(): void {
      if (isDisposed.v) return;
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const forward = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
      const right = new THREE.Vector3()
        .crossVectors(forward, new THREE.Vector3(0, 1, 0))
        .normalize();
      const move = new THREE.Vector3();

      if (keys["w"] || keys["arrowup"]) move.add(forward);
      if (keys["s"] || keys["arrowdown"]) move.sub(forward);
      if (keys["a"] || keys["arrowleft"]) move.sub(right);
      if (keys["d"] || keys["arrowright"]) move.add(right);
      if (keys[" "]) move.y += 1;
      if (keys["shift"]) move.y -= 1;

      if (move.length() > 0) {
        move.normalize().multiplyScalar(camSpeed * dt);
        camera.position.add(move);
        if (orbitMode) {
          orbitTarget.add(move);
        }
      }

      if (orbitMode) {
        controls.target.copy(orbitTarget);
        controls.update();
        orbitTarget.copy(controls.target);
      } else {
        controls.target.copy(camera.position).addScaledVector(camDir, 10);
        controls.update();
      }

      renderer.render(scene, camera);
    }
    animate();

    function fullCleanup(): void {
      if (isDisposed.v) return;
      isDisposed.v = true;
      cancelAnimationFrame(animId);
      renderer.dispose();
      controls.dispose();
      instancedMeshes.forEach((m) => {
        try {
          m.dispose();
        } catch (_) {}
      });
      materials.forEach((m) => {
        try {
          m.dispose();
        } catch (_) {}
      });
      boxGeo.dispose();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      // escHandler 在 try 块内注册，此处安全移除（无论是否已注册）
      document.removeEventListener("keydown", escHandler);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      _voxel3d = null;
    }

    function escHandler(e: KeyboardEvent): void {
      if (e.key === "Escape") fullCleanup();
    }
    document.removeEventListener("keydown", escH);
    document.addEventListener("keydown", escHandler);
    closeBtn.onclick = fullCleanup;
    cleanupFn = fullCleanup;
    _voxel3d = { cleanup: fullCleanup };
  } catch (e) {
    console.error("[litematic 3D] 加载失败:", e);
    loadingEl.innerHTML = `<div style="font-size:32px">⚠️</div><div>加载失败: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
    bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "体素 3D 加载失败"), duration: 5000, type: "error" });
  }
}
