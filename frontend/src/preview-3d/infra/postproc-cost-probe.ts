// ===== 后处理「composer 常驻」成本探针（ADR-250 §2.2 代价量化）=====
//
// 立因：ADR-250 §2.2 把 composer 生命周期从「模型/开关轴」移到「会话轴」——换模型不再
// 重建整组 GPU 资源（**低频**收益），代价是 `ppEnabled=false` 时每帧仍走 composer 链
// （**高频**成本）。低频换高频是否划算，需要数字而不是直觉——本探针就是那个数字。
//
// 方法：同一时间窗内 A/B **交替**各渲染一次（不是先跑完 A 再跑完 B）：
//   - A 臂 `composer`：postProc.render(dt, lightCap) —— 关闭态实况（RenderPass → OutputPass）
//   - B 臂 `direct`  ：renderer.render(scene, camera) —— 直渲兜底（现已不可达的分支）
// 交替是为了抵消机器热漂移/降频/后台任务：两臂共享同一段墙钟，差值才归因于路径而非环境。
//
// 指标口径（**只有 gpuMs 能判决**）：
//   - gpuMs    ：`EXT_disjoint_timer_query_webgl2` 的 TIME_ELAPSED。composer 的成本在 GPU
//                （离屏 RT + MSAA resolve + 全屏 blit），CPU 提交耗时近乎常数——只测 CPU
//                等于什么都没测。不可用时降级为 null，**不伪造**。
//   - submitMs ：CPU 提交耗时。含主循环同期干扰，仅作参考，不作判决依据。
//   - rtBytes  ：composer 读/写双缓冲常驻显存（纯计算，与帧率无关，永远有值）。
//
// ⚠️ 判决前提（报告用 `taxMeaningful` 显式标注，防拿错场景的数字下结论）：
//    只有 `ppEnabled=false` 时 A−B 差才是「常驻税」；`ppEnabled=true` 时 A 臂还含
//    bloom/ssao/ssr 的实际效果开销，差值是「后处理全部成本」而非税。
//
// 用法（诊断/按需，不挂 CI——需真实 WebGL 与活跃会话）：
//   const report = await runPostprocCostProbe();   // 结构化报告，自行决定展示

import { sceneInfraHost } from "@/preview-3d/adapters/shared-infra.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";

/** 双臂标识 */
export type ProbeArm = "composer" | "direct";

/** HalfFloatType + RGBA 的每像素字节数（2 字节/通道 × 4 通道） */
const HALF_FLOAT_RGBA_BYTES = 8;

/** 与 postprocessing-capability.ts 的 POSTPROC_MSAA_SAMPLES 对齐（不反向 import：cap 属上层） */
const DEFAULT_MSAA_SAMPLES = 4;

/** 默认每臂采样帧数（交替，故墙钟约 2×N 帧） */
const DEFAULT_FRAMES_PER_ARM = 60;
/** 预热帧数（管线/着色器/JIT 稳定前不计入） */
const DEFAULT_WARMUP = 10;
/** 同时在飞的 GPU query 上限（防无限堆积；超出则该帧不采 GPU 时间） */
const MAX_INFLIGHT_QUERIES = 8;
/** 收尾时轮询未完成 query 的最大帧数 */
const DRAIN_MAX_FRAMES = 30;

/** 单臂统计 */
export interface ArmStats {
  arm: ProbeArm;
  /** 计入的帧数（GPU 与 CPU 样本数可能不等：timer query 可能不可用/被丢弃） */
  n: number;
  /** CPU 提交耗时中位数（ms） */
  submitMedianMs: number;
  submitP95Ms: number;
  /** GPU 耗时中位数（ms）；timer query 不可用时为 null */
  gpuMedianMs: number | null;
  gpuP95Ms: number | null;
}

