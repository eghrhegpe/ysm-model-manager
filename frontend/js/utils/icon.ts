// ===== 文件名 → 图标（类型化版 — ADR-014 P2）=====

function getExt(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

/** 按扩展名返回图标 emoji */
export function fileIcon(name: string): string {
  const ext = getExt(name);
  if (ext === "ysm") return "💎";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
  if (["pmx", "pmd"].includes(ext)) return "🎭";
  if (["vrca", "vrcw"].includes(ext)) return "🥽";
  if (["litematic"].includes(ext)) return "📐";
  if (["nbt", "schematic", "schem"].includes(ext)) return "⚙️";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
  if (
    ["txt", "md", "json", "xml", "yml", "yaml", "cfg", "conf", "ini"].includes(
      ext,
    )
  )
    return "📄";
  return "🧊";
}

/** 是否为 YSM 文件 */
export function isYsmName(name: string): boolean {
  return getExt(name) === "ysm";
}
