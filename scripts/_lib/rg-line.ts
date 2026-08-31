/**
 * rg-line.ts — rg 输出行解析共享层（scripts/_lib）。
 *
 * 统一 check-redlines.mjs parseRgLine / comment-checker.mjs parseLine 的重复实现。
 * 解析 ripgrep 输出行 "文件:行号:内容"：
 *   1. Windows 盘符路径（C:/foo.js:12:...）→ 盘符与路径合并为文件部分
 *   2. 内容含冒号（如 URL、代码 `a: b`）→ 从右侧定位行号，内容完整保留
 *   3. 非标准行（无行号/少段）→ 降级返回 [原行, 0, '']
 *
 * 返回值：[file, line, content]。
 */

/**
 * @param line rg 输出行
 * @returns [文件, 行号, 内容]；解析失败返回 [原行, 0, '']
 */
export function parseRgLine(line: string): [string, number, string] {
  const parts = line.split(':');
  if (parts.length >= 3) {
    let filePart: string;
    let rest: string;
    // Windows 盘符：C:/... → parts[0]='C'（单字符字母），parts[1] 以 / 开头
    if (parts[0].length === 1 && /[a-zA-Z]/.test(parts[0]) && parts[1].startsWith('/')) {
      filePart = parts[0] + ':' + parts[1];
      rest = parts.slice(2).join(':');
    } else {
      filePart = parts[0];
      rest = parts.slice(1).join(':');
    }
    const restParts = rest.split(':');
    const first = restParts[0];
    if (/^\d+$/.test(first)) {
      return [filePart, parseInt(first, 10), restParts.slice(1).join(':').trim() || ''];
    }
  }
  return [line, 0, ''];
}
