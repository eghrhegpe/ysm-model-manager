// ===== 模型文件名解析 + 美化显示管线 =====

/**
 * 解析模型文件名 → 结构化字段
 * 支持格式: [作者]【作品】角色变体2023-05.ysm
 */
export function parseModelName(raw) {
  const result = { author: "", work: "", chara: "", date: "" };
  // 去掉 .ban
  const name = raw.endsWith(".ban") ? raw.slice(0, -4) : raw;

  // 提取 [作者]
  const aMatch = name.match(/^\[([^\]]+?)\]/);
  if (aMatch) result.author = aMatch[1].trim();

  // 提取 【作品】
  const wMatch = name.match(/【([^】]+?)】/);
  if (wMatch) result.work = wMatch[1].trim();

  // 提取日期：YYYY、YYYY-MM、YYYY_MM 等
  const dMatch = name.match(/(\d{4})[-_.]?(\d{1,2})?/);
  if (dMatch) {
    result.date = dMatch[2]
      ? dMatch[1] + "-" + dMatch[2].padStart(2, "0")
      : dMatch[1];
  }

  // 角色名 = 去掉作者、作品、日期后的剩余部分
  let rest = name.replace(/\.\w+$/, ""); // 去扩展名
  if (aMatch) rest = rest.slice(aMatch[0].length);
  if (wMatch) {
    const wi = rest.indexOf(wMatch[0]);
    if (wi >= 0) rest = rest.slice(0, wi) + rest.slice(wi + wMatch[0].length);
  }
  rest = rest.replace(/\d{4}[-_.]?\d{0,2}/g, ""); // 去日期
  rest = rest.replace(/[-_]{2,}/g, "-").replace(/^[-_\s]+|[-_\s]+$/g, "");
  result.chara = rest || "";

  return result;
}

/**
 * 渲染美化文件名 HTML
 * @param {string} raw 原始文件名
 * @param {string} tpl 模板，支持 {author} {work} {chara} {date}
 */
export function renderDisplayName(raw, tpl = "{author}{work}{chara}") {
  const p = parseModelName(raw);
  // 无解析结果 → 兜底显示原文件名（去扩展名）
  if (!p.author && !p.work && !p.chara) {
    return esc(raw.replace(/\.\w+$/, ""));
  }

  let html = tpl
    .replace(
      "{author}",
      p.author ? `<span class="nm-tag">[${esc(p.author)}]</span>` : "",
    )
    .replace(
      "{work}",
      p.work ? `<span class="nm-bracket">【${esc(p.work)}】</span>` : "",
    )
    .replace("{chara}", esc(p.chara))
    .replace(
      "{date}",
      p.date ? `<span class="nm-date"> ${esc(p.date)}</span>` : "",
    );

  // 清理多余空格
  html = html.replace(/\s{2,}/g, " ").trim();
  return html || esc(raw.replace(/\.\w+$/, ""));
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
