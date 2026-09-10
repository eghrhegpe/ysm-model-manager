// ===== context-menu-shared.ts — 右键菜单共享原语（ADR-040 拆分 / ADR-185 迁入 features）=====
// 从 context-menu-handlers.ts 下沉的纯前端共享函数，供 handlers / file-handlers /
// dir-handlers 共用，破除循环依赖。通知原语（toast/toastError/toastEmptyRtype）
// 已下沉 utils/dom/toast.ts（跨层复用，ADR-185 下沉，ADR-189 D3 归位）。
// 依赖：bus / modalPrompt / getApp / RESOURCE_TYPES——均不引 handlers，本文件不在环内。

import { bus } from "@/bus";
import { t, tOf } from "@/core/i18n/t.ts";
import { modalPrompt } from "@/utils/dom/modal-prompt.ts";
import { toast, toastError } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { contextMenuGetApp } from "./context-menu-deps.ts";

/** 通知树组件和统计面板刷新 */
export function refreshUI(): void {
  bus.emit("tree:reload");
  bus.emit("stats:refresh");
}

/** Windows 保留设备名（大小写不敏感，带任意扩展名同样保留：CON.txt 亦非法） */
const WIN_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * 路径安全过滤（UX 预检，终审在 Go fsutil.ContainsIllegalNameChar——2026-09-06 同步扩展）：
 * 禁逃逸段（. / ..）与绝对路径；禁 Windows 非法字符 <>:*?"|；
 * 禁保留设备名与尾随点/空格（Windows 静默剥离 → 落点漂移）。
 * `/`、`\` 允许作为嵌套分隔符（dstDir 拼接逐段落盘），校验按段独立进行。
 */
export function isUnsafeFolderName(folder: string): boolean {
  const trimmed = folder.trim();
  if (!trimmed) return true;
  if (/^[/\\]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) return true;
  // 段校验吃原串不吃 trim()：dstDir 拼接用的是未 trim 的 folder，
  // 尾随空格若在此被 trim 掉就漏检（Windows 落盘静默剥离 → 落点漂移）
  return folder.split(/[/\\]/).some((seg) => {
    if (seg === "." || seg === "..") return true;
    // Windows 非法字符（/ \ 已作分隔符消费，不在此列）
    if (/[<>:*?"|]/.test(seg)) return true;
    // 尾随点/空格：Windows 落盘时静默剥离，用户看到的名字与实际落点不符
    if (/[. ]$/.test(seg)) return true;
    // 保留设备名：剥掉首个点后的扩展名再整体匹配（CON.txt 同样保留）
    const dot = seg.indexOf(".");
    return WIN_RESERVED_NAMES.has((dot === -1 ? seg : seg.slice(0, dot)).toUpperCase());
  });
}

/**
 * 解析「移动/复制到文件夹」的目标路径（batch.move / batch.copy / file.move / file.copy 共用）。
 * 用户取消或校验失败时返回 null（已 toast 告知）。
 * @param rtype 资源类型 ID（如 "ysm"/"EntityPlayer"），为空时回退 YSM。
 */
export async function resolveDstDir(
  opts: {
    title: string;
    icon: string;
    okText: string;
    emptyMsg: string;
  },
  rtype?: string,
): Promise<{ folder: string; dstDir: string } | null> {
  const folder = await modalPrompt({
    title: opts.title,
    icon: opts.icon,
    placeholder: t("ctx.dstPlaceholder"),
    okText: opts.okText,
  });
  if (!folder) return null;
  if (isUnsafeFolderName(folder)) {
    toast(t("ctx.unsafeFolderName"), TOAST_MS.normal, "error");
    return null;
  }
  const { GetRepoRoot } = await contextMenuGetApp();
  const filesRoot = await GetRepoRoot(rtype || RESOURCE_TYPES.YSM);
  if (!filesRoot) {
    toast(opts.emptyMsg, TOAST_MS.normal, "error");
    return null;
  }
  return { folder, dstDir: `${filesRoot}/${folder.replace(/\\/g, "/")}` };
}

/**
 * 单目标 move|copy 模板（2026-09-06 锐评 P2 #5 收敛）：file.move/file.copy/dir.move/dir.copy
 * 四胞胎共用 resolveDstDir → getApp → binding → toast → refreshUI → catch 同构段，
 * 与 batch 侧 runBatchFileOp + BATCH_TPL 同一屋檐。调用方只给差异项：路径、rtype、
 * 绑定名、弹窗标题与成功文案（i18n key，本函数内 t/tOf）。
 */
export async function runSingleOp(
  pathOf: string,
  rtype: string | undefined,
  binding: "MoveModelFile" | "CopyModelFile",
  mode: "move" | "copy",
  i18n: { dialogTitle: string; okMsg: string },
): Promise<void> {
  const isMove = mode === "move";
  try {
    const resolved = await resolveDstDir(
      {
        title: tOf(i18n.dialogTitle),
        icon: isMove ? "📂" : "📋",
        okText: t(isMove ? "ctx.moveDialogOk" : "ctx.copyDialogOk"),
        emptyMsg: t(isMove ? "ctx.emptyMoveRoot" : "ctx.emptyCopyRoot"),
      },
      rtype,
    );
    if (!resolved) return;
    const { folder, dstDir } = resolved;
    const app = await contextMenuGetApp();
    await app[binding](pathOf, dstDir);
    toast(tOf(i18n.okMsg, { folder }), TOAST_MS.normal);
    refreshUI();
  } catch (e) {
    toastError(e, t(isMove ? "ctx.moveFail" : "ctx.copyFail"));
  }
}
