// ===== sidebar 事件层 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { toastEmptyRtype } from "../../core/context-menu-shared.ts";
import { animateNumber } from "../../utils/animation/animate.ts";
import { currentRepoType } from "../../features/repo-rtype.ts";
import type { SidebarInstance } from "./data.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { getApp } from "../../backend/app.ts";

// 绑定每个卡片展开/折叠
// 返回清理函数，组件销毁时移除事件监听
// 注意：事件委托在 #sidebar-instance-list 上，outerHTML 替换子元素不破坏监听
//
// P2 修复（审核）：绑定状态从「模块级共享变量」收敛为「每 ShadowRoot 独立状态
// （WeakMap）」。原 _lastList/_clickHandler/_contextHandler/currentInstances 在多实例
// 并存时串扰：A 重绑会顺手移除 B 在用的监听、点击数据被 B 覆盖（幽灵状态）。WeakMap
// 生命周期随 root 走，组件卸载即随 GC 回收。
// 数据新鲜度保留：renderVersionCards 只清 innerHTML 不替换 #sidebar-instance-list 元素，每次 _reload 后
// bindCardEvents 走 list 复用早退复用旧闭包；若闭包直接捕获 instances 参数会拿到首次
// 调用的旧数组（点击/右键数据陈旧）。统一改读 state.instances（同一状态对象，每次调用
// 先刷新），早退分支的旧 handler 也能读到最新数据。
interface CardBindState {
  list: HTMLElement;
  click: ((e: MouseEvent) => void) | null;
  ctx: ((e: MouseEvent) => void) | null;
  instances: SidebarInstance[];
}
const bindStates = new WeakMap<ShadowRoot, CardBindState>();

/** 构建卡片点击处理器闭包（心跳式：高亮 + 涟漪 + 去重状态机 + 空 rtype 拦截）。
 * 引用 root（高亮/涟漪作用于完整列表与头部）与 st（读写最新实例与绑定态）。
 * P1/P2/P2-1 修复注释随闭包迁移，见原 bindCardEvents。 */
function bindCardClickHandler(
  root: ShadowRoot,
  st: CardBindState,
): (e: MouseEvent) => void {
  return (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button") || target.closest(".chk")) return;
    const card = target.closest(".instance-card") as HTMLElement | null;
    if (!card) return;
    const hdr = card.querySelector(".instance-card-header") as HTMLElement | null;
    if (!hdr) return;
    // 高亮当前选中的版本
    root
      .querySelectorAll(".instance-card-header")
      .forEach((h) => h.classList.remove("active", "ripple"));
    // 涟漪效果：记录点击坐标，触发涟漪动画
    const rect = hdr.getBoundingClientRect();
    hdr.style.setProperty("--ripple-x", ((e.clientX - rect.left) / rect.width * 100) + "%");
    hdr.style.setProperty("--ripple-y", ((e.clientY - rect.top) / rect.height * 100) + "%");
    hdr.classList.add("active", "ripple");
    setTimeout(() => hdr.classList.remove("ripple"), 500);
    // 发送选中事件
    const idx = parseInt(card.dataset.idx || "", 10);
    const pkg = st.instances[idx];
    if (pkg) {
      // P1 修复：与右键路径同构——空 rtype 拦截报错，不 emit。
      // 旧实现点击路径静默兜底成 YSM，MMD 实例 rtype 漏传时
      // 右侧同步面板 default-type 错成 YSM（handler-sync 同款病）。
      if (!pkg.rtype) {
        toastEmptyRtype();
        return;
      }
      bus.emit("package:selected", pkg);
      // P2-1 修复：点击路径同步更新去重状态机（emitKey 格式与 restoreSelectedCard 的
      // reload 分支一致）。点击卡片 → 触发 reload（stats:refresh 等）→ restoreSelectedCard
      // 读 localStorage 恢复选中并比对 emitKey；若此处不更新 _lastEmittedPkg，去重恒真失效，
      // reload 后再次 emit package:selected，app-content 反复重建 <app-sync-manager>
      // （丢用户状态/闪烁回归）。
      // 点击允许 fallback 到 YSM（预览/选择无害），与右键拒绝 fallback 形成对称设计
      _lastEmittedPkg =
        (st.instances[0]?.rtype || currentRepoType()) + ":" + pkg.name;
      safeSet("sb_selectedName_" + (pkg.rtype || currentRepoType()), pkg.name);
    }
  };
}

