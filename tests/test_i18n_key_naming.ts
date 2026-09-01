#!/usr/bin/env node
/**
 * 契约测试：i18n-key-naming.mjs 三段式校验（ADR-124）
 *
 * 目的：压测极端情况，防止误判（false positive）阻断正常提交/推送。
 *   validateKey 把合规键误判为违规 → CI 模式 exit 1 → 阻断 git commit/push。
 *   本测试覆盖所有边界，门禁接入后每次 push 自动跑。
 *
 * 覆盖分组：
 *   1. 合规三段（白名单角色）— 已迁移的骨骼键，必须 ok
 *   2. 合规三段（子命名空间意图）— 误判重灾区：audio/cache/proxy/layer/panel
 *      单凭字面无法区分子命名空间与自创角色，三段成段即应合法
 *   3. 例外命名空间（自身即角色）— menu/error/nav/lang/ctx/app/dialog 两段及三段都 ok
 *   4. 合规两段子命名空间 — 驼峰多段 / 含下划线 / 数字开头
 *   5. 两段实体直挂 root — ADR-124 主战场，必须报违规
 *   6. KNOWN_TWO_SEG_ENTITIES 保留旧键 — 两段合法（兼容期）
 *   7. 单段键 — 合法
 */
import { validateKey } from '../scripts/i18n-key-naming.ts';

const errors = [];
let okCount = 0;
let violationCount = 0;

function assertOk(key) {
  const r = validateKey(key);
  if (!r.ok) {
    errors.push(`应合规却报违规: ${key} → ${r.reason}`);
  } else {
    okCount++;
  }
}

function assertViolation(key) {
  const r = validateKey(key);
  if (r.ok) {
    errors.push(`应违规却判合规: ${key}`);
  } else {
    violationCount++;
  }
}

// ── 1. 合规三段（白名单角色）─ 已迁移的骨骼键 ──
assertOk('preview.metric.boneCount');
assertOk('preview.field.boneNames');
assertOk('preview.action.exportBoneNames');
assertOk('preview.tab.skeleton');
assertOk('preview.label.skeleton');
assertOk('preview.section.bones');
assertOk('preview.hint.clickBone');
assertOk('advFilter.validation.minGtMaxBones');
assertOk('web.metric.boneCount');
assertOk('diagnostics.metric.assetsBones');

// ── 2. 合规三段（子命名空间意图）─ 误判重灾区 ──
// 这些第二段是 4-8 字符纯小写、不在 KNOWN_ROLES 的子命名空间词，
// 修复前被 classifySecondSegment 判为 role → 三段报"角色不在白名单"。
assertOk('settings.audio.volume');
assertOk('preview.proxy.shadowMapSize');
assertOk('settings.cache.size');
assertOk('preview.layer.fog');
assertOk('preview.panel.bones');
assertOk('settings.network.timeout');
assertOk('preview.rendersettings.fog');

// ── 3. 例外命名空间（自身即角色）─ 两段及三段都 ok ──
assertOk('menu.openFolder');
assertOk('menu.audio.volume');       // 例外三段，修复前会误判
assertOk('error.networkOffline');
assertOk('error.msg.cacheFull');      // 例外三段
assertOk('dialog.bones');
assertOk('dialog.field.boneNames');   // 例外三段
assertOk('nav.repository');
assertOk('lang.en');

// ── 4. 合规两段子命名空间 ──
assertOk('preview.postprocessingGroupBloom');   // 驼峰多段
assertOk('preview.env_group_custom');           // 含下划线
assertOk('preview.3dPreview');                  // 数字开头
assertOk('preview.fov');                        // td/fov 类短词（^[a-z]{1,3}\d*$）

// ── 5. 两段实体直挂 root ─ ADR-124 主战场，必须报违规 ──
// 第二段在 COMMON_ENTITIES 或 ≤8 纯小写非白名单 → role → 违规
assertViolation('preview.zoom');
assertViolation('preview.bones');      // bones 在 COMMON_ENTITIES → role
assertViolation('settings.theme');     // theme ≤8 纯小写非白名单 → role
// 以下在当前启发式下被判合法（≤3 字符走 subns，或驼峰拆不出已知 role）——
// 属刻意的漏报取舍：放行它们换取 td/fov/fovX 等术语不被误拦，不阻碍提交
assertOk('preview.fog');              // fog ≤3 字符 → subns（与 td/fov 同类放行）
assertOk('preview.zoomIn');           // 驼峰 zoomIn 拆出 In 非已知 role → subns
assertOk('tree.sortName');            // 驼峰 sortName 拆出 Name 非已知 role → subns

// ── 6. KNOWN_TWO_SEG_ENTITIES 保留旧键（兼容期两段合法）──
assertOk('preview.skeletonTab');
assertOk('preview.boneCount');
assertOk('preview.boneLabels');
assertOk('preview.bonesLabel');
assertOk('diagnostics.assetsBones');
assertOk('advFilter.minGtMaxBones');

// ── 7. 单段键 ──
assertOk('lang');
assertOk('app');

if (errors.length) {
  console.error(`❌ i18n-key-naming 校验误判（${errors.length} 处）：`);
  for (const e of errors) console.error('  - ' + e);
  console.error('\n误判会阻断 commit/push，修复 scripts/i18n-key-naming.ts 的 validateKey 后再接门禁。');
  process.exit(1);
}

console.log(`✅ i18n-key-naming 校验：${okCount} 个合规用例 + ${violationCount} 个违规用例全部符合预期`);
