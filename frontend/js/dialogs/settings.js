// @deprecated 源码已内联进 app-legacy-bundle.js，此文件不再加载
// 设置对话框
async function openSettingsDialog() {
  const mode = await window.go.main.App.GetLinkMode();
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:320px;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px";
  dialog.innerHTML =
    '<div style="font-size:13px;font-weight:600;color:var(--txt)">⚙️ 设置</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px">' +
    '<label style="font-size:10px;color:var(--muted)">🔗 文件该如何链接到仓库</label>' +
    '<select id="settings-link-mode" style="padding:6px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">' +
    '<option value="copy"' +
    (mode === "copy" ? " selected" : "") +
    ">📄 复制（占用高）</option>" +
    '<option value="hardlink"' +
    (mode === "hardlink" ? " selected" : "") +
    ">🔗 硬链接（省空间）</option>" +
    '<option value="symlink"' +
    (mode === "symlink" ? " selected" : "") +
    ">🔗 符号链接（灵活）</option>" +
    "</select></div>" +
    '<button id="settings-close" style="padding:6px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">关闭</button>';
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#settings-close").onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  dialog.querySelector("#settings-link-mode").onchange = async (e) => {
    await window.go.main.App.SetLinkMode(e.target.value);
    localStorage.setItem("linkMode", e.target.value);
    st.textContent =
      "✅ 已切换为" +
      (e.target.value === "copy"
        ? "复制模式"
        : e.target.value === "hardlink"
          ? "硬链接模式"
          : "符号链接模式");
    await saveConfig();
  };
}
