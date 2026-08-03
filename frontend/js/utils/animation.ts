/**
 * 基岩版动画 JSON 解析 + 插值引擎（类型化版 — ADR-014 P2 大件收尾）
 * YSM 使用标准基岩版格式，Molang 表达式值跳过
 */

// ── 类型定义 ────────────────────────────────────────

/** 三维向量 [x, y, z] */
export type Vec3 = [number, number, number];

/** 关键帧 */
export interface Keyframe {
  time: number;
  post: Vec3;
  pre: Vec3;
  lerp: "linear" | "step";
}

/** 单骨骼三通道 */
export interface BoneChannels {
  rotation?: Keyframe[];
  position?: Keyframe[];
  scale?: Keyframe[];
}

/** 动画剪辑 */
export interface AnimationClip {
  name: string;
  loop: boolean;
  length: number;
  bones: Record<string, BoneChannels>;
  hasMolang?: boolean;
}

/** 骨骼变换（evaluateClip 结果值） */
export interface BoneTransform {
  rotation?: Vec3;
  position?: Vec3;
  scale?: Vec3;
}

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

/** 判断值是否为 Molang 字符串（非纯数字） */
function isMolang(v: unknown): boolean {
  return (
    typeof v === "string" || (typeof v === "number" && isNaN(v))
  );
}

/**
 * 常量折叠：尝试从 Molang 字符串中提取纯数字。
 * 处理 "q.life_time * 0 + 30" → 30, "math.sin(0) * 0 + 45" → 45
 * 只处理变量乘以 0 后加常数的模式，含真实变量时返回 null。
 */
