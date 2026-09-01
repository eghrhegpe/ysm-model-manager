#!/usr/bin/env node
/**
 * cube TexSlot 对拍 mjs：ysm.json 权威 vs archive.go 实际 cube.TexSlot
 *
 * 用法: node tests/port-verification/scan-cube-texslot.mjs
 *
 * 对拍逻辑：
 *   1. ysm.json 权威：每个模型文件（main.json/arrow.json 等）应该绑定哪张纹理
 *      - player.model.main → player.texture[0]（默认皮肤）
 *      - projectiles[].model → projectiles[].texture.uv
 *   2. archive.go 实际：cube.TexSlot 来自 texIdxMap[geoName]
 *      - texIdxMap 按模型文件序分配，序号 = 该模型在 texOrder 里的位置
 *   3. 对比：每个模型的 cube.TexSlot 应该指向正确的纹理
 *
 * 但这里有个语义问题：
 *   - ysm.json 里 player.model.main 和 arm 共用 player.texture[0]
 *   - archive.go 里 main.json 和 arm.json 分别是 texIdxMap 的不同条目
 *   - 如果 player.texture[] 只有一张皮肤，main 和 arm 都绑这张皮肤 ✓
 *   - 如果 player.texture[] 有多张皮肤，main 和 arm 都绑第一张（默认皮肤）✓
 *   - arrow.json 应该绑 arrow.png，不是 skin.png
 *
 * 所以对拍的核心是：
 *   - 主体模型（main/arm）的 cube.TexSlot 应该指向 player.texture[0]（默认皮肤）
 *   - 投射物模型（arrow/trident）的 cube.TexSlot 应该指向对应的投射物纹理
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const FOX = join(ROOT, 'upstream', '[YSM模型]官方开源wine_fox_json');

// ===== 归一化 =====
function normalizeTexName(rawPath) {
  let tn = rawPath;
  if (tn.includes('/')) tn = tn.slice(tn.lastIndexOf('/') + 1);
  if (tn.includes('\\')) tn = tn.slice(tn.lastIndexOf('\\') + 1);
  tn = tn.toLowerCase().replace(/\.png$/, '').replace(/\.jpg$/, '');
  return tn;
}

// ===== 解析 ysm.json，建立"模型文件 → 应绑纹理名"映射 =====
function buildModelTexMap(ysmPath) {
  const raw = JSON.parse(readFileSync(ysmPath, 'utf-8'));
  const files = raw.files || raw.Files || {};

  const modelTexMap = {}; // 模型文件相对路径 → 应绑纹理名
  const texOrder = [];    // 权威纹理顺序（小写 basename 去扩展名）

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

  // --- projectiles/vehicles/arrow → 投射物/载具/单实体模型，绑各自纹理 ---
  //   两种形态：list（[config,...]）或 dict（{minecraft:xxx: config,...}）
  //   arrow 段是单实体直接声明（{model,texture}），按 dict 路径处理
  for (const segKey of ['projectiles', 'Projectiles', 'vehicles', 'Vehicles', 'arrow', 'Arrow']) {
    const segRaw = files[segKey];
    if (!segRaw) continue;
    let entries;
    if (Array.isArray(segRaw)) {
      entries = segRaw;
    } else if (typeof segRaw === 'object' && segRaw !== null) {
      // 区分两种 dict 形态：
      //   {minecraft:arrow: {model,texture}} → values 是 config dict
      //   {model, texture} → 自身就是 config dict
      const vals = Object.values(segRaw);
      const isConfigDict = typeof segRaw.model === 'string' || typeof segRaw.texture === 'string' || typeof segRaw.texture === 'object';
      if (isConfigDict) {
        entries = [segRaw]; // 单实体直接声明
      } else {
        entries = vals; // {minecraft:xxx: config} 形态
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

  return { modelTexMap, texOrder, defaultSkin };
}

// ===== 模拟 archive.go 的 texIdxMap + cube.TexSlot 分配 =====
function simulateCubeTexSlots(ysmPath, modelDir) {
  const { modelTexMap, texOrder } = buildModelTexMap(ysmPath);

  // texIdxMap: 模型文件 basename（去 .json）→ TexSlot
  // archive.go L884-901：按 modelOrder 序分配，ti = i，截断到 texCount-1
  const texIdxMap = {};
  for (const [modelPath, _texName] of Object.entries(modelTexMap)) {
    // basename 去 .json
    let bn = modelPath;
    if (bn.includes('/')) bn = bn.slice(bn.lastIndexOf('/') + 1);
    bn = bn.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
    // TexSlot = 这个模型对应的纹理在 texOrder 里的位置
    const texName = modelTexMap[modelPath];
    const slot = texOrder.indexOf(texName);
    texIdxMap[bn] = slot >= 0 ? slot : 0;
  }

  // 读取 models/ 目录下所有 .json，模拟 cube.TexSlot
  const modelsDir = join(modelDir, 'models');
  const cubeTexSlots = {}; // 模型 basename → TexSlot

  let modelFiles = [];
  try {
    modelFiles = readdirSync(modelsDir).filter(f => f.endsWith('.json'));
  } catch { /* 无 models 目录 */ }

  for (const mf of modelFiles) {
    const bn = mf.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
    // archive.go 的 texIdxMap 查找：如果 bn 在 texIdxMap 里，用那个值；否则用 0
    const slot = texIdxMap[bn] !== undefined ? texIdxMap[bn] : 0;
    cubeTexSlots[bn] = slot;
  }

  return { cubeTexSlots, texIdxMap, texOrder, modelTexMap };
}

