#!/usr/bin/env node
/**
 * mock-path-resolve.ts — vi.mock 路径静态判定共享层（ADR-224）。
 *
 * 纯判定层：把一个 `vi.mock / vi.doMock / vi.unmock("<spec>")` 的说明符判定为
 * M1 / M2 / M3 / ok 之一。与 `alias-resolve.ts` 同构——可被 check-mock-paths.ts（CLI）
 * 与 tests/test_check_mock_paths.ts（契约/极端单测）直接 import，防「测试与脚本逻辑漂移」。
 *
 * 判定口径（对齐 ADR-224 §2 规则分级）：
 *   - 内部 spec（`@/` `#root/` `./` `../`）：
 *       · 别名经 tryResolveAlias 展开 / 相对 resolve(dirname(fromFile), spec)，
 *         再按 CANDIDATE_EXTS 补全 + index 补全。
 *       · 解析失败 → **M1**（唯一 fail-closed，正是 sync 那类病灶）。
 *       · spec 以 `.js` 结尾、.js 不存在但 .ts 存在（bindings app.js→app.ts 单类 14 处）
 *         → **M3**（INFO，合规写法，提示可写 .ts）。
 *       · 命中 → ok。
 *   - 裸包 spec（其余）：pkg 名 = `@scope/pkg` 取前两段 / 其余取首段。
 *       · `frontend/package.json` deps ∪ devDeps ∪ optionalDeps ∪ peerDeps 命中 → ok。
 *       · 命中不则 probe node_modules（frontend/node_modules + 根 node_modules）→ ok。
 *       · 三者皆无 → **M2**（默认 WARN / `--strict` 升 FAIL）。
 *
 * 设计要点（E1）：
 *   裸包以 deps 为主导、node_modules 是补充而非硬判据——实证 frontend/node_modules 仅
 *   10 个条目、three/@wailsio/runtime 子包未装。若以 node_modules fail-closed 会立即
 *   炸 ~20 条误报。故 deps 命中即放行，node_modules 只兜底「deps 未命中的本仓私有包」。
 *
 * 零依赖（仅 node:fs / node:path / node:url + alias-resolve）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tryResolveAlias } from "./alias-resolve.ts";
import { toPosix } from "./to-posix.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FRONTEND_DIR = path.join(REPO_ROOT, "frontend");
/** frontend/src 绝对路径（供契约测试构造 fromFile 语境复用）。 */
export const SRC_ROOT = path.join(FRONTEND_DIR, "src");

/** 无扩展名 spec 的补全候选扩展名顺序（align scan-files.IMPORT_EXTS，前端显式扩展名风格）。 */
const CANDIDATE_EXTS = ["ts", "tsx", "js", "jsx", "mts", "mjs"];

export type MockLevel = "ok" | "M1" | "M2" | "M3";
export type MockKind = "internal" | "bare";

/** classifyMock 的结构化输出，供 CLI 报告 + 契约测试断言复用。 */
export interface MockClassify {
  level: MockLevel;
  kind: MockKind;
  spec: string;
  /** 实际解析到的绝对路径（M3 = .ts 目标；裸包/M1 为 null）。 */
  resolvedAbs: string | null;
  /** M3 专属：.js spec → 解析到的 .ts 目标。 */
  m3?: { jsSpec: string; tsTarget: string };
  detail: string;
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

interface InternalResult {
  status: "ok" | "m3" | "missing" | "alias-unregistered";
  abs: string | null;
  tsTarget?: string;
}

/** 内部 spec 解析：别名/相对展开 + 扩展名补全 + .js→.ts 兜底。 */
function resolveInternal(spec: string, fromFileAbs: string): InternalResult {
  let abs: string;
  if (spec.startsWith("@/") || spec.startsWith("#root/")) {
    const a = tryResolveAlias(spec);
    if (!a) return { status: "alias-unregistered", abs: null };
    abs = a;
  } else {
    abs = path.resolve(path.dirname(fromFileAbs), spec);
  }
  const ext = path.extname(abs);
  if (ext) {
    if (exists(abs)) return { status: "ok", abs };
    if (ext === ".js") {
      const ts = abs.replace(/\.js$/, ".ts");
      if (exists(ts)) return { status: "m3", abs: abs, tsTarget: ts };
    }
    return { status: "missing", abs };
  }
  for (const e of CANDIDATE_EXTS) {
    const f = `${abs}.${e}`;
    if (exists(f)) return { status: "ok", abs: f };
    const idx = path.join(abs, `index.${e}`);
    if (exists(idx)) return { status: "ok", abs: idx };
  }
  return { status: "missing", abs };
}

/** 裸包 spec → 包名：`@scope/pkg/sub` → `@scope/pkg`；`pkg/sub` → `pkg`。 */
function packageName(spec: string): string {
  const segs = spec.split("/");
  return spec.startsWith("@") ? segs.slice(0, 2).join("/") : (segs[0] ?? spec);
}

let depsCache: Set<string> | null = null;
/** 一次性装载 frontend/package.json 的 deps 键集（fail-soft 空集）。 */
function loadDeps(): Set<string> {
  if (depsCache) return depsCache;
  const s = new Set<string>();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND_DIR, "package.json"), "utf-8"));
    for (const key of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const name of Object.keys(pkg[key] || {})) s.add(name);
    }
  } catch {
    /* package.json 缺失：deps 判据退化为仅 node_modules */
  }
  depsCache = s;
  return s;
}

