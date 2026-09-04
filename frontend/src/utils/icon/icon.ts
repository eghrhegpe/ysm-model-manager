// ===== 文件名 → 图标（类型化版 — ADR-014 P2）=====

import { stripDisableSuffix } from "../dom/display.ts";
import { RESOURCE_EXTS } from "../resource/extensions.ts";
import { RESOURCE_TYPES, typeIconOf } from "../resource/types.ts";

function getExt(name: string): string {
  // P3 修复（子代理审计）：null/undefined 入参守卫——app-tree/render.ts:182,186 的
  // e.name 来自 Go 数据，异常时 null 会直接 .split 抛 TypeError
  // 2026-08-24：先剥禁用后缀（.disabled/.ban）——禁用态文件仍是原名命名的真类型
  // 文件，`xxx.zip.disabled` 若直接取末段得 `.disabled` 落 🧊 兜底；剥后缀后
  // `xxx.zip` → `zip` → 📦（对齐 Go scanner 的禁用后缀恢复 + display.ts 口径）
  return (
    stripDisableSuffix(name ?? "")
      .split(".")
      .pop() || ""
  ).toLowerCase();
}

/** 注册表扩展名 → 图标（由 RESOURCE_EXTS 遍历 + JSON icon 派生生成，单一事实来源） */
const REGISTRY_EXT_ICONS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [rt, exts] of Object.entries(RESOURCE_EXTS)) {
    const icon = typeIconOf(rt);
    for (const e of exts) {
      const key = e.replace(/^\./, "");
      // ysm 的 .zip/.json 是归档/清单容器（且 .zip 与资源包/光影包共享），
      // 语义归下方超集分支兜底，不由 ysm 特征图标 💎 覆盖
      if (rt === RESOURCE_TYPES.YSM && key !== RESOURCE_TYPES.YSM) continue;
      // ADR-067：.zip/.7z 是通用容器扩展名，可包裹任意类型（注册表 7 类共享），
      // 不参与注册表图标覆盖——否则遍历顺序决定图标（末位类型胜出），
      // 容器统一归下方超集分支 📦（与 ysm 跳过逻辑同构，防顺序敏感漂移）
      if (key === "zip" || key === "7z") continue;
      m[key] = icon;
    }
  }
  return m;
})();

/** 按扩展名返回图标 emoji */
export function fileIcon(name: string): string {
  const ext = getExt(name);
  // 注册表扩展名优先：ysm/pmx/pmd/vrca/vrm/litematic/nbt/schematic/zip 等
  // 由 RESOURCE_EXTS 遍历生成，注册表新增/改名扩展名自动生效
  const regIcon = REGISTRY_EXT_ICONS[ext];
  if (regIcon) return regIcon;
  // 超集分支保留为显式兜底：注册表外扩展名 + ysm 的归档(.zip/.7z)/清单(.json) 语义
  if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return "📦";
  if (ext === "vrcw") return "🥽";
  if (ext === "schem") return "⚙️";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
  if (["txt", "md", "json", "xml", "yml", "yaml", "cfg", "conf", "ini"].includes(ext)) return "📄";
  return "🧊";
}

/** 是否为 YSM 文件 */
export function isYsmName(name: string): boolean {
  return getExt(name) === RESOURCE_TYPES.YSM;
}