// ===== 对拍单套模型 =====
function scanModel(modelDir) {
  const name = basename(modelDir);
  const ysmPath = join(modelDir, 'ysm.json');

  const { modelTexMap, texOrder, defaultSkin } = buildModelTexMap(ysmPath);
  const { cubeTexSlots, texIdxMap } = simulateCubeTexSlots(ysmPath, modelDir);

  const issues = [];

  // 对每个模型文件，检查 cube.TexSlot 是否指向正确的纹理
  for (const [modelPath, expectedTexName] of Object.entries(modelTexMap)) {
    let bn = modelPath;
    if (bn.includes('/')) bn = bn.slice(bn.lastIndexOf('/') + 1);
    bn = bn.replace(/\.geo\.json$/, '').replace(/\.json$/, '');

    const actualSlot = cubeTexSlots[bn];
    const expectedSlot = texOrder.indexOf(expectedTexName);
    const actualTexName = actualSlot >= 0 && actualSlot < texOrder.length
      ? texOrder[actualSlot] : `(越界 slot=${actualSlot})`;

    if (actualSlot !== expectedSlot) {
      issues.push({
        type: 'TexSlot 错误',
        model: bn,
        expected: `${expectedTexName} (slot=${expectedSlot})`,
        actual: `${actualTexName} (slot=${actualSlot})`,
      });
    }
  }

  // 检查是否有模型文件没在 modelTexMap 里（未声明模型）
  const modelsDir = join(modelDir, 'models');
  let modelFiles = [];
  try {
    modelFiles = readdirSync(modelsDir).filter(f => f.endsWith('.json'));
  } catch { /* 无 models 目录 */ }

  for (const mf of modelFiles) {
    const bn = mf.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
    // 检查这个模型文件是否在 modelTexMap 里有对应
    let found = false;
    for (const [modelPath, _] of Object.entries(modelTexMap)) {
      let mpBn = modelPath;
      if (mpBn.includes('/')) mpBn = mpBn.slice(mpBn.lastIndexOf('/') + 1);
      mpBn = mpBn.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
      if (mpBn === bn) { found = true; break; }
    }
    if (!found && bn !== 'arm') { // arm 通常被排除
      issues.push({
        type: '未声明模型',
        model: bn,
        detail: `${mf} 不在 ysm.json 的 player.model 或 projectiles 里`,
      });
    }
  }

  return { name, issues, texOrder, cubeTexSlots, texIdxMap, modelTexMap, defaultSkin };
}

// ===== 执行 =====
console.log('cube TexSlot 对拍 mjs：ysm.json 权威 vs archive.go 实际 cube.TexSlot');
console.log('目标：定位错误使用材质的 cube');
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
  console.log(`${status} ${r.name}`);
  console.log(`   texOrder: ${JSON.stringify(r.texOrder)}`);
  console.log(`   defaultSkin: ${r.defaultSkin}`);
  console.log(`   modelTexMap: ${JSON.stringify(r.modelTexMap)}`);
  console.log(`   texIdxMap: ${JSON.stringify(r.texIdxMap)}`);
  console.log(`   cubeTexSlots: ${JSON.stringify(r.cubeTexSlots)}`);
  if (r.issues.length > 0) {
    console.log(`   问题 (${r.issues.length}):`);
    for (const iss of r.issues) {
      console.log(`     [${iss.type}] ${JSON.stringify(iss)}`);
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
if (okModels.length > 0) {
  console.log(`  ${okModels.map(r => r.name).join(', ')}`);
}

console.log(`\n❌ 有问题模型: ${ngModels.length} 套`);
if (ngModels.length > 0) {
  for (const r of ngModels) {
    console.log(`  ${r.name}: ${r.issues.map(i => i.type).join(', ')}`);
  }
}

// ===== 问题类型统计 =====
if (ngModels.length > 0) {
  console.log('\n===== 问题类型统计 =====');
  const issueTypeCount = {};
  for (const r of ngModels) {
    for (const i of r.issues) {
      issueTypeCount[i.type] = (issueTypeCount[i.type] || 0) + 1;
    }
  }
  for (const [type, count] of Object.entries(issueTypeCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count} 套`);
  }
}
