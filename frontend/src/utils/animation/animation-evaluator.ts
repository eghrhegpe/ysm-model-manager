/**
 * 基岩版动画求值器（ADR-212 自 animation.ts 拆出）
 * 职责：Clip + time → BoneTransform（插值求值、timeline 执行、标签策略）。
 * 消费方：ysm-animation-player（唯一生产消费者）。
 *
 * 与 animation.ts（解析器）的边界：
 *   animation.ts：JSON → AnimationClip（解析，~530 行）
 *   animation-evaluator.ts：Clip + time → BoneTransform（求值，~190 行）
 */

import type { AnimationClip, BoneTransform, Keyframe, TimelineEvent, Vec3 } from "./animation.ts";
import { BONE_CHANNELS } from "./animation.ts";

/**
 * L4：解析帧的 Molang 动态轴（anim_time = 求值时间 t）；无动态轴原样返回数字基底。
 * @param out 可选输出缓冲区——热路径调用方预分配复用，避免每帧每骨骼每通道分配。
 */
function resolveFramePost(kf: Keyframe, t: number, out?: Vec3): Vec3 {
  const fns = kf.postMolang;
  const base = kf.post || [0, 0, 0];
  if (!fns) return base;
  const o = out || [0, 0, 0];
  o[0] = fns[0] ? fns[0](t) : base[0];
  o[1] = fns[1] ? fns[1](t) : base[1];
  o[2] = fns[2] ? fns[2](t) : base[2];
  return o;
}

/**
 * uniform Catmull-Rom 三次样条采样（Hermite 等价形式，C1 连续）。
 * 经过两端控制点 p1/p2，切点由相邻点决定：m0=(p2-p0)/2、m1=(p3-p1)/2。
 * s∈[0,1] 为区间内的归一化位置（沿用 Bedrock/常见 loader 的按索引参数化口径）。
 * 逐轴计算，避免中间分配。
 * @param out 可选输出缓冲区——热路径调用方预分配复用，避免每帧分配。
 */
function sampleCatmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, s: number, out?: Vec3): Vec3 {
  const s2 = s * s;
  const s3 = s2 * s;
  const o = out || [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    // 切点逐轴计算，不分配 m0/m1 中间数组
    const m0 = (p2[a] - p0[a]) / 2;
    const m1 = (p3[a] - p1[a]) / 2;
    o[a] =
      (2 * p1[a] - 2 * p2[a] + m0 + m1) * s3 +
      (-3 * p1[a] + 3 * p2[a] - 2 * m0 - m1) * s2 +
      m0 * s +
      p1[a];
  }
  return o;
}

