// ===== MMD 内容适配器（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 本文件只负责 MMD 专属逻辑：经 Go 绑定 ReadFileBytes 取 PMX/PMD 字节 →
// MMDLoader（@moeru/three-mmd，parser 自带，无 babylon 依赖）解析 →
// LoadingManager.setURLModifier 把模型同目录纹理映射为 blob URL（Wails 环境
// 浏览器读不了本地磁盘路径）→ 挂入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import {
  applyVPD,
  buildAnimation,
  buildCameraAnimation,
  MMDLoader,
  VmdObject,
  VPDLoader,
  type VpdObject,
} from "@moeru/three-mmd";
import { MMDAmmoPlugin } from "@moeru/three-mmd-physics-ammo"; // 官方 Ammo.js 物理后端（PhysicsService 实装，非自研 cannon）
import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { dbg } from "../../utils/debug/debug.ts";
import { safeGet } from "../../utils/dom/storage.ts"; // ADR-044：localStorage 统一走安全读写
import { formatLongTask, startMainThreadWatch } from "../../utils/main-thread-watch.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import type {
  MaterialControlBridge,
  MmdBottomNavCtx,
  MmdPlayBridge,
} from "../../views/app-preview/mmd-controls.ts";
import { b64ToBytes, bytesToArrayBuffer } from "../base64.ts";
import { type BoneTree, buildBoneTree } from "../bone-tools.ts";
import { registerModelRoot, unregisterModelRoot } from "../frustum-cull.ts";
import { recordLoadTrace } from "../load-trace.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import { mmdBonesToBoneNodes } from "../mmd-bones.ts"; // ADR-077: pmx.bones 索引结构 → BoneNode[]
import { createFootIKController } from "../mmd-foot-ik.ts"; // 程序化足部锚地（待机态 IK）
import {
  getMmdMaterialDetail,
  listMmdMaterials,
  setMmdMaterialOpacity,
  setMmdMaterialVisible,
} from "../mmd-materials.ts";
import { createAutoDanceController } from "../perception/autodance.ts"; // 语义骨骼消费方：程序化生命力 L3
import { createBlinkController } from "../perception/blink.ts"; // 语义 morph 消费方：程序化生命力 L1.5
import { createBreathController } from "../perception/breath.ts"; // 语义骨骼消费方：程序化生命力 L1
import { createGazeController } from "../perception/gaze.ts"; // 语义骨骼消费方：程序化生命力 L2
import { buildLipMorphIndices, createLipSyncController } from "../perception/lipsync.ts"; // 多 morph index 提取
import { safeDispose } from "../safe-dispose.ts";
import { screenshotFromRenderer } from "../screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import { mmdSemanticBoneMap } from "../semantic-bones.ts";
import { mmdSemanticMorphMap } from "../semantic-morphs.ts";
import { makeBonesPanelItem } from "./bones-panel-node.ts"; // 通用骨骼菜单项工厂（4 adapter 共用，ADR-074 S2 之上）
import { materialNodes } from "./material-controls.ts";
import { filterAnimFiles, getCustomAnimPath } from "./mmd-anim-library.ts";
import { cancelPendingEncodings, scheduleBackgroundEncoding } from "./mmd-ktx2-encoder.ts";
import { Ktx2TextureLoader } from "./mmd-ktx2-texture-loader.ts";
import {
  buildPmxScene,
  createPmxParser,
  type PmxBuildResult,
  type PmxParser,
} from "./mmd-pmx-parser.ts";
import {
  applyWorkerDecodedTextures,
  closeUnusedDecodedBitmaps,
  type DecodedTexture,
  getTextureDecoder,
} from "./mmd-texture-decoder.ts";
// import { createBlinkController } from "../perception/blink.ts"; // 待 three-mmd 暴露 morph 权重 API 后接入
// 纯辅助（纹理判定/TGA 检测/材质槽位/GPU 估算/有界并发映射）已拆至 mmd-utils.ts
import {
  concurrentMap,
  DISPOSE_TEX_KEYS,
  estimateTexGpuBytes,
  isLikelyTga,
  matTexSlots,
  TEXTURE_EXTS,
} from "./mmd-utils.ts";
import { prepareMmdZipInput } from "./mmd-zip-overlay.ts";
import { bytesToBase64 } from "../base64.ts"; // P3-7：bytesToBase64 统一源在 base64.ts，不走 zip-overlay re-export 垫层
import { morphNodes } from "./morph-controls.ts";
import type { PreviewAdapter, PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import {
  type PerceptionCapability,
  type PerceptionState,
  perceptionNodes,
} from "./perception-controls.ts";
import { renderLoadingState } from "./preview-loading.ts";

/** MMD 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） */
export interface MmdDataPort {
  readFileBytes(path: string): Promise<string | null>;
  readFileBytesBatch(paths: string[]): Promise<Record<string, string | null>>;
  /** 批量读取 + SHA256 hash（一次 RPC 返回数据和哈希，替代前端算 hash） */
  readFileBytesBatchWithMeta?: ((paths: string[]) => Promise<Record<string, { data: string | null; hash: string } | null>>) | undefined;
  listAllFilePaths(dir: string): Promise<string[] | null>;
  addOpLog(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void>;
  /** 读取纹理文件并检查 KTX2 缓存，返回 { format, data, hash }（已废弃，保留兼容） */
  getCachedTexture?: ((path: string) => Promise<{ format: string; data: string; hash: string } | null>) | undefined;
  /** KTX2 缓存按 hash 直取（壳层注入 GetCachedTextureByHash；缺失/桥不可用 → null） */
  getCachedTextureByHash?: ((hash: string) => Promise<string | null>) | undefined;
  /** 批量查缓存命中（壳层注入 HasCachedTextures；返回 hash → 是否命中） */
  hasCachedTextures?: ((hashes: string[]) => Promise<Record<string, boolean>>) | undefined;
  /** 保存 KTX2 编码结果到 Go 侧缓存（壳层注入 SaveCachedTexture；缺失 = 无持久化通道，
   *  后台编码仍执行但本次不落盘——替代已废弃 getCachedTexture 作为编码 gate 的语义） */
  saveCachedTexture?: ((hash: string, ktx2B64: string) => Promise<void>) | undefined;
}

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
async function mmdDiag(
  port: MmdDataPort,
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
): Promise<void> {
  try {
    await port.addOpLog(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}

/** 释放 MMD mesh 的全部几何/材质/纹理，并记录统计到环形日志 */
async function disposeMmdMesh(
  mesh: THREE.SkinnedMesh,
  diag: typeof mmdDiag,
  port: MmdDataPort,
  op: string,
): Promise<void> {
  // 收集材质（单材质 / 多材质数组）
  const allMats: THREE.Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  let texCount = 0;
  let totalGpuBytes = 0;
  for (const mat of allMats) {
    for (const key of DISPOSE_TEX_KEYS) {
      const tex = matTexSlots(mat)[key];
      if (tex instanceof THREE.Texture) {
        totalGpuBytes += estimateTexGpuBytes(tex);
        texCount++;
        safeDispose(tex);
      }
    }
    safeDispose(mat);
  }
  safeDispose(mesh.geometry);
  safeDispose(mesh.skeleton);
  const gpuMb = (totalGpuBytes / (1024 * 1024)).toFixed(1);
  void diag(port, op, `tex=${texCount} gpu≈${gpuMb}MB`, "ok");
}

/**
 * MMD 内容构建：读 PMX/PMD 字节 + 同目录纹理 → 挂入核心 scene，返回每帧 update + dispose。
 * 成功路径自行移除 loadingEl（对齐 vrm/litematic 既有口径）。数据读取经 port 注入（ADR-072）。
 */
/** 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） */
export interface MmdPanelHooks {
  fillModelPanel: (list: HTMLElement, ctx: MmdBottomNavCtx) => void;
  fillShotPanel: (
    list: HTMLElement,
    ctx: MmdBottomNavCtx,
    screenshot: (() => Promise<string | null>) | null,
  ) => void;
  /** 声明式节点工厂（[doc:adr-126-p4-b-1] 注入通道回归）：R1 禁 utils 运行时依赖 views，
   *  mmdModelInfoNodes / mmdShotNodes / playNodes 必须经此处由视图层注入（缺失 → children 空、面板不渲染） */
  modelInfoNodes?: (ctx: MmdBottomNavCtx) => PreviewMenuNode[];
  shotNodes?: (
    ctx: MmdBottomNavCtx,
    screenshot: (() => Promise<string | null>) | null,
  ) => PreviewMenuNode[];
  /** [doc:adr-126-p5-收尾] play 面板声明式节点（toggle 播放/暂停 + select 动作 + 空态） */
  playNodes?: (bridge: MmdPlayBridge) => PreviewMenuNode[];
}

// ===== MdMmBuildCtx 按域分组的接口组合（声明层收敛，访问路径 c.xxx 不变）=====
// 原 60 字段扁平巨型接口按生命周期域拆分——每个域接口语义自洽，
// 组合后行为与 `interface MdMmBuildCtx { ...60 字段... }` 完全等价。

/** 输入/路径域：构建入口参数与解析出的模型字节/路径 */
interface MdMmIoState {
  ctx: PreviewBuildCtx;
  path: string;
  port: MmdDataPort;
  panels?: MmdPanelHooks | undefined;
  origPath: string;
  effectivePort: MmdDataPort;
  effectivePath: string;
  zipModelOverride: { bytes: Uint8Array; base: string; b64: string } | null;
  /** [doc:adr-132] zip 内全部 pmx/pmd 候选虚拟路径（rootPath + key）；非 zip = 空数组（model 面板不显示切换） */
  zipModelCandidates: string[];
  modelB64: string | null;
  bytes: Uint8Array;
  modelBase: string;
  dirPath: string;
  blobUrls: string[];
  vmdPaths: string[];
  vpdPaths: string[];
}

/** 解析域：PMX/PMD 解析器实例与解析产物 */
interface MdMmParseState {
  usePmxWorker: boolean;
  pmxParser: PmxParser | null;
  pmxParsePromise: Promise<import("./mmd-pmx-parser.worker.ts").PmxParseResponse> | null;
  mmd: Awaited<ReturnType<MMDLoader["loadAsync"]>> | null;
  workerResult: PmxBuildResult | null;
  pmxParsedData: import("./mmd-pmx-parser.worker.ts").PmxParseResponse | null;
  mesh: THREE.SkinnedMesh;
}

/** 纹理/解码域：纹理映射、blob URL 生命周期与缓存哈希 */
interface MdMmTextureState {
  texMap: Map<string, string>;
  texHashMap: Map<string, string>;
  decodeTasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }>;
  decodedTexturesPromise: Promise<Map<string, DecodedTexture>> | null;
  modelBlobUrl: string;
  blobUrlToRel: Map<string, string>;
  blobUrlToHash: Map<string, string>;
  cachedHashes: Set<string> | null;
  ktx2Loader: KTX2Loader | null;
  ktx2CacheLoader: KTX2Loader | null;
}

/** 动画/相机域：播放状态 + 相机轨道 */
interface MdMmAnimState {
  mixer: THREE.AnimationMixer;
  clips: Array<{ label: string; clip: THREE.AnimationClip }>;
  customAnimPath: string | null;
  cameraClips: Array<THREE.AnimationClip | null>;
  vpdPoses: Array<{ label: string; vpd: VpdObject }>;
  playing: boolean;
  curIdx: number;
  action: THREE.AnimationAction | null;
  cameraAnimRoot: THREE.PerspectiveCamera;
  cameraAnimTarget: THREE.Object3D;
  cameraMixer: THREE.AnimationMixer | null;
  cameraAction: THREE.AnimationAction | null;
  firstCameraClip: THREE.AnimationClip | null;
}

/** 骨骼/感知域：骨骼面板依赖与感知层状态 */
interface MdMmPerceptionState {
  bonePanelRef: { current: (() => void) | null };
  boneTree: BoneTree | null;
  perceptionState: PerceptionState;
}

/** 生命周期/计时域：构建流程计时与跟踪 */
interface MdMmTraceState {
  manager: THREE.LoadingManager;
  textureLoadedAt: number;
  tParseStart: number;
  tParseEnd: number;
  tBuildEnd: number;
  _traceFiles: number;
  _traceGpuMb: number;
  buildSucceeded: boolean;
  stopLongTaskWatch: () => void;
}

/** 构建上下文：6 个域接口组合（55 字段，5 个低频字段已下沉） */
interface MdMmBuildCtx
  extends MdMmIoState,
    MdMmParseState,
    MdMmTextureState,
    MdMmAnimState,
    MdMmPerceptionState,
    MdMmTraceState {}

// ===== 第 2 档：逐 stage 签名收窄（Pick）=====
// 传入仍是完整 c（结构类型兼容），但函数签名只暴露自己用到的字段——
// 此后某 stage 新增越界访问（摸别人域的字段），编译器直接报错。
// 域纪律从自觉变强制，可逐 stage 渐进收紧（频率数据是路线图）。

type MdMmDetectFormatCtx = Pick<MdMmBuildCtx, "modelBase">;

type MdMmStage1Ctx = Pick<
  MdMmBuildCtx,
  | "_traceFiles"
  | "_traceGpuMb"
  | "blobUrlToHash"
  | "blobUrlToRel"
  | "blobUrls"
  | "bytes"
  | "ctx"
  | "decodeTasks"
  | "decodedTexturesPromise"
  | "dirPath"
  | "effectivePath"
  | "effectivePort"
  | "modelB64"
  | "modelBase"
  | "modelBlobUrl"
  | "origPath"
  | "path"
  | "pmxParsePromise"
  | "pmxParser"
  | "port"
  | "stopLongTaskWatch"
  | "texHashMap"
  | "texMap"
  | "usePmxWorker"
  | "vmdPaths"
  | "vpdPaths"
  | "zipModelOverride"
  | "zipModelCandidates"
>;

type MdMmStage1bCtx = Pick<
  MdMmBuildCtx,
  | "_traceFiles"
  | "blobUrlToHash"
  | "blobUrlToRel"
  | "blobUrls"
  | "decodeTasks"
  | "decodedTexturesPromise"
  | "dirPath"
  | "effectivePort"
  | "texHashMap"
  | "texMap"
  | "vmdPaths"
  | "vpdPaths"
>;

type MdMmStage2Ctx = Pick<
  MdMmBuildCtx,
  | "_traceGpuMb"
  | "ctx"
  | "effectivePath"
  | "effectivePort"
  | "manager"
  | "mmd"
  | "tBuildEnd"
  | "tParseEnd"
  | "tParseStart"
  | "texHashMap"
  | "texMap"
  | "textureLoadedAt"
>;

type MdMmParsePmxCtx = Pick<
  MdMmBuildCtx,
  | "effectivePath"
  | "effectivePort"
  | "pmxParsePromise"
  | "pmxParsedData"
  | "texMap"
  | "usePmxWorker"
  | "workerResult"
>;

type MdMmParsePmdCtx = Pick<
  MdMmBuildCtx,
  | "blobUrlToRel"
  | "decodedTexturesPromise"
  | "effectivePath"
  | "effectivePort"
  | "manager"
  | "mesh"
  | "mmd"
  | "pmxParsedData"
  | "pmxParser"
  | "tParseEnd"
  | "tParseStart"
  | "workerResult"
>;

type MdMmStage3Ctx = Pick<
  MdMmBuildCtx,
  | "blobUrlToHash"
  | "blobUrls"
  | "buildSucceeded"
  | "cachedHashes"
  | "ctx"
  | "effectivePath"
  | "effectivePort"
  | "ktx2CacheLoader"
  | "ktx2Loader"
  | "mesh"
  | "port"
>;

type MdMmStage4Ctx = Pick<
  MdMmBuildCtx,
  | "action"
  | "blobUrls"
  | "cameraAction"
  | "cameraAnimRoot"
  | "cameraAnimTarget"
  | "cameraClips"
  | "cameraMixer"
  | "clips"
  | "ctx"
  | "curIdx"
  | "customAnimPath"
  | "effectivePort"
  | "firstCameraClip"
  | "mesh"
  | "mixer"
  | "playing"
  | "vmdPaths"
  | "vpdPaths"
  | "vpdPoses"
>;

type MdMmStage5Ctx = Pick<
  MdMmBuildCtx,
  | "action"
  | "bonePanelRef"
  | "boneTree"
  | "cameraAction"
  | "cameraClips"
  | "cameraMixer"
  | "clips"
  | "ctx"
  | "curIdx"
  | "customAnimPath"
  | "mesh"
  | "mixer"
  | "mmd"
  | "origPath"
  | "panels"
  | "perceptionState"
  | "playing"
  | "zipModelCandidates"
>;

// 收尾聚合器：内部调用 stage6bTrace，故其 Pick 需同时覆盖 stage6b 用到的
// trace 字段（结构类型兼容：传给 stage6bTrace 的 c 必须满足 MdMmStage6bCtx）
type MdMmStage6Ctx = Pick<
  MdMmBuildCtx,
  | "action"
  | "blobUrls"
  | "bonePanelRef"
  | "cameraAction"
  | "cameraAnimRoot"
  | "cameraAnimTarget"
  | "cameraMixer"
  | "ctx"
  | "ktx2CacheLoader"
  | "ktx2Loader"
  | "mesh"
  | "mixer"
  | "mmd"
  | "perceptionState"
  | "port"
  | "stopLongTaskWatch"
  | "vpdPoses"
  | "workerResult"
  | "_traceFiles"
  | "_traceGpuMb"
  | "blobUrlToHash"
  | "buildSucceeded"
  | "cachedHashes"
  | "clips"
  | "origPath"
  | "tBuildEnd"
  | "tParseEnd"
  | "tParseStart"
  | "textureLoadedAt"
  | "usePmxWorker"
>;

type MdMmStage6bCtx = Pick<
  MdMmBuildCtx,
  | "_traceFiles"
  | "_traceGpuMb"
  | "blobUrlToHash"
  | "buildSucceeded"
  | "cachedHashes"
  | "clips"
  | "mmd"
  | "origPath"
  | "tBuildEnd"
  | "tParseEnd"
  | "tParseStart"
  | "textureLoadedAt"
  | "usePmxWorker"
>;

function mdMmDetectFormat(c: MdMmDetectFormatCtx): "pmx" | "pmd" {
  const ext = c.modelBase.split(".").pop()?.toLowerCase();
  if (ext === "pmd") return "pmd";
  return "pmx";
}

async function mdMmStage1Input(c: MdMmStage1Ctx): Promise<void> {
  renderLoadingState(
    c.ctx.loadingEl,
    "🎭",
    "preview.loadingModel",
    "determinate",
    "ysm-mmd-progress",
  );
  c.stopLongTaskWatch = startMainThreadWatch((info) => {
    void mmdDiag(c.effectivePort, "main-thread", formatLongTask(info), "warn");
  });
  c.origPath = c.path;
  c.effectivePort = c.port;
  c.effectivePath = c.path;
  c.zipModelOverride = null;
  c.zipModelCandidates = [];
  if (c.path.toLowerCase().endsWith(".zip")) {
    const zip = await prepareMmdZipInput(c.effectivePath, c.port);
    c.effectivePort = zip.port;
    c.effectivePath = zip.rootPath + zip.modelEntry;
    // [doc:adr-132] 暴露全部 pmx/pmd 候选虚拟路径（模型面板切换用）；第一个 = 当前
    c.zipModelCandidates = zip.allModelEntries.map((key) => zip.rootPath + key);
    c.zipModelOverride = {
      bytes: zip.modelBytes,
      base: zip.modelBase,
      b64: bytesToBase64(zip.modelBytes),
    };
    void mmdDiag(
      c.effectivePort,
      "zip-preprocess",
      c.origPath,
      "ok",
      `model=${zip.modelBase} zip内文件已映射到虚拟路径`,
    );
  }
  c.modelB64 = c.zipModelOverride?.b64 ?? (await c.effectivePort.readFileBytes(c.effectivePath));
  await mmdDiag(
    c.effectivePort,
    "read-model",
    c.effectivePath,
    c.modelB64 ? "ok" : "fail",
    c.modelB64 ? `bytes=${c.modelB64.length}` : "ReadFileBytes 返回空",
  );
  if (!c.modelB64) throw new Error("ReadFileBytes 返回空");
  c.bytes = c.zipModelOverride?.bytes ?? b64ToBytes(c.modelB64);
  c.modelBase =
    c.zipModelOverride?.base ?? (c.effectivePath.split(/[/\\]/).pop() || "").toLowerCase();
  c.usePmxWorker = safeGet("mmd-pmx-worker") === "1";
  c.pmxParser = null;
  c.pmxParsePromise = null;
  if (c.usePmxWorker) {
    c.pmxParser = createPmxParser();
    // worker parse 走 postMessage transfer——同步 detach 传入的 ArrayBuffer。必须给独立
    // 拷贝（slice），否则 c.bytes 的 buffer 被 detach 后，下方 573 行 Blob 构造拿到的
    // 是同源已 detach buffer（byteLength 0 → 异常或空模型 blob），zip 模式的 entries
    // 字节同样被连带清空（e7f20226 bytesToArrayBuffer 零拷贝与 transfer 的冲突点）
    c.pmxParsePromise = c.pmxParser.parse(bytesToArrayBuffer(c.bytes.slice()));
    void mmdDiag(
      c.effectivePort,
      "pmx-parse-dispatch",
      c.effectivePath,
      "ok",
      "PMX binary parse dispatched to worker (mmd-pmx-worker=1)",
    );
  } else {
    void mmdDiag(
      c.effectivePort,
      "pmx-parse-dispatch",
      c.effectivePath,
      "ok",
      "主线程 MMDLoader 路径（mmd-pmx-worker 默认关）",
    );
  }
  c.dirPath = c.effectivePath.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
  c.texMap = new Map();
  c._traceFiles = 0;
  c._traceGpuMb = 0;
  c.blobUrls = [];
  c.vmdPaths = [];
  c.vpdPaths = [];
  c.texHashMap = new Map();
  c.decodeTasks = [];
  c.decodedTexturesPromise = null;
  c.modelBlobUrl = URL.createObjectURL(new Blob([bytesToArrayBuffer(c.bytes)]));
  c.blobUrls.push(c.modelBlobUrl);
  c.texMap.set(c.modelBase, c.modelBlobUrl);
  c.blobUrlToRel = new Map();
  c.blobUrlToHash = new Map();
  await mdMmStage1bFileScan(c);
}

async function mdMmStage1bFileScan(c: MdMmStage1bCtx): Promise<void> {
  try {
    const files = (await c.effectivePort.listAllFilePaths(c.dirPath)) || [];
    c._traceFiles = files.length;
    const texFiles = files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext)));
    const texBatch: Record<string, string | null> = {};
    const texHashBatch: Record<string, string> = {};
    if (texFiles.length > 0) {
      try {
        if (c.effectivePort.readFileBytesBatchWithMeta) {
          const metaBatch = await c.effectivePort.readFileBytesBatchWithMeta(texFiles);
          if (metaBatch) {
            for (const p of texFiles) {
              const entry = metaBatch[p];
              if (entry) {
                texBatch[p] = entry.data;
                if (entry.hash) texHashBatch[p] = entry.hash;
              }
            }
          }
        }
        if (Object.keys(texBatch).length < texFiles.length) {
          const fallback = await c.effectivePort.readFileBytesBatch(texFiles);
          for (const p of texFiles) {
            if (!(p in texBatch) && fallback[p] !== undefined) {
              texBatch[p] = fallback[p];
            }
          }
        }
      } catch {
        void mmdDiag(
          c.effectivePort,
          "batch-read",
          c.dirPath,
          "warn",
          "批量读取失败，降级并发分片读取",
        );
        const fallbackResults = await concurrentMap(texFiles, async (p) => {
          try {
            return [p, await c.effectivePort.readFileBytes(p)] as const;
          } catch {
            return [p, null] as const;
          }
        });
        for (const [p, v] of fallbackResults) texBatch[p] = v;
      }
    }
    for (const p of texFiles) {
      const lower = p.toLowerCase().replace(/\\/g, "/");
      const dirNorm = c.dirPath.toLowerCase().replace(/\\/g, "/");
      const rel = lower.startsWith(dirNorm + "/") ? lower.slice(dirNorm.length + 1) : lower;
      const baseName = lower.split("/").pop() || "";
      const texB64 = texBatch[p] ?? null;
      if (!texB64) continue;
      const texBytes = b64ToBytes(texB64);
      if (p.toLowerCase().endsWith(".tga") && !isLikelyTga(texBytes)) continue;
      const blob = new Blob([bytesToArrayBuffer(texBytes)]);
      const url = URL.createObjectURL(blob);
      c.blobUrls.push(url);
      if (!p.toLowerCase().endsWith(".tga")) {
        const ext = p.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          bmp: "image/bmp",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mime = mimeMap[ext] || "image/png";
        c.decodeTasks.push({
          relPath: rel || baseName,
          bytes: bytesToArrayBuffer(texBytes),
          mimeType: mime,
        });
      }
      c.texMap.set(rel, url);
      c.texMap.set(baseName, url);
      c.blobUrlToRel.set(url, rel);
      if (texHashBatch[p] && !p.toLowerCase().endsWith(".tga")) {
        c.texHashMap.set(rel, texHashBatch[p]);
        c.blobUrlToHash.set(url, texHashBatch[p]);
      }
    }
    if (c.decodeTasks.length > 0) {
      const decoder = getTextureDecoder();
      c.decodedTexturesPromise = decoder.decodeAll(c.decodeTasks);
      void mmdDiag(
        c.effectivePort,
        "tex-decode-dispatch",
        c.dirPath,
        "ok",
        `dispatched=${c.decodeTasks.length} textures to decode workers`,
      );
    }
    c.vmdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vmd")));
    c.vpdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vpd")));
    await mmdDiag(
      c.effectivePort,
      "list-files",
      c.dirPath,
      "ok",
      `files=${files.length} tex=${files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext))).length} vmd=${c.vmdPaths.length}`,
    );
  } catch (e) {
    await mmdDiag(c.effectivePort, "list-files", c.dirPath, "fail", safeErrorMessage(e));
  }
}

