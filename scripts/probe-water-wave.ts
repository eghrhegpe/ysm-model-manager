#!/usr/bin/env node
/**
 * probe-water-wave.ts — 水面 Gerstner 波场数值探针（观感成立性的实证量具）
 *
 * 描述：用 JS 逐式复刻 `frontend/src/preview-3d/caps/water-capability.ts|buildWaveWaterMaterial`
 *   注入的 `gerstner()`——同一套 hash 播种 / 频率级数 / 振幅钳制 / 陡度上界 / 抗锯齿淡出 /
 *   Jacobian 泡沫判据，在「网格 × 时间」上做数值扫描，输出五张表：
 *     ① 标定：复现 ADR-257 §6.4 的几何法线 vs 解析法线夹角（先自证探针复刻忠实度）；
 *     ② 波高：默认参数下的峰/谷/RMS，对照容器（池壁顶、地面）算越界**采样占比**；
 *     ③ 泡沫可达性：J 的全域最小值与 `J ≤ 0` / `J ≤ -0.25` 占比（判据是否永不可达）；
 *     ④ 频谱-尺度匹配：可呈现波长窗口与当前钉死波谱的重叠数，附尺寸域扫描对照；
 *     ⑤ 处方对照：λ 锚定域宽 + 振幅按域宽归一 + 容器钳制后的同一组指标。
 * 设计意图：波形的「对不对」是数值命题，不是审美命题——「浪比池子高」「泡沫恒不触发」
 *   「大水面高频被砍光」都无法靠拖滑块看屏幕证伪。本探针把这些命题变成可复跑的表，
 *   供 ADR 数据溯源与知识卡陷阱条目引用。它是**量具不是门禁**（退出码恒 0），
 *   实施时的回归断言应落进 `water-capability.test.ts`，不靠本脚本守红。
 * 依赖：零外部依赖（scripts/_lib/parse-args.ts）
 *
 * 用法：
 *   node scripts/probe-water-wave.ts                                  # 默认取 schema 现值
 *   node scripts/probe-water-wave.ts --json                            # 结构化输出
 *   node scripts/probe-water-wave.ts --size 300 --choppiness 1
 *   node scripts/probe-water-wave.ts --depth 5 --level 0.3 --amp 0.004
 *   node scripts/probe-water-wave.ts --help
 *
 * 退出码：恒 0（量具）；--help 亦 0。
 */
import { parseArgs } from "./_lib/parse-args.ts";

/* ═══════════ 复刻 GLSL（逐项对应 water-capability.ts 的注入串） ═══════════ */

/** shader 字面量 2π（GLSL 写的是 6.2831853，保留同一截断，不用 Math.PI*2） */
const TWO_PI = 6.2831853;
const GERSTNER_COUNT = 6;
/** water-state.ts|WATER_WAVE_SEGMENTS —— 波场采样密度唯一事实源 */
const SEGMENTS_DEFAULT = 64;
/** GLSL: float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); } */
function fract(x: number): number {
  return x - Math.floor(x);
}
function hash11(n: number): number {
  return fract(Math.sin(n * 127.1) * 43758.5453);
}
/** GLSL smoothstep(edge0, edge1, x) */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 逐波常数表 —— `freq / amp / aa / steep` 与 shader 同一写法 */
function buildWaves(size: number, choppiness: number, segments: number) {
  const spacing = Math.max(size, 0.001) / segments;
  const waves = [];
  for (let i = 0; i < GERSTNER_COUNT; i++) {
    const ang = hash11(i + 1.0) * TWO_PI;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const freq = 0.25 * 1.19 ** i;
    const ampDesigned = (0.6 * 0.82 ** i) / freq;
    const ampClamped = Math.min(ampDesigned, 0.5);
    const waveLen = TWO_PI / freq;
    const aa = Math.max(smoothstep(2.0, 6.0, waveLen / spacing), 0.001);
    const amp = ampClamped * aa;
    const speed = Math.sqrt(9.8 * freq);
    const wa = freq * amp;
    const steep = clamp((choppiness * 0.8) / (wa * GERSTNER_COUNT), 0, 0.8 / (wa * GERSTNER_COUNT));
    waves.push({
      i,
      dir,
      freq,
      ampDesigned,
      ampClamped,
      waveLen,
      aa,
      amp,
      speed,
      wa,
      steep,
      spacing,
    });
  }
  return waves;
}

