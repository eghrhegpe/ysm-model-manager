#!/usr/bin/env node
/**
 * 非主模型 UV 口径对拍 mjs
 *
 * 用法: node tests/port-verification/scan-non-main-uv.mjs
 *
 * 对拍维度：
 *   1. 每个模型文件的 texture_width/texture_height（cube 归一化分母）
 *   2. 每个 cube 的 UV 起点是否在自身纹理维度内（越界 = 采样到相邻纹理或全黑）
 *   3. 非主模型（arrow/trident/boat/foxcar/minecart/horse/plane）的 TexSlot 是否越界
 *   4. 主模型 vs 非主模型的 texW/texH 差异（UV 归一化口径不一致隐患）
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const FOX = join(ROOT, 'upstream', '[YSM模型]官方开源wine_fox_json');

// 非主模型识别：投射物/载具/坐骑等
const NON_MAIN_KEYWORDS = ['arrow', 'trident', 'boat', 'foxcar', 'minecart', 'horse', 'plane', 'gma', 'vehicle', 'projectile'];
function isNonMainModel(modelFile) {
  const bn = basename(modelFile).toLowerCase().replace(/\.geo\.json$/, '').replace(/\.json$/, '');
  return NON_MAIN_KEYWORDS.some(kw => bn.includes(kw));
}

// 归一化纹理名：textures/skin.png → skin
function normalizeTexName(rawPath) {
  let tn = rawPath;
  if (tn.includes('/')) tn = tn.slice(tn.lastIndexOf('/') + 1);
  if (tn.includes('\\')) tn = tn.slice(tn.lastIndexOf('\\') + 1);
  tn = tn.toLowerCase().replace(/\.png$/, '').replace(/\.jpg$/, '');
  return tn;
}

// ===== 解析 ysm.json，建立权威 texOrder + modelTexMap =====
function parseYsmAuthority(ysmPath) {
  const raw = JSON.parse(readFileSync(ysmPath, 'utf-8'));
  const files = raw.files || raw.Files || {};

  const texOrder = [];      // 权威纹理顺序（小写 basename 去扩展名）
  const modelTexMap = {};   // 模型文件路径 → 应绑纹理名

  // --- player.texture[] → texOrder（可切换皮肤集）---
  const playerTex = files.player?.texture;
  if (Array.isArray(playerTex)) {
    for (const t of playerTex) {
      if (typeof t === 'string') texOrder.push(normalizeTexName(t));
      else if (t && typeof t === 'object') {
        const uv = t.uv || t.texture;
        if (uv) texOrder.push(normalizeTexName(uv));
      }
    }
  } else if (typeof playerTex === 'object' && playerTex !== null) {
    const uv = playerTex.uv || playerTex.texture;
    if (uv) texOrder.push(normalizeTexName(uv));
  } else if (typeof playerTex === 'string') {
    texOrder.push(normalizeTexName(playerTex));
  }

  // --- player.model → 主体模型，绑 player.texture[0]（默认皮肤）---
  const defaultSkin = texOrder[0] || null;
  const pModel = files.player?.model;
  if (pModel) {
    if (Array.isArray(pModel)) {
      for (const item of pModel) {
        if (typeof item === 'string') modelTexMap[item] = defaultSkin;
        else if (item && typeof item === 'object') {
          const p = item.path || item.name;
          if (p) modelTexMap[p] = defaultSkin;
        }
      }
    } else if (typeof pModel === 'object') {
      for (const key of Object.keys(pModel)) {
        const val = pModel[key];
        if (typeof val === 'string') modelTexMap[val] = defaultSkin;
      }
    } else if (typeof pModel === 'string') {
      modelTexMap[pModel] = defaultSkin;
    }
  }

  // --- projectiles/vehicles/arrow → 投射物/载具/单实体模型 ---
  for (const segKey of ['projectiles', 'Projectiles', 'vehicles', 'Vehicles', 'arrow', 'Arrow']) {
    const segRaw = files[segKey];
    if (!segRaw) continue;
    let entries;
    if (Array.isArray(segRaw)) {
      entries = segRaw;
    } else if (typeof segRaw === 'object' && segRaw !== null) {
      // 区分 {model,texture}（单实体）vs {minecraft:xxx: config}（dict）
      const isConfigDict = typeof segRaw.model === 'string' || typeof segRaw.texture === 'string' || typeof segRaw.texture === 'object';
      if (isConfigDict) {
        entries = [segRaw];
      } else {
        entries = Object.values(segRaw);
      }
    } else {
      continue;
    }
    for (const p of entries) {
      if (!p || typeof p !== 'object') continue;
      const tex = p.texture;
      let texName = null;
      if (typeof tex === 'string') texName = normalizeTexName(tex);
      else if (tex && typeof tex === 'object') {
        const uv = tex.uv || tex.texture;
        if (uv) texName = normalizeTexName(uv);
      }
      if (p.model && texName) {
        modelTexMap[p.model] = texName;
        if (!texOrder.includes(texName)) texOrder.push(texName);
      }
    }
  }

  return { texOrder, modelTexMap, defaultSkin };
}

// ===== 解析 Bedrock JSON，提取 texture_width/texture_height + cube UV =====
function parseBedrockJson(jsonPath) {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const geo = raw['minecraft:geometry']?.[0];
  if (!geo) return null;

  const desc = geo.description || {};
  const texW = desc.texture_width || 0;
  const texH = desc.texture_height || 0;

  const cubes = [];
  for (const bone of (geo.bones || [])) {
    for (const cube of (bone.cubes || [])) {
      // cube 有两种 UV 形态：box UV（uv:[x,y]）或 per-face UV（uv:{north:{uv:[x,y],uv_size:[w,h]},...}）
      let uvInfo = null;
      if (cube.uv) {
        if (Array.isArray(cube.uv)) {
          // box UV: [u, v]，尺寸从 cube.size 推导
          uvInfo = {
            type: 'box',
            u: cube.uv[0],
            v: cube.uv[1],
            size: cube.size || [0, 0, 0],
            faces: null,
          };
        } else if (typeof cube.uv === 'object') {
          // per-face UV: {north: {uv:[x,y], uv_size:[w,h]}, ...}
          const faces = {};
          for (const [faceName, faceData] of Object.entries(cube.uv)) {
            if (Array.isArray(faceData)) {
              // [u, v] 简写
              faces[faceName] = { u: faceData[0], v: faceData[1], w: 0, h: 0 };
            } else if (typeof faceData === 'object') {
              const fu = faceData.uv || [0, 0];
              const fs = faceData.uv_size || [0, 0];
              faces[faceName] = { u: fu[0], v: fu[1], w: fs[0], h: fs[1] };
            }
          }
          uvInfo = { type: 'perFace', u: 0, v: 0, size: cube.size || [0, 0, 0], faces };
        }
      }
      cubes.push({
        bone: bone.name,
        uv: uvInfo,
        origin: cube.origin || [0, 0, 0],
        size: cube.size || [0, 0, 0],
      });
    }
  }

  return { texW, texH, cubes, modelId: desc.identifier || '?' };
}

// ===== 对拍单套模型 =====
function scanModel(modelDir) {
  const name = basename(modelDir);
  const ysmPath = join(modelDir, 'ysm.json');
  const modelsDir = join(modelDir, 'models');

  const { texOrder, modelTexMap, defaultSkin } = parseYsmAuthority(ysmPath);

  let modelFiles = [];
  try {
    modelFiles = readdirSync(modelsDir).filter(f => f.endsWith('.json')).sort();
  } catch { /* 无 models 目录 */ }

  const issues = [];
  const modelProfiles = [];

  for (const mf of modelFiles) {
    const modelPath = join(modelsDir, mf);
    const parsed = parseBedrockJson(modelPath);
    if (!parsed) continue;

    const { texW, texH, cubes, modelId } = parsed;
    const isNonMain = isNonMainModel(mf);
    const expectedTex = modelTexMap[mf] || modelTexMap[`models/${mf}`] || null;

    modelProfiles.push({
      file: mf,
      modelId,
      texW,
      texH,
      cubeCount: cubes.length,
      isNonMain,
      expectedTex,
    });

    // 检查 1: cube UV 起点是否在自身纹理维度内
    for (let ci = 0; ci < cubes.length; ci++) {
      const cube = cubes[ci];
      if (!cube.uv) continue;

      if (cube.uv.type === 'box') {
        // box UV: 检查 u, v 和展开后的所有面 UV 是否越界
        const u = cube.uv.u;
        const v = cube.uv.v;
        const [sx, sy, sz] = cube.uv.size;

        // expandBoxUV 展开后的 6 面 UV 范围
        // 面 0: u, v+sz, w=sz, h=sy
        // 面 1: u+sz+sx, v+sz, w=sz, h=sy
        // 面 2: u+sz+sx, v+sz, w=-sx, h=-sz（负向）
        // 面 3: u+sz+sx+sx, v, w=-sx, h=sz
        // 面 4: u+sz+sz+sx, v+sz, w=sx, h=sy
        // 面 5: u+sz, v+sz, w=sx, h=sy
        const faceUVs = [
          { u, v: v + sz, w: sz, h: sy },
          { u: u + sz + sx, v: v + sz, w: sz, h: sy },
          { u: u + sz + sx, v: v + sz, w: -sx, h: -sz },
          { u: u + sz + sx + sx, v, w: -sx, h: sz },
          { u: u + sz + sz + sx, v: v + sz, w: sx, h: sy },
          { u: u + sz, v: v + sz, w: sx, h: sy },
        ];

        for (let fi = 0; fi < 6; fi++) {
          const f = faceUVs[fi];
          // 检查 UV 起点和终点是否越界（允许负向 w/h）
          const uEnd = f.u + f.w;
          const vEnd = f.v + f.h;
          if (f.u < 0 || f.u > texW || uEnd < 0 || uEnd > texW) {
            issues.push({
              type: 'UV 越界',
              model: mf,
              cube: ci,
              face: fi,
              detail: `u=${f.u} w=${f.w} uEnd=${uEnd} texW=${texW}（U 轴越界）`,
            });
          }
          if (f.v < 0 || f.v > texH || vEnd < 0 || vEnd > texH) {
            issues.push({
              type: 'UV 越界',
              model: mf,
              cube: ci,
              face: fi,
              detail: `v=${f.v} h=${f.h} vEnd=${vEnd} texH=${texH}（V 轴越界）`,
            });
          }
        }
      } else if (cube.uv.type === 'perFace' && cube.uv.faces) {
        // per-face UV: 检查每面的 u, v, w, h 是否越界
        for (const [faceName, faceData] of Object.entries(cube.uv.faces)) {
          const uEnd = faceData.u + faceData.w;
          const vEnd = faceData.v + faceData.h;
          if (faceData.u < 0 || faceData.u > texW || uEnd < 0 || uEnd > texW) {
            issues.push({
              type: 'UV 越界',
              model: mf,
              cube: ci,
              face: faceName,
              detail: `u=${faceData.u} w=${faceData.w} uEnd=${uEnd} texW=${texW}（U 轴越界）`,
            });
          }
          if (faceData.v < 0 || faceData.v > texH || vEnd < 0 || vEnd > texH) {
            issues.push({
              type: 'UV 越界',
              model: mf,
              cube: ci,
              face: faceName,
              detail: `v=${faceData.v} h=${faceData.h} vEnd=${vEnd} texH=${texH}（V 轴越界）`,
            });
          }
        }
      }
    }
  }

  // 检查 2: 非主模型 vs 主模型的 texW/texH 差异
  const mainProfile = modelProfiles.find(p => !p.isNonMain && (p.file.includes('main') || p.file.includes('Main')));
  const nonMainProfiles = modelProfiles.filter(p => p.isNonMain);
  for (const np of nonMainProfiles) {
    if (mainProfile && (np.texW !== mainProfile.texW || np.texH !== mainProfile.texH)) {
      issues.push({
        type: 'texW/texH 差异',
        model: np.file,
        detail: `非主模型 texW=${np.texW} texH=${np.texH} vs 主模型 texW=${mainProfile.texW} texH=${mainProfile.texH}——UV 归一化口径不一致隐患`,
      });
    }
  }

  return { name, issues, modelProfiles, texOrder, defaultSkin };
}

