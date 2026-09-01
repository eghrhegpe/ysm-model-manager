#!/usr/bin/env node
/**
 * translucency-probe.ts — 面级透明分类增益探针（度量工具）。
 * 当前前端按「整张纹理」分 transparent 路径（mesh 级粒度）；ModernYSM
 * （upstream TranslucencyScanner）按「cube 面 UV 区域」分级。真实模型上，
 * mesh 级粒度到底误路由多少面？——本脚本在真实模型上量化答案。
 *
 * 定位：ADR-118 §2 决策「探针脚本转正」——保留为度量工具，作为后续任何
 * 透明改动的基线出处（wine_fox 80.9% 错路率基线即本脚本产出）。2026-09 孤儿
 * 审计确认保留：不挂 CI（需 upstream 真实模型语料，扫全量慢），手动按需跑。
 * 与 line-counter / drift-scan / trace-analyze 同为「按需诊断」类。
 *
 * 依赖：node:fs / node:path / node:zlib（零外部依赖）
 *
 * 用法：node scripts/translucency-probe.ts <模型目录...>
 *   目录可含多个模型夹（递归一层找 ysm.json），如：
 *   node scripts/translucency-probe.ts "upstream/[YSM模型]官方开源wine_fox_json"
 *
 * 退出码：0（诊断工具，只输出报告不阻断）。
 *
 * 设计意图：量化 mesh 级 vs 面级透明分类的误路由面积比，为是否引入
 * 面级透明路径（AlphaIndex 思想）提供数据依据。
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ---------- PNG 解码（最小实现：8bit、非隔行） ----------

function decodePng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error("非 PNG");
  let pos = 8;
  let ihdr: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null;
  const idat: Buffer[] = [];
  const palette: Buffer[] = [];
  let trns: Buffer | null = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") palette.push(data);
    else if (type === "tRNS") trns = data;
    pos += 12 + len;
    if (type === "IEND") break;
  }
  if (!ihdr) throw new Error("缺 IHDR");
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  if (interlace) throw new Error("不支持 Adam7 隔行");
  if (bitDepth !== 8) throw new Error(`不支持 bitDepth=${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持 colorType=${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4); // 统一 RGBA
  const pal = palette[0];
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) out.set(cur.subarray(x * 4, x * 4 + 4), o);
      else if (colorType === 2) {
        out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255;
      } else if (colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = cur[x * 2]; out[o + 3] = cur[x * 2 + 1];
      } else if (colorType === 0) {
        out[o] = out[o + 1] = out[o + 2] = cur[x]; out[o + 3] = 255;
      } else if (colorType === 3) {
        const idx = cur[x];
        out[o] = pal[idx * 3]; out[o + 1] = pal[idx * 3 + 1]; out[o + 2] = pal[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    prev = cur;
  }
  return { width, height, rgba: out };
}

// ---------- AlphaIndex：像素 flags + 8×8 tile + 前缀和区域查询 ----------

const TILE = 8;
const F_VISIBLE = 1, F_HOLE = 2, F_TRANSLUCENT = 4;

function flagsForAlpha(a) {
  if (a === 255) return F_VISIBLE;
  if (a === 0) return F_HOLE;
  return F_TRANSLUCENT;
}

class AlphaIndex {
  width: number;
  height: number;
  stride: number;
  grids: Record<string, Int32Array>;
  constructor(png) {
    this.width = png.width;
    this.height = png.height;
    const cols = Math.ceil(this.width / TILE);
    const rows = Math.ceil(this.height / TILE);
    this.stride = cols + 1;
    // 三张前缀和网格：grid[f][(ty+1)*stride + (tx+1)] = tile(0..tx,0..ty) 内 f 计数
    const mk = () => new Int32Array(this.stride * (rows + 1));
    this.grids = { [F_VISIBLE]: mk(), [F_HOLE]: mk(), [F_TRANSLUCENT]: mk() };
    const px = png.rgba;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const f = flagsForAlpha(px[(y * this.width + x) * 4 + 3]);
        const cell = (Math.floor(y / TILE) + 1) * this.stride + (Math.floor(x / TILE) + 1);
        this.grids[f][cell]++;
      }
    }
    for (const g of Object.values(this.grids)) {
      for (let ty = 1; ty < rows + 1; ty++)
        for (let tx = 1; tx < cols + 1; tx++)
          g[ty * this.stride + tx] += g[(ty - 1) * this.stride + tx] + g[ty * this.stride + tx - 1] - g[(ty - 1) * this.stride + tx - 1];
    }
  }

  /** 查询像素矩形 [x0..x1]×[y0..y1] 内各 flags 是否出现 */
  query(x0, y0, x1, y1) {
    const t0x = Math.floor(Math.max(0, x0) / TILE), t1x = Math.floor(Math.min(this.width - 1, x1) / TILE);
    const t0y = Math.floor(Math.max(0, y0) / TILE), t1y = Math.floor(Math.min(this.height - 1, y1) / TILE);
    let flags = 0;
    for (const [f, g] of Object.entries(this.grids)) {
      const n =
        g[(t1y + 1) * this.stride + (t1x + 1)] - g[t0y * this.stride + (t1x + 1)] -
        g[(t1y + 1) * this.stride + t0x] + g[t0y * this.stride + t0x];
      if (n > 0) flags |= Number(f);
    }
    return flags;
  }
}

