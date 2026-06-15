// ===== 模型标签编辑弹窗 =====
// 读取/写入模型标签，支持输入新标签和选择已有标签
import { esc } from "../utils/dom.js";
import { bus } from "../bus.js";

/**
 * 弹出标签编辑弹窗
 * @param {string} modelPath - 模型文件路径
 * @returns {Promise<string[]|null>} 保存后的标签列表，取消返回 null
 */
export function modalTagEditor(modelPath) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null);
    };
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.cssText =
      "gap:10px;width:380px;max-height:80vh;display:flex;flex-direction:column";

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">🏷️ 编辑标签</div>
      <div style="font-size:10px;color:var(--muted);word-break:break-all">${esc(modelPath)}</div>

      <div id="te-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:28px;padding:4px;border:1px solid var(--bd);border-radius:5px;background:var(--bg);align-content:flex-start"></div>

      <div style="display:flex;gap:4px">
        <input id="te-input" maxlength="30" placeholder="输入标签后按 Enter" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
        <button id="te-add" class="dlg-btn dlg-btn-primary" style="padding:4px 10px">+ 添加</button>
      </div>

      <details style="font-size:10px">
        <summary style="cursor:pointer;color:var(--muted)">📋 已有标签（点击添加）</summary>
        <div id="te-suggest" style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 0"></div>
      </details>

      <div id="te-err" class="dlg-err"></div>

      <div class="dlg-footer" style="padding:0;display:flex;gap:6px">
        <button id="te-cancel" class="dlg-btn">取消</button>
        <button id="te-save" class="dlg-btn dlg-btn-primary">💾 保存</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const errEl = box.querySelector("#te-err");
    const tagsEl = box.querySelector("#te-tags");
    const inputEl = box.querySelector("#te-input");
    const suggestEl = box.querySelector("#te-suggest");

    let tags = [];

    // === 加载 ===
    (async () => {
      try {
        const { GetModelTags, AllTags } = window.go.main.App;
        tags = await GetModelTags(modelPath);
        renderTags();
        const allTags = await AllTags();
        renderSuggestions(allTags);
      } catch (e) {
        errEl.textContent = "⚠️ 加载标签失败: " + e.message;
      }
    })();

    function renderTags() {
      tagsEl.innerHTML = tags
        .map(
          (t) =>
            '<span class="te-tag">' +
            esc(t) +
            '<button class="te-tag-del" data-tag="' +
            esc(t) +
            '">✕</button>' +
            "</span>",
        )
        .join("");
      tagsEl.querySelectorAll(".te-tag-del").forEach((btn) => {
        btn.onclick = () => {
          const t = btn.dataset.tag;
          tags = tags.filter((x) => x !== t);
          renderTags();
        };
      });
    }

    function renderSuggestions(allTags) {
      const unused = allTags.filter((t) => !tags.includes(t));
      suggestEl.innerHTML = unused.length
        ? unused
            .map(
              (t) =>
                '<button class="te-sug-btn" data-tag="' +
                esc(t) +
                '">+' +
                esc(t) +
                "</button>",
            )
            .join("")
        : '<span style="color:var(--muted)">暂无其他标签</span>';
      suggestEl.querySelectorAll(".te-sug-btn").forEach((btn) => {
        btn.onclick = () => {
          const t = btn.dataset.tag;
          if (!tags.includes(t)) {
            tags = [...tags, t].sort();
            renderTags();
          }
        };
      });
    }

    function addTag(t) {
      t = t.trim();
      if (!t) return;
      if (tags.includes(t)) {
        errEl.textContent = "⚠️ 标签已存在";
        return;
      }
      if (t.length > 20) {
        errEl.textContent = "⚠️ 标签最多 20 个字符";
        return;
      }
      errEl.textContent = "";
      tags = [...tags, t].sort();
      renderTags();
      inputEl.value = "";
    }

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        addTag(inputEl.value);
      }
    });
    box.querySelector("#te-add").onclick = () => addTag(inputEl.value);

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    box.querySelector("#te-cancel").onclick = () => close(null);
    box.querySelector("#te-save").onclick = async () => {
      try {
        const { SetModelTags } = window.go.main.App;
        await SetModelTags(modelPath, tags);
        close(tags);
      } catch (e) {
        errEl.textContent = "⚠️ 保存失败: " + e.message;
      }
    };
  });
}