/** node_modules 探针：frontend/node_modules 优先，根 node_modules 兜底（hoist 场景）。 */
function nodeModulesHit(pkg: string): boolean {
  const candidates = [
    path.join(FRONTEND_DIR, "node_modules", pkg),
    path.join(REPO_ROOT, "node_modules", pkg),
  ];
  return candidates.some(exists);
}

/** 裸包判定：deps 主导，node_modules 兜底。三者皆无 → missing。 */
function resolveBare(spec: string): {
  status: "ok" | "missing";
  pkg: string;
  hit: "deps" | "node_modules" | null;
} {
  const pkg = packageName(spec);
  if (loadDeps().has(pkg)) return { status: "ok", pkg, hit: "deps" };
  if (nodeModulesHit(pkg)) return { status: "ok", pkg, hit: "node_modules" };
  return { status: "missing", pkg, hit: null };
}

/** 判定一个 mock 说明符：M1/M2/M3/ok。fromFileAbs = 承载该 mock 的测试文件绝对路径。 */
export function classifyMock(spec: string, fromFileAbs: string): MockClassify {
  const isInternal =
    spec.startsWith("@/") ||
    spec.startsWith("#root/") ||
    spec.startsWith("./") ||
    spec.startsWith("../");
  if (isInternal) {
    const r = resolveInternal(spec, fromFileAbs);
    if (r.status === "ok") {
      return {
        level: "ok",
        kind: "internal",
        spec,
        resolvedAbs: r.abs,
        detail: `解析到 ${toPosix(path.relative(REPO_ROOT, r.abs as string))}`,
      };
    }
    if (r.status === "m3") {
      return {
        level: "M3",
        kind: "internal",
        spec,
        resolvedAbs: r.tsTarget as string,
        m3: { jsSpec: spec, tsTarget: r.tsTarget as string },
        detail: `spec 以 .js 结尾但实际解析到 .ts：${toPosix(path.relative(REPO_ROOT, r.tsTarget as string))}`,
      };
    }
    if (r.status === "alias-unregistered") {
      return {
        level: "M1",
        kind: "internal",
        spec,
        resolvedAbs: null,
        detail: `别名未登记（@/ 或 #root/ 未命中 tsconfig paths）`,
      };
    }
    return {
      level: "M1",
      kind: "internal",
      spec,
      resolvedAbs: null,
      detail: `目标文件不存在（含 index 补全）`,
    };
  }
  const r = resolveBare(spec);
  if (r.status === "ok") {
    return {
      level: "ok",
      kind: "bare",
      spec,
      resolvedAbs: null,
      detail: `裸包 ${r.pkg} 命中 ${r.hit === "deps" ? "package.json deps" : "node_modules"}`,
    };
  }
  return {
    level: "M2",
    kind: "bare",
    spec,
    resolvedAbs: null,
    detail: `裸包 ${r.pkg} 未在 package.json deps，且 node_modules 中不存在`,
  };
}
