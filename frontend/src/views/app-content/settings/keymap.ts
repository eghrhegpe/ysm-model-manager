// ===== 设置页：3D 预览操作（ADR-040 拆分自 init.ts）=====
// 持久化于 localStorage，与 model3d.ts 同源。
// _activeCapture 随本段迁移（原 init.ts 模块级）：单一捕获守卫——同一时刻仅允许
// 一个键位捕获，且设置页卸载后自动失效，杜绝全局 keydown 劫持。
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { loadTdKeymap, type TdKeyAction } from "@/preview-3d/mesh/model3d.ts";
import { safeGet, safeRemove, safeSet } from "@/utils/base/primitives/storage.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { stgCard } from "./stg-card.ts";

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

// 魔法数值收敛：相机速度默认值（与 preview-3d/keymap.ts loadTdCamSpeed 默认 20 同源）、键位按钮最小宽度、
// 成功/冲突提示 toast 时长（ms）
const DEFAULT_CAM_SPEED = "20";
const KEY_BTN_MIN_WIDTH = "64px";
const TOAST_SUCCESS_MS = TOAST_MS.quick;
const TOAST_WARN_MS = TOAST_MS.info;

const TD_ACTIONS: Array<{ key: TdKeyAction; label: string }> = [
  { key: "forward", label: t("settings.keymap.actionForward") },
  { key: "back", label: t("settings.keymap.actionBack") },
  { key: "left", label: t("settings.keymap.actionLeft") },
  { key: "right", label: t("settings.keymap.actionRight") },
  { key: "up", label: t("settings.keymap.actionUp") },
  { key: "down", label: t("settings.keymap.actionDown") },
];

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

const tdSaveKeymap = (km: Record<TdKeyAction, string>): void => {
  safeSet("td-keymap", JSON.stringify(km));
};

function tdRenderKeymap(root: ShadowRoot): void {
  // 重建网格前取消任何进行中的捕获，避免叠加/残留
  cleanupKeymap();
  _activeRoot = root;
  const grid = root.getElementById("td-keymap-grid");
  if (!grid) return;
  const km = loadTdKeymap();
  grid.innerHTML = "";
  TD_ACTIONS.forEach(({ key, label }) => {
    // 每张键位 = 一张工厂小卡（hdr=方向名，body=当前键按钮），平铺在 stg-grid 容器，
    // 对齐基础设置「路径配置」卡组合——自包含、可组合、不浪费整行宽度。
    const btnHtml = `<button class="btn-base sm" style="min-width:${KEY_BTN_MIN_WIDTH};width:100%">${tdKeyLabel(km[key])}</button>`;
    const card = document.createElement("div");
    card.innerHTML = stgCard("", label, btnHtml, { header: { titleSize: "base" } });
    const btn = card.querySelector("button");
    if (!btn) return;
    btn.addEventListener("click", () => {
      // 取消上一次未完成的捕获，保证同一时刻仅一个
      cleanupKeymap();
      btn.textContent = t("settings.keymap.pressKey");
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
        const conflict = TD_ACTIONS.find((a) => a.key !== key && cur[a.key] === ev.code);
        if (conflict) {
          bus.emit("toast:show", {
            msg: t("settings.keymap.conflict", { key: tdKeyLabel(ev.code), label: conflict.label }),
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
    grid.appendChild(card);
  });
}

/** 初始化 3D 预览操作：键位网格 + 恢复默认 + 相机速度 + 默认旋转模式 */
export function initKeymap(root: ShadowRoot): void {
  tdRenderKeymap(root);
  root.getElementById("td-keymap-reset")?.addEventListener("click", () => {
    safeRemove("td-keymap");
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
    csEl.value = safeGet("td-cam-speed") || DEFAULT_CAM_SPEED;
    if (csVal) csVal.textContent = csEl.value;
    csEl.addEventListener("input", () => {
      if (csVal) csVal.textContent = csEl.value;
      safeSet("td-cam-speed", csEl.value);
    });
  }
  // 默认旋转模式
  const rmEl = root.getElementById("td-rotmode") as HTMLSelectElement | null;
  if (rmEl) {
    rmEl.value = safeGet("td-rot-mode") === "free" ? "free" : "orbit";
    rmEl.addEventListener("change", () => {
      safeSet("td-rot-mode", rmEl.value);
    });
  }
}