/** 探针报告（结构化，供环形日志/AI 直读） */
export interface PostprocProbeReport {
  /** 采样时后处理启用意图 */
  ppEnabled: boolean;
  /** 本报告的 A−B 差能否解读为「composer 常驻税」（= !ppEnabled） */
  taxMeaningful: boolean;
  canvas: {
    logicalW: number;
    logicalH: number;
    pixelRatio: number;
    bufferW: number;
    bufferH: number;
  };
  /** MSAA 采样数（按 renderer 是否拿到 antialias 推定；0 = 未授予） */
  msaaSamples: number;
  /** 单个 RT 字节数（上界估算：samples 倍存储由驱动决定） */
  rtBytesSingle: number;
  /** 读+写双缓冲字节数 */
  rtBytesBoth: number;
  gpuTimingAvailable: boolean;
  arms: { composer: ArmStats; direct: ArmStats };
  /** composer 臂中**真正走了 composer** 的帧数（ADR-299 惰性常驻后，关闭态为 0） */
  composerArmFrames: number;
  /** composer 臂相对 direct 臂的每帧 GPU 增量（ms）；不可用时 null */
  extraGpuMsPerFrame: number | null;
  /** 增量占比（%）；不可用时 null */
  extraPct: number | null;
  note: string;
}

/* -------- 纯函数段（零 WebGL 依赖，可单测）-------- */

/** 中位数（空数组 → 0） */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** 百分位（p ∈ (0,1]；空数组 → 0）。最近秩取整——样本量 ~60，插值是伪精度 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx] as number;
}

/**
 * 估算 composer 单个读/写缓冲的字节数。
 *
 * `samples` 按倍数计入——WebGL 的 multisample renderbuffer 是否真的按 samples 倍占显存
 * 由驱动决定，故本值是**上界**而非精确驻留量；用于「数量级」判断足够。
 */
export function estimateComposerRtBytes(o: {
  bufferW: number;
  bufferH: number;
  samples?: number;
  bytesPerPixel?: number;
}): number {
  const bpp = o.bytesPerPixel ?? HALF_FLOAT_RGBA_BYTES;
  const samples = Math.max(1, Math.floor(o.samples ?? 0));
  const w = Math.max(0, Math.floor(o.bufferW));
  const h = Math.max(0, Math.floor(o.bufferH));
  return Math.round(w * h * bpp * samples);
}

/** 组装单臂统计（GPU 样本缺失 → null，绝不用 CPU 值顶替） */
export function summarizeArm(
  arm: ProbeArm,
  submits: readonly number[],
  gpus: readonly number[],
): ArmStats {
  return {
    arm,
    n: submits.length,
    submitMedianMs: median(submits),
    submitP95Ms: percentile(submits, 0.95),
    gpuMedianMs: gpus.length > 0 ? median(gpus) : null,
    gpuP95Ms: gpus.length > 0 ? percentile(gpus, 0.95) : null,
  };
}

/* -------- GPU 计时（EXT_disjoint_timer_query_webgl2）-------- */

interface InflightQuery {
  q: WebGLQuery;
  arm: ProbeArm;
  /** 是否计入统计（预热帧为 false） */
  count: boolean;
}

interface GpuTimer {
  readonly available: boolean;
  begin(): void;
  end(arm: ProbeArm, count: boolean): void;
  /** 取回已完成的 query（毫秒），并释放 query 对象 */
  poll(): Array<{ arm: ProbeArm; count: boolean; ms: number }>;
  pending(): number;
}

/**
 * 构造 GPU 计时器。WebGL1 / 扩展缺席 / 创建 query 失败一律降级为 `available=false`
 * ——此时 `poll()` 恒返回空，上层据此把 gpuMs 记为 null。
 */
function createGpuTimer(gl: WebGL2RenderingContext | null): GpuTimer {
  const ext = gl?.getExtension("EXT_disjoint_timer_query_webgl2") as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT?: number }
    | null
    | undefined;
  if (!gl || !ext) {
    return { available: false, begin: () => {}, end: () => {}, poll: () => [], pending: () => 0 };
  }
  const inflight: InflightQuery[] = [];
  let active: WebGLQuery | null = null;

  return {
    available: true,
    begin(): void {
      if (active || inflight.length >= MAX_INFLIGHT_QUERIES) return;
      const q = gl.createQuery();
      if (!q) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = q;
    },
    end(arm: ProbeArm, count: boolean): void {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      inflight.push({ q: active, arm, count });
      active = null;
    },
    poll(): Array<{ arm: ProbeArm; count: boolean; ms: number }> {
      const out: Array<{ arm: ProbeArm; count: boolean; ms: number }> = [];
      // GPU 中断（disjoint）期间的时间戳不可信：整批丢弃，不产出假数字
      if (ext.GPU_DISJOINT_EXT !== undefined && gl.getParameter(ext.GPU_DISJOINT_EXT) === true) {
        for (const it of inflight) gl.deleteQuery(it.q);
        inflight.length = 0;
        return out;
      }
      for (let i = inflight.length - 1; i >= 0; i--) {
        const it = inflight[i] as InflightQuery;
        if (gl.getQueryParameter(it.q, gl.QUERY_RESULT_AVAILABLE) !== true) continue;
        const ns = gl.getQueryParameter(it.q, gl.QUERY_RESULT) as number;
        gl.deleteQuery(it.q);
        inflight.splice(i, 1);
        if (it.count) out.push({ arm: it.arm, count: true, ms: ns / 1e6 });
      }
      return out;
    },
    pending(): number {
      return inflight.length;
    },
  };
}

