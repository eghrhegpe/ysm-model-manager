// ===== web-fs FSA 授权本地仓库（ADR-040 职责切分延续，自 web-fs.ts §3 拆出）=====
// 网页版文件来源桥接，替代 Go 本地文件系统扫描：网页版无本地文件系统，
// 用 File System Access API 让用户手动授权本地目录，递归扫主文件写入 IndexedDB，
// 作为模型库「文件来源」（ADR-049 能力门控缺口补齐）。
// 复用 web-fs-import 的 importWebFiles（File → IDB 落库），不重复造 IDB 写入逻辑。

import { t } from "@/core/i18n/t.ts";
import { isImportableFile } from "@/utils/resource/importable.ts";
import { currentRepoType } from "@/utils/resource/repo-rtype.ts";
import { idbGet, idbSet } from "./idb.ts";
import { WebUnsupportedError } from "./web-common.ts";
import { importWebFiles } from "./web-fs-import.ts";

interface _FsaDirHandle {
  name: string;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

// ===== FSA 根目录句柄持久化（R2 数据互通，参照 MikuMikuAR ADR-180/183）=====
// 网页版重启后浏览器不会自动保留 FSA 授权，但 FileSystemDirectoryHandle 可
// 结构化克隆存入 IndexedDB（原生支持）——下次启动 queryPermission 恢复授权，
// 免用户重新选目录。设计要点：
//   - restoreFsaRootHandle：仅 queryPermission 恢复，绝不 requestPermission
//     （后者须用户手势，启动期无手势会被浏览器拦截）
//   - getFsaAuthState：权限三态判定（unsupported/none/granted/revoked），供 UI 引导
//   - reauthorizeFsaRoot：须在用户手势内调用（confirm 点击），主动 requestPermission
const FSA_ROOT_KEY = "fsaRootHandle";

/** FSA 授权状态（供 UI 启动引导，不触发权限弹窗） */
export type FsaAuthState = "unsupported" | "none" | "granted" | "revoked";

/** 持久化根目录句柄（用户手势内调用，showDirectoryPicker 后落库） */
async function saveFsaRootHandle(h: unknown): Promise<void> {
  try {
    await idbSet("config", FSA_ROOT_KEY, h);
  } catch {
    // 句柄结构化克隆失败（罕见）→ 仅本次调用用局部 handle，后续会话需重新授权
  }
}

/** 从 IndexedDB 恢复持久化句柄（仅 queryPermission，启动自愈；失败/null → 降级手动重选） */
async function restoreFsaRootHandle(): Promise<unknown> {
  const h = await idbGet<unknown>("config", FSA_ROOT_KEY);
  if (!h) return null;
  const permHandle = h as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof permHandle.queryPermission === "function") {
    try {
      if ((await permHandle.queryPermission({ mode: "readwrite" })) === "granted") {
        return h;
      }
    } catch {
      /* 句柄失效（权限撤销/隐私模式）→ 降级手动重选 */
    }
  }
  // 不支持 queryPermission 的旧实现：保守不自动恢复，避免静默失败
  return null;
}

/** 查询根目录授权状态（不触发权限弹窗） */
export async function getFsaAuthState(): Promise<FsaAuthState> {
  if (typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker !== "function") {
    return "unsupported";
  }
  const h = await idbGet<unknown>("config", FSA_ROOT_KEY);
  if (!h) return "none";
  const permHandle = h as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof permHandle.queryPermission === "function") {
    try {
      return (await permHandle.queryPermission({ mode: "readwrite" })) === "granted"
        ? "granted"
        : "revoked";
    } catch {
      return "revoked";
    }
  }
  return "revoked"; // 老实现不支持 queryPermission，保守视为需重选
}

/** 对持久化句柄重新请求授权（不重选目录）。须用户手势内调用，成功写入内存句柄返回 true */
export async function reauthorizeFsaRoot(): Promise<boolean> {
  const h = await idbGet<unknown>("config", FSA_ROOT_KEY);
  if (!h) return false;
  const permHandle = h as FileSystemDirectoryHandle & {
    requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof permHandle.requestPermission !== "function") return false;
  try {
    if ((await permHandle.requestPermission({ mode: "readwrite" })) === "granted") {
      return true;
    }
  } catch {
    /* 用户拒绝 / 句柄失效 */
  }
  return false;
}

/** 启动自愈：恢复持久化句柄并重扫入库（R2 数据互通，参照 MikuMikuAR ScanModelDir） */
export async function rescanFsaRoot(): Promise<{
  ok: boolean;
  imported: number;
  failed: number;
  dir: string;
}> {
  const h = await restoreFsaRootHandle();
  if (!h) return { ok: false, imported: 0, failed: 0, dir: "" };
  return scanFsaHandle(h);
}