async function mdMmStage2LoadingManager(c: MdMmStage2Ctx): Promise<void> {
  c.manager = new THREE.LoadingManager();
  c.textureLoadedAt = 0;
  c.tParseStart = 0;
  c.tParseEnd = 0;
  c.tBuildEnd = 0;
  c.mmd = null;
  c.manager.onProgress = (_url: string, loaded: number, total: number): void => {
    const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    const bar = c.ctx.loadingEl.querySelector<HTMLElement>("#ysm-mmd-progress");
    if (bar) bar.style.width = `${Math.max(5, pct)}%`;
  };
  c.manager.onLoad = (): void => {
    c.textureLoadedAt = performance.now();
    if (c.tParseEnd === 0) return;
    const buildMs = c.tBuildEnd > 0 ? Math.max(0, c.tBuildEnd - c.tParseEnd) : 0;
    const dimCount = new Map<string, number>();
    const mmdMesh = c.mmd?.mesh;
    const mats = Array.isArray(mmdMesh?.material)
      ? mmdMesh.material
      : mmdMesh?.material
        ? [mmdMesh.material]
        : [];
    for (const m of mats) {
      const img = (m as { map?: { image?: HTMLImageElement } })?.map?.image;
      if (img?.width && img?.height) {
        const key = `${img.width}x${img.height}`;
        dimCount.set(key, (dimCount.get(key) ?? 0) + 1);
      }
    }
    const texSizes = [...dimCount.entries()].map(([k, n]) => `${k}x${n}`).join(",") || "none";
    let gpuBytes = 0;
    for (const [dim, n] of dimCount) {
      const [w, h] = dim.split("x").map(Number);
      if (w && h) gpuBytes += w * h * 4 * n;
    }
    const gpuMb = (gpuBytes / (1024 * 1024)).toFixed(1);
    c._traceGpuMb = parseFloat(gpuMb);
    void mmdDiag(
      c.effectivePort,
      "perf",
      c.effectivePath,
      "ok",
      `parse=${Math.round(c.tParseEnd - c.tParseStart)}ms texture=${Math.round(c.textureLoadedAt - c.tParseEnd)}ms build=${Math.round(buildMs)}ms tex=${texSizes} gpu≈${gpuMb}MB`,
    );
  };
  c.manager.setURLModifier((url: string): string => {
    const lower = url.toLowerCase().replace(/\\/g, "/");
    let best: string | undefined;
    let bestLen = -1;
    for (const [key, blobUrl] of c.texMap) {
      if (key.length > bestLen && lower.endsWith(key)) {
        best = blobUrl;
        bestLen = key.length;
      }
    }
    return best ?? url;
  });
  if (c.ctx.renderer) {
    const ktx2DirectLoader = new Ktx2TextureLoader({
      resolveHash: (url: string): string | undefined => {
        const lower = url.toLowerCase().replace(/\\/g, "/");
        const base = lower.split("/").pop() ?? "";
        if (base.startsWith("toon") || lower.includes("/toon/")) return undefined;
        let best: string | undefined;
        let bestLen = -1;
        for (const [rel, hash] of c.texHashMap) {
          const rl = rel.toLowerCase();
          if (rl.endsWith(base) && rl.length > bestLen) {
            best = hash;
            bestLen = rl.length;
          }
        }
        return best;
      },
      getCachedTextureByHash: async (hash: string): Promise<string | null> => {
        try {
          // ADR-072：适配器 0 backend import——KTX2 缓存经 port 注入（壳层实现），
          // port 未提供该方法（可选）→ undefined || null；空串/缺绑定均归一 null（保留原守卫语义）
          return (await c.effectivePort.getCachedTextureByHash?.(hash)) || null;
        } catch {
          return null;
        }
      },
      ktx2Loader: new KTX2Loader().setTranscoderPath("/basis/").detectSupport(c.ctx.renderer),
      fallbackLoader: new THREE.TextureLoader(c.manager),
    });
    c.manager.addHandler(/\.(png|jpe?g|bmp|gif|webp)$/i, ktx2DirectLoader);
  }
}

