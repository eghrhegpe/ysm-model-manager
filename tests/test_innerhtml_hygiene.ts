#!/usr/bin/env node
/**
 * test_innerhtml_hygiene.ts — R8 模板闸扫描核契约测试（2026-09 SVG 接入审计立法）。
 *
 * 锁什么（每条都对应扫描核真实踩过的坑或要守的门）：
 *   1. **非空转**：外部数据裸插进 innerHTML 模板必须命中——初代 R8 正则的盲区
 *      （反引号开头恒不命中）正是本闸存在的理由，闸若空转比无闸更糟（假绿）。
 *   2. **游标泄漏回归**（初版事故）：分段器漏掉「普通字符收尾」时条件段被切成空串、
 *      slice(1) 错位，`a !== 1 ? \`<p>${m.count || 0}</p>\` : ""` 这类模板链被误判
 *      可信。本用例钉死该形态必须报违规。
 *   3. **嵌套模板出口收口**：map/join 代码骨架下内层插值全可信才可信；且骨架含顶层
 *      运算符（?? || && ? : +）时不得靠「模板内部安全」短路——`rawData ?? \`安全模板\``
 *      的左侧照样被注入（本仓 modal 的 bodyHTML ?? 模板即此形态，靠命名约定过关）。
 *   4. **白名单形态**：UI_ICONS/ICONS 常量、t/tOf/translate、esc 系、resolveIcon 系、
 *      render 前缀 / build 前缀 / HTML 后缀 builder、*Html/*Svg/*CSS 命名约定、
 *      字面量三元、数值格式化——各自不得命中（防闸越修越宽后反向误伤主流写法）。
 *   5. **r8-allow 豁免**：行注使整个模板放行（预构建 HTML 局部通道的精确逃生阀）。
 *
 * 依赖：node:assert / scripts/_lib/innerhtml-hygiene.ts（纯函数核）
 * 用法：node tests/test_innerhtml_hygiene.ts
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import { isTrustedExpr, scanSource } from "../scripts/_lib/innerhtml-hygiene.ts";

let passed = 0;
function ok(cond: boolean, msg: string): void {
  assert.ok(cond, msg);
  passed++;
}

/** 样本构造：产出 `box.innerHTML = \`<inner>\`;`（模板串书写 + \$ 转义，全程无字面 ${} 字面量） */
function assignSrc(inner: string, indent = "  "): string {
  return `${indent}box.innerHTML = \`${inner}\`;`;
}

// ── 1. 非空转：外部数据裸插必须命中 ──
ok(!isTrustedExpr("cfg.mcRoot"), "成员链（外部数据）不得可信");
ok(!isTrustedExpr("paths[0]"), "下标成员链不得可信");
ok(!isTrustedExpr("evil"), "裸标识符不得可信");
const nakedHit = scanSource(assignSrc(`\${UI_ICONS.game} \${cfg.mcRoot}`));
ok(
  nakedHit.length === 1 && (nakedHit[0]?.expr ?? "").includes("cfg.mcRoot"),
  "scanSource 必须抓到裸路径插值",
);

// ── 2. 游标泄漏回归（初版事故形态）──
const TERNARY_BAD = `a !== 1 ? \`<p>\${m.count || 0}</p>\` : ""`;
const TERNARY_LITS = `x !== 1 && y !== 2 ? "a" : "b"`;
const AMP_TPL_BAD = `ext !== ".nbt" && ext !== ".schematic" ? \`<div>\${meta.regionCount || 0}</div>\` : ""`;
ok(!isTrustedExpr(TERNARY_BAD), "三元 + 内嵌模板含裸数据：不得因分段器游标错位而放行");
ok(isTrustedExpr(TERNARY_LITS), "&& 条件 + 字面量分支：可信（cond 不注入）");
ok(!isTrustedExpr(AMP_TPL_BAD), "&& 条件链 + 内嵌模板含裸数据：必须命中");

