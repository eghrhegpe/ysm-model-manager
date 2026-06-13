// ===== Go 数据加载层 =====
import { bus } from "../../bus.js";
import {
  ScanModelEntries,
  IsFileBanned,
  LoadAppConfig,
  GetRepoRoot,
} from "../../../wailsjs/go/main/App.js";
import { getExts } from "../../utils/extensions.js";

/** 从 Go 后端加载仓库文件列表，返回格式化的 entries */
export async function loadEntries(rtype) {
  try {
    const repoRoot = await GetRepoRoot(rtype || "");
    if (!repoRoot) return { repoRoot: "", entries: [] };

    const raw = await ScanModelEntries(repoRoot);
    if (!raw || !raw.length) return { repoRoot, entries: [] };

    // 按类型过滤扩展名（防止共享仓库中混入其他类型的文件）
    const exts = getExts(rtype);
    const filtered = exts.length
      ? raw.filter((e) => {
          let name = e.Name.toLowerCase();
          // 去掉 .ban 后缀再判断
          name = name.replace(/\.ban$/, "");
          return exts.some((ext) => name.endsWith(ext));
        })
      : raw;

    // 并发检查禁用状态
    const bannedResults = await Promise.all(
      filtered.map((e) => IsFileBanned(e.Path).catch(() => false)),
    );

    const entries = filtered.map((e, i) => {
      let relPath = e.Path;
      const normRoot = repoRoot ? repoRoot.replace(/\\/g, "/") : "";
      const normPath = e.Path.replace(/\\/g, "/");
      if (normRoot && normPath.startsWith(normRoot)) {
        relPath = normPath.slice(normRoot.length).replace(/^[/\\]+/, "");
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
