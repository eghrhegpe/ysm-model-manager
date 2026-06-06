// @deprecated 源码已内联进 app-legacy-bundle.js，此文件不再加载
// 摘要对话框（支持详细清单）
function showSummaryDialog(title, success, skip, fail, customMsg, detailList) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:360px;max-height:80vh;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px";
  let html = '<div style="font-size:13px;font-weight:600">' + title + "</div>";
  html +=
    '<div style="font-size:11px;color:#a6e3a1">✅ 成功：' + success + "</div>";
  if (customMsg)
    html +=
      '<div style="font-size:11px;color:var(--txt);margin-top:2px">' +
      customMsg +
      "</div>";
  if (skip > 0)
    html +=
      '<div style="font-size:11px;color:#f9a826">⏭️ 跳过：' + skip + "</div>";
  if (fail > 0)
    html +=
      '<div style="font-size:11px;color:#f38ba8">❌ 失败：' + fail + "</div>";

  // 详细清单
  if (detailList && detailList.length > 0) {
    html +=
      '<div style="max-height:200px;overflow-y:auto;background:var(--bg);border-radius:5px;padding:6px;font-size:10px;margin-top:2px">';
    detailList.forEach((item) => {
      const icon =
        item.type === "success" ? "✅" : item.type === "skip" ? "⏭️" : "❌";
      html +=
        '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--bd)">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' +
        esc(item.name) +
        "</span>" +
        '<span style="flex-shrink:0;margin-left:8px;color:' +
        (item.type === "success"
          ? "#a6e3a1"
          : item.type === "skip"
            ? "#f9a826"
            : "#f38ba8") +
        '">' +
        icon +
        "</span>" +
        "</div>";
    });
    html += "</div>";
  }

  html += '<div style="display:flex;gap:4px;margin-top:4px">';
  html +=
    '<button id="summary-close" style="flex:1;padding:6px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">关闭</button>';
  if (fail > 0)
    html +=
      '<button id="summary-logs" style="flex:1;padding:6px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:11px">📋 查看日志</button>';
  html += "</div>";
  dialog.innerHTML = html;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#summary-close").onclick = () => overlay.remove();
  dialog.querySelector("#summary-logs")?.addEventListener("click", () => {
    overlay.remove();
    openLogDialog();
  });
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}
