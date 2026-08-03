// ===== 3D 多角度截图渲染器（类型化版 — ADR-014 P2）=====
import * as THREE from "three";
import { GetModel3DSpec } from "../../bindings/ysm-model-manager/internal/app/app.js";
import { loadTextures } from "./model3d-loader.ts";
import { buildSceneMesh } from "./model3d.js";

export interface AngleShot {
  name: string;
  base64: string;
}

export interface BatchResult {
  ok: number;
  fail: number;
  total: number;
}

interface SpecModelGroup {
  meshGroups?: Array<{
    boneId?: string;
    positions?: number[];
    normals?: number[];
    uvs?: number[];
    indices?: number[];
    texIdx?: number;
    localPosition?: number[];
    localRotation?: number[];
  }>;
}

interface SpecData {
  models?: SpecModelGroup[];
}

// renderMultiAngle 透明背景多角度截图
export async function renderMultiAngle(
  modelPath: string,
  texUrls: string[],
  opts: { size?: number } = {},
): Promise<AngleShot[] | null> {
  const size = opts.size || 512;
  const spec = JSON.parse(await GetModel3DSpec(modelPath)) as SpecData;
  if (!spec.models?.length) return null;
  const texArr = await loadTextures(texUrls);

  const renderer = new THREE.WebGLRenderer({
    preserveDrawingBuffer: true,
    antialias: true,
    alpha: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
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
    results.push({
      name,
      base64: renderer.domElement.toDataURL("image/png").split(",")[1] || "",
    });
  }

  scene.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material))
        mesh.material.forEach((m) => m.dispose());
      else mesh.material?.dispose();
    }
  });
  renderer.dispose();
  return results;
}

// batchRepoScreenshots 批量截图仓库所有模型，4 角度，透明背景
// repoRoot: 仓库根目录（传空则尝试从 App config 读取）
export async function batchRepoScreenshots(
  repoRoot?: string,
  outputDir?: string,
): Promise<BatchResult | undefined> {
  const { ScanModelEntries, SaveScreenshotFile } = await import(
    "../../bindings/ysm-model-manager/internal/app/app.js"
  );
  if (!repoRoot) {
    try {
      const { LoadAppConfig } = await import(
        "../../bindings/ysm-model-manager/internal/app/app.js"
      );
      const cfg = await LoadAppConfig();
      repoRoot = cfg?.ysmRoot || cfg?.filesRoot || "";
    } catch (e) {
      console.warn("[batch] LoadAppConfig 失败:", e);
    }
  }
  if (!repoRoot) {
    console.warn("[batch] 请传入仓库路径: __batchRepoScreenshots('C:/path/repo')");
    return;
  }

  const entries = await ScanModelEntries(repoRoot);
  const models = Array.isArray(entries)
    ? entries.filter((e: { Path?: string; path?: string; Name?: string; name?: string }) => {
        const p = e.Path || e.Name || "";
        return /\.(ysm|zip|7z|json)$/i.test(p);
      })
    : [];
  console.log("[batch] 共找到", models.length, "个模型");

  let ok = 0;
  let fail = 0;
  for (const m of models) {
    const fullPath = m.Path || m.Name || "";
    const normalized = fullPath.replace(/\\/g, "/");
    const base = normalized.split("/").pop()?.replace(/\.\w+$/, "") || "";
    console.log("[batch] 截图:", base);
    try {
      const { AnalyzeBedrockModel } = await import(
        "../../bindings/ysm-model-manager/internal/app/app.js"
      );
      let texUrls: string[] = [];
      try {
        const modelData = await AnalyzeBedrockModel(fullPath);
        if (modelData?.textures?.length) texUrls = modelData.textures;
        else if (modelData?.texture) texUrls = [modelData.texture];
      } catch (e) {
        console.warn("[batch] 取纹理失败:", e);
      }
      const results = await renderMultiAngle(fullPath, texUrls, { size: 512 });
      if (!results) {
        fail++;
        continue;
      }
      const dir =
        outputDir ||
        (normalized.includes("/")
          ? normalized.slice(0, normalized.lastIndexOf("/"))
          : ".");
      for (const r of results) {
        await SaveScreenshotFile(dir + "/" + base + "_" + r.name + ".png", r.base64);
      }
      ok++;
    } catch (e) {
      console.error("[batch] 失败:", fullPath, e);
      fail++;
    }
  }
  console.log("[batch] 完成: 成功", ok, "失败", fail, "/", models.length);
  return { ok, fail, total: models.length };
}
