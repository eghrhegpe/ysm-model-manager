#!/usr/bin/env node
/**
 * texSlot 越界对拍 mjs
 *
 * 用法: node tests/port-verification/scan-texslot-overflow.mjs
 *
 * 对拍逻辑：
 *   1. 读 ysm.json，建立 texOrder（= pngs 长度，即 texArr 长度）
 *   2. 模拟 archive.go 的 texIdxMap 构建（按 modelOrder 序号 + 截断）
 *   3. 对每个模型文件的 cube，检查 texSlot 是否 >= texArr 长度（越界）
 *
 * 关键：archive.go 的 texIdxMap 有截断逻辑：
 *   if ti >= texCount { ti = texCount - 1 }
 * 所以 texSlot 最大 = texCount - 1 = len(pngs) - 1
 * 越界不会发生在 texSlot >= len(pngs) 的情况下
 *
 * 但前端 texArr 长度 = len(model.textures)，而 model.textures 来自 Go 端 pngs
 * 所以 texArr 长度 = len(pngs) = len(texOrder)
 * texSlot < len(texOrder) = len(texArr) → 不越界
 *
 * 那为什么会有 "arrow texSlot=6 越界品红" 的注释？
 * 可能原因：
 *   A. texArr 长度 < texOrder 长度（前端只加载了部分纹理）
 *   B. texSlot 来自不同路径（如组件版的 buildComponents）
 *   C. texIdxMap 截断逻辑有 bug
 *
 * 这个脚本验证：texSlot 最大值 vs texOrder 长度，确认越界是否真实发生
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
  const modelTexMap = {};

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

  // --- player.model → 主体模型 ---
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
  // archive.go 的 modelOrder 收集顺序：
  //   1. player.model（主体模型，声明序）
  //   2. projectiles/vehicles/arrow（投射物/载具，追加）
  // 但 filterArmModels 会把 arm.json 过滤掉
  //
  // texIdxMap 构建逻辑（archive.go L1085-1095）：
  //   for i, p := range modelOrder {
  //       ti := i
  //       if ti >= texCount { ti = texCount - 1 }  // 截断
  //       texIdxMap[basename(.json)] = ti
  //   }

  const texCount = texOrder.length;
  const texIdxMap = {};
  const modelOrder = [];

  // 模拟 modelOrder 收集：player.model 先，然后 projectiles/vehicles/arrow
  // 但 filterArmModels 会过滤 arm.json
  for (const [modelPath, texName] of Object.entries(modelTexMap)) {
    // 跳过 arm.json（filterArmModels 过滤）
    const bn = basename(modelPath).replace(/\.geo\.json$/, '').replace(/\.json$/, '');
    if (bn === 'arm') continue;

    modelOrder.push(modelPath);
  }

  // 模拟 texIdxMap 构建（含截断）
  // archive.go 新逻辑：优先按声明的纹理名查 texOrder 位置；查不到再按 modelOrder 序号兜底
  for (let i = 0; i < modelOrder.length; i++) {
    const modelPath = modelOrder[i];
    let bn = basename(modelPath).replace(/\.geo\.json$/, '').replace(/\.json$/, '');

    // 查声明的纹理名
    const declaredTexName = modelTexMap[modelPath];
    let ti = -1;
    if (declaredTexName) {
      for (let j = 0; j < texOrder.length; j++) {
        if (texOrder[j] === declaredTexName) {
          ti = j;
          break;
        }
      }
    }
    const truncated = ti < 0 && i >= texCount;
    if (ti < 0) {
      ti = i;
      if (ti >= texCount) {
        ti = texCount - 1; // 截断
      }
    }
    texIdxMap[bn] = { slot: ti, orderIdx: i, truncated };
  }

  return { texIdxMap, modelOrder, texCount };
}

// ===== 对拍单套模型 =====
function scanModel(modelDir) {
  const name = basename(modelDir);
  const ysmPath = join(modelDir, 'ysm.json');
  const modelsDir = join(modelDir, 'models');

  const { texOrder, modelTexMap, defaultSkin } = parseYsmAuthority(ysmPath);
  const { texIdxMap, modelOrder, texCount } = simulateTexIdxMap(modelTexMap, texOrder);

  let modelFiles = [];
  try {
    modelFiles = readdirSync(modelsDir).filter(f => f.endsWith('.json')).sort();
  } catch { /* 无 models 目录 */ }

  const issues = [];
  const slotMap = {};

  for (const mf of modelFiles) {
    const bn = mf.replace(/\.geo\.json$/, '').replace(/\.json$/, '');

    // arm.json 被 filterArmModels 过滤，TexSlot 保持默认 0
    if (bn === 'arm') {
      slotMap[mf] = { slot: 0, reason: 'arm filtered, default slot 0' };
      continue;
    }

    const entry = texIdxMap[bn];
    if (!entry) {
      // 模型不在 texIdxMap 里（ysm.json 未声明）
      slotMap[mf] = { slot: 0, reason: 'not in texIdxMap, default slot 0' };
      issues.push({
        type: '未声明模型',
        model: mf,
        detail: `${bn} 不在 ysm.json 的 player.model/projectiles/vehicles/arrow 里，TexSlot=0 兜底`,
      });
      continue;
    }

    slotMap[mf] = { slot: entry.slot, reason: entry.truncated ? 'truncated' : 'normal' };

    // 越界检查
    if (entry.slot >= texCount) {
      issues.push({
        type: 'TexSlot 越界',
        model: mf,
        detail: `texSlot=${entry.slot} >= texArr.length=${texCount}（越界 → 品红错误材质）`,
      });
    }

    // 截断检查
    if (entry.truncated) {
      issues.push({
        type: 'TexSlot 截断',
        model: mf,
        detail: `orderIdx=${entry.orderIdx} >= texCount=${texCount}，截断到 ${entry.slot}（多模型挤同一槽位）`,
      });
    }
  }

  return { name, issues, slotMap, texOrder, texCount, modelOrder };
}

// ===== 执行 =====
console.log('texSlot 越界对拍 mjs');
console.log('目标：确认 cube.texSlot 是否越界（>= texArr 长度）');
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
  for (const [mf, info] of Object.entries(r.slotMap)) {
    const truncFlag = info.reason === 'truncated' ? ' ⚠️截断' : '';
    console.log(`   ${mf.padEnd(20)} slot=${info.slot}${truncFlag} (${info.reason})`);
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