type Wave = {
  i: number;
  dir: { x: number; y: number };
  freq: number;
  amp: number;
  waveLen: number;
  aa: number;
  speed: number;
  wa: number;
  steep: number;
  spacing: number;
};

function phase(w: Wave, px: number, py: number, t: number): number {
  return w.freq * (w.dir.x * px + w.dir.y * py) - w.speed * t;
}
/** GLSL: disp.z += amp * s（世界高度位移，未乘 steep，也未乘任何尺度） */
function heightAt(waves: Wave[], px: number, py: number, t: number): number {
  let h = 0;
  for (const w of waves) h += w.amp * Math.sin(phase(w, px, py, t));
  return h;
}
/** GLSL: disp.x/y += steep * amp * dir * c（世界水平位移，随后 /uSize 加进局部坐标） */
function horizAt(waves: Wave[], px: number, py: number, t: number) {
  let x = 0;
  let y = 0;
  for (const w of waves) {
    const c = Math.cos(phase(w, px, py, t));
    x += w.steep * w.amp * w.dir.x * c;
    y += w.steep * w.amp * w.dir.y * c;
  }
  return { x, y };
}
/** GLSL: J = (1+jxx)(1+jzz) - jxz² ; foam = smoothstep(0.0, -0.25, J) */
function jacobianAt(waves: Wave[], px: number, py: number, t: number): number {
  let jxx = 0;
  let jzz = 0;
  let jxz = 0;
  for (const w of waves) {
    const c = Math.cos(phase(w, px, py, t));
    const q = w.steep * w.wa * c;
    jxx += q * w.dir.x * w.dir.x;
    jzz += q * w.dir.y * w.dir.y;
    jxz += q * w.dir.x * w.dir.y;
  }
  return (1 + jxx) * (1 + jzz) - jxz * jxz;
}

/* ═══════════ ① 标定：复现 ADR-257 §6.4 法线夹角（探针忠实度自证） ═══════════ */

/** 解析法线：shader 交付**物体空间**法线（水平 ×uSize）；换回世界方向须 ÷uSize（成对换算） */
function analyticWorldNormal(waves: Wave[], px: number, py: number, t: number, size: number) {
  let nx = 0;
  let ny = 0;
  let nz = 1;
  for (const w of waves) {
    const ph = phase(w, px, py, t);
    nx -= w.dir.x * w.wa * Math.cos(ph) * size;
    ny -= w.dir.y * w.wa * Math.cos(ph) * size;
    nz -= w.steep * w.wa * Math.sin(ph);
  }
  const wx = nx / size;
  const wy = ny / size;
  const len = Math.hypot(wx, wy, nz) || 1;
  return { x: wx / len, y: wy / len, z: nz / len };
}
/** 几何法线：参数化曲面 W(u,v) 中心差分叉积（u,v = 局部平面坐标，×size 落世界） */
function geometricWorldNormal(
  waves: Wave[],
  size: number,
  u: number,
  v: number,
  t: number,
  segments: number,
) {
  const d = 1 / (segments * 4);
  const at = (uu: number, vv: number) => {
    const px = uu * size;
    const py = vv * size;
    const h = horizAt(waves, px, py, t);
    return { x: px + h.x, y: py + h.y, z: heightAt(waves, px, py, t) };
  };
  const a = at(u + d, v);
  const b = at(u - d, v);
  const c = at(u, v + d);
  const e = at(u, v - d);
  const tu = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const tv = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z };
  const n = {
    x: tu.y * tv.z - tu.z * tv.y,
    y: tu.z * tv.x - tu.x * tv.z,
    z: tu.x * tv.y - tu.y * tv.x,
  };
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}
function calibrate(waves: Wave[], size: number, segments: number, t: number, grid = 32) {
  let sum = 0;
  let max = 0;
  let count = 0;
  for (let ix = 1; ix < grid; ix++) {
    for (let iy = 1; iy < grid; iy++) {
      const u = ix / grid - 0.5;
      const v = iy / grid - 0.5;
      const an = analyticWorldNormal(waves, u * size, v * size, t, size);
      const g = geometricWorldNormal(waves, size, u, v, t, segments);
      const deg = (Math.acos(clamp(an.x * g.x + an.y * g.y + an.z * g.z, -1, 1)) * 180) / Math.PI;
      sum += deg;
      max = Math.max(max, deg);
      count++;
    }
  }
  return { meanDeg: sum / count, maxDeg: max };
}

