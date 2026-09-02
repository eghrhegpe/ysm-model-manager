/**
 * frontmatter.ts — 知识卡/ADR 首部解析共享库（零依赖）。
 *
 * 用法：
 *   import { parseFrontmatter, getScalar, getList, parseSourceFiles, parseAdrHeader }
 *     from './_lib/frontmatter.ts';
 *
 * 注：原为知识卡专用（ADR-013 期），ADR-114 扩容后增加 `parseAdrHeader`
 * 供 gen-docs-index / check-adr-health / gen-adr-supersede / check-doc-drift
 * 共用单一入口（ADR-114 §被补充 元治理）。
 */
import fs from 'node:fs';

/** 提取 frontmatter 块字符串（`---...---` 之间），无则 null。 */
export function parseFrontmatter(text: string): string | null {
  // BOM 容错：UTF-8 BOM（\uFEFF）在文件开头时，^--- 不匹配（BOM 在 ^ 和 --- 之间）
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1]! : null;
}

/** 提取标量字段（`key: value`，去注释）。 */
export function getScalar(fm: string | null, key: string): string | undefined {
  if (!fm) return undefined;
  const line = fm.match(new RegExp('^' + escapeRe(key) + '\\s*:\\s*(.+)$', 'm'));
  if (!line) return undefined;
  const v = line[1]!.trim();
  if (v === '' || v.startsWith('<')) return undefined;
  // 仅当 # 前有空白才按行内注释剥离（code_review P2）：`name: C# 指南` 的 # 属合法值
  // 不得截断，`name: Foo  # 说明` 的 # 前有空白才是注释
  return v.replace(/\s+#.*$/, '').trim();
}

/**
 * 解析 frontmatter 块内全部标量字段（key → value）。
 * 区别于 getScalar：不要求已知 key 名，遍历所有 `k: v` 行（用于占位符等
 * 整体值域检查，check-knowledge-drift 的模板占位符扫描）。
 */
export function getAllScalars(fm: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (m) map[m[1]!] = m[2]!.trim();
  }
  return map;
}

/** 提取列表字段（块列表或行内数组），返回字符串数组。 */
export function getList(fm: string | null, key: string): string[] {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + escapeRe(key) + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1]!.replace(/\s*#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1]!.replace(/\s*#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

/** 正则转义 key（key 含 `.`/`-` 等特殊字符时防匹配错乱）。 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析 source_files 字段。兼容行内数组 `[a, b]` 与块列表 `- a`。
 * 单遍扫描：行内数组匹配后直接返回，避免累加。
 */
export function parseSourceFiles(fm: string | null): string[] {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out: string[] = [];
  let seen = false;
  for (const line of lines) {
    const head = line.match(/^source_files\s*:\s*(.*)$/);
    if (head) {
      seen = true;
      const inline = head[1]!.match(/\[([^\]]*)\]/);
      if (inline) {
        inline[1]!.split(',').forEach((s) => {
          const v = s.trim().replace(/^['"]|['"]$/g, '');
          if (v) out.push(v);
        });
        return out;
      }
      continue;
    }
    if (seen && /^\S/.test(line)) break;
    if (seen) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        const v = item[1]!.replace(/^['"]|['"]$/g, '').trim();
        if (v) out.push(v);
      }
    }
  }
  return out;
}

/**
 * 解析 ADR 文件首部，返回 { num, title, status, date, statusLine }。
 * `statusLine` 为状态行的 0-based 行号，gen-adr-supersede 据此界定正文扫描起点。
 * 支持 list / blockquote / table 三种首部格式，兼容中文冒号（：）与无冒号标题。
 * 与 gen-docs-index / check-adr-health / check-doc-drift / gen-adr-supersede
 * 共用单一入口，杜绝多脚本各写一套解析口径的漂移（ADR-114 §被补充 元治理）。
 *
 * @param {string} filePath — ADR 文件绝对路径
 * @returns {{num:number,title:string,status:string,date:string,statusLine:number,supersededBy:number|null,supersedes:string} | {error:string}}
 */
export function parseAdrHeader(filePath: string): { num: number; title: string; status: string; date: string; statusLine: number; supersededBy: number | null; supersedes: string } | { error: string } {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);

  let num: number | null = null;
  let title = '';
  let status = '';
  let date = '';
  let statusLine = -1;
  let supersededBy: number | null = null;
  let supersedes = '';

  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const line = lines[i]!;

    // 标题：# ADR-NNN：Title 或 # ADR-NNN: Title 或 # ADR-NNN Title
    const mTitle = line.match(/^#\s+ADR-(\d{3})\s*[：:]\s*(.+)/)
      || line.match(/^#\s+ADR-(\d{3})\s+(.+)/);
    if (mTitle && num === null) {
      num = parseInt(mTitle[1]!, 10);
      title = mTitle[2]!.trim();
      continue;
    }

    // **状态** 三种格式：blockquote / list / table
    const mStatus = line.match(/^>\s*\*\*状态\*\*\s*[：:]\s*(.+)/)
      || line.match(/^[-*]\s*\*\*状态\*\*\s*[：:]\s*(.+)/)
      || line.match(/^\|\s*\*\*状态\*\*\s*\|\s*(.+?)\s*\|\s*$/);
    if (mStatus) {
      status = mStatus[1]!.trim();
      statusLine = i;
      continue;
    }

    // **日期**
    const mDate = line.match(/^[-*]\s*\*\*日期\*\*\s*[：:]\s*(.+)/)
      || line.match(/^\|\s*\*\*日期\*\*\s*\|\s*(.+?)\s*\|\s*$/);
    if (mDate) {
      date = mDate[1]!.trim();
      continue;
    }

    // **被取代**：[ADR-NNN] 取代（new-adr.ts --supersedes 写入的独立标注行）
    const mSupBy = line.match(/^[-*]\s*\*\*被取代\*\*\s*[：:]\s*\[?ADR-(\d+)\]?/);
    if (mSupBy && supersededBy === null) {
      supersededBy = parseInt(mSupBy[1]!, 10);
      continue;
    }

    // **被补充**：[ADR-NNN]（后续 ADR 对本 ADR 的补充/扩展）
    const mSup = line.match(/^[-*]\s*\*\*被补充\*\*\s*[：:]\s*(.+)/);
    if (mSup && !supersedes) {
      supersedes = mSup[1]!.trim();
      continue;
    }

    if (line.startsWith('---') && status) break;
  }

  if (num === null) return { error: '未找到 ADR 编号' };
  if (!status) return { error: '未找到可解析的状态字段' };
  if (!title) return { error: '未找到 ADR 标题' };

  return { num, title, status, date, statusLine, supersededBy, supersedes };
}
