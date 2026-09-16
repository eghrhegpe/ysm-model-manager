// ===== surface-pixels/anti-repeat.ts — 平铺「无缝但有规律重复」的治理 =====
//
// ---------------------------------------------------------------- 问题 -----
// 4D 环面噪声已让单张 tile **自身无缝**（RepeatWrapping 不露接缝，见 ADR-254 §6.2）。
// 但「无缝 ≠ 无重复」：同一张 tile 每重复一次，「明星特征」就每隔约两米出现一次，
// 眼睛会锁定它。本模块实现三种行业解法，把「单 tile」合成为「内部已去重复的大图」。
//
// -------------------------------------------------- 输入纹理规格 -----------
// 类型：RGBA `Uint8Array`（sRGB，0–255），**必须为正方形**，`sourceSize = S`（建议 2 的幂：256/512/1024）。
// 关键约束：**输入 tile 必须本身无缝**（周期 = S），即左右/上下边缘数学对齐。
//   - 本项目的程序化材质（grass/marble/sand 经 4D 环面噪声）天然满足；
//   - 用户上传 PNG 须是已平铺无缝的贴图。
//   - 非无缝输入 → 本模块不负责补接缝（那是 4D 环面那一步的活），只治理「重复」。
// 通道：RGB 为颜色，A 恒为 255（不透明），本模块不改 A。
//
// -------------------------------------------------- 输出结果格式 -----------
// 类型：RGBA `Uint8Array`（sRGB，0–255），正方形 `outSize × outSize`，
//       `outSize = tilesPerAxis * S`（默认 tilesPerAxis = 4 → 4×4 = 16 个子块）。
// 特性：输出**仍无缝**（周期 = outSize，可继续 RepeatWrapping），但内部 16 个子块彼此去相关，
//       故可见重复周期被放大 `tilesPerAxis` 倍，且不再有锁定感。
// 部署：喂给 `THREE.DataTexture` + `RepeatWrapping`；为保持每米细节密度不变，
//       纹理 `repeat` 须从基线 `R` 调为 `R / tilesPerAxis`（见 `textureRepeatForDerepeat`）。
//
// -------------------------------------------------- 三种解法与适用场景 -----
// 1) macro（全图低频宏观叠加）
//    对整张大图施加一张低频噪声「明暗场」，每个子块被调制出不同整体色调。
//    · 最快、零额外生成成本；输出仅亮度/对比度被低频调制，特征位置不变。
//    · 适用：大平面上只想「打散周期性」、底层纹理自身已足够丰富时（默认首选）。
//    · 局限：只改明暗，不 relocate 特征；若要更强去相关用 dual / stochastic。
//
// 2) dual（双变体混合）
//    需要**两份不同种子**的变体 A、B（如同一草地的两个程序化结果）。用一张低频
//    mask 把它们聚成「A 簇 / B 簇」软混合，相邻子块常落入不同变体 → 破重复。
//    · 适用：自然材质（草/泥/沙）两种真实形态可信混交；视觉最自然。
//    · 成本：2× 生成；若只有一张 tile，可用 `makeDecorrelatedVariant` 近似造 B（见函数注释）。
//
// 3) stochastic（随机化采样 / 随机瓦片）
//    每个子块对源 tile 施加**种子化随机朝向（0/90/180/270°）+ 翻转**，并在瓦片边界
//    羽化回 base（保无缝）。特征朝向/位置逐块随机 → 最强去相关，像手工铺设。
//    · 适用：英雄面（hero surface）、想要「看似随机铺就」的高质感场景。
//    · 成本：略高；边界羽化保无缝，羽化越宽越平滑、装饰性略降。
//
// 三种解法互不排斥，可单独或组合使用（先 dual 再 macro 叠加宏观等）。
// 验证：本模块纯函数、零 three 运行时依赖，配套 `anti-repeat.test.ts` node 单测。

import { smoothStep, tiledFbm } from "./noise.ts";

/** 去重复策略（单源：macro / stochastic） */
export type AntiRepeatStrategy = "macro" | "stochastic";

