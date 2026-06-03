// ===== 文件名 → 图标 =====
export function fileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "ysm") return "💎";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
  if (
    ["txt", "md", "json", "xml", "yml", "yaml", "cfg", "conf", "ini"].includes(
      ext,
    )
  )
    return "📄";
  return "🧊";
}