/* -------- 探针主体 -------- */

export interface PostprocProbeOptions {
  /** 每臂采样帧数（默认 60） */
  framesPerArm?: number;
  /** 预热帧数（默认 10） */
  warmup?: number;
  /** 交替渲染用的固定 dt（默认 1/60；固定值是刻意的两臂等速） */
  dt?: number;
}

const nextFrame = (): Promise<void> =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/** 导出供单测：note 是判读口径的唯一出口，措辞错了会直接误导决策 */
export function buildNote(report: Omit<PostprocProbeReport, "note">): string {
  if (!report.taxMeaningful) {
    return "ppEnabled=true：A−B 差是「后处理全部成本」（含 bloom/ssao/ssr 实效果），非常驻税；要量税请先关闭后处理再跑。";
  }
  // [ADR-299] 惰性常驻后，关闭态 composer 根本不参与渲染：两臂同路径，A−B 差应为噪声。
  // 这本身就是「常驻税已归零」的证据，而不是「测不到」——需与「样本不足」区分开。
  if (report.composerArmFrames === 0) {
    const per = report.extraGpuMsPerFrame;
    const diff = per === null ? "n/a" : `${per.toFixed(2)}ms`;
    return `关闭态 composer 未参与任何采样帧（ADR-299 惰性常驻生效）：两臂同走直渲，A−B 差 ${diff} 应为噪声量级——常驻税已归零、读写缓冲也未分配。要量启用态成本请打开后处理再跑。`;
  }
  if (!report.gpuTimingAvailable) {
    return "本机无 EXT_disjoint_timer_query_webgl2：GPU 时间不可测，仅 submitMs（CPU，含主循环干扰）与 rtBytes 可用，勿据 submitMs 判决。";
  }
  const per = report.extraGpuMsPerFrame;
  if (per === null) return "样本不足：GPU query 未回收到结果，请增大 framesPerArm 重跑。";
  return `关闭后处理时，composer 常驻每帧多耗 ${per.toFixed(2)}ms GPU（约 ${(report.extraPct ?? 0).toFixed(1)}%），另常驻 ${(report.rtBytesBoth / 1048576).toFixed(1)}MB 读写缓冲。`;
}

/**
 * 跑一次 A/B 成本探针。
 *
 * 返回 null 表示**环境不具备**（无活跃 scene/camera/renderer），不是「测得 0」。
 *
 * 副作用：探针期间每帧额外渲染一次（主循环照常渲染，故该时段帧率下降/画面重复绘制）
 * ——约 2×(warmup + framesPerArm) 帧后自动结束，不修改任何生产状态。
 */
