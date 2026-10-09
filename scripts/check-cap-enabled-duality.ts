#!/usr/bin/env node
/**
 * @file check-cap-enabled-duality.ts — 检测 cap 私有 enabled 字段是否与 ENV_STATE_SCHEMA 对齐。
 *
 * 病灶：F-1 收口（fog/water/shadow/reflector/sky/environment 的 private enabled 收编进
 * ENV_STATE_SCHEMA 对应键）曾经历 4 轮人工逐 cap 扫描才收完——同一种「私有门不与 schema
 * 对齐」的病灶模式反复犯（见 `docs/knowledge/preview-env-state.md` 不变量段）。人工扫描
 * 有认知盲区：schema 键「无人消费」或「压根没声明」都只能靠逐键 grep 发现。
 *
 * 判定：扫 `frontend/src/preview-3d/caps/*-capability.ts` 找 `private enabled`（字段定义，
 * 非 getter 别名——getter 别名读 envState 属已收口形态），对每个持私有 enabled 字段的 cap
 * 检查 schema 是否声明了对应 `{capName}Enabled` 键；无对应键即违规。
 *
 * 用法：
 *   node scripts/check-cap-enabled-duality.ts          # 人类报告 + _summary，违规 exit 1
 *   node scripts/check-cap-enabled-duality.ts --json   # 纯 JSON（_summary 契约，gate/CI 消费）
 *
 * 设计意图：给「加新 cap 必须同步声明 schema 键」立一道机器闸——未来新增 AudioCapability
 * 之类若写 `private enabled = opts.enabled ?? true` 但不补 `audioEnabled` 进 schema，本脚本
 * 会在 doctor / pre-push-gate 中报告违规，取代「靠人记得 F-1 教训」的脆弱防线。
 *
 * 退出码：0 = 全通过；1 = 发现违规；2 = 脚本自身异常（目录缺失等）。
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
  console.error(`[check-cap-enabled-duality] 未知参数: ${args.unknown.join(", ")}`);
  process.exit(2);
}
const JSON_OUT = args.json === true;

/** 统一退出：JSON 模式只写 _summary JSON，非 JSON 模式先写人类报告再写 JSON。 */
function jsonExit(code: number, payload: Record<string, unknown>): never {
  if (JSON_OUT) {
    console.log(JSON.stringify(payload));
  } else {
    // 非 JSON 模式：payload 的说明已由人类段输出，JSON 写最后一行供门禁选读
    console.log(`_summary:${JSON.stringify(payload._summary ?? payload)}`);
  }
  process.exit(code);
}

/** 从 env-state-schema.ts 提取所有以 Enabled 结尾的 schema 键名（转小写比较用）。 */
function collectSchemaEnabledKeys(): Set<string> {
  const schemaPath = path.join(
    ROOT,
    "frontend",
    "src",
    "preview-3d",
    "state",
    "env-state-schema.ts",
  );
  const content = fs.readFileSync(schemaPath, "utf8");
  // 匹配形如 "skyEnabled:", "ppEnabled:", "lightEnabled:" 等 schema 键声明
  const re = /^\s+(\w+Enabled)\s*:/gm;
  const keys = new Set<string>();
  for (const match of content.matchAll(re)) {
    keys.add(match[1]!.toLowerCase());
  }
  return keys;
}

/** 扫描一个 cap 源码，返回：{ hasPrivateEnabledField, hasGetterAlias }。 */
function inspectCapFile(filePath: string): {
  hasPrivateEnabledField: boolean;
  hasGetterAlias: boolean;
} {
  const content = fs.readFileSync(filePath, "utf8");
  // 匹配 `private enabled: boolean;`（字段定义）
  const fieldRe = /^\s*(private\s+|public\s+)?enabled\s*:\s*boolean\s*;/m;
  // 匹配 `private get enabled(): boolean {`（getter 别名）
  const getterRe = /^\s*(private|public|)\s+get\s+enabled\s*\(\s*\)\s*:\s*boolean/m;
  return {
    hasPrivateEnabledField: fieldRe.test(content),
    hasGetterAlias: getterRe.test(content),
  };
}

