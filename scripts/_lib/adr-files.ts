/**
 * adr-files.ts — ADR 分级语法与文件清单单一事实源（ADR-320 体系分级）。
 *
 * 目录三区（存量不迁移，增量分级）：
 *   docs/adr/              → legacy       存量主编号 ADR（分级前落位，只读演化）
 *   docs/adr/architecture/ → architecture 架构决策（主编号延续全局唯一，全量模板）
 *   docs/adr/decisions/    → decisions    执行决策日志（子编号挂靠主 ADR，轻量模板）
 *
 * 文件名语法：ADR-(\d{3})(?:-d(\d+))?-<slug>.md
 *   主编号 \d{3}：legacy / architecture 全局唯一；连续性检查只看主编号
 *   子编号 -dN  ：仅 decisions，挂靠主 ADR（如 ADR-319-d2 = ADR-319 的第 2 份执行拍板）
 * 标题语法：# ADR-NNN(-dN)?：标题（与 _lib/frontmatter.ts parseAdrHeader 同口径）
 * 登记表行：| ADR-NNN(-dN)? | 标题 | 状态 | 日期 |
 *
 * 消费方：adr-check / check-adr-health / check-doc-drift / gen-adr-supersede /
 *         gen-docs-index / gen-vitepress-sidebar / new-adr（7 处收口，禁各自复制正则）
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./scan-files.ts";

export const ADR_DIR = path.join(ROOT, "docs", "adr");
export const ARCHITECTURE_DIR = path.join(ADR_DIR, "architecture");
export const DECISIONS_DIR = path.join(ADR_DIR, "decisions");

export type AdrZone = "legacy" | "architecture" | "decisions";

/** 文件名 → { num, sub }；不合语法（含 index.md / README / .lock）返回 null。 */
export function parseAdrFilename(name: string): { num: number; sub: number | null } | null {
  const m = /^ADR-(\d{3})(?:-d(\d+))?-.+\.md$/.exec(name);
  if (!m) return null;
  return { num: parseInt(m[1]!, 10), sub: m[2] ? parseInt(m[2], 10) : null };
}

/** 编号二元组 → 全局唯一 ID（ADR-042 / ADR-319-d2）。 */
export function adrId(num: number, sub: number | null): string {
  return sub === null
    ? `ADR-${String(num).padStart(3, "0")}`
    : `ADR-${String(num).padStart(3, "0")}-d${sub}`;
}

/** 标题行正则：# ADR-NNN(-dN)?：标题（冒号口径与 adr-check 原校验一致）。 */
export const ADR_TITLE_RE = /^#\s+ADR-(\d{3})(?:-d(\d+))?\s*[：:]\s*(.+)$/m;

/** 登记表行首列 ID 正则（matchAll 消费）。 */
export const REG_ROW_ID_RE = /^\|\s*(ADR-\d{3}(?:-d\d+)?)\s*\|/gm;

/** 登记表行完整解析：| ID | 标题 | 状态 | 日期 |（check-adr-health 登记同步用）。 */
export const REG_ROW_FULL_RE = /^\|\s*(ADR-\d{3}(?:-d\d+)?)\s*\|\s*([^|]+)\|\s*([^|]+)\|/gm;

export interface AdrFileRef {
  /** 文件名（ADR-319-d2-xxx.md） */
  name: string;
  /** 相对 docs/adr/ 的 POSIX 路径（decisions/ADR-319-d2-xxx.md） */
  relPath: string;
  /** 绝对路径 */
  absPath: string;
  zone: AdrZone;
  num: number;
  sub: number | null;
  /** 全局唯一 ID */
  id: string;
}

const ZONE_DIRS: Array<{ zone: AdrZone; rel: string }> = [
  { zone: "legacy", rel: "" },
  { zone: "architecture", rel: "architecture" },
  { zone: "decisions", rel: "decisions" },
];

/**
 * 枚举三区全部 ADR 文件（文件名语法过滤，index/README/隐藏文件天然排除）。
 * 排序：主编号升序 → 子编号升序（null 视为最前）。目录不存在时返回空数组。
 */
export function listAdrFiles(adrDir: string = ADR_DIR): AdrFileRef[] {
  const out: AdrFileRef[] = [];
  for (const { zone, rel } of ZONE_DIRS) {
    const dir = rel ? path.join(adrDir, rel) : adrDir;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // 子目录未创建 = 该区为空（architecture/decisions 允许暂缺）
    }
    for (const name of names) {
      const parsed = parseAdrFilename(name);
      if (!parsed) continue;
      out.push({
        name,
        relPath: rel ? `${rel}/${name}` : name,
        absPath: path.join(dir, name),
        zone,
        num: parsed.num,
        sub: parsed.sub,
        id: adrId(parsed.num, parsed.sub),
      });
    }
  }
  return out.sort(
    (a, b) => a.num - b.num || (a.sub ?? -1) - (b.sub ?? -1) || a.name.localeCompare(b.name),
  );
}

/** 全体主编号最大值（新架构 ADR 占号依据——decisions 行不参与占号）。 */
export function maxMainNum(files: AdrFileRef[]): number {
  return files.reduce((m, f) => Math.max(m, f.num), 0);
}

/** 指定主 ADR 下一个可用子编号（挂靠主 ADR 无任何 decisions 时 = 1）。 */
export function nextSubForParent(files: AdrFileRef[], parent: number): number {
  return (
    files
      .filter((f) => f.zone === "decisions" && f.num === parent)
      .reduce((m, f) => Math.max(m, f.sub ?? 0), 0) + 1
  );
}

/** 主 ADR 是否存在于任一区（decisions 挂靠校验用）。 */
export function hasMainAdr(files: AdrFileRef[], parent: number): boolean {
  return files.some((f) => f.num === parent && f.sub === null);
}
