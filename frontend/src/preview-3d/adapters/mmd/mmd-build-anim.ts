// ===== mmd-build-anim.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import { buildAnimation, buildCameraAnimation, VmdObject, VPDLoader } from "@moeru/three-mmd";
import * as THREE from "three";
import { base64ToBytes, bytesToArrayBuffer } from "@/utils/base/primitives/base64.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { filterAnimFiles, getCustomAnimPath } from "./mmd-anim-library.ts";
import { mmdDiag } from "./mmd-shared.ts";
import type { Stage4Ctx } from "./mmd-types.ts";

/** 扫描自定义动画库目录，VMD/VPD 分别追加到路径清单 */
async function scanCustomAnimLib(c: Stage4Ctx): Promise<void> {
  if (!c.customAnimPath) return;
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

/** 从路径提取标签（去扩展名，空则用兜底） */
function labelFromPath(v: string, ext: string, fallback: string): string {
  return (v.split(/[/\\]/).pop() || "").replace(new RegExp(`\\.${ext}\\$`, "i"), "") || fallback;
}

/** 解析 VMD 动作为 clips（批量读取后逐个 parse） */
async function parseVmdClips(
  c: Stage4Ctx,
  animBatch: Record<string, string | null>,
): Promise<void> {
  for (const v of c.vmdPaths) {
    try {
      const vmdB64 = animBatch[v] ?? null;
      if (!vmdB64) continue;
      const vmd = await VmdObject.ParseFromBuffer(
        bytesToArrayBuffer(base64ToBytes(vmdB64) as Uint8Array),
      );
      c.clips.push({
        label: labelFromPath(v, "vmd", "motion"),
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
}

/** 解析 VPD 姿态到 vpdPoses（Blob URL 加载） */
async function parseVpdPoses(
  c: Stage4Ctx,
  animBatch: Record<string, string | null>,
): Promise<void> {
  for (const v of c.vpdPaths) {
    try {
      const vpdB64 = animBatch[v] ?? null;
      if (!vpdB64) continue;
      const vpdBytes = base64ToBytes(vpdB64) as Uint8Array;
      // [2026-10-12 同族收敛] 原为 `new Blob([vpdBytes.buffer as ArrayBuffer])`——与本文件
      // VMD 路径及 mmd-build-load/mmd-build-scene 的全部入口**不一致**：那些都走
      // `bytesToArrayBuffer`（整视图零拷贝 / 偏移视图 slice 收窄），唯独此处直取 `.buffer`。
      // `.buffer` 是**底层整块**：`base64ToBytes` 目前恰好返回精确数组（新分配、占满），故当前
      // 无 bug；但这是**跨模块隐性契约**——`utils/base/primitives/base64.ts|bytesToArrayBuffer`
      // 的注释已在讨论「零拷贝视图」方向，一旦上游改成返回 subarray，这里会静默把多余字节
      // 塞进 Blob → VPD 姿态文件损坏且不报错。改走同族 helper 即消除该契约依赖。
      const vpdBlobUrl = URL.createObjectURL(new Blob([bytesToArrayBuffer(vpdBytes)]));
      c.blobUrls.push(vpdBlobUrl);
      const vpd = await new VPDLoader().loadAsync(vpdBlobUrl);
      c.vpdPoses.push({
        label: labelFromPath(v, "vpd", "pose"),
        vpd,
      });
    } catch (e) {
      dbg("mmd", { op: "parse-vpd-fail", path: v, err: safeErrorMessage(e) });
    }
  }
}

/** 初始化动画播放状态与相机动画轨道 */
function initPlaybackAndCamera(c: Stage4Ctx): void {
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
}

/** 按模型包围盒适配相机与控制器 */
function fitCameraToModel(c: Stage4Ctx): void {
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

export async function Stage4Anim(c: Stage4Ctx): Promise<void> {
  c.mixer = new THREE.AnimationMixer(c.mesh);
  c.clips = [];
  c.customAnimPath = await getCustomAnimPath();
  await scanCustomAnimLib(c);
  const allAnimPaths = [...c.vmdPaths, ...c.vpdPaths];
  const animBatch =
    allAnimPaths.length > 0 ? await c.effectivePort.readFileBytesBatch(allAnimPaths) : {};
  c.cameraClips = [];
  await parseVmdClips(c, animBatch);
  c.vpdPoses = [];
  await parseVpdPoses(c, animBatch);
  initPlaybackAndCamera(c);
  fitCameraToModel(c);
}