function foldMolangConstant(str: unknown): number | null {
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

/** 尝试将关键帧值解析为 [x,y,z] 数字数组 */
function parseKeyValue(v: unknown): Vec3 | null {
  if (Array.isArray(v) && v.length === 3) {
    const nums = v.map((item) => {
      if (typeof item === "string") {
        const folded = foldMolangConstant(item);
        if (folded !== null) return folded;
      }
      return Number(item);
    });
    if (nums.some(isNaN)) {
      // 部分轴不可折叠时保留可解析的轴，不可解析的用 0 占位
      return nums.map((n) => (isNaN(n) ? 0 : n)) as Vec3;
    }
    return nums as Vec3;
  }
  if (typeof v === "number") return [v, v, v]; // 单一数值（罕见但合法）
  if (typeof v === "string") {
    const folded = foldMolangConstant(v);
    if (folded !== null) return [folded, folded, folded];
  }
  return null; // Molang 或其他
}

/** 从关键帧对象解析 {post, pre, lerp_mode} */
function extractKeyframe(kv: unknown): {
  post: Vec3;
  pre: Vec3;
  lerp: "linear" | "step";
} | null {
  if (kv === null || kv === undefined) return null;
  if (Array.isArray(kv)) {
    const val = parseKeyValue(kv);
    if (!val) return null;
    return { post: val, pre: val, lerp: "linear" };
  }
  if (typeof kv === "object") {
    const obj = kv as RawKeyframeObject;
    const post = obj.post ? parseKeyValue(obj.post) : null;
    const pre = obj.pre ? parseKeyValue(obj.pre) : post;
    if (!post) return null;
    // lerp_mode 合法值只有 linear/step，非 step 一律按 linear
    const lerp: "linear" | "step" =
      obj.lerp_mode === "step" ? "step" : "linear";
    return { post, pre: pre ?? post, lerp };
  }
  // 单数值
  const n = Number(kv);
  if (isNaN(n)) return null;
  return { post: [n, n, n], pre: [n, n, n], lerp: "linear" };
}

/** 解析单个 channel（rotation/position/scale）的数据 */
function parseChannel(channelData: unknown): Keyframe[] {
  if (!channelData || typeof channelData !== "object") return [];
  const times = Object.keys(channelData)
    .map(Number)
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);
  return times
    .map((t) => {
      const kf = extractKeyframe(
        (channelData as Record<string, unknown>)[t],
      );
      if (!kf) return null;
      return { time: t, post: kf.post, pre: kf.pre, lerp: kf.lerp };
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

/**
 * 解析完整的基岩版动画 JSON 字符串
 * @param jsonStr .animation.json 文件内容
 * @returns 解析结果：clips + 错误列表
 */
export function parseBedrockAnimationJSON(jsonStr: string): {
  clips: AnimationClip[];
  errors: string[];
} {
  const errors: string[] = [];
  let root: { animations?: Record<string, unknown> };
  try {
    root = JSON.parse(jsonStr);
  } catch (e) {
    return {
      clips: [],
      errors: [`JSON 解析失败: ${(e as Error).message}`],
    };
  }

  const anims = root?.animations;
  if (!anims || typeof anims !== "object") {
    return { clips: [], errors: ["缺少 animations 字段"] };
  }

  const clips: AnimationClip[] = [];

  for (const [name, anim] of Object.entries(anims)) {
    if (!anim || typeof anim !== "object") continue;
    const animObj = anim as {
      loop?: boolean | string;
      animation_length?: number;
      bones?: Record<string, unknown>;
    };

    // 跳过无效动画
    const bones = animObj.bones;
    if (!bones || typeof bones !== "object") continue;

    const clip: AnimationClip = {
      name,
      loop: animObj.loop === true || animObj.loop === "true",
      length: animObj.animation_length || 0,
      bones: {},
      hasMolang: false, // 若任一关键帧含 Molang 则标记
    };

    for (const [boneName, boneData] of Object.entries(bones)) {
      if (!boneData || typeof boneData !== "object") continue;
      const boneObj = boneData as Record<string, unknown>;

      // 检测 Molang：原始数据中是否含字符串值（非数字）
      if (!clip.hasMolang) {
        for (const ch of ["rotation", "position", "scale"]) {
          if (hasMolangInChannelData(boneObj[ch])) {
            clip.hasMolang = true;
            break;
          }
        }
      }

      const channels: BoneChannels = {};
      for (const ch of ["rotation", "position", "scale"] as const) {
        const kfs = parseChannel(boneObj[ch]);
        if (kfs.length > 0) {
          channels[ch] = kfs;
        }
      }

      if (Object.keys(channels).length > 0) {
        clip.bones[boneName] = channels;
      }
    }

    // 如果有骨骼动画数据才加入
    if (Object.keys(clip.bones).length > 0) {
      // 计算实际长度（取最大关键帧时间）
      let maxT = 0;
      for (const chs of Object.values(clip.bones)) {
        for (const ch of ["rotation", "position", "scale"] as const) {
          const kfs = chs[ch];
          if (kfs?.length) {
            const last = kfs[kfs.length - 1];
            if (last.time > maxT) maxT = last.time;
          }
        }
      }
      if (!clip.length) clip.length = maxT || 1;

      clips.push(clip);
    }
  }

  return { clips, errors };
}

/**
 * 在指定时间 t 对一组关键帧求值
 * @param keyframes 排序后的关键帧数组
 * @param t 时间（秒）
 * @returns 插值后的值 [x,y,z] | null
 */
export function evaluateKeyframes(keyframes: Keyframe[], t: number): Vec3 | null {
  if (!keyframes?.length) return null;

  // 超出范围
  if (t <= keyframes[0].time) return keyframes[0].post;
  if (t >= keyframes[keyframes.length - 1].time)
    return keyframes[keyframes.length - 1].post;

  // 二分查找
  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= t) lo = mid;
    else hi = mid;
  }

  const a = keyframes[lo];
  const b = keyframes[hi];

  // step 插值：直接返回当前帧的 post 值
  if (a.lerp === "step") return [...a.post];

  // 线性插值（防御空值）
  const dt = b.time - a.time;
  if (dt <= 0) return a.post ? [...a.post] : [0, 0, 0];
  const frac = (t - a.time) / dt;
  const ap = a.post || [0, 0, 0];
  const bp = b.post || [0, 0, 0];
  return [
    ap[0] + (bp[0] - ap[0]) * frac,
    ap[1] + (bp[1] - ap[1]) * frac,
    ap[2] + (bp[2] - ap[2]) * frac,
  ];
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
    for (const ch of ["rotation", "position", "scale"] as const) {
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
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const p = parentMap.get(name);
    if (p && allBoneNames.has(p)) visit(p);
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
      result.set(name, { ...tLocal });
    }
  }

  // Debug: 如果有变换且非零，打印前 5 个
  if (import.meta.env.DEV && result.size > 0) {
    const entries = [...result.entries()].slice(0, 5);
    void entries;
    // rot/pos debug removed (noisy)
  }

  return result;
}
