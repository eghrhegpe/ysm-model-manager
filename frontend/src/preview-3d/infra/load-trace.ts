// ===== 加载剖析：通用 trace 接口 + 内存 store =====
// 各 3D adapter（MMD / VRM / FBX / YSM / Litematic）各自调用 recordLoadTrace() 写入全局 store；
// perf-trace.ts 的 renderLoadTraceSection() 消费 store 做甘特图 + 资产清单渲染。
// 环形日志面板由各个 adapter 的 diag 函数各自写，本模块不干扰。

export interface LoadTraceTexture {
  path: string;
  size?: string; // "1024x1024"
  cached?: boolean; // KTX2 缓存命中
}

export interface LoadTraceStage {
  name: string;
  ms: number;
  status?: "ok" | "warn" | "error";
}

export interface LoadTraceAssets {
  files?: number;
  textures?: number;
  bones?: number;
  /** YSM 专用：立方体数（cubeCount） */
  cubes?: number;
  materials?: number;
  morphs?: number;
  animations?: number;
  /** MMD 专用：Worker PMX 解析是否启用 */
  pmxWorker?: boolean;
  /** MMD 专用：KTX2 缓存命中数/总数 */
  ktx2Hits?: number;
  ktx2Total?: number;
  /** VRM 专用：VRMA 动画片段数 */
  vrmaClips?: number;
  /** FBX 专用：内嵌动画段数 */
  fbxAnimations?: number;
}

/**
 * 加载 trace 的身份标识：值为 registry preview-key / rtype 契约字符串
 * （全体 adapter 经 core 注入的 ctx.adapterId 派生，ADR-262 D3 收编：
 * 前端不再维护"mmd|vrm|fbx|ysm|litematic|other"闭门字面量表）。
 * 无法归类的加载（model3d-loader 兜底路径）记为 TRACE_FORMAT_OTHER。
 */
export type LoadTraceFormat = string;

/** 兜底哨兵：无法归类的加载（非注册表身份）。 */
export const TRACE_FORMAT_OTHER: LoadTraceFormat = "other";

/** 全部 adapter 产生的身份样本（仅文档用途，非类型约束——单一事实源 = registry 契约）。 */
export const TRACE_FORMAT_ADAPTERS = [
  "ysm",
  "EntityPlayer",
  "mmd",
  "mmd-scene",
  "vrm",
  "fbx",
  "litematic",
] as const;

/**
 * 解码器来源**码**（`_decodedBy`）——**解码器是唯一事实源**：
 * 凡经某条解码路径产出的结果都盖此章，写入缓存/纹理预览等旁路也随对象传播。
 *
 * [ADR-270-d2 R10] 自 decoder/utils.ts 迁入 infra 加载剖析值域：views 入口面仅许
 * import infra 值域面（R10 白名单），DECODE_SOURCE 是「来源码家族」值域常量
 * （与 TRACE_FORMAT_OTHER / TRACE_FORMAT_ADAPTERS 同族），归加载剖析值域。
 *
 *  ⚠️ 数据层只存**来源码**，不存展示文案：文案进数据 ⇒ i18n 失效（切语言不变）、
 *  图标退化成 emoji 字形（ADR-238：不受 currentColor 控制 / 跨平台漂移 / 不随字号缩放）。
 *  展示由 `views/app-preview/tpl.ts` 映射：语义名 → `resolveIcon()` SVG，文案 → `preview.decodedBy.*`。 */
export const DECODE_SOURCE = {
  /** 前端 WASM 内置解码（.ysm 二进制包） */
  wasm: "wasm",
  /** 前端 WASM 解析解压后的 ysm.json 规格 */
  json: "json",
  /** Go 原生解析兜底（.zip / 文件夹 / 解码失败回退） */
  go: "go",
  /** Go 单角色解析（L0 清单命中，多角色包切角色） */
  goSingle: "go-single",
} as const;

/** 解码器来源码取值（`DecodedYsm._decodedBy`）；统计卡徽标按此联合键查表 */
export type DecodeSource = (typeof DECODE_SOURCE)[keyof typeof DECODE_SOURCE];

export interface LoadTrace {
  ts: number;
  format: LoadTraceFormat;
  path: string;
  stages: LoadTraceStage[];
  assets?: LoadTraceAssets;
  textureDetails?: LoadTraceTexture[];
  gpuMb?: number;
  ok: boolean;
}

const MAX_RECORDS = 50;
let _store: LoadTrace[] = [];

export function recordLoadTrace(trace: LoadTrace): void {
  _store.push(trace);
  if (_store.length > MAX_RECORDS) _store = _store.slice(-MAX_RECORDS);
}

export function getLoadTraces(): LoadTrace[] {
  // 返回浅拷贝快照，防止调用方通过 push/splice 绕过 MAX_RECORDS 上限。
  // perf-trace.ts 的消费方式（.length / 索引 / forEach）均为只读操作，快照无损。
  return _store.slice();
}

export function clearLoadTraces(): void {
  _store = [];
}