async function mdMmParsePmxStage(c: MdMmParsePmxCtx): Promise<void> {
  c.workerResult = null;
  c.pmxParsedData = null;
  if (c.usePmxWorker && c.pmxParsePromise) {
    try {
      const pmxResult = await c.pmxParsePromise;
      c.pmxParsedData = pmxResult;
      if (pmxResult.ok && pmxResult.vertices && pmxResult.faces) {
        c.workerResult = await buildPmxScene(pmxResult, { texUrlMap: c.texMap, sliced: true });
        if (c.workerResult) {
          await mmdDiag(
            c.effectivePort,
            "pmx-worker-build",
            c.effectivePath,
            "ok",
            `vertices=${pmxResult.vertices.count} faces=${pmxResult.faces.count} bones=${pmxResult.bones?.length ?? 0} mats=${pmxResult.materials?.length ?? 0} (Worker path)`,
          );
        }
      } else if (!pmxResult.ok) {
        await mmdDiag(
          c.effectivePort,
          "pmx-worker-build",
          c.effectivePath,
          "warn",
          `Worker parse failed: ${pmxResult.error ?? "unknown"} (fallback to MMDLoader)`,
        );
      }
    } catch {
      await mmdDiag(
        c.effectivePort,
        "pmx-worker-build",
        c.effectivePath,
        "warn",
        "Worker parse threw, fallback to MMDLoader",
      );
    }
  }
}

