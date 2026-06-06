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
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    };

    const box = document.createElement("div");
    box.style.cssText =
      "background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;width:380px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:10px";

    box.innerHTML = `
      <div style="font-size:13px;font-weight:600">${icon || ""} ${esc(title)}</div>
      <input id="mp-input" value="${esc(value || "")}" placeholder="${esc(placeholder || "")}" style="width:100%;padding:6px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:12px;box-sizing:border-box">
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button id="mp-cancel" style="padding:5px 14px;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消</button>
        <button id="mp-ok" style="padding:5px 14px;border-radius:5px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:11px">${esc(okText || "确定")}</button>
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

    box.querySelector("#mp-cancel").onclick = () => close(null);
    box.querySelector("#mp-ok").onclick = () => {
      const v = input.value.trim();
      if (!v) {
        input.focus();
        return;
      }
      close(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        if (!v) return;
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
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
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
    box.style.cssText =
      "background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;width:380px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:10px";

    box.innerHTML = `
      <div style="font-size:13px;font-weight:600">${icon || ""} ${esc(title)}</div>
      <div style="font-size:11px;color:var(--txt);line-height:1.5;white-space:pre-wrap">${esc(message)}</div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button id="mc-cancel" style="padding:5px 14px;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消</button>
        <button id="mc-ok" style="padding:5px 14px;border-radius:5px;border:none;background:${danger ? "#e5534b" : "var(--accent)"};color:#fff;cursor:pointer;font-size:11px">${esc(okText || "确定")}</button>
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
