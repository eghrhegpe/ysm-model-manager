#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { finish, ok } from "./_lib.mts";
import { parseAdrHeader } from "../scripts/_lib/frontmatter.ts";
import { normalizeState } from "../scripts/_lib/adr-status-categories.ts";

// test_adr_status_format — ADR 状态行格式契约（2026-10-10 A1 前置补充，TDD 先行）。
// 背景：此前对 docs/adr 做批量规范化时盲改两次翻车（①指针行删除留空行裂列表；
// ②无 accepted 过滤把 ✅ 误加到 21 个决策态状态行）。本测试把目标态钉成三条不变量，
// 变换前跑红、变换后跑绿，防止此类批量操作再次脱轨：
//   1. 全库无 `**实施状态**：查知识卡` 指针行（10-06 审计 §11.4 点名的反模式实现，应清零）；
//   2. ✅ 前缀只允许出现在 normalizeState==="accepted" 的状态行（126 条已采纳补齐）；
//   3. 决策态（proposed/partial/deprecated/superseded）状态行禁止以 ✅ 开头（防污染）。
// 判定口径与 check-adr-health --suggest 同源（parseAdrHeader + normalizeState）。

const ROOT = process.cwd();
const ADR_DIR = path.join(ROOT, "docs", "adr");
const pointerRe = /^[>*-]\s*\*\*实施状态\*\*\s*[：:]\s*查知识卡/m;

let pointerLines = 0;
let acceptedMissingOk = 0;
let decisionStatePolluted = 0;
let checked = 0;

function walk(d: string): void {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) {
      const text = fs.readFileSync(p, "utf8");
      if (pointerRe.test(text)) pointerLines++;
      const h = parseAdrHeader(p);
      if (h && !h.error) {
        checked++;
        const { key } = normalizeState(h.status);
        const startsOk = h.status.trim().startsWith("✅");
        if (key === "accepted" && !startsOk) acceptedMissingOk++;
        if (key !== "accepted" && startsOk) decisionStatePolluted++;
      }
    }
  }
}
walk(ADR_DIR);

console.log("=== ADR 状态行格式契约（test_adr_status_format）===");
ok("指针行清零（无「实施状态：查知识卡」）", pointerLines === 0, `pointerLines=${pointerLines}`);
ok("accepted 状态行全部以 ✅ 开头", acceptedMissingOk === 0, `acceptedMissingOk=${acceptedMissingOk}`);
ok("决策态状态行未被 ✅ 污染", decisionStatePolluted === 0, `decisionStatePolluted=${decisionStatePolluted}`);
ok("遍历覆盖足够（可解析 ADR > 300）", checked > 300, `checked=${checked}`);
finish("ADR 状态行格式契约全过");