/* ═══════════ ②③ 波高 + 越界占比 + 泡沫可达性 ═══════════ */

function scan(
  waves: Wave[],
  size: number,
  opts: { level: number; wallTop: number; axis?: number; steps?: number },
) {
  const axis = opts.axis ?? 32;
  const steps = opts.steps ?? 12;
  const half = size / 2;
  let hMax = -Infinity;
  let hMin = Infinity;
  let sq = 0;
  let jMin = Infinity;
  let jLe0 = 0;
  let jLeNeg025 = 0;
  let aboveWall = 0;
  let belowGround = 0;
  let n = 0;
  const t0 = (TWO_PI / waves[0]!.speed) * 0.37;
  for (let it = 0; it < steps; it++) {
    const t = t0 + (it / steps) * (TWO_PI / waves[0]!.speed);
    for (let ix = 0; ix <= axis; ix++) {
      for (let iy = 0; iy <= axis; iy++) {
        const px = -half + (size * ix) / axis;
        const py = -half + (size * iy) / axis;
        const h = heightAt(waves, px, py, t);
        hMax = Math.max(hMax, h);
        hMin = Math.min(hMin, h);
        sq += h * h;
        if (opts.level + h > opts.wallTop) aboveWall++;
        if (opts.level + h < 0) belowGround++;
        const j = jacobianAt(waves, px, py, t);
        jMin = Math.min(jMin, j);
        if (j <= 0) jLe0++;
        if (j <= -0.25) jLeNeg025++;
        n++;
      }
    }
  }
  return {
    hMax,
    hMin,
    peakToTrough: hMax - hMin,
    rms: Math.sqrt(sq / n),
    jMin,
    foamRatio: jLe0 / n,
    fullFoamRatio: jLeNeg025 / n,
    aboveWallRatio: aboveWall / n,
    belowGroundRatio: belowGround / n,
    samples: n,
  };
}

/* ═══════════ ④ 频谱-尺度窗口 ═══════════ */

/** 可呈现窗口：verts/λ ≥ 6（aa 全留）到 λ ≤ size/2（域内至少半个波长） */
function windowFor(size: number, segments: number) {
  return { lambdaMin: (6 * size) / segments, lambdaMax: size / 2 };
}
function spectrumFit(waves: Wave[], size: number, segments: number) {
  const w = windowFor(size, segments);
  return {
    window: w,
    inside: waves.filter((x) => x.waveLen >= w.lambdaMin && x.waveLen <= w.lambdaMax).length,
    faded: waves.filter((x) => x.aa < 0.999).length,
    longerThanDomain: waves.filter((x) => x.waveLen > size).length,
  };
}

/* ═══════════ ⑤ 处方：λ 锚定域宽 + 振幅按域宽归一 + 容器钳制 ═══════════ */

/**
 * 处方波谱（只换「频率锚点与振幅量纲」，Gerstner 骨架 / 解析法线 / 成对换算不动）：
 *   λ_i = size / (baseN · 1.19^i)      → 每域波长数随 i 递增，采样密度与尺度无关
 *   amp_i = waveHeight · size / 1.19^i → 振幅随域宽归一（A ∝ λ，量纲无量纲化）
 *   双向往容器钳制：Σ amp ≤ min(0.25·poolHeight, level)
 *     上钳＝波峰不过池壁顶（pool 语义，池深是可用高度）
 *     下钳＝波谷不穿地面（film 语义，水位是水面到地面的净空）
 */