/** 低频调制/混合场（归一化坐标采样）：`freq` 为铺满整图周期数、`seed` 播种。
 *  4D 环面 → **out 边界连续**（RepeatWrapping 无缝）；非周期 2D 场会在每圈
 *  边界留明暗/色带跳变缝（审核 3aac32d60 P1 实锤：dual 回绕缝 181 vs 内部缝 77），
 *  周期化后回绕缝收敛到与 stochastic 同级的输入固有残差。 */
export function lowFreqMask(nx: number, ny: number, freq: number, seed: number): number {
  return tiledFbm(nx, ny, freq, freq, 0, 3, 2, seed);
}

export interface AntiRepeatOptions {
  /** 解法：macro（低频宏观叠加）| stochastic（随机瓦片） */
  strategy: AntiRepeatStrategy;
  /** 合成输出边长 = tilesPerAxis * sourceSize（默认 4 → 4×4=16 子块，重复周期放大 4×） */
  tilesPerAxis?: number;
  /** 随机种子（同种子可复现；stochastic / dual 的簇与朝向由此决定） */
  seed?: number;
  /** macro：低频宏观调制强度 0~1（默认 0.25 → ±25% 亮度）；0 = 不调制（退化为原平铺） */
  macroStrength?: number;
  /** macro：宏观场在整张输出内的周期数（默认 1.5，越大斑越大越平缓） */
  macroFreq?: number;
  /** stochastic：瓦片边界羽化宽度（px，默认 4），越大越平滑、装饰性略降 */
  blend?: number;
}

export interface AntiRepeatDualOptions {
  /** 合成输出边长 = tilesPerAxis * sourceSize（默认 4） */
  tilesPerAxis?: number;
  /** 随机种子 */
  seed?: number;
  /** 低频 mask 在整张输出内的周期数（默认 2，越大簇越小） */
  maskFreq?: number;
  /** mask 锐度（默认 3，越大 A/B 边界越硬） */
  maskSharp?: number;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 单源解法：macro / stochastic */
export function derandomize(
  tile: Uint8Array,
  sourceSize: number,
  opts: AntiRepeatOptions,
): Uint8Array {
  const N = Math.max(1, opts.tilesPerAxis ?? 4);
  const out = N * sourceSize;
  switch (opts.strategy) {
    case "macro":
      return macroOverlay(tile, sourceSize, out, opts);
    case "stochastic":
      return stochasticTiles(tile, sourceSize, out, opts);
  }
}

/** 双变体混合：A、B 为两份不同的无缝 tile（同 sourceSize） */
export function derandomizeDual(
  tileA: Uint8Array,
  tileB: Uint8Array,
  sourceSize: number,
  opts: AntiRepeatDualOptions = {},
): Uint8Array {
  const N = Math.max(1, opts.tilesPerAxis ?? 4);
  const out = N * sourceSize;
  const seed = opts.seed ?? 1;
  const maskFreq = opts.maskFreq ?? 2;
  const maskSharp = opts.maskSharp ?? 3;
  const px = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const sx = x % sourceSize;
      const sy = y % sourceSize;
      const ai = (sy * sourceSize + sx) * 4;
      const bi = ai;
      // 周期化低频 mask（lowFreqMask：4D 环面，out 边界连续 → RepeatWrapping 无缝）
      const m = lowFreqMask(x / out, y / out, maskFreq, seed);
      const t = smoothStep(Math.min(1, Math.max(0, (m - 0.5) * maskSharp + 0.5)));
      const idx = (y * out + x) * 4;
      for (let c = 0; c < 3; c++) {
        px[idx + c] = clamp255(tileA[ai + c] * (1 - t) + tileB[bi + c] * t);
      }
      px[idx + 3] = 255;
    }
  }
  return px;
}

/** 便捷：从单张 tile 近似造出「不同变体 B」（旋转 90° + 通道微偏移）。
 *  ⚠️ 近似：最佳效果请传入两份**真实不同种子**的程序化结果（如草 density=1 vs 1.5）。 */
