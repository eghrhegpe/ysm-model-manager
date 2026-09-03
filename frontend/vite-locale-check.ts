// ===== #8 build-time hook：locales TS ↔ JSON key 一致性 =====
// 开发源（locales/*.ts，编译期类型）与运行时源（public/locales/*.json，fetch 消费）
// 双源不对称——改 TS 后未重生成 JSON → 运行时用户看到裸 key。
// 本插件在 build 阶段比对 key 集合，不一致即构建失败并提示重生成。
// vite.config.js（桌面）与 vite.web.config.ts（web）共用，避免双维护。
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "url";

const LOCALE_CHECK = fileURLToPath(new URL("../scripts/generate-locale-json.ts", import.meta.url));

export function checkLocalesSync() {
  let isBuild = false;
  return {
    name: "check-locales-sync",
    configResolved(config: { command: string }) {
      isBuild = config.command === "build";
    },
    buildStart() {
      if (!isBuild) return; // dev server 不阻断，只查 build
      try {
        execFileSync(process.execPath, [LOCALE_CHECK, "--check"], { stdio: "inherit" });
      } catch {
        throw new Error(
          "[i18n] locales/*.ts 与 public/locales/*.json key 不一致——请先运行 `node scripts/generate-locale-json.ts` 再构建",
        );
      }
    },
  };
}