// ===== 执行 =====
console.log('非主模型 UV 口径对拍 mjs');
console.log('目标：定位非主模型（投射物/载具）UV 归一化口径不一致隐患');
console.log('日期: 2026-08-22\n');

const modelDirs = readdirSync(FOX)
  .filter(f => f.startsWith('.') === false && statSync(join(FOX, f)).isDirectory())
  .sort()
  .map(f => join(FOX, f));

const results = [];
for (const dir of modelDirs) {
  try {
    statSync(join(dir, 'ysm.json'));
  } catch {
    continue;
  }
  results.push(scanModel(dir));
}

// ===== 输出每套模型的扫描结果 =====
for (const r of results) {
  const status = r.issues.length === 0 ? '✅' : '❌';
  console.log(`${status} ${r.name}  (texOrder=${JSON.stringify(r.texOrder)})`);
  for (const p of r.modelProfiles) {
    const tag = p.isNonMain ? ' [非主]' : '';
    const tex = p.expectedTex ? `→${p.expectedTex}` : '→?';
    const filePadded = p.file.padEnd(20);
    const texWPadded = String(p.texW).padStart(4);
    const texHPadded = String(p.texH).padStart(4);
    const cubePadded = String(p.cubeCount).padStart(3);
    console.log(`   ${filePadded} texW=${texWPadded} texH=${texHPadded} cubes=${cubePadded}${tag} ${tex}`);
  }
  if (r.issues.length > 0) {
    console.log(`   问题 (${r.issues.length}):`);
    for (const iss of r.issues) {
      console.log(`     [${iss.type}] ${iss.model} ${iss.detail}`);
    }
  }
  console.log();
}

// ===== 汇总 =====
console.log('===== 汇总 =====');
console.log(`共扫描 ${results.length} 套模型`);

const okModels = results.filter(r => r.issues.length === 0);
const ngModels = results.filter(r => r.issues.length > 0);
console.log(`\n✅ 无问题模型: ${okModels.length} 套`);
console.log(`\n❌ 有问题模型: ${ngModels.length} 套`);

if (ngModels.length > 0) {
  console.log('\n===== 问题类型统计 =====');
  const issueTypeCount = {};
  for (const r of ngModels) {
    for (const i of r.issues) {
      issueTypeCount[i.type] = (issueTypeCount[i.type] || 0) + 1;
    }
  }
  for (const [type, count] of Object.entries(issueTypeCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count} 处`);
  }

  console.log('\n===== 有问题模型清单 =====');
  for (const r of ngModels) {
    console.log(`  ${r.name}: ${r.issues.length} 处问题`);
  }
}
