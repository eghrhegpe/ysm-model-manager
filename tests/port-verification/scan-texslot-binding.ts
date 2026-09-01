#!/usr/bin/env node
/**
 * 精确对拍 mjs：texIdxMap 截断后 TexSlot vs texArr 实际纹理绑定
 *
 * 用法: node tests/port-verification/scan-texslot-binding.mjs
 *
 * 对拍逻辑：
 *   1. 模拟 archive.go 的 texIdxMap 构建（含截断逻辑）
 *   2. 模拟 texOrder 排序后 pngs 的实际顺序
 *   3. 对每个模型文件，检查截断后 TexSlot 指向的纹理是否正确
 *
 * 关键：texIdxMap 按 modelOrder 序号分配，有截断：
 *   if ti >= texCount { ti = texCount - 1 }
 * 这意味着多个模型可能挤同一 TexSlot，导致纹理绑错
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const FOX = join(ROOT, 'upstream', '[YSM模型]官方开源wine_fox_json');

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

  const texOrder = [];
  const modelTexMap = {}; // 模型路径 → 应绑纹理名

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

  const defaultSkin = texOrder[0] || null;

  // --- player.model → 主体模型，绑 player.texture[0]（默认皮肤）---
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

// ===== 模拟 archive.go 的 texIdxMap 构建（含截断）=====
function simulateTexIdxMap(modelTexMap, texOrder) {
  // archive.go L1085-1095：
  //   for i, p := range modelOrder {
  //       ti := i
  //       if ti >= texCount { ti = texCount - 1 }
  //       texIdxMap[basename] = ti
  //   }
  // 但 modelOrder 是按 ysm.json 声明顺序收集的
  // 这里我们用 modelTexMap 的键序模拟 modelOrder

  const texCount = texOrder.length;
  const texIdxMap = {};
  const modelOrder = [];

  // 模拟 modelOrder 收集：player.model 先，然后 projectiles/vehicles/arrow
  for (const [modelPath, texName] of Object.entries(modelTexMap)) {
    modelOrder.push(modelPath);
  }

  // 模拟 texIdxMap 构建（含截断）
  for (let i = 0; i < modelOrder.length; i++) {
    const modelPath = modelOrder[i];
    let bn = modelPath;
    if (bn.includes('/')) bn = bn.slice(bn.lastIndexOf('/') + 1);
    bn = bn.replace(/\.geo\.json$/, '').replace(/\.json$/, '');

    let ti = i;
    if (ti >= texCount) {
      ti = texCount - 1; // 截断
    }
    texIdxMap[bn] = { slot: ti, orderIdx: i, truncated: i >= texCount };
  }

  return { texIdxMap, modelOrder, texCount };
}

// ===== 对拍单套模型 =====
function scanModel(modelDir) {
  const name = basename(modelDir);
  const ysmPath = join(modelDir, 'ysm.json');
  const modelsDir = join(modelDir, 'models');

  const { texOrder, modelTexMap, defaultSkin } = parseYsmAuthority(ysmPath);
  const { texIdxMap, texCount } = simulateTexIdxMap(modelTexMap, texOrder);

  let modelFiles = [];
  try {
    modelFiles = readdirSync(modelsDir).filter(f => f.endsWith('.json')).sort();
  } catch { /* 无 models 目录 */ }

  const issues = [];
  const bindings = [];

  for (const mf of modelFiles) {
    const bn = mf.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
    const entry = texIdxMap[bn];

    if (!entry) {
      // 模型不在 texIdxMap 里（ysm.json 未声明）
      issues.push({
        type: '未声明模型',
        model: mf,
        detail: `${bn} 不在 ysm.json 的 player.model/projectiles/vehicles/arrow 里`,
      });
      continue;
    }

    // 截断后 TexSlot 指向的纹理
    const actualSlot = entry.slot;
    const actualTex = actualSlot >= 0 && actualSlot < texOrder.length
      ? texOrder[actualSlot] : '(越界)';

    // 应绑纹理（从 modelTexMap 查）
    let expectedTex = null;
    for (const [modelPath, texName] of Object.entries(modelTexMap)) {
      let mpBn = modelPath;
      if (mpBn.includes('/')) mpBn = mpBn.slice(mpBn.lastIndexOf('/') + 1);
      mpBn = mpBn.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
      if (mpBn === bn) {
        expectedTex = texName;
        break;
      }
    }

    const isCorrect = expectedTex === actualTex;
    const isTruncated = entry.truncated;

    bindings.push({
      model: mf,
      bn,
      orderIdx: entry.orderIdx,
      slot: actualSlot,
      truncated: isTruncated,
      actualTex,
      expectedTex,
      isCorrect,
    });

    if (!isCorrect) {
      issues.push({
        type: '纹理绑错',
        model: mf,
        detail: `TexSlot=${actualSlot} → ${actualTex}，应绑 ${expectedTex}${isTruncated ? '（截断导致）' : ''}`,
      });
    }
  }

  return { name, issues, bindings, texOrder, texCount, defaultSkin };
}

// ===== 执行 =====
console.log('精确对拍 mjs：texIdxMap 截断后 TexSlot vs texArr 实际纹理绑定');
console.log('目标：定位非主模型纹理绑错（截断导致多模型挤同一槽位）');
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
  console.log(`${status} ${r.name}  (texOrder=${JSON.stringify(r.texOrder)} texCount=${r.texCount})`);
  for (const b of r.bindings) {
    const flag = b.isCorrect ? '✓' : '✗';
    const trunc = b.truncated ? ' [截断]' : '';
    const modelPadded = b.model.padEnd(20);
    const actualPadded = b.actualTex.padEnd(12);
    console.log(`   ${flag} ${modelPadded} slot=${b.slot} → ${actualPadded} (期望 ${b.expectedTex})${trunc}`);
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
