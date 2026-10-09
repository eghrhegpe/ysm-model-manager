#!/usr/bin/env node
/**
 * @file check-env-schema-consumers.ts — ENV_STATE_SCHEMA 键消费审计（幽灵键守卫）。
 *
 * 病灶：shadowEnabled 幽灵键事故（2026-09-22 锐评 F-1 收口）——schema 早声明该键却
 * 全仓生产码零消费者，真开关藏在 cap 私有 `this.enabled` 里，落盘成无前缀 `enabled`
 * 幽灵键，「菜单开关读私有门、存档写私有门、schema 键恒默认值」三线各说各话。当时
 * 靠一次性人工扫描（148 键 × 562 文件）才发现——知识卡明言「机械扫描法可复用」却
 * 没有留下工具，下次新增键后忘接消费方就是静默假死（有值不生效、零报错）。
 *
 * 判定：读 ENV_STATE_SCHEMA 全部顶层键（缩进 2 空格 + `: {`），对每个键统计
 * `frontend/src` 生产文件（排除 .test.ts / .d.ts / locales）中出现的文件数——
 * 零出现即「幽灵键」违规。getStateValue/setStateValue/调度键等凡生产文件提及即算
 * 已消费，判据宽松（只抓「完全没人提」的死键），不误伤「仅在存档键轨/注释出现」。
 *
 * 用法：
 *   node scripts/check-env-schema-consumers.ts          # 人类报告 + _summary，幽灵键 exit 1
 *   node scripts/check-env-schema-consumers.ts --json   # 纯 JSON（_summary 契约，gate/CI 消费）
 *
 * 设计意图：给「schema 声明 ⇒ 必须有生产消费」立机器闸——新增环境参数（如未来
 * audioEnabled）若只写进 schema 没接 cap 回调/存档/菜单任一消费方，本脚本报告违规，
 * 防 shadowEnabled 幽灵键病复发；与 check-cap-enabled-duality（cap 私有 enabled 必须有
 * schema 键）互补，构成 schema 双向对齐。
 *
 * 退出码：0 = 全通过；1 = 发现幽灵键；2 = 脚本自身异常（目录缺失等）。
 * 依赖：node:fs / node:path / node:url / _lib/scan-files.ts / _lib/parse-args.ts（零外部依赖）。
 */
import fs from "node:fs";
import path, { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const args = parseArgs(process.argv.slice(2), { bools: ["json"] });
// 致命陷阱 #12：未知 flag 必须显式白名单拦截，绝不落入位置参数位
if (args.unknown.length > 0) {
  console.error(`[check-env-schema-consumers] 未知参数: ${args.unknown.join(", ")}`);
  process.exit(2);
}
const JSON_OUT = args.json === true;

/** 统一退出：JSON 模式只写 _summary JSON，非 JSON 模式先写人类报告再写 JSON。 */
function jsonExit(code: number, payload: Record<string, unknown>): never {
  if (JSON_OUT) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(`_summary:${JSON.stringify(payload._summary ?? payload)}`);
  }
  process.exit(code);
}

/** 从 env-state-schema.ts 提取全部顶层键名（缩进 2 空格 + `: {`）。 */
function collectSchemaKeys(): string[] {
  const schemaPath = path.join(
    ROOT,
    "frontend",
    "src",
    "preview-3d",
    "state",
    "env-state-schema.ts",
  );
  const content = fs.readFileSync(schemaPath, "utf8");
  const re = /^\s{2}(\w+)\s*:\s*\{/gm;
  const keys: string[] = [];
  for (const match of content.matchAll(re)) keys.push(match[1]!);
  return keys;
}

/** 收集 frontend/src 生产文件内容（排除测试 / 类型声明 / locales）。 */
function collectProductionContents(): { file: string; content: string }[] {
  const srcDir = path.join(ROOT, "frontend", "src");
  const out: { file: string; content: string }[] = [];
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.includes("locales")) stack.push(p);
      } else if (
        e.name.endsWith(".ts") &&
        !e.name.endsWith(".test.ts") &&
        !e.name.endsWith(".d.ts") &&
        !e.name.includes("locales")
      ) {
        out.push({ file: p, content: fs.readFileSync(p, "utf8") });
      }
    }
  }
  return out;
}

function main(): void {
  const keys = collectSchemaKeys();
  const contents = collectProductionContents();

  const ghosts: { key: string; hits: number }[] = [];
  for (const k of keys) {
    const hits = contents.filter((c) => c.content.includes(k)).length;
    if (hits === 0) ghosts.push({ key: k, hits });
  }
  ghosts.sort((a, b) => a.key.localeCompare(b.key));

  // 人类可读报告
  if (!JSON_OUT) {
    console.log(`[check-env-schema-consumers] ENV_STATE_SCHEMA 键总数：${keys.length}`);
    console.log(`[check-env-schema-consumers] 扫描生产文件数：${contents.length}`);
    console.log();
    if (ghosts.length > 0) {
      console.log(`[FAIL] 发现 ${ghosts.length} 个幽灵键（schema 声明但生产零消费）：`);
      for (const g of ghosts) {
        console.log(`  - ${g.key}：零文件引用`);
      }
      console.log();
      console.log("  → 幽灵键 = 静默假死（有状态不生效、零报错）。按 F-1 收口范式接消费方");
      console.log("    （cap 回调 / saveState / 菜单任一），或删键 + 清存档迁移。");
    } else {
      console.log("[OK] 全部 schema 键在生产文件均有消费，无幽灵键。");
    }
  }

  const ok = ghosts.length === 0;
  jsonExit(ok ? 0 : 1, {
    _summary: {
      ok,
      errors: ghosts.length,
      schema_keys: keys.length,
      scanned: contents.length,
    },
    ghosts: ghosts.map((g) => g.key),
  });
}

const isDirect = process.argv[1] && resolve(process.argv[1] as string) === resolve(fileURLToPath(import.meta.url));
if (isDirect) main();
