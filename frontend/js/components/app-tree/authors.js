// ===== 作者标签模块 =====

/**
 * 从 Go 端加载作者列表
 * @returns {Promise<string[]>}
 */
export async function loadAuthors() {
  try {
    const { ListModelAuthors } = await import("../../../wailsjs/go/main/App.js");
    return (await ListModelAuthors()) || [];
  } catch {
    return [];
  }
}

/**
 * 渲染作者标签栏
 * @param {Element} chips - author-chips 容器
 * @param {string[]} authors - 作者列表
 * @param {Element} srch - 搜索输入框
 */
export function renderAuthorChips(chips, authors, srch) {
  if (!chips || !authors?.length) return;
  chips.innerHTML = "";
  chips.style.display = "flex";
  authors.forEach((author) => {
    const chip = document.createElement("button");
    chip.textContent = "🎨 " + author;
    chip.style.cssText =
      "padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px;transition:all .15s";
    const isActive = srch?.value === "[" + author + "]";
    if (isActive) {
      chip.style.borderColor = "var(--accent)";
      chip.style.color = "var(--accent)";
    }
    chip.addEventListener("click", () => {
      if (!srch) return;
      srch.value = srch.value === "[" + author + "]" ? "" : "[" + author + "]";
      srch.dispatchEvent(new Event("input"));
    });
    chip.addEventListener("mouseenter", () => {
      chip.style.borderColor = "var(--accent)";
      chip.style.color = "var(--accent)";
    });
    chip.addEventListener("mouseleave", () => {
      if (srch?.value !== "[" + author + "]") {
        chip.style.borderColor = "var(--bd)";
        chip.style.color = "var(--muted)";
      }
    });
    chips.appendChild(chip);
  });
}
