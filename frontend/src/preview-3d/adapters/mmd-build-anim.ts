// ===== mmd-build-anim.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import { buildAnimation, buildCameraAnimation, VmdObject, VPDLoader } from "@moeru/three-mmd";
import * as THREE from "three";
import { dbg } from "../../utils/debug/debug.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { b64ToBytes, bytesToArrayBuffer } from "../base64.ts";
import { filterAnimFiles, getCustomAnimPath } from "./mmd-anim-library.ts";
import { mmdDiag } from "./mmd-shared.ts";
import type { MdMmStage4Ctx } from "./mmd-types.ts";

export async function mdMmStage4Anim(c: MdMmStage4Ctx): Promise<void> {
  c.mixer = new THREE.AnimationMixer(c.mesh);
  c.clips = [];
  c.customAnimPath = await getCustomAnimPath();
  if (c.customAnimPath) {
    try {
      const animFiles = (await c.effectivePort.listAllFilePaths(c.customAnimPath)) || [];
      const extraAnims = filterAnimFiles(animFiles);
      if (extraAnims.length > 0) {
        c.vmdPaths.push(...extraAnims.filter((p) => p.toLowerCase().endsWith(".vmd")));
        c.vpdPaths.push(...extraAnims.filter((p) => p.toLowerCase().endsWith(".vpd")));
        void mmdDiag(
          c.effectivePort,
          "anim-lib-scan",
          c.customAnimPath,
          "ok",
          `found=${extraAnims.length} (vmd=${extraAnims.filter((p) => p.toLowerCase().endsWith(".vmd")).length})`,
        );
      }
    } catch (e) {
      void mmdDiag(c.effectivePort, "anim-lib-scan", c.customAnimPath, "fail", safeErrorMessage(e));
    }
  }
  const allAnimPaths = [...c.vmdPaths, ...c.vpdPaths];
  const animBatch =
    allAnimPaths.length > 0 ? await c.effectivePort.readFileBytesBatch(allAnimPaths) : {};
  c.cameraClips = [];
  for (const v of c.vmdPaths) {
    try {
      const vmdB64 = animBatch[v] ?? null;
      if (!vmdB64) continue;
      const vmd = await VmdObject.ParseFromBuffer(bytesToArrayBuffer(b64ToBytes(vmdB64)));
      c.clips.push({
        label: (v.split(/[/\\]/).pop() || "").replace(/\.vmd$/i, "") || "motion",
        clip: buildAnimation(vmd, c.mesh),
      });
      if (vmd.cameraKeyFrames && vmd.cameraKeyFrames.length > 0) {
        c.cameraClips.push(buildCameraAnimation(vmd));
      } else {
        c.cameraClips.push(null);
      }
    } catch (e) {
      dbg("mmd", { op: "parse-vmd-fail", path: v, err: safeErrorMessage(e) });
    }
  }
  c.vpdPoses = [];
  for (const v of c.vpdPaths) {
    try {
      const vpdB64 = animBatch[v] ?? null;
      if (!vpdB64) continue;
      const vpdBytes = b64ToBytes(vpdB64);
      const vpdBlobUrl = URL.createObjectURL(new Blob([vpdBytes.buffer as ArrayBuffer]));
      c.blobUrls.push(vpdBlobUrl);
      const vpd = await new VPDLoader().loadAsync(vpdBlobUrl);
      c.vpdPoses.push({
        label: (v.split(/[/\\]/).pop() || "").replace(/\.vpd$/i, "") || "pose",
        vpd,
      });
    } catch (e) {
      dbg("mmd", { op: "parse-vpd-fail", path: v, err: safeErrorMessage(e) });
    }
  }
  c.playing = true;
  c.curIdx = 0;
  c.action = null;
  if (c.clips.length > 0) {
    c.action = c.mixer.clipAction(c.clips[0].clip);
    c.action.play();
  }
  c.cameraAnimRoot = new THREE.PerspectiveCamera();
  c.cameraAnimTarget = new THREE.Object3D();
  c.cameraAnimTarget.name = "target";
  c.cameraAnimRoot.add(c.cameraAnimTarget);
  c.cameraMixer = null;
  c.cameraAction = null;
  c.firstCameraClip = c.cameraClips.find((cc) => cc !== null) ?? null;
  if (c.firstCameraClip) {
    c.cameraMixer = new THREE.AnimationMixer(c.cameraAnimRoot);
    c.cameraAction = c.cameraMixer.clipAction(c.firstCameraClip);
    c.cameraAction.play();
  }
  const box = new THREE.Box3().setFromObject(c.mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // 结构化守卫替代 !：camera/controls 可选（self 模式适配器自驱时为 undefined），
  // 缺失时跳过相机适配（MMD shared 模式正常均存在）
  const camera = c.ctx.camera;
  const controls = c.ctx.controls;
  if (camera) {
    camera.near = 0.05;
    camera.far = maxDim * 50;
    camera.position.set(center.x, center.y + size.y * 0.1, center.z + maxDim * 1.6);
    camera.updateProjectionMatrix();
  }
  if (controls) {
    controls.target.copy(center);
    controls.minDistance = maxDim * 0.1;
    controls.maxDistance = maxDim * 12;
    controls.update();
  }
}
