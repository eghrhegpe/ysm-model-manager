#!/usr/bin/env node
/**
 * @file check-scene-slot-writers.ts — scene.environment / scene.background 槽位写者白名单闸。
 *
 * 病灶：ADR-292 D1「scene.environment 写者唯一 = EnvironmentCapability」是知识卡标称的
 * **回归红线**，但此前**零机器闸**——红线只散在注释与行为测试里（防「既有路径改坏」），
 * 防不住「**新写者出现**」：任何新 cap / 新管线在别处写一句 `scene.environment = tex`，
 * 全部门禁照绿，「写者唯一」形同虚设（锐评 2026-10-11 P1-①）。
 *
 * 判定：扫描 `frontend/src` 全部 .ts（含测试）中的槽位赋值
 *   （`scene.environment =` / `scene.background =`，任意持有者前缀），
 *   排除注释行与 `===`/`==` 比较，
 * 按文件白名单放行，白名单外即违规：
 *   - env-ibl.ts        — D1 槽位唯一写者（环境/背景两槽 + 构造前快照还原）
 *   - sky-capability.ts  — sky IBL 自持兜底装载 + dispose 对称守卫（ADR-292 D3/D10）
 *   - shared-infra.ts   — 基础设施初始化 background = Color（cap 构造前，非能力写者）
 *   - screenshot.ts     — 截图期 background 保存/还原（离屏侧，不触 environment）
 *   - *.test.ts         — 测试夹具（槽位状态摆布/还原）
 * 新增合法写者 = 先经锐评/ADR 拍板扩白名单（白名单外直接阻断，无存量债）。
 *
 * 与 check-env-schema-consumers 互补：那个守「schema 键有消费」，本闸守「槽位有唯一属主」。
 * 设计意图：把「写者唯一」红线从散文 + 行为测试升格为机器锁——行为测试防「既有路径改坏」，
 * 本闸防「新写者出现」（新 cap / 新管线在别处写槽位即红；扩白名单须先拍板、WHITELIST 段留痕）。
 *
 * 用法：
 *   node scripts/check-scene-slot-writers.ts          # 人类报告 + _summary，违规 exit 1
 *   node scripts/check-scene-slot-writers.ts --json  # 纯 JSON（_summary 契约，gate/CI 消费）
 *
 * 退出码：0 无白名单外写者；1 发现违规；2 脚本自身异常。
 * 依赖：node:fs / node:path / node:url + _lib（parseArgs / scan-files），零外部依赖。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const args = parseArgs(process.argv.slice(2), { bools: ["json"] });
if (args.unknown.length > 0) {
  console.error(`[check-scene-slot-writers] 未知参数: ${args.unknown.join(", ")}`);
  process.exit(2);
}
const JSON_OUT = args.json === true;

/** 统一退出：JSON 模式只写 _summary JSON，非 JSON 模式先写人类报告再写 JSON。 */
function jsonExit(code: number, payload: Record<string, unknown>): never {
  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(code);
  }
  console.log(`_summary:${JSON.stringify(payload._summary ?? payload)}`);
  process.exit(code);
}

/** 白名单（basename 匹配；理由见文件头「判定」段——扩白名单须先经锐评/ADR 拍板）。 */
const WHITELIST: readonly string[] = [
  "env-ibl.ts",
  "sky-capability.ts",
  "shared-infra.ts",
  "screenshot.ts",
];

/** 槽位赋值模式（子串判定，确定性优先于正则前缀体操）：
 *  任意持有者的 `scene.environment =` / `scene.background =`（`this.` / `Host.` 前缀天然含于子串），
 *  紧随其后的 `=` 后不得再是 `=`（排除 `==`/`===` 比较）。注释行已预先剔除，防散文提及误报。 */
const SLOT_PATTERNS = [
  { label: "environment", needle: "scene.environment" },
  { label: "background", needle: "scene.background" },
] as const;

function findSlotWrites(line: string): { slot: string; text: string }[] {
  const hits: { slot: string; text: string }[] = [];
  for (const { label, needle } of SLOT_PATTERNS) {
    let i = line.indexOf(needle);
    while (i >= 0) {
      const end = i + needle.length;
      const eq = line.indexOf("=", end);
      // `=` 须紧跟（中间只允许空白）且其后非 `=`（排除 ==/=== 比较）
      if (eq !== -1 && /^[\s]*$/.test(line.slice(end, eq)) && line[eq + 1] !== "=") {
        hits.push({ slot: label, text: line.trim() });
      }
      i = line.indexOf(needle, end);
    }
  }
  return hits;
}

/** 收集 frontend/src 全部 .ts 文件（生产 + 测试）。 */
function collectTsFiles(): string[] {
  const srcDir = path.join(ROOT, "frontend", "src");
  const out: string[] = [];
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.name.endsWith(".ts")) {
        out.push(p);
      }
    }
  }
  return out;
}

function main(): void {
  const files = collectTsFiles();
  const violations: { file: string; line: number; text: string; slot: string }[] = [];

  for (const file of files) {
    const base = path.basename(file);
    if (base.endsWith(".test.ts") || WHITELIST.includes(base)) continue; // 白名单/测试夹具豁免
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, idx) => {
      const t = raw.trim();
      // 注释行剔除（槽位名字在散文/注释里被大量提及——正则红线同口径：只看真赋值）
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      for (const hit of findSlotWrites(raw)) {
        violations.push({
          file: path.relative(ROOT, file).split(path.sep).join("/"),
          line: idx + 1,
          text: hit.text,
          slot: hit.slot,
        });
      }
    });
  }

  if (!JSON_OUT) {
    console.log(`[check-scene-slot-writers] 扫描文件数：${files.length}`);
    if (violations.length > 0) {
      console.log(`[FAIL] ${violations.length} 处白名单外槽位写者：`);
      for (const v of violations) {
        console.log(`  - ${v.file}:${v.line}（${v.slot}） ${v.text}`);
      }
      console.log();
      console.log(
        "  → scene.environment/background 是**多 cap 共享全局槽位**（ADR-292 D1 写者唯一红线）。",
      );
      console.log("    新增写者须经锐评/ADR 拍板后扩本脚本白名单（WHITELIST 段注释即拍板记录）。");
    } else {
      console.log(
        "[OK] 槽位写者全部在白名单内（env-ibl / sky 自持兜底 / infra 初始化 / 截图保存 / 测试）。",
      );
    }
  }

  jsonExit(violations.length === 0 ? 0 : 1, {
    _summary: { ok: violations.length === 0, errors: violations.length, scanned: files.length },
    violations,
  });
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirect) main();
