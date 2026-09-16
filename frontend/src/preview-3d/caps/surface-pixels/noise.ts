// ===== surface-pixels/noise.ts — 纯噪声原语（零 three / 零 DOM，node 可测）=====
// 供各材质像素生成器共享：valueNoise 为基础，fbm 为多层叠加（domain warping 用）。

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
