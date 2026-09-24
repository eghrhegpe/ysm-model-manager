// ===== 设置页：3D 预览操作（ADR-040 拆分自 init.ts）=====
// 持久化于 localStorage，与 model3d.ts 同源。
// _activeCapture 随本段迁移（原 init.ts 模块级）：单一捕获守卫——同一时刻仅允许
// 一个键位捕获，且设置页卸载后自动失效，杜绝全局 keydown 劫持。
import { bus } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { TD_KEYMAP_REGISTRY, type TdKeyAction } from "@/preview-3d/infra/keymap.ts";
import { TD_CAM_SPEED, TD_KEYMAP_KEY, TD_ROT_MODE } from "@/preview-3d/infra/settings-schema.ts";
import { loadTdKeymap } from "@/preview-3d/mesh/model3d.ts";
import { safeGet, safeRemove, safeSet } from "@/utils/base/primitives/storage.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";

// 单一捕获守卫：同一时刻仅允许一个键位捕获，且设置页卸载后自动失效，杜绝全局 keydown 劫持
let _activeCapture: ((e: KeyboardEvent) => void) | null = null;
// 追踪注册监听时的 root，用于 onKey 回调中自检与 cleanupKeymap 复位
let _activeRoot: ShadowRoot | null = null;

/** 移除 document keydown 捕获监听并复位模块状态（供 settings 页卸载/组件销毁时调用） */
export function cleanupKeymap(): void {
  if (_activeCapture) {
    document.removeEventListener("keydown", _activeCapture, true);
    _activeCapture = null;
    _activeRoot = null;
  }
}

// 键位提示 toast 时长（ms）。
// 相机速度默认值不在此——已归 `preview-3d/infra/settings-schema.ts` 的 TD_CAM_SPEED（ADR-303）。
const TOAST_SUCCESS_MS = TOAST_MS.quick;
const TOAST_WARN_MS = TOAST_MS.info;

const TD_ACTION_LABEL_KEYS = {
  forward: "settings.keymap.actionForward",
  back: "settings.keymap.actionBack",
  left: "settings.keymap.actionLeft",
  right: "settings.keymap.actionRight",
  up: "settings.keymap.actionUp",
  down: "settings.keymap.actionDown",
} satisfies Record<TdKeyAction, LocaleKey>;

const tdKeyLabel = (code: string): string => {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  const map: Record<string, string> = {
    Space: t("settings.keymap.keySpace"),
    ShiftLeft: "Shift",
    ShiftRight: t("settings.keymap.keyShiftRight"),
    ControlLeft: "Ctrl",
    ControlRight: t("settings.keymap.keyControlRight"),
    AltLeft: "Alt",
    AltRight: t("settings.keymap.keyAltRight"),
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "⌫",
  };
  return map[code] || code;
};