async function mdMmParsePmdStage(c: MdMmParsePmdCtx): Promise<void> {
  if (c.workerResult) {
    c.mesh = c.workerResult.mesh;
    c.tParseStart = performance.now();
    c.tParseEnd = c.tParseStart;
    c.mmd = {
      mesh: c.workerResult.mesh,
      pmx: c.pmxParsedData
        ? {
            bones: c.pmxParsedData.bones ?? [],
            materials: c.pmxParsedData.materials ?? [],
            morphs: c.pmxParsedData.morphs ?? [],
          }
        : undefined,
      updateWithMixer: () => {},
      dispose: () => {},
    } as unknown as Awaited<ReturnType<MMDLoader["loadAsync"]>>;
    if (c.pmxParsedData?.bones && c.pmxParsedData.bones.some((b) => b.hasIK)) {
      await mmdDiag(
        c.effectivePort,
        "worker-limit",
        c.effectivePath,
        "warn",
        "Worker 路径：包含 IK 骨骼的模型，IK 计算将在主线程 fallback 模式下可用",
      );
    }
    if (c.pmxParsedData?.rigidBodies && c.pmxParsedData.rigidBodies.length > 0) {
      await mmdDiag(
        c.effectivePort,
        "worker-limit",
        c.effectivePath,
        "warn",
        `Worker 路径：含 ${c.pmxParsedData.rigidBodies.length} 个刚体，物理模拟需 MMDLoader fallback`,
      );
    }
    c.pmxParser?.dispose();
  } else {
    const loader = new MMDLoader(c.manager).register(MMDAmmoPlugin);
    c.tParseStart = performance.now();
    try {
      c.mmd = await loader.loadAsync(c.effectivePath);
    } catch (e) {
      // blob 回收由 buildMmdScene 主入口 finally 统一兜底（此处再收会双回收）
      await mmdDiag(c.effectivePort, "parse", c.effectivePath, "fail", safeErrorMessage(e));
      throw e;
    }
    await mmdDiag(
      c.effectivePort,
      "parse",
      c.effectivePath,
      "ok",
      `bones=${c.mmd?.pmx?.bones?.length ?? 0} mats=${c.mmd?.pmx?.materials?.length ?? 0} morphs=${c.mmd?.pmx?.morphs?.length ?? 0}`,
    );
    c.tParseEnd = performance.now();
    // 结构化守卫替代 !：loadAsync 成功返回后 mmd 必非空，但仍显式校验
    // （parse 失败已在上方 throw，走到此处即成功路径）
    if (!c.mmd) {
      throw new Error("MMD parse 返回空结果");
    }
    c.mesh = c.mmd.mesh;
    c.pmxParser?.dispose();
  }
  if (c.decodedTexturesPromise) {
    // P2-5（审核）：decoded 提到 try 外声明——apply 抛错路径也能 close 未命中位图
    let decoded: Map<string, DecodedTexture> | null = null;
    try {
      decoded = await c.decodedTexturesPromise;
      const allMats2: THREE.Material[] = Array.isArray(c.mesh.material)
        ? c.mesh.material
        : c.mesh.material
          ? [c.mesh.material]
          : [];
      const pendingMats = allMats2.filter(
        (m) => (m.userData as Record<string, unknown>)?.pendingTexture,
      );
      if (pendingMats.length === 0 && decoded.size > 0) {
        await mmdDiag(
          c.effectivePort,
          "tex-decode-apply",
          c.effectivePath,
          "warn",
          `decoded=${decoded.size} bitmaps but 0 materials have pendingTexture! mats=${allMats2.length} userDatas=[${allMats2.map((m) => Object.keys(m.userData || {}).join(",")).join("|")}]`,
        );
      } else if (decoded.size > 0) {
        const { replaced, total } = applyWorkerDecodedTextures(c.mesh, decoded, c.blobUrlToRel);
        if (replaced > 0) {
          await mmdDiag(
            c.effectivePort,
            "tex-decode-apply",
            c.effectivePath,
            "ok",
            `worker-decoded=${replaced}/${total} textures (${decoded.size} bitmaps from workers)`,
          );
        } else {
          await mmdDiag(
            c.effectivePort,
            "tex-decode-apply",
            c.effectivePath,
            "warn",
            `decoded=${decoded.size} bitmaps but replaced=0 (PMX路径与磁盘路径可能不匹配, pendingTexture keys=[...查环形日志tex-decode-dispatch])`,
          );
        }
      }
    } catch {
      await mmdDiag(
        c.effectivePort,
        "tex-decode-apply",
        c.effectivePath,
        "warn",
        "Worker 解码纹理应用失败，使用主线程 fallback",
      );
    }
    // P2-5：apply 收尾（含抛错路径）统一释放未命中位图（refCount 恒 0 的——已应用的
    // 由纹理 dispose 监听归零 close）。防每次失败加载泄漏 N 张 GPU 位图。
    if (decoded) closeUnusedDecodedBitmaps(decoded);
  }
}

