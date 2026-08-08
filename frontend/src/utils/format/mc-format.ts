// ===== Minecraft 分节符颜色渲染（类型化版 — ADR-014 P2）=====
import { esc } from "../dom/html.ts";

const MC_COLORS: Record<string, string> = {
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
interface FormatTag {
  open: string;
  close: string;
}

const FORMAT_TAGS: Record<string, FormatTag> = {
  l: { open: "<b>", close: "</b>" },
  o: { open: "<i>", close: "</i>" },
  n: { open: '<u style="text-decoration:underline">', close: "</u>" },
  m: { open: '<span style="text-decoration:line-through">', close: "</span>" },
};

/**
 * 将含 Minecraft § 分节符的文本渲染为带颜色的 HTML。
 * 颜色码（§0-§f）会重置此前所有格式并开启新颜色；
 * 格式码（§l/§o/§n/§m）叠加在当前颜色之上；
 * §r 重置所有格式。
 * §k（乱码）直接忽略，不渲染。
 * @param text 原始文本
 * @returns HTML 字符串
 */
export function renderFormattedText(text: string): string {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => {
      // 空行返回 ""：join("<br>") 会为每个分隔补 <br>，空行夹在中间自然形成空行。
      // 注意不能返回 "<br>" —— 会与 join 的 <br> 叠加导致空行翻倍（回归测试锁定）
      if (!line) return "";
      const parts = line.split("§");
      if (parts.length === 1) return esc(parts[0]);

      let html = esc(parts[0]);
      let currentColor: string | null = null;
      const openFormats: FormatTag[] = [];

      const closeColor = (): void => {
        if (currentColor) {
          html += "</span>";
          currentColor = null;
        }
      };
      const closeFormats = (): void => {
        while (openFormats.length) html += openFormats.pop()!.close;
      };

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        // P3 修复：行尾孤立 §（"abc§" 的尾 part 为空）必须原样保留——
        // 原 `if (!part) continue` 直接丢弃，与「无效码与孤立 § 原样保留」契约不符。
        // 注意：连续 "§§code" 中间的空 part 仍跳过（走第二条码，测试锁定行为）。
        if (!part) {
          if (i === parts.length - 1) html += "§";
          continue;
        }

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
        } else if (code === "k") {
          // §k 乱码码：按注释约定直接忽略，仅输出正文
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