/** 纹理全局模式——与前端 classifyRgba 同口径：半透明占比超阈→blend；只有全透→cutout */
function globalMode(png, blendMinRatio = 0) {
  let hasHole = false;
  let translucent = 0;
  const px = png.rgba;
  const total = px.length / 4;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    if (a > 0 && a < 255) translucent++;
    else if (a === 0) hasHole = true;
  }
  if (translucent / total > blendMinRatio) return "blend";
  return hasHole ? "cutout" : "opaque";
}

// ---------- Bedrock box-UV 六面矩形 ----------

function boxUvFaces(cube) {
  const [w, h, d] = cube.size ?? [0, 0, 0];
  if (Array.isArray(cube.uv)) {
    if (!cube.uv.length && cube.uv.length !== 0) return [];
    const [u, v] = cube.uv;
    return [
      { face: "east", u0: u, v0: v + d, w: d, h },
      { face: "north", u0: u + d, v0: v + d, w, h },
      { face: "west", u0: u + d + w, v0: v + d, w: d, h },
      { face: "south", u0: u + d + w + d, v0: v + d, w, h },
      { face: "up", u0: u + d, v0: v, w, h: d },
      { face: "down", u0: u + d + w, v0: v, w, h: d },
    ];
  }
  // per-face UV 对象：uv:{north:{uv:[u,v],uv_size:[w,h]},...}；负 size 为翻转，归一化
  const per = cube.uv ?? {};
  const out: { face: string; u0: number; v0: number; w: number; h: number }[] = [];
  for (const face of ["north", "east", "south", "west", "up", "down"]) {
    const f = per[face];
    if (!f?.uv) continue;
    let [u0, v0] = f.uv;
    let [uw, vh] = f.uv_size ?? [0, 0];
    if (uw < 0) { u0 += uw; uw = -uw; }
    if (vh < 0) { v0 += vh; vh = -vh; }
    out.push({ face, u0, v0, w: uw, h: vh });
  }
  return out;
}

function modeOfFlags(flags) {
  if (flags & F_TRANSLUCENT) return "blend";
  if (flags & F_HOLE) return "cutout";
  return "opaque";
}

// ---------- 主流程 ----------