export async function runPostprocCostProbe(
  opts: PostprocProbeOptions = {},
): Promise<PostprocProbeReport | null> {
  const scene = sceneInfraHost.scene;
  const camera = sceneInfraHost.camera;
  const renderer = sceneInfraHost.renderer;
  if (!scene || !camera || !renderer) return null;

  const framesPerArm = Math.max(1, Math.floor(opts.framesPerArm ?? DEFAULT_FRAMES_PER_ARM));
  const warmup = Math.max(0, Math.floor(opts.warmup ?? DEFAULT_WARMUP));
  const dt = opts.dt ?? 1 / 60;

  const postProc = sceneCapabilityRegistry.getById("postprocessing");
  const lightCap = sceneCapabilityRegistry.getById("light") ?? null;
  const ppEnabled = typeof postProc?.isEnabled === "function" ? postProc.isEnabled() : false;

  const canvas = renderer.domElement;
  const pixelRatio = renderer.getPixelRatio();
  const bufferW = canvas.width;
  const bufferH = canvas.height;
  const antialiasGranted = renderer.getContext()?.getContextAttributes?.()?.antialias === true;
  const msaaSamples = antialiasGranted ? DEFAULT_MSAA_SAMPLES : 0;

  const gl = renderer.getContext() as WebGL2RenderingContext | null;
  const timer = createGpuTimer(gl);
  const submits: Record<ProbeArm, number[]> = { composer: [], direct: [] };
  const gpus: Record<ProbeArm, number[]> = { composer: [], direct: [] };

  const collect = (): void => {
    for (const r of timer.poll()) gpus[r.arm].push(r.ms);
  };

  const total = warmup + framesPerArm * 2;
  let composerArmFrames = 0;
  for (let i = 0; i < total; i++) {
    await nextFrame();
    // 交替：奇偶分工，两臂共享同一段墙钟（抵消热漂移/降频）
    const arm: ProbeArm = i % 2 === 0 ? "composer" : "direct";
    const count = i >= warmup;
    timer.begin();
    const t0 = performance.now();
    // [ADR-299] 与 render-host 同款语义：`render()` 返回 false = 该帧没画（惰性常驻后
    // 关闭态 composer 不存在），必须补直渲——否则 composer 臂测的是「什么都没渲染」的
    // 空帧，A−B 差会变成负的垃圾数字。走通 composer 的帧另作计数，供报告自证。
    const renderedByComposer = arm === "composer" && !!postProc && postProc.render(dt, lightCap);
    if (!renderedByComposer) renderer.render(scene, camera);
    else composerArmFrames++;
    const submitMs = performance.now() - t0;
    timer.end(arm, count);
    collect();
    if (count) submits[arm].push(submitMs);
  }
  // 收尾：等未完成的 query 落地（GPU 异步，最后一帧的结果总要晚几帧）
  for (let k = 0; k < DRAIN_MAX_FRAMES && timer.pending() > 0; k++) {
    await nextFrame();
    collect();
  }

  const composer = summarizeArm("composer", submits.composer, gpus.composer);
  const direct = summarizeArm("direct", submits.direct, gpus.direct);
  const hasGpu = composer.gpuMedianMs !== null && direct.gpuMedianMs !== null;
  const extraGpuMsPerFrame = hasGpu
    ? (composer.gpuMedianMs as number) - (direct.gpuMedianMs as number)
    : null;
  const extraPct =
    hasGpu && (direct.gpuMedianMs as number) > 0
      ? ((extraGpuMsPerFrame as number) / (direct.gpuMedianMs as number)) * 100
      : null;
  const rtBytesSingle = estimateComposerRtBytes({ bufferW, bufferH, samples: msaaSamples });

  const base: Omit<PostprocProbeReport, "note"> = {
    ppEnabled,
    taxMeaningful: !ppEnabled,
    canvas: {
      logicalW: Math.round(bufferW / (pixelRatio || 1)),
      logicalH: Math.round(bufferH / (pixelRatio || 1)),
      pixelRatio,
      bufferW,
      bufferH,
    },
    msaaSamples,
    rtBytesSingle,
    rtBytesBoth: rtBytesSingle * 2,
    gpuTimingAvailable: hasGpu,
    arms: { composer, direct },
    composerArmFrames,
    extraGpuMsPerFrame,
    extraPct,
  };
  const report: PostprocProbeReport = { ...base, note: buildNote(base) };
  logWarn(
    "postproc-probe",
    `[composer vs direct] gpu ${composer.gpuMedianMs?.toFixed(2) ?? "n/a"} vs ${direct.gpuMedianMs?.toFixed(2) ?? "n/a"} ms | submit ${composer.submitMedianMs.toFixed(2)} vs ${direct.submitMedianMs.toFixed(2)} ms | rt ${(report.rtBytesBoth / 1048576).toFixed(1)}MB | ${report.note}`,
  );
  return report;
}
