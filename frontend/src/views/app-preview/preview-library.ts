// ===== 3D 全屏内「跨类型换角色」（step 3）=====
// 落点：导航栏左下角 FAB + 3D 内模型切换（siblings 轻量路径）。
// 复用既有绑定（DetectResourceType）与既有 createXxx3D 全屏入口。
//
// 循环依赖红线（check-circular 阻断）：本模块是【叶子】——只被各 createXxx3D 静态 import
// （registerReRoute / withPreviewExtras），自身【不】反向 import 任何 createXxx3D 包装器。
// 跨类型跳转靠「注册表反向注入」：各包装器在模块加载时 registerReRoute(id, opener)，
// openModel3DFullscreen 只查表调用，从而打破「库→包装器→库」闭环。
//
// 资源库列表（loadAllModels）已移除：3D 内切换模型走 mount-preview-core 的
// opts.siblings（同目录兄弟，mount 时一次性过滤），点击即 switchTo 复用外壳重建，
// 全程轻量获取文件——不再全量扫描各仓库、不再按扩展名分类贴标签。

import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPE_LABELS, resolvePreviewKey, resolvePreviewKeyByExt, resolvePreviewKeyToRtype, getPreviewableTypeTabs } from "../../utils/resource/types.ts";
import type { Mount3DOptions } from "../../utils/3d/adapters/mount-preview-core.ts";
import { switchPreview, hasActivePreview, cleanupPreview } from "../../utils/3d/adapters/mount-preview-core.ts";

/** 跨类型换角色注册表：各 createXxx3D 模块加载时注册，路由侧不反向 import 包装器（破循环） */
const _openers: Record<string, (path: string, siblings?: string[]) => Promise<void>> = {};
/** 注册某资源类型的「打开全屏 3D」入口（由对应 createXxx3D 包装器在模块加载时调用；
 *  第二参透传 siblings，切换后新会话「当前目录」tab 有候选，P1-2） */
export function registerReRoute(
  rtype: string,
  opener: (path: string, siblings?: string[]) => Promise<void>,
): void {
  _openers[rtype] = opener;
}

/** 返回已注册的路由类型列表（供测试/CI 验证 _openers 覆盖率，审核 P3） */
export function getRegisteredRoutes(): string[] {
  return Object.keys(_openers);
}

/** openModel3DFullscreen 选项（ADR-093 T4：cooperate 统一多模型同台追加入口） */
export interface OpenModel3DOptions {
  /** 同类型候选路径列表（透传给 opener 的 siblings） */
  siblings?: string[];
  /**
   * 多模型同台追加：有活跃会话时改走 switchPreview({keepInScene}) 把新模型追加进
   * 同一场景，统一收口到注册表主门（消除 appendXxxPreview 绕过路由的接缝）。
   * 注意：当前 switchToSession 复用活跃会话的适配器，故 cooperate 追加与活跃会话
   * 同类型时语义最稳；跨类型（如 MMD 会话追加 VRM）需适配器按类型解析，见 ADR-093 T4-b。
   */
  cooperate?: boolean;
}

/**
 * 通用「打开一个模型 3D」路由：探测类型 → 查注册表派发 opener（跨类型换角色）。
 * 未注册类型直接 toast 提示（不回退 YSM opener——YSM opener 无法加载非 YSM 文件，
 * 回退只会产生「加载失败」误导，P2-4）。各 opener 内部（createXxx3D →
 * mount3D cooperate=false）会先清理旧的活跃全屏层。
 *
 * cooperate=true 且有活跃会话时：改走同台追加（keepInScene），不清理旧场景。
 */
