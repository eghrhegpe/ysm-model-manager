// ===== GPU 负载采样与预算判定（2026 锐评「性能预算靠信仰」——审计卡共识榜 #3，刀⑩）=====
// frontend_design_critique 指控：「MAX_MODELS=8 是计数非预算，无 draw call/纹理字节预算」。
// 本模块引入 renderer.info 的**实测信号**（非 GPU 型号指纹表——ANGLE 字符串解析脆弱、
// Android WebView 无此扩展、happy-dom 不可测）：
//   - info.render.calls = 上一帧 draw call 数（info.render 每帧自动复位，读值无副作用）
//   - info.memory.textures = GPU 当前占用的纹理数
// 判定函数为**纯函数**（注入 sample + limits）——无 WebGL 环境（测试/CLI 契约）可单测；
// 采样器是薄封装，只读 renderer.info 字段，不触发额外渲染。

import type * as THREE from "three";

/** GPU 负载快照（renderer.info 实测值） */
export interface GpuLoadSample {
  /** 上一帧 draw call 数 */
  drawCalls: number;
  /** GPU 当前占用纹理数（info.memory.textures） */
  textures: number;
  /** 着色程序数（info.programs 缺失时 0；仅展示用，不进判定） */
  programs: number;
}

/** 预算上限（缺省字段回落 DEFAULT_GPU_LOAD_LIMITS） */
export interface GpuLoadLimits {
  drawCalls?: number;
  textures?: number;
}

/** 缺省预算（保守初值，待真机低端设备标定）——量级参照：
 *  单个 MMD ≈ 30-60 draw calls + 50-100 纹理；8 模型理论上限 ≈ 500-800 + 800。
 *  默认值给足余量、只拦病态堆叠；命中时 toast 附实测数值（有据可依）。 */
export const DEFAULT_GPU_LOAD_LIMITS: Required<GpuLoadLimits> = {
  drawCalls: 1600,
  textures: 1024,
};

export interface GpuLoadVerdict {
  ok: boolean;
  /** 超限项 + 实测值（供 toast 证据展示，如「draw calls 2100 > 1600」） */
  reasons: string[];
}

/** 纯判定：sample vs limits（字段缺省回落默认预算；严格 > 才超限）。 */
export function evaluateGpuLoad(
  sample: GpuLoadSample,
  limits: GpuLoadLimits = DEFAULT_GPU_LOAD_LIMITS,
): GpuLoadVerdict {
  const d = limits.drawCalls ?? DEFAULT_GPU_LOAD_LIMITS.drawCalls;
  const t = limits.textures ?? DEFAULT_GPU_LOAD_LIMITS.textures;
  const reasons: string[] = [];
  if (sample.drawCalls > d) reasons.push(`draw calls ${sample.drawCalls} > ${d}`);
  if (sample.textures > t) reasons.push(`textures ${sample.textures} > ${t}`);
  return { ok: reasons.length === 0, reasons };
}

/** 从 renderer 读一次快照（读 info 无副作用；calls 为上一帧值）。 */
export function sampleGpuLoad(renderer: THREE.WebGLRenderer): GpuLoadSample {
  const info = renderer.info;
  return {
    drawCalls: info.render.calls,
    textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
  };
}
