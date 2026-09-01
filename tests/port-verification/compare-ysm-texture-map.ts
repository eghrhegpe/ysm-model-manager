#!/usr/bin/env node
/**
 * ysm.json files 段 vs 咱们 texIdxMap 反推 — 纹理分配对拍
 *
 * 用法: node tests/port-verification/compare-ysm-texture-map.mjs
 *
 * 对拍维度：
 *   1. 主体纹理列表（player.texture[]）顺序 vs 咱们 pngs 收集序
 *   2. 投射物纹理（projectiles[].texture.uv）vs 咱们 modelOrder 反推
 *   3. 纹理语义：ysm.json 是"可切换皮肤集"，咱们是否正确理解
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const FOX = join(ROOT, 'upstream', '[YSM模型]官方开源wine_fox_json');

// ===== ysm.json files 段解析（权威清单）=====
function parseYsmFiles(ysmPath) {
  const raw = JSON.parse(readFileSync(ysmPath, 'utf-8'));
  const files = raw.files || raw.Files || {};

  // player.model: { main: "models/main.json", arm: "models/arm.json" }
  const player = files.player || {};
  const pModels = player.model || {};

  // player.texture: 可能是 list[dict] / list[str] / dict / str
  // 归一为 [{ name: "skin.png", specular: "...", normal: "..." }]
  const pTexRaw = player.texture;
  let playerTextures = [];
  if (Array.isArray(pTexRaw)) {
    playerTextures = pTexRaw.map(t => {
      if (typeof t === 'string') return { name: basename(t) };
      return {
        name: basename(t.uv || t.texture || '?'),
        specular: t.specular ? basename(t.specular) : null,
        normal: t.normal ? basename(t.normal) : null,
      };
    });
  } else if (typeof pTexRaw === 'object' && pTexRaw !== null) {
    playerTextures = [{
      name: basename(pTexRaw.uv || pTexRaw.texture || '?'),
      specular: pTexRaw.specular ? basename(pTexRaw.specular) : null,
      normal: pTexRaw.normal ? basename(pTexRaw.normal) : null,
    }];
  } else if (typeof pTexRaw === 'string') {
    playerTextures = [{ name: basename(pTexRaw) }];
  }

  // projectiles: 可能是 dict (name→config) 或 list[config]
  // 归一为 [{ model: "models/arrow.json", texture: "textures/arrow.png", match: [...] }]
  const projsRaw = files.projectiles || files.Projectiles || [];
  let projectiles = [];
  if (Array.isArray(projsRaw)) {
    projectiles = projsRaw.map(p => normalizeProjectile(p));
  } else if (typeof projsRaw === 'object' && projsRaw !== null) {
    projectiles = Object.values(projsRaw).map(p => normalizeProjectile(p));
  }

  return { playerTextures, projectiles, pModels };
}

function normalizeProjectile(p) {
  if (!p || typeof p !== 'object') return null;
  const tex = p.texture;
  let texName = '?';
  if (typeof tex === 'string') texName = basename(tex);
  else if (tex && typeof tex === 'object') texName = basename(tex.uv || tex.texture || '?');

  return {
    model: p.model ? basename(p.model) : '?',
    texture: texName,
    match: p.match || [],
  };
}

// ===== 模拟咱们 archive.go 的 texIdxMap 反推 =====
// archive.go L834-963:
//   1. modelOrder = zip 内 .json 文件列表（文件系统序）
//   2. texIdxMap[basename(.json)] = i（按文件序分配 TexSlot）
//   3. texOrder = ysm.json/manifest 派生的纹理声明顺序
//   4. PNG 按 texOrder 排序
//
// 这里模拟纯 JSON 模型路径（无 ysm.json texOrder）：
//   - modelOrder = models/ 目录下 .json 文件列表（文件系统序）
//   - texIdxMap[basename] = index
//   - PNG 收集 = textures/ 目录下所有 .png（文件系统序）
function simulateOurTexIdxMap(modelDir) {
  const modelsPath = join(modelDir, 'models');
  const texturesPath = join(modelDir, 'textures');

  // modelOrder: models/ 下的 .json 文件（文件系统序）
  let modelOrder = [];
  try {
    modelOrder = readdirSync(modelsPath)
      .filter(f => f.endsWith('.json'))
      .sort(); // 文件系统序（模拟 zip 内顺序）
  } catch { /* models 目录不存在 */ }

  // texIdxMap: basename(.json) → index
  const texIdxMap = {};
  modelOrder.forEach((f, i) => {
    const bn = f.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
    texIdxMap[bn] = i;
  });

  // PNG 收集: textures/ 下所有 .png（递归，文件系统序）
  let pngOrder = [];
  function collectPngs(dir, prefix = '') {
    try {
      const entries = readdirSync(dir);
      for (const e of entries) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) {
          collectPngs(full, prefix + e + '/');
        } else if (e.toLowerCase().endsWith('.png')) {
          pngOrder.push(prefix + e);
        }
      }
    } catch { /* 目录不存在 */ }
  }
  collectPngs(texturesPath);

  // 模拟 archive.go L907-922 的 texOrder 排序
  // 纯 JSON 模型无 ysm.json texOrder → texOrder 为空 → PNG 按文件系统序
  // （实际上 archive.go 读 ysm.json 的 texture 列表？需要确认）

  return { modelOrder, texIdxMap, pngOrder };
}