function buildPrescription(
  size: number,
  choppiness: number,
  segments: number,
  waveHeight: number,
  poolHeight: number | null,
  level = 0.01,
  ampBudget = 0.25,
  baseN = 4,
) {
  const spacing = size / segments;
  const waves: Wave[] = [];
  let sumAmp = 0;
  for (let i = 0; i < GERSTNER_COUNT; i++) {
    const ang = hash11(i + 1.0) * TWO_PI;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const waveLen = size / (baseN * 1.19 ** i);
    const freq = TWO_PI / waveLen;
    const amp = (waveHeight * size) / 1.19 ** i;
    sumAmp += amp;
    const speed = Math.sqrt(9.8 * freq);
    const wa = freq * amp;
    const steep = clamp((choppiness * 0.8) / (wa * GERSTNER_COUNT), 0, 0.8 / (wa * GERSTNER_COUNT));
    waves.push({
      i,
      dir,
      freq,
      amp,
      waveLen,
      aa: smoothstep(2, 6, waveLen / spacing),
      speed,
      wa,
      steep,
      spacing,
    });
  }
  // 双向往钳制预算：池深给上空间、水位给下空间，取小者（film 无容器 → 预算即水位净空）
  const depthBudget = poolHeight === null ? Number.POSITIVE_INFINITY : ampBudget * poolHeight;
  const budget = Math.min(depthBudget, Math.max(level, 0));
  if (sumAmp > 0 && budget < sumAmp) {
    const k = budget / sumAmp;
    for (const w of waves) {
      w.amp *= k;
      w.wa = w.freq * w.amp;
      w.steep = clamp(
        (choppiness * 0.8) / (w.wa * GERSTNER_COUNT),
        0,
        0.8 / (w.wa * GERSTNER_COUNT),
      );
    }
  }
  return waves;
}

