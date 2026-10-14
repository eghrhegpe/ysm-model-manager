#!/usr/bin/env node
/**
 * 契约测试：随 rtype 联动面板的感知性绑定守卫（派生 fail-closed 版，2026-10-14 P1b）。
 *
 * 背景（oldest-models 卡不变量「感知性绑定是三面板共同契约」）：dedup（init-pages.ts）/
 * oldest-models / recycle-bin 订阅 useCurrentResourceType 做类型联动——面板不可见时只记脏账
 * 不发全价 RPC（hidden 守卫），切进面板由 onShow 补扫。回收站曾是唯一漏 hidden 守卫的一个
 * （停在「文件树」tab 切类型在隐藏面板白发 2 次 RPC、占 guard 世代）。契约靠自觉必腐：
 * 本闸把候选面板从源码派生（不手工枚举），每个候选文件必须含三元组两 token（hidden 守卫 +
 * onShow 句柄），新面板漏契约当场红。
 *
 * 变异检查（三方向坐实）：① 摘掉某面板的 `container.hidden` → 该文件缺 token 即红；
 * ② 删掉 onShow 句柄 → 缺 token 即红；③ exemptFiles 条目指向已不存在的调用点 → 僵尸反查红。
 *
 * 运行：node tests/test_rtype_panel_perceptual_binding.ts（或经 scripts/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRtypePanelGate } from "../scripts/_lib/rtype-panel-gate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 感知性绑定三元组的两个文件级 token（dirty 记账是 hidden 守卫分支的内部实现，不作独立 token）：
//   - hidden 守卫：`container.hidden` / `container?.hidden`（`.hidden` 属词即命中）
//   - onShow 补渲染句柄（tabs-runtime showFns 通道的落位点）
const requiredTokens = [
  { name: "hidden 守卫", re: /\.hidden\b/ },
  { name: "onShow 补渲染句柄", re: /\bonShow\b/ },
];

const { candidates, exemptHits, violations } = runRtypePanelGate({
  root: ROOT,
  srcDir: "frontend/src",
  hookName: "useCurrentResourceType",
  // hook 定义文件（`export function useCurrentResourceType(` 字面量）排除——它是 API 不是面板
  apiFiles: ["frontend/src/features/repo/repo-rtype.ts"],
  requiredTokens,
  // 有意例外在此登记（file + reason）；当前三面板全合规，无豁免
  exemptFiles: [],
  minFiles: 3, // 现网三面板（dedup/oldest-models/recycle-bin），低于 3 = 派生坏了
});

assert.strictEqual(
  violations.length,
  0,
  `感知性绑定违约 ${violations.length} 处：\n${violations.join("\n")}`,
);
assert.ok(
  candidates.length >= 3,
  `候选面板 ${candidates.length} < 3：派生失效（useCurrentResourceType 调用点漏扫？）`,
);
// 三面板逐一在案（防派生静默吞掉某个既有面板）
for (const known of [
  "frontend/src/features/maintenance/oldest-models.ts",
  "frontend/src/features/maintenance/recycle-bin.ts",
  "frontend/src/views/app-content/init-pages.ts",
]) {
  assert.ok(
    candidates.includes(known),
    `既有面板 ${known} 不在候选集——useCurrentResourceType 调用形态变了（改名/搬家？）或派生正则漏`,
  );
}
assert.strictEqual(exemptHits, 0, `当前无豁免位，exemptHits=${exemptHits} 异常`);

console.log(
  `[test_rtype_panel_perceptual_binding] ${candidates.length} 个 rtype 联动面板全合规（hidden 守卫 + onShow 句柄）`,
);