// ── 3. 嵌套模板出口收口 / 短路不得越界 ──
const MAP_SAFE = `items.map((item) => \`<div class="x \${item.id === cur ? "active" : ""}" data-page="\${esc(item.id)}"><span>\${resolveIcon(item.icon)}</span><span>\${t(item.key)}</span></div>\`).join("")`;
const MAP_BAD = `items.map((item) => \`<div data-page="\${item.id}"><span>\${t(item.key)}</span></div>\`).join("")`;
const NULLISH_TPL = `bodyHtml ?? \`<div class="dlg-msg">\${esc(message)}</div>\``;
const NULLISH_RAW = `bodyRaw ?? \`<div class="dlg-msg">\${esc(message)}</div>\``;
ok(isTrustedExpr(MAP_SAFE), "map/join 骨架 + 内层插值全可信 → 可信");
ok(!isTrustedExpr(MAP_BAD), "内层一处裸数据 → 整体命中（出口收口不漏一枚）");
ok(isTrustedExpr(NULLISH_TPL), "?? 左操作数命名约定可信 + 内嵌模板全可信 → 可信");
ok(!isTrustedExpr(NULLISH_RAW), "?? 左操作数裸标识符：不得靠模板内部安全短路");

// ── 4. 白名单形态不得误伤 ──
ok(isTrustedExpr("UI_ICONS.search"), "UI_ICONS 常量");
ok(isTrustedExpr("ICONS.GITHUB"), "workshop ICONS 常量");
ok(isTrustedExpr('t("common.ok")'), "i18n");
ok(isTrustedExpr("tOf(g.labelKey)"), "tOf 薄包装");
ok(isTrustedExpr("esc(cfg.mcRoot)"), "esc 产物（含成员链入参）");
ok(isTrustedExpr("ctx.esc(e.err)"), "ctx.esc 方法形态");
ok(isTrustedExpr("renderIconHtml(opts?.icon)"), "图标字符串出口（三态契约）");
ok(isTrustedExpr("resolveIcon(item.icon)"), "图标解析产物");
ok(isTrustedExpr("getSiteIcon(s.id)"), "查表图标产物");
ok(isTrustedExpr("renderDisplayName(e.name)"), "render* builder 命名");
ok(isTrustedExpr("buildSiteHtml(d)"), "build* builder 命名");
ok(isTrustedExpr("typeMenuItemsHTML()"), "*HTML() 调用形态");
ok(isTrustedExpr("previewImgHTML"), "*HTML 预构建局部命名约定");
ok(isTrustedExpr("coverHtml"), "*Html 预构建局部命名约定");
ok(isTrustedExpr("okIconSvg"), "*Svg 图标产物命名约定");
ok(isTrustedExpr("wsIconCSS"), "*CSS 静态样式常量命名约定");
ok(
  isTrustedExpr(`savedTab !== "detail" ? ' style="display:none"' : ""`),
  "字符串字面量三元（含串内双引号）",
);
ok(isTrustedExpr("stats.bones.toLocaleString()"), "数值格式化");
ok(isTrustedExpr(`".".repeat(n)`), "字面量 repeat");

// ── 5. r8-allow 豁免 ──
const MARKED = `  // r8-allow: 预构建 HTML 局部（静态不可推断）\n${assignSrc(`\${bodyRaw}`)}`;
ok(scanSource(MARKED).length === 0, "r8-allow 行注放行整个模板");
ok(scanSource(assignSrc(`\${bodyRaw}`)).length === 1, "无豁免标记时不放行");

// ── 6. 非模板赋值不归本闸管（与旧 R8 正则分工）──
ok(scanSource("  el.innerHTML = someVar;").length === 0, "RHS 变量形态归旧 R8 正则，本闸不重复报");
ok(scanSource(assignSrc("UI_ICONS.close")).length === 0, "纯常量模板零命中");

console.log(`✅ test_innerhtml_hygiene: ${passed} 断言全绿`);
