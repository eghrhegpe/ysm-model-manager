/**
 * 基岩版动画 JSON 解析 + 插值引擎（类型化版 — ADR-014 P2 大件收尾）
 * YSM 使用标准基岩版格式；Molang 表达式经 molangjs 编译为求值闭包（ADR-100 L4，
 * 编译失败零占位降级），求值时机在 evaluateKeyframes（anim_time = 求值时间 t）。
 */

import { compileMolang, type MolangFn } from "./molang.ts";
import { logWarn } from "../core/log.ts";

// ── 类型定义 ────────────────────────────────────────

/** 三维向量 [x, y, z] */
export type Vec3 = [number, number, number];

/** Molang 轴三元组（null = 该轴为纯数字，取 Keyframe 对应轴值） */
export type MolangAxes = [MolangFn | null, MolangFn | null, MolangFn | null];

/** 关键帧 */
export interface Keyframe {
  time: number;
  post: Vec3;
  pre: Vec3;
  lerp: "linear" | "step" | "catmullrom";
  /** Molang 动态轴（L4）：非 null 轴在求值时以 anim_time 上下文覆盖 post/pre 对应轴 */
  postMolang?: MolangAxes;
  preMolang?: MolangAxes;
}

/** 单骨骼三通道 */
export interface BoneChannels {
  rotation?: Keyframe[];
  position?: Keyframe[];
  scale?: Keyframe[];
}

/** 动画剪辑 */
/** Timeline 事件：时间戳 → Molang 表达式（字符串或字符串数组） */
export interface TimelineEvent {
  time: number;
  /** 编译后的 Molang 求值闭包列表（多语句按序执行） */
  actions: MolangFn[];
  /** 原始表达式（调试用） */
  raw: string[];
}

export interface AnimationClip {
  name: string;
  loop: boolean;
  length: number;
  bones: Record<string, BoneChannels>;
  hasMolang?: boolean;
  /** Timeline 事件（时间戳 → Molang 动作列表） */
  timeline?: TimelineEvent[];
}

/** 骨骼变换（evaluateClip 结果值） */
export interface BoneTransform {
  rotation?: Vec3 | undefined;
  position?: Vec3 | undefined;
  scale?: Vec3 | undefined;
}

/** 骨骼动画三通道名单点（收敛 4 处字面量重复，防通道名拼写漂移） */
const BONE_CHANNELS = ["rotation", "position", "scale"] as const;

/** 骨骼层级节点 */
export interface BoneHierarchyNode {
  name: string;
  parent?: string | null;
}

/** 原始关键帧对象（JSON 形态） */
interface RawKeyframeObject {
  post?: unknown;
  pre?: unknown;
  lerp_mode?: string;
}

// ── 工具函数 ────────────────────────────────────────

/**
 * Molang 常量折叠：尝试从 Molang 字符串中提取纯数字。
 * 处理 "q.life_time * 0 + 30" → 30, "math.sin(0) * 0 + 45" → 45
 * 只处理「变量乘 0 后加减常数」的窄模式，含真实变量时返回 null。
 *
 * ⚠️ 勿扩展正则覆盖面：bench 实证（bench-fold-molang.ts，2026-09-01）
 * 折叠 ~578ns vs compileMolang ~625ns，收益 ≈ 0；molangjs parse 本身便宜，
 * 折叠无敌人可打，扩展正则只会徒增维护成本。
 * 保留理由仅剩「跳过闭包创建」；未来重构解析链时整体移除，由 compileMolang 统一承接。
 * 详见 docs/knowledge/animation-system.md
 *
 * 导出供 bench 实证编译开销（bench-fold-molang.ts），解析链外勿调用。
 */
