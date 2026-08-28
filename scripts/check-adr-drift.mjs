#!/usr/bin/env node
/**
 * check-adr-drift.mjs — ADR 描述与代码现实漂移检测。
 *
 * 背景：ADR-002 等健康检查文档在代码还债后常忘记翻牌，导致 AI 把已完成的活
 * 反复当成开放债（实测：app_install.go 已还债成 10 行薄壳、DownloadQueue↔App
 * 循环已改 callback 模式，但 ADR-002 文本仍标"待办/未下沉"）。
 *
 * 本脚本做双向校验：
 *   A) 文档侧：若 ADR-002 文本仍含已知"已还债但标开放"的旧表述 → 报 DRIFT。
 *   B) 代码侧（正向事实源）：直接读源码断言现实，与文档声明对账。
 *      - app_install.go 行数应 < 50（薄壳），否则 DRIFT（它本应已下沉）。
 *      - DownloadQueue 结构体不应含 *App 字段（循环应已打破）。
 *
 * 零依赖（仅 node:fs / node:path / node:url，复用 _lib/scan-files.mjs 的 ROOT）。
 *
 * 用法：
 *   node scripts/check-adr-drift.mjs           # 文本报告
 *   node scripts/check-adr-drift.mjs --json    # JSON（CI / 子代理消费）
 *
 * 退出码：发现漂移 → 1；一致或仅警告 → 0。
 *
 * 新增"已还债事实"时，在此文件的 KNOWN_REPAID 与 CODE_ASSERTS 同步登记。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

// ---- 已知"已还债但历史文档可能仍标开放"的表述（文档侧漂移特征串）----
// 每条用 tokens（必须同时出现的子串）+ exclude（出现则排除漂移，即已翻牌）判定。
// 用 token 组合而非长正则，避免中英文括号/全半角差异导致漏匹配。
// 每条：{ tokens: string[], exclude?: string[], fact: '人类可读的事实描述' }
const KNOWN_REPAID = [
  {
    // 原表述「app_install.go（1,315 行）仍未下沉」的高区分度组合
    tokens: ['1,315', '仍未下沉'],
    fact: 'app_install.go 已还债：现为薄壳（< 50 行），逻辑迁至 app_install_instance.go',
  },
  {
    // 原表述「分散在 17 个文件中」且未加翻牌注记
    tokens: ['分散在', '17', '个文件'],
    exclude: ['评估时点'],
    fact: 'god-object 散布文件数已变（实测 21 个），且 app_install.go 已下沉，原 17 文件表述失真',
  },
  {
    // 原表述「DownloadQueue ↔ App 存在对象级循环引用（NewDownloadQueue(a) 持有 *App）」
    tokens: ['DownloadQueue', '↔', 'App', '对象级循环引用', '持有', '*App'],
    fact: 'DownloadQueue↔App 循环已打破：改为回调注入（downloadFn/emitFn/logFn），无 *App 字段',
  },
  {
    // 误判「app_scan.go（691 行）仍需进一步下沉」——实测核心已下沉 go/scanner，691 行为门面 + helper
    // 命中条件：文档同时含 app_scan.go（行数）+ 明确「未下沉/进一步下沉/下沉重心」债务表述
    tokens: ['app_scan.go', '下沉'],
    exclude: ['已下沉', 'go/scanner', '门面', '非未还债', '核心逻辑已下沉'],
    fact: 'app_scan.go 核心已下沉 go/scanner（扫描/哈希/缓存/作者提取/索引）；691 行是 Binding 门面 + helper，非未还债',
  },
];

// 审计报告复核段防倒退：这些报告已被 2026-08-23 复核翻牌（证明代码债已还）。
// 若复核段被删除/篡改，说明有人试图把已还债重新标为开放债，报 DRIFT。
// 判定：文件必须存在且含「状态复核（2026-08-23）」锚点。
const AUDIT_REVIEWED = [
  'docs/audit/archive/audit-r1-3d-engine-core-2026-08-18.md',
  'docs/audit/archive/audit-r7-performance-memory-2026-08-18.md',
  'docs/audit/archive/audit-r9-3d-preview-resource-management-2026-08-18.md',
  'docs/audit/archive/audit-r10-animation-resource-management-2026-08-18.md',
  'docs/audit/archive/audit-r11-texture-lifecycle-2026-08-18.md',
  'docs/audit/archive/audit-r12-scene-switch-race-2026-08-18.md',
  'docs/audit/audit-r14-coverage-2026-08-18.md',
];

// 文档侧漂移：含全部 token 的段落中，存在「无翻牌排除词」的段落 → 命中
function docHasDrift(text, item) {
  const hit = item.tokens.every((t) => text.includes(t));
  if (!hit) return false;
  if (!item.exclude || !item.exclude.length) return true;
  // 段落级判断：翻牌标记须与漂移表述同段才算数。
  // 若存在任一含 token 段落且不含任何排除词 → 漂移（该段落未被翻牌覆盖）。
  const paras = text.split(/\n\s*\n/);
  const tokenParas = paras.filter((p) => item.tokens.every((t) => p.includes(t)));
  return tokenParas.some((p) => !item.exclude.some((x) => p.includes(x)));
}

// ---- 代码侧正向断言（事实源 = 源码）----
// 每项返回 { ok: boolean, detail: string }
function codeAsserts() {
  const results = [];

  // 1. app_install.go 应为薄壳（< 50 行）
  const installPath = path.join(ROOT, 'internal/app/app_install.go');
  try {
    const lines = fs.readFileSync(installPath, 'utf-8').split('\n').length;
    results.push({
      name: 'app_install.go 薄壳',
      ok: lines < 50,
      detail: `app_install.go = ${lines} 行（阈值 < 50，薄壳判定）`,
    });
  } catch (e) {
    results.push({ name: 'app_install.go 薄壳', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 2. DownloadQueue 结构体不应含 *App 字段
  const dlPath = path.join(ROOT, 'internal/app/app_download.go');
  try {
    const text = fs.readFileSync(dlPath, 'utf-8');
    const structM = text.match(/type DownloadQueue struct\s*\{([\s\S]*?)\n\}/);
    const body = structM ? structM[1] : '';
    const hasAppField = /\*\s*App\b/.test(body);
    results.push({
      name: 'DownloadQueue 无 *App 字段',
      ok: !hasAppField,
      detail: hasAppField
        ? 'DownloadQueue 仍持有 *App 字段（循环未打破）'
        : 'DownloadQueue 无 *App 字段（循环已打破，回调注入）',
    });
  } catch (e) {
    results.push({ name: 'DownloadQueue 无 *App 字段', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 3. scripts/ 下不应残留 .py 一次性脚本（Python→Node 全量迁移 295ac07e 已清理）
  const scriptsDir = path.join(ROOT, 'scripts');
  try {
    const pyFiles = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.py'));
    results.push({
      name: 'scripts/ 无残留 .py 脚本',
      ok: pyFiles.length === 0,
      detail: pyFiles.length === 0
        ? 'scripts/ 零 .py 文件（Python→Node 迁移已完成）'
        : `残留 ${pyFiles.length} 个 .py：${pyFiles.slice(0, 5).join(', ')}…（应迁移为 .mjs 或删除）`,
    });
  } catch (e) {
    results.push({ name: 'scripts/ 无残留 .py 脚本', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 4. site-view 拆分防倒退：旧 community/site-view.js 不应复活；site-view.ts 应保持薄壳（≤200 行）
  const oldSiteView = path.join(ROOT, 'frontend/src/views/app-content/community/site-view.js');
  const newSiteView = path.join(ROOT, 'frontend/src/views/app-content/site-view.ts');
  try {
    const oldExists = fs.existsSync(oldSiteView);
    let detail = oldExists ? '旧 community/site-view.js 已复活（应删除/迁移）' : 'community/site-view.js 已拆除';
    let ok = !oldExists;
    if (!oldExists && fs.existsSync(newSiteView)) {
      const lines = fs.readFileSync(newSiteView, 'utf-8').split('\n').length;
      detail += `；site-view.ts ${lines} 行` + (lines <= 200 ? '（薄壳达标）' : `（超 200 行薄壳阈值：${lines}）`);
      if (lines > 200) ok = false;
    }
    results.push({ name: 'site-view 拆分防倒退', ok, detail });
  } catch (e) {
    results.push({ name: 'site-view 拆分防倒退', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 5. r12 P1 并发切换抑制防倒退：switch-preview.ts 必须含 inFlight 守卫
  const switchPreviewPath = path.join(ROOT, 'frontend/src/utils/3d/adapters/switch-preview.ts');
  try {
    const text = fs.existsSync(switchPreviewPath) ? fs.readFileSync(switchPreviewPath, 'utf-8') : '';
    // code review P3：放宽格式敏感——加花括号/删 : boolean 注解的合法重构不误报
    const hasInFlight = /inFlight\s*(:\s*boolean)?\b/.test(text) && /if\s*\(\s*ctx\.inFlight\s*\)\s*\{?\s*return/.test(text);
    results.push({
      name: 'r12 P1 并发抑制守卫',
      ok: hasInFlight,
      detail: hasInFlight
        ? 'switch-preview.ts 含 inFlight 守卫（r12 P1 已修，防倒退）'
        : 'switch-preview.ts 缺失 inFlight 并发抑制（r12 P1 倒退）',
    });
  } catch (e) {
    results.push({ name: 'r12 P1 并发抑制守卫', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 6. r10/r11 纹理+MMD 生命周期防倒退：mmd-adapter 必含 uncacheRoot + 全纹理槽释放
  //    mmd-adapter 走自有释放路径（TEX_SLOTS 含 emissiveMap + tex.dispose() 遍历），不调通用 disposeMaterial
  const mmdAdapterPath = path.join(ROOT, 'frontend/src/utils/3d/adapters/mmd-adapter.ts');
  try {
    const text = fs.existsSync(mmdAdapterPath) ? fs.readFileSync(mmdAdapterPath, 'utf-8') : '';
    const hasUncacheRoot = /uncacheRoot\s*\(/.test(text);
    const hasFullSlotDispose =
      /["']emissiveMap["']/.test(text) && /tex\.dispose\(\)|mat\.dispose\(\)/.test(text) && /blobUrls?/.test(text);
    const ok = hasUncacheRoot && hasFullSlotDispose;
    results.push({
      name: 'r10/r11 MMD 生命周期',
      ok,
      detail: ok
        ? 'mmd-adapter.ts 含 uncacheRoot + 全纹理槽释放（r10/r11 已修，防倒退）'
        : `mmd-adapter.ts 缺失关键释放（uncacheRoot=${hasUncacheRoot}, 全槽dispose=${hasFullSlotDispose}）`,
    });
  } catch (e) {
    results.push({ name: 'r10/r11 MMD 生命周期', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 7. r1/r11 capability dispose 体系防倒退：caps/ 下 light + postprocessing 必须存在 dispose 体
  const lightCapPath = path.join(ROOT, 'frontend/src/utils/3d/caps/light-capability.ts');
  const postCapPath = path.join(ROOT, 'frontend/src/utils/3d/caps/postprocessing-capability.ts');
  try {
    const lightOk = fs.existsSync(lightCapPath) && /dispose\s*\(\)/.test(fs.readFileSync(lightCapPath, 'utf-8'));
    const postOk = fs.existsSync(postCapPath) && /disposeComposer|dispose\s*\(\)/.test(fs.readFileSync(postCapPath, 'utf-8'));
    results.push({
      name: 'r1/r11 capability dispose 体系',
      ok: lightOk && postOk,
      detail: lightOk && postOk
        ? 'caps/light + postprocessing 含 dispose 体系（r1 P2-2/5/6、r11 已修，防倒退）'
        : `capability 缺失 dispose（light=${lightOk}, post=${postOk}）`,
    });
  } catch (e) {
    results.push({ name: 'r1/r11 capability dispose 体系', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 8. r14 P1 updater 重复声明修复防倒退：_Critical 版测试文件必须存在
  const updaterCriticalPath = path.join(ROOT, 'go/updater/updater_critical_test.go');
  try {
    const exists = fs.existsSync(updaterCriticalPath);
    results.push({
      name: 'r14 P1 updater 重复声明修复',
      ok: exists,
      detail: exists
        ? 'updater_critical_test.go 存在（重复声明已改名修复，防倒退）'
        : 'updater_critical_test.go 缺失（r14 P1 修复倒退，CI 将再阻塞）',
    });
  } catch (e) {
    results.push({ name: 'r14 P1 updater 重复声明修复', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 9. ADR-029 WASM glue patch 防倒退：wasm_decoder.go 必须注入 HEAPU8（防 _getGlueCode bug 倒退）
  const wasmDecoderPath = path.join(ROOT, 'internal/app/wasm_decoder.go');
  try {
    const text = fs.existsSync(wasmDecoderPath) ? fs.readFileSync(wasmDecoderPath, 'utf-8') : '';
    const hasHeapPatch = /HEAPU8/.test(text) && /ReplaceAll/.test(text);
    const ok = hasHeapPatch;
    results.push({
      name: 'ADR-029 WASM glue HEAPU8 注入',
      ok,
      detail: ok
        ? 'wasm_decoder.go 含 HEAPU8 注入 patch（ADR-029 bug 已修，防倒退）'
        : 'wasm_decoder.go 缺失 HEAPU8 注入（ADR-029 _getGlueCode bug 倒退风险）',
    });
  } catch (e) {
    results.push({ name: 'ADR-029 WASM glue HEAPU8 注入', ok: false, detail: `读取失败: ${e.message}` });
  }

  return results;
}

// ---- 主流程 ----
const adr002Path = path.join(ROOT, 'docs/adr/ADR-002-project-health-assessment.md');
const drifts = [];      // 硬漂移（文档标开放但代码已还债 / 代码断言失败）
const warnings = [];

if (fs.existsSync(adr002Path)) {
  const adrText = fs.readFileSync(adr002Path, 'utf-8');
  for (const item of KNOWN_REPAID) {
    if (docHasDrift(adrText, item)) {
      drifts.push(`DOC_DRIFT: ADR-002 仍含已还债表述「${item.fact}」——请同步翻牌`);
    }
  }
} else {
  warnings.push(`WARN: ${path.relative(ROOT, adr002Path)} 不存在，跳过文档侧校验`);
}

const codeResults = codeAsserts();
for (const r of codeResults) {
  if (!r.ok) drifts.push(`CODE_DRIFT: ${r.name} — ${r.detail}`);
}

// 审计复核段防倒退：已翻牌的报告若丢失「状态复核」锚点 → 漂移
for (const rel of AUDIT_REVIEWED) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    drifts.push(`AUDIT_DRIFT: ${rel} 缺失（复核翻牌文件被删）`);
    continue;
  }
  const txt = fs.readFileSync(abs, 'utf-8');
  if (!txt.includes('状态复核（2026-08-23）')) {
    drifts.push(`AUDIT_DRIFT: ${rel} 复核段被移除——已还债条目可能正被重新标为开放债`);
  }
}

// ---- 输出 ----
const summary = {
  docDriftPatterns: KNOWN_REPAID.length,
  codeAsserts: codeResults.length,
  drifts: drifts.length,
  warnings: warnings.length,
};

if (jsonMode) {
  process.stdout.write(
    JSON.stringify({ _summary: summary, codeAsserts: codeResults, drifts, warnings }, null, 2) + '\n',
  );
} else {
  console.log('=== ADR 漂移检测 ===');
  console.log(`代码侧断言：${codeResults.length} 项`);
  for (const r of codeResults) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name} — ${r.detail}`);
  }
  if (warnings.length) {
    console.log('\n警告：');
    for (const w of warnings) console.log(`  ⚠️  ${w}`);
  }
  if (drifts.length) {
    console.log(`\nFAILED: 发现 ${drifts.length} 处漂移\n`);
    for (const d of drifts) console.log(`  [${d}]`);
    process.exit(1);
  } else {
    console.log('\nOK: ADR 描述与代码现实一致，无漂移');
  }
}

process.exit(drifts.length ? 1 : 0);
