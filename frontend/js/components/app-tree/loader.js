// ===== Go 数据加载层 =====
import { bus } from "../../bus.js";
import {
  ScanModelEntries,
  IsFileBanned,
  LoadAppConfig,
} from "../../../wailsjs/go/main/App.js";

/** 从 Go 后端加载仓库文件列表，返回格式化的 entries */
export async function loadEntries() {
  try {
    const cfg = await LoadAppConfig();
    const repoRoot = cfg.repoRoot || cfg.RepoRoot || "";
    if (!repoRoot) return fallbackEntries();

    const raw = await ScanModelEntries(repoRoot);
    if (!raw || !raw.length) return fallbackEntries();

    const entries = [];
    for (const e of raw) {
      let banned = false;
      try {
        banned = await IsFileBanned(e.Path);
      } catch (_) {}

      let relPath = e.Path;
      if (repoRoot && e.Path.startsWith(repoRoot)) {
        relPath = e.Path.slice(repoRoot.length).replace(/^[/\\]+/, "");
      }

      entries.push({
        name: e.Name,
        path: relPath,
        fullPath: e.Path,
        size: e.Size,
        modTime: e.ModTime,
        banned,
      });
    }
    return { repoRoot, entries };
  } catch {
    return fallbackEntries();
  }
}

/** Go 不可用时的后备模拟数据 */
export function fallbackEntries() {
  const now = Date.now();
  return [
    {
      name: "steve_skin.ysm",
      path: "steve_skin.ysm",
      size: 1258291,
      modTime: now - 86400000,
      banned: false,
    },
    {
      name: "alex_deluxe.ysm",
      path: "alex/alex_deluxe.ysm",
      size: 2516582,
      modTime: now - 172800000,
      banned: false,
    },
    {
      name: "alex_head.ysm",
      path: "alex/alex_head.ysm",
      size: 524288,
      modTime: now - 172800000,
      banned: false,
    },
    {
      name: "dragon_armor.zip",
      path: "dragon/dragon_armor.zip",
      size: 3984588,
      modTime: now - 3600000,
      banned: false,
    },
    {
      name: "dragon_wings.ysm",
      path: "dragon/dragon_wings.ysm",
      size: 2202009,
      modTime: now - 7200000,
      banned: false,
    },
    {
      name: "neon_sword.ysm",
      path: "weapons/neon_sword.ysm",
      size: 1572864,
      modTime: now,
      banned: false,
    },
    {
      name: "magic_staff.zip",
      path: "weapons/magic_staff.zip",
      size: 4404019,
      modTime: now - 7200000,
      banned: false,
    },
    {
      name: "photon_body.ysm",
      path: "photon/photon_body.ysm",
      size: 2202009,
      modTime: now - 43200000,
      banned: false,
    },
    {
      name: "old_model.ysm",
      path: "_disabled/old_model.ysm",
      size: 943718,
      modTime: now - 604800000,
      banned: true,
    },
    {
      name: "custom_hat.ysm",
      path: "custom/custom_hat.ysm",
      size: 838860,
      modTime: now - 259200000,
      banned: false,
    },
    {
      name: "steve_2d.ysm",
      path: "custom/steve_2d.ysm",
      size: 314572,
      modTime: now - 500000,
      banned: false,
    },
  ];
}