export function foldMolangConstant(str: unknown): number | null {
  if (typeof str !== "string") return null;
  // 尝试直接解析为数字
  const direct = Number(str);
  if (!isNaN(direct)) return direct;
  // 检查是否完全是纯数字（含负号、小数点）
  if (/^-?\d+(\.\d+)?$/.test(str.trim())) return Number(str.trim());
  // 模式1: "q.* 0 + NUM" 或 "q.* 0 - NUM"
  let m = str.match(
    /^(?:q\.|t\.|query\.|temp\.|math\.)\w+\s*\*\s*0\s*([+-])\s*([+-]?\d+(?:\.\d+)?)$/,
  );
  if (m) {
    const num = Number(m[2]);
    return m[1] === "-" ? -num : num;
  }
  // 模式2: "NUM + q.* 0" 或 "NUM - q.* 0"
  m = str.match(
    /^([+-]?\d+(?:\.\d+)?)\s*[+-]\s*(?:q\.|t\.|query\.|temp\.|math\.)\w+\s*\*\s*0$/,
  );
  if (m) return Number(m[1]);
  // 模式3: "q.* 0" → 0
  if (/^(?:q\.|t\.|query\.|temp\.|math\.)\w+\s*\*\s*0$/.test(str.trim()))
    return 0;
  return null;
}

/** 关键帧值解析结果：数字基底 + 可选 Molang 动态轴（求值时覆盖对应轴） */
interface ParsedKeyValue {
  vec: Vec3;
  molang?: MolangAxes | undefined;
}

/** 解析单个轴值：数字直取；字符串先常量折叠，折不动则 Molang 编译（失败零占位） */
function parseAxisItem(item: unknown): { num: number; fn: MolangFn | null } {
  if (typeof item === "number") {
    return { num: Number.isFinite(item) ? item : 0, fn: null };
  }
  if (typeof item === "string") {
    const folded = foldMolangConstant(item);
    // L4：foldMolangConstant 对 "1e999" 等科学计数法返回 Infinity，需继续守卫
    if (folded !== null && Number.isFinite(folded)) return { num: folded, fn: null };
    const fn = compileMolang(item);
    return { num: 0, fn };
  }
  const n = Number(item);
  return { num: Number.isFinite(n) ? n : 0, fn: null };
}

/** 尝试将关键帧值解析为 [x,y,z] 数字基底 + 可选 Molang 轴 */
function parseKeyValue(v: unknown): ParsedKeyValue | null {
  if (Array.isArray(v) && v.length === 3) {
    const items = v.map(parseAxisItem);
    const vec = [items[0].num, items[1].num, items[2].num] as Vec3;
    const fns: MolangAxes = [items[0].fn, items[1].fn, items[2].fn];
    // P1 修复（反推审核）：isNaN 不挡 Infinity（isNaN(Infinity)=false）——Infinity
    // 轴值穿透后插值输出 NaN 传播渲染层；统一 Number.isFinite（parseAxisItem 已守卫）
    return { vec, molang: fns.some(Boolean) ? fns : undefined };
  }
  if (typeof v === "number") {
    // P1 修复（反推审核）：单一数值同样挡 Infinity/NaN
    return Number.isFinite(v) ? { vec: [v, v, v] } : null;
  }
  if (typeof v === "string") {
    const folded = foldMolangConstant(v);
    if (folded !== null) return { vec: [folded, folded, folded] };
    // L4：标量 Molang 字符串 → 三轴同式编译（旧口径整帧丢弃；编译失败零占位保留帧）
    const fn = compileMolang(v);
    return { vec: [0, 0, 0], molang: fn ? [fn, fn, fn] : undefined };
  }
  return null;
}

