// ===== 统一模态弹窗 =====
// 风格参照 rename.js 的卡片式弹窗，复用 CSS 变量
// 用法: const name = await modalPrompt({ title, icon, value, placeholder })

export function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 弹出带输入框的模态框，类似 styled prompt()
 * @param {object} opts
 * @param {string} opts.title 标题
 * @param {string} [opts.icon] 图标，如 "📁"
 * @param {string} [opts.value] 初始值
 * @param {string} [opts.placeholder] 占位符
 * @param {string} [opts.okText] 确认按钮文字，默认 "确定"
 * @returns {Promise<string|null>} 用户输入的值，取消返回 null
 */
export function modalPrompt(opts) {
  return new Promise((resolve) => {
    const { title, icon, value, placeholder, okText } = opts;
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    };

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.gap = "10px";

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">${icon || ""} ${esc(title)}</div>
      <input id="mp-input" value="${esc(value || "")}" placeholder="${esc(placeholder || "")}" style="width:100%;padding:6px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:12px;box-sizing:border-box">
      <div id="mp-err" class="dlg-err"></div>
      <div class="dlg-footer" style="padding:0">
        <button id="mp-cancel" class="dlg-btn">取消 (Esc)</button>
        <button id="mp-ok" class="dlg-btn dlg-btn-primary">${esc(okText || "确定")} (Enter)</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = box.querySelector("#mp-input");
    input.focus();
    input.select();

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    const errEl = box.querySelector("#mp-err");

    box.querySelector("#mp-cancel").onclick = () => close(null);
    box.querySelector("#mp-ok").onclick = () => {
      const v = input.value.trim();
      if (!v) {
        input.focus();
        if (errEl) errEl.textContent = "⚠️ 此项不能为空";
        return;
      }
      close(v);
    };
    input.addEventListener("input", () => {
      if (errEl) errEl.textContent = "";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        if (!v) {
          if (errEl) errEl.textContent = "⚠️ 此项不能为空";
          return;
        }
        close(v);
      }
      if (e.key === "Escape") close(null);
    });
  });
}

/**
 * 弹出确认对话框
 * @param {object} opts
 * @param {string} opts.title 标题
 * @param {string} [opts.icon] 图标
 * @param {string} opts.message 消息内容
 * @param {string} [opts.okText] 确认按钮文字，默认 "确定"
 * @param {boolean} [opts.danger] 确认按钮是否为危险风格
 * @returns {Promise<boolean>}
 */
export function modalConfirm(opts) {
  return new Promise((resolve) => {
    const { title, icon, message, okText, danger } = opts;
    const overlay = document.createElement("div");
    overlay.tabIndex = 0;
    overlay.className = "dlg-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    };
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        resolve(false);
      }
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.gap = "10px";

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">${icon || ""} ${esc(title)}</div>
      <div style="font-size:11px;color:var(--txt);line-height:1.5;white-space:pre-wrap">${esc(message)}</div>
      <div class="dlg-footer" style="padding:0">
        <button id="mc-cancel" class="dlg-btn">取消 (Esc)</button>
        <button id="mc-ok" class="dlg-btn" style="border:none;background:${danger ? "#e5534b" : "var(--accent)"};color:#fff">${esc(okText || "确定")} (Enter)</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.focus();

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    box.querySelector("#mc-cancel").onclick = () => close(false);
    box.querySelector("#mc-ok").onclick = () => close(true);
  });
}
