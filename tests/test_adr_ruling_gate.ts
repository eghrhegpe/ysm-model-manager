#!/usr/bin/env node
/**
 * test_adr_ruling_gate.ts — 第三刀（ADR 增量门槛）契约测试。
 *
 * 覆盖：
 *   1. _lib/adr-tier-gate.ts 准入三问判定（纯函数）
 *   2. new-adr.ts --tier decisions 三问门：缺 --justify 拒 / 单点裁定拒 / 契约凭据过
 *   3. add-card-ruling.ts：锚点格式校验（禁「文件:行号」）、缺必填拒、卡不存在拒、
 *      合法调用 dry-run 输出格式（零写入）
 *
 * 用法：node tests/test_adr_ruling_gate.ts
 */
import { admissionReasons, passesAdmissionGate } from "../scripts/_lib/adr-tier-gate.ts";
import { failures, finish, ok, runScript } from "./_lib.mts";

console.log("=== ADR 增量门槛（第三刀）契约 ===");

// ── 1. 准入三问纯函数 ─────────────────────────────────
ok("三问全否（单点裁定）→ 拒绝", passesAdmissionGate("单点执行裁定：helper 默认改 false").pass === false);
ok(
  "Q1 公共契约变更 → 通过",
  passesAdmissionGate("公共契约变更：绑定签名增 ErrorCode 字段").pass === true,
);
ok(
  "Q2 跨域纪律政策 → 通过",
  passesAdmissionGate("全仓测试纪律：禁 mock 被断言谓词").pass === true,
);
ok(
  "Q3 难逆转跨域 → 通过",
  passesAdmissionGate("难逆转：跨域影响面跨 5 模块").pass === true,
);
ok("空凭据 → 拒绝", passesAdmissionGate("").pass === false);
ok("降格指引包含 add-card-ruling 命令", passesAdmissionGate("x").hint.includes("add-card-ruling.ts"));

// ── 2. new-adr.ts 三问门（dry-run，零写入）────────────
let r = runScript("new-adr.ts", "gate-no-justify", "--tier", "decisions", "--parent", "319", "--slug", "gate-no-justify", "--dry-run");
ok("decisions 缺 --justify → 退出 1", r.status === 1, `status=${r.status}`);

r = runScript("new-adr.ts", "gate-ruling", "--tier", "decisions", "--parent", "319", "--slug", "gate-ruling", "--justify", "单点执行裁定：默认值改 false", "--dry-run");
ok("decisions 单点裁定凭据 → 退出 1（拒绝立 ADR）", r.status === 1, `status=${r.status} out=${r.stdout?.slice(0, 80)}`);

r = runScript("new-adr.ts", "gate-contract", "--tier", "decisions", "--parent", "319", "--slug", "gate-contract", "--justify", "公共契约变更：绑定签名增字段，跨端契约锁", "--dry-run");
ok("decisions 公共契约凭据 → 过闸（dry-run 成功）", r.status === 0 && /\[准入\]/.test(r.stdout || ""), `status=${r.status} out=${r.stdout?.slice(0, 120)}`);

// ── 3. add-card-ruling.ts 校验与 dry-run ─────────────
r = runScript("add-card-ruling.ts", "ruling-badanchor", "--decision", "x", "--why", "y", "--revert", "file.ts:358");
ok("锚点含「文件:行号」→ 拒绝", r.status === 1 && /格式非法/.test(r.stderr || ""), `status=${r.status} err=${r.stderr?.slice(0, 80)}`);

r = runScript("add-card-ruling.ts", "ruling-nokind", "--decision", "x", "--why", "y", "--revert", "a|b");
ok("知识卡不存在 → 拒绝", r.status === 1 && /不存在/.test(r.stderr || ""), `status=${r.status}`);

r = runScript("add-card-ruling.ts", "ruling-nodecision", "--why", "y", "--revert", "a|b");
ok("缺 --decision → 拒绝", r.status === 1, `status=${r.status}`);

r = runScript("add-card-ruling.ts", "app-content-site", "--decision", "抽片段级单源渲染器", "--why", "两视图语义不同，合并=耦合", "--revert", "app-content-site|cmCrBuildDetailHtml", "--date", "2026-10-13", "--dry-run");
ok("合法调用 dry-run → 输出条目且零写入", r.status === 0 && /未写文件/.test(r.stdout || "") && /app-content-site\|cmCrBuildDetailHtml/.test(r.stdout || ""), `status=${r.status} out=${r.stdout?.slice(0, 120)}`);

finish("ADR 增量门槛契约全过");