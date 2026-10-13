// ===== 树内拖拽移动（ADR-336）=====
// 拖源 = 文件行（.fl/.fl-list），目标 = 文件夹行（.fh/.fh-list，data-dir 树内拼接路径）
// 或树根容器（#tree 本体）。与 OS 文件拖入导入（import-dnd.ts）靠 dataTransfer.types
// 互斥分流：应用内拖源 = application/x-ysm-tree-move（TREE_MOVE_MIME），导入 = Files。
//
// 层次：
//   - 本文件纯函数（isTreeMoveDrag / parseTreeMovePayload / filterSelfReflection /
//     computeMovedEntry）零 DOM 依赖，node 可测（move-dnd.test.ts）
//   - bindTreeMoveDnD(container, deps)：DOM 交互编排——dragstart 在 #tree 上行委托
//     （行 dragstart 冒泡到容器），dragover/drop/dragend 在 document 层（复用
//     import-dnd 同款 WebView2 shadow drop 限制绕道：composedPath + parentNode 上溯）
//   - 执行链走 deps.executeMove（注入，app-tree 侧实现：batchAllSettled 批量
//     MoveModelFile + 乐观更新 + 代际守卫回滚）——本文件不 import AppTree，
//     防止 features → views 越层（依赖方向与 pack-dnd 的 deps 注入同款）

import { dbg } from "@/utils/debug/debug.ts";

/** 应用内拖源标记（dataTransfer.setData 的 MIME type；与 Files 导入互斥分流判据） */
export const TREE_MOVE_MIME = "application/x-ysm-tree-move";

/** 拖拽载荷：被移动文件的磁盘路径集 + 拖拽锚行路径 */
export interface TreeMovePayload {
  paths: string[];
  anchor: string;
}

/**
 * 双通道分流判据（ADR-336 §2.1）：types 精确匹配 TREE_MOVE_MIME。
 * ⚠️ 精确匹配非 startsWith——前缀相近的自定义 type（如 -v2）不得误入移动态。
 */
export function isTreeMoveDrag(types: readonly string[] | undefined | null): boolean {
  return Array.from(types ?? []).includes(TREE_MOVE_MIME);
}

/**
 * 解析拖拽载荷（getData(TREE_MOVE_MIME) 的串）。形状校验 fail-closed：
 * 非法 JSON / paths 非数组 / anchor 非串 / 空 paths 一律 null——
 * DOM 拖拽载荷可被页面上任何脚本伪造（dataTransfer.setData 无来源校验），不能裸信。
 */
export function parseTreeMovePayload(raw: string | null | undefined): TreeMovePayload | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<TreeMovePayload> | null;
    if (!obj || typeof obj !== "object") return null;
    if (!Array.isArray(obj.paths) || obj.paths.length === 0) return null;
    if (typeof obj.anchor !== "string") return null;
    if (!obj.paths.every((p) => typeof p === "string" && p)) return null;
    return { paths: obj.paths as string[], anchor: obj.anchor };
  } catch {
    return null;
  }
}

/** 路径分隔符归一（Windows 下发反斜杠 / 树内拼接正斜杠混用场景统一） */
function normSlashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * 自反过滤：条目已在目标目录 → 移动是 no-op，滤除（ADR-336 §2.4 步骤 2）。
 * 判定基准 = 绝对父目录（filesRoot + targetDir，与 Go MoveModelFile 的 dstDir 同构——
 * 拖到根 = dstDir 为 filesRoot 本身）；前缀判定带分隔符守卫：
 * `/repo/作者A` 不得误吞 `/repo/作者B`（前缀嵌套）。
 */
export function filterSelfReflection(
  paths: readonly string[],
  targetDir: string,
  filesRoot: string,
): string[] {
  // 拼出目标绝对目录（根目标 = filesRoot 本身）；路径分隔符归一后比较
  const dstAbs = normSlashes(targetDir)
    ? `${normSlashes(filesRoot)}/${normSlashes(targetDir)}`
    : normSlashes(filesRoot);
  return paths.filter((p) => {
    const np = normSlashes(p);
    const dir = np.slice(0, np.lastIndexOf("/")); // 去文件名留目录段
    return dir !== dstAbs;
  });
}