/** 从文件名推断 cap 名（foobar-capability.ts → foobar） */
function capNameFromFile(fileName: string): string {
  return fileName.replace(/-capability\.ts$/i, "");
}

/** 检查 1 个 cap：若有私有 enabled 字段且 schema 无匹配键，报告。 */
function checkCap(fileName: string, filePath: string, schemaKeys: Set<string>): string | null {
  const { hasPrivateEnabledField, hasGetterAlias } = inspectCapFile(filePath);

  if (!hasPrivateEnabledField) {
    // 没有私有 enabled 字段 → 无问题
    return null;
  }

  // 有私有 enabled 字段：推断 schema 键名（驼峰式 capEnabled）
  const capName = capNameFromFile(fileName);
  const candidate = `${capName}Enabled`.toLowerCase();

  const matched = schemaKeys.has(candidate);

  const descriptor = hasGetterAlias
    ? "private enabled 字段 + getter 别名并存（getter 可能读 envState，字段仍有状态）"
    : "private enabled 字段";

  if (!matched) {
    return `${filePath}：存在 ${descriptor}，但 ENV_STATE_SCHEMA 中没有对应的 capEnabled 键（预期 "${capName}Enabled" 或其变体）。` +
      "\n  → 私有 enabled 不与 schema 对齐，可能造成首启无存档时界面开关显示 ON 而实际效果缺失。" +
      `\n  → 按 ADR-250 / F-1 收口范式，把 ${capName.toLowerCase()} 的 setEnabled/isEnabled 收敛为 envState.${capName}Enabled 别名` +
      "，删除私有字段。";
  }

  return null;
}

function main(): void {
  const schemaKeys = collectSchemaEnabledKeys();
  const capsDir = path.join(ROOT, "frontend", "src", "preview-3d", "caps");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(capsDir, { withFileTypes: true });
  } catch (e: unknown) {
    jsonExit(2, {
      _summary: { ok: false, error: `无法读取 cap 目录: ${(e as Error).message}` },
    });
  }

  // 只扫描 *-capability.ts（排除 sun-beams.ts 等非 cap 文件）
  const capFiles = entries
    .filter((d) => d.isFile() && /-capability\.ts$/i.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const violations: string[] = [];
  const cleanCaps: string[] = [];

  for (const entry of capFiles) {
    const filePath = path.join(capsDir, entry.name);
    const violation = checkCap(entry.name, filePath, schemaKeys);
    if (violation) {
      violations.push(violation);
    } else {
      cleanCaps.push(entry.name);
    }
  }

  // 人类可读报告
  if (!JSON_OUT) {
    console.log(`[check-cap-enabled-duality] ENV_STATE_SCHEMA *Enabled 键数：${schemaKeys.size}`);
    console.log(`[check-cap-enabled-duality] 扫描 cap 文件数：${capFiles.length}`);
    console.log();
    if (violations.length > 0) {
      console.log(`[FAIL] 发现 ${violations.length} 个 cap 私有 enabled 未与 schema 对齐：`);
      for (const v of violations) {
        console.log(v);
        console.log();
      }
    } else {
      console.log("[OK] 所有 cap 的 enabled 状态已与 ENV_STATE_SCHEMA 对齐。" +
        `（${cleanCaps.length} 个文件全部通过）`);
    }
  }

  const ok = violations.length === 0;
  jsonExit(ok ? 0 : 1, {
    _summary: {
      ok,
      errors: violations.length,
      schema_keys: schemaKeys.size,
      scanned: capFiles.length,
      clean: cleanCaps.length,
    },
    violations,
    clean: cleanCaps,
  });
}

const isDirect = process.argv[1] && resolve(process.argv[1] as string) === resolve(fileURLToPath(import.meta.url));
if (isDirect) main();
