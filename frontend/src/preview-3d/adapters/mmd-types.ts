// ===== mmd-types.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import { MMDLoader } from "@moeru/three-mmd";
import type { VpdObject } from "@moeru/three-mmd";
import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import type { MaterialControlBridge, MmdBottomNavCtx, MmdPlayBridge } from "./content-bridges.ts";
import type { BoneTree } from "../bone-tools.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import type { PmxBuildResult, PmxParser } from "./mmd-pmx-parser.ts";
import type { DecodedTexture } from "./mmd-texture-decoder.ts";
import type { PreviewBuildCtx } from "./mount-preview-core.ts";
import type { PerceptionCapability, PerceptionState } from "./perception-controls.ts";

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

/** 失败路径统一释放注册表条目：stage 分配 GPU 资源后经 mdMmTrackAlloc 登记，
 *  buildMmdScene finally 顺序遍历 free（每项独立 try/catch）。2026-09-03 起取代手工枚举，
 *  杜绝新增资源字段忘 dispose 的静默泄漏。 */
export interface MdMmAllocEntry {
  /** 资源名（dbg 日志标识，如 mesh / mmd / pmxParser / ktx2Loader） */
  name: string;
  /** 释放动作（分配点登记时闭包捕获已分配对象，防字段被覆盖后漏释放） */
  free: () => Promise<void> | void;
}

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
  /** 失败释放注册表（2026-09-03；mmd-adapter buildMmdScene finally 统一遍历） */
  alloc: MdMmAllocEntry[];
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
export interface MdMmBuildCtx
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

export type MdMmDetectFormatCtx = Pick<MdMmBuildCtx, "modelBase">;

export type MdMmStage1Ctx = Pick<
  MdMmBuildCtx,
  | "_traceFiles"
  | "_traceGpuMb"
  | "alloc"
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

export type MdMmStage1bCtx = Pick<
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

export type MdMmStage2Ctx = Pick<
  MdMmBuildCtx,
  | "_traceGpuMb"
  | "alloc"
  | "ctx"
  | "effectivePath"
  | "effectivePort"
  | "ktx2Loader"
  | "manager"
  | "mmd"
  | "tBuildEnd"
  | "tParseEnd"
  | "tParseStart"
  | "texHashMap"
  | "texMap"
  | "textureLoadedAt"
>;

export type MdMmParsePmxCtx = Pick<
  MdMmBuildCtx,
  | "effectivePath"
  | "effectivePort"
  | "pmxParsePromise"
  | "pmxParsedData"
  | "texMap"
  | "usePmxWorker"
  | "workerResult"
>;

export type MdMmParsePmdCtx = Pick<
  MdMmBuildCtx,
  | "alloc"
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

export type MdMmStage3Ctx = Pick<
  MdMmBuildCtx,
  | "alloc"
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

export type MdMmStage4Ctx = Pick<
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

export type MdMmStage5Ctx = Pick<
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
export type MdMmStage6Ctx = Pick<
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

export type MdMmStage6bCtx = Pick<
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