/** 从关键帧对象解析 {post, pre, lerp_mode}（L4：附带 Molang 动态轴） */
function extractKeyframe(kv: unknown): {
  post: Vec3;
  pre: Vec3;
  lerp: "linear" | "step" | "catmullrom";
  postMolang?: MolangAxes | undefined;
  preMolang?: MolangAxes | undefined;
} | null {
  if (kv === null || kv === undefined) return null;
  if (Array.isArray(kv)) {
    const val = parseKeyValue(kv);
    if (!val) return null;
    return { post: val.vec, pre: val.vec, lerp: "linear", postMolang: val.molang, preMolang: val.molang };
  }
  if (typeof kv === "object") {
    const obj = kv as RawKeyframeObject;
    // P3 修复（反推审核）：obj.post 为 0/空串等假值时原 `? :` 误判为缺省——
    // 显式 null/undefined 判断（边界对称，ADR-044 ③）
    const post = obj.post != null ? parseKeyValue(obj.post) : null;
    const pre = obj.pre != null ? parseKeyValue(obj.pre) : post;
    if (!post) return null;
    // lerp_mode 合法值 linear/step/catmullrom；非 step/catmullrom 一律按 linear
    const lerp: "linear" | "step" | "catmullrom" =
      obj.lerp_mode === "step"
        ? "step"
        : obj.lerp_mode === "catmullrom"
          ? "catmullrom"
          : "linear";
    const preVal = pre ?? post;
    return { post: post.vec, pre: preVal.vec, lerp, postMolang: post.molang, preMolang: preVal.molang };
  }
  // L4：标量字符串（Molang/可折叠常量）改道 parseKeyValue（旧口径落入 Number() 被整帧丢弃）
  if (typeof kv === "string") {
    const val = parseKeyValue(kv);
    if (!val) return null;
    return { post: val.vec, pre: val.vec, lerp: "linear", postMolang: val.molang, preMolang: val.molang };
  }
  // 单数值
  const n = Number(kv);
  // P2 修复（审核，NaN/Infinity 守卫）：原仅 isNaN——Infinity/±Inf 通过后
  // 插值输出 NaN 传播到渲染层（相机/骨骼变换 NaN 冻结）
  if (!Number.isFinite(n)) return null;
  return { post: [n, n, n], pre: [n, n, n], lerp: "linear" };
}

/** 度→弧度系数（旋转通道换算专用） */
const DEG2RAD = Math.PI / 180;

/**
 * 旋转通道口径换算：度→弧度，X/Y 取负、Z 不取负。
 * 对齐上游 ModernYSM/TLM 共同口径 RawBoneKeyFrame.init + RotationValue.convert
 * （toRadians(x)*-1 / toRadians(y)*-1 / toRadians(z)*+1）。此前缺失导致 bedrock
 * 的「度」被当「弧度」直喂 Euler（45°→2578°），是角色预览乱飞的根因。
 * 数字基底直接换算；Molang 动态轴包一层求值后换算闭包——molang 三角函数按度求值，
 * 与上游 RotationValue 包裹 IValue 求值结果再 convert 同构。放解析层而非播放层：
 * evaluateClip 非 localOnly 分支跨骨骼累加旋转角，须保证整个求值域统一在弧度制。
 */
function convertRotationKeyframes(kfs: Keyframe[]): Keyframe[] {
  // 归一化 -0→+0：取负零值轴产出 -0，下游 toEqual 快照/序列化按 Object.is 判不等
  const norm = (n: number): number => (n === 0 ? 0 : n);
  const convVec = (v: Vec3): Vec3 => [
    norm(-v[0] * DEG2RAD),
    norm(-v[1] * DEG2RAD),
    norm(v[2] * DEG2RAD),
  ];
  const wrapFn = (fn: MolangFn | null, sign: -1 | 1): MolangFn | null =>
    fn ? (t: number) => norm(sign * fn(t) * DEG2RAD) : null;
  return kfs.map((kf) => {
    const out: Keyframe = { ...kf, post: convVec(kf.post), pre: convVec(kf.pre) };
    if (kf.postMolang) {
      out.postMolang = [
        wrapFn(kf.postMolang[0], -1),
        wrapFn(kf.postMolang[1], -1),
        wrapFn(kf.postMolang[2], 1),
      ];
    }
    if (kf.preMolang) {
      out.preMolang = [
        wrapFn(kf.preMolang[0], -1),
        wrapFn(kf.preMolang[1], -1),
        wrapFn(kf.preMolang[2], 1),
      ];
    }
    return out;
  });
}

