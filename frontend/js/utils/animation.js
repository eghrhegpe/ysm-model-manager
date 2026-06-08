/**
 * 基岩版动画 JSON 解析 + 插值引擎
 * YSM 使用标准基岩版格式，Molang 表达式值跳过
 */

/** 判断值是否为 Molang 字符串（非纯数字） */
function isMolang(v) {
  return typeof v === "string" || (typeof v === "number" && isNaN(v));
}

/** 尝试将关键帧值解析为 [x,y,z] 数字数组 */
function parseKeyValue(v) {
  if (Array.isArray(v) && v.length === 3) {
    const nums = v.map(Number);
    if (nums.some(isNaN)) return null; // 含 Molang
    return nums;
  }
  if (typeof v === "number") return [v, v, v]; // 单一数值（罕见但合法）
  return null; // Molang 或其他
}

/** 从关键帧对象解析 {post, pre, lerp_mode} */
function extractKeyframe(kv) {
  if (kv === null || kv === undefined) return null;
  if (Array.isArray(kv)) {
    const val = parseKeyValue(kv);
    if (!val) return null;
    return { post: val, pre: val, lerp: "linear" };
  }
  if (typeof kv === "object") {
    const post = kv.post ? parseKeyValue(kv.post) : null;
    const pre = kv.pre ? parseKeyValue(kv.pre) : post;
    if (!post) return null;
    const lerp = kv.lerp_mode || (pre !== post ? "step" : "linear");
    return { post, pre, lerp };
  }
  // 单数值
  const n = Number(kv);
  if (isNaN(n)) return null;
  return { post: [n, n, n], pre: [n, n, n], lerp: "linear" };
}

/** 解析单个 channel（rotation/position/scale）的数据 */
function parseChannel(channelData) {
  if (!channelData || typeof channelData !== "object") return [];
  const times = Object.keys(channelData)
    .map(Number)
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);
  return times
    .map((t) => {
      const kf = extractKeyframe(channelData[t]);
      if (!kf) return null;
      return { time: t, post: kf.post, pre: kf.pre, lerp: kf.lerp };
    })
    .filter(Boolean);
}

/**
 * 解析完整的基岩版动画 JSON 字符串
 * @param {string} jsonStr - .animation.json 文件内容
 * @returns {{ clips: AnimationClip[], errors: string[] }}
 *
 * AnimationClip: { name, loop, length, bones: { boneName: BoneChannels } }
 * BoneChannels: { rotation: Keyframe[], position: Keyframe[], scale: Keyframe[] }
 * Keyframe: { time: number, post: [x,y,z], pre: [x,y,z], lerp: string }
 */
export function parseBedrockAnimationJSON(jsonStr) {
  const errors = [];
  let root;
  try {
    root = JSON.parse(jsonStr);
  } catch (e) {
    return { clips: [], errors: [`JSON 解析失败: ${e.message}`] };
  }

  const anims = root?.animations;
  if (!anims || typeof anims !== "object") {
    return { clips: [], errors: ["缺少 animations 字段"] };
  }

  const clips = [];

  for (const [name, anim] of Object.entries(anims)) {
    if (!anim || typeof anim !== "object") continue;

    // 跳过无效动画
    const bones = anim.bones;
    if (!bones || typeof bones !== "object") continue;

    const clip = {
      name,
      loop: anim.loop === true || anim.loop === "true",
      length: anim.animation_length || 0,
      bones: {},
      hasMolang: false, // 若任一关键帧含 Molang 则标记
    };

    for (const [boneName, boneData] of Object.entries(bones)) {
      if (!boneData || typeof boneData !== "object") continue;

      const channels = {};
      for (const ch of ["rotation", "position", "scale"]) {
        const kfs = parseChannel(boneData[ch]);
        if (kfs.length > 0) {
          channels[ch] = kfs;
          // 检测是否有 Molang——所有 parseChannel 返回的都是纯数值
          // 如果有 null 说明被跳过，但这里不会出现因为 parseChannel 已经过滤了
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
        for (const ch of ["rotation", "position", "scale"]) {
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
 * @param {Keyframe[]} keyframes - 排序后的关键帧数组
 * @param {number} t - 时间（秒）
 * @returns {[x,y,z]|null} 插值后的值
 */
export function evaluateKeyframes(keyframes, t) {
  if (!keyframes?.length) return null;

  // 超出范围
  if (t <= keyframes[0].time) return keyframes[0].post;
  if (t >= keyframes[keyframes.length - 1].time)
    return keyframes[keyframes.length - 1].post;

  // 二分查找
  let lo = 0,
    hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= t) lo = mid;
    else hi = mid;
  }

  const a = keyframes[lo];
  const b = keyframes[hi];

  // step 插值：直接返回当前帧的 post 值
  if (a.lerp === "step") return [...a.post];

  // 线性插值
  const dt = b.time - a.time;
  if (dt <= 0) return [...b.post];
  const frac = (t - a.time) / dt;
  return [
    a.post[0] + (b.post[0] - a.post[0]) * frac,
    a.post[1] + (b.post[1] - a.post[1]) * frac,
    a.post[2] + (b.post[2] - a.post[2]) * frac,
  ];
}

/**
 * 对整个动画 clip 在指定时间求值（支持骨骼层级）
 * @param {AnimationClip} clip
 * @param {number} time - 当前时间（秒）
 * @param {object[]} [boneHierarchy] - 骨骼层级数据 [{name, parent}]
 * @returns {Map<string, {rotation, position, scale}>}
 */
export function evaluateClip(clip, time, boneHierarchy) {
  const result = new Map();
  if (!clip?.bones) return result;

  let t = time;
  if (clip.loop && clip.length > 0) {
    t = ((t % clip.length) + clip.length) % clip.length;
  } else if (t > clip.length) {
    t = clip.length;
  }

  // 1. 计算各骨骼的局部变换
  const local = new Map();
  for (const [boneName, channels] of Object.entries(clip.bones)) {
    const transform = {};
    for (const ch of ["rotation", "position", "scale"]) {
      const val = evaluateKeyframes(channels[ch], t);
      if (val) transform[ch] = val;
    }
    if (Object.keys(transform).length > 0) {
      local.set(boneName, transform);
    }
  }

  // 2. 构建名称→父级映射
  const parentMap = new Map();
  if (boneHierarchy) {
    for (const b of boneHierarchy) {
      if (b.parent) parentMap.set(b.name, b.parent);
    }
  }

  // 3. 按父级优先顺序传播变换
  // 先找出根骨骼（无父级或有父级但父级不在列表中的）
  const allBoneNames = new Set([...local.keys()]);
  if (boneHierarchy) {
    for (const b of boneHierarchy) allBoneNames.add(b.name);
  }

  // 拓扑排序：父级在前
  const sorted = [];
  const visited = new Set();
  const visit = (name) => {
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
      const pt = result.get(parentName);
      const combined = {
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
    for (const [n, t] of entries) {
      if (t.rotation?.some((v) => Math.abs(v) > 0.1)) {
        console.warn(
          `[ANIM] ${n}: rot=${t.rotation.map((v) => v.toFixed(1))} pos=${(t.position || [0, 0, 0]).map((v) => v.toFixed(2))}`,
        );
      }
    }
  }

  return result;
}