async function mdMmStage3SceneMesh(c: MdMmStage3Ctx): Promise<void> {
  c.buildSucceeded = false;
  // 拆分前：scene 缺失 / bb 失败的守卫 return 会短路整个 stage3（KTX2 缓存读 3.2
  // 与后台编码写 3.3 一并跳过）——守卫拆到 3.1 后须在此恢复短路语义，防未挂载模型
  // 仍触发缓存 hydrate/dispose 与 saveCachedTexture 持久化（376d07ac 回归点）。
  if (!(await mdMmStage3MountAndDebug(c))) return;
  await mdMmStage3Ktx2Hydrate(c);
  await mdMmStage3Ktx2Schedule(c);
}

// 3.1 挂载 + 网格调试诊断（scene 守卫 → add → registerModelRoot → boundingBox diag）
// 返回是否完成挂载（false = 守卫命中跳过挂载，调用方须短路 3.2/3.3）
async function mdMmStage3MountAndDebug(c: MdMmStage3Ctx): Promise<boolean> {
  // 结构化守卫替代 !：scene 可选（self 模式适配器自驱 renderer 时为 undefined）
  const scene = c.ctx.scene;
  if (!scene) {
    await mmdDiag(
      c.effectivePort,
      "mesh-debug",
      c.effectivePath,
      "warn",
      "共享 scene 不可用，跳过挂载",
    );
    return false;
  }
  scene.add(c.mesh);
  registerModelRoot(c.mesh);
  {
    const geo = c.mesh.geometry;
    geo.computeBoundingBox();
    // computeBoundingBox 后 boundingBox 必非空；显式守卫替代 !
    const bb = geo.boundingBox;
    if (!bb) {
      await mmdDiag(
        c.effectivePort,
        "mesh-debug",
        c.effectivePath,
        "warn",
        "几何 boundingBox 计算失败",
      );
      return false;
    }
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    const idx = geo.index;
    const allMats = Array.isArray(c.mesh.material)
      ? c.mesh.material
      : c.mesh.material
        ? [c.mesh.material]
        : [];
    const hasMap = allMats.filter((m) => (m as THREE.MeshStandardMaterial).map).length;
    await mmdDiag(
      c.effectivePort,
      "mesh-debug",
      c.effectivePath,
      "warn",
      `posAttr=${posAttr?.count ?? "null"} idx=${idx?.count ?? "null"} bb=${bb.min.toArray().map((v) => v.toFixed(1))}/${bb.max.toArray().map((v) => v.toFixed(1))} visible=${c.mesh.visible} frustumCulled=${c.mesh.frustumCulled} mats=${allMats.length} hasMap=${hasMap} wm=${c.mesh.matrixWorld.elements[12].toFixed(1)},${c.mesh.matrixWorld.elements[13].toFixed(1)},${c.mesh.matrixWorld.elements[14].toFixed(1)} worldPos=${c.mesh
        .getWorldPosition(new THREE.Vector3())
        .toArray()
        .map((v) => v.toFixed(1))}`,
    );
  }
  c.ctx.loadingEl.remove();
  c.cachedHashes = null;
  return true;
}

// 3.2 KTX2 缓存命中 → 按 hash 聚槽 → 单次解码替换（读路径）
async function mdMmStage3Ktx2Hydrate(c: MdMmStage3Ctx): Promise<void> {
  if (c.blobUrlToHash.size > 0 && c.ctx.renderer) {
    // ADR-072：适配器 0 backend import——KTX2 缓存经 port 注入（壳层实现）；
    // port 缺方法（可选）→ 跳过缓存优化（保留原 typeof-function 守卫语义）
    const hasCachedTextures = c.effectivePort.hasCachedTextures;
    const getCachedTextureByHash = c.effectivePort.getCachedTextureByHash;
    if (typeof hasCachedTextures === "function" && typeof getCachedTextureByHash === "function") {
      const allHashes = [...new Set(c.blobUrlToHash.values())];
      const cacheStatus = (await hasCachedTextures(allHashes)) ?? {};
      c.cachedHashes = new Set(allHashes.filter((h) => cacheStatus[h]));
      if (c.cachedHashes.size > 0) {
        c.ktx2CacheLoader = new KTX2Loader()
          .setTranscoderPath("/basis/")
          .detectSupport(c.ctx.renderer);
        const allMats: THREE.Material[] = Array.isArray(c.mesh.material)
          ? c.mesh.material
          : c.mesh.material
            ? [c.mesh.material]
            : [];
        // P2-6（审核）：按 hash 聚合材质槽，一个 hash 只 loadAsync 一次——原逐槽替换
        // 会让共享同一纹理的 N 个材质槽各解码一次 KTX2（three-mmd 用 ctx.textures[fullPath]
        // 缓存共享身份），浪费 GPU 内存且破坏纹理共享。聚合后同一 hash 的所有槽
        // 赋同一份 CompressedTexture 实例，保持与原纹理一致的共享语义。
        const slotsByHash = new Map<string, Array<{ mat: THREE.Material; key: string }>>();
        for (const mat of allMats) {
          for (const key of DISPOSE_TEX_KEYS) {
            const tex = matTexSlots(mat)[key];
            if (!(tex instanceof THREE.Texture)) continue;
            const img = tex.image as HTMLImageElement | undefined;
            if (!img?.src?.startsWith("blob:")) continue;
            const hash = c.blobUrlToHash.get(img.src);
            if (!hash || !c.cachedHashes.has(hash)) continue;
            const arr = slotsByHash.get(hash);
            if (arr) arr.push({ mat, key });
            else slotsByHash.set(hash, [{ mat, key }]);
          }
        }
        // 逐 hash 单次替换：loadAsync 一次 → 同一份压缩纹理赋给所有共享槽
        const replaceTasks: Array<Promise<void>> = [];
        for (const [hash, slots] of slotsByHash) {
          replaceTasks.push(
            getCachedTextureByHash(hash).then((ktx2B64) => {
              if (!ktx2B64) return;
              const ktxBytes = b64ToBytes(ktx2B64);
              const ktxBlob = new Blob([bytesToArrayBuffer(ktxBytes)]);
              const ktxUrl = URL.createObjectURL(ktxBlob);
              c.blobUrls.push(ktxUrl);
              return (
                c.ktx2CacheLoader!
                  .loadAsync(ktxUrl)
                  .then((compressedTex) => {
                    for (const { mat, key } of slots) {
                      const prev = matTexSlots(mat)[key];
                      matTexSlots(mat)[key] = compressedTex;
                      if (prev instanceof THREE.Texture) prev.dispose();
                      mat.needsUpdate = true;
                    }
                  })
                  // KTX2 缓存替换失败 → 保留原纹理，不阻断批量替换（链保持 resolve，
                  // 供外层 Promise.all await 与 replaced= 计数——不可改 fire-and-forget）
                  .catch((err) =>
                    dbg("ktx2-replace-fail", { hash, slots: slots.length, err: safeErrorMessage(err) }),
                  )
              );
            }),
          );
        }
        await Promise.all(replaceTasks);
        await mmdDiag(
          c.effectivePort,
          "ktx2-replace",
          "cache-hit",
          "ok",
          `cached=${c.cachedHashes.size} replaced=${replaceTasks.length} slots=${slotsByHash.size} total=${allHashes.length}`,
        );
      } else {
        await mmdDiag(
          c.effectivePort,
          "ktx2-replace",
          "cache-miss",
          "warn",
          `total=${allHashes.length}（缓存未命中，将后台编码）`,
        );
      }
    }
  }
}