/** 解析单个 channel（rotation/position/scale）的数据 */
function parseChannel(channelData: unknown): Keyframe[] {
  if (!channelData || typeof channelData !== "object") return [];
  // P4 修复（审核）：原实现 `Object.keys().map(Number)` 后拿数字下标回查
  // `channelData[t]`——JS 数字下标会转回规范字符串，非规范时间键（"0.0"/"1.50"）
  // 查不到对应 key 而整帧静默丢失；改为 entries 配对，时间值直接携带原始 raw。
  // 重复数值时间（"0" 与 "0.0"）去重保留排序后首个，与原「仅规范键生效」契约一致。
  const seen = new Set<number>();
  return Object.entries(channelData as Record<string, unknown>)
    .map(([k, raw]) => [Number(k), raw] as const)
    // P2 修复（审核，NaN/Infinity 守卫）：原仅 !isNaN——Infinity 时间键通过后
    // 排序/插值区间异常（dt=Infinity → frac=0 恒等）；统一 Number.isFinite
    .filter(([t]) => Number.isFinite(t))
    .sort(([a], [b]) => a - b)
    .filter(([t]) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .map(([t, raw]) => {
      const kf = extractKeyframe(raw);
      if (!kf) return null;
      const out: Keyframe = { time: t, post: kf.post, pre: kf.pre, lerp: kf.lerp };
      if (kf.postMolang) out.postMolang = kf.postMolang;
      if (kf.preMolang) out.preMolang = kf.preMolang;
      return out;
    })
    .filter((k): k is Keyframe => Boolean(k));
}

/** 检测 channel 原始数据中是否含 Molang 表达式（字符串值） */
function hasMolangInChannelData(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  for (const val of Object.values(data)) {
    // 直接字符串: "q.life_time * 10"
    if (typeof val === "string") return true;
    // 数组: ["q.life_time * 10", 0, 0]
    if (Array.isArray(val) && val.some((v) => typeof v === "string"))
      return true;
    // 对象: { post: [...], pre: [...], lerp_mode: "linear" }
    if (typeof val === "object" && val !== null) {
      const obj = val as RawKeyframeObject;
      for (const key of ["post", "pre"] as const) {
        const v = obj[key];
        if (typeof v === "string") return true;
        if (Array.isArray(v) && v.some((x) => typeof x === "string"))
          return true;
      }
    }
  }
  return false;
}

// ===================================================================
// parseBedrockAnimationJSON — 子函数
// ===================================================================

/** 动画 JSON 原始根形态（仅做类型收窄，不做校验） */
type RawAnimRoot = { animations?: Record<string, unknown> };

/** 单条动画条目原始形态（bones/timeline 为 unknown，待下游收窄） */
type RawAnimEntry = {
  loop?: boolean | string;
  animation_length?: number;
  bones?: Record<string, unknown>;
  timeline?: Record<string, unknown>;
};

/**
 * [子函数 1/5] 解析并校验 JSON 根：非法 JSON / 缺失 animations 字段立即报错返回。
 * 成功时返回窄化后的 animations 映射表（非空）。
 */
function parseAndValidateAnimRoot(jsonStr: string): {
  anims: Record<string, unknown> | null;
  errors: string[];
} {
  try {
    const root = JSON.parse(jsonStr) as RawAnimRoot;
    const anims = root?.animations;
    if (!anims || typeof anims !== "object") {
      return { anims: null, errors: ["缺少 animations 字段"] };
    }
    return { anims, errors: [] };
  } catch (e) {
    return { anims: null, errors: [`JSON 解析失败: ${(e as Error).message}`] };
  }
}

/**
 * [子函数 2/5] 构造 Clip 基础骨架（name / loop / length / 空 bones），并判定是否可继续解析。
 * 返回 { clip, hasTimeline, bones }：可继续 = bones 存在为对象 或 timeline 存在。
 */
function buildAnimClipSkeleton(
  name: string,
  animObj: RawAnimEntry
): { clip: AnimationClip; bones: Record<string, unknown> | null; hasTimeline: boolean } | null {
  const bones = animObj.bones && typeof animObj.bones === "object" ? (animObj.bones as Record<string, unknown>) : null;
  const hasTimeline = !!animObj.timeline && typeof animObj.timeline === "object";
  if (!bones && !hasTimeline) return null;

  const clip: AnimationClip = {
    name,
    loop: animObj.loop === true || animObj.loop === "true",
    length: animObj.animation_length || 0,
    bones: {},
    hasMolang: false, // 下游 Bone/Timeline 阶段发现 Molang 再置位
  };
  return { clip, bones, hasTimeline };
}

/**
 * [子函数 3/5] 解析单 Clip 的全部 Bone 通道：写入 clip.bones，必要时标记 clip.hasMolang。
 * 旋转通道出口统一换算（度→弧度 + X/Y 取负），下游全弧度域。
 */
function parseClipBones(
  clip: AnimationClip,
  bones: Record<string, unknown> | null
): void {
  if (!bones) return;
  for (const [boneName, boneData] of Object.entries(bones)) {
    if (!boneData || typeof boneData !== "object") continue;
    const boneObj = boneData as Record<string, unknown>;

    // 检测 Molang：原始数据中是否含字符串值（非数字）
    if (!clip.hasMolang) {
      for (const ch of BONE_CHANNELS) {
        if (hasMolangInChannelData(boneObj[ch])) {
          clip.hasMolang = true;
          break;
        }
      }
    }

    const channels: BoneChannels = {};
    for (const ch of BONE_CHANNELS) {
      const kfs = parseChannel(boneObj[ch]);
      if (kfs.length > 0) {
        channels[ch] = ch === "rotation" ? convertRotationKeyframes(kfs) : kfs;
      }
    }

    if (Object.keys(channels).length > 0) {
      clip.bones[boneName] = channels;
    }
  }
}

/**
 * [子函数 4/5] 解析 timeline 事件：时间戳 → Molang 表达式收集 → 编译 → 排序。
 * 发现任一合法事件时写入 clip.timeline 并标记 clip.hasMolang。
 */
function parseClipTimeline(
  clip: AnimationClip,
  hasTimeline: boolean,
  animObj: RawAnimEntry
): void {
  if (!hasTimeline || !animObj.timeline) return;
  const timeline = animObj.timeline as Record<string, unknown>;
  const events: TimelineEvent[] = [];

  for (const [timeStr, actionRaw] of Object.entries(timeline)) {
    const t = Number(timeStr);
    if (!Number.isFinite(t)) continue;

    // 收集 Molang 表达式（字符串或字符串数组）
    const exprs: string[] = [];
    if (typeof actionRaw === "string") {
      exprs.push(actionRaw);
    } else if (Array.isArray(actionRaw)) {
      for (const item of actionRaw) {
        if (typeof item === "string") exprs.push(item);
      }
    }
    if (exprs.length === 0) continue;

    // 编译所有表达式（编译失败的静默跳过，对齐 Molang 零占位降级口径）
    const actions: MolangFn[] = [];
    for (const expr of exprs) {
      const fn = compileMolang(expr);
      if (fn) actions.push(fn);
    }
    if (actions.length > 0) {
      events.push({ time: t, actions, raw: exprs });
      clip.hasMolang = true;
    }
  }

  if (events.length > 0) {
    events.sort((a, b) => a.time - b.time);
    clip.timeline = events;
  }
}

/**
 * [子函数 5/5] 最终入队判定：有骨骼通道或有 timeline 才加入 clips。
 * 自动用最大关键帧时间补全 length（若 metadata 未提供长度）。
 */
function finalizeClipLengthAndEnqueue(clip: AnimationClip, clips: AnimationClip[]): void {
  if (Object.keys(clip.bones).length === 0 && !clip.timeline) return;

  // 计算实际长度（取最大关键帧时间 / timeline 时间）
  let maxT = 0;
  for (const chs of Object.values(clip.bones)) {
    for (const ch of BONE_CHANNELS) {
      const kfs = chs[ch];
      if (kfs?.length) {
        const last = kfs[kfs.length - 1];
        if (last.time > maxT) maxT = last.time;
      }
    }
  }
  if (clip.timeline?.length) {
    const lastEvent = clip.timeline[clip.timeline.length - 1];
    if (lastEvent.time > maxT) maxT = lastEvent.time;
  }
  if (!clip.length) clip.length = maxT || 1;

  clips.push(clip);
}

// ===================================================================
// parseBedrockAnimationJSON — 主函数
// ===================================================================

/**
 * 解析完整的基岩版动画 JSON 字符串
 * @param jsonStr .animation.json 文件内容
 * @returns 解析结果：clips + 错误列表
 */
export function parseBedrockAnimationJSON(jsonStr: string): {
  clips: AnimationClip[];
  errors: string[];
} {
  // 阶段1：JSON 解析+根校验（失败直接带错误返回）
  const { anims, errors } = parseAndValidateAnimRoot(jsonStr);
  if (!anims) return { clips: [], errors };

  const clips: AnimationClip[] = [];

  for (const [name, anim] of Object.entries(anims)) {
    if (!anim || typeof anim !== "object") continue;
    const animObj = anim as RawAnimEntry;

    // 阶段2：Clip 骨架构造 + 有效性预检（无 bones 也无 timeline 则跳过）
    const ctx = buildAnimClipSkeleton(name, animObj);
    if (!ctx) continue;
    const { clip, bones, hasTimeline } = ctx;

    // 阶段3：Bone 通道解析（含 Molang 探测）
    parseClipBones(clip, bones);

    // 阶段4：Timeline 事件解析（Molang 表达式编译+排序）
    parseClipTimeline(clip, hasTimeline, animObj);

    // 阶段5：长度补算 + 入队判定
    finalizeClipLengthAndEnqueue(clip, clips);
  }

  return { clips, errors };
}

/** L4：解析帧的 Molang 动态轴（anim_time = 求值时间 t）；无动态轴原样返回数字基底 */
function resolveFramePost(kf: Keyframe, t: number): Vec3 {
  const fns = kf.postMolang;
  const base = kf.post || [0, 0, 0];
  if (!fns) return base;
  return [
    fns[0] ? fns[0](t) : base[0],
    fns[1] ? fns[1](t) : base[1],
    fns[2] ? fns[2](t) : base[2],
  ];
}

/**
 * uniform Catmull-Rom 三次样条采样（Hermite 等价形式，C1 连续）。
 * 经过两端控制点 p1/p2，切点由相邻点决定：m0=(p2-p0)/2、m1=(p3-p1)/2。
 * s∈[0,1] 为区间内的归一化位置（沿用 Bedrock/常见 loader 的按索引参数化口径）。
 * 逐轴计算，避免中间分配。
 */
function sampleCatmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, s: number): Vec3 {
  const s2 = s * s;
  const s3 = s2 * s;
  const m0 = [0, 0, 0] as Vec3;
  const m1 = [0, 0, 0] as Vec3;
  for (let a = 0; a < 3; a++) {
    m0[a] = (p2[a] - p0[a]) / 2;
    m1[a] = (p3[a] - p1[a]) / 2;
  }
  const out: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    out[a] =
      (2 * p1[a] - 2 * p2[a] + m0[a] + m1[a]) * s3 +
      (-3 * p1[a] + 3 * p2[a] - 2 * m0[a] - m1[a]) * s2 +
      m0[a] * s +
      p1[a];
  }
  return out;
}

