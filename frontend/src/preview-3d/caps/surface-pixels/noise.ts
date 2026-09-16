// ===== surface-pixels/noise.ts — 纯噪声原语（零 three / 零 DOM，node 可测）=====
// 供各材质像素生成器共享：valueNoise 为基础，fbm 为多层叠加（domain warping 用）。

const TAU = Math.PI * 2;

/** 位置哈希（种子化，不使用 Math.random，保证同参可复现） */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 值噪声（value noise）：格点随机值 + 平滑插值，返回 [0,1] */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const a = hash2(xi, yi),
    b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1),
    d = hash2(xi + 1, yi + 1);
  const u = smoothStep(xf),
    v = smoothStep(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** 分形布朗运动：多 octave 叠加（lacunarity 倍频，gain 降幅），返回 [0,1] */
export function fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// ===== 4D 环面无缝噪声（治 RepeatWrapping 平铺接缝）=====
// 行业正解：把 (u,v)∈[0,1) 嵌入 4D 环面 (cos2πu, sin2πu, cos2πv, sin2πv) 喂 4D 噪声，
// u=0 与 u=1 落回同一环面点 → 噪声值严格相等 → 纹理自身无缝，repeat 不露边。

/** 4D 位置哈希（种子化，无 Math.random，同参可复现） */
function hash4(x: number, y: number, z: number, w: number): number {
  let h =
    (Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(z | 0, 1274126177) ^
      Math.imul(w | 0, 2146483647)) >>>
    0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 4D 值噪声：四线性插值，返回 [0,1] */
export function valueNoise4D(x: number, y: number, z: number, w: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z),
    wi = Math.floor(w);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi,
    wf = w - wi;
  const u = smoothStep(xf),
    v = smoothStep(yf),
    t = smoothStep(zf),
    s = smoothStep(wf);
  const c0000 = hash4(xi, yi, zi, wi);
  const c1000 = hash4(xi + 1, yi, zi, wi);
  const c0100 = hash4(xi, yi + 1, zi, wi);
  const c1100 = hash4(xi + 1, yi + 1, zi, wi);
  const c0010 = hash4(xi, yi, zi + 1, wi);
  const c1010 = hash4(xi + 1, yi, zi + 1, wi);
  const c0110 = hash4(xi, yi + 1, zi + 1, wi);
  const c1110 = hash4(xi + 1, yi + 1, zi + 1, wi);
  const c0001 = hash4(xi, yi, zi, wi + 1);
  const c1001 = hash4(xi + 1, yi, zi, wi + 1);
  const c0101 = hash4(xi, yi + 1, zi, wi + 1);
  const c1101 = hash4(xi + 1, yi + 1, zi, wi + 1);
  const c0011 = hash4(xi, yi, zi + 1, wi + 1);
  const c1011 = hash4(xi + 1, yi, zi + 1, wi + 1);
  const c0111 = hash4(xi, yi + 1, zi + 1, wi + 1);
  const c1111 = hash4(xi + 1, yi + 1, zi + 1, wi + 1);
  const x00 = c0000 * (1 - u) + c1000 * u;
  const x10 = c0100 * (1 - u) + c1100 * u;
  const x01 = c0010 * (1 - u) + c1010 * u;
  const x11 = c0110 * (1 - u) + c1110 * u;
  const x00b = c0001 * (1 - u) + c1001 * u;
  const x10b = c0101 * (1 - u) + c1101 * u;
  const x01b = c0011 * (1 - u) + c1011 * u;
  const x11b = c0111 * (1 - u) + c1111 * u;
  const y0 = x00 * (1 - v) + x10 * v;
  const y1 = x01 * (1 - v) + x11 * v;
  const y0b = x00b * (1 - v) + x10b * v;
  const y1b = x01b * (1 - v) + x11b * v;
  const z0 = y0 * (1 - t) + y1 * t;
  const z1 = y0b * (1 - t) + y1b * t;
  return z0 * (1 - s) + z1 * s;
}

/**
 * 2D 无缝噪声：把 (u,v)∈[0,1) 嵌入 4D 环面后采样。
 * freqX/freqY 为纹理内噪声周期数（内部取整 → 保证边界对齐无缝）；
 * angleRad 作为环面相位偏移叠加，因加在 2π 整周期上，**任意角度仍严格无缝**。
 * 多层 octave 叠加（lacunarity 倍频、gain 降幅），所有 octave 频率取整 → 整体无缝。
 */
export function tiledFbm(
  u: number,
  v: number,
  freqX: number,
  freqY: number,
  angleRad: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const fx = Math.max(1, Math.round(freqX * lacunarity ** i));
    const fy = Math.max(1, Math.round(freqY * lacunarity ** i));
    const au = TAU * u * fx + angleRad;
    const av = TAU * v * fy;
    sum += amp * valueNoise4D(Math.cos(au), Math.sin(au), Math.cos(av), Math.sin(av));
    norm += amp;
    amp *= gain;
  }
  return sum / norm;
}
