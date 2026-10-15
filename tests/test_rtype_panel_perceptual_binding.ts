#!/usr/bin/env node
/**
 * 契约测试：随 rtype 联动面板的感知性绑定守卫（派生 fail-closed 版，2026-10-14 P1b；面 B 2026-10-15）。
 *
 * 背景（oldest-models 卡不变量「感知性绑定是三面板共同契约」）：dedup（init-pages.ts）/
 * oldest-models / recycle-bin 订阅 useCurrentResourceType 做类型联动——面板不可见时只记脏账
 * 不发全价 RPC（hidden 守卫），切进面板由 onShow 补扫。回收站曾是唯一漏 hidden 守卫的一个
 * （停在「文件树」tab 切类型在隐藏面板白发 2 次 RPC、占 guard 世代）。契约靠自觉必腐：
 * 本闸把候选面板从源码派生（不手工枚举），每个候选文件必须含三元组两 token（hidden 守卫 +
 * onShow 句柄），新面板漏契约当场红。
 *
 * 面 B（v2）：老病根是各面板**手写** `safeGet("repo_rtype") + bus.on("repo:rtype-changed")`——
 * hook 收编了消费面（面 A），但新面板**绕过 hook 裸订阅 bus 事件**即漏网。面 B 把
 * `bus.on("repo:rtype-changed"` 生产调用点也自动派生，每个文件必须在 rawSubFiles 归类表
 * （带 reason）里；新文件裸订阅 → 当场红。
 *
 * 变异检查（坐实）：① 摘掉某面板的 `container.hidden` → 该文件缺 token 即红；
 * ② 删掉 onShow 句柄 → 缺 token 即红；③ exemptFiles 条目指向已不存在的调用点 → 僵尸反查红；
 * ④ 面 B：临时生产文件裸订阅未归类 → 红；已归类但订阅点消失 → 僵尸归类红（fixture 探针）。
 *
 * 运行：node tests/test_rtype_panel_perceptual_binding.ts（或经 scripts/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
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

// 面 B 归类表：现存 4 个生产裸订阅文件（repo-rtype.ts 是 hook 本体，经 apiFiles 排除；
// bus.ts 仅事件类型声明，非 bus.on 调用，不进派生面）
const rawSubFiles = [
  {
    file: "frontend/src/views/app-nav/index.ts",
    reason: "派发侧：切换器 emit 后重订阅刷新自身 logo/标签（纯展示更新，无 RPC）",
  },
  {
    file: "frontend/src/views/app-sidebar/index.ts",
    reason: "壳组件左栏恒可见（非懒 tab 面板），loadInstances 跟随重载是设计行为，不适用感知性绑定",
  },
  {
    file: "frontend/src/views/app-content/init-pages.ts",
    reason: "类型切换仅置树 root 属性（轻量 UI，无全价 RPC）；本文件 dedup 面板的感知性绑定走 useCurrentResourceType（面 A 覆盖）",
  },
  {
    file: "frontend/src/views/app-sync-manager/index.ts",
    reason: "同步页为顶层页面（非懒 tab），跟随全局类型重载状态是设计行为；懒 tab 面板契约不适用",
  },
];

const { candidates, rawSubs, exemptHits, violations } = runRtypePanelGate({
  root: ROOT,
  srcDir: "frontend/src",
  hookName: "useCurrentResourceType",
  // hook 定义文件（`export function useCurrentResourceType(` 字面量）排除——它是 API 不是面板
  apiFiles: ["frontend/src/features/repo/repo-rtype.ts"],
  requiredTokens,
  // 有意例外在此登记（file + reason）；当前三面板全合规，无豁免
  exemptFiles: [],
  minFiles: 3, // 现网三面板（dedup/oldest-models/recycle-bin），低于 3 = 派生坏了
  rawSubEvent: "repo:rtype-changed",
  rawSubFiles,
  minRawSubFiles: 4, // 现网 4 个生产裸订阅文件（派发侧/壳组件/树属性/同步页），低于 4 = 派生坏了
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
// 面 B：4 个裸订阅文件逐一在案
for (const known of rawSubFiles.map((e) => e.file)) {
  assert.ok(
    rawSubs.includes(known),
    `既有裸订阅 ${known} 不在派生面——bus.on 调用形态变了（换封装/搬家？）或派生正则漏`,
  );
}

// ── 面 B fixture 探针（不碰真实 src 树）─────────────────────────────────────
const probe = fs.mkdtempSync(path.join(os.tmpdir(), "rtype-gate-"));
const probeSrc = path.join(probe, "src");
fs.mkdirSync(probeSrc, { recursive: true });
const fakePanel = path.join(probeSrc, "new-panel.ts");
fs.writeFileSync(
  fakePanel,
  'import { bus } from "./bus";\nlet off = () => {};\noff = bus.on("repo:rtype-changed", () => {});\nexport const cleanup = off;\n',
  "utf8",
);
const probeCfg = {
  root: probe,
  srcDir: "src",
  hookName: "useCurrentResourceType",
  apiFiles: [] as string[],
  requiredTokens,
  rawSubEvent: "repo:rtype-changed",
  minFiles: 0,
};
// ④a 未归类裸订阅 → 当场红
{
  const r = runRtypePanelGate({ ...probeCfg, rawSubFiles: [], minRawSubFiles: 0 });
  assert.ok(
    r.violations.some((v) => v.startsWith("src/new-panel.ts：")),
    `未归类的裸订阅新文件必须红，violations=${JSON.stringify(r.violations)}`,
  );
}
// ④b 归类后 → 绿
{
  const r = runRtypePanelGate({
    ...probeCfg,
    rawSubFiles: [{ file: "src/new-panel.ts", reason: "探针" }],
    minRawSubFiles: 1,
  });
  assert.strictEqual(r.violations.length, 0, `归类后应绿，violations=${JSON.stringify(r.violations)}`);
}
// ④c 僵尸归类（条目指向无订阅文件）→ 红
{
  const r = runRtypePanelGate({
    ...probeCfg,
    rawSubFiles: [{ file: "src/gone.ts", reason: "探针" }],
    minRawSubFiles: 0,
  });
  assert.ok(
    r.violations.some((v) => v.includes("僵尸条目 src/gone.ts")),
    `僵尸归类必须红，violations=${JSON.stringify(r.violations)}`,
  );
}
fs.rmSync(probe, { recursive: true, force: true });

console.log(
  `[test_rtype_panel_perceptual_binding] ${candidates.length} 个 rtype 联动面板全合规（hidden 守卫 + onShow 句柄）；${rawSubs.length} 个裸订阅全归类`,
);
