// ===== 高级筛选弹窗 =====
// 多字段（关键字 + 骨骼/立方体/纹理 范围）
// 风格与 modal.js 一致（dlg-overlay/dlg-box）
// 样式：.afv-inp 已提取到 frontend/css/components.css（避免重复注入 <style>）
// 后端约束：当前 Go SearchModels 只支持 (minBones, maxBones, minCubes, maxCubes, minTex, maxTex) 6 个范围 + 1 个关键字；
//   不支持文件大小、排序（避免展示无效控件）
import { esc } from "./modal.js";

/**
 * 弹出高级筛选弹窗
 * @param {Object} opts
 * @param {Object} [opts.value] 初始值 { keyword, minBones, maxBones, minCubes, maxCubes, minTex, maxTex }
 * @returns {Promise<Object|null>} 筛选条件对象，取消返回 null；清除时返回 { cleared: true }
 */
export function modalAdvFilter(opts = {}) {
  return new Promise((resolve) => {
    const v = opts.value || {};
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    };
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        resolve(null);
      }
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.gap = "10px";
    box.style.width = "420px";

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">⚙️ 高级筛选</div>

      <div style="display:flex;flex-direction:column;gap:8px;font-size:11px">
        <div>
          <label style="display:block;color:var(--muted);margin-bottom:3px">🔍 关键字（模型名）</label>
          <input id="afv-kw" maxlength="100" value="${esc(v.keyword || "")}" placeholder="留空匹配所有" style="width:100%;padding:5px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px;box-sizing:border-box">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="display:block;color:var(--muted);margin-bottom:3px">🦴 骨骼数</label>
            <div style="display:flex;gap:4px;align-items:center">
              <input id="afv-minBones" type="number" min="0" value="${esc(String(v.minBones || ""))}" placeholder="最小" class="afv-inp" style="flex:1;width:0;min-width:0">
              <span style="color:var(--muted)">—</span>
              <input id="afv-maxBones" type="number" min="0" value="${esc(String(v.maxBones || ""))}" placeholder="最大" class="afv-inp" style="flex:1;width:0;min-width:0">
            </div>
          </div>
          <div>
            <label style="display:block;color:var(--muted);margin-bottom:3px">🧊 立方体</label>
            <div style="display:flex;gap:4px;align-items:center">
              <input id="afv-minCubes" type="number" min="0" value="${esc(String(v.minCubes || ""))}" placeholder="最小" class="afv-inp" style="flex:1;width:0;min-width:0">
              <span style="color:var(--muted)">—</span>
              <input id="afv-maxCubes" type="number" min="0" value="${esc(String(v.maxCubes || ""))}" placeholder="最大" class="afv-inp" style="flex:1;width:0;min-width:0">
            </div>
          </div>
        </div>

        <div>
          <label style="display:block;color:var(--muted);margin-bottom:3px">🖼 纹理尺寸 (px)</label>
          <div style="display:flex;gap:4px;align-items:center">
            <input id="afv-minTex" type="number" min="0" value="${esc(String(v.minTex || ""))}" placeholder="最小" class="afv-inp" style="flex:1;width:0;min-width:0">
            <span style="color:var(--muted)">—</span>
            <input id="afv-maxTex" type="number" min="0" value="${esc(String(v.maxTex || ""))}" placeholder="最大" class="afv-inp" style="flex:1;width:0;min-width:0">
          </div>
        </div>

        <div>
          <label style="display:block;color:var(--muted);margin-bottom:3px">🏷️ 标签（留空不限）</label>
          <div style="display:flex;gap:4px;align-items:center">
            <input id="afv-tag" maxlength="30" value="${esc(v.tag || "")}" placeholder="输入标签名" class="afv-inp" style="flex:1;width:0;min-width:0">
            <span id="afv-tag-hint" style="font-size:9px;color:var(--muted);white-space:nowrap"></span>
          </div>
        </div>
      </div>

      <div id="afv-err" class="dlg-err"></div>

      <div class="dlg-footer" style="padding:0;display:flex;gap:6px">
        <button id="afv-clear" class="dlg-btn" style="margin-right:auto">🧹 清除全部</button>
        <button id="afv-cancel" class="dlg-btn">取消 (Esc)</button>
        <button id="afv-ok" class="dlg-btn dlg-btn-primary">🔍 应用 (Enter)</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const kwInput = box.querySelector("#afv-kw");
    kwInput.focus();

    const tagInput = box.querySelector("#afv-tag");
    const tagHint = box.querySelector("#afv-tag-hint");

    // 异步加载已有标签提示
    (async () => {
      try {
        const { AllTags } = window.go.main.App;
        const all = await AllTags();
        if (all?.length) {
          tagHint.textContent = "已有标签: " + all.join(", ");
        }
      } catch (_) {}
    })();

    const errEl = box.querySelector("#afv-err");

    const collect = () => {
      const num = (id) => {
        const raw = box.querySelector(id)?.value.trim();
        if (!raw) return null;
        const n = parseInt(raw, 10);
        return isNaN(n) || n < 0 ? null : n;
      };
      return {
        keyword: kwInput.value.trim(),
        minBones: num("#afv-minBones"),
        maxBones: num("#afv-maxBones"),
        minCubes: num("#afv-minCubes"),
        maxCubes: num("#afv-maxCubes"),
        minTex: num("#afv-minTex"),
        maxTex: num("#afv-maxTex"),
        tag: tagInput.value.trim(),
      };
    };

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    const validate = (data) => {
      // 只在两端都填了数字时才校验（null 表示不限制）
      if (data.minBones != null && data.maxBones != null && data.minBones > data.maxBones) {
        return "骨骼数：最小值不能大于最大值";
      }
      if (data.minCubes != null && data.maxCubes != null && data.minCubes > data.maxCubes) {
        return "立方体：最小值不能大于最大值";
      }
      if (data.minTex != null && data.maxTex != null && data.minTex > data.maxTex) {
        return "纹理尺寸：最小值不能大于最大值";
      }
      return null;
    };

    box.querySelector("#afv-cancel").onclick = () => close(null);
    box.querySelector("#afv-clear").onclick = () => {
      overlay.remove();
      resolve({ cleared: true });
    };
    box.querySelector("#afv-ok").onclick = () => {
      const data = collect();
      const err = validate(data);
      if (err) {
        errEl.textContent = "⚠️ " + err;
        return;
      }
      close(data);
    };

    // Enter 提交（任意输入框）
    const allInputs = box.querySelectorAll("input");
    allInputs.forEach((el) => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const data = collect();
          const err = validate(data);
          if (err) {
            errEl.textContent = "⚠️ " + err;
            return;
          }
          close(data);
        }
      });
    });
  });
}
