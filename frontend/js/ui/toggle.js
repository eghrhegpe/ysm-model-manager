// 侧栏/预览切换
let sidebarOpen = true,
  previewOpen = true;
$("#btn-toggle-sidebar").onclick = () => {
  sidebarOpen = !sidebarOpen;
  document.documentElement.style.setProperty(
    "--sidebar-width",
    sidebarOpen ? "300px" : "0px",
  );
  document.querySelector(".sidebar").style.overflow = sidebarOpen
    ? "auto"
    : "hidden";
  $("#btn-toggle-sidebar").textContent = sidebarOpen ? "◀" : "▶";
};
$("#btn-toggle-preview").onclick = () => {
  previewOpen = !previewOpen;
  document.documentElement.style.setProperty(
    "--preview-width",
    previewOpen ? "240px" : "0px",
  );
  document.querySelector(".preview").style.overflow = previewOpen
    ? "auto"
    : "hidden";
  $("#btn-toggle-preview").textContent = previewOpen ? "▶" : "◀";
};