/** 构建卡片右键处理器闭包（ctx:show 菜单弹出，rtype/path 缺失拦截）。
 * 仅消费 st（最新实例数据）；root 保留作签名对称，右键路径不直接触 root。 */
function bindCardContextHandler(
  root: ShadowRoot,
  st: CardBindState,
): (e: MouseEvent) => void {
  return (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const card = target.closest(".instance-card") as HTMLElement | null;
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(card.dataset.idx || "", 10);
    const pkg = st.instances[idx];
    if (!pkg) return;
    const nameEl = card.querySelector(".name");
    const name = nameEl ? nameEl.textContent.replace(/^📦\s*/, "") : "";
    // P0 修复：rtype 必须明确指定，不能 fallback 到 YSM——
    // 否则 MMD/VRC 等右键操作会按 YSM 逻辑处理，打开错误目录。
    // 点击允许 fallback（预览无害），右键拒绝（操作危险）。
    const rtype = pkg.rtype || "";
    if (!rtype) {
      toastEmptyRtype();
      return;
    }
    const path = pkg.dir || "";
    if (!path) {
      bus.emit("toast:show", { msg: t("ctx.missingPath"), duration: TOAST_MS.normal, type: "error" });
      return;
    }
    bus.emit("ctx:show", {
      x: e.clientX,
      y: e.clientY,
      type: "instance",
      instanceName: name,
      path,
      rtype,
      // 扁平化架构下，透传全局资源类型选择（rtype），
      // 使「打开文件夹」精确到 {instanceDir}；subdir 保留兼容
      subdir: safeGet("repo_subdir") || "",
    });
  };
}

export function bindCardEvents(
  root: ShadowRoot,
  instances: SidebarInstance[],
): () => void {
  // 先清掉旧的右键容器（防止重复）
  root.querySelectorAll(".instance-card-context-menu").forEach((el) => el.remove());

  const list = root.getElementById("sidebar-instance-list");
  if (!list) return () => {};

  let state = bindStates.get(root);
  if (!state) {
    state = { list, click: null, ctx: null, instances };
    bindStates.set(root, state);
  }
  // 每次调用都先刷新实例数据（list 复用早退时旧闭包也能读到最新实例数据）
  state.instances = instances;
  const st = state;

  // 如果监听的 list 元素没变，用旧的 handler 引用避免重复绑定
  if (st.list === list && st.click && st.ctx) {
    restoreSelectedCard(root, instances);
    return () => {};
  }

  // 移除旧的监听（如果 list 被替换了）
  if (st.list !== list && st.click && st.ctx) {
    st.list.removeEventListener("click", st.click);
    st.list.removeEventListener("contextmenu", st.ctx);
  }
  // P2 修复（code_review）+ P2 复核修复：list 替换 = 同组件 reload（非新挂载），
  // 不再复位 _lastEmittedPkg——原实现每次 reload 都复位，restoreSelectedCard 的
  // emitKey 去重恒真失效，每次重发 package:selected，app-content 反复重建
  // <app-sync-manager>（状态丢失/闪烁回归）。真正卸载（disconnectedCallback）才复位，
  // 由 resetSelectedEmit() 显式调用。

  const clickHandler = bindCardClickHandler(root, st);
  const contextHandler = bindCardContextHandler(root, st);

  list.addEventListener("click", clickHandler);
  list.addEventListener("contextmenu", contextHandler);

  st.list = list;
  st.click = clickHandler;
  st.ctx = contextHandler;

  // 恢复上次选中的整合包
  restoreSelectedCard(root, instances);

  return () => {
    list.removeEventListener("click", clickHandler);
    list.removeEventListener("contextmenu", contextHandler);
    const cur = bindStates.get(root);
    if (cur && cur.list === list) bindStates.delete(root);
  };
}

