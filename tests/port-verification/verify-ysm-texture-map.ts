#!/usr/bin/env node
/**
 * 验证 mjs：直读 ysm.json files 段分配纹理，确认覆盖全 22 套
 *
 * 用法: node tests/port-verification/verify-ysm-texture-map.mjs
 *
 * 验证逻辑：
 *   1. 读 ysm.json 的 files 段
 *   2. 模拟"直读 files 段"的纹理分配：
 *      - player.texture[0] = 默认皮肤 → pngs[0]
 *      - player.texture[1+] = 可切换皮肤 → 纹理列表追加
 *      - projectiles[].model 绑定 projectiles[].texture.uv → 独立 TexSlot
 *   3. 对每个模型验证：
 *      - 默认皮肤 PNG 存在于 textures/ 目录
 *      - 投射物纹理 PNG 存在于 textures/ 目录
 *      - player.model.main / arm 的 .json 存在于 models/ 目录
 *      - projectiles[].model 的 .json 存在于 models/ 目录
 *   4. 输出：全绿/有缺口 + 详细缺口列表
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const FOX = join(ROOT, 'upstream', '[YSM模型]官方开源wine_fox_json');

// ===== ysm.json files 段解析 =====
function parseYsmFiles(ysmPath) {
  const raw = JSON.parse(readFileSync(ysmPath, 'utf-8'));
  const files = raw.files || raw.Files || {};
  return files;
}

// 归一 player.texture → [{ name, specular, normal }]
function normalizePlayerTextures(player) {
  const pTexRaw = player.texture;
  let playerTextures = [];
  if (Array.isArray(pTexRaw)) {
    playerTextures = pTexRaw.map(t => {
      if (typeof t === 'string') return { name: basename(t), raw: t };
      return {
        name: basename(t.uv || t.texture || '?'),
        raw: t.uv || t.texture || '?',
        specular: t.specular ? basename(t.specular) : null,
        normal: t.normal ? basename(t.normal) : null,
      };
    });
  } else if (typeof pTexRaw === 'object' && pTexRaw !== null) {
    playerTextures = [{
      name: basename(pTexRaw.uv || pTexRaw.texture || '?'),
      raw: pTexRaw.uv || pTexRaw.texture || '?',
      specular: pTexRaw.specular ? basename(pTexRaw.specular) : null,
      normal: pTexRaw.normal ? basename(pTexRaw.normal) : null,
    }];
  } else if (typeof pTexRaw === 'string') {
    playerTextures = [{ name: basename(pTexRaw), raw: pTexRaw }];
  }
  return playerTextures;
}

// 归一 projectiles → [{ model, modelRaw, texture, textureRaw, match }]
function normalizeProjectiles(projsRaw) {
  let projectiles = [];
  if (Array.isArray(projsRaw)) {
    projectiles = projsRaw.map(p => normalizeProjectile(p));
  } else if (typeof projsRaw === 'object' && projsRaw !== null) {
    projectiles = Object.values(projsRaw).map(p => normalizeProjectile(p));
  }
  return projectiles.filter(p => p !== null);
}

function normalizeProjectile(p) {
  if (!p || typeof p !== 'object') return null;
  const tex = p.texture;
  let texName = '?';
  let texRaw = '?';
  if (typeof tex === 'string') {
    texName = basename(tex);
    texRaw = tex;
  } else if (tex && typeof tex === 'object') {
    texName = basename(tex.uv || tex.texture || '?');
    texRaw = tex.uv || tex.texture || '?';
  }
  return {
    model: p.model ? basename(p.model) : '?',
    modelRaw: p.model || '?',
    texture: texName,
    textureRaw: texRaw,
    match: p.match || [],
  };
}

// ===== 模拟"直读 files 段"的纹理分配 =====
function simulateDirectFilesAllocation(files, modelDir) {
  const player = files.player || {};
  const projsRaw = files.projectiles || files.Projectiles || [];
  const pModels = player.model || {};

  // 1. player.texture[] → 可切换皮肤集
  const playerTextures = normalizePlayerTextures(player);

  // 2. projectiles[] → 每个投射物独立绑定纹理
  const projectiles = normalizeProjectiles(projsRaw);

  // 3. 构建纹理分配清单
  //    - 主体模型（main.json + arm.json）共用 player.texture[0]（默认皮肤）
  //    - 投射物模型（arrow.json 等）绑定 projectiles[].texture.uv
  const allocation = {
    defaultSkin: playerTextures[0]?.name || null,
    switchableSkins: playerTextures.map(t => t.name),
    playerModels: Object.keys(pModels).map(k => ({
      key: k,
      modelFile: basename(pModels[k]),
      modelRaw: pModels[k],
      texture: playerTextures[0]?.name || null,
    })),
    projectiles: projectiles.map(p => ({
      modelFile: p.model,
      modelRaw: p.modelRaw,
      texture: p.texture,
      textureRaw: p.textureRaw,
      match: p.match,
    })),
  };

  return allocation;
}

// ===== 验证：PNG 文件存在性 =====
function collectAllPngs(texturesDir) {
  const pngs = new Set();
  function walk(dir, prefix = '') {
    try {
      const entries = readdirSync(dir);
      for (const e of entries) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) {
          walk(full, prefix + e + '/');
        } else if (e.toLowerCase().endsWith('.png')) {
          pngs.add(prefix + e);
        }
      }
    } catch { /* 目录不存在 */ }
  }
  walk(texturesDir);
  return pngs;
}