/* ═══════════ 主流程 ═══════════ */

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}
function f3(x: number): string {
  return (Math.round(x * 1000) / 1000).toFixed(3);
}
function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["json"],
    strings: ["size", "choppiness", "segments", "level", "depth", "amp"],
  });
  if (args.unknown.length) console.warn(`忽略未知参数: ${args.unknown.join(", ")}`);
  if (args.help) {
    console.log(
      "用法: node scripts/probe-water-wave.ts [--json] [--size N] [--choppiness N] [--segments N]\n" +
        "                                  [--level N] [--depth N] [--amp N]\n" +
        "  depth = waterPoolHeight（池深，处方容器钳制用）；amp = 归一浪高（处方参数，默认 0.004）",
    );
    return 0;
  }

  // 默认值全部取 env-state-schema.ts 的 water 组现值
  const size = num(args.size, 80);
  const choppiness = num(args.choppiness, 0.5);
  const segments = num(args.segments, SEGMENTS_DEFAULT);
  const level = num(args.level, 0.01);
  const depth = num(args.depth, 0.3);
  const waveHeight = num(args.amp, 0.004);

  const wallThickness = 0.15;
  const wallTop = depth + Math.max(0.02, wallThickness * 0.6); // body-strategies|applyTransformLinks
  const opts = { level, wallTop };

  const waves = buildWaves(size, choppiness, segments);
  const cal = calibrate(waves, size, segments, 1.37);
  const s = scan(waves, size, opts);
  const sFull = scan(buildWaves(size, 1.0, segments), size, opts);
  const sCalm = scan(buildWaves(size, 0.0, segments), size, opts);
  const fit = spectrumFit(waves, size, segments);

  const presc = buildPrescription(size, choppiness, segments, waveHeight, depth, level);
  const ps = scan(presc, size, opts);
  const pfit = spectrumFit(presc, size, segments);
  // 处方第二档：水位抬到 0.06（= 建议默认值），验证「预算不再被水位卡死」后的幅度
  const level2 = Math.max(level, 0.06);
  const presc2 = buildPrescription(size, choppiness, segments, waveHeight, depth, level2);
  const ps2 = scan(presc2, size, { level: level2, wallTop });

  const sweep = [10, 20, 40, 80, 160, 300].map((sz) => {
    const w = buildWaves(sz, choppiness, segments);
    const r = scan(w, sz, opts);
    const fw = spectrumFit(w, sz, segments);
    const pw = buildPrescription(sz, choppiness, segments, waveHeight, depth, level2);
    const pr = scan(pw, sz, { level: level2, wallTop });
    const fp = spectrumFit(pw, sz, segments);
    return { size: sz, current: r, fit: fw, prescribed: pr, pfit: fp };
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          inputs: { size, choppiness, segments, level, depth, waveHeight, wallTop },
          calibration: cal,
          current: {
            waves: waves.map((w) => ({
              i: w.i,
              freq: w.freq,
              lambda: w.waveLen,
              ampDesigned: (0.6 * 0.82 ** w.i) / w.freq,
              amp: w.amp,
              aa: w.aa,
              steep: w.steep,
            })),
            ...s,
            steepSum: waves.reduce((a, w) => a + w.steep * w.wa, 0),
            calm: sCalm,
            full: sFull,
            fit,
          },
          prescription: {
            atCurrentLevel: { ...ps, fit: pfit, budget: Math.min(0.25 * depth, level) },
            atLevel006: {
              ...ps2,
              fit: spectrumFit(presc2, size, segments),
              budget: Math.min(0.25 * depth, level2),
            },
          },
          sizeSweep: sweep.map((r) => ({
            size: r.size,
            current: {
              peakToTrough: r.current.peakToTrough,
              rms: r.current.rms,
              aboveWallRatio: r.current.aboveWallRatio,
              belowGroundRatio: r.current.belowGroundRatio,
              faded: r.fit.faded,
              insideWindow: r.fit.inside,
              longerThanDomain: r.fit.longerThanDomain,
            },
            prescribed: {
              peakToTrough: r.prescribed.peakToTrough,
              rms: r.prescribed.rms,
              aboveWallRatio: r.prescribed.aboveWallRatio,
              belowGroundRatio: r.prescribed.belowGroundRatio,
              faded: r.pfit.faded,
              insideWindow: r.pfit.inside,
              longerThanDomain: r.pfit.longerThanDomain,
            },
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const L = (t = "") => console.log(t);
  L(
    `水面波场探针   size=${size}m  choppiness=${choppiness}  segments=${segments}  level=${level}m  poolHeight=${depth}m  池壁顶 y=${f3(wallTop)}m`,
  );
  L("─".repeat(100));
  L("① 标定（探针忠实度自证；对照 ADR-257 §6.4 实测：修正后 2.40° / 7.02°）");
  L(
    `   解析法线 vs 几何法线夹角：平均 ${f3(cal.meanDeg)}°  最大 ${f3(cal.maxDeg)}°  ← 落在同量级即证明本探针复刻无偏差`,
  );
  L("");
  L("② 波谱与波高（当前实现）");
  L("   i   freq(rad/m)  λ(m)     amp设计   min钳后   aa      amp实    σ(steep)");
  for (const w of waves) {
    L(
      `   ${w.i}   ${f3(w.freq).padEnd(12)} ${f3(w.waveLen).padEnd(8)} ${f3((0.6 * 0.82 ** w.i) / w.freq).padEnd(9)} ${f3(Math.min((0.6 * 0.82 ** w.i) / w.freq, 0.5)).padEnd(9)} ${f3(w.aa).padEnd(7)} ${f3(w.amp).padEnd(7)} ${f3(w.steep)}`,
    );
  }
  L(`   峰 ${f3(s.hMax)}m  谷 ${f3(s.hMin)}m  峰谷差 ${f3(s.peakToTrough)}m  RMS ${f3(s.rms)}m`);
  L(
    `   → 越壁：${pct(s.aboveWallRatio)} 采样点的水面高于池壁顶（默认 h=${depth}m，壁顶 ${f3(wallTop)}m）`,
  );
  L(`   → 穿地：${pct(s.belowGroundRatio)} 采样点的水面低于 y=0 地面（水膜基准 level=${level}m）`);
  L(
    `   → 静水不可达：σ(choppiness)=0 时峰谷差仍 ${f3(sCalm.peakToTrough)}m（amp 不进 steep 链，高度独立于尖度）`,
  );
  L("");
  L("③ 泡沫判据可达性（GLSL: foam = smoothstep(0.0, -0.25, J)，要求 J ≤ 0）");
  L(
    `   Σ σ·k = ${f3(waves.reduce((a, w) => a + w.steep * w.wa, 0))}（choppiness=${choppiness}，shader 上界 0.8）`,
  );
  L(
    `   J_min = ${f3(s.jMin)}   J ≤ 0 占比 ${pct(s.foamRatio)}   J ≤ -0.25 占比 ${pct(s.fullFoamRatio)}`,
  );
  L(
    `   拖满 choppiness=1：J_min = ${f3(sFull.jMin)}，J ≤ 0 占比 ${pct(sFull.foamRatio)} → 防自交钳制（Σ≤0.8）与泡沫判据（J≤0）互斥，vFoam 恒 0`,
  );
  L("");
  L("④ 频谱-尺度匹配（λ 钉死世界米制 vs 采样可呈现窗口）");
  L(
    `   窗口 λ ∈ [${f3(fit.window.lambdaMin)}, ${f3(fit.window.lambdaMax)}]m（verts/λ ≥ 6 且 λ ≤ size/2）`,
  );
  L(
    `   六波：落在窗口内 ${fit.inside} 条 / 被 aa 淡出 ${fit.faded} 条 / 波长 > 域宽 ${fit.longerThanDomain} 条`,
  );
  L(
    "   尺寸域扫描（当前实现 → 处方@level=0.06；「淡出」= 被 aa 砍掉的波数，「>域宽」= 波长大于域宽的波数）：",
  );
  L(
    "   size  当前峰谷差 当前RMS 越壁%  穿地%  淡出 窗口内>域宽 | 处方峰谷差 处方RMS 越壁%  穿地%  淡出 窗口内",
  );
  for (const r of sweep) {
    L(
      `   ${String(r.size).padEnd(5)} ${f3(r.current.peakToTrough).padEnd(10)} ${f3(r.current.rms).padEnd(8)} ${(r.current.aboveWallRatio * 100).toFixed(1).padEnd(6)} ${(r.current.belowGroundRatio * 100).toFixed(1).padEnd(6)} ${String(r.fit.faded).padEnd(4)} ${r.fit.inside}/${r.fit.longerThanDomain}      | ${f3(r.prescribed.peakToTrough).padEnd(10)} ${f3(r.prescribed.rms).padEnd(8)} ${(r.prescribed.aboveWallRatio * 100).toFixed(1).padEnd(6)} ${(r.prescribed.belowGroundRatio * 100).toFixed(1).padEnd(6)} ${String(r.pfit.faded).padEnd(4)} ${r.pfit.inside}`,
    );
  }
  L("");
  L(
    `⑤ 处方对照（λ_i = size/(4·1.19^i)，amp_i = amp·size/1.19^i，双向往钳制 Σamp ≤ min(0.25·depth, level)；amp=${waveHeight}）`,
  );
  L(
    `   现默认 level=${level}m → 预算 min(${f3(0.25 * depth)}, ${f3(level)}) = ${f3(Math.min(0.25 * depth, level))}m：`,
  );
  L(
    `     峰 ${f3(ps.hMax)}m 谷 ${f3(ps.hMin)}m 峰谷差 ${f3(ps.peakToTrough)}m RMS ${f3(ps.rms)}m  越壁 ${pct(ps.aboveWallRatio)} 穿地 ${pct(ps.belowGroundRatio)}  淡出 ${pfit.faded} 条 窗口内 ${pfit.inside} 条`,
  );
  L(`   建议默认 level=${level2}m → 预算 ${f3(Math.min(0.25 * depth, level2))}m：`);
  const p2fit = spectrumFit(presc2, size, segments);
  L(
    `     峰 ${f3(ps2.hMax)}m 谷 ${f3(ps2.hMin)}m 峰谷差 ${f3(ps2.peakToTrough)}m RMS ${f3(ps2.rms)}m  越壁 ${pct(ps2.aboveWallRatio)} 穿地 ${pct(ps2.belowGroundRatio)}  淡出 ${p2fit.faded} 条 窗口内 ${p2fit.inside} 条`,
  );
  L(
    "   → 处方只换「频率锚点 + 振幅量纲 + 容器预算」；Gerstner 骨架、解析法线、成对换算、泡沫通道全部不动。",
  );
  L(
    "   → 归一浪高要生效，水位默认值必须同时抬（否则预算被 level 卡死，波退化成平面）——这条是探针跑出来的，不是拍的。",
  );
  return 0;
}

process.exit(main());