export async function openModel3DFullscreen(path: string, options?: OpenModel3DOptions): Promise<void> {
  if (!path) return;
  const siblings = options?.siblings;
  // 方案 A：cooperate=false 且有活跃会话时，先清理旧的活跃全屏层（释放旧内容层 +
  // 复位注册表 + 复原单例），再建新模型——把本函数注释「cooperate=false 会先清理旧的
  // 活跃全屏层」从名义变实际；对 ysm/mmd/vrm/litematic 所有类型的「二次点击资源列表」
  // 统一生效，不影响 cooperate=true 的 keepInScene 追加语义，也不影响会话内 switchTo 切换。
  // 注意：清理须在 opener 解析成功之后执行（code review P2）——类型探测失败或
  // routeKey 未注册（非 3D 资源/后端暂不可用）时提前清理会销毁用户当前活跃 3D 会话，
  // 旧会话本应在此类失败导航下存活，只弹 toast。
  if (options?.cooperate && hasActivePreview()) {
    await switchPreview(path, { keepInScene: true });
    return;
  }
  const { DetectResourceType } = await getApp();
  let rtype = "";
  try {
    rtype = (await DetectResourceType(path)) || "";
  } catch {
    /* 类型探测失败 */
  }
  // ADR-111：按 variants 解析预览 key（.pmx→mmd、.vrm→vrm），无变体回退 rtype
  const routeKey = resolvePreviewKey(path, rtype);
  // 兜底（歧义扩展名）：DetectResourceType 对 .pmx 等多声明扩展名保守返回 "other"，
  // 而 variants 明确声明了预览适配器（如 .pmx→mmd）——按扩展名再查一次，避免
  // 跨类型浏览 PMX 时误报「3D 预览暂不支持该类型」（仅预览路由派生，不参与类型判定）
  const opener = _openers[routeKey] ?? (routeKey === "" || routeKey === "other" ? _openers[resolvePreviewKeyByExt(path)] : undefined);
  if (opener) {
    if (!options?.cooperate && hasActivePreview()) {
      cleanupPreview();
    }
    await opener(path, siblings);
    return;
  }
  const { bus } = await import("../../bus.ts");
  bus.emit("toast:show", { msg: "3D 预览暂不支持该类型", duration: TOAST_MS.normal, type: "warn" });
}

interface PreviewExtras extends Mount3DOptions {
  switchExternal?: (
    path: string,
    siblings?: string[],
    options?: { keepInScene?: boolean },
  ) => Promise<void>;
}

/** 按资源类型（+可选子类型）扫描候选模型路径（轻量：GetRepoRoot + ScanModelEntriesFiltered，
 * 复用文件树扫描缓存，不逐文件解析）。供 3D 内切换模型的类型 tab 点击时懒加载。
 * export 供测试断言「预览键反解后的真实 rtype」到达 Go 绑定（批次6 P3）。
 *
 * 扩展名过滤由后端 ScanModelEntriesFiltered 完成——按 rtype+subtype 的 extensions 白名单
 * 过滤，排除非模型文件（如 EntityPlayer 类型自动排除 .vmd/.vpd 动作文件）。
 * @param rtype 资源类型 id（如 "EntityPlayer"）
 * @param subtype 可选子类型 id（如 "EntityPlayer"），为空时用父类型扩展名
 */
export async function scanModelsByType(rtype: string, subtype = ""): Promise<string[]> {
  try {
    // 预览键反解为真实资源类型 ID（"mmd" → "EntityPlayer"），
    // 使 Go 侧 ScanModelEntriesFiltered 命中扩展名白名单过滤
    const realRtype = resolvePreviewKeyToRtype(rtype);
    const { GetRepoRoot, ScanModelEntriesFiltered } = await getApp();
    const root = await GetRepoRoot(realRtype);
    if (!root) return [];
    const label = RESOURCE_TYPE_LABELS[realRtype] || realRtype;
    const raw = (await ScanModelEntriesFiltered(root, realRtype, subtype, label)) as Array<{ Path?: string }>;
    return (raw || []).map((e) => e.Path).filter((p): p is string => !!p);
  } catch {
    return [];
  }
}

/** 给 mount3D opts 注入「跨类型换角色」入口 + 按类型懒加载数据源。各 createXxx3D 统一经此接入 */
export function withPreviewExtras<T extends Mount3DOptions>(opts: T): T & PreviewExtras {
  return Object.assign(opts as T & PreviewExtras, {
    // keepInScene → cooperate（openModel3DFullscreen 有活跃会话时走 switchPreview
    // 主门按类型路由同台追加，ADR-093 T4）：跨类型 ➕ 复用此入口，不再直接不给
    switchExternal: (p: string, s?: string[], options?: { keepInScene?: boolean }) =>
      openModel3DFullscreen(p, { siblings: s, cooperate: options?.keepInScene === true }),
    getModelsByType: scanModelsByType,
    // ADR-111 收口：类型 tab 统一从 resource_types.json 派生（getPreviewableTypeTabs），
    // 不再由 opener 注册副作用（Object.keys(_openers)）派生——后者混用 preview key 与
    // rtype ID，导致 tab 语义与 nav 下拉双源不一致。此处仅取 key 列表维持最小改动面。
    getTypeTabs: () => getPreviewableTypeTabs().map((t) => t.key),
  });
}

/** 打开空场景 3D 全屏预览（无需 path）——供无选中模型时 FAB 降级入口。
 *  注意：不在此 re-export（empty-3d import 本模块的 withPreviewExtras，re-export 会构成
 *  循环依赖，违反本模块叶子不变量——调用方（app-nav）直接 import ./empty-3d.ts）。 */

