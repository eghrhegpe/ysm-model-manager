#!/usr/bin/env node
/**
 * 语言包 TS → JSON 构建脚本（ADR-045）。
 * generate-locale-json.mjs — 编译 locales TS 导出为运行时 JSON
 * 设计意图：以 frontend/src/core/i18n/locales/*.ts 为单一事实源，产出 frontend/public/locales/*.json 供运行时 fetch 消费。
 * 依赖：node:fs / node:path / node:url
 * 用法：
 *   node scripts/generate-locale-json.mjs
 * 退出码：
 *   0 成功 / 1 未捕获异常（非零退出）
 */
// ===== 语言包 TS → JSON 构建脚本（ADR-045）=====
// 用法：node scripts/generate-locale-json.mjs
// 从 frontend/src/core/i18n/locales/*.ts 编译提取导出对象，
// 写入 frontend/public/locales/*.json（运行时 fetch 消费）。

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = join(ROOT, "frontend", "src", "core", "i18n", "locales");
const OUT_DIR = join(ROOT, "frontend", "public", "locales");

// esbuild 是 Vite 的依赖，从 frontend/node_modules 解析
// Windows 路径必须转 file:// URL 才能用于 import()
const esbuildPath = join(ROOT, "frontend", "node_modules", "esbuild", "lib", "main.js");
const esbuild = await import(pathToFileURL(esbuildPath).href);

const tsFiles = readdirSync(SRC_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

if (tsFiles.length === 0) {
  console.warn("[locale-gen] 未找到语言包 .ts 文件");
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const file of tsFiles) {
  const lang = basename(file, ".ts"); // zh-CN.ts → zh-CN
  const srcPath = join(SRC_DIR, file);

  try {
    // 编译为 CJS（esbuild 内置支持）
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
    const mod = { exports: {} };
    fn(mod, mod.exports);

    // 取第一个导出的值（zh-CN.ts 导出 zhCN 对象）
    const exported = mod.exports;
    const obj =
      typeof exported.default === "object" && exported.default !== null
        ? exported.default
        : Object.values(exported).find((v) => typeof v === "object" && v !== null && !Array.isArray(v));

    if (!obj || typeof obj !== "object") {
      console.error(`[locale-gen] ${file}: 未找到有效的导出对象`);
      continue;
    }

    const outPath = join(OUT_DIR, `${lang}.json`);
    writeFileSync(outPath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
    const keyCount = Object.keys(obj).length;
    console.log(`[locale-gen] ${lang}.json ← ${file} (${keyCount} keys)`);
  } catch (e) {
    console.error(`[locale-gen] ${file} 编译失败:`, e.message);
  }
}

console.log(`[locale-gen] 完成，共 ${tsFiles.length} 个语言包`);