/** aria-keyshortcuts 使用标准键名；显示文本仍由 tdKeyLabel 负责本地化。 */
const tdKeyShortcut = (code: string): string => {
  if (!code) return "";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Numpad${code.slice(6)}`;
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Control";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  return code;
};

const setKeyButtonState = (
  button: HTMLButtonElement,
  actionLabel: string,
  code: string,
  capturing = false,
): void => {
  const keyLabel = tdKeyLabel(code);
  const shortcut = tdKeyShortcut(code);
  button.textContent = capturing ? t("settings.keymap.pressKey") : keyLabel;
  button.setAttribute("aria-describedby", "td-keymap-hint");
  if (capturing) {
    button.setAttribute("aria-label", t("settings.keymap.captureAria", { label: actionLabel }));
    button.removeAttribute("aria-keyshortcuts");
    return;
  }
  button.setAttribute(
    "aria-label",
    t("settings.keymap.bindingAria", { label: actionLabel, key: shortcut || keyLabel }),
  );
  if (shortcut) button.setAttribute("aria-keyshortcuts", shortcut);
  else button.removeAttribute("aria-keyshortcuts");
};

const tdSaveKeymap = (km: Record<TdKeyAction, string>): void => {
  safeSet(TD_KEYMAP_KEY, JSON.stringify(km));
};

function tdRenderKeymap(root: ShadowRoot): void {
  // 重建网格前取消任何进行中的捕获，避免叠加/残留
  cleanupKeymap();
  _activeRoot = root;
  const grid = root.getElementById("td-keymap-grid");
  if (!grid) return;
  const km = loadTdKeymap();
  grid.innerHTML = "";
  TD_KEYMAP_REGISTRY.forEach(({ action: key }) => {
    const label = t(TD_ACTION_LABEL_KEYS[key]);
    // 键位是单值快捷键，不需要卡片 header/body 两层结构；复用紧凑行范式，减少视觉噪音。
    const row = document.createElement("div");
    row.className = "setting-row stg-keybind-row";
    row.dataset.keymapAction = key;

    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = label;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-base sm stg-keybind-button";
    row.append(labelEl, btn);

    // 按键标签经 textContent 回填（非 innerHTML 插值）：km[key] 来自 localStorage，
    // 若被污染可携带任意 HTML/JS（tdKeyLabel 对未知值原样透传）——textContent 零注入面
    setKeyButtonState(btn, label, km[key]);
    btn.addEventListener("click", () => {
      // 取消上一次未完成的捕获，保证同一时刻仅一个
      cleanupKeymap();
      setKeyButtonState(btn, label, km[key], true);
      const onKey = (ev: KeyboardEvent): void => {
        // 设置页已卸载（root 失效或 grid 不存在）则放弃捕获，先判后拦截，杜绝全局 keydown 劫持
        if (!_activeRoot?.getElementById("td-keymap-grid")) {
          cleanupKeymap();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        cleanupKeymap();
        if (ev.code === "Escape") {
          tdRenderKeymap(root);
          return;
        }
        const cur = loadTdKeymap();
        const conflict = TD_KEYMAP_REGISTRY.find(
          ({ action }) => action !== key && cur[action] === ev.code,
        );
        if (conflict) {
          bus.emit("toast:show", {
            msg: t("settings.keymap.conflict", {
              key: tdKeyLabel(ev.code),
              label: t(TD_ACTION_LABEL_KEYS[conflict.action]),
            }),
            duration: TOAST_WARN_MS,
            type: "warn",
          });
          tdRenderKeymap(root);
          return;
        }
        cur[key] = ev.code;
        tdSaveKeymap(cur);
        tdRenderKeymap(root);
        bus.emit("toast:show", {
          msg: t("settings.keymap.bound", { label, key: tdKeyLabel(ev.code) }),
          duration: TOAST_SUCCESS_MS,
          type: "success",
        });
      };
      _activeCapture = onKey;
      document.addEventListener("keydown", onKey, true);
    });
    grid.appendChild(row);
  });
}

/** 初始化 3D 预览操作：键位网格 + 恢复默认 + 相机速度 + 默认旋转模式 */
export function initKeymap(root: ShadowRoot): void {
  tdRenderKeymap(root);
  root.getElementById("td-keymap-reset")?.addEventListener("click", () => {
    safeRemove(TD_KEYMAP_KEY);
    tdRenderKeymap(root);
    bus.emit("toast:show", {
      msg: t("settings.keymap.resetDone"),
      duration: TOAST_SUCCESS_MS,
      type: "success",
    });
  });

  // 相机移动速度
  const csEl = root.getElementById("td-camspeed") as HTMLInputElement | null;
  const csVal = root.getElementById("td-camspeed-val");
  if (csEl) {
    csEl.value = safeGet(TD_CAM_SPEED.key) || String(TD_CAM_SPEED.default);
    if (csVal) csVal.textContent = csEl.value;
    csEl.addEventListener("input", () => {
      if (csVal) csVal.textContent = csEl.value;
      safeSet(TD_CAM_SPEED.key, csEl.value);
    });
  }
  // 默认旋转模式
  const rmEl = root.getElementById("td-rotmode") as HTMLSelectElement | null;
  if (rmEl) {
    rmEl.value =
      safeGet(TD_ROT_MODE.key) === TD_ROT_MODE.free ? TD_ROT_MODE.free : TD_ROT_MODE.orbit;
    rmEl.addEventListener("change", () => {
      safeSet(TD_ROT_MODE.key, rmEl.value);
    });
  }
}
