// ===== 模型文件名解析 + 美化显示管线 =====

/**
 * 解析模型文件名 → 结构化字段
 * 支持格式: [作者]【作品】角色变体2023-05.ysm
 */
export function parseModelName(raw) {
  const name = raw.endsWith(".ban") ? raw.slice(0, -4) : raw;
  const extMatch = name.match(/\.(\w+)$/);
  const aMatch = name.match(/^\[([^\]]+?)\]/);
  const wMatch = name.match(/【([^】]+?)】/);
  const dMatch = name.match(/(\d{4})[-_.]?(\d{1,2})?/);

  const author = (aMatch ? aMatch[1] : "").trim();
  const work = (wMatch ? wMatch[1] : "").trim();
  const date = dMatch
    ? dMatch[2]
      ? dMatch[1] + "-" + dMatch[2].padStart(2, "0")
      : dMatch[1]
    : "";

  let rest = name.replace(/\.\w+$/, "");
  if (aMatch) rest = rest.slice(aMatch[0].length);
  if (wMatch) {
    const wi = rest.indexOf(wMatch[0]);
    if (wi >= 0) rest = rest.slice(0, wi) + rest.slice(wi + wMatch[0].length);
  }
  rest = rest.replace(/\d{4}[-_.]?\d{0,2}/g, "");
  const chara = rest
    .replace(/[-_]{2,}/g, " ")
    .replace(/^[-_\s]+|[-_\s]+$/g, "")
    .replace(/_/g, " ");

  return {
    raw,
    isBanned: raw.endsWith(".ban"),
    author,
    work,
    chara: chara || "",
    character: chara || "",
    date,
    ext: extMatch ? extMatch[1] : "",
  };
}

/**
 * 渲染美化文件名 HTML（通用接口）
 * 应用 CSS 变量: --meta-author, --meta-work, --meta-date
 * @param {string} raw 原始文件名
 * @param {object|string} opts 选项对象或模板字符串（兼容旧调用）
 */
export function renderDisplayName(raw, opts) {
  const p = parseModelName(raw);
  if (p.isBanned) return esc(p.raw);

  // 兼容旧调用: renderDisplayName(raw, "{author}{work}...")
  const tpl =
    (typeof opts === "string" ? opts : opts?.tpl) || "{author}{work}{chara}";
  let html = tpl
    .replace(
      "{author}",
      p.author ? `<span class="tag-author">[${esc(p.author)}]</span>` : "",
    )
    .replace(
      "{work}",
      p.work ? `<span class="tag-work">【${esc(p.work)}】</span>` : "",
    )
    .replace("{chara}", esc(p.chara))
    .replace("{character}", esc(p.character))
    .replace(
      "{date}",
      p.date ? `<span class="tag-date"> ${esc(p.date)}</span>` : "",
    );

  html = html.replace(/\s{2,}/g, " ").trim();
  if (!html) html = esc(raw.replace(/\.\w+$/, ""));
  return html;
}

/** renderModelName = renderDisplayName 别名，options.showExt 支持 */
export function renderModelName(raw, options = {}) {
  const p = parseModelName(raw);
  return (
    renderDisplayName(raw, options.tpl) +
    (options.showExt && p.ext
      ? `<span class="tag-ext">.${esc(p.ext)}</span>`
      : "")
  );
}

/** 搜索高亮版 */
export function renderModelNameWithHighlight(raw, keyword, options = {}) {
  let html = renderDisplayName(raw, options);
  if (keyword) {
    const re = new RegExp(
      `(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    html = html.replace(re, "<mark>$1</mark>");
  }
  return html;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
