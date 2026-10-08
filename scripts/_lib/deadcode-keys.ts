/**
 * _lib/deadcode-keys.ts — 死代码/重复代码基线键派生（单一事实源）。
 *
 * 背景（2026-10-08 技术债审计）：基线键由 check-deadcode-baseline 内联解析产生，
 * 两个洞：
 *   1. knip v5+ 的 `duplicates` 是**嵌套数组对** `[[{name:"a"},{name:"b"}]]`，
 *      旧解析按 `.name || ""` 取标量 → 基线存出 `file|duplicates|`（空名残渣）：
 *      不可读、不可归属、永远无法销账。修复 = 数组项展开为 `a#b` 符号对。
 *   2. jscpd 的 Windows 反斜杠路径曾只在主脚本一处 toPosix 归一——归一化散落两处，
 *      新增消费方极易漏。下沉至此，键形态唯一决定于本模块。
 *
 * 键约定（与 _lib/deadcode-attrib.ts 的 findingFiles 兼容，不得改分隔符）：
 *   knip  : `file|issueType|symbol`（整文件 = `file|file|path`；duplicates 对 = `file|duplicates|a#b`）
 *   jscpd : `fileA#fileB`（文件对粒度去行号：克隆位置漂移不产生新键）
 *
 * 纯函数、零 IO、零依赖（除 toPosix）。用法见 check-deadcode-baseline.ts。
 */
import { toPosix } from "./to-posix.ts";

/** knip 未使用项类型全集（v3/v4/v5 兼容超集；主脚本与测试共用）。 */
export const KNIP_TYPES = [
  "exports",
  "types",
  "enumMembers",
  "unlisted",
  "dependencies",
  "devDependencies",
  "binaries",
  "namespaceMembers",
  "duplicates",
  "catalog",
  "catalogReferences",
  "optionalPeerDependencies",
  "unresolved",
];

/** 单个未使用项 → 符号名字符串。
 * 三种真实形态：标量字符串（`"wails3"`）/ 带 name 的对象（`{name:"foo",line}`）/
 * duplicates 的数组对（`[{name:"a"},{name:"b"}]` → `a#b`，2026-10-08 修复）。 */
function itemName(item: unknown): string {
  if (typeof item === "string") return item;
  if (Array.isArray(item)) {
    return item
      .map((x) => (typeof x === "string" ? x : ((x as { name?: string })?.name ?? "")))
      .filter(Boolean)
      .join("#");
  }
  return (item as { name?: string } | null | undefined)?.name ?? "";
}

/**
 * knip `--reporter json` 的 issues 数组 → 基线键列表。
 * 兼容 v5（issues: [{file, exports: [...], files: [...], ...}]）与 v3/v4
 * （files: {path: [issue...]}）两种格式；无法识别的形态跳过（不猜测、不抛错）。
 */
export function knipIssueKeys(issues: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(issues)) {
    for (const it of issues as Array<Record<string, unknown>>) {
      const file = (it.file as string) || "?";
      for (const type of KNIP_TYPES) {
        for (const item of (it[type] as unknown[]) || []) {
          out.push(`${file}|${type}|${itemName(item)}`);
        }
      }
      for (const f of (it.files as unknown[]) || []) {
        out.push(`${file}|file|${itemName(f)}`);
      }
    }
    return out;
  }
  if (issues && typeof issues === "object") {
    // v3/v4：files: { "path": [issues...] }
    for (const [file, list] of Object.entries(issues as Record<string, unknown[]>)) {
      for (const it of list) {
        const type =
          typeof it === "string" ? it : ((it as { issueType?: string })?.issueType ?? "");
        out.push(`${file}|${type}|${typeof it === "string" ? "" : itemName(it)}`);
      }
    }
  }
  return out;
}

/**
 * jscpd 报告 duplicates → 基线键列表（文件对级，反斜杠归一化）。
 * 缺失字段兜底 "?"（与历史内联实现同口径，不新增失败模式）。
 */
export function jscpdCloneKeys(duplicates: unknown): string[] {
  if (!Array.isArray(duplicates)) return [];
  return duplicates.map((c) => {
    const g = (x: unknown) => toPosix((x as { name?: string })?.name || "?");
    const d = c as { firstFile?: unknown; secondFile?: unknown };
    return `${g(d.firstFile)}#${g(d.secondFile)}`;
  });
}