/** 扫描 FSA 目录句柄 → importWebFiles 落库（selectLocalRepo / rescanFsaRoot 共用） */
async function scanFsaHandle(
  handle: unknown,
): Promise<{ ok: boolean; imported: number; failed: number; dir: string }> {
  const files: File[] = [];
  await _collectModelFiles(handle as _FsaDirHandle, files);
  // P2b 修复：过滤「顶层散落不可导入文件」（readme.txt / 任意 png / 非 ysm.json 的 json 等）。
  // FSA 授权目录语义 = 扫描模型库（对齐桌面 scanner walk 跳过非支持文件）——散落杂物静默忽略
  // 不计 failed；组内辅助文件（rel 含目录前缀，如 狐狸/main.json）保留，供 preview 读纹理/清单。
  // 与 dnd/shared.ts groupCollected 的散落单文件 isImportableFile 过滤口径一致。
  const filesRoot = files.filter((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    // 有目录前缀（组内文件）→ 保留（整组校验由 importWebFiles 分组完成）
    if (rel.includes("/")) return true;
    return isImportableFile(rel);
  });
  const { imported, failed } = await importWebFiles(filesRoot, currentRepoType());
  return { ok: true, imported, failed, dir: (handle as _FsaDirHandle).name };
}

/** FSA 递归安全上限：防恶意/异常目录结构导致栈溢出或内存 OOM */
const MAX_FSA_DEPTH = 32;
const MAX_FSA_FILES = 50_000;

/** 递归遍历目录句柄，收集全部文件的 File 句柄（携带相对路径，供 importWebFiles 按 stem 分组） */
async function _collectModelFiles(
  dir: _FsaDirHandle,
  out: File[],
  parentPath = "",
  depth = 0,
): Promise<void> {
  if (depth > MAX_FSA_DEPTH) {
    // 超深目录跳过（防御性截断，正常模型目录 ≤ 5 层）
    console.warn(`[web-fs-auth] 目录递归深度超过 ${MAX_FSA_DEPTH} 层，跳过: ${parentPath}`);
    return;
  }
  if (out.length > MAX_FSA_FILES) {
    // 总文件数超限，抛错中断（防内存 OOM）
    throw new Error(
      `[web-fs-auth] ${t("webFs.filesLimit", { limit: MAX_FSA_FILES, count: out.length })}`,
    );
  }
  for await (const entry of dir.values()) {
    const rel = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await _collectModelFiles(entry as unknown as _FsaDirHandle, out, rel, depth + 1);
    } else if (entry.kind === "file") {
      const f = await (entry as FileSystemFileHandle).getFile();
      Object.defineProperty(f, "webkitRelativePath", { value: rel, configurable: true });
      out.push(f);
      // code_review f9fdb7b9 #1/#11：超限检查只放递归入口会被「单平目录 60k 文件」
      // 绕过（入口检查时 out 尚小，全部 push 后无再查）——push 后立即复查，
      // 守卫对任意树形（平铺/兄弟目录累计）都生效
      if (out.length >= MAX_FSA_FILES) {
        throw new Error(
          `[web-fs-auth] ${t("webFs.filesLimit", { limit: MAX_FSA_FILES, count: out.length })}`,
        );
      }
    }
  }
}

/**
 * 网页版授权本地仓库目录：showDirectoryPicker → 递归扫主文件 → importWebFiles 落 IDB。
 * 必须在用户手势中调用（FSA 要求）。无 FSA 能力时抛明确错误。
 * 用户取消选择（AbortError）→ 静默返回 {ok:false,...}（「取消 = 无操作」，与桌面
 * 文件选择取消一致；friendlyError 不识别 AbortError，若抛错会显示英文原文错误）。
 * 返回 { ok, imported, failed, dir }，dir 为授权目录名（供 UI 展示状态）。
 */
export async function selectLocalRepo(): Promise<{
  ok: boolean;
  imported: number;
  failed: number;
  dir: string;
}> {
  if (typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker !== "function") {
    throw new WebUnsupportedError(t("webFs.fsaUnsupported"));
  }
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await (
      window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker();
  } catch (err) {
    // 用户取消选择框：浏览器抛 AbortError（DOMException name=AbortError）。静默返回
    // 「无操作」，不向 UI 抛错——取消不是失败，也不该显示 friendlyError 的英文原文
    const name = (err as { name?: unknown })?.name;
    if (name === "AbortError") {
      return { ok: false, imported: 0, failed: 0, dir: "" };
    }
    // 其他选择器失败（权限被拒/浏览器异常）→ 真实失败，向上抛（UI 显示友好错误）
    throw err;
  }
  // R2 持久化：句柄结构化克隆落库，下次启动无手势 queryPermission 自愈免重选
  await saveFsaRootHandle(handle);
  return scanFsaHandle(handle);
}
