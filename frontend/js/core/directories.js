// ===== 目录选择 =====
const $id = (id) => document.getElementById(id);
const $btn = (id) => {
  const el = $id(id);
  return el ? el : { addEventListener: () => {} };
};
$btn("btn-repo").addEventListener("click", async () => {
  const dir = await window.go.main.App.SelectDirectory();
  if (!dir) return;
  repoRoot = dir;
  window.go.main.App.SetRepoRoot(dir);
  localStorage.setItem("repoRoot", dir);
  const btn = $id("btn-repo");
  if (btn) btn.textContent = "📁 " + dir;
  await saveConfig();
  await loadAll();
});

$btn("btn-mc").addEventListener("click", async () => {
  const dir = await window.go.main.App.SelectDirectory();
  if (!dir) return;
  mcRoot = dir;
  localStorage.setItem("mcRoot", dir);
  const btn = $id("btn-mc");
  if (btn) btn.textContent = "🎮 " + dir;
  await saveConfig();
  if (repoRoot) await loadAll();
});

// ===== 配置持久化到磁盘 =====
async function saveConfig() {
  const linkMode = localStorage.getItem("linkMode") || "";
  try {
    await window.go.main.App.SaveAppConfig(repoRoot, mcRoot, linkMode);
  } catch (e) {
    console.error("配置保存失败:", e);
  }
}