/**
 * 在指定时间 t 对一组关键帧求值
 * @param keyframes 排序后的关键帧数组
 * @param t 时间（秒，即 Molang 上下文的 query.anim_time）
 * @returns 插值后的值 [x,y,z] | null
 */
export function evaluateKeyframes(keyframes: Keyframe[], t: number): Vec3 | null {
  if (!keyframes?.length) return null;
  // P2 修复（审核，NaN 守卫）：非法时间直接返回首帧（防御调用方传 NaN/Infinity；
  // NaN 无法喂 Molang，取数字基底）
  if (!Number.isFinite(t)) return [...(keyframes[0].post || [0, 0, 0])];

  // 超出范围（Molang 轴仍按当前 t 求值，对齐 Bedrock q.anim_time 语义）
  if (t <= keyframes[0].time) return [...resolveFramePost(keyframes[0], t)];
  if (t >= keyframes[keyframes.length - 1].time)
    return [...resolveFramePost(keyframes[keyframes.length - 1], t)];

  const lo = findKeyframeLowerIndex(keyframes, t);
  const hi = lo + 1;

  const a = keyframes[lo];
  const b = keyframes[hi];

  // step 插值：直接返回当前帧的 post 值
  if (a.lerp === "step") return [...resolveFramePost(a, t)];

  const dt = b.time - a.time;
  if (dt <= 0) return [...resolveFramePost(a, t)];
  const frac = (t - a.time) / dt;

  // catmullrom：取前后各一邻帧做 C1 三次样条（标准 uniform Catmull-Rom）。
  // 区间端点本身即控制点；lo/hi 已在首尾帧内，p0/p3 越界时钳制到端点帧。
  if (a.lerp === "catmullrom") {
    const p0 = resolveFramePost(keyframes[Math.max(0, lo - 1)], t);
    const p1 = resolveFramePost(a, t);
    const p2 = resolveFramePost(b, t);
    const p3 = resolveFramePost(keyframes[Math.min(keyframes.length - 1, hi + 1)], t);
    return sampleCatmullRom(p0, p1, p2, p3, frac);
  }

  // 线性插值（端点先 Molang 求值再 lerp，对齐 GeckoLib/ModernYSM 口径）
  const ap = resolveFramePost(a, t);
  const bp = resolveFramePost(b, t);
  return [
    ap[0] + (bp[0] - ap[0]) * frac,
    ap[1] + (bp[1] - ap[1]) * frac,
    ap[2] + (bp[2] - ap[2]) * frac,
  ];
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
  // 找到第一个 > prevTime 的事件索引
  let start = 0;
  while (start < timeline.length && timeline[start].time <= prevTime) {
    start++;
  }
  const fired: string[][] = [];
  for (let i = start; i < timeline.length; i++) {
    const ev = timeline[i];
    if (ev.time > currentTime) break;
    // 执行所有动作
    for (const fn of ev.actions) {
      fn(currentTime); // anim_time = 当前时间
    }
    fired.push(ev.raw);
  }
  return fired.length > 0 ? fired : null;
}