/** 根据 localStorage 选中最匹配的整合包 */
let _lastEmittedPkg: string | null = null; // P2 修复：模块级去重——原每次 _reload 都重发 package:selected，app-content 反复重建右侧面板

/** 复位去重标记：组件真正卸载（disconnectedCallback）时调用——
 * 同组件 reload 不复位（去重跨 reload 生效），仅新挂载会话才需重置（P2 复核修复） */
export function resetSelectedEmit(): void {
  _lastEmittedPkg = null;
}

function restoreSelectedCard(
  root: ShadowRoot,
  instances: SidebarInstance[],
): void {
  try {
    const rtypeKey = instances[0]?.rtype || currentRepoType();
    const savedName = safeGet("sb_selectedName_" + rtypeKey);
    if (!savedName) return;
    const idx = instances.findIndex((i) => i.name === savedName);
    if (idx < 0) return;
    const card = root.querySelector(`.instance-card[data-idx="${idx}"]`);
    if (!card) return;
    // 用 requestAnimationFrame 确保 DOM 渲染完成后再标记高亮
    requestAnimationFrame(() => {
      const hdr = card.querySelector(".instance-card-header");
      if (!hdr) return;
      hdr.classList.add("active");
      // P2 修复：仅选中项实际变化时才 emit——原每次重载都重发，
      // app-content 每次收到都 innerHTML 重建 <app-sync-manager>（状态丢失/闪烁）
      const emitKey = rtypeKey + ":" + savedName;
      if (_lastEmittedPkg !== emitKey) {
        const pkg = instances[idx];
        // P3 修复：与点击路径同构——空 rtype 拦截报错，不 emit。
        // restore 恢复 localStorage 残留的漏 rtype 实例时，init-pages 的防御性
        // return 会静默丢面板，须与点击路径一致给用户 toast 反馈。
        if (!pkg?.rtype) {
          // P3 修复：设 emitKey 后再 return，让去重状态机抑制后续 reload 重复 toast
          _lastEmittedPkg = emitKey;
          toastEmptyRtype();
          return;
        }
        _lastEmittedPkg = emitKey;
        bus.emit("package:selected", pkg);
      }
    });
  } catch (e) { console.warn("[sidebar] restoreSelectedCard:", e); }
}

// 绑定底部按钮 + 路径显示
export function bindFooter(
  root: ShadowRoot,
  instances: SidebarInstance[],
): void {
  const btn = root.getElementById("btn-mc");
  if (btn) {
    // 点击跳转到设置页的游戏根目录配置（合并重复入口）
    btn.onclick = () => {
      bus.emit("nav:changed", { page: "settings" });
    };
    (async () => {
      try {
        const { LoadAppConfig, SaveAppConfig, GetMinecraftPaths } =
          await getApp();
        const cfg = await LoadAppConfig();
        if (cfg.mcRoot) {
          btn.textContent = `🎮 ${cfg.mcRoot}`;
        } else {
          // 没设置时自动检测：用第一个有效路径
          const paths = await GetMinecraftPaths();
          if (paths?.length) {
            btn.textContent = `🎮 ${paths[0]}`;
            const theme = safeGet("theme") || "dark";
            await SaveAppConfig(
              cfg.filesRoot || "",
              cfg.resourcepackRoot || "",
              paths[0],
              cfg.linkMode || "copy",
              theme,
            );
          } else {
            btn.textContent = "🎮 未设置";
          }
        }
      } catch (e) {
        btn.textContent = "🎮 未设置";
        console.warn("[sidebar] MC detection:", e);
      }
    })();
  }

  const statSync = root.getElementById("stat-sync");
  (async () => {
    if (!instances || !instances.length) return;
    const total = instances.length;
    const syncedCount = instances.filter(
      (ins) => (ins.missing || 0) + (ins.extra || 0) === 0,
    ).length;
    if (statSync) {
      // 修复（审核）：原三目两分支输出相同字符串（全同步时 syncedCount===total），
      // 死代码；label 统一走 i18n（与 footerHTML 初始文案一致，防硬编码漂移）
      statSync.textContent = `${t("sidebar.syncFully")} ${syncedCount}/${total}`;
      animateNumber(statSync, syncedCount);
    }
  })();
}