// ===== 主对拍 =====
function fmtArr(arr) {
  return '[' + arr.map(x => typeof x === 'object' ? x.name || JSON.stringify(x) : x).join(', ') + ']';
}

function compareModel(modelDir) {
  const ysmPath = join(modelDir, 'ysm.json');
  const name = basename(modelDir);

  const { playerTextures, projectiles, pModels } = parseYsmFiles(ysmPath);
  const { modelOrder, texIdxMap, pngOrder } = simulateOurTexIdxMap(modelDir);

  console.log(`\n===== ${name} =====`);

  // 1. ysm.json 权威纹理列表
  console.log(`ysm.json player.texture: ${fmtArr(playerTextures)}`);
  console.log(`ysm.json projectiles:     ${projectiles.map(p => `${p.model}->${p.texture}`).join(' ') || '(无)'}`);

  // 2. 咱们 archive.go 反推
  console.log(`咱们 modelOrder:          ${fmtArr(modelOrder)}`);
  console.log(`咱们 texIdxMap:           ${JSON.stringify(texIdxMap)}`);
  console.log(`咱们 pngOrder (前5):      ${pngOrder.slice(0, 5).join(', ')}${pngOrder.length > 5 ? '...' : ''}`);

  // 3. 差异分析
  const diffs = [];

  // 差异 A: 主体纹理语义
  // ysm.json: player.texture[] 是"可切换皮肤集"，第一个是默认皮肤
  // 咱们: pngs[0] 是主体纹理，pngs[1+] 是额外纹理
  const defaultSkin = playerTextures[0]?.name || '?';
  const ourFirstPng = pngOrder[0] ? basename(pngOrder[0]) : '?';
  if (defaultSkin !== '?' && defaultSkin !== ourFirstPng) {
    diffs.push({
      type: '主体纹理不匹配',
      ysm: defaultSkin,
      ours: ourFirstPng,
      detail: `ysm.json 默认皮肤=${defaultSkin}，咱们 pngs[0]=${ourFirstPng}`,
    });
  }

  // 差异 B: 投射物纹理
  // ysm.json: projectiles[].model 绑定 projectiles[].texture
  // 咱们: modelOrder 里 arrow.json 的 TexSlot = texIdxMap["arrow"]
  for (const proj of projectiles) {
    const projModelBase = proj.model.replace(/\.geo\.json$/, '').replace(/\.json$/, '');
    const ourSlot = texIdxMap[projModelBase];
    const ysmTex = proj.texture;

    // 咱们的 PNG 列表里找对应的 PNG
    // 咱们按 modelOrder 序分配 TexSlot，投射物 PNG 也在 pngOrder 里
    // 但投射物 PNG 的位置取决于文件系统序
    const projPngIndex = pngOrder.findIndex(p => basename(p) === ysmTex);

    if (ourSlot !== undefined) {
      // 咱们把投射物 .json 按文件序分配了 TexSlot
      // 但 ysm.json 里投射物有独立纹理绑定
      diffs.push({
        type: '投射物纹理',
        ysm: `${proj.model} 绑定 ${ysmTex}`,
        ours: `${projModelBase}.json TexSlot=${ourSlot}（按文件序，不读 ysm.json projectiles）`,
        detail: projPngIndex >= 0
          ? `${ysmTex} 在咱们 pngOrder[${projPngIndex}]`
          : `${ysmTex} 不在咱们 pngOrder 里！`,
      });
    }
  }

  // 差异 C: 多皮肤语义
  // ysm.json: player.texture[] 有多张 → 可切换皮肤集
  // 咱们: 只用第一张作为主体纹理，其他忽略？
  if (playerTextures.length > 1) {
    diffs.push({
      type: '多皮肤语义',
      ysm: `${playerTextures.length} 张可切换皮肤: ${fmtArr(playerTextures)}`,
      ours: '只用第一张作为主体纹理？其他皮肤忽略？',
      detail: 'ysm.json 的 player.texture[] 是"可切换皮肤集"，不是 cube 级别多纹理',
    });
  }

  // 差异 D: arrow 排序第一
  // 咱们 modelOrder 文件系统序：arrow.json 可能排第一（a 开头）
  // ysm.json: arrow 是 projectiles 的一项，跟 player 纹理槽位无关
  const arrowInModels = modelOrder.find(m => m.startsWith('arrow'));
  if (arrowInModels && modelOrder.indexOf(arrowInModels) === 0) {
    diffs.push({
      type: 'arrow 排序第一',
      ysm: 'arrow 是 projectiles 的一项，独立纹理绑定',
      ours: `arrow.json 在 modelOrder[0] → TexSlot=0（跟主体模型抢同一张图）`,
      detail: '咱们需要"各种排除"是因为没读 ysm.json 的 projectiles 段',
    });
  }

  if (diffs.length === 0) {
    console.log('✅ 无差异');
  } else {
    console.log(`❌ ${diffs.length} 处差异:`);
    for (const d of diffs) {
      console.log(`  [${d.type}] ysm=${d.ysm} ours=${d.ours}`);
      console.log(`    ${d.detail}`);
    }
  }

  return { name, diffs, playerTextures, projectiles, modelOrder, texIdxMap, pngOrder };
}