/**
 * 对整个动画 clip 在指定时间求值（支持骨骼层级）
 * @param clip 动画剪辑
 * @param time 当前时间（秒）
 * @param boneHierarchy 骨骼层级数据 [{name, parent}]（可选）
 * @param localOnly 只返回局部变换（不传播父级），用于 Three.js（可选）
 * @returns 骨骼名 → 变换 Map
 */
export function evaluateClip(
  clip: AnimationClip,
  time: number,
  boneHierarchy?: BoneHierarchyNode[],
  localOnly?: boolean,
): Map<string, BoneTransform> {
  const result = new Map<string, BoneTransform>();
  if (!clip?.bones) return result;

  let t = time;
  if (clip.loop && clip.length > 0) {
    t = ((t % clip.length) + clip.length) % clip.length;
  } else if (t > clip.length) {
    t = clip.length;
  }

  // 1. 计算各骨骼的局部变换
  const local = new Map<string, BoneTransform>();
  for (const [boneName, channels] of Object.entries(clip.bones)) {
    const transform: BoneTransform = {};
    for (const ch of BONE_CHANNELS) {
      const val = evaluateKeyframes(channels[ch] ?? [], t);
      if (val) transform[ch] = val;
    }
    if (Object.keys(transform).length > 0) {
      local.set(boneName, transform);
    }
  }

  // 如果只需要局部变换，直接返回
  if (localOnly) return local;

  // 2. 构建名称→父级映射
  const parentMap = new Map<string, string>();
  if (boneHierarchy) {
    for (const b of boneHierarchy) {
      if (b.parent) parentMap.set(b.name, b.parent);
    }
  }

  // 3. 按父级优先顺序传播变换
  // 先找出根骨骼（无父级或有父级但父级不在列表中的）
  const allBoneNames = new Set<string>([...local.keys()]);
  if (boneHierarchy) {
    for (const b of boneHierarchy) allBoneNames.add(b.name);
  }

  // 拓扑排序：父级在前
  const sorted: string[] = [];
  const visited = new Set<string>();
  // P1 修复（反推审核）：环检测——骨骼层级自环/互指（boneHierarchy 中 A.parent=B、
  // B.parent=A）时 visit 无限递归栈溢出；用 inStack 标记当前递归栈，回边跳过并告警
  const inStack = new Set<string>();
  const visit = (name: string): void => {
    if (inStack.has(name)) {
      logWarn("animation", `骨骼层级存在环，跳过回边: ${name}`);
      return;
    }
    if (visited.has(name)) return;
    inStack.add(name);
    visited.add(name);
    const p = parentMap.get(name);
    if (p && allBoneNames.has(p)) visit(p);
    inStack.delete(name);
    sorted.push(name);
  };
  for (const name of allBoneNames) visit(name);

  // 4. 累积父级变换到子级
  for (const name of sorted) {
    const tLocal = local.get(name) || {};
    const parentName = parentMap.get(name);
    if (parentName && result.has(parentName)) {
      const pt = result.get(parentName)!;
      const combined: BoneTransform = {
        rotation: [0, 0, 0],
        position: [0, 0, 0],
        scale: [1, 1, 1],
      };

      // 累积旋转（角度相加）
      if (pt.rotation || tLocal.rotation) {
        combined.rotation = [
          (pt.rotation?.[0] || 0) + (tLocal.rotation?.[0] || 0),
          (pt.rotation?.[1] || 0) + (tLocal.rotation?.[1] || 0),
          (pt.rotation?.[2] || 0) + (tLocal.rotation?.[2] || 0),
        ];
      }

      // 累积位置（父级位移 + 子级位移经父级旋转后）
      if (pt.position || tLocal.position) {
        const pp = pt.position || [0, 0, 0];
        const cp = tLocal.position || [0, 0, 0];
        combined.position = [pp[0] + cp[0], pp[1] + cp[1], pp[2] + cp[2]];
      }

      // 累积缩放
      if (pt.scale || tLocal.scale) {
        const ps = pt.scale || [1, 1, 1];
        const cs = tLocal.scale || [1, 1, 1];
        combined.scale = [ps[0] * cs[0], ps[1] * cs[1], ps[2] * cs[2]];
      }

      result.set(name, combined);
    } else if (Object.keys(tLocal).length > 0) {
      // P2 修复（审核，引用共享）：深拷贝数组——原 `{ ...tLocal }` 浅拷贝，
      // rotation/position/scale 数组与 local Map 共享引用，调用方持结果后修改
      // 数组会污染局部变换缓存（localOnly 分支直接返回 local 时尤甚）
      result.set(name, {
        rotation: tLocal.rotation ? [...tLocal.rotation] : undefined,
        position: tLocal.position ? [...tLocal.position] : undefined,
        scale: tLocal.scale ? [...tLocal.scale] : undefined,
      });
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
