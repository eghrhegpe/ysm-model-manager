// ===== 3D 多角度截图渲染器（类型化版 — ADR-014 P2）=====
import * as THREE from "three";
import { getApp } from "../../wails/app.ts";
import { loadTextures } from "./model3d-loader.ts";
import { buildSceneMesh, type Spec3D } from "../../utils/3d/model3d.ts";

export interface AngleShot {
  name: string;
  base64: string;
}

// renderMultiAngle 透明背景多角度截图
export async function renderMultiAngle(
  modelPath: string,
  texUrls: string[],
  opts: { size?: number } = {},
): Promise<AngleShot[] | null> {
  const size = opts.size || 512;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  try {
    const { GetModel3DSpec } = await getApp();
    let spec: Spec3D;
    try {
      spec = JSON.parse(await GetModel3DSpec(modelPath)) as Spec3D;
    } catch (e) {
      // P2 修复：spec 获取/解析失败返回 null 而非 reject——
      // 原实现直接 reject，消费者 skeleton.ts 的 saveShot 只有 try/finally 无 catch → unhandled rejection
      console.warn("[screenshot] spec 获取失败:", e);
      return null;
    }
    if (!spec.models?.length) return null;
    const texArr = await loadTextures(texUrls);

    renderer = new THREE.WebGLRenderer({
      preserveDrawingBuffer: true,
      antialias: true,
      alpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(size, size);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dl = new THREE.DirectionalLight(0xffffff, 2);
    dl.position.set(10, 30, 20);
    scene.add(dl);

    const { boneGroupMap, rootGroup } = buildSceneMesh(spec);
    scene.add(rootGroup);

    // Mesh 创建
    for (const mg of spec.models || []) {
      if (!mg.meshGroups?.length) continue;
      for (const md of mg.meshGroups) {
        const bg = boneGroupMap.get(md.boneId);
        if (!bg) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(md.positions || [], 3),
        );
        geo.setAttribute(
          "normal",
          new THREE.Float32BufferAttribute(md.normals || [], 3),
        );
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(md.uvs || [], 2));
        geo.setIndex(md.indices || []);
        const mti = md.texIdx ?? 0;
        const mt = texArr.length > 0 ? texArr[mti] || texArr[0] : null;
        const mat = mt
          ? new THREE.MeshBasicMaterial({
              map: mt,
              alphaTest: mti > 0 ? 0.5 : 0.02,
              transparent: true,
              side: mti > 0 ? THREE.BackSide : THREE.DoubleSide,
            })
          : new THREE.MeshBasicMaterial({
              color: 0x44aa88,
              side: THREE.DoubleSide,
            });
        const mesh = new THREE.Mesh(geo, mat);
        const lp = md.localPosition || [0, 0, 0];
        mesh.position.set(lp[0], lp[1], lp[2]);
        const lr = md.localRotation || [0, 0, 0, 1];
        if (
          lr[3] !== 1 ||
          lr[0] !== 0 ||
          lr[1] !== 0 ||
          lr[2] !== 0
        )
          mesh.quaternion.set(lr[0], lr[1], lr[2], lr[3]);
        bg.add(mesh);
      }
    }

    scene.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(rootGroup);
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const dist = ((maxDim / (2 * Math.tan((45 * Math.PI) / 360)) / 0.85) * 1.2);

    const angles: Array<{ name: string; theta: number }> = [
      { name: "front", theta: 0 },
      { name: "45", theta: Math.PI / 4 },
      { name: "side", theta: Math.PI / 2 },
      { name: "back45", theta: -Math.PI / 4 },
    ];

    const results: AngleShot[] = [];
    for (const { name, theta } of angles) {
      camera.position.set(
        center.x + Math.sin(theta) * dist,
        center.y,
        center.z - Math.cos(theta) * dist,
      );
      camera.lookAt(center);
      renderer.render(scene, camera);
      const b64 = renderer.domElement.toDataURL("image/png").split(",")[1] || "";
      // P3 修复：空 base64（GPU 异常）不入结果集，避免空内容写成 PNG 文件
      if (b64) {
        results.push({ name, base64: b64 });
      }
    }
    return results;
  } catch (e) {
    // P2 修复：场景构建段（buildSceneMesh/创建 mesh/Box3）抛错也要返回 null 而非 reject
    console.warn("[screenshot] 渲染失败:", e);
    return null;
  } finally {
    // 统一清理：无论成功/失败/异常都必须释放 WebGL 资源，防上下文累积（陷阱 #8）
    if (renderer) {
      scene?.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          // P3 修复（code_review）：恢复数组材质分支——three.js 的 mesh.material 可为
          // Material | Material[]，`mat?.dispose()` 对数组短路不释放；与 model3d.ts:826-828
          // 的清理逻辑保持一致，防未来多材质 mesh 泄漏 GPU 资源
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
      renderer.dispose();
      // P3 修复：dispose 后强制释放上下文，避免延迟到 GC
      (renderer as unknown as { forceContextLoss?: () => void }).forceContextLoss?.();
    }
  }
}