export function makeDecorrelatedVariant(
  tile: Uint8Array,
  sourceSize: number,
  seed = 1,
): Uint8Array {
  const S = sourceSize;
  const dr = ((seed * 37) % 16) - 8;
  const dg = ((seed * 53) % 16) - 8;
  const db = ((seed * 71) % 16) - 8;
  const out = new Uint8Array(tile.length);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 旋转 90° 顺时针 + 通道偏移
      const sx = y;
      const sy = S - 1 - x;
      const si = (sy * S + sx) * 4;
      const di = (y * S + x) * 4;
      out[di] = clamp255(tile[si] + dr);
      out[di + 1] = clamp255(tile[si + 1] + dg);
      out[di + 2] = clamp255(tile[si + 2] + db);
      out[di + 3] = 255;
    }
  }
  return out;
}

/* ===================== 内部实现 ===================== */

/** macro：整张大图叠加低频明暗场（非周期 → 大图自身不重复） */
function macroOverlay(
  tile: Uint8Array,
  S: number,
  out: number,
  opts: AntiRepeatOptions,
): Uint8Array {
  const strength = opts.macroStrength ?? 0.25;
  const freq = opts.macroFreq ?? 1.5;
  const seed = opts.seed ?? 1;
  const px = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const sx = x % S;
      const sy = y % S;
      const bi = (sy * S + sx) * 4;
      // 周期化低频场（4D 环面：freq 个周期铺满整张大图，out 边界处连续
      // → RepeatWrapping 无缝；非周期 fbm2 会在每圈边界留明暗跳变缝）
      const m = lowFreqMask(x / out, y / out, freq, seed); // [0,1]
      const factor = 1 + (m - 0.5) * 2 * strength;
      const idx = (y * out + x) * 4;
      for (let c = 0; c < 3; c++) px[idx + c] = clamp255(tile[bi + c] * factor);
      px[idx + 3] = 255;
    }
  }
  return px;
}

/** stochastic：每子块随机朝向/翻转，边界羽化回 base 保无缝 */
function stochasticTiles(
  tile: Uint8Array,
  S: number,
  out: number,
  opts: AntiRepeatOptions,
): Uint8Array {
  const seed = opts.seed ?? 1;
  const blend = Math.max(0, opts.blend ?? 4);
  // base：原始平铺（无缝），羽化目标
  const base = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const si = ((y % S) * S + (x % S)) * 4;
      const di = (y * out + x) * 4;
      for (let c = 0; c < 4; c++) base[di + c] = tile[si + c];
    }
  }
  // decor：每子块随机变换源 tile（仍在 mod-S 无缝域内）
  const decor = new Uint8Array(out * out * 4);
  for (let tj = 0; tj < out / S; tj++) {
    for (let ti = 0; ti < out / S; ti++) {
      let h = hashTile(ti, tj, seed);
      const rnd = () => {
        h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
        return h / 4294967295;
      };
      const rot = Math.floor(rnd() * 4); // 0/1/2/3
      const flipX = rnd() < 0.5;
      const flipY = rnd() < 0.5;
      for (let ly = 0; ly < S; ly++) {
        for (let lx = 0; lx < S; lx++) {
          let sx = lx;
          let sy = ly;
          if (rot === 1) {
            sx = ly;
            sy = S - 1 - lx;
          } else if (rot === 2) {
            sx = S - 1 - lx;
            sy = S - 1 - ly;
          } else if (rot === 3) {
            sx = S - 1 - ly;
            sy = lx;
          }
          if (flipX) sx = S - 1 - sx;
          if (flipY) sy = S - 1 - sy;
          const si = (sy * S + sx) * 4;
          const di = ((tj * S + ly) * out + (ti * S + lx)) * 4;
          for (let c = 0; c < 4; c++) decor[di + c] = tile[si + c];
        }
      }
    }
  }
  // 羽化：瓦片边界 blend px 内线性收敛回 base（保无缝），内部保留 decor（去相关）
  const px = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const lx = x % S;
      const ly = y % S;
      const edge = Math.min(lx, S - 1 - lx, ly, S - 1 - ly);
      const amt = blend === 0 || edge >= blend ? 0 : 1 - edge / blend; // 边界处=1→base
      const di = (y * out + x) * 4;
      for (let c = 0; c < 3; c++) {
        px[di + c] = clamp255(decor[di + c] * (1 - amt) + base[di + c] * amt);
      }
      px[di + 3] = 255;
    }
  }
  return px;
}

