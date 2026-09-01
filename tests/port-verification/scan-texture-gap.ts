#!/usr/bin/env node
/**
 * 差距扫描 mjs：ysm.json files 段权威 vs archive.go 实际产出
 *
 * 用法: node tests/port-verification/scan-texture-gap.mjs
 *
 * 对拍口径：
 *   - ysm.json 权威 texOrder：从 files.player.texture[] + files.projectiles[] 派生
 *     元素格式：小写 basename 去扩展名（如 skin、arrow）
 *   - archive.go 实际产出：需要跑 Go 代码才知道，但咱们可以模拟
 *     archive.go 的 texOrder 收集逻辑，对比"权威"vs"模拟实际"
 *
 * 差距类型：
 *   A. 纹理顺序差异：ysm.json 声明序 vs archive.go 收集序
 *   B. 纹理缺失：ysm.json 声明了但 archive.go 没收集
 *   C. 纹理多余：archive.go 收集了但 ysm.json 没声明
 *   D. modelOrder 缺失：projectiles[].model 没进 modelOrder
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const FOX = join(ROOT, 'upstream', '[YSM模型]官方开源wine_fox_json');

// ===== 归一化函数 =====
// ysm.json texture.uv（如 "textures/skin.png"）→ 小写 basename 去扩展名（"skin"）
function normalizeTexName(rawPath) {
  let tn = rawPath;
  if (tn.includes('/')) tn = tn.slice(tn.lastIndexOf('/') + 1);
  if (tn.includes('\\')) tn = tn.slice(tn.lastIndexOf('\\') + 1);
  tn = tn.toLowerCase().replace(/\.png$/, '').replace(/\.jpg$/, '');
  return tn;
}

// ===== ysm.json files 段权威派生 =====
function deriveAuthoritative(ysmPath) {
  const raw = JSON.parse(readFileSync(ysmPath, 'utf-8'));
  const files = raw.files || raw.Files || {};

  // player.texture[] → texOrder（可切换皮肤集）
  const playerTex = files.player?.texture;
  const texOrder = [];
  if (Array.isArray(playerTex)) {
    for (const t of playerTex) {
      if (typeof t === 'string') {
        texOrder.push(normalizeTexName(t));
      } else if (t && typeof t === 'object') {
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

  // player.model → modelOrder（主体模型）
  const modelOrder = [];
  const pModel = files.player?.model;
  if (pModel && typeof pModel === 'object' && !Array.isArray(pModel)) {
    // map 格式：JSON 对象写入序即声明序
    for (const key of Object.keys(pModel)) {
      const val = pModel[key];
      if (typeof val === 'string') modelOrder.push(val);
    }
  } else if (Array.isArray(pModel)) {
    for (const item of pModel) {
      if (typeof item === 'string') modelOrder.push(item);
      else if (item && typeof item === 'object') {
        const p = item.path || item.name;
        if (p) modelOrder.push(p);
      }
    }
  } else if (typeof pModel === 'string') {
    modelOrder.push(pModel);
  }

  // projectiles[] → texOrder + modelOrder（投射物）
  const projsRaw = files.projectiles || files.Projectiles || [];
  const projectiles = Array.isArray(projsRaw)
    ? projsRaw
    : (typeof projsRaw === 'object' && projsRaw !== null ? Object.values(projsRaw) : []);

  for (const p of projectiles) {
    if (!p || typeof p !== 'object') continue;
    // texture：dict {"uv": "..."} 或 string
    const tex = p.texture;
    if (typeof tex === 'string') {
      texOrder.push(normalizeTexName(tex));
    } else if (tex && typeof tex === 'object') {
      const uv = tex.uv || tex.texture;
      if (uv) texOrder.push(normalizeTexName(uv));
    }
    // model：相对路径
    if (p.model) modelOrder.push(p.model);
  }

  return { texOrder, modelOrder };
}

// ===== 模拟 archive.go 实际产出 =====
// archive.go 的 texOrder 收集逻辑（L446-559 parseModelFromEntries）：
//   1. player.texture[] 是数组 → 遍历，每项是 dict {uv: "..."} 或 string
//      → normalizeTexName → append to texOrder
//   2. player.texture 是 dict → 没处理（archive.go 只处理数组 `[` 开头）
//   3. projectiles[] → 2026-08-22 新增，texture dict/string → normalizeTexName → append
//   4. modelOrder：player.model 4 种格式 + projectiles[].model
function simulateArchiveGo(ysmPath) {
  const raw = JSON.parse(readFileSync(ysmPath, 'utf-8'));
  const files = raw.files || raw.Files || {};

  const texOrder = [];
  const modelOrder = [];

  // player.texture 处理（archive.go L446-481）
  const playerTex = files.player?.texture;
  if (playerTex && typeof playerTex === 'object' && Array.isArray(playerTex)) {
    // 数组格式
    for (const item of playerTex) {
      if (typeof item === 'string') {
        texOrder.push(normalizeTexName(item));
      } else if (item && typeof item === 'object') {
        const uv = item.uv || item.texture;
        if (uv) texOrder.push(normalizeTexName(uv));
      }
    }
  } else if (typeof playerTex === 'string') {
    // 字符串格式（archive.go L468-477 处理）
    texOrder.push(normalizeTexName(playerTex));
  }
  // 注意：archive.go 只处理 `[` 开头的数组格式，
  //       如果 playerTex 是单个 dict（非数组），archive.go 不处理
  //       但这种情况在 wine_fox 里不存在

  // player.model 处理（archive.go L482-539，支持 4 种格式）
  const pModel = files.player?.model;
  if (pModel) {
    if (Array.isArray(pModel)) {
      // 数组格式
      for (const item of pModel) {
        if (typeof item === 'string') {
          modelOrder.push(item);
        } else if (item && typeof item === 'object') {
          const p = item.path || item.name;
          if (p) modelOrder.push(p);
        }
      }
    } else if (typeof pModel === 'object') {
      // map 格式：JSON 对象写入序（archive.go 用 json.Decoder Token 流式保序）
      for (const key of Object.keys(pModel)) {
        const val = pModel[key];
        if (typeof val === 'string') modelOrder.push(val);
      }
    } else if (typeof pModel === 'string') {
      modelOrder.push(pModel);
    }
  }

  // projectiles[] 处理（2026-08-22 新增，archive.go L523-565）
  const projsRaw = files.projectiles || files.Projectiles || [];
  const projectiles = Array.isArray(projsRaw)
    ? projsRaw
    : (typeof projsRaw === 'object' && projsRaw !== null ? Object.values(projsRaw) : []);

  for (const p of projectiles) {
    if (!p || typeof p !== 'object') continue;
    // texture：dict {"uv": "..."} 或 string
    const tex = p.texture;
    if (typeof tex === 'string') {
      texOrder.push(normalizeTexName(tex));
    } else if (tex && typeof tex === 'object') {
      const uv = tex.uv || tex.texture;
      if (uv) texOrder.push(normalizeTexName(uv));
    }
    // model：相对路径
    if (p.model) modelOrder.push(p.model);
  }

  return { texOrder, modelOrder };
}

// ===== 对拍单套模型 =====
function scanModel(modelDir) {
  const name = basename(modelDir);
  const ysmPath = join(modelDir, 'ysm.json');

  const auth = deriveAuthoritative(ysmPath);
  const sim = simulateArchiveGo(ysmPath);

  const gaps = [];

  // 差距 A: 纹理顺序差异
  const authTexStr = JSON.stringify(auth.texOrder);
  const simTexStr = JSON.stringify(sim.texOrder);
  if (authTexStr !== simTexStr) {
    gaps.push({
      type: '纹理顺序差异',
      auth: auth.texOrder,
      sim: sim.texOrder,
    });
  }

  // 差距 B: 纹理缺失（权威有，模拟没有）
  const simTexSet = new Set(sim.texOrder);
  const missingTex = auth.texOrder.filter(t => !simTexSet.has(t));
  if (missingTex.length > 0) {
    gaps.push({
      type: '纹理缺失',
      missing: missingTex,
    });
  }

  // 差距 C: 纹理多余（模拟有，权威没有）
  const authTexSet = new Set(auth.texOrder);
  const extraTex = sim.texOrder.filter(t => !authTexSet.has(t));
  if (extraTex.length > 0) {
    gaps.push({
      type: '纹理多余',
      extra: extraTex,
    });
  }

  // 差距 D: modelOrder 缺失
  const simModelSet = new Set(sim.modelOrder);
  const missingModel = auth.modelOrder.filter(m => !simModelSet.has(m));
  if (missingModel.length > 0) {
    gaps.push({
      type: 'modelOrder 缺失',
      missing: missingModel,
    });
  }

  // 差距 E: modelOrder 顺序差异
  const authModelStr = JSON.stringify(auth.modelOrder);
  const simModelStr = JSON.stringify(sim.modelOrder);
  if (authModelStr !== simModelStr) {
    gaps.push({
      type: 'modelOrder 顺序差异',
      auth: auth.modelOrder,
      sim: sim.modelOrder,
    });
  }

  return { name, auth, sim, gaps };
}

// ===== 执行 =====
console.log('差距扫描 mjs：ysm.json 权威 vs archive.go 实际产出');
console.log('目标：定位残余缺口（textures 顺序/缺失/多余、modelOrder 缺失/顺序）');
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
  const status = r.gaps.length === 0 ? '✅' : '❌';
  console.log(`${status} ${r.name}`);
  console.log(`   权威 texOrder: ${JSON.stringify(r.auth.texOrder)}`);
  console.log(`   模拟 texOrder: ${JSON.stringify(r.sim.texOrder)}`);
  console.log(`   权威 modelOrder: ${JSON.stringify(r.auth.modelOrder)}`);
  console.log(`   模拟 modelOrder: ${JSON.stringify(r.sim.modelOrder)}`);
  if (r.gaps.length > 0) {
    console.log(`   差距 (${r.gaps.length}):`);
    for (const g of r.gaps) {
      console.log(`     [${g.type}] ${JSON.stringify(g)}`);
    }
  }
  console.log();
}

// ===== 汇总 =====
console.log('===== 汇总 =====');
console.log(`共扫描 ${results.length} 套模型`);

const okModels = results.filter(r => r.gaps.length === 0);
const ngModels = results.filter(r => r.gaps.length > 0);
console.log(`\n✅ 无差距模型: ${okModels.length} 套`);
if (okModels.length > 0) {
  console.log(`  ${okModels.map(r => r.name).join(', ')}`);
}

console.log(`\n❌ 有差距模型: ${ngModels.length} 套`);
if (ngModels.length > 0) {
  for (const r of ngModels) {
    console.log(`  ${r.name}: ${r.gaps.map(g => g.type).join(', ')}`);
  }
}

// ===== 差距类型统计 =====
if (ngModels.length > 0) {
  console.log('\n===== 差距类型统计 =====');
  const gapTypeCount = {};
  for (const r of ngModels) {
    for (const g of r.gaps) {
      gapTypeCount[g.type] = (gapTypeCount[g.type] || 0) + 1;
    }
  }
  for (const [type, count] of Object.entries(gapTypeCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count} 套`);
  }
}