// 3.3 后台编码调度（写路径持久化通道，gate = saveCachedTexture）
async function mdMmStage3Ktx2Schedule(c: MdMmStage3Ctx): Promise<void> {
  // P2-3（审核）：后台编码 gate 从「已废弃 getCachedTexture」改为 saveCachedTexture——
  // 读路径已用 hasCachedTextures/getCachedTextureByHash，写路径真正需要的是持久化通道；
  // 原 gate 挂在废弃方法上，一旦按「已废弃」清理会静默停掉后台编码（缓存永不写入）。
  if (c.blobUrlToHash.size > 0 && c.effectivePort.saveCachedTexture) {
    // 局部 const 收窄替代 !：filter 闭包内 TS 不保持 c.cachedHashes 的收窄
    const cachedHashes = c.cachedHashes;
    const toEncode = cachedHashes
      ? new Map([...c.blobUrlToHash].filter(([, h]) => !cachedHashes.has(h)))
      : c.blobUrlToHash;
    if (toEncode.size > 0) {
      scheduleBackgroundEncoding(toEncode, c.port);
    }
  }
}

async function mdMmStage4Anim(c: MdMmStage4Ctx): Promise<void> {
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

function mdMmStage5Menu(c: MdMmStage5Ctx): {
  semanticBones: ReturnType<typeof mmdSemanticBoneMap> | undefined;
  semanticMorphs: ReturnType<typeof mmdSemanticMorphMap>;
  breath: ReturnType<typeof createBreathController>;
  gaze: ReturnType<typeof createGazeController>;
  blink: ReturnType<typeof createBlinkController>;
  lipSync: ReturnType<typeof createLipSyncController>;
  lipSyncTime: number;
  lipIndices: ReturnType<typeof buildLipMorphIndices> | undefined;
  autoDance: ReturnType<typeof createAutoDanceController>;
  footIK: ReturnType<typeof createFootIKController>;
  items: PreviewMenuNode[];
} {
  const navCtx: MmdBottomNavCtx = {
    mmd: c.mmd!,
    mesh: c.mesh,
    modelName: c.origPath.split(/[/\\]/).pop() || "",
    modelPath: c.origPath,
    ...(c.ctx.cameraControls ? { cameraControls: c.ctx.cameraControls } : {}),
    ...(c.ctx.switchTo ? { switchTo: c.ctx.switchTo } : {}),
    // [doc:adr-132] zip 多 pmx 候选（模型面板切换 select 用）
    zipModelCandidates: c.zipModelCandidates,
  };
  const mats = c.mesh.material as unknown as THREE.Material[];
  c.bonePanelRef = { current: null };
  c.boneTree =
    c.mmd?.pmx?.bones && c.mesh.skeleton
      ? buildBoneTree(mmdBonesToBoneNodes(c.mmd?.pmx.bones, c.mesh.skeleton.bones))
      : null;
  c.perceptionState = { breath: true, gaze: true, blink: true, lipSync: true, autoDance: true };
  // perceptionCaps 仅本函数使用（菜单注入）——局部 const，不占用 ctx
  const perceptionCaps: PerceptionCapability[] = [
    { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
    { id: "gaze", labelKey: "preview.perceptionGaze", fallback: "注视" },
    { id: "blink", labelKey: "preview.perceptionBlink", fallback: "眨眼" },
    { id: "lipSync", labelKey: "preview.perceptionLipSync", fallback: "口型" },
    { id: "autoDance", labelKey: "preview.perceptionAutoDance", fallback: "律动" },
  ];
  const items = mmdMenuItems({
    navCtx,
    panels: c.panels,
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(c.ctx.renderer!, c.ctx.scene, c.ctx.camera)),
    material: {
      list: () =>
        listMmdMaterials((c.mmd?.pmx.materials as unknown as readonly { name: string }[]) ?? []),
      getDetail: (i) =>
        getMmdMaterialDetail(
          (c.mmd?.pmx.materials as unknown as readonly { name: string }[]) ?? [],
          mats,
          i,
        ),
      setVisible: (i, v) => setMmdMaterialVisible(mats, i, v),
      setOpacity: (i, o) => {
        setMmdMaterialOpacity(mats, i, o);
        const m = mats[i];
        if (m) m.needsUpdate = true;
      },
    },
    play: {
      clips: c.clips,
      isPlaying: () => c.playing,
      toggle: () => {
        if (c.clips.length === 0) return;
        c.playing = !c.playing;
        if (c.action) c.action.paused = !c.playing;
        if (c.cameraAction) c.cameraAction.paused = !c.playing;
      },
      currentIndex: () => c.curIdx,
      select: (i) => {
        if (i === c.curIdx || i >= c.clips.length) return;
        c.curIdx = i;
        c.action?.stop();
        c.mesh.skeleton?.pose();
        c.action = c.mixer.clipAction(c.clips[i].clip);
        c.action.reset();
        if (c.playing) c.action.play();
        if (c.cameraMixer) {
          c.cameraAction?.stop();
          const nextCamClip = c.cameraClips[i] ?? null;
          c.cameraAction = nextCamClip ? c.cameraMixer.clipAction(nextCamClip) : null;
          if (c.cameraAction && c.playing) c.cameraAction.play();
        }
      },
      animDir: c.customAnimPath,
      requestReload: () => {
        void c.ctx.menu.refreshDock();
      },
    },
    bonePanel: c.boneTree
      ? {
          tree: c.boneTree,
          viewContainer: c.ctx.viewContainer,
          camera: c.ctx.camera,
          scene: c.ctx.scene,
          cleanupRef: c.bonePanelRef,
        }
      : null,
    perception: { state: c.perceptionState, caps: perceptionCaps },
  });
  const semanticBones = c.boneTree ? mmdSemanticBoneMap(c.boneTree) : undefined;
  const semanticMorphs = mmdSemanticMorphMap(c.mmd?.pmx?.morphs ?? []);
  const breath = createBreathController();
  const gaze = createGazeController();
  const blink = createBlinkController();
  const lipSync = createLipSyncController({ multiMorph: true });
  const lipSyncTime = 0;
  const lipIndices =
    c.mesh.morphTargetDictionary && semanticMorphs
      ? buildLipMorphIndices(semanticMorphs, c.mesh.morphTargetDictionary)
      : undefined;
  const autoDance = createAutoDanceController({ bpm: 120, intensity: 0.3 });
  const footIK = createFootIKController(c.boneTree, semanticBones);
  return {
    semanticBones,
    semanticMorphs,
    breath,
    gaze,
    blink,
    lipSync,
    lipSyncTime,
    lipIndices,
    autoDance,
    footIK,
    items,
  };
}

function mdMmStage6Result(
  c: MdMmStage6Ctx,
  s5: ReturnType<typeof mdMmStage5Menu>,
  tStart: number,
): PreviewScene {
  const {
    semanticBones,
    semanticMorphs,
    breath,
    gaze,
    blink,
    lipSync,
    lipIndices,
    autoDance,
    footIK,
    items,
  } = s5;
  let lipSyncTime = s5.lipSyncTime;
  const result: PreviewScene = {
    menuItems: items,
    update: (dt: number): void => {
      if (c.cameraMixer && c.cameraAction && !c.cameraAction.paused) {
        c.cameraMixer.update(dt);
        const cam = c.ctx.camera;
        if (cam) {
          cam.position.copy(c.cameraAnimRoot.position);
          cam.quaternion.copy(c.cameraAnimRoot.quaternion);
          cam.fov = c.cameraAnimRoot.fov;
          cam.updateProjectionMatrix();
        }
        if (c.ctx.controls) c.ctx.controls.target.copy(c.cameraAnimTarget.position);
      }
      if (!c.mesh.visible) return;
      c.mmd?.updateWithMixer(dt, c.mixer, { ik: true, grant: true });
      if (semanticBones) {
        if ((!c.action || c.action.paused) && c.perceptionState.breath)
          breath.apply(dt, semanticBones);
        // camera 可选（self 模式 undefined）：缺失时 gaze 无法取观察点 → 跳过
        if (c.perceptionState.gaze && c.ctx.camera)
          gaze.apply(dt, semanticBones, c.ctx.camera.position);
      }
      const blinkEntry = semanticMorphs.blink;
      if (
        blinkEntry &&
        c.mesh.morphTargetDictionary &&
        c.mesh.morphTargetInfluences &&
        (!c.action || c.action.paused) &&
        c.perceptionState.blink
      ) {
        const idx = c.mesh.morphTargetDictionary[blinkEntry.name];
        if (idx !== undefined) {
          // 局部 const 收窄替代 !：回调闭包内 TS 不保持 c.mesh.morphTargetInfluences 的收窄
          const influences = c.mesh.morphTargetInfluences;
          blink.apply(dt, (weight: number) => {
            influences![idx] = weight;
          });
        }
      }
      if (lipIndices && (!c.action || c.action.paused) && c.perceptionState.lipSync) {
        lipSyncTime += dt;
        const breathPhase = Math.sin((lipSyncTime / 2.5) * Math.PI * 2);
        const openAmp = Math.max(0, breathPhase) * 0.4;
        // lipSync 分支缺 morphTargetInfluences 前置守卫——回调闭包内一并校验，替代 !
        const influences = c.mesh.morphTargetInfluences;
        lipSync.applyMulti(dt, { lipOpen: openAmp }, (morphId, weight) => {
          const idx =
            morphId === "lipOpen"
              ? lipIndices.open
              : morphId === "lipClose"
                ? lipIndices.close
                : morphId === "lipPucker"
                  ? lipIndices.pucker
                  : morphId === "lipSmile"
                    ? lipIndices.smile
                    : undefined;
          if (idx !== undefined && influences) influences[idx] = weight;
        });
      }
      const isIdle = !c.action || c.action.paused;
      footIK.apply(dt, isIdle);
      if (isIdle && c.perceptionState.autoDance) {
        autoDance.apply(dt, semanticBones ?? {});
      }
    },
    dispose: (): void => mdMmStage6Dispose(c, s5),
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(c.ctx.renderer!, c.ctx.scene, c.ctx.camera)),
    semanticBones,
    applyPose:
      c.vpdPoses.length > 0
        ? (index: number): void => {
            const pose = c.vpdPoses[index];
            if (!pose) return;
            try {
              // workerMode 已下沉：worker 构建路径等价于 c.workerResult 非空
              if (c.workerResult) {
                applyVPDToMesh(c.mesh!, pose.vpd);
              } else {
                applyVPD(c.mmd!, pose.vpd, { ik: true, grant: true });
              }
            } catch (e) {
              dbg("mmd", { op: "apply-vpd-fail", index, err: safeErrorMessage(e) });
            }
          }
        : undefined,
  };
  mdMmStage6bTrace(c, tStart);
  return result;
}