function findKeyframeLowerIndex(keyframes: Keyframe[], t: number): number {
  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * 在指定时间 t 对一组关键帧求值
 * @param keyframes 排序后的关键帧数组
 * @param t 时间（秒，即 Molang 上下文的 query.anim_time）
 * @returns 插值后的值 [x,y,z] | null
 */
export function evaluateKeyframes(keyframes: Keyframe[], t: number): Vec3 | null {
  if (!keyframes?.length) return null;
  // NaN 守卫：非法时间直接返回首帧（防御调用方传 NaN/Infinity；
  // NaN 无法喂 Molang，取数字基底）
  if (!Number.isFinite(t)) return [...(keyframes[0].post || [0, 0, 0])];

  // 局部分配 scratch buffer（避免模块级可变状态导致 Molang 重入时缓冲区被覆盖）
  const sp0: Vec3 = [0, 0, 0];
  const sp1: Vec3 = [0, 0, 0];
  const sp2: Vec3 = [0, 0, 0];
  const sp3: Vec3 = [0, 0, 0];
  const scat: Vec3 = [0, 0, 0];

  // 超出范围（Molang 轴仍按当前 t 求值，对齐 Bedrock q.anim_time 语义）
  if (t <= keyframes[0].time) return [...resolveFramePost(keyframes[0], t, sp0)];
  if (t >= keyframes[keyframes.length - 1].time)
    return [...resolveFramePost(keyframes[keyframes.length - 1], t, sp0)];

  const lo = findKeyframeLowerIndex(keyframes, t);
  const hi = lo + 1;

  const a = keyframes[lo];
  const b = keyframes[hi];

  // step 插值：直接返回当前帧的 post 值
  if (a.lerp === "step") return [...resolveFramePost(a, t, sp0)];

  const dt = b.time - a.time;
  if (dt <= 0) return [...resolveFramePost(a, t, sp0)];
  const frac = (t - a.time) / dt;

  // catmullrom：取前后各一邻帧做 C1 三次样条（标准 uniform Catmull-Rom）。
  if (a.lerp === "catmullrom") {
    const p0 = resolveFramePost(keyframes[Math.max(0, lo - 1)], t, sp0);
    const p1 = resolveFramePost(a, t, sp1);
    const p2 = resolveFramePost(b, t, sp2);
    const p3 = resolveFramePost(keyframes[Math.min(keyframes.length - 1, hi + 1)], t, sp3);
    return [...sampleCatmullRom(p0, p1, p2, p3, frac, scat)];
  }

  // 线性插值（端点先 Molang 求值再 lerp，对齐 GeckoLib/ModernYSM 口径）
  const ap = resolveFramePost(a, t, sp0);
  const bp = resolveFramePost(b, t, sp1);
  return [
    ap[0] + (bp[0] - ap[0]) * frac,
    ap[1] + (bp[1] - ap[1]) * frac,
    ap[2] + (bp[2] - ap[2]) * frac,
  ];
}

/**
 * 执行 timeline 事件：找出 [prevTime, currentTime] 区间内触发的事件并执行。
 * 用于动画播放器每帧调用，实现 v.* 变量赋值和粒子触发等。
 * @param timeline 排序后的 timeline 事件列表
 * @param prevTime 上一帧时间
 * @param currentTime 当前时间
 * @returns 本次触发的事件原始表达式列表（调试/日志用）
 */
export function executeTimeline(
  timeline: TimelineEvent[] | undefined,
  prevTime: number,
  currentTime: number,
): string[][] | null {
  if (!timeline?.length) return null;
  const fired: string[][] = [];
  // 循环回绕（prevTime > currentTime）：拆成两段扫描 [prevTime, length) 和 [0, currentTime]
  const wrapped = prevTime > currentTime;
  // 找到第一个 > prevTime 的事件索引
  let start = 0;
  while (start < timeline.length && timeline[start].time <= prevTime) {
    start++;
  }
  // 第一段扫描：从 start 到末尾（回绕时扫 [prevTime, length)，非回绕时扫到 currentTime）
  for (let i = start; i < timeline.length; i++) {
    const ev = timeline[i];
    if (!wrapped && ev.time > currentTime) break;
    for (const fn of ev.actions) {
      fn(currentTime); // anim_time = 当前时间
    }
    fired.push(ev.raw);
  }
  // 回绕第二段扫描：从 0 到 currentTime
  if (wrapped) {
    for (let i = 0; i < timeline.length; i++) {
      const ev = timeline[i];
      if (ev.time > currentTime) break;
      for (const fn of ev.actions) {
        fn(currentTime);
      }
      fired.push(ev.raw);
    }
  }
  return fired.length > 0 ? fired : null;
}

/**
 * 对整个动画 clip 在指定时间求值，返回各骨骼的局部变换。
 * @param clip 动画剪辑
 * @param time 当前时间（秒）
 * @returns 骨骼名 → 局部变换 Map
 */
export function evaluateClip(clip: AnimationClip, time: number): Map<string, BoneTransform> {
  const result = new Map<string, BoneTransform>();
  if (!clip?.bones) return result;

  let t = time;
  if (clip.loop && clip.length > 0) {
    t = ((t % clip.length) + clip.length) % clip.length;
  } else if (t > clip.length) {
    t = clip.length;
  }

  for (const [boneName, channels] of Object.entries(clip.bones)) {
    const transform: BoneTransform = {};
    for (const ch of BONE_CHANNELS) {
      const val = evaluateKeyframes(channels[ch] ?? [], t);
      if (val) transform[ch] = val;
    }
    if (Object.keys(transform).length > 0) {
      result.set(boneName, transform);
    }
  }

  return result;
}

/**
 * YSM 动画 clip 播放列表标签策略（ADR-100 L3 全 clip 列表）。
 * 单 clip 文件保持文件名口径（不改动既有展示）；多 clip 文件以
 * 「文件名 · clip 名」区分，无名 clip 用序号兜底。
 * @param fileBase 动画文件基名（已去 .animation.json 后缀）
 * @param clips    该文件解析出的全部 clip
 */
export function ysmAnimClipLabels(fileBase: string, clips: AnimationClip[]): string[] {
  if (clips.length <= 1) return [fileBase];
  return clips.map((clip, i) => `${fileBase} · ${clip.name || `#${i + 1}`}`);
}
