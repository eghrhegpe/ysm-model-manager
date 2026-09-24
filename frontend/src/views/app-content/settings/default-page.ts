// ===== 设置页：启动默认页（ADR-040 拆分：记忆开关 + 固定页二态收编一处）=====
// 病根：原设计只有一个下拉框，把两种互斥意图塞进了同一串页面名里——
//   「跟随上次访问」（不写 ui-default-page，启动回退 nav_page）
//   「固定某页」    （写 ui-default-page，启动短路掉 nav_page）
// 后果：一旦选过任意页面名，ui-default-page 永久有值，nav_page（记忆）从此不可达，
// 且下拉框里没有任何选项能表达"取消固定、回到记忆"（死设置遗留 bug）。
// 现拆为「记忆开关（checkbox）+ 固定页下拉框」联动，两者各归其位：
//   勾选记忆 → 清除 ui-default-page（resolveInitialPage 落回 nav_page）
//   取消勾选 → 写回下拉框当前值（钉死该页）
// 读写统一走 safeGet/safeSet/safeRemove（隐私模式安全）。
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { sanitizePage } from "@/core/page-store.ts";
import { safeGet, safeRemove, safeSet } from "@/utils/base/primitives/storage.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";

// 魔法数值收敛：偏好变更成功 toast 展示时长（ms）
const TOAST_DURATION_MS = TOAST_MS.quick;

/** 固定页下拉框的兜底值：用户取消记忆勾选但下拉框无值时钉死仓库页（与 resolveInitialPage 兜底同源） */
const FALLBACK_PAGE = "repository";

/** 从 ui-default-page 判定"是否处于记忆模式"（键不存在 / 空串 / 空白 = 记忆） */
function isRememberMode(raw: string | null): boolean {
  return !raw?.trim();
}

/**
 * 初始化启动默认页：回填「记忆开关 + 固定页下拉框」二态 + 绑定联动。
 *
 * 回显口径：`safeGet("ui-default-page")` 的原始值判定记忆模式——
 * 旧写法 `|| "repository"` 会把空串当成"仓库页"显示，与真实启动行为不符（货不对板 bug）。
 */
export function initDefaultPagePrefs(root: ShadowRoot): void {
  const rememberInput = root.getElementById("set-remember-page") as HTMLInputElement | null;
  const sel = root.getElementById("set-default-page") as HTMLSelectElement | null;
  if (!rememberInput || !sel) return;

  /** 同步二态 UI：记忆勾选时禁用固定页下拉框（禁用态表达"此项暂不生效"，非隐藏） */
  const syncUi = (remember: boolean): void => {
    rememberInput.checked = remember;
    sel.disabled = remember;
  };

  // 回填：有配置值时把该页写回下拉框（仅判定模式不够——否则固定模式下下拉框停在首项，
  // 用户看到 A 而实际启动是 B，是比原 bug 更隐蔽的货不对板）
  const configured = safeGet("ui-default-page");
  const remember = isRememberMode(configured);
  // 回显也过 sanitizePage：legacy 值（如 ADR-301 改名前的 workshop）归位到现名（community），
  // 与 resolveInitialPage 完全同源——否则下拉框选项（navItems 派生）无 legacy 值 → 回显停空、货不对板。
  if (!remember && configured) sel.value = sanitizePage(configured);
  syncUi(remember);

  rememberInput.addEventListener("change", () => {
    const remember = rememberInput.checked;
    syncUi(remember);
    if (remember) safeRemove("ui-default-page");
    else safeSet("ui-default-page", sel.value || FALLBACK_PAGE);
    bus.emit("toast:show", {
      msg: t(remember ? "settings.ui.rememberPageOn" : "settings.ui.rememberPageOff"),
      duration: TOAST_DURATION_MS,
      type: "success",
    });
  });

  // 固定页下拉框变更：仅记忆模式下才写入偏好（记忆模式中该控件已 disabled，此处为防御）
  sel.addEventListener("change", () => {
    if (rememberInput.checked) return;
    safeSet("ui-default-page", sel.value || FALLBACK_PAGE);
    bus.emit("toast:show", {
      msg: t("settings.ui.defaultPageSaved"),
      duration: TOAST_DURATION_MS,
      type: "success",
    });
  });
}