// ===== 执行 =====
console.log('ysm.json files 段 vs 咱们 texIdxMap 反推 — 纹理分配对拍');
console.log('对比 22 套 wine_fox 模型');
console.log('日期: 2026-08-22\n');

const modelDirs = readdirSync(FOX)
  .filter(f => f.startsWith('.') === false && statSync(join(FOX, f)).isDirectory())
  .sort()
  .map(f => join(FOX, f));

const results = [];
for (const dir of modelDirs) {
  // 跳过没有 ysm.json 的目录
  try {
    statSync(join(dir, 'ysm.json'));
  } catch {
    continue;
  }
  results.push(compareModel(dir));
}

// ===== 汇总 =====
console.log('\n\n===== 汇总 =====');
console.log(`共对拍 ${results.length} 套模型`);

// 按差异类型统计
const diffTypeCount = {};
for (const r of results) {
  for (const d of r.diffs) {
    diffTypeCount[d.type] = (diffTypeCount[d.type] || 0) + 1;
  }
}
console.log('\n差异类型统计:');
for (const [type, count] of Object.entries(diffTypeCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count} 套`);
}

// 全绿模型
const okModels = results.filter(r => r.diffs.length === 0);
console.log(`\n✅ 无差异模型: ${okModels.length} 套`);
if (okModels.length > 0) {
  console.log(`  ${okModels.map(r => r.name).join(', ')}`);
}

// 有差异模型
const ngModels = results.filter(r => r.diffs.length > 0);
console.log(`\n❌ 有差异模型: ${ngModels.length} 套`);
for (const r of ngModels) {
  console.log(`  ${r.name}: ${r.diffs.map(d => d.type).join(', ')}`);
}
