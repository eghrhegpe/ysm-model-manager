// ===== ADR-146 别名表共享单源 =====
// vite.config.js（桌面）与 vite.web.config.ts（Pages）双端消费——此前 web 侧手抄副本，
// 漂移不可见（check-path-hygiene 只扫 vite.config.js），web 构建长期红后才被发现。
// 改别名只改本文件；tsconfig.json paths 的一致性校验仍由 check-path-hygiene 承担
// （其解析面已同步指向本文件）。

/** 手写源码顶层目录白名单（与 tsconfig.json paths 必须一致；D3 一致性校验兜底）。 */
export const ALIAS_DIRS = [
  "bindings",
  "preview-3d",
  "views",
  "utils",
  "backend",
  "core",
  "features",
  "workers",
  "services",
  "wasm",
  "test-utils",
  "web-spike",
  "locales",
  "parsers",
];

/** 手写源码根文件级别名（src 根上的文件，目录别名映射不了；与 tsconfig paths 一致）。 */
export const FILE_ALIASES = {
  bus: "bus.ts",
  "theme-core": "theme-core.ts",
  "app-modules": "app-modules.ts",
};
