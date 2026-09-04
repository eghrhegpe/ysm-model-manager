// ===== Wails 绑定解析插件（共享模块）=====
// Wails v3 生成 .ts 绑定，但前端 import 时写 .js 后缀。
// 此插件在存在 .ts 文件时，将 .js 导入重定向到 .ts。
//
// 用法：
//   import { wailsBindingsResolve } from "./vite-wails-bindings-resolve.ts";
//   plugins: [wailsBindingsResolve]
//
// 维护点唯一：改动本文件即可同步桌面/网页两套构建配置。

import { existsSync } from "fs";
import { resolve } from "path";
import type { Plugin } from "vite";

export const wailsBindingsResolve: Plugin = {
  name: "wails-bindings-resolve",
  resolveId(source: string, importer: string | undefined) {
    if (!importer) return null;
    if (!source.includes("/bindings/") || !source.endsWith(".js")) return null;
    const tsSource = source.replace(/\.js$/, ".ts");
    const dir = resolve(importer, "..");
    const tsPath = resolve(dir, tsSource);
    if (existsSync(tsPath)) {
      return this.resolve(tsSource, importer, { skipSelf: true });
    }
    return null;
  },
};