function hashTile(ti: number, tj: number, seed: number): number {
  let h =
    (Math.imul(ti | 0, 374761393) ^
      Math.imul(tj | 0, 668265263) ^
      Math.imul(seed | 0, 2654435761)) >>>
    0;
  h = (h ^ (h >>> 13)) >>> 0;
  return Math.imul(h, 1274126177) >>> 0;
}

/* ===================== 量化与部署辅助 ===================== */

/**
 * 重复度评分：相邻子块间的平均归一化「均值绝对差」(MAD/255)，范围 [0,1]。
 * 0 = 完全重复（相邻子块逐像素相同）；越大 = 去重复越强（相邻子块越不像）。
 * 用于单测断言去重复确实生效，而非肉眼判断。
 */
export function repetitionScore(rgba: Uint8Array, size: number, tilesPerAxis: number): number {
  const sub = size / tilesPerAxis;
  let sum = 0;
  let pairs = 0;
  const lum = (i: number) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  const tileLum = (tx: number, ty: number): number[] => {
    const arr: number[] = [];
    for (let y = 0; y < sub; y++) {
      for (let x = 0; x < sub; x++) {
        arr.push(lum(((ty * sub + y) * size + (tx * sub + x)) * 4));
      }
    }
    return arr;
  };
  const mad = (a: number[], b: number[]): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length / 255;
  };
  for (let ty = 0; ty < tilesPerAxis; ty++) {
    for (let tx = 0; tx < tilesPerAxis; tx++) {
      if (tx + 1 < tilesPerAxis) {
        sum += mad(tileLum(tx, ty), tileLum(tx + 1, ty));
        pairs++;
      }
      if (ty + 1 < tilesPerAxis) {
        sum += mad(tileLum(tx, ty), tileLum(tx, ty + 1));
        pairs++;
      }
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

/** 把基线 repeat 折算为去重复后的 repeat，使每米细节密度不变（周期放大 tilesPerAxis 倍）。 */
export function textureRepeatForDerepeat(baseRepeat: number, tilesPerAxis: number): number {
  return baseRepeat / Math.max(1, tilesPerAxis);
}

// 仅用于单测：把单 tile 平铺成 N×N 大图（基线「完全重复」参照）
export function tilePlain(
  source: Uint8Array,
  sourceSize: number,
  tilesPerAxis: number,
): Uint8Array {
  const out = tilesPerAxis * sourceSize;
  const px = new Uint8Array(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const si = ((y % sourceSize) * sourceSize + (x % sourceSize)) * 4;
      const di = (y * out + x) * 4;
      for (let c = 0; c < 4; c++) px[di + c] = source[si + c];
    }
  }
  return px;
}

// 仅用于单测：内部瓦片边界的最大不连续（验证未引入新接缝；base 为 0，羽化后近似 0）
export function maxSeamDiscontinuity(rgba: Uint8Array, size: number, sourceSize: number): number {
  let max = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 1; x < size; x++) {
      if (x % sourceSize === 0) {
        const a = (y * size + (x - 1)) * 4;
        const b = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgba[a + c] - rgba[b + c]));
      }
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 1; y < size; y++) {
      if (y % sourceSize === 0) {
        const a = ((y - 1) * size + x) * 4;
        const b = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgba[a + c] - rgba[b + c]));
      }
    }
  }
  return max;
}

/**
 * 单测：回绕边界（x=size-1 → 0、y=size-1 → 0）的最大不连续。
 * RepeatWrapping 部署时**真正可见**的缝在这两处，而 maxSeamDiscontinuity
 * 只查内部子块边界——非周期调制场（macro/dual 旧实现）回绕缝 181 vs 内部 77
 * （审核 3aac32d60 P1 实测），内部全绿而回绕翻车的盲区。周期化后应≈输入固有残差。
 */
export function maxWrapSeamDiscontinuity(rgba: Uint8Array, size: number): number {
  let max = 0;
  for (let y = 0; y < size; y++) {
    const a = (y * size + (size - 1)) * 4;
    const b = (y * size + 0) * 4;
    for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgba[a + c] - rgba[b + c]));
  }
  for (let x = 0; x < size; x++) {
    const a = ((size - 1) * size + x) * 4;
    const b = x * 4;
    for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgba[a + c] - rgba[b + c]));
  }
  return max;
}
