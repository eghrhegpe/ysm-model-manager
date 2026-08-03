/**
 * frontmatter.mjs — 知识卡 YAML frontmatter 解析共享库（零依赖）。
 *
 * 用法：
 *   import { parseFrontmatter, getScalar, getList, parseSourceFiles }
 *     from './_lib/frontmatter.mjs';
 */

/** 提取 frontmatter 块字符串（`---...---` 之间），无则 null。 */
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

/** 提取标量字段（`key: value`，去注释）。 */
export function getScalar(fm, key) {
  if (!fm) return undefined;
  const line = fm.match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  if (!line) return undefined;
  const v = line[1].trim();
  if (v === '' || v.startsWith('<')) return undefined;
  return v.replace(/\s*#.*/, '').trim();
}

/** 提取列表字段（块列表或行内数组），返回字符串数组。 */
export function getList(fm, key) {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + key + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1].replace(/\s*#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1].replace(/\s*#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

/**
 * 解析 source_files 字段。兼容行内数组 `[a, b]` 与块列表 `- a`。
 * 单遍扫描：行内数组匹配后直接返回，避免累加。
 */
export function parseSourceFiles(fm) {
  if (!fm) return [];
  const lines = fm.split(/\r?\n/);
  const out = [];
  let seen = false;
  for (const line of lines) {
    const head = line.match(/^source_files\s*:\s*(.*)$/);
    if (head) {
      seen = true;
      const inline = head[1].match(/\[([^\]]*)\]/);
      if (inline) {
        inline[1].split(',').forEach((s) => {
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
        const v = item[1].replace(/^['"]|['"]$/g, '').trim();
        if (v) out.push(v);
      }
    }
  }
  return out;
}