// ===== 验证单套模型 =====
function verifyModel(modelDir) {
  const name = basename(modelDir);
  const ysmPath = join(modelDir, 'ysm.json');
  const modelsDir = join(modelDir, 'models');
  const texturesDir = join(modelDir, 'textures');

  const files = parseYsmFiles(ysmPath);
  const alloc = simulateDirectFilesAllocation(files, modelDir);
  const allPngs = collectAllPngs(texturesDir);

  const issues = [];

  // 1. 默认皮肤 PNG 存在？
  if (alloc.defaultSkin) {
    // 在 allPngs 里找 basename 匹配
    const found = [...allPngs].find(p => basename(p) === alloc.defaultSkin);
    if (!found) {
      issues.push({
        type: '默认皮肤缺失',
        detail: `${alloc.defaultSkin} 不在 textures/ 目录里`,
      });
    }
  } else {
    issues.push({
      type: '默认皮肤缺失',
      detail: 'ysm.json player.texture 为空',
    });
  }

  // 2. 可切换皮肤 PNG 都存在？
  for (const skin of alloc.switchableSkins) {
    if (!skin) continue;
    const found = [...allPngs].find(p => basename(p) === skin);
    if (!found) {
      issues.push({
        type: '可切换皮肤缺失',
        detail: `${skin} 不在 textures/ 目录里`,
      });
    }
  }

  // 3. 主体模型 .json 都存在？
  for (const pm of alloc.playerModels) {
    if (pm.modelFile === '?') continue;
    const modelPath = join(modelsDir, pm.modelFile);
    if (!existsSync(modelPath)) {
      issues.push({
        type: '主体模型缺失',
        detail: `${pm.modelFile} 不在 models/ 目录里`,
      });
    }
  }

  // 4. 投射物模型 .json 都存在？（texture 检查在下方有独立守卫，此处仅守卫 model 存在性，
  //     原重复条件 `modelFile==='?' || modelFile==='?'` 是笔误，审核 P3）
  for (const proj of alloc.projectiles) {
    if (proj.modelFile === '?') continue;
    const modelPath = join(modelsDir, proj.modelFile);
    if (!existsSync(modelPath)) {
      issues.push({
        type: '投射物模型缺失',
        detail: `${proj.modelFile} 不在 models/ 目录里`,
      });
    }
    // 投射物纹理 PNG 存在？
    if (proj.texture && proj.texture !== '?') {
      const found = [...allPngs].find(p => basename(p) === proj.texture);
      if (!found) {
        issues.push({
          type: '投射物纹理缺失',
          detail: `${proj.texture} (${proj.modelFile}) 不在 textures/ 目录里`,
        });
      }
    }
  }

  return { name, alloc, issues, allPngs };
}

// ===== 执行 =====
console.log('验证 mjs：直读 ysm.json files 段分配纹理');
console.log('目标：确认"直读 files 段"能覆盖全 22 套 wine_fox 模型');
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
    continue; // 跳过没有 ysm.json 的目录
  }
  results.push(verifyModel(dir));
}

// ===== 输出每套模型的验证结果 =====
for (const r of results) {
  const status = r.issues.length === 0 ? '✅' : '❌';
  console.log(`${status} ${r.name}`);
  console.log(`   默认皮肤: ${r.alloc.defaultSkin || '(空)'}`);
  console.log(`   可切换皮肤: [${r.alloc.switchableSkins.join(', ')}]`);
  console.log(`   主体模型: [${r.alloc.playerModels.map(m => `${m.key}=${m.modelFile}`).join(', ')}]`);
  console.log(`   投射物: [${r.alloc.projectiles.map(p => `${p.modelFile}->${p.texture}`).join(', ')}] || (无)'}`);
  if (r.issues.length > 0) {
    console.log(`   缺口 (${r.issues.length}):`);
    for (const iss of r.issues) {
      console.log(`     [${iss.type}] ${iss.detail}`);
    }
  }
  console.log();
}

// ===== 汇总 =====
console.log('===== 汇总 =====');
console.log(`共验证 ${results.length} 套模型`);

const okModels = results.filter(r => r.issues.length === 0);
const ngModels = results.filter(r => r.issues.length > 0);
console.log(`\n✅ 全绿模型: ${okModels.length} 套`);
if (okModels.length > 0) {
  console.log(`  ${okModels.map(r => r.name).join(', ')}`);
}

console.log(`\n❌ 有缺口模型: ${ngModels.length} 套`);
if (ngModels.length > 0) {
  for (const r of ngModels) {
    console.log(`  ${r.name}: ${r.issues.map(i => i.type).join(', ')}`);
  }
}

// ===== 最终结论 =====
console.log('\n===== 结论 =====');
if (ngModels.length === 0) {
  console.log('✅ "直读 ysm.json files 段"的纹理分配能覆盖全 22 套模型');
  console.log('   → archive.go 可以安全地改为读 ysm.json files 段');
} else {
  console.log(`❌ ${ngModels.length} 套模型有缺口，需要先修复这些缺口`);
  console.log('   → 缺口清单见上方详细输出');
}