function analyzeModel(modelDir, modelName) {
  const geoDir = path.join(modelDir, "models");
  const texDir = path.join(modelDir, "textures");
  if (!fs.existsSync(geoDir) || !fs.existsSync(texDir)) return null;

  // 加载全部纹理建索引；主纹理 = skin.png 或最大文件
  const texFiles = fs.readdirSync(texDir).filter((f) => f.endsWith(".png"));
  const indexes = new Map();
  const modesOld = new Map();
  const modesThr = new Map();
  for (const f of texFiles) {
    try {
      const png = decodePng(fs.readFileSync(path.join(texDir, f)));
      indexes.set(f, new AlphaIndex(png));
      modesOld.set(f, globalMode(png));
      modesThr.set(f, globalMode(png, 0.005));
    } catch (e) {
      console.warn(`  [skip] ${f}: ${(e as Error).message}`);
    }
  }
  if (!indexes.size) return null;
  const primary = texFiles.includes("skin.png") ? "skin.png" : texFiles[0];
  const idx = indexes.get(primary);
  const texGlobalMode = modesOld.get(primary);
  const texGlobalModeThr = modesThr.get(primary);

  let totalFaces = 0, divergent = 0, blendFaces = 0, cutoutFaces = 0;
  let divArea = 0, totalArea = 0;
  let divergentThr = 0, divAreaThr = 0;
  const modelFiles = fs.readdirSync(geoDir).filter((f) => f.endsWith(".json"));

  for (const mf of modelFiles) {
    let geo;
    try {
      geo = JSON.parse(fs.readFileSync(path.join(geoDir, mf), "utf8"));
    } catch { continue; }
    const bones = geo["minecraft:geometry"]?.[0]?.bones ?? [];
    for (const bone of bones) {
      for (const cube of bone.cubes ?? []) {
        for (const f of boxUvFaces(cube)) {
          if (f.w <= 0 || f.h <= 0) continue;
          const x0 = Math.floor(f.u0 + 0.01), x1 = Math.floor(f.u0 + f.w - 0.01);
          const y0 = Math.floor(f.v0 + 0.01), y1 = Math.floor(f.v0 + f.h - 0.01);
          if (x1 < x0 || y1 < y0) continue;
          totalFaces++;
          const area = (x1 - x0 + 1) * (y1 - y0 + 1);
          totalArea += area;
          const fm = modeOfFlags(idx.query(x0, y0, x1, y1));
          if (fm === "blend") blendFaces++;
          if (fm === "cutout") cutoutFaces++;
          if (fm !== texGlobalMode) { divergent++; divArea += area; }
          // code review：复用上方 hoisted 的 texGlobalModeThr（230 行），
          // 面级循环内不再重复 Map.get(primary)（全模型面数级热循环）
          if (fm !== texGlobalModeThr) { divergentThr++; divAreaThr += area; }
        }
      }
    }
  }
  return { modelName, primary, texGlobalMode, texGlobalModeThr,
    totalFaces, divergent, blendFaces, cutoutFaces,
    divergentThr, divAreaRatioThr: totalArea ? (divAreaThr / totalArea) : 0,
    divAreaRatio: totalArea ? (divArea / totalArea) : 0,
    mixedTextures: [...modesOld.entries()].filter(([, m]) => m !== "opaque").map(([n, m]) => `${n}:${m}`) };
}

// 入口：每个参数目录递归一层找含 ysm.json 的模型夹
const roots = process.argv.slice(2);
if (!roots.length) {
  console.error("用法: node scripts/translucency-probe.ts <模型目录...>");
  process.exit(1);
}

const dirs: string[] = [];
for (const root of roots) {
  if (fs.existsSync(path.join(root, "ysm.json"))) dirs.push(root);
  else for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(root, e.name, "ysm.json"))) dirs.push(path.join(root, e.name));
  }
}
dirs.sort();

console.log(`探测 ${dirs.length} 个模型 | 主纹理面级 vs 全局模式差异\n`);
const rows: any[] = [];
for (const d of dirs) {
  const r = analyzeModel(d, path.basename(d));
  if (r) rows.push(r);
}

console.log(
  "模型".padEnd(18) + "旧→新模式".padEnd(12) +
  "总面数".padStart(7) + "错路面".padStart(7) + "错路面积%".padStart(9) +
  "新错路面".padStart(8) + "blend面".padStart(8) + "cutout面".padStart(8)
);
for (const r of rows) {
  console.log(
    r.modelName.slice(0, 16).padEnd(18) +
    `${r.texGlobalMode}→${r.texGlobalModeThr}`.padEnd(12) +
    String(r.totalFaces).padStart(7) + String(r.divergent).padStart(7) +
    (r.divAreaRatio * 100).toFixed(1).padStart(8) + "%" +
    String(r.divergentThr).padStart(8) +
    String(r.blendFaces).padStart(8) + String(r.cutoutFaces).padStart(8)
  );
}
const totFaces = rows.reduce((s, r) => s + r.totalFaces, 0);
const totDiv = rows.reduce((s, r) => s + r.divergent, 0);
const totDivThr = rows.reduce((s, r) => s + r.divergentThr, 0);
console.log(`\n合计 ${rows.length} 模型 ${totFaces} 面`);
console.log(`  旧口径（无阈值）错路 ${totDiv} 面` +
  (totFaces ? `（${((totDiv / totFaces) * 100).toFixed(1)}%）` : ""));
console.log(`  新口径（阈值 0.5%）错路 ${totDivThr} 面` +
  (totFaces ? `（${((totDivThr / totFaces) * 100).toFixed(1)}%）` : ""));
