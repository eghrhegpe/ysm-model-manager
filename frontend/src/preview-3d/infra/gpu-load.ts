// ===== GPU 负载采样与预算判定（2026 锐评「性能预算靠信仰」——审计卡共识榜 #3，刀⑩）=====
// frontend_design_critique 指控：「MAX_MODELS=8 是计数非预算，无 draw call/纹理字节预算」。
// 本模块引入 renderer.info 的**实测信号**（非 GPU 型号指纹表——ANGLE 字符串解析脆弱、
// Android WebView 无此扩展、happy-dom 不可测）：
//   - info.render.calls = 上一帧 draw call 数（info.render 每帧自动复位，读值无副作用）
//   - info.render.triangles = 上一帧三角面数（同帧复位，读值无副作用）
//   - info.memory.textures = GPU 当前占用的纹理数
//   - textureBytes = 纹理显存字节估算（由 textureCache 聚合后注入，非 renderer.info 字段）
// 判定函数为**纯函数**（注入 sample + limits）——无 WebGL 环境（测试/CLI 契约）可单测；
// 采样器是薄封装，只读 renderer.info 字段，不触发额外渲染。
//
// 2026-09 锐评补强（P1「预算维度不全」）：原实现只判 draw calls + 纹理**数量**——
// 一个 50 万面的 MMD 和一个 5 千面的方块 draw calls 都是 1，预算判不出区别；
// 1024 张 4K 纹理和 1024 张 16×16 纹理，纹理数一样。补 triangles（几何负载）
// 与 textureBytes（显存字节）两维，预算才从「计数」变成「计量」。

import type * as THREE from "three";

/** GPU 负载快照（renderer.info 实测值） */
export interface GpuLoadSample {
  /** 上一帧 draw call 数 */
  drawCalls: number;
  /** 上一帧三角面数（info.render.triangles） */
  triangles: number;
  /** GPU 当前占用纹理数（info.memory.textures） */
  textures: number;
  /** 着色程序数（info.programs 缺失时 0；仅展示用，不进判定） */
  programs: number;
  /** 纹理显存字节估算（textureCache.getTotalBytes()）；未提供时该项不参与判定。
   *  显式 `| undefined`：exactOptionalPropertyTypes 下采样器需能传「未提供」语义。 */
  textureBytes?: number | undefined;
}

/** 预算上限（缺省字段回落 DEFAULT_GPU_LOAD_LIMITS） */
export interface GpuLoadLimits {
  drawCalls?: number;
  triangles?: number;
  textures?: number;
  textureBytes?: number;
}

/** 缺省预算（保守初值，待真机低端设备标定）——量级参照：
 *  单个 MMD ≈ 30-60 draw calls + 3-8 万三角面 + 50-100 纹理；8 模型理论上限
 *  ≈ 500-800 draw calls + 60 万三角面 + 800 纹理。
 *  默认值给足余量、只拦病态堆叠；命中时 toast 附实测数值（有据可依）。
 *  textureBytes 取 256MB——4GB RAM 设备的 GPU 可用纹理内存保守估计。 */
export const DEFAULT_GPU_LOAD_LIMITS: Required<GpuLoadLimits> = {
  drawCalls: 1600,
  triangles: 1_000_000,
  textures: 1024,
  textureBytes: 256 * 1024 * 1024,
};

export interface GpuLoadVerdict {
  ok: boolean;
  /** 超限项 + 实测值（供 toast 证据展示，如「draw calls 2100 > 1600」） */
  reasons: string[];
}

/** 字节 → 人类可读 MB（toast 证据用；非精确显示，取整到 MB）。 */
function toMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** 纯判定：sample vs limits（字段缺省回落默认预算；严格 > 才超限）。
 *
 *  `textureBytes` 维度**仅在 sample 提供该字段时**判定——两个调用点口径不同，勿误读为「统一可选」：
 *  - `gpu-budget|guardGpuBudget`（拦截判定）**总是**聚合传递（含首挂 0 值）；
 *  - `render-host` 的 GPU 饱和采样**故意不传**（饱和只关心 draw calls / triangles，
 *    字节维度对「该不该降分辨率」无指导意义）。 */
export function evaluateGpuLoad(
  sample: GpuLoadSample,
  limits: GpuLoadLimits = DEFAULT_GPU_LOAD_LIMITS,
): GpuLoadVerdict {
  const d = limits.drawCalls ?? DEFAULT_GPU_LOAD_LIMITS.drawCalls;
  const tri = limits.triangles ?? DEFAULT_GPU_LOAD_LIMITS.triangles;
  const t = limits.textures ?? DEFAULT_GPU_LOAD_LIMITS.textures;
  const b = limits.textureBytes ?? DEFAULT_GPU_LOAD_LIMITS.textureBytes;
  const reasons: string[] = [];
  if (sample.drawCalls > d) reasons.push(`draw calls ${sample.drawCalls} > ${d}`);
  if (sample.triangles > tri) reasons.push(`triangles ${sample.triangles} > ${tri}`);
  if (sample.textures > t) reasons.push(`textures ${sample.textures} > ${t}`);
  if (sample.textureBytes !== undefined && sample.textureBytes > b) {
    reasons.push(`texture bytes ${toMb(sample.textureBytes)} > ${toMb(b)}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** 从 renderer 读一次快照（读 info 无副作用；calls/triangles 为上一帧值）。
 *
 *  **fail-open 语义**：info 或其子字段缺失时读 0 —— 预算门是「病态堆叠早拦」的
 *  护栏，不是正确的必要前提；字段缺失时误拦所有加载远比漏拦更糟。
 *
 *  @param textureBytes 可选纹理显存字节（由 textureCache.getTotalBytes() 聚合后传入） */
export function sampleGpuLoad(renderer: THREE.WebGLRenderer, textureBytes?: number): GpuLoadSample {
  const info = renderer.info;
  return {
    drawCalls: info?.render?.calls ?? 0,
    triangles: info?.render?.triangles ?? 0,
    textures: info?.memory?.textures ?? 0,
    programs: info?.programs?.length ?? 0,
    textureBytes,
  };
}
