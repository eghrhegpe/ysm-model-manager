// ===== Go 数据加载层 =====
import { bus } from "../../bus.js";
import {
  ScanModelEntries,
  IsFileBanned,
  LoadAppConfig,
  GetRepoRoot,
} from "../../../wailsjs/go/main/App.js";

/** 从 Go 后端加载仓库文件列表，返回格式化的 entries */
export async function loadEntries(rtype) {
  try {
    const repoRoot = await GetRepoRoot(rtype || "");
    if (!repoRoot) return { repoRoot: "", entries: [] };

    const raw = await ScanModelEntries(repoRoot);
    if (!raw || !raw.length) return { repoRoot, entries: [] };

    // 并发检查禁用状态
    const bannedResults = await Promise.all(
      raw.map((e) => IsFileBanned(e.Path).catch(() => false)),
    );

    const entries = raw.map((e, i) => {
      let relPath = e.Path;
      if (repoRoot && e.Path.startsWith(repoRoot)) {
        relPath = e.Path.slice(repoRoot.length).replace(/^[/\\]+/, "");
      }
      return {
        name: e.Name,
        path: relPath,
        fullPath: e.Path,
        size: e.Size,
        modTime: e.ModTime,
        banned: bannedResults[i] || false,
        type: "",
      };
    });
    return { repoRoot, entries };
  } catch {
    return { repoRoot: "", entries: [] };
  }
}