/**
 * 乐观更新的本地重算：path = targetDir + 原 name；fullPath = filesRoot + 新 path。
 * 纯函数不 mutate 入参（返回新 entry 对象）——与 events.ts 乐观开关「不直接 mutate
 * Go 端原始 entry」注释口径一致：本地预览态用返回值替换数组槽位，reload 取真值校正。
 */
export function computeMovedEntry<T extends { path: string; name?: string }>(
  e: T,
  targetDir: string,
  filesRoot: string,
): T & { path: string; fullPath: string } {
  // name 兜底链先归一再取 basename：Windows 下发形态 name 可能已带分隔符
  // （loader map 用 Go Name 原文，path 为反斜杠时 name.split("/").pop() 不剥段）
  const rawName = e.name || normSlashes(e.path);
  const normName = normSlashes(rawName).split("/").pop() || "";
  const newPath = normSlashes(targetDir) ? `${normSlashes(targetDir)}/${normName}` : normName;
  const fullBase = normSlashes(filesRoot);
  return {
    ...(e as object),
    path: newPath,
    fullPath: fullBase ? `${fullBase}/${newPath}` : newPath,
  } as T & { path: string; fullPath: string };
}

// ───────────────────────── DOM 编排层 ─────────────────────────

/** dragover 命中文件夹行的目标信息（data-dir = 树内拼接路径；空串 = 根容器目标） */
export interface MoveDropTarget {
  /** 树内拼接路径（folder 行 data-dir）；根目标 = "" */
  dir: string;
  /** 行元素（drop-target 高亮的挂点；根目标 = container 本体） */
  el: HTMLElement;
}

/** 命中文件夹行：closest 取 .fh/.fh-list，读 data-dir（树内拼接路径，dirOpen 键空间同源） */
export function resolveFolderTarget(target: EventTarget | null): MoveDropTarget | null {
  if (!(target instanceof HTMLElement)) return null;
  const fh = target.closest<HTMLElement>(".fh, .fh-list");
  if (!fh) return null;
  const dir = fh.dataset.dir;
  if (dir === undefined) return null;
  return { dir, el: fh };
}

/** deps 注入形状（app-tree 侧实现执行链；测试注入 spy） */
export interface TreeMoveDeps {
  /** 当前拖源路径集是否允许起拖（app-tree 侧判：锚行在选中集内 → 全集，否则单行） */
  getPayload: (anchorPath: string) => TreeMovePayload | null;
  /** 拖源视觉态（dragging 降透明，数据渲染通道消费）：dragstart 置位、dragend/drop 清 */
  setDragging: (paths: Set<string> | null) => void;
  /** 执行移动（返回移动前的 entries 引用供调用方乐观重算，或 null = 调用方自行 reload） */
  executeMove: (paths: string[], targetDir: string) => Promise<void>;
  /** 视觉态挂点：drop-target 类的加/摘（app-tree 传 #tree 容器 + 目标行管理闭包） */
  setDropTarget: (el: HTMLElement | null) => void;
}

/** container 是否命中（复用 import-dnd 同款 shadow 上溯；本文件自持防环依赖） */
function isInsideContainer(node: Node | EventTarget | null, container: HTMLElement): boolean {
  if (!node || !(node instanceof Node)) return false;
  let current: Node | null = node;
  while (current) {
    if (current === container) return true;
    if (current.parentNode) {
      current = current.parentNode;
      continue;
    }
    current = current instanceof ShadowRoot ? current.host : null;
  }
  return false;
}

/**
 * 取合成/真实拖拽事件的**内层** target。
 * ⚠️ composed 事件冒泡到 document 时 target 被 retarget 成 shadow host（标准行为）——
 * 2026-10-13 e2e 实证：document 层 dragover 的 target 恒为 APP-CONTENT，shadow 内的
 * 行元素信息全在 `composedPath()[0]`。import-dnd 的 isInTree 用 composedPath 判命中
 * 即同因。closest/类切换一律走本函数取内层元素，禁止裸用 e.target（retarget 后恒 host）。
 */
function innerTargetOf(e: DragEvent): EventTarget | null {
  return e.composedPath()[0] ?? e.target;
}