// 6b-dispose：scene graph 拆解 → mixers → 感知释放 → 资源 dispose（自包含，仅消费 c + s5）
function mdMmStage6Dispose(
  c: MdMmStage6Ctx,
  s5: ReturnType<typeof mdMmStage5Menu>,
): void {
  const { breath, gaze, blink, lipSync, autoDance, footIK } = s5;
  const renderer = c.ctx.renderer;
  if (renderer) {
    const memBefore = (
      renderer as unknown as { info?: { memory?: { geometries: number; textures: number } } }
    ).info?.memory;
    if (memBefore) {
      dbg(
        "gpu-leak",
        `mmd dispose before: geometries=${memBefore.geometries} textures=${memBefore.textures}`,
      );
    }
  }
  try {
    c.bonePanelRef.current?.();
    // 从 scene 移除 mesh（disposeMmdMesh 只释放 GPU 资源，不处理 scene graph 引用）
    c.ctx.scene?.remove(c.mesh);
    unregisterModelRoot(c.mesh);
    c.mixer.stopAllAction();
    c.mixer.uncacheRoot(c.mesh);
    c.cameraMixer?.stopAllAction();
    breath.dispose();
    gaze.dispose();
    blink.dispose();
    lipSync.dispose();
    autoDance.dispose();
    footIK.dispose();
  } catch (e) {
    dbg("mmd", { op: "dispose-aux-fail", err: safeErrorMessage(e) });
  } finally {
    cancelPendingEncodings();
    c.stopLongTaskWatch();
    for (const url of c.blobUrls) URL.revokeObjectURL(url);
  }
  try {
    disposeMmdMesh(c.mesh, mmdDiag, c.port, "dispose-tex");
    c.mmd?.dispose();
    // KTX2Loader 内部持有 WASM 解码器 + worker pool，不 dispose 会泄漏
    c.ktx2Loader?.dispose();
    c.ktx2CacheLoader?.dispose();
  } catch (e) {
    dbg("mmd", { op: "dispose-mesh-fail", err: safeErrorMessage(e) });
  }
  if (renderer) {
    const memAfter = (
      renderer as unknown as { info?: { memory?: { geometries: number; textures: number } } }
    ).info?.memory;
    if (memAfter) {
      dbg(
        "gpu-leak",
        `mmd dispose after: geometries=${memAfter.geometries} textures=${memAfter.textures}`,
      );
    }
  }
}

function mdMmStage6bTrace(c: MdMmStage6bCtx, tStart: number): void {
  c.tBuildEnd = performance.now();
  c.buildSucceeded = true;
  const _stages: import("../load-trace.ts").LoadTraceStage[] = [];
  if (c.tParseStart > 0)
    _stages.push({ name: "读取", ms: Math.round(c.tParseStart - tStart), status: "ok" });
  if (c.tParseEnd > 0)
    _stages.push({ name: "解析", ms: Math.round(c.tParseEnd - c.tParseStart), status: "ok" });
  if (c.textureLoadedAt > 0)
    _stages.push({
      name: "纹理加载",
      ms: Math.round(c.textureLoadedAt - c.tParseEnd),
      status: "ok",
    });
  if (c.tBuildEnd > c.tParseEnd)
    _stages.push({ name: "build", ms: Math.round(c.tBuildEnd - c.tParseEnd), status: "ok" });
  const _mats = Array.isArray(c.mmd?.mesh?.material)
    ? c.mmd.mesh.material
    : c.mmd?.mesh?.material
      ? [c.mmd.mesh.material]
      : [];
  const _texDetails: import("../load-trace.ts").LoadTraceTexture[] = [];
  for (const m of _mats) {
    const img = (m as { map?: { image?: HTMLImageElement } })?.map?.image;
    if (img?.width && img?.height) {
      const src = (m as { map?: { source?: { src?: string } } })?.map?.source?.src ?? "";
      _texDetails.push({
        path: src.split("/").pop() ?? "texture",
        size: `${img.width}x${img.height}`,
      });
    }
  }
  recordLoadTrace({
    ts: Date.now(),
    format: "mmd",
    path: c.origPath,
    stages: _stages,
    assets: {
      files: c._traceFiles,
      textures: _texDetails.length,
      bones: c.mmd?.pmx?.bones?.length ?? 0,
      materials: c.mmd?.pmx?.materials?.length ?? _mats.length,
      morphs: c.mmd?.pmx?.morphs?.length ?? 0,
      animations: c.clips.length,
      pmxWorker: c.usePmxWorker,
      ktx2Hits: c.cachedHashes?.size ?? 0,
      ktx2Total: c.blobUrlToHash.size,
    },
    textureDetails: _texDetails,
    gpuMb: c._traceGpuMb,
    ok: true,
  });
}

