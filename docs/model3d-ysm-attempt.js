/**
 * 3D 模型预览 — 基于 Three.js
 * 当前尝试：YSMViewer 几何体 + expandBoxUV + Origin X 取反
 * 保存日期: 2026-06-09
 * 状态: 纹理黑色未修复
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export async function renderModel3D(container, model, textureUrl, texIdx = 0) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b2e);
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 80, -120);
  camera.lookAt(0, 80, 0);
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
  const PXL = 1;
  const boneGroupMap = new Map();
  const rootGroup = new THREE.Group();
  rootGroup.name = "__root__";
  scene.add(rootGroup);
  for (const bone of model.bones) {
    const g = new THREE.Group();
    g.name = bone.name;
    boneGroupMap.set(bone.name, g);
    rootGroup.add(g);
  }
  let minY = Infinity,
    maxY = -Infinity;
  for (const bone of model.bones)
    for (const c of bone.cubes || []) {
      const y = c.origin[1] + c.size[1] / 2;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  const centerY = ((minY + maxY) / 2) * PXL;
  const modelHeight = (maxY - minY) * PXL;
  const camDist = Math.max(modelHeight * 1.5, 60);
  camera.position.set(camDist * 0.4, centerY, -camDist * 0.8);
  camera.lookAt(0, centerY, 0);
  controls.target.set(0, centerY, 0);
  controls.update();
  for (const bone of model.bones) {
    const group = boneGroupMap.get(bone.name);
    if (!group) continue;
    for (const c of bone.cubes || []) {
      let cubeTex = null;
      if (texMap.size > 0) {
        const texArr = [...texMap.values()];
        cubeTex = texArr[texIdx ?? 0] || texArr[0];
      }
      const mat = cubeTex
        ? new THREE.MeshBasicMaterial({
            map: cubeTex,
            transparent: false,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshBasicMaterial({
            color: 0x44aa88,
            side: THREE.DoubleSide,
          });
      const geo = buildCubeGeometry(
        c,
        bone,
        cubeTex,
        model.texWidth || 64,
        model.texHeight || 64,
      );
      const mesh = new THREE.Mesh(geo, mat);
      const cp = c.pivot || [0, 0, 0];
      mesh.position.set(cp[0], cp[1], cp[2]);
      if (c.rotation) {
        const rx = (c.rotation[0] * Math.PI) / 180;
        const ry = (c.rotation[1] * Math.PI) / 180;
        const rz = (c.rotation[2] * Math.PI) / 180;
        const q = new THREE.Quaternion()
          .multiplyQuaternions(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(1, 0, 0),
              rx,
            ),
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              ry,
            ),
          )
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              rz,
            ),
          );
        mesh.quaternion.copy(q);
      }
      group.add(mesh);
    }
    if (bone.cubes?.length > 0) makeBoneLabel(group, bone.name);
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

function buildCubeGeometry(cube, bone, tex, modelTexW, modelTexH) {
  const ox = -(cube.origin[0] || 0);
  const oy = cube.origin[1] || 0;
  const oz = cube.origin[2] || 0;
  const sx = cube.size[0] || 0;
  const sy = cube.size[1] || 0;
  const sz = cube.size[2] || 0;
  const cp = cube.pivot || [0, 0, 0];
  const fx = ox - sx,
    fy = oy,
    fz = oz;
  const tx = fx + sx,
    ty = fy + sy,
    tz = fz + sz;
  const lx = fx - cp[0];
  const ly = fy - cp[1];
  const lz = fz - cp[2];
  const hx = tx - cp[0];
  const hy = ty - cp[1];
  const hz = tz - cp[2];
  const faceDefs = [
    { v: [hx, hy, hz, hx, hy, lz, hx, ly, hz, hx, ly, lz], n: [1, 0, 0] },
    { v: [lx, hy, lz, lx, hy, hz, lx, ly, lz, lx, ly, hz], n: [-1, 0, 0] },
    { v: [lx, hy, lz, hx, hy, lz, lx, hy, hz, hx, hy, hz], n: [0, 1, 0] },
    { v: [lx, ly, hz, hx, ly, hz, lx, ly, lz, hx, ly, lz], n: [0, -1, 0] },
    { v: [lx, hy, hz, hx, hy, hz, lx, ly, hz, hx, ly, hz], n: [0, 0, 1] },
    { v: [hx, hy, lz, lx, hy, lz, hx, ly, lz, lx, ly, lz], n: [0, 0, -1] },
  ];
  let texW = modelTexW || 64,
    texH = modelTexH || 64;
  if (tex?.userData?.imgWidth) {
    texW = tex.userData.imgWidth;
    texH = tex.userData.imgHeight;
  }
  let faceData = null;
  if (cube.faceUV) {
    try {
      faceData = JSON.parse(cube.faceUV);
    } catch (e) {}
  }
  let expandedUV = null;
  if (!faceData && Array.isArray(cube.uv) && cube.uv.length >= 2) {
    expandedUV = expandBoxUV(cube.uv, sx, sy, sz);
  }
  const faceNames = ["east", "west", "up", "down", "south", "north"];
  const pos = [],
    nrm = [],
    uvs = [],
    idx = [];
  for (let f = 0; f < 6; f++) {
    const d = faceDefs[f];
    const bi = pos.length / 3;
    pos.push(...d.v);
    for (let i = 0; i < 4; i++) nrm.push(...d.n);
    let fu = 0,
      fv = 0,
      fw = 0,
      fh = 0;
    if (faceData) {
      const fd = faceData[faceNames[f]];
      if (fd?.uv) {
        fu = fd.uv[0];
        fv = fd.uv[1];
        fw = fd.uv_size?.[0] || 0;
        fh = fd.uv_size?.[1] || 0;
      }
    } else if (expandedUV) {
      const e = expandedUV[f];
      if (e) {
        fu = e[0];
        fv = e[1];
        fw = e[2];
        fh = e[3];
      }
    }
    const u0 = fu / texW,
      v0 = fv / texH;
    const u1 = (fu + fw) / texW,
      v1 = (fv + fh) / texH;
    if (fw !== 0 || fh !== 0) {
      uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
    } else {
      for (let i = 0; i < 4; i++) uvs.push(0, 0);
    }
    idx.push(bi, bi + 2, bi + 1, bi + 2, bi + 3, bi + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

function expandBoxUV(uv, sx, sy, sz) {
  const [u, v] = uv;
  const x = sx,
    y = sy,
    z = sz;
  return [
    [u, v + z, z, y],
    [u + z + x, v + z, z, y],
    [u + z + x, v + z, -x, -z],
    [u + z + z + x, v, -x, z],
    [u + z + z + x, v + z, x, y],
    [u + z, v + z, x, y],
  ];
}