/**
 * 绑定树内拖拽移动（ADR-336）。由 <app-tree> connectedCallback 在 bindTreeDnD 之后调用，
 * 返回 cleanup。与导入链的互斥靠 types 判定（isTreeMoveDrag / Files），不共享状态。
 *
 * 事件布局：
 *   - dragstart 绑在 container（#tree）上**行委托**：e.target.closest(".fl,.fl-list")
 *     取 data-fullpath → deps.getPayload 决定单行/多选 → setData(MIME)
 *   - dragover/drop/dragend 绑 document（WebView2 shadow drop 限制，与 import-dnd 同款绕道）
 */
export function bindTreeMoveDnD(container: HTMLElement, deps: TreeMoveDeps): () => void {
  let currentTarget: HTMLElement | null = null;

  const clearDropTarget = (): void => {
    if (currentTarget) {
      currentTarget.classList.remove("drop-target");
      currentTarget = null;
    }
    deps.setDropTarget(null);
  };

  const onDragStart = (e: DragEvent): void => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    // 仅文件行可拖（文件夹行不可拖：牵连 dirLevelSync 层级与 SubDirMap 路由，ADR-336 §2.5）
    const row = target.closest<HTMLElement>(".fl, .fl-list");
    if (!row) return;
    const anchor = row.dataset.fullpath || row.dataset.path || "";
    if (!anchor) return;
    const payload = deps.getPayload(anchor);
    if (!payload) return; // 拖源被 app-tree 侧拒绝（如 busy / 无选中）→ 不起拖
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(TREE_MOVE_MIME, JSON.stringify(payload));
    // 拖源降透明（视觉三态之三）：数据渲染通道消费（_renderTree 带 draggingKeys），
    // dragend/drop 清——非 classList 直写，避免与重渲冲掉（pitfalls #28 同族）
    deps.setDragging(new Set(payload.paths));
    dbg("move-dnd", "dragstart", { anchor, count: payload.paths.length });
  };

  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer?.types?.includes(TREE_MOVE_MIME)) return;
    const inner = innerTargetOf(e);
    if (!isInsideContainer(inner, container)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const hit = resolveFolderTarget(inner);
    const el = hit ? hit.el : container; // 无文件夹命中 = 根容器目标
    if (currentTarget !== el) {
      clearDropTarget();
      el.classList.add("drop-target");
      currentTarget = el;
      deps.setDropTarget(el);
    }
  };

  const onDragLeave = (e: DragEvent): void => {
    if (!e.dataTransfer?.types?.includes(TREE_MOVE_MIME)) return;
    // relatedTarget 仍在 container 内 = 行间移动，目标保持；否则清
    // ⚠️ relatedTarget 无 retarget 问题（它本身就是引用），但 shadow 外可能为 host——
    // 统一走 composed 判定：relatedTarget 不在 composedPath 内且 innerTarget 无关即离开
    if (isInsideContainer(e.relatedTarget, container)) return;
    clearDropTarget();
  };

  const onDrop = (e: DragEvent): void => {
    // types 守卫前置（与 onDragOver 同序）：非移动拖源零开销早退，也不触碰
    // getData——测试桩/部分环境的 dataTransfer 未必实现完整 DataTransfer 接口
    if (!e.dataTransfer?.types?.includes(TREE_MOVE_MIME)) return;
    const payload = parseTreeMovePayload(e.dataTransfer.getData(TREE_MOVE_MIME) || null);
    const inner = innerTargetOf(e);
    const inside = isInsideContainer(inner, container);
    clearDropTarget(); // 无论落点是否有效都清视觉态（同 import-dnd onDrop 收口纪律）
    deps.setDragging(null); // 拖拽会话结束 → 拖源降透明同步摘除（收口单点纪律）
    if (!payload || !inside) return;
    const hit = resolveFolderTarget(inner);
    const targetDir = hit ? hit.dir : "";
    e.preventDefault();
    void deps.executeMove(payload.paths, targetDir).catch((err) => {
      console.error("[move-dnd] executeMove failed", err);
    });
  };

  const onDragEnd = (): void => {
    clearDropTarget();
    deps.setDragging(null); // dragend 兜底（drop 未触发的取消场景：拖出窗口/Esc）
  };

  container.addEventListener("dragstart", onDragStart);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  document.addEventListener("dragend", onDragEnd);
  dbg("move-dnd", "bound listeners");
  return () => {
    container.removeEventListener("dragstart", onDragStart);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
    document.removeEventListener("dragend", onDragEnd);
  };
}
