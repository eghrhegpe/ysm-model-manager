#!/usr/bin/env node
/**
 * 语言包 TS → JSON 构建脚本（ADR-045）。
 * generate-locale-json.ts — 编译 locales TS 导出为运行时 JSON
 * 设计意图：以 frontend/src/core/i18n/locales/*.ts 为单一事实源，产出 frontend/public/locales/*.json 供运行时 fetch 消费。
 * 依赖：node:fs / node:path / node:url
 * 用法：
 *   node scripts/generate-locale-json.ts           # 生成（写 frontend/public/locales/*.json）
 *   node scripts/generate-locale-json.ts --check   # 只校验 TS↔JSON key 一致性（vite build 钩子调用，不一致 exit 1）
 * 退出码：
 *   0 成功 / 1 未捕获异常（非零退出）或 --check 发现不一致
 */
// ===== 语言包 TS → JSON 构建脚本（ADR-045）=====
// 从 frontend/src/core/i18n/locales/*.ts 编译提取导出对象，
// 写入 frontend/public/locales/*.json（运行时 fetch 消费）。
// --check 模式解决 #8 开发/运行双源不对称：改 TS 未重生成 → 构建即失败。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = join(ROOT, "frontend", "src", "core", "i18n", "locales");
const OUT_DIR = join(ROOT, "frontend", "public", "locales");

const CHECK = process.argv.includes("--check");

// esbuild 是 Vite 的依赖，从 frontend/node_modules 解析
// Windows 路径必须转 file:// URL 才能用于 import()
const esbuildPath = join(ROOT, "frontend", "node_modules", "esbuild", "lib", "main.js");
const esbuild = await import(pathToFileURL(esbuildPath).href);

const tsFiles = readdirSync(SRC_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

if (tsFiles.length === 0) {
  console.warn("[locale-gen] 未找到语言包 .ts 文件");
  process.exit(0);
}

/** 编译单个语言包 TS 为导出对象（写 JSON 与 --check 共用，防口径漂移） */
async function loadTsObject(file: string): Promise<Record<string, unknown>> {
  const srcPath = join(SRC_DIR, file);
  const result = await esbuild.build({
    entryPoints: [srcPath],
    bundle: true,
    format: "cjs",
    write: false,
    platform: "node",
  });
  const code = result.outputFiles[0].text;
  // 提取 module.exports — CJS 下对象导出为 module.exports = { ... }
  // 用 Function 构造器安全执行（不走 eval）
  const fn = new Function("module", "exports", code);
  const mod: { exports: Record<string, any> } = { exports: {} };
  fn(mod, mod.exports);
  // 取第一个导出的值（zh-CN.ts 导出 zhCN 对象）
  const exported = mod.exports;
  const obj =
    typeof exported.default === "object" && exported.default !== null
      ? exported.default
      : Object.values(exported).find((v) => typeof v === "object" && v !== null && !Array.isArray(v));
  if (!obj || typeof obj !== "object") {
    throw new Error(`${file}: 未找到有效的导出对象`);
  }
  return obj as Record<string, unknown>;
}

// ── --check 模式：TS 源 vs 磁盘 JSON 的 key 集合对账（#8）──
if (CHECK) {
  mkdirSync(OUT_DIR, { recursive: true });
  let failed = 0;
  for (const file of tsFiles) {
    const lang = basename(file, ".ts"); // zh-CN.ts → zh-CN
    const jsonPath = join(OUT_DIR, `${lang}.json`);
    try {
      const obj = await loadTsObject(file);
      if (!existsSync(jsonPath)) {
        console.error(`[locale-gen:check] ${lang}.json 缺失——先跑 generate-locale-json.ts 生成`);
        failed++;
        continue;
      }
      const tsKeys = Object.keys(obj);
      const jsonKeys = Object.keys(JSON.parse(readFileSync(jsonPath, "utf-8")));
      const missing = tsKeys.filter((k) => !jsonKeys.includes(k));
      const extra = jsonKeys.filter((k) => !tsKeys.includes(k));
      if (missing.length > 0 || extra.length > 0) {
        console.error(`[locale-gen:check] ${lang}: TS↔JSON 键不一致（缺 ${missing.length} / 多 ${extra.length}）`);
        if (missing.length > 0) console.error(`  缺失: ${missing.slice(0, 10).join(", ")}`);
        if (extra.length > 0) console.error(`  多余: ${extra.slice(0, 10).join(", ")}`);
        failed++;
      } else {
        console.log(`[locale-gen:check] ${lang}.json ✓（${tsKeys.length} keys 一致）`);
      }
    } catch (e) {
      console.error(`[locale-gen:check] ${file} 编译失败:`, (e as any).message);
      failed++;
    }
  }
  if (failed > 0) {
    console.error(`[locale-gen:check] ${failed}/${tsFiles.length} 个语言包 TS↔JSON 不一致（改 TS 后需重生成）`);
    process.exit(1);
  }
  console.log(`[locale-gen:check] 全部 ${tsFiles.length} 个语言包 TS↔JSON 一致`);
  process.exit(0);
}

// ── 生成模式：写 frontend/public/locales/*.json ──
mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const file of tsFiles) {
  const lang = basename(file, ".ts"); // zh-CN.ts → zh-CN
  try {
    const obj = await loadTsObject(file);
    const outPath = join(OUT_DIR, `${lang}.json`);
    writeFileSync(outPath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
    const keyCount = Object.keys(obj).length;
    console.log(`[locale-gen] ${lang}.json ← ${file} (${keyCount} keys)`);
  } catch (e) {
    console.error(`[locale-gen] ${file} 编译失败:`, (e as any).message);
    failed++;
  }
}

if (failed > 0) {
  // 批次4 P2：此前 catch 只打日志不置失败标记 → 有语言包失败仍恒 exit 0（吞错假绿），
  // CI/doctor 无法感知。失败即非零退出。
  console.error(`[locale-gen] ${failed}/${tsFiles.length} 个语言包失败`);
  process.exit(1);
}

console.log(`[locale-gen] 完成，共 ${tsFiles.length} 个语言包`);