export async function buildMmdScene(
  ctx: PreviewBuildCtx,
  path: string,
  port: MmdDataPort,
  panels?: MmdPanelHooks,
): Promise<PreviewScene> {
  const c = {} as MdMmBuildCtx;
  c.ctx = ctx;
  c.path = path;
  c.port = port;
  c.panels = panels;
  c.stopLongTaskWatch = () => {};
  c.blobUrls = [];
  c.buildSucceeded = false;
  // tStart 下沉：读取阶段计时起点（原 c.tStart 字段），经 stage6Result 传至 stage6bTrace
  const tStart = performance.now();
  try {
    await mdMmStage1Input(c);
    await mdMmStage2LoadingManager(c);
    const fmt = mdMmDetectFormat(c);
    if (fmt === "pmx") await mdMmParsePmxStage(c);
    await mdMmParsePmdStage(c);
    await mdMmStage3SceneMesh(c);
    await mdMmStage4Anim(c);
    const s5 = mdMmStage5Menu(c);
    const result = mdMmStage6Result(c, s5, tStart);
    return result;
  } finally {
    if (!c.buildSucceeded) {
      c.stopLongTaskWatch();
      for (const url of c.blobUrls) URL.revokeObjectURL(url);
    }
  }
}

function applyVPDToMesh(mesh: THREE.SkinnedMesh, vpd: VpdObject): void {
  const vpdBones = vpd?.bones;
  if (!vpdBones) return;

  // 建立骨骼名 → bone 对象的映射（O(1) 查找）
  const bonesByName = new Map<string, THREE.Bone>();
  mesh.skeleton?.bones.forEach((b) => {
    if (b.name) bonesByName.set(b.name, b);
  });

  // VPD 骨骼变换（含坐标系转换）
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  for (const [name, transform] of Object.entries(vpdBones)) {
    const bone = bonesByName.get(name);
    if (!bone || !transform) continue;

    if (transform.position !== undefined) {
      position.set(transform.position[0], transform.position[1], -transform.position[2]);
      bone.position.add(position);
    }
    rotation.set(
      -transform.rotation[0],
      -transform.rotation[1],
      transform.rotation[2],
      transform.rotation[3],
    );
    bone.quaternion.multiply(rotation);
  }

  // Morph 影响
  if (vpd.morphs) {
    const dict = mesh.morphTargetDictionary;
    for (const [name, weight] of Object.entries(vpd.morphs)) {
      const index = dict?.[name];
      if (index !== undefined && mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[index] = weight;
      }
    }
  }

  mesh.updateMatrixWorld(true);
  bonesByName.clear();
}

/** mmdMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface MmdMenuItemsOpts {
  navCtx: MmdBottomNavCtx;
  /** 截图能力（ADR-052 P3：screenshotFromRenderer 共享 renderer）；null → 不注入 shot 项 */
  screenshot: (() => Promise<string | null>) | null;
  /** 材质面板桥（mmd-materials.ts 纯逻辑层，ADR-072） */
  material: MaterialControlBridge;
  /** 播放/动作桥；始终创建（无 clip 时空态引导用户配置自定义动作库） */
  play: MmdPlayBridge;
  /** 骨骼面板依赖；null（无 pmx.bones / skeleton）→ 不注入 bones 项 */
  bonePanel: {
    /** 已构建骨骼树（buildBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: { current: (() => void) | null };
  } | null;
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: MmdPanelHooks | undefined;
  /** 感知层状态（adapter build 创建，面板 UI 双向绑定） */
  perception?: {
    state: PerceptionState;
    caps: PerceptionCapability[];
  };
}

/**
 * ADR-161 §2.5 工厂：MMD 挂载主入口（make<Format>Adapter 命名章程）。
 * dataPort 以工厂函数注入（views mmd-data-port 组装，每次 build 现取）——
 * adapters 层不反向依赖 views。
 * 用法：`const adapter = makeMmdAdapter({ dataPort: () => makeMmdDataPort("mmd-preview"), panels }); mount3D(adapter, path)`
 */
export interface MmdAdapterDeps {
  /** PMX 数据端口工厂（views mmd-data-port；惰性、每 build 现取） */
  dataPort: () => Promise<MmdDataPort>;
  /** 面板 UI hooks（model/shot/play 菜单节点，视图层组装） */
  panels?: MmdPanelHooks;
  /** 适配器 id 覆盖（场景 MMD 用 "mmd-scene" 独立预设；缺省 "mmd"） */
  id?: string;
}
export function makeMmdAdapter(deps: MmdAdapterDeps): PreviewAdapter {
  return {
    id: deps.id ?? "mmd",
    build: async (ctx, path) => buildMmdScene(ctx, path, await deps.dataPort(), deps.panels),
  };
}

/**
 * MMD 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 材质 / 播放（+ 条件 bones）。
 * 提取为可导出表：适配器与测试共用同一份真实数组——测试遍历本表断言结构与
 * dock 渲染（对齐 MikuMikuAR 声明式菜单测试范式），加菜单项只改这里。
 */
export function mmdMenuItems(o: MmdMenuItemsOpts): PreviewMenuNode[] {
  const items: PreviewMenuNode[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      legacyTestId: "mmd-model-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      // [doc:adr-126-p4-b-1] 面板内容声明式化：children = modelInfoNodes 纯数据节点（经 panels 注入，
      // R1 禁 utils→views 运行时依赖），渲染走 renderMenu（preview-menu/render.ts）。
      // fillModelPanel 逃生舱保留在 MmdPanelHooks（兼容既有面板），此处走新通道。
      children: o.panels?.modelInfoNodes?.(o.navCtx) ?? [],
    },
    {
      id: "morph",
      icon: "😀",
      labelKey: "preview.mmdMorph",
      fallback: "表情",
      kind: "panel",
      legacyTestId: "mmd-morph-entry",
      dockGroup: "motion", // 底栏 💃 动作组（表情是动作系统的资产）
      // [doc:adr-126-p5-收尾] morph 面板声明式化：children = morphNodes 纯数据节点
      // （toggle kind，照 perceptionNodes 样板）。fillMorphPanel 逃生舱删除。
      // 仅取 morph 相关子集（SkinnedMesh 的 morphTarget* 为可选项——真实存在才附带）
      children: morphNodes({
        ...(o.navCtx.mesh.morphTargetDictionary !== undefined
          ? { morphTargetDictionary: o.navCtx.mesh.morphTargetDictionary }
          : {}),
        ...(o.navCtx.mesh.morphTargetInfluences !== undefined
          ? { morphTargetInfluences: o.navCtx.mesh.morphTargetInfluences }
          : {}),
      }),
    },
    {
      id: "material",
      icon: "🎨",
      labelKey: "preview.materialList",
      fallback: "材质",
      kind: "panel",
      legacyTestId: "mmd-material-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      children: materialNodes(o.material),
    },
  ];
  // [doc:adr-126-p4-b-1] 截图面板条件注入：screenshot 能力缺失（null）→ 不注入项
  // （对齐 bonePanel 范式；比"注入空 children 面板"干净——截图能力是可选能力）。
  // 面板内容声明式化：children = shotNodes 纯数据节点（6 截图按钮，经 panels 注入），渲染走 renderMenu。
  if (o.screenshot) {
    items.push({
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组
      legacyTestId: "mmd-shot-entry",
      children: o.panels?.shotNodes?.(o.navCtx, o.screenshot) ?? [],
    });
  }
  // MMD 始终注入 play 项（支持用户配置的自定义动作库，空态引导选择）
  items.push({
    id: "play",
    icon: "▶️",
    labelKey: "preview.mmdPlay",
    fallback: "播放",
    kind: "panel",
    legacyTestId: "mmd-play-entry",
    dockGroup: "motion", // 底栏 💃 动作组
    // [doc:adr-126-p5-收尾] play 面板声明式化：children = playNodes（toggle 播放/暂停 +
    // select 动作 + 空态引导），经 panels 注入（R1 禁 utils→views）。fillPlayPanel 逃生舱删除。
    children: o.panels?.playNodes?.(o.play) ?? [],
  });
  if (o.bonePanel) {
    // 工厂统一空守卫 + cleanupRef 重入清理（消除原 4 段 ~15 行重复）
    items.push(
      makeBonesPanelItem({
        tree: o.bonePanel.tree,
        cleanupRef: o.bonePanel.cleanupRef,
        viewContainer: o.bonePanel.viewContainer,
        camera: o.bonePanel.camera,
        scene: o.bonePanel.scene,
        legacyTestId: "mmd-bones-entry",
      }),
    );
  }
  if (o.perception) {
    // 局部 const 收窄替代 !：renderCustom 闭包内 TS 不保持 o.perception 的收窄
    const pc = o.perception;
    items.push({
      id: "perception",
      icon: "👁️",
      labelKey: "preview.perception",
      fallback: "感知",
      kind: "panel",
      dockGroup: "motion",
      children: perceptionNodes(pc.state, pc.caps),
    });
  }
  return items;
}
