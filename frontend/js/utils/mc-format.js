// ===== Minecraft 分节符颜色渲染 =====

const MC_COLORS = {
  "0": "#000000",
  "1": "#0000AA",
  "2": "#00AA00",
  "3": "#00AAAA",
  "4": "#AA0000",
  "5": "#AA00AA",
  "6": "#FFAA00",
  "7": "#AAAAAA",
  "8": "#555555",
  "9": "#5555FF",
  a: "#55FF55",
  b: "#55FFFF",
  c: "#FF5555",
  d: "#FF55FF",
  e: "#FFFF55",
  f: "#FFFFFF",
};

// 格式码：§l 粗体 §o 斜体 §n 下划线 §m 删除线
const FORMAT_TAGS = {
  l: { open: "<b>", close: "</b>" },
  o: { open: "<i>", close: "</i>" },
  n: { open: '<u style="text-decoration:underline">', close: "</u>" },
  m: { open: '<span style="text-decoration:line-through">', close: "</span>" },
};

function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 将含 Minecraft § 分节符的文本渲染为带颜色的 HTML。
 * 颜色码（§0-§f）会重置此前所有格式并开启新颜色；
 * 格式码（§l/§o/§n/§m）叠加在当前颜色之上；
 * §r 重置所有格式。
 * §k（乱码）直接忽略，不渲染。
 * @param {string} text 原始文本
 * @returns {string} HTML 字符串
 */
export function renderFormattedText(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .split("\n")
    .map((line) => {
      if (!line) return "";
      const parts = line.split("§");
      if (parts.length === 1) return esc(parts[0]);

      let html = esc(parts[0]);
      let currentColor = null;
      const openFormats = [];

      const closeColor = () => {
        if (currentColor) {
          html += "</span>";
          currentColor = null;
        }
      };
      const closeFormats = () => {
        while (openFormats.length) html += openFormats.pop().close;
      };

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;

        const code = part[0].toLowerCase();
        const body = part.slice(1);

        if (MC_COLORS[code]) {
          closeFormats();
          closeColor();
          currentColor = code;
          html += `<span style="color:${MC_COLORS[code]}">${esc(body)}`;
        } else if (FORMAT_TAGS[code]) {
          const tag = FORMAT_TAGS[code];
          openFormats.push(tag);
          html += tag.open + esc(body);
        } else if (code === "r") {
          closeFormats();
          closeColor();
          html += esc(body);
        } else {
          // 无效码或连续 §，原样保留
          html += esc("§" + part);
        }
      }

      closeFormats();
      closeColor();
      return html;
    })
    .join("<br>");
}

export default renderFormattedText;
